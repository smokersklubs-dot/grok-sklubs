/**
 * Anti-loop limits for what bots write to each other: posts into a group chat (room_post) and bot-to-bot messages
 * (bot_message). MAX_HOPS (team.ts) already bounds one chain of answers; these limits catch what it cannot see — chains
 * restarted again and again by routines, goals or watches, the same text bounced between bots, a bot that keeps talking
 * to a user who does not answer. Idea from OpenMausBot's room-post-budget (Apache-2.0, ideas only; own code).
 *
 * Rules, checked in this order (the first that applies refuses the post):
 * - breaker   — `BOT_LOOP_BREAKER` (6) bot posts in a row in one room (or between the same two bots) with no human message
 *               in between: the room's breaker opens and every further bot post there is refused until a human writes.
 *               The room gets one line saying so (the caller posts it: `opened` is true on the refusal that opens it).
 * - escalate  — rooms only: a bot that already addressed the user `BOT_LOOP_ESCALATE` (2) times in that room (a post that
 *               mentions no other member, so it wakes nobody) without a human answer stops posting there and waits.
 *               Counted per bot, so several bots each answering the user's question once is fine.
 * - duplicate — the same or nearly the same text (normalized: case, accents, punctuation and @mentions ignored; or ≥85 %
 *               of the same words; or one contains the other, whole words) already sent by this bot in this room / to this bot within
 *               `BOT_LOOP_DUPLICATE_SEC` (600 s).
 * - ring      — the same content (same similarity test) already sent by two different bots or more, anywhere in the
 *               account (rooms and bot_message), within `BOT_LOOP_RING_SEC` (900 s): it is going around. Only for texts
 *               of 16 characters or more once normalized ("ok", "merci" are not a ring).
 * - rate      — a bot's posts into one room (or to one bot): at most `BOT_LOOP_PER_MINUTE` (4) a minute and
 *               `BOT_LOOP_PER_HOUR` (30) an hour.
 * Any limit set to 0 is off. A human message resets the breaker and the escalate counters of that room (team.ts
 * dispatchToRoom, with no bot sender); a turn the user started by writing to a bot resets the channels that bot posts in.
 *
 * Persistence: none. Everything lives in memory with short windows (an hour at most) and is lost on restart, which only
 * means the counters start over — a loop after a restart is caught again within a few posts. Nothing is written to disk.
 *
 * `decide` is pure (state in, verdict out); `PostBudget` keeps the state and is what the tools use (`postBudget`).
 */

export type BudgetRule = "duplicate" | "ring" | "rate" | "breaker" | "escalate";

export interface BudgetLimits {
  duplicateMs: number;
  ringMs: number;
  perMinute: number;
  perHour: number;
  /** Bot posts in a row without a human message, after which the breaker opens. */
  breakerAfter: number;
  /** Unanswered posts to the user, per bot and room, after which that bot waits. */
  escalateAfter: number;
}

export const DEFAULT_LIMITS: BudgetLimits = { duplicateMs: 600_000, ringMs: 900_000, perMinute: 4, perHour: 30, breakerAfter: 6, escalateAfter: 2 };

/** The limits from the environment (BOT_LOOP_*), defaults where unset or invalid; 0 turns a rule off. */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): BudgetLimits {
  const n = (key: string, dflt: number) => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") return dflt;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  return {
    duplicateMs: n("BOT_LOOP_DUPLICATE_SEC", DEFAULT_LIMITS.duplicateMs / 1000) * 1000,
    ringMs: n("BOT_LOOP_RING_SEC", DEFAULT_LIMITS.ringMs / 1000) * 1000,
    perMinute: Math.floor(n("BOT_LOOP_PER_MINUTE", DEFAULT_LIMITS.perMinute)),
    perHour: Math.floor(n("BOT_LOOP_PER_HOUR", DEFAULT_LIMITS.perHour)),
    breakerAfter: Math.floor(n("BOT_LOOP_BREAKER", DEFAULT_LIMITS.breakerAfter)),
    escalateAfter: Math.floor(n("BOT_LOOP_ESCALATE", DEFAULT_LIMITS.escalateAfter)),
  };
}

// ── Text similarity ─────────────────────────────────────────────────────────
/** Lower case, no accents, no @mentions, no punctuation, single spaces. */
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/@[\p{L}\p{N}_.-]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const RING_MIN_CHARS = 16;
const CONTAIN_MIN_CHARS = 24;

/** Same or nearly the same, on normalized texts. */
export function similar(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= CONTAIN_MIN_CHARS && ` ${long} `.includes(` ${short} `)) return true;
  const wa = new Set(a.split(" ")), wb = new Set(b.split(" "));
  if (wa.size < 4 || wb.size < 4) return false;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both) >= 0.85;
}

// ── State and decision ──────────────────────────────────────────────────────
export interface PostEntry { channel: string; botId: string; norm: string; at: number; toUser: boolean }

export interface ChannelState {
  /** Bot posts since the last human message. */
  sinceHuman: number;
  /** Posts addressed to the user since the last human message, per bot. */
  toUser: Map<string, number>;
  /** The breaker is open (its line was posted). */
  open: boolean;
}

export interface BudgetState {
  /** The account's recent bot posts, oldest first. */
  log: PostEntry[];
  channels: Map<string, ChannelState>;
}

export interface PostAttempt {
  /** "room:<id>" or "dm:<id>:<id>" (see roomChannel, dmChannel). */
  channel: string;
  botId: string;
  text: string;
  now: number;
  /** A room post that wakes no other bot: it speaks to the user. */
  toUser?: boolean;
}

export type Verdict =
  | { allow: true }
  | { allow: false; rule: BudgetRule; /** For the bot: what happened and that it must not retry. */ reason: string; /** This refusal opened the breaker: post its line now. */ opened?: boolean };

