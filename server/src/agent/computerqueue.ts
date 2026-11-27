import { setLive } from "../bus.js"; import type { Locale } from "../shared.js";
import { tr } from "../i18n.js";
import { endForHandover, heldBack, holderIdleMs, liveDevice, stoppedAt, type RelayResult } from "../relay.js";
import { waitText } from "../sharedqueue.js";
import { bots, rows, type BotRecord } from "../store.js";
import type { ToolContext } from "./tools.js";

/**
 * One computer for all the bots of an account (computershare.ts): when bot B needs a computer that bot A drives.
 *
 *  - A has been quiet for HANDOVER.idleMs (no request under way, none sent or answered since) → A hands over: a relay
 *    1.7 (capability "session.handover") does it itself when B's session.start arrives (and asks on its screen unless
 *    « all my bots » or « always this bot » covers B); an older relay gets session.end for A from Sklubot first, then
 *    B's session.start (asked there per bot, as before).
 *  - A is working → B waits in line (first come, first served, one line per computer) and says so in its chat
 *    after HANDOVER.announceAfterMs: « En attente de l'ordinateur …, utilisé par A ». The line is rewritten when B gets
 *    it, or when B gives up after HANDOVER.maxWaitMs.
 *
 * Never two bots driving at once: the relay keeps one session (busy otherwise), and only the first in line asks.
 * Stop wins everything: Stop in Sklubot (relay.ts stoppedAt) or on the computer (locked), and B's own Stop (its turn's
 * signal), end the wait at once. A bot the owner stopped (heldBack) does not queue.
 */
export const HANDOVER = {
  /** A bot quiet this long on the computer lets the next one take it. Same value as the relay's (relay-core.js HANDOVER_IDLE_MS). */
  idleMs: 20_000,
  /** How often a waiting bot looks again. */
  pollMs: 1_000,
  /** After this, the waiting bot stops and says so (it can be asked again). */
  maxWaitMs: 10 * 60_000,
  /** Short hand-overs stay silent in the chat. */
  announceAfterMs: 2_000,
  /** Busy answers from the computer itself (the holder started again in between) tolerated before giving up. */
  maxBusyRetries: 20,
};

/** Bots waiting for each computer, in order (in memory: a restart empties the lines, the turns end with it). */
const lines = new Map<string, string[]>();
export const waitingFor = (deviceId: string) => [...(lines.get(deviceId) ?? [])];

type Outcome = { ok: true } | { ok: false; code: "offline" | "locked" | "busy" | "stopped" | "held"; message: string };

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
  signal?.addEventListener("abort", done, { once: true });
});

/** The line in the waiting bot's chat: written once the wait gets long, kept current, closed at the end. */
class WaitLine {
  private seq: number | null = null;
  private generation = 0;
  private last = "";
  constructor(private readonly bot: BotRecord, private readonly locale: Locale, private readonly device: string, private readonly startedAt: number) {}
  waiting(holder: string, ahead: string[], t: number) {
    if (t - this.startedAt < HANDOVER.announceAfterMs) return;
    const text = ahead.length
      ? tr(this.locale, "Waiting for the computer {device}, used by {holder}: number {position} in line, behind {ahead}. I will go on by myself as soon as it is free.", { device: this.device, holder, position: ahead.length + 1, ahead: ahead.join(", ") })
      : tr(this.locale, "Waiting for the computer {device}, used by {holder}. I will go on by myself as soon as it is free.", { device: this.device, holder });
    if (text === this.last) return;
    this.last = text;
    try {
      if (this.seq === null) { const row = rows.append(this.bot, { kind: "notice", tone: "info", text }); this.seq = row.seq; this.generation = row.generation; }
      else rows.rewrite(this.bot, this.generation, this.seq, { kind: "notice", tone: "info", text });
    } catch { /* the bot was deleted while it waited */ }
  }
  close(english: string, tone: "info" | "warn", t: number) {
    if (this.seq === null) return;
    try { rows.rewrite(this.bot, this.generation, this.seq, { kind: "notice", tone, text: tr(this.locale, english, { device: this.device, time: waitText(t - this.startedAt, this.locale) }) }); } catch { /* gone */ }
  }
}

