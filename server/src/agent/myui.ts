import { tr } from "../i18n.js";
import type { ToolSpec } from "../llm/types.js";
import { liveDevice } from "../relay.js";
import { nameGuard } from "../relayguard.js";
import { bots, clip } from "../store.js";
import { committingKind } from "./bind.js";
import { act, controlGate, failed, inSession, pick } from "./mycomputer.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L164 — the accessibility tree of an app on the user's own Mac or Windows PC (Sklubot Relais protocol 1.5,
 * docs/RELAIS-PROTOCOLE.md §16; companion/src/main/capabilities/accessibility.js, adapted from vercel-labs/agent-desktop,
 * Apache-2.0). The bot reads an app's controls with a reference for each one (my_ui_tree), then acts on one BY
 * REFERENCE (my_ui_act): press, fill, tick, choose, open — no pixel aiming, and with `background` the pointer does not
 * move and the app does not have to be in front.
 *
 * Same locks as the other "mycomputer" tools: the control card (controlGate) and the computer's own question; on the
 * computer, the Relais rules (refused apps, keep-out list, never a password field, the app in front re-read unless
 * background, the control re-checked before acting). Here, on top: a refused app or keep-out entry by name is refused
 * before anything is sent, and pressing a control whose words commit something (send, pay, delete, publish, confirm…)
 * asks the owner on a single-use card (the committing-click rule of bind.ts), from the words the COMPUTER reported in
 * the snapshot, never from what the bot says.
 */

interface UiElement { ref: string; role: string; name: string; value?: string; secure?: boolean; enabled?: boolean; inDialog?: string }
interface UiSnap { snapshotId: string; app: string; elements: Map<string, UiElement>; at: number }
/** Last snapshot per (bot, computer): the gate reads a reference's words from it. */
const snaps = new Map<string, UiSnap>();
const snapKey = (botId: string, deviceId: string) => `${botId}\u0000${deviceId}`;
const MAX_SNAPS = 500;

/** Remembers what the computer reported (for the committing-press card). Exported for tests. */
export function noteSnapshot(botId: string, deviceId: string, r: { snapshotId?: unknown; app?: unknown; elements?: unknown }) {
  const list = Array.isArray(r.elements) ? (r.elements as UiElement[]) : [];
  const elements = new Map<string, UiElement>();
  for (const e of list) if (e && typeof e.ref === "string" && e.ref) elements.set(e.ref, { ref: e.ref, role: clip(String(e.role ?? ""), 30), name: clip(String(e.name ?? ""), 120), secure: e.secure === true, enabled: e.enabled !== false, inDialog: e.inDialog ? clip(String(e.inDialog), 120) : undefined });
  if (snaps.size >= MAX_SNAPS) snaps.delete(snaps.keys().next().value!);
  snaps.set(snapKey(botId, deviceId), { snapshotId: String(r.snapshotId ?? ""), app: clip(String(r.app ?? ""), 100), elements, at: Date.now() });
}
export const knownElement = (botId: string, deviceId: string, ref: string) => snaps.get(snapKey(botId, deviceId))?.elements.get(String(ref ?? "").trim()) ?? null;
export const forgetSnapshots = () => snaps.clear();