export const roomChannel = (roomId: string) => `room:${roomId}`;
export const dmChannel = (a: string, b: string) => (a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`);
const isRoom = (channel: string) => channel.startsWith("room:");

const WAIT = "Do not retry and do not route around it (no other group, no bot_message): end your turn and wait for the user.";

/** Allow or refuse one bot post, with the reason. Pure: reads `state`, changes nothing. */
export function decide(state: BudgetState, p: PostAttempt, limits: BudgetLimits): Verdict {
  const room = isRoom(p.channel);
  const where = room ? "in this group" : "to this bot";
  const ch = state.channels.get(p.channel);
  if (limits.breakerAfter > 0 && ch && ch.sinceHuman >= limits.breakerAfter)
    return { allow: false, rule: "breaker", opened: !ch.open,
      reason: `Bots have written ${ch.sinceHuman} times in a row ${room ? "in this group" : "between you and this bot"} without the user writing: it looks like a loop, so it is stopped until the user writes. ${WAIT}` };
  if (room && limits.escalateAfter > 0 && ch && (ch.toUser.get(p.botId) ?? 0) >= limits.escalateAfter)
    return { allow: false, rule: "escalate",
      reason: `You already wrote to the user ${ch.toUser.get(p.botId)} times in this group without an answer. Do not post again until they answer. ${WAIT}` };
  const norm = normalize(p.text);
  const recent = (ms: number) => state.log.filter((e) => p.now - e.at < ms);
  if (limits.duplicateMs > 0 && recent(limits.duplicateMs).some((e) => e.channel === p.channel && e.botId === p.botId && similar(e.norm, norm)))
    return { allow: false, rule: "duplicate", reason: `You already sent this (or nearly the same) ${where} a moment ago. Do not send it again. ${WAIT}` };
  if (limits.ringMs > 0 && norm.length >= RING_MIN_CHARS) {
    const senders = new Set(recent(limits.ringMs).filter((e) => similar(e.norm, norm)).map((e) => e.botId));
    if (senders.size >= 2)
      return { allow: false, rule: "ring", reason: `This same content has already gone around ${senders.size} bots. Do not pass it on again. ${WAIT}` };
  }
  const mine = state.log.filter((e) => e.channel === p.channel && e.botId === p.botId);
  if (limits.perMinute > 0 && mine.filter((e) => p.now - e.at < 60_000).length >= limits.perMinute)
    return { allow: false, rule: "rate", reason: `You are writing too often ${where} (at most ${limits.perMinute} a minute). ${WAIT}` };
  if (limits.perHour > 0 && mine.filter((e) => p.now - e.at < 3_600_000).length >= limits.perHour)
    return { allow: false, rule: "rate", reason: `You are writing too often ${where} (at most ${limits.perHour} an hour). ${WAIT}` };
  return { allow: true };
}

const KEEP_MS = 3_600_000;
const MAX_LOG = 1000;

/** The live state for every account (keyed by user id), used by room_post and bot_message. */
export class PostBudget {
  private states = new Map<string, BudgetState>();
  constructor(public limits: BudgetLimits = limitsFromEnv()) {}

  private state(userId: string): BudgetState {
    let s = this.states.get(userId);
    if (!s) { s = { log: [], channels: new Map() }; this.states.set(userId, s); }
    return s;
  }

  private channel(s: BudgetState, key: string): ChannelState {
    let c = s.channels.get(key);
    if (!c) { c = { sinceHuman: 0, toUser: new Map(), open: false }; s.channels.set(key, c); }
    return c;
  }

  /**
   * Checks a post and, when allowed, counts it (the caller then sends it). A refusal that opens the breaker marks it
   * open, so only that one refusal has `opened` set.
   */
  attempt(userId: string, p: PostAttempt): Verdict {
    const s = this.state(userId);
    const keep = Math.max(KEEP_MS, this.limits.duplicateMs, this.limits.ringMs);
    while (s.log.length && (p.now - s.log[0].at >= keep || s.log.length > MAX_LOG)) s.log.shift();
    const v = decide(s, p, this.limits);
    if (!v.allow) {
      if (v.opened) this.channel(s, p.channel).open = true;
      return v;
    }
    s.log.push({ channel: p.channel, botId: p.botId, norm: normalize(p.text), at: p.now, toUser: !!p.toUser });
    const c = this.channel(s, p.channel);
    c.sinceHuman++;
    if (p.toUser) c.toUser.set(p.botId, (c.toUser.get(p.botId) ?? 0) + 1);
    return v;
  }

  /** A human wrote in this channel: the breaker closes and the counters start over. */
  human(userId: string, channel: string) {
    this.states.get(userId)?.channels.delete(channel);
  }

  /** True while the breaker of this channel is open. */
  isOpen(userId: string, channel: string): boolean {
    return !!this.states.get(userId)?.channels.get(channel)?.open;
  }

  /** Forgets everything (tests). */
  reset(limits?: BudgetLimits) {
    this.states.clear();
    if (limits) this.limits = limits;
  }
}

export const postBudget = new PostBudget();

/** True when a room post wakes no other bot: it mentions no other member and not @everyone / @all. */
export function addressesNoBot(text: string, otherNames: string[]): boolean {
  if (/@(everyone|all)\b/i.test(text)) return false;
  const lower = text.toLowerCase();
  return !otherNames.some((n) => lower.includes("@" + n.toLowerCase()));
}

/** The line a room gets when its breaker opens (English template; i18n.ts has the French). */
export const BREAKER_LINE = "The bots keep answering each other in a loop: I'm stopping here. Write a message to get them going again.";
