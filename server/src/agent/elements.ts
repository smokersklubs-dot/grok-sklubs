import { randomBytes } from "node:crypto";
import { clip } from "../store.js";
import type { ElementAnswer, ElementRequest, ElementSnapshot, PageElement } from "../screen-elements.js";
import { dialogWords, tabNote } from "../browser-cdp.js";

/**
 * Element references (wave 8, item 6): what each bot's page was when it last looked, so a reference like "3f9a.12" can
 * be turned back into the element it named.
 *
 * L74 — stable references (agent-browser audit): a reference belongs to one document of one tab (its first part) and
 * keeps its number for that document's whole life: the same element gets the same number in every later snapshot, and a
 * reference from an earlier snapshot of the same page still works. When a new document loads (or another tab comes to
 * the front) the references start afresh and older ones fail clearly. The page itself is checked again at each action
 * (screen-elements.ts): another tab, a new document, or an element that is gone or changed — nothing is done (an element
 * the page redrew may be found again by its unique role and name, never for a committing click).
 *
 * L65 — what changed: each new look at the same page is compared with the previous one (address, title, controls that
 * appeared, went away or changed state, new lines of text), so an action can answer in words instead of a screenshot.
 */
interface Doc {
  id: string; target: string; loader: string; url: string; title: string; at: number;
  byRef: Map<number, PageElement>; byNode: Map<number, number>; next: number; current: number[]; lines: string[];
}
const docs = new Map<string, Doc>();

export const REF_FORMAT = /^([0-9a-f]{4})\.(\d{1,4})$/;
export const forgetSnapshot = (botId: string) => { docs.delete(botId); };

const STATE_KEYS = ["disabled", "checked", "expanded", "selected", "required"] as const;
const states = (e: PageElement) => [e.disabled ? "disabled" : "", e.checked !== undefined ? `checked=${String(e.checked)}` : "", e.expanded !== undefined ? `expanded=${String(e.expanded)}` : "", e.selected ? "selected" : "", e.required ? "required" : "", e.visible ? "" : "off-screen"].filter(Boolean);

/** A link's address as the bot needs it: the path alone on the page's own site, else the whole address. */
function shortHref(href: string, page: string): string {
  try {
    const u = new URL(href), p = new URL(page);
    if (u.origin === p.origin && u.protocol.startsWith("http")) return clip(`${u.pathname}${u.search}${u.hash}`, 120);
  } catch { /* not an address */ }
  return clip(href, 140);
}

function line(doc: Doc, n: number, e: PageElement): string {
  const st = states(e);
  return `[${doc.id}.${n}] ${e.role} "${clip(e.name, 100)}"${e.value !== undefined ? ` value="${clip(e.value, 60)}"` : ""}${st.length ? ` (${st.join(", ")})` : ""}${e.hint ? ` hint="${clip(e.hint, 120)}"` : ""}${e.href ? ` → ${shortHref(e.href, doc.url)}` : ""}${e.frame ? ` [in frame: ${clip(e.frame, 60)}]` : ""}`;
}

/** Takes a new look at the page into the bot's current document (same tab and document: same numbers), and what it was before. */
function absorb(botId: string, s: ElementSnapshot): { doc: Doc; fresh: boolean; before: { url: string; title: string; els: Map<number, PageElement>; lines: string[] } | null } {
  const prev = docs.get(botId);
  const same = !!prev && prev.target === s.target && prev.loader === s.loader;
  let doc: Doc;
  if (same) doc = prev!;
  else {
    let id = randomBytes(2).toString("hex");
    if (prev?.id === id) id = ((parseInt(id, 16) + 1) % 0x10000).toString(16).padStart(4, "0");
    doc = { id, target: s.target, loader: s.loader, url: s.url, title: s.title, at: Date.now(), byRef: new Map(), byNode: new Map(), next: 1, current: [], lines: [] };
    docs.set(botId, doc);
  }
  const before = same ? { url: doc.url, title: doc.title, els: new Map(doc.current.map((n) => [n, doc.byRef.get(n)!] as const)), lines: doc.lines } : null;
  doc.current = s.elements.map((e) => {
    let n = doc.byNode.get(e.node);
    if (!n) { n = doc.next++; doc.byNode.set(e.node, n); }
    doc.byRef.set(n, e);
    return n;
  });
  // A long-lived page that keeps redrawing: only the elements still on it are kept once there are many.
  if (doc.byRef.size > 3000) {
    const keep = new Set(doc.current);
    for (const [n, e] of doc.byRef) if (!keep.has(n)) { doc.byRef.delete(n); doc.byNode.delete(e.node); }
  }
  Object.assign(doc, { url: s.url, title: s.title, at: Date.now(), lines: s.outline?.lines ?? [] });
  return { doc, fresh: !same, before };
}