/**
 * Waits until this bot may ask the computer for a control session (or already has it). Returns at once when the
 * computer is free, or held by this bot.
 */
export async function waitForComputer(c: ToolContext, t: { id: string; label: string }, clock: () => number = Date.now): Promise<Outcome> {
  const userId = c.user.id, botId = c.bot.id;
  const first = liveDevice(userId, t.id);
  if (!first) return { ok: false, code: "offline", message: "" };
  if (!first.session || first.session.botId === botId) return { ok: true };
  const startedAt = clock();
  const line = lines.get(t.id) ?? [];
  if (!line.includes(botId)) line.push(botId);
  lines.set(t.id, line);
  const notice = new WaitLine(c.bot, c.user.locale, t.label, startedAt);
  const nameOf = (id: string) => bots.byId(id)?.name ?? tr(c.user.locale, "another bot");
  let result: Outcome | null = null;
  try {
    for (;;) {
      if (c.signal?.aborted) { result = { ok: false, code: "stopped", message: "" }; break; }
      const live = liveDevice(userId, t.id);
      if (!live) { result = { ok: false, code: "offline", message: "" }; break; }
      if (live.locked) { result = { ok: false, code: "locked", message: "" }; break; }
      if (stoppedAt(t.id) >= startedAt) { result = { ok: false, code: "stopped", message: "the user pressed Stop for this computer" }; break; }
      if (heldBack(botId, t.id)) { result = { ok: false, code: "held", message: "" }; break; }
      const order = lines.get(t.id) ?? [];
      const ahead = order.slice(0, Math.max(0, order.indexOf(botId)));
      const holder = live.session;
      if (!holder || holder.botId === botId) { if (!ahead.length) { result = { ok: true }; break; } }
      else if (!ahead.length && (holderIdleMs(t.id) ?? 0) >= HANDOVER.idleMs) {
        // A relay 1.7 hands over by itself on session.start; an older one needs Sklubot to end the idle session first.
        if (live.capabilities.includes("session.handover") || await endForHandover(t.id, { id: botId, name: c.bot.name })) { result = { ok: true }; break; }
      }
      if (clock() - startedAt >= HANDOVER.maxWaitMs) { result = { ok: false, code: "busy", message: "" }; break; }
      const holderName = holder ? holder.botName : ahead.length ? nameOf(ahead[0]) : tr(c.user.locale, "another bot");
      notice.waiting(holderName, ahead.map(nameOf), clock());
      setLive(userId, botId, { running: true, activity: { kind: "waiting", since: startedAt }, awaiting: { reason: tr(c.user.locale, "waiting for {device}, used by {holder}", { device: t.label, holder: holderName }), since: startedAt } });
      await sleep(HANDOVER.pollMs, c.signal);
    }
  } finally {
    const rest = (lines.get(t.id) ?? []).filter((id) => id !== botId);
    if (rest.length) lines.set(t.id, rest); else lines.delete(t.id);
  }
  const end = clock();
  if (result.ok) notice.close("I waited {time} for the computer {device}; it is my turn now, I am going on.", "info", end);
  else if (result.code === "busy") notice.close("The computer {device} was still in use after {time}: I stopped waiting. Ask me again in a moment.", "warn", end);
  else notice.close("I stopped waiting for the computer {device}.", "info", end);
  return result;
}

/**
 * Wait for the computer, then open the session; a `busy` from the computer itself (the holder started working again in
 * between, or a command of its runs) sends the bot back to waiting, a bounded number of times.
 */
export async function takeComputer(c: ToolContext, t: { id: string; label: string }, start: () => Promise<RelayResult>, clock: () => number = Date.now): Promise<RelayResult> {
  for (let tries = 0; ; tries++) {
    const w = await waitForComputer(c, t, clock);
    if (!w.ok) return { ok: false, code: w.code === "held" ? "stopped" : w.code, message: w.message };
    const r = await start();
    if (r.ok || r.code !== "busy" || tries >= HANDOVER.maxBusyRetries) return r;
    await sleep(Math.min(HANDOVER.idleMs, Math.max(HANDOVER.pollMs, r.retryAfterMs ?? HANDOVER.pollMs)), c.signal);
  }
}
