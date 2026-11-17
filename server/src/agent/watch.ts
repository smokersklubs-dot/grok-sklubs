import { getLive } from "../bus.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { modelLabel } from "../llm/index.js";
import { tr } from "../i18n.js";
import { pauses } from "../pauses.js";
import type { Engine, Locale, RowBody, WatchNoticeAction } from "../shared.js";
import { audit, bots, paused, rows, type BotRecord } from "../store.js";
import { goals } from "./goals.js";
import { checkpoints } from "./spend.js";

/**
 * The turn watch: what a person sees when a turn goes quiet, instead of a spinner that never ends.
 *
 * - First-reply rescue: a turn (subscription engine or API model) whose AI has sent nothing at all — no text, no thinking,
 *   no tool call, no progress — for FIRST_REPLY_RESCUE_SEC (20 s) gets one notice in its chat, "{bot} is not answering
 *   yet", with "Wait", "Switch AI for this message" (only when the bot's fallback chain has a next model: the turn stops
 *   and the same message goes on with it, told nothing was done yet) and, on a subscription, "Check the Claude / ChatGPT
 *   connection". The notice settles as soon as the AI's first output arrives. One per turn, never more.
 * - Stall notice: a turn with no progress at all for STALL_NOTICE_MIN (5 min) gets one notice "{bot} seems stuck for
 *   N min" with "Keep waiting" and "Stop and resume" (stopped, and a continuation queued, as the time-limit notice's
 *   Continue does). Progress is any event of the turn's stream, a tool call still running (a command, a background job,
 *   an office conversion, a screen action: work, not silence), and for a subscription turn the CPU its process uses in
 *   the bot's computer (sampled every ENGINE_CPU_SAMPLE_SEC, 15 s).
 * - A subscription turn whose process is gone from the computer while the turn still waits on it (a helper it left
 *   behind can hold its output open) is ended at once with a clear notice and Continue, not at the hard time limit.
 *
 * Legitimate waits are never silence: an approval or a question waiting for the user, the bot waiting for the user on
 * its screen or on one of their devices, a paused bot, a spend checkpoint, a goal waiting, a computer being started or
 * made room for, another bot being asked and waited for, the turn's own compaction. Each of these restarts the clock.
 *
 * Same ideas as OpenMausBot's first-reply rescue and turn watchdog (server/first-reply-rescue.ts, server/turn-watchdog.ts,
 * Apache-2.0): ideas only, this code is our own.
 */

/** Why the watch stopped a turn: the user chose "Stop and resume" under the stall notice. */
export class TurnStalled extends Error { constructor(readonly minutes: number) { super(`no progress for ${minutes} min`); this.name = "TurnStalled"; } }
/** Why the watch stopped a subscription turn: its process is gone from the bot's computer. */
export class EngineGone extends Error { constructor() { super("the subscription tool's process ended"); this.name = "EngineGone"; } }
/** Why one model call (or the engine's run) was stopped: the user moved this message to the next model. */
export class SwitchModel extends Error { constructor(readonly to: string) { super(`switched to ${to}`); this.name = "SwitchModel"; } }
export const isWatchStop = (reason: unknown): reason is TurnStalled | EngineGone => reason instanceof TurnStalled || reason instanceof EngineGone;

/** What one look at a subscription turn's process gives: gone, or alive with the CPU time its process tree used. */
export type EngineSample = { gone: true } | { gone: false; cpuMs: number };
type Sampler = (botId: string) => Promise<EngineSample | null>;
let sampler: Sampler | null = null;
/** engine.ts gives the way to look at a turn's process in its computer (the fake host's own in tests). */
export const setEngineSampler = (fn: Sampler | null) => { sampler = fn; };

/** Two looks in a row must find the process gone (a process that just ended normally is not "gone" mid-turn). */
const GONE_LOOKS = 2;

