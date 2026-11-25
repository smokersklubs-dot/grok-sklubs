import { randomBytes } from "node:crypto";
import { APP_TREE_PY, type AppElement, type AppTreeAnswer } from "../apptree.js";
import { workspaceOf } from "../computer.js";
import { linuxExec } from "../linux.js";
import type { ToolSpec } from "../llm/types.js";
import { clip } from "../store.js";
import { committingKind } from "./bind.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L164 « lecteur d'applis par accessibilité » — the apps of the bot's own Linux computer, read and used by reference
 * through their accessibility tree (apptree.ts runs inside the computer). Linux computers only (tools.ts adds these
 * tools with the element tools). The browser's pages keep element_snapshot (more precise); these tools are for the other
 * windows: the text editor, the file manager, an app the bot installed, a file-chooser dialog box…
 *
 *  - app_windows: the apps that have a window, which window is in front, open dialog boxes.
 *  - app_tree: the controls of the app in front (or a named one), the dialog box in front listed first, each with a
 *    reference like x3f9a.12; a password field is listed but its text never read.
 *  - app_act: click / focus / set_text on one control BY REFERENCE. The computer finds it again (same app, same place,
 *    same role and name) or does nothing ("stale"). A password field is never filled. Clicking a control whose words
 *    commit something (send, pay, delete, publish, confirm…) asks the owner on a single-use card (the committing-click
 *    rule of bind.ts), from the words the COMPUTER reported, never from what the bot says.
 * Same locks as the other screen actions (tools.ts respectDriver: nothing while the user drives; turnlocks.ts).
 */
type Runner = (c: ToolContext, req: object, timeoutSec: number) => Promise<AppTreeAnswer>;
const defaultRunner: Runner = async (c, req, timeoutSec) => {
  const r = await linuxExec(c.bot.id, c.user.id, workspaceOf(c.bot.id), ["python3", "-c", APP_TREE_PY], timeoutSec, { input: JSON.stringify(req), maxBytes: 2_000_000, signal: c.signal });
  if (r.timedOut) return { error: "timeout" };
  try { return JSON.parse(r.stdout) as AppTreeAnswer; } catch { return { error: "failed", detail: clip(r.stderr || r.stdout, 200) }; }
};
let runner: Runner = defaultRunner;
/** Tests: a fake computer. */
export const setAppTreeRunner = (fn: Runner | null) => { runner = fn ?? defaultRunner; };

interface Reading { id: string; app: string; pid: number; elements: Map<number, AppElement>; at: number }
const readings = new Map<string, Reading>();
const MAX_READINGS = 500;
export const APP_REF = /^x([0-9a-f]{4})\.(\d{1,4})$/;
export const forgetAppReadings = () => readings.clear();

function remember(botId: string, r: AppTreeAnswer): Reading {
  let id = randomBytes(2).toString("hex");
  if (readings.get(botId)?.id === id) id = ((parseInt(id, 16) + 1) % 0x10000).toString(16).padStart(4, "0");
  const elements = new Map<number, AppElement>();
  (r.elements ?? []).forEach((e, i) => elements.set(i + 1, e));
  if (readings.size >= MAX_READINGS && !readings.has(botId)) readings.delete(readings.keys().next().value!);
  const reading = { id, app: clip(String(r.app ?? ""), 100), pid: Number(r.pid) || 0, elements, at: Date.now() };
  readings.set(botId, reading);
  return reading;
}

/** The element a reference names in the bot's latest reading, or why not. */
export function appElement(botId: string, ref: unknown): { reading: Reading; element: AppElement } | { error: string } {
  const m = APP_REF.exec(String(ref ?? "").trim());
  if (!m) return { error: `"${clip(String(ref ?? ""), 40)}" is not an app reference (they look like x3f9a.12). Read the app with app_tree first.` };
  const reading = readings.get(botId);
  if (!reading) return { error: "No app reading is current. Read the app with app_tree first." };
  if (reading.id !== m[1]) return { error: `That reference is from an older reading (x${m[1]}); the latest one is x${reading.id}. Use a reference from it, or read the app again with app_tree.` };
  const element = reading.elements.get(Number(m[2]));
  return element ? { reading, element } : { error: `There is no control ${clip(String(ref), 20)} in that reading.` };
}

const CLICKABLE = new Set(["push button", "toggle button", "check box", "radio button", "menu item", "check menu item", "radio menu item", "link", "list item", "page tab", "table cell", "toolbar button", "split button", "icon"]);
/** Whether clicking this control commits something (bind.ts committingKind on the reported words). */
export const committingAppClick = (el: Pick<AppElement, "role" | "name">, action: string) => (action === "click" && CLICKABLE.has(el.role) ? committingKind(el.name) : null);

