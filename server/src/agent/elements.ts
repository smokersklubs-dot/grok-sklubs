import { randomBytes } from "node:crypto";
import { clip } from "../store.js";
import type { ElementAnswer, ElementRequest, ElementSnapshot, PageElement } from "../screen-elements.js";

/**
 * Element references (wave 8, item 6): the last snapshot of each bot's page, so a reference like "3f9a.12" can be turned
 * back into the element it named. A reference is valid only for the snapshot that gave it (its first part), and only
 * the bot's latest snapshot is kept: an older one fails clearly. The page itself is checked again at each action
 * (screen-elements.ts): another tab, a new document, or an element that is gone or changed — nothing is done.
 */
interface Snap { id: string; target: string; loader: string; url: string; title: string; at: number; byRef: Map<number, PageElement> }
const snaps = new Map<string, Snap>();

export const REF_FORMAT = /^([0-9a-f]{4})\.(\d{1,4})$/;
export const forgetSnapshot = (botId: string) => { snaps.delete(botId); };

/** Keeps a new snapshot as the bot's current one and returns the text the model gets. */
export function rememberSnapshot(botId: string, s: ElementSnapshot): string {
  let id = randomBytes(2).toString("hex");
  if (snaps.get(botId)?.id === id) id = ((parseInt(id, 16) + 1) % 0x10000).toString(16).padStart(4, "0");
  const byRef = new Map<number, PageElement>();
  s.elements.forEach((e, i) => byRef.set(i + 1, e));
  snaps.set(botId, { id, target: s.target, loader: s.loader, url: s.url, title: s.title, at: Date.now(), byRef });
  const line = (n: number, e: PageElement) => {
    const states = [e.disabled ? "disabled" : "", e.checked !== undefined ? `checked=${String(e.checked)}` : "", e.expanded !== undefined ? `expanded=${String(e.expanded)}` : "", e.selected ? "selected" : "", e.required ? "required" : "", e.visible ? "" : "off-screen"].filter(Boolean);
    return `[${id}.${n}] ${e.role} "${clip(e.name, 100)}"${e.value !== undefined ? ` value="${clip(e.value, 60)}"` : ""}${states.length ? ` (${states.join(", ")})` : ""}`;
  };
  const list = [...byRef.entries()].map(([n, e]) => line(n, e));
  return [
    `Page: ${s.title || "(untitled)"} — ${s.url}`,
    `Element snapshot ${id}: ${list.length} interactive element${list.length === 1 ? "" : "s"}${s.more ? ` (and ${s.more} more not listed)` : ""}, on the screen first. Act on one with element_click, element_type or element_select and its reference. References are only valid for this snapshot and this page: after the page changes, take a new snapshot.`,
    ...(list.length ? list : ["(no interactive element found: use screen_view and the pixel tools)"]),
  ].join("\n");
}

/** The element a reference names, as an action request, or why it cannot be used. */
export function resolveRef(botId: string, ref: unknown): { req: Omit<ElementRequest, "action">; element: PageElement } | { error: string } {
  const m = REF_FORMAT.exec(String(ref ?? "").trim());
  if (!m) return { error: `"${clip(String(ref ?? ""), 40)}" is not an element reference (they look like 3f9a.12). Take an element_snapshot first.` };
  const snap = snaps.get(botId);
  if (!snap) return { error: "No element snapshot is current. Take one with element_snapshot." };
  if (snap.id !== m[1]) return { error: `That reference is from an older snapshot (${m[1]}); the current one is ${snap.id}. Use a reference from the latest element_snapshot, or take a new one.` };
  const element = snap.byRef.get(Number(m[2]));
  if (!element) return { error: `Snapshot ${snap.id} has no element ${m[2]}.` };
  return { element, req: { node: element.node, role: element.role, name: element.name, target: snap.target, loader: snap.loader } };
}

/** What the model is told when an action was refused; a stale page also forgets the snapshot. */
export function refusal(botId: string, a: ElementAnswer): string {
  if (a.stale) { forgetSnapshot(botId); return `That reference is stale: ${a.stale}. Nothing was done. Take a new element_snapshot.`; }
  return `${a.error ?? "The browser did not do it."}${a.options?.length ? ` Options: ${a.options.map((o) => `"${clip(o, 60)}"`).join(", ")}.` : ""} Nothing was done.`;
}

/** The page address of the bot's current snapshot (for the approval of a committing click). */
export const snapshotUrl = (botId: string) => snaps.get(botId)?.url ?? "";