interface Watch {
  bot: BotRecord;
  locale: Locale;
  thread: number;
  generation: number;
  controller: AbortController;
  kind: "engine" | "api";
  engine: Engine | null;
  /** Since when nothing happened (an event, a running tool and a legitimate wait all move it). */
  quietSince: number;
  /** The AI has sent something in this turn. */
  output: boolean;
  /** Tool calls running now (by call id). */
  tools: Set<string>;
  /** Waits the turn declared itself (a computer starting, compaction). */
  waits: number;
  rescue: { seq: number; next?: string } | null;
  rescueDone: boolean;
  stall: { seq: number; minutes: number } | null;
  stallDone: boolean;
  timer: NodeJS.Timeout;
  /** A subscription turn's process is running in the computer (sampled meanwhile). */
  execing: boolean;
  nextSample: number;
  sampling: boolean;
  cpuMs: number | null;
  goneLooks: number;
  /** The current model call's (or engine run's) own stop, for "Switch AI". */
  callCtl: AbortController | null;
  switchTo: string | null;
  nextModel: () => string | undefined;
  waitsUser: () => boolean;
}

const watches = new Map<string, Watch>();

/** The handle a turn keeps to end its watch (endWatch). */
export interface WatchHandle { botId: string }

export interface WatchStart {
  bot: BotRecord;
  locale: Locale;
  controller: AbortController;
  kind: "engine" | "api";
  engine?: Engine | null;
  thread: number;
  /** The turn ended on something only the user can answer (a question card, a connect card). */
  waitsUser?: () => boolean;
}

/** How often a watch looks: a quarter of its shortest delay, between 20 ms and 1 s. */
function tickMs(): number {
  const delays = [config.firstReplyRescueMs, config.stallNoticeMs, config.engineSampleMs].filter((d) => d > 0);
  return Math.max(20, Math.min(1000, Math.min(...delays) / 4));
}

/** Starts watching a bot's turn (one per bot: a new one ends the old). */
export function watchTurn(o: WatchStart): WatchHandle {
  const old = watches.get(o.bot.id);
  if (old) finish(old);
  const now = Date.now();
  const w: Watch = {
    bot: o.bot, locale: o.locale, thread: o.thread, generation: o.bot.generation, controller: o.controller, kind: o.kind, engine: o.engine ?? null,
    quietSince: now, output: false, tools: new Set(), waits: 0, rescue: null, rescueDone: false, stall: null, stallDone: false,
    timer: setInterval(() => { try { tick(w); } catch (err) { console.error(`[watch ${o.bot.id}]`, err); } }, tickMs()),
    execing: false, nextSample: 0, sampling: false, cpuMs: null, goneLooks: 0, callCtl: null, switchTo: null,
    nextModel: () => undefined, waitsUser: o.waitsUser ?? (() => false),
  };
  w.timer.unref?.();
  watches.set(o.bot.id, w);
  return { botId: o.bot.id };
}

const current = (botId: string): Watch | null => watches.get(botId) ?? null;

/** The turn ended: its notices that still ask something are over. */
export function endWatch(h: WatchHandle | null) {
  const w = h ? watches.get(h.botId) : null;
  if (w) finish(w);
}

function finish(w: Watch) {
  clearInterval(w.timer);
  if (watches.get(w.bot.id) === w) watches.delete(w.bot.id);
  if (w.rescue && openStatus(w, w.rescue.seq)) setNotice(w, "silent", w.rescue.seq, "over");
  if (w.stall && openStatus(w, w.stall.seq)) setNotice(w, "stalled", w.stall.seq, "over");
}

/** The AI sent something (text, thinking, a tool call, a progress line): the turn has answered. */
export function watchOutput(botId: string) {
  const w = current(botId);
  if (!w) return;
  w.output = true;
  progress(w);
  if (w.rescue && openStatus(w, w.rescue.seq)) setNotice(w, "silent", w.rescue.seq, "settled");
}

/** Anything moved in the turn (any stream event, CPU used by its process, a tool ending). */
export function watchProgress(botId: string) {
  const w = current(botId);
  if (w) progress(w);
}