const closedFrames = (s: ElementSnapshot) => (s.frames ?? []).filter((f) => !f.readable).map((f) => `- A frame from ${clip(f.label, 60)} is on this page, but its controls cannot be listed: use screen_view and the pixel tools for it.`);
const outlineLines = (s: ElementSnapshot) => {
  const h = (s.outline?.headings ?? []).slice(0, 20).map((x) => `${"  ".repeat(Math.max(0, Math.min(2, x.level - 1)))}- h${x.level} ${clip(x.text, 100)}`);
  return h.length ? ["Headings:", ...h] : [];
};

/** The whole listing of a page (element_snapshot, or a page just opened). */
function listing(doc: Doc, s: ElementSnapshot, intro: string): string {
  const list = doc.current.map((n) => line(doc, n, doc.byRef.get(n)!));
  const note = tabNote(s.ctx);
  return [
    `Page: ${s.title || "(untitled)"} — ${s.url}`,
    ...(note ? [note] : []),
    ...outlineLines(s),
    `${intro} ${doc.id}: ${list.length} interactive element${list.length === 1 ? "" : "s"}${s.more ? ` (and ${s.more} more not listed)` : ""}, on the screen first. Act on one with element_click, element_type, element_select or element_fill and its reference. References stay valid on this page (also after more snapshots); once another page loads, use the new ones.`,
    ...(list.length ? list : ["(no interactive element found: use screen_view and the pixel tools)"]),
    ...closedFrames(s),
  ].join("\n");
}

/** Keeps a new snapshot as the bot's current one and returns the text the model gets (element_snapshot). */
export function rememberSnapshot(botId: string, s: ElementSnapshot): string {
  const { doc } = absorb(botId, s);
  return listing(doc, s, "Element snapshot");
}

const sameControl = (a: PageElement, b: PageElement) => a.role === b.role && a.name === b.name && (a.frame ?? "") === (b.frame ?? "");
const stateOf = (e: PageElement) => [e.value ?? "", ...STATE_KEYS.map((k) => String(e[k] ?? ""))].join("|");

/**
 * L65 — the page after an action, in words: on a new page its whole listing; on the same page what changed (address,
 * title, controls that appeared, went away or changed, new text). `sparse`: words are not enough (almost no text and no
 * control, or a canvas / video covering much of the screen): a screenshot should go with it.
 */
export function afterAction(botId: string, s: ElementSnapshot): { text: string; sparse: boolean; fresh: boolean } {
  const { doc, fresh, before } = absorb(botId, s);
  const sparse = (s.elements.length === 0 && (s.outline?.textLength ?? 0) < 200) || (s.outline?.media ?? 0) >= 0.4;
  if (fresh || !before) return { text: listing(doc, s, "New page — element snapshot"), sparse, fresh: true };
  const out: string[] = [`Page: ${s.title || "(untitled)"} — ${s.url}`];
  const note = tabNote(s.ctx);
  if (note) out.push(note);
  const changes: string[] = [];
  if (before.url !== s.url) changes.push(`The address changed: ${clip(before.url, 120)} → ${clip(s.url, 160)}`);
  if (before.title !== s.title) changes.push(`The title changed: “${clip(before.title, 80)}” → “${clip(s.title, 80)}”`);
  const added = doc.current.filter((n) => !before.els.has(n));
  const gone = [...before.els.keys()].filter((n) => !doc.current.includes(n));
  // A control the page redrew (same role and name, new node) is neither new nor gone.
  const goneLeft = gone.filter((g) => { const i = added.findIndex((a) => sameControl(doc.byRef.get(a)!, before.els.get(g)!)); if (i < 0) return true; added.splice(i, 1); return false; });
  for (const n of added.slice(0, 30)) changes.push(`+ ${line(doc, n, doc.byRef.get(n)!)}`);
  if (added.length > 30) changes.push(`+ … and ${added.length - 30} more new controls (element_snapshot lists them all)`);
  for (const n of goneLeft.slice(0, 15)) { const e = before.els.get(n)!; changes.push(`− ${e.role} "${clip(e.name, 80)}" is gone`); }
  if (goneLeft.length > 15) changes.push(`− … and ${goneLeft.length - 15} more controls are gone`);
  let changed = 0;
  for (const n of doc.current) {
    const was = before.els.get(n), now = doc.byRef.get(n)!;
    if (!was || stateOf(was) === stateOf(now)) continue;
    if (++changed <= 15) changes.push(`~ ${line(doc, n, now)} (was: ${[was.value !== undefined ? `value="${clip(was.value, 40)}"` : "", ...states(was)].filter(Boolean).join(", ") || "no state"})`);
  }
  const old = new Set(before.lines);
  const newText = (s.outline?.lines ?? []).filter((l) => !old.has(l));
  if (newText.length) changes.push(`New text on the page: ${newText.slice(0, 8).map((l) => `“${clip(l, 160)}”`).join(" · ")}${newText.length > 8 ? ` (and ${newText.length - 8} more lines: page_read)` : ""}`);
  out.push(changes.length ? `What changed:\n${changes.join("\n")}` : "Nothing visible changed in the page's controls or text (the action may still have worked out of sight: check with page_read or screen_view if it matters).");
  out.push(`References (${doc.id}.n) stay the same on this page; element_snapshot lists all ${doc.current.length} controls.`);
  out.push(...closedFrames(s));
  return { text: out.join("\n"), sparse, fresh: false };
}

