import { setLive } from "./bus.js";
import { bots } from "./store.js";

/**
 * Who drives a bot's screen. While the user has its screen open in control mode, the bot's own screen actions
 * (clicks, typing, keys, scrolling, opening pages, typing a saved login) are refused: two hands on one mouse only
 * make a mess, and a login or payment the user is finishing must not be disturbed.
 *
 * The server decides this itself, from two signals:
 *  - live screens opened in control mode (vnc.ts counts their WebSockets: the truth while one is open);
 *  - a lease the viewer holds while in control mode (screenshot-based computers, which have no stream), renewed
 *    every 30 s and dropped when the user hands back. A viewer that vanishes without saying so lets it lapse.
 *
 * And the bot can ask for the user (ask_takeover): its turn waits until the user hands back, or a timeout.
 */
const sockets = new Map<string, number>();
const leases = new Map<string, number>();
const LEASE_MS = 75_000;
/**
 * L149 — the numbered lease: each control session of the viewer gets a number (epoch); a renewal names it and « Rendre la
 * main » releases that number only. A renewal that arrives after the hand-back (an old number) is refused, so it never
 * takes control again; a hand-back from an older session never ends a newer one. Old viewers without numbers still work.
 */
const epochs = new Map<string, number>();
let lastEpoch = 0;

export const DRIVING = "The user is driving your screen right now (they took control of it). Your screen actions are refused until they hand it back. Wait, or ask them in the chat; you can still look with screen_view.";

/** True while the user has this bot's screen in control mode. */
export function userDriving(botId: string): boolean {
  if ((sockets.get(botId) ?? 0) > 0) return true;
  const until = leases.get(botId);
  if (until && until > Date.now()) return true;
  if (until) leases.delete(botId);
  return false;
}

function announce(botId: string, before: boolean) {
  const now = userDriving(botId);
  if (now === before) return;
  const bot = bots.byId(botId);
  if (bot) setLive(bot.userId, botId, { driving: now });
}

/** A live screen was opened (or closed) in control mode. */
export function controlSocket(botId: string, open: boolean) {
  const before = userDriving(botId);
  const n = Math.max(0, (sockets.get(botId) ?? 0) + (open ? 1 : -1));
  if (n) sockets.set(botId, n); else sockets.delete(botId);
  announce(botId, before);
}

/** The viewer is in control mode (renewed while it stays there). */
export function holdControl(botId: string) {
  const before = userDriving(botId);
  leases.set(botId, Date.now() + LEASE_MS);
  announce(botId, before);
}

/** The user handed the screen back (`epoch`: the lease it ends; absent: any). Open control streams still count until they close. */
export function releaseControl(botId: string, epoch?: unknown) {
  if (typeof epoch === "number" && epochs.has(botId) && epochs.get(botId) !== epoch) return;
  const before = userDriving(botId);
  leases.delete(botId);
  epochs.delete(botId);
  announce(botId, before);
}

/**
 * POST /bots/:id/desktop/control (L149): `{ on: true }` takes a new numbered lease (answer `{ ok, epoch }`); `{ on: true,
 * epoch }` renews it — refused (`ok: false`) when that number is no longer the bot's lease (handed back, lapsed, or a
 * restart); `{ on: false, epoch? }` hands back.
 */
export function controlRequest(botId: string, body: Record<string, unknown>): { ok: boolean; epoch?: number } {
  if (body.on === false) { releaseControl(botId, body.epoch); return { ok: true }; }
  if (typeof body.epoch === "number") {
    const live = epochs.get(botId) === body.epoch && (leases.get(botId) ?? 0) > Date.now();
    if (!live) return { ok: false, epoch: body.epoch };
    holdControl(botId);
    return { ok: true, epoch: body.epoch };
  }
  holdControl(botId);
  const epoch = ++lastEpoch;
  epochs.set(botId, epoch);
  return { ok: true, epoch };
}

// ── The bot asks for the user and waits ──────────────────────────────────────
type Outcome = "done" | "timeout" | "stopped";
const waits = new Map<string, { botId: string; finish: (o: Outcome) => void }>();

/** How long a bot waits for the user to come back (30 minutes; TAKEOVER_TIMEOUT_MS overrides it, for tests). */
export const takeoverTimeoutMs = () => Number(process.env.TAKEOVER_TIMEOUT_MS) > 0 ? Number(process.env.TAKEOVER_TIMEOUT_MS) : 30 * 60_000;

export function waitForUser(takeoverId: string, botId: string, signal: AbortSignal): Promise<Outcome> {
  return new Promise((resolve) => {
    const finish = (o: Outcome) => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); waits.delete(takeoverId); resolve(o); };
    const onAbort = () => finish("stopped");
    const timer = setTimeout(() => finish("timeout"), takeoverTimeoutMs());
    if (signal.aborted) return finish("stopped");
    signal.addEventListener("abort", onAbort, { once: true });
    waits.set(takeoverId, { botId, finish });
  });
}

/** The user clicked "I'm done, hand it back". False when nothing waits any more (timed out, or a restart). */
export function finishTakeover(takeoverId: string, botId: string): boolean {
  const w = waits.get(takeoverId);
  if (!w || w.botId !== botId) return false;
  w.finish("done");
  return true;
}
