import { q } from "../db.js"; import { intlOf } from "../lang/index.js";
import { tr } from "../i18n.js";
import { modelLabel } from "../llm/index.js";
import { pushLater } from "../push.js";
import type { Engine, Locale, SubLimitNoticeAction } from "../shared.js";
import { activeTurns, audit, botQueue, bots, rows, users, type BotRecord } from "../store.js";
import { overBudget } from "../usage.js";
import { userTimezone } from "../usagecaps.js";
import { runAgain, type Trigger } from "./loop.js";
import { modelChain } from "./reliability.js";
import { probing, sweepProbes } from "./quotaprobe.js";

/**
 * Back to the subscription after its limit resets.
 *
 * A bot on a subscription engine (Claude Code for a Claude plan, Codex for a ChatGPT plan) whose turn hits the plan's
 * usage limit marks that engine of that ACCOUNT "limited until T" (subscription_limits, migration 15). T is what the tool
 * itself said in its own documented output — never an undocumented usage endpoint of the provider:
 *
 * - Claude Code: the `rate_limit_event` line of `--output-format stream-json`, documented as SDKRateLimitEvent
 *   (code.claude.com/docs/en/agent-sdk/typescript, "SDKRateLimitEvent": `rate_limit_info.status` "allowed" |
 *   "allowed_warning" | "rejected", `resetsAt?: number`). Checked in Claude Code 2.1.325 (the desktop image) / 2.1.326: the
 *   CLI fills `resetsAt` from the `anthropic-ratelimit-unified-reset` header, in epoch SECONDS, and adds `isUsingOverage`
 *   / `overageStatus` (usage credits in use: the turn is still served, so that is not a limit). Only "rejected" without
 *   overage is a limit; "allowed_warning" is a warning, never a failure. When no event came, the final `result` with
 *   `is_error` and the CLI's own words ("You've hit your … limit", "usage limit reached") counts, without a time.
 * - Codex: `codex exec --json` ends a failed turn with `turn.failed` / `error` carrying a message
 *   (developers.openai.com/codex/noninteractive: event types thread.started, turn.started, turn.completed, turn.failed,
 *   item.*, error). Its usage-limit message is UsageLimitReachedError's Display (openai/codex rust-v0.169.0,
 *   codex-rs/protocol/src/error.rs, retry_suffix / format_retry_timestamp): "You’ve hit your usage limit. … Try again at
 *   3:15 PM." on the same day, "… Try again at Nov 18th, 2026 3:15 PM." otherwise — in the computer's local time, which is
 *   Etc/UTC in the desktop image — or "Try again later." without a time. Same words in the 0.169.0 binary.
 *
 * Without a time, T is a conservative hour from now: then the bots go back to the subscription, and a new limit simply
 * marks it again. Until T, a new turn of a bot on that engine goes straight to the bot's first backup API model (one
 * notice per bot per window); with no backup (or no budget left for it) the work waits in the bot's durable queue
 * (bot_queue status 'limited', in its order) with a notice and "Me prévenir à la reprise" (on by default). At T the sweep
 * switches back: one notice per bot told, a push for those who asked, and the waiting work runs in order (usage caps and
 * "Pause" still apply when it runs). Never another login or account: one engine sign-in per computer, as always.
 *
 * Same idea as OpenMausBot's server/limit-failover.ts (Apache-2.0; ideas only, our own code), which also never rotates
 * to another login of the same subscription.
 */

/** No reset time from the tool: back to the subscription after this long (and looked at again then). */
export const DEFAULT_LIMIT_MS = 60 * 60_000;
/** A reset time given by the tool: a minute more, so the first turn after it does not land just before the reset. */
export const RESET_MARGIN_MS = 60_000;
/** A reset time further than this is not believed (a plan's longest window is 7 days). */
const MAX_AHEAD_MS = 8 * 86_400_000;
const SWEEP_MS = 30_000;

let clock: () => number = () => Date.now();
/** For tests: a fake clock (null puts the real one back). */
export const setLimitClock = (fn: (() => number) | null) => { clock = fn ?? (() => Date.now()); };
const nowMs = () => clock();