function progress(w: Watch) {
  w.quietSince = Date.now();
  if (w.stall && openStatus(w, w.stall.seq)) setNotice(w, "stalled", w.stall.seq, "settled");
}

/** A tool call started / ended: while one runs, the turn is working. */
export function watchTool(botId: string, callId: string, running: boolean) {
  const w = current(botId);
  if (!w) return;
  if (running) w.tools.add(callId); else w.tools.delete(callId);
  progress(w);
}
/** Every tool call of the turn is over (the engine's run ended). */
export function watchToolsDone(botId: string) { current(botId)?.tools.clear(); }

/** A wait the turn declares itself (its computer starting, a compaction): returns its end, safe to call twice. */
export function watchWait(botId: string): () => void {
  const w = current(botId);
  if (!w) return () => {};
  w.waits++;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    w.waits = Math.max(0, w.waits - 1);
    w.quietSince = Date.now();
  };
}

/** The turn now runs on an API model (a subscription turn handed over to a backup model). */
export function watchKind(botId: string, kind: "engine" | "api") {
  const w = current(botId);
  if (!w) return;
  w.kind = kind;
  if (kind === "api") { w.engine = null; w.execing = false; }
}

/** Where "Switch AI" would send this message now (the next model of the turn's chain), if anywhere. */
export function watchNextModel(botId: string, fn: () => string | undefined) {
  const w = current(botId);
  if (w) w.nextModel = fn;
}

/** A subscription turn's process starts / ends in the computer: it is looked at meanwhile. */
export function watchExec(botId: string, running: boolean) {
  const w = current(botId);
  if (!w) return;
  w.execing = running;
  w.cpuMs = null;
  w.goneLooks = 0;
  w.nextSample = Date.now() + config.engineSampleMs;
  if (running) w.quietSince = Date.now();
}

/**
 * The signal one model call (or one engine run) listens to: the turn's own stop, and "Switch AI" for this call only.
 * Without a watch, the turn's signal itself.
 */
export function callSignal(botId: string, turnSignal: AbortSignal): AbortSignal {
  const w = current(botId);
  if (!w) return turnSignal;
  w.callCtl = new AbortController();
  // Chosen while nothing was running (between two calls): this call stops at once.
  if (w.switchTo) w.callCtl.abort(new SwitchModel(w.switchTo));
  return AbortSignal.any([turnSignal, w.callCtl.signal]);
}

/** The model the user moved this message to, once (the caller moves on to it). */
export function takeSwitch(botId: string): string | null {
  const w = current(botId);
  if (!w?.switchTo) return null;
  const to = w.switchTo;
  w.switchTo = null;
  return to;
}

/** Whether nothing the turn waits on is the AI's own silence. */
function legitimateWait(w: Watch): boolean {
  if (w.waits > 0 || w.tools.size > 0) return true;
  const id = w.bot.id;
  const live = getLive(id);
  // An approval, the user's hand on the screen, an answer on one of their devices, another bot asked and waited for.
  if (live.awaiting || live.activity?.kind === "waiting") return true;
  if (paused.get(id) || checkpoints.pendingFor(id) || w.waitsUser()) return true;
  const bot = bots.byId(id);
  if (!bot || pauses.of(bot)) return true;
  return !!goals.activeFor(bot, w.thread)?.waiting;
}

function tick(w: Watch) {
  if (watches.get(w.bot.id) !== w) return;
  const now = Date.now();
  if (legitimateWait(w)) w.quietSince = now;
  const quiet = now - w.quietSince;
  if (!w.output && !w.rescueDone && config.firstReplyRescueMs > 0 && quiet >= config.firstReplyRescueMs) postRescue(w);
  if (!w.stallDone && config.stallNoticeMs > 0 && quiet >= config.stallNoticeMs) postStall(w);
  if (w.kind === "engine" && w.execing && sampler && !w.sampling && now >= w.nextSample) sample(w);
}