/** The element a reference names, as an action request, or why it cannot be used. */
export function resolveRef(botId: string, ref: unknown): { req: Omit<ElementRequest, "action">; element: PageElement } | { error: string } {
  const m = REF_FORMAT.exec(String(ref ?? "").trim());
  if (!m) return { error: `"${clip(String(ref ?? ""), 40)}" is not an element reference (they look like 3f9a.12). Take an element_snapshot first.` };
  const doc = docs.get(botId);
  if (!doc) return { error: "No element snapshot is current. Take one with element_snapshot." };
  if (doc.id !== m[1]) return { error: `That reference is from an older page (${m[1]}); references on the page in front start with ${doc.id}. Use one from your latest result, or take a new element_snapshot.` };
  const element = doc.byRef.get(Number(m[2]));
  if (!element) return { error: `The page ${doc.id} has no element ${m[2]}.` };
  return { element, req: { node: element.node, role: element.role, name: element.name, target: doc.target, loader: doc.loader } };
}

/** L74: the page redrew an element and the helper found it again (same role and name, unique): the reference now names the new node. */
export function noteMoved(botId: string, ref: unknown, node: number | undefined) {
  const m = REF_FORMAT.exec(String(ref ?? "").trim()), doc = docs.get(botId);
  if (!m || !doc || doc.id !== m[1] || !node) return;
  const n = Number(m[2]), e = doc.byRef.get(n);
  if (!e) return;
  doc.byNode.delete(e.node);
  doc.byRef.set(n, { ...e, node });
  doc.byNode.set(node, n);
}

/** What the model is told when an action was refused, and whether trying again is safe (L74); a stale page also forgets the references. */
export function refusal(botId: string, a: ElementAnswer, what = "action"): string {
  if (a.stale) {
    if (/new page|another tab/.test(a.stale)) forgetSnapshot(botId);
    return `That reference is stale: ${a.stale}. Nothing was done, so it is safe to try again with a reference from a new element_snapshot.`;
  }
  if (a.dialog) return dialogWords(a.dialog);
  // L74: sent, not confirmed — it may have happened; repeating it could do it twice.
  if (a.sent) return `The ${what} was sent, but the page did not confirm it: ${a.error ?? "no answer"}. It may already have happened: do not repeat it blindly. Look first (element_snapshot, page_read or screen_view), then decide.`;
  // The click point was checked (document.elementFromPoint): something else would have received the click.
  if (a.covered) return `That element is covered by ${clip(a.covered, 160)}: the click would land there instead. Nothing was clicked. Deal with what covers it first (often a cookie banner or a dialog box), then try again.`;
  const err = a.error ?? "The browser did not do it.";
  const again = /disabled/.test(err) ? "Trying again will not help until the page enables it." : "Nothing was done, so it is safe to try again once that is fixed.";
  return `${err}${a.options?.length ? ` Options: ${a.options.map((o) => `"${clip(o, 60)}"`).join(", ")}.` : ""} ${again}`;
}

/** L74: the words for a field read back after typing. */
export function typedWords(t: ElementAnswer["typed"]): string {
  if (!t || t.verified === null) return "(the field could not be read back)";
  if (t.verified) return t.value === undefined ? "— verified (the field holds it; its value is hidden)" : `— verified: the field now reads “${clip(t.value, 80)}”`;
  return t.value === undefined ? "— NOT verified: the field does not hold what was typed" : `— NOT verified: the field now reads “${clip(t.value, 120)}” (a limit, a format or the page's script changed it)`;
}

/** The page address of the bot's current snapshot (for the approval of a committing click or a file upload). */
export const snapshotUrl = (botId: string) => docs.get(botId)?.url ?? "";