const ERRORS: Record<string, string> = {
  no_atspi: "This computer was made from an older image without the accessibility reader (AT-SPI). Use screen_view and screen_click for now; the reader comes with the next computer image.",
  timeout: "The app did not answer in time (it may be busy or frozen). Look with screen_view, then try again.",
  no_app: "No app window is open on your computer. Open the app first (for example from the shell: `mousepad &`), then read it.",
  failed: "The accessibility reader failed on this computer. Use screen_view and screen_click instead.",
};
const problem = (r: AppTreeAnswer, what: string): ToolOutput => ({ content: `${ERRORS[r.error ?? "failed"] ?? `${what}: ${r.error}`}${r.detail && r.error === "failed" ? ` (${clip(r.detail, 160)})` : ""}`, isError: true, summary: clip(r.error ?? "failed", 40) });
const STARTED = "The accessibility reader was just switched on: apps opened before now cannot be read. Close and reopen them (Chromium pages: use element_snapshot).";

function line(id: string, n: number, e: AppElement): string {
  const st = [e.focused ? "focused" : "", e.checked ? "checked" : "", e.selected ? "selected" : "", e.expanded ? "expanded" : "", e.disabled ? "disabled" : "", e.secure ? "password field: never read or filled" : ""].filter(Boolean);
  const value = e.value !== undefined && !e.secure ? ` value="${clip(e.value.replace(/\s+/g, " "), 120)}"` : "";
  return `[x${id}.${n}] ${e.role} "${clip(e.name, 100)}"${value}${st.length ? ` (${st.join(", ")})` : ""}`;
}