function sample(w: Watch) {
  w.sampling = true;
  const look = sampler!;
  void look(w.bot.id).catch(() => null).then((s) => {
    w.sampling = false;
    w.nextSample = Date.now() + config.engineSampleMs;
    if (watches.get(w.bot.id) !== w || !w.execing || !s || w.controller.signal.aborted) return;
    if (s.gone) {
      if (++w.goneLooks >= GONE_LOOKS) {
        audit(w.bot.userId, "system", `${w.bot.name}: the subscription tool's process ended while its turn still waited on it; turn stopped`, w.bot.id);
        w.controller.abort(new EngineGone());
      }
      return;
    }
    w.goneLooks = 0;
    // About 1 % of a core over the interval: a process that only waits for the network uses far less.
    if (w.cpuMs !== null && s.cpuMs - w.cpuMs >= Math.max(20, config.engineSampleMs / 100)) progress(w);
    w.cpuMs = s.cpuMs;
  });
}

// ── The notices ──────────────────────────────────────────────────────────────
const minutesOf = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function noticeText(w: Watch, which: "silent" | "stalled", status: WatchNoticeAction["status"], extra: { minutes?: number; next?: string }): string {
  const vars = { bot: w.bot.name, min: extra.minutes ?? 0, next: extra.next ?? "" };
  if (which === "silent") {
    if (status === "settled") return tr(w.locale, "{bot} started answering.", vars);
    if (status === "switched") return tr(w.locale, "{bot} was not answering: this message went to {next}.", vars);
    if (status === "over") return tr(w.locale, "{bot} was not answering.", vars);
    return tr(w.locale, "{bot} is not answering yet.", vars);
  }
  if (status === "settled") return tr(w.locale, "{bot} seemed stuck for {min} min, then moved again.", vars);
  if (status === "stopped") return tr(w.locale, "{bot} seemed stuck for {min} min: stopped, and picking the work back up.", vars);
  if (status === "over") return tr(w.locale, "{bot} seemed stuck for {min} min.", vars);
  return tr(w.locale, "{bot} seems stuck: nothing has moved for {min} min.", vars);
}

function postRescue(w: Watch) {
  w.rescueDone = true;
  const nextRef = w.nextModel();
  const next = nextRef ? modelLabel(nextRef, w.bot.userId) : undefined;
  const action: WatchNoticeAction = { kind: "watch", watch: "silent", status: "pending", ...(next ? { next } : {}), ...(w.kind === "engine" && w.engine ? { engine: w.engine } : {}) };
  const row = rows.append(w.bot, { kind: "notice", tone: "info", text: noticeText(w, "silent", "pending", { next }), action }, w.thread);
  w.rescue = { seq: row.seq, ...(nextRef ? { next: nextRef } : {}) };
}

function postStall(w: Watch) {
  w.stallDone = true;
  const minutes = minutesOf(config.stallNoticeMs);
  // The first-reply notice, if still asking, gives way: one set of buttons at a time.
  if (w.rescue && openStatus(w, w.rescue.seq)) setNotice(w, "silent", w.rescue.seq, "over");
  const row = rows.append(w.bot, { kind: "notice", tone: "warn", text: noticeText(w, "stalled", "pending", { minutes }), action: { kind: "watch", watch: "stalled", status: "pending", minutes } }, w.thread);
  w.stall = { seq: row.seq, minutes };
  audit(w.bot.userId, "system", `${w.bot.name}: no progress for ${minutes} min in the running turn`, w.bot.id);
}

/** The notice's action, when it still asks something (pending, or "waiting" for the user who chose to wait). */
function openStatus(w: Watch, seq: number): WatchNoticeAction | null {
  const a = actionOf(w.bot.id, w.generation, seq);
  return a && (a.status === "pending" || a.status === "waiting") ? a : null;
}
function actionOf(botId: string, generation: number, seq: number): WatchNoticeAction | null {
  const row = rows.get(botId, generation, seq);
  return row?.body.kind === "notice" && row.body.action?.kind === "watch" ? row.body.action : null;
}

