/**
 * Lanes (agent/lanes.ts): when a bot runs several tasks at once, two of them must never change the same thing at the
 * same time. Each shared resource has at most one holder, the lane (a turn in one thread) that first used it; it keeps it
 * until its turn ends, so a run of clicks or edits is never interleaved with another task's.
 *   - the bot's own Linux screen and browser: one task drives it, the others wait or do something that needs no screen;
 *   - the owner's computer screen (my_* control tools): the same;
 *   - a file of the bot's library, a published page, a file on the owner's computer: one writer at a time.
 * A task that needs a resource another holds waits for it, at most LOCK_WAIT_MS (its live state says "waits for the
 * other task"); after that the tool answers with a plain refusal and the model carries on with something else. A wait is
 * always bounded, so two tasks can never block each other for good. Reading a file or a web page needs no lock.
 *
 * The one-browser-call-at-a-time idea comes from OpenMausBot (server/browser-lane.ts, Apache-2.0); this module is
 * Sklubot's own code (a lease per lane instead of a lane per call).
 */
import { laneKey } from "../store.js";

/** The bot's own screen and browser: looking at it counts too (another task's page would be misleading). */
export const SCREEN_TOOLS = new Set(["screen_view", "screen_click", "screen_type", "screen_key", "screen_scroll", "screen_drag", "browser_open", "browser_tabs", "browser_tab", "browser_dialog", "page_read", "element_snapshot", "element_click", "element_type", "element_select", "element_fill", "element_hover", "element_upload", "browser_wait", "browser_console", "browser_network", "vault_type", "card_fill", "email_code_type", "totp_code", "design_reference_layout"]);
/** Control of the owner's computer screen (mycomputer.ts). */
export const MY_SCREEN_TOOLS = new Set(["my_screen", "my_point", "my_click", "my_drag", "my_scroll", "my_type", "my_key", "my_open", "my_window_focus", "my_vault_fill"]);

const norm = (s: unknown) => String(s ?? "").trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/{2,}/g, "/").toLowerCase();

/** The shared resources a tool call changes or drives, as keys (empty: none). */
export function resourcesOf(name: string, input: Record<string, unknown>): string[] {
  if (SCREEN_TOOLS.has(name)) return ["screen"];
  if (MY_SCREEN_TOOLS.has(name)) return ["my-screen"];
  switch (name) {
    case "file_save": return [`file:${norm(input.filename)}`];
    case "page_publish": case "page_edit": return [`page:${norm(input.name)}`];
    case "my_file_write": case "my_file_trash": return [`my-file:${norm(input.device)}:${norm(input.folder)}:${norm(input.path)}`];
    case "skill_save": return [`skill:${norm(input.name)}`];
    default: return [];
  }
}

interface Holder { lane: string; since: number }
const holders = new Map<string, Holder>();
const res = (botId: string, r: string) => `${botId}|${r}`;
let waitMs = Math.max(0, Number(process.env.LOCK_WAIT_SEC ?? 60) * 1000);
/** Tests only: how long a task waits for a resource before the tool refuses. */
export const setLockWait = (ms: number) => { waitMs = ms; };

/** The lane holding this resource of this bot, if another lane than `lane` does. */
export function heldByOther(botId: string, resource: string, lane: string): string | null {
  const h = holders.get(res(botId, resource));
  return h && h.lane !== lane ? h.lane : null;
}

/** What the model is told when the wait ran out. */
export function refusalText(resource: string): string {
  const what = resource === "screen" ? "your screen and browser" : resource === "my-screen" ? "the user's computer screen" : `"${resource.slice(resource.indexOf(":") + 1)}"`;
  return `Another task of yours (in another conversation) is using ${what} right now, so this was not done. Do something that does not need it meanwhile, or try again in a moment. Do not try to get around this.`;
}

/**
 * Takes every resource the call needs for this lane, waiting (bounded) for another lane to let go. Returns null when the
 * call may run, else the refusal for the model. `onWait` is told once when the call starts waiting.
 */
export async function acquire(botId: string, thread: number, name: string, input: Record<string, unknown>, o: { signal?: AbortSignal; onWait?: (resource: string) => void } = {}): Promise<string | null> {
  const lane = laneKey(botId, thread);
  const needed = resourcesOf(name, input);
  if (!needed.length) return null;
  const until = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const busy = needed.find((r) => heldByOther(botId, r, lane));
    if (!busy) break;
    if (Date.now() >= until || o.signal?.aborted) return refusalText(busy);
    if (!told) { told = true; o.onWait?.(busy); }
    await new Promise((r) => setTimeout(r, Math.min(250, Math.max(10, until - Date.now()))));
  }
  for (const r of needed) if (!holders.has(res(botId, r))) holders.set(res(botId, r), { lane, since: Date.now() });
  return null;
}

/** The lane's turn ended (or crashed): everything it held is free for the bot's other tasks. */
export function releaseLane(botId: string, thread: number) {
  const lane = laneKey(botId, thread);
  for (const [k, h] of holders) if (h.lane === lane) holders.delete(k);
}

/** What each lane of this bot holds now (for the live state and tests). */
export const heldBy = (botId: string): { resource: string; lane: string }[] => [...holders].filter(([k]) => k.startsWith(`${botId}|`)).map(([k, h]) => ({ resource: k.slice(botId.length + 1), lane: h.lane }));