export const engineBrand = (engine: Engine) => (engine === "codex" ? "ChatGPT" : "Claude");
const engineOfRef = (ref: string | null | undefined): Engine | null => (!ref ? null : ref.startsWith("codex:") ? "codex" : ref.startsWith("claude-code:") ? "claude-code" : null);

// ── What the tools say ─────────────────────────────────────────────────────────
/** A limit the tool reported: when it resets (ms), if it said. */
export interface LimitHit { resetsAt: number | null }

/** An epoch the tool gave, in seconds or milliseconds, as milliseconds; null when it is not a usable time. */
function epochMs(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

/** Claude Code's rate_limit_info (see above): a limit only when "rejected" and no usage credits carry the turn. */
export function claudeLimitFrom(info: any): LimitHit | null {
  if (!info || typeof info !== "object" || info.status !== "rejected") return null;
  if (info.isUsingOverage === true || info.overageStatus === "allowed" || info.overageStatus === "allowed_warning") return null;
  return { resetsAt: epochMs(info.resetsAt) };
}

/** Claude Code's own words when a turn ends on the plan's limit (2.1.325: "You've hit your session limit · resets …"). */
export const CLAUDE_LIMIT_TEXT = /you(?:'|’)ve hit your (?:session |weekly |opus |sonnet |usage |five.hour )?limit|usage limit reached/i;
/** The old form "Claude AI usage limit reached|<epoch seconds>" carried the time after the bar. */
export function claudeLimitFromText(text: string): LimitHit | null {
  if (!CLAUDE_LIMIT_TEXT.test(text)) return null;
  const m = /usage limit reached\|(\d{9,13})/i.exec(text);
  return { resetsAt: m ? epochMs(m[1]) : null };
}

/** Codex's usage-limit message (see above). */
export const CODEX_LIMIT_TEXT = /you(?:'|’)ve hit your usage limit|usage limit reached|you(?:'|’)re out of credits|workspace is out of credits|hit your spend cap/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The reset time in a Codex message, read in UTC (the computer's time zone); null when there is none or it is unreadable. */
export function codexLimitFrom(message: string, now = nowMs()): LimitHit | null {
  if (!CODEX_LIMIT_TEXT.test(message)) return null;
  const hm = (h: string, m: string, ap: string) => ((Number(h) % 12) + (/pm/i.test(ap) ? 12 : 0)) * 3_600_000 + Number(m) * 60_000;
  const full = /try again at ([A-Za-z]{3})\w* (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? (\d{1,2}):(\d{2}) ?([AP]M)/i.exec(message);
  if (full) {
    const month = MONTHS.indexOf(full[1].toLowerCase());
    if (month >= 0) return { resetsAt: Date.UTC(Number(full[3]), month, Number(full[2])) + hm(full[4], full[5], full[6]) };
  }
  const time = /try again at (\d{1,2}):(\d{2}) ?([AP]M)/i.exec(message);
  if (time) {
    const d = new Date(now);
    return { resetsAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + hm(time[1], time[2], time[3]) };
  }
  const rel = /try again in (\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)\b/i.exec(message);
  if (rel) {
    const unit = rel[2].toLowerCase().startsWith("h") ? 3_600_000 : rel[2].toLowerCase().startsWith("m") ? 60_000 : 1000;
    return { resetsAt: now + Number(rel[1]) * unit };
  }
  return { resetsAt: null };
}

// ── The limits, per account and engine ─────────────────────────────────────────
interface LimitRow { user_id: string; engine: Engine; until: number; source: "event" | "default"; detected_at: number }
interface BotRow { user_id: string; engine: Engine; bot_id: string; generation: number | null; seq: number | null; notify: number; queued: number }

/**
 * The tool said the subscription is at its limit: the account's engine is "limited until T" (a later T from a new report
 * wins; an earlier one too, when the tool gave it). Returns T.
 */
export function noteEngineLimit(userId: string, engine: Engine, hit: LimitHit): number {
  const now = nowMs();
  const given = hit.resetsAt !== null && hit.resetsAt > now && hit.resetsAt < now + MAX_AHEAD_MS ? hit.resetsAt + RESET_MARGIN_MS : null;
  const until = given ?? now + DEFAULT_LIMIT_MS;
  const source = given !== null ? "event" : "default";
  const old = activeLimit(userId, engine);
  // A report without a time never shortens a time the tool gave for this window.
  const keep = old && old.source === "event" && source === "default" ? old.until : until;
  if (!old) q.run("DELETE FROM subscription_limit_bots WHERE user_id = ? AND engine = ?", userId, engine);
  q.run("INSERT INTO subscription_limits (user_id, engine, until, source, detected_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, engine) DO UPDATE SET until = excluded.until, source = excluded.source" + (old ? "" : ", detected_at = excluded.detected_at"),
    userId, engine, keep, keep === until ? source : old!.source, now);
  if (!old) audit(userId, "system", `${engineBrand(engine)} subscription at its usage limit until ${new Date(keep).toISOString()} (${source === "event" ? "time given by the tool" : "no time given: 1 hour"})`);
  scheduleSweep();
  return keep;
}

/** The account's engine at its limit now, or null. */
export function activeLimit(userId: string, engine: Engine): LimitRow | null {
  return q.get<LimitRow>("SELECT * FROM subscription_limits WHERE user_id = ? AND engine = ? AND until > ?", userId, engine, nowMs()) ?? null;
}

/** The bot runs on a subscription engine that is at its limit now: until when. */
export function subLimitFor(bot: Pick<BotRecord, "userId" | "model"> & { id?: string }): { until: number; engine: Engine } | null {
  const engine = engineOfRef(bot.model);
  const lim = engine ? activeLimit(bot.userId, engine) : null;
  if (lim && engine && "id" in bot && typeof bot.id === "string" && probing(bot.userId, engine, bot.id)) return null; // L60: the probe job runs on the subscription (quotaprobe.ts)
  return lim && engine ? { until: lim.until, engine } : null;
}

/** The backup API model a limited bot's turn goes to (the first of its chain), when there is one and budget for it. */
export function limitBackup(bot: BotRecord): string | undefined {
  const next = modelChain(bot).slice(1)[0];
  return next && !overBudget(bot.userId) ? next : undefined;
}

/** The time a notice shows: HH:MM in the user's time zone, with the day when it is not today. */
export function untilText(userId: string, locale: Locale | undefined, until: number): string {
  const tz = userTimezone(userId);
  const lang = intlOf(locale);
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const hm = new Intl.DateTimeFormat(lang, { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(until);
  if (day(until) === day(nowMs())) return hm;
  return `${new Intl.DateTimeFormat(lang, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(until)} ${hm}`;
}

const botRow = (userId: string, engine: Engine, botId: string) =>
  q.get<BotRow>("SELECT * FROM subscription_limit_bots WHERE user_id = ? AND engine = ? AND bot_id = ?", userId, engine, botId) ?? null;
function markBot(bot: BotRecord, engine: Engine, seq: number | null, queued: boolean) {
  q.run(`INSERT INTO subscription_limit_bots (user_id, engine, bot_id, generation, seq, notify, queued, at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, engine, bot_id) DO UPDATE SET generation = COALESCE(excluded.generation, generation), seq = COALESCE(excluded.seq, seq), queued = MAX(queued, excluded.queued)`,
    bot.userId, engine, bot.id, seq === null ? null : bot.generation, seq, queued ? 1 : 0, nowMs());
}

/**
 * A turn of a limited bot goes to its backup model: "Ton abonnement Claude est à sa limite jusqu'à HH:MM : je passe par
 * {modèle}." — once per bot per limit window.
 */
export function noteLimitFallback(bot: BotRecord, limit: { until: number; engine: Engine }, backup: string) {
  if (botRow(bot.userId, limit.engine, bot.id)) return;
  const loc = users.localeOf(bot.userId);
  const row = rows.append(bot, { kind: "notice", tone: "info", text: tr(loc, "Your {brand} subscription is at its limit until {time}: I am using {model}.", { brand: engineBrand(limit.engine), time: untilText(bot.userId, loc, limit.until), model: modelLabel(backup, bot.userId) }) });
  markBot(bot, limit.engine, row.seq, false);
}

/** What the backup model is told at the top of a limited turn. */
export const limitNote = (limit: { until: number; engine: Engine }) =>
  `[System: your ${engineBrand(limit.engine)} subscription (${limit.engine === "codex" ? "Codex" : "Claude Code"}) is at its usage limit until ${new Date(limit.until).toISOString().slice(0, 16).replace("T", " ")} UTC, so this turn runs on a backup model: you, with your own tools. Its own session is not available to you.`;

/** The notice that work waits for the subscription (once per bot per window), with "Me prévenir à la reprise". */
function noteWaiting(bot: BotRecord, engine: Engine, until: number, thread: number) {
  const known = botRow(bot.userId, engine, bot.id);
  const shown = known?.seq != null && known.generation === bot.generation ? rows.get(bot.id, known.generation, known.seq) : null;
  if (shown?.body.kind === "notice" && shown.body.action?.kind === "sublimit") { markBot(bot, engine, null, true); return; }
  const loc = users.localeOf(bot.userId);
  const action: SubLimitNoticeAction = { kind: "sublimit", engine, until, notify: known ? known.notify === 1 : true, status: "waiting" };
  const row = rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "Your {brand} subscription is at its limit until {time}. I have no backup model, so your work waits here and I will pick it up as soon as the subscription is back.", { brand: engineBrand(engine), time: untilText(bot.userId, loc, until) }), action }, thread || undefined);
  markBot(bot, engine, row.seq, true);
  bots.announce(bot);
}

const threadOf = (t: Trigger) => (t.kind === "user" || t.kind === "system" ? t.thread ?? 0 : 0);

/**
 * Before a queued job of a limited bot starts (loop.ts runQueued): with a backup model the turn runs (it goes straight to
 * the backup, loop.ts); without one, the job waits for the subscription (bot_queue 'limited') and the bot says so. A
 * resumed approval goes on (it runs on the model it paused on). Returns whether the job was set aside.
 */
export function holdForLimit(id: number | null, bot: BotRecord | null, trigger: Trigger): boolean {
  if (id === null || !bot || bot.kind !== "agent" || trigger.kind === "resume") return false;
  const limit = subLimitFor(bot);
  if (!limit || limitBackup(bot)) return false;
  botQueue.limit(id);
  noteWaiting(bot, limit.engine, limit.until, threadOf(trigger));
  return true;
}

/**
 * The limit was hit during this job's turn and there is no backup model: the job waits for the subscription. When the
 * tool already did or said something, what waits is a continuation in its place (never the same work twice).
 */
export function waitForSubscription(bot: BotRecord, jobId: number | undefined, trigger: Trigger, thread: number): boolean {
  const limit = subLimitFor(bot);
  if (!limit) return false;
  if (jobId !== undefined) {
    q.tx(() => {
      botQueue.replace(jobId, { ...trigger, continuation: "quota" });
      botQueue.limit(jobId);
      activeTurns.end(bot.id);
    });
  }
  noteWaiting(bot, limit.engine, limit.until, thread);
  return jobId !== undefined;
}

/** "Me prévenir à la reprise" under a waiting notice: on or off. False when the row is not such a notice. */
export function setLimitNotify(bot: BotRecord, seq: number, notify: boolean): boolean {
  const row = rows.get(bot.id, bot.generation, seq);
  if (row?.body.kind !== "notice" || row.body.action?.kind !== "sublimit") return false;
  const action = row.body.action;
  if (action.status !== "waiting") return false;
  q.run("UPDATE subscription_limit_bots SET notify = ? WHERE user_id = ? AND engine = ? AND bot_id = ?", notify ? 1 : 0, bot.userId, action.engine, bot.id);
  rows.rewrite(bot, row.generation, seq, { ...row.body, action: { ...action, notify } });
  return true;
}

// ── At T: back to the subscription ─────────────────────────────────────────────
/**
 * Every limit whose time has come is lifted: each bot that was told gets "Ton abonnement Claude est de nouveau
 * disponible." (and a push when it asked to be told), and work waiting for a subscription that is no longer limited runs,
 * in its order. Returns how many limits were lifted. Called every 30 s and at start-up; tests call it with a fake clock.
 */
export function sweepLimits(): number {
  const now = nowMs();
  const due = q.all<LimitRow>("SELECT * FROM subscription_limits WHERE until <= ?", now);
  for (const lim of due) {
    const told = q.all<BotRow>("SELECT * FROM subscription_limit_bots WHERE user_id = ? AND engine = ?", lim.user_id, lim.engine);
    q.run("DELETE FROM subscription_limit_bots WHERE user_id = ? AND engine = ?", lim.user_id, lim.engine);
    q.run("DELETE FROM subscription_limits WHERE user_id = ? AND engine = ?", lim.user_id, lim.engine);
    const loc = users.localeOf(lim.user_id);
    const brand = engineBrand(lim.engine);
    for (const t of told) {
      const bot = bots.byId(t.bot_id);
      if (!bot) continue;
      if (t.seq !== null && t.generation !== null) {
        const row = rows.get(bot.id, t.generation, t.seq);
        if (row?.body.kind === "notice" && row.body.action?.kind === "sublimit") rows.rewrite(bot, row.generation, t.seq, { ...row.body, action: { ...row.body.action, status: "back" } });
      }
      const waiting = botQueue.limitedFor(bot.id).length > 0;
      const text = tr(loc, waiting ? "Your {brand} subscription is available again. I am picking up what was waiting." : "Your {brand} subscription is available again.", { brand });
      rows.append(bot, { kind: "notice", tone: "info", text });
      if (t.notify === 1 && t.queued === 1) pushLater(lim.user_id, { kind: "reply", title: bot.name, body: text, botId: bot.id });
    }
    audit(lim.user_id, "system", `${brand} subscription available again: bots are back on it`);
  }
  releaseWaiting();
  return due.length;
}

/** L60 (quotaprobe.ts): a probe went through, so the account's engine is back now: lifted with the usual notices, and what waited runs. */
export function liftLimit(userId: string, engine: Engine): void {
  q.run("UPDATE subscription_limits SET until = ? WHERE user_id = ? AND engine = ?", nowMs(), userId, engine);
  sweepLimits();
}

/** Work waiting for a subscription runs again, for every bot whose engine is no longer limited (or that left it). */
function releaseWaiting() {
  for (const { bot_id } of botQueue.limitedBots()) {
    const bot = bots.byId(bot_id);
    if (!bot) continue;
    if (subLimitFor(bot) && !limitBackup(bot)) continue;
    const list = botQueue.limitedFor(bot_id);
    for (const r of list) botQueue.unlimit(r.id);
    runAgain(bot_id, list);
    bots.announce(bot);
  }
}

let timer: NodeJS.Timeout | null = null;
let next: NodeJS.Timeout | null = null;
/** The sweep, every 30 s, plus one timer at the earliest T (started with the server). */
export function startLimitWatch() {
  if (timer) return;
  const run = () => { try { sweepLimits(); sweepProbes(nowMs(), runAgain, liftLimit); } catch (err) { console.error("[subscription limits]", err); } }; // L60 probes (quotaprobe.ts)
  run();
  timer = setInterval(run, SWEEP_MS);
  timer.unref?.();
  scheduleSweep();
}
function scheduleSweep() {
  if (!timer) return;
  const first = q.get<{ until: number | null }>("SELECT MIN(until) AS until FROM subscription_limits")?.until;
  if (next) clearTimeout(next);
  next = null;
  if (!first) return;
  next = setTimeout(() => { next = null; try { sweepLimits(); } catch (err) { console.error("[subscription limits]", err); } scheduleSweep(); }, Math.max(1000, Math.min(first - nowMs() + 500, 2 ** 31 - 1)));
  next.unref?.();
}