function setNotice(w: Watch, which: "silent" | "stalled", seq: number, status: WatchNoticeAction["status"]) {
  const row = rows.get(w.bot.id, w.generation, seq);
  if (row?.body.kind !== "notice" || row.body.action?.kind !== "watch") return;
  const action: WatchNoticeAction = { ...row.body.action, status };
  const body: RowBody = { ...row.body, text: noticeText(w, which, status, { minutes: action.minutes, next: action.next }), action, tone: status === "pending" && which === "stalled" ? "warn" : "info" };
  rows.rewrite(w.bot, w.generation, seq, body);
}

/** Why a choice under a watch notice was refused (the route answers 409 with it). */
export class WatchChoiceRefused extends Error {}

/**
 * The user's choice under a watch notice: "wait" (both notices), "switch" (the first-reply notice: this message goes on
 * with the next model), "stop" (the stall notice: stopped, and a continuation queued by the turn's end, loop.ts).
 */
export function chooseWatch(bot: BotRecord, seq: number, choice: "wait" | "switch" | "stop") {
  const w = current(bot.id);
  const which = w?.rescue?.seq === seq ? "silent" : w?.stall?.seq === seq ? "stalled" : null;
  const action = w && which ? openStatus(w, seq) : null;
  if (!w || !which || !action) {
    const old = actionOf(bot.id, bot.generation, seq);
    if (old?.status === "pending" || old?.status === "waiting") {
      // A notice left over by a turn that is over (a restart, a race): it asks nothing any more.
      const row = rows.get(bot.id, bot.generation, seq)!;
      if (row.body.kind === "notice") rows.rewrite(bot, bot.generation, seq, { ...row.body, action: { ...old, status: "over" } });
    }
    throw new WatchChoiceRefused("This turn is over: there is nothing to choose here any more.");
  }
  if (choice === "wait") {
    if (action.status === "pending") setNotice(w, which, seq, "waiting");
    return;
  }
  if (choice === "switch") {
    if (which !== "silent") throw new WatchChoiceRefused("Switching AI is offered only while the bot has not answered yet.");
    if (w.output) throw new WatchChoiceRefused("The bot has started answering in the meantime.");
    const to = w.rescue?.next;
    if (!to) throw new WatchChoiceRefused("This bot has no other AI to switch to. Add a backup model in its settings.");
    w.switchTo = to;
    setNotice(w, "silent", seq, "switched");
    audit(bot.userId, "system", `${bot.name}: the user moved a message that got no answer to ${to}`, bot.id);
    w.callCtl?.abort(new SwitchModel(to));
    return;
  }
  if (which !== "stalled") throw new WatchChoiceRefused("Stop and resume is offered under the stall notice.");
  setNotice(w, "stalled", seq, "stopped");
  audit(bot.userId, "system", `${bot.name}: stopped after ${w.stall!.minutes} min without progress, at the user's request; picking the work back up`, bot.id);
  w.controller.abort(new TurnStalled(w.stall!.minutes));
}

/**
 * At start no turn runs: a watch notice still asking something belongs to a turn the restart ended. It is history now,
 * with no buttons.
 */
export function closeLeftOpenWatchNotices(): number {
  const open = q.all<{ bot_id: string; generation: number; seq: number }>(
    `SELECT bot_id, generation, seq FROM rows WHERE kind = 'notice' AND body LIKE '%"kind":"watch"%' AND (body LIKE '%"status":"pending"%' OR body LIKE '%"status":"waiting"%')`);
  let n = 0;
  for (const r of open) {
    const bot = bots.byId(r.bot_id);
    const row = bot ? rows.get(r.bot_id, r.generation, r.seq) : null;
    if (!bot || row?.body.kind !== "notice" || row.body.action?.kind !== "watch") continue;
    rows.rewrite(bot, r.generation, r.seq, { ...row.body, tone: "info", action: { ...row.body.action, status: "over" } });
    n++;
  }
  return n;
}

/** For tests: whether a bot's turn is being watched. */
export const watching = (botId: string) => watches.has(botId);