/** The reading in words, window by window (the window in front first, as the computer sent them). */
export function readingText(reading: Reading, r: AppTreeAnswer): string {
  const front = (r.windows ?? []).find((w) => w.active);
  const out = [`Controls of ${reading.app || "the app"} (reading x${reading.id})${front ? `, window in front: “${clip(front.title, 100)}”${front.modal ? " (a dialog box: answer it first)" : ""}` : ""}:`];
  let window = "";
  for (const [n, e] of reading.elements) {
    if (e.window !== window) { window = e.window; out.push(`— window “${clip(window, 100)}”`); }
    out.push(line(reading.id, n, e));
  }
  if (!reading.elements.size) out.push("(no controls reported: the app may draw its own screen — use screen_view and screen_click)");
  if (r.truncated) out.push("(more controls than the limit: ask app_tree with a higher limit, up to 300)");
  out.push("Act on one with app_act and its reference; read the app again afterwards to check the result. For a page in the browser, element_snapshot is more precise.");
  return out.join("\n");
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

export const appTreeTools: BuiltinTool[] = [
  {
    spec: { name: "app_windows", description: "List the apps that have a window open on your own computer, which window is in front, and open dialog boxes (through the accessibility tree, AT-SPI). Then read one with app_tree.", inputSchema: obj({}) },
    activity: "computer", label: "Listing the apps' windows", outside: true,
    run: async (_a, c) => {
      const r = await runner(c, { op: "windows" }, 30);
      if (!r.ok) return problem(r, "Listing the windows failed");
      const apps = r.apps ?? [];
      const lines = apps.map((p) => `- ${clip(p.app || "?", 60)}: ${p.windows.map((w) => `“${clip(w.title || w.role, 80)}”${w.active ? " (in front)" : ""}${w.modal ? " (dialog box)" : ""}`).join(", ")}`);
      return { content: [r.started ? STARTED : "", apps.length ? `Apps with a window on your computer:\n${lines.join("\n")}` : "No app has a window open on your computer (or none can be read)."].filter(Boolean).join("\n"), summary: `${apps.length}` };
    },
  },
  {
    spec: { name: "app_tree", description: "Read the controls (buttons, fields, menus, lists, boxes…) of an app on your own computer through its accessibility tree: each control gets a reference like x3f9a.12 for app_act, with its text for a field (never a password field's). The window in front (an open dialog box) comes first. More reliable than clicking at pixels for an app's forms, menus and dialog boxes. Without app: the app in front.", inputSchema: obj({ app: str("The app's name or a word of its window title (e.g. \"mousepad\"); default: the app in front"), limit: { type: "integer", description: "At most this many controls (default 150, max 300)" } }) },
    activity: "reading", label: "Reading an app's controls", outside: true,
    run: async (a, c) => {
      const app = typeof a.app === "string" && a.app.trim() ? clip(a.app.trim(), 100) : undefined;
      const r = await runner(c, { op: "tree", ...(app ? { app } : {}), limit: Math.min(300, Math.max(1, Number(a.limit) || 150)) }, 45);
      if (!r.ok) return r.error === "not_found" ? { content: `No open app called "${app}" on your computer. List them with app_windows.${r.started ? ` ${STARTED}` : ""}`, isError: true, summary: "not found" } : problem({ ...r, error: r.error ?? "failed" }, "Reading the app failed");
      const reading = remember(c.bot.id, r);
      return { content: `${r.started ? `${STARTED}\n` : ""}${readingText(reading, r)}`, summary: `${reading.elements.size} · ${clip(reading.app, 40)}` };
    },
  },
  {
    spec: { name: "app_act", description: "Act on one control of an app on your own computer by its reference from your latest app_tree: click (button, menu, menu item, tab, box), focus, or set_text (replace a field's text; read back to check). Nothing is done when the control changed since the reading (read again). Never a password field: the user types it. Clicking a control that sends, pays, deletes or confirms asks the user first.", inputSchema: obj({ ref: str("The reference, e.g. x3f9a.12"), action: { type: "string", enum: ["click", "focus", "set_text"] }, text: str("For set_text: the text to put in the field") }, ["ref", "action"]) },
    activity: "computer", label: "Using an app", outside: true, audited: true, detail: (a) => (typeof a.action === "string" ? a.action : undefined),
    gate: (a, ctx) => {
      const found = appElement(ctx.botId, a.ref);
      if ("error" in found) return null; // the tool refuses an unknown reference
      if (!committingAppClick(found.element, String(a.action ?? ""))) return null;
      return {
        key: "apptree: commit", strict: true, once: true, source: "Computer",
        vars: { label: clip(found.element.name, 80), app: clip(found.reading.app, 60) },
        title: "Allow {bot} to click “{label}” in {app} on its computer?", reason: "click “{label}” in {app}",
        note: "These words commit something (send, pay, delete, publish, confirm…): you are asked every time.",
      };
    },
    run: async (a, c) => {
      const found = appElement(c.bot.id, a.ref);
      if ("error" in found) return { content: found.error, isError: true, summary: "no such control" };
      const { reading, element: el } = found;
      const action = String(a.action ?? "");
      if (!["click", "focus", "set_text"].includes(action)) return { content: "action must be click, focus or set_text.", isError: true };
      if (el.secure && action !== "focus") return { content: "That is a password field: you never fill it. Ask the user to type their password themselves.", isError: true, summary: "password field" };
      const text = action === "set_text" ? clip(String(a.text ?? ""), 5000) : undefined;
      const r = await runner(c, { op: "act", pid: reading.pid, path: el.path, role: el.role, name: el.name, action, ...(text !== undefined ? { text } : {}) }, 30);
      const what = `${el.role} “${clip(el.name, 80)}” in ${reading.app || "the app"}`;
      if (r.stale) return { content: `That reference is out of date: ${r.stale}. Nothing was done, so it is safe to read the app again with app_tree and use a new reference.`, isError: true, summary: "stale reference" };
      if (!r.ok) {
        if (r.error === "no_action" || r.error === "refused") return { content: `The ${what} ${r.error === "no_action" ? "offers no action through accessibility" : "refused the action"}.${r.at ? ` It is at x=${r.at[0]}, y=${r.at[1]} on the screen: use screen_click there if a click is what you need.` : " Use screen_view and screen_click instead."}`, isError: true, summary: "not done" };
        if (r.error === "disabled") return { content: `The ${what} is disabled (greyed out): nothing was done.`, isError: true, summary: "disabled" };
        if (r.error === "not_editable") return { content: `The ${what} is not a field you can type into. Click it, or use screen_type after focusing it.`, isError: true, summary: "not a field" };
        if (r.error === "password") return { content: "That is a password field: you never fill it.", isError: true, summary: "password field" };
        if (r.error === "no_focus") return { content: `The ${what} cannot take the focus.`, isError: true, summary: "not done" };
        return problem(r, "The action failed");
      }
      const did = action === "set_text" ? `Put ${text!.length} characters into ${what}${r.verified ? " — verified" : r.verified === false ? " — NOT verified: the field shows something else" : ""}` : action === "focus" ? `Focused ${what}` : `Clicked ${what}${r.did && r.did !== "click" ? ` (its own action “${r.did}”)` : ""}`;
      return { content: `${did}. Read the app again with app_tree to check the result (a menu or a dialog box may have opened).`, summary: clip(el.name || el.role, 40) };
    },
  },
];