/** Whether pressing / choosing this control commits something (bind.ts committingKind on the reported words). */
export function committingPress(el: Pick<UiElement, "role" | "name">, action: string): string | null {
  if (!["press", "select", "toggle"].includes(action)) return null;
  if (!["button", "menuitem", "link", "menubutton", "cell", "option", "checkbox", "switch", "radiobutton"].includes(el.role)) return null;
  return committingKind(el.name);
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const DEVICE = str("Which of the user's computers (its name), only needed when several are connected");

/** The control card first; then, for a committing press, a single-use card naming the control and the app. */
const actGate: NonNullable<BuiltinTool["gate"]> = (a, ctx) => {
  const control = controlGate(a, ctx);
  if (control) return control;
  const bot = bots.byId(ctx.botId);
  const { target } = bot ? pick(bot.userId, a.device) : {};
  if (!bot || !target) return null;
  const el = knownElement(bot.id, target.id, String(a.ref ?? ""));
  if (!el) return null; // the tool refuses an unknown reference
  const kind = committingPress(el, String(a.action ?? "press"));
  if (!kind) return null;
  const app = snaps.get(snapKey(bot.id, target.id))?.app ?? "";
  return {
    key: `myui: commit: ${bot.name}`, strict: true, once: true, source: "My computer",
    vars: { label: clip(el.name, 80), app: clip(app, 60), device: target.label },
    title: "Allow {bot} to press “{label}” in {app} on {device}?", reason: "press “{label}” on {device}",
    note: "These words commit something (send, pay, delete, publish, confirm…): you are asked every time.",
  };
};

const unsupported = (c: ToolContext, label: string): ToolOutput => ({
  content: `${label} does not offer the accessibility tree: it needs Sklubot Relais 1.5 or later on macOS or Windows (on Linux, use my_screen and my_click). Tell the user, or use my_screen / my_click instead.`,
  isError: true, summary: tr(c.user.locale, "not available"),
});
const STALE: ToolOutput = { content: "That reference is out of date (the app changed, or it comes from an older reading). Read the app again with my_ui_tree and use a reference from that new reading.", isError: true, summary: "stale reference" };

export const myUiTools: BuiltinTool[] = [
  {
    spec: { name: "my_ui_tree", description: "Read the controls of an app on the user's own Mac or Windows PC (buttons, fields, boxes, lists…) through its accessibility tree: each control you can act on has a reference like @s1a2b3:e8 for my_ui_act. Open dialogs are listed first. More reliable than clicking at pixels for forms and menus. Password fields are shown but never their value. Without app: the app in front.", inputSchema: obj({ app: str("The app's name (e.g. \"Mail\", \"notepad\"); default: the app in front"), device: DEVICE }) },
    group: "mycomputer", activity: "computer", label: "Reading an app on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone" || !liveDevice(c.user.id, t.id)?.capabilities.includes("ax.tree")) return unsupported(c, t.label);
      const app = typeof a.app === "string" && a.app.trim() ? clip(a.app.trim(), 100) : undefined;
      if (app) { const no = nameGuard(c, t, app); if (no) return no; }
      const r = await act(c, t, "ax.tree", app ? { app } : {}, 45_000);
      if (!r.ok) return r.code === "not_found" ? { content: `No open app called "${app}" on ${t.label}. Open it with my_open first.`, isError: true, summary: tr(c.user.locale, "not found") } : failed(c, t, r);
      noteSnapshot(c.bot.id, t.id, r.result);
      const text = clip(String(r.result.text ?? ""), 40_000);
      return { content: `Controls of ${clip(String(r.result.app ?? "the app"), 80)} on ${t.label} (reading ${r.result.snapshotId}):\n${text || "(no controls reported)"}\nAct on one with my_ui_act and its reference; read again after acting to check the result.`, summary: clip(String(r.result.app ?? ""), 40) };
    }),
  },
  {
    spec: { name: "my_ui_act", description: "Act on one control of the user's Mac or Windows PC by its reference from your last my_ui_tree: press (button, menu item, link), set_value (fill a field with text), focus, toggle (checkbox, switch), select (list item, tab), expand (menu, drop-down). background: true acts without moving the pointer or needing the app in front. Never a password field (the user types it). Pressing a control that sends, pays, deletes or confirms asks the user first.", inputSchema: obj({ ref: str("The reference, e.g. @s1a2b3:e8"), action: { type: "string", enum: ["press", "set_value", "focus", "toggle", "select", "expand"] }, text: str("For set_value: the text to put in the field"), background: { type: "boolean", description: "Act without the pointer and without the app in front" }, device: DEVICE }, ["ref", "action"]) },
    group: "mycomputer", activity: "computer", label: "Using an app on your computer", outside: true, audited: true, gate: actGate,
    detail: (a) => (typeof a.action === "string" ? a.action : undefined),
    run: async (a, c) => inSession(c, a, "session-only", "", async (t) => {
      if (t.kind === "phone" || !liveDevice(c.user.id, t.id)?.capabilities.includes("ax.act")) return unsupported(c, t.label);
      const ref = String(a.ref ?? "").trim();
      const el = knownElement(c.bot.id, t.id, ref);
      if (!el) return STALE;
      const action = String(a.action ?? "press");
      if (el.secure && action !== "focus") return { content: "That is a password field: you never fill it. Ask the user to type their password themselves (or use my_vault_fill for a saved login on its own site).", isError: true, summary: tr(c.user.locale, "password field") };
      const r = await act(c, t, "ax.act", { ref, action, ...(action === "set_value" ? { text: clip(String(a.text ?? ""), 2000) } : {}), background: a.background === true });
      if (!r.ok) return r.code === "stale_ref" ? STALE : failed(c, t, r);
      const how = a.background === true ? " (in the background)" : "";
      const did = action === "set_value" ? `Filled ${el.role} “${el.name}”` : `${action[0].toUpperCase()}${action.slice(1)} on ${el.role} “${el.name}”`;
      return { content: `${did}${how}. Read the app again with my_ui_tree to check the result (a dialog may have opened).`, summary: clip(el.name, 40) };
    }),
  },
];
