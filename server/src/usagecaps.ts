import { emit } from "./bus.js";
import { isValidTimezone, localParts } from "./cron.js";
import { q } from "./db.js";
import type { CapMode, CapPeriod, CapSetBy, CapStateView, CapUnit, Card, Locale, UsageAmount, UsageCapsView, UsageCapView } from "./shared.js";
import { audit, bots, newId, now, rows, settings, users, type BotRecord } from "./store.js";

/**
 * Usage caps: limits on what an account, or one bot, uses in a day and in a month — in money (USD, as everywhere in
 * Sklubot) and/or in tokens — set by the account's owner, and in hosted mode also by the service's operator on a
 * customer's account. Days and months are the USER's (their profile's timezone, else their check-ins', else UTC).
 *
 * What is counted (the `usage` table, the same lines as the usage page):
 *  - money: known costs plus the conservative estimate of calls whose price is unknown (est_cost_usd), as the monthly
 *    budget and the spend checkpoints count it. A subscription turn (Claude Code, Codex) costs 0 here: a money cap does
 *    not protect a subscription.
 *  - tokens: input (cached input included, as the usage page shows it) + output, of every model — subscription turns
 *    included, as they report their token counts. A token cap is what protects a subscription.
 *  A bot's cap counts the bot and its helpers (background tasks). An operator's cap counts only what the operator's keys
 *  pay for (usage.payer = 'operator'): the customer's own keys and own subscriptions are theirs.
 *
 * What a reached cap stops, per cap ("mode"):
 *  - "unattended" (the default): work no person started — routines and webhooks, goals' later rounds, nudges' quiet
 *    passes, bot-to-bot messages, background tasks, background-job reports, mail to the bot, check-ins, memory upkeep.
 *    A message a person just typed still runs (with one notice per cap and period).
 *  - "everything": a person's own messages too.
 *  Work is stopped at a safe point: before a turn starts, and before the next step of an API turn (where the spend
 *  checkpoint is checked); an action already started finishes first. A subscription turn reports its tokens at its end,
 *  so its cap is checked before the next turn.
 *
 * What the user sees: one card per cap, period and limit in the chat (raise the cap — the owner —, wait until the reset,
 * shown in their timezone, switch the bot's model; "Continue" runs what was set aside once the cap allows it), one
 * warning notice at the cap's threshold (80% by default), one line in the activity log per cap and period for the work
 * skipped (routines also say "skipped" in their run log). Never a notice per skipped run.
 *
 * Next to the existing limits (docs/PLAFONDS.md): the monthly budget (Settings → Usage) is still the account's hard
 * monthly money limit in UTC months, stopping everything; the spend checkpoint asks for each piece of work since the
 * user last spoke to it; hosted mode's plan budget stops the operator's keys. Caps add days, tokens, bots, the user's
 * timezone and the "unattended" mode. All of them are checked; the first reached stops the work.
 */

// ── Texts (English is the key; French below) ─────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "the account's daily spending cap": "le plafond de dépense quotidien du compte",
  "the account's monthly spending cap": "le plafond de dépense mensuel du compte",
  "the account's daily token cap": "le plafond de tokens quotidien du compte",
  "the account's monthly token cap": "le plafond de tokens mensuel du compte",
  "{bot}'s daily spending cap": "le plafond de dépense quotidien de {bot}",
  "{bot}'s monthly spending cap": "le plafond de dépense mensuel de {bot}",
  "{bot}'s daily token cap": "le plafond de tokens quotidien de {bot}",
  "{bot}'s monthly token cap": "le plafond de tokens mensuel de {bot}",
  "the daily cap the service set on your account": "le plafond quotidien que le service a fixé sur ton compte",
  "the monthly cap the service set on your account": "le plafond mensuel que le service a fixé sur ton compte",
  "Usage cap at {percent}%: {what} — {used} used of {limit}. It resets on {date}.": "Plafond d'usage à {percent} % : {what} — {used} utilisés sur {limit}. Il repart à zéro le {date}.",
  "Usage cap reached ({what}, {limit}): work no one started is paused until {date}. Your own messages still run.": "Plafond d'usage atteint ({what}, {limit}) : le travail que personne n'a lancé est en pause jusqu'au {date}. Tes propres messages passent toujours.",
  "Not run: {what} ({limit}) is reached until {date}. The message is kept on the card above: raise the cap, then press Continue.": "Pas lancé : {what} ({limit}) est atteint jusqu'au {date}. Le message est gardé sur la carte ci-dessus : relève le plafond, puis appuie sur Continuer.",
  "A usage cap is reached ({what}, {limit}): skipped. Runs start again on {date}.": "Plafond d'usage atteint ({what}, {limit}) : sautée. Les exécutions reprennent le {date}.",
  "a usage cap is reached": "un plafond d'usage est atteint",
  "Stopped at a usage cap ({what}, {limit}). What I did so far is kept.": "Arrêté à un plafond d'usage ({what}, {limit}). Ce que j'ai déjà fait est gardé.",
  "Usage cap reached: {what}": "Plafond d'usage atteint : {what}",
  "This usage cap still stops this work. Raise it (Settings → Usage) or wait until it resets.": "Ce plafond d'usage arrête encore ce travail. Relève-le (Réglages → Consommation) ou attends qu'il reparte à zéro.",
  "The new cap must be higher than the current one.": "Le nouveau plafond doit être plus haut que l'actuel.",
  "Only the service's operator can change this cap.": "Seul l'opérateur du service peut changer ce plafond.",
  "This card was already answered.": "Cette carte a déjà eu sa réponse.",
  "That card does not exist.": "Cette carte n'existe pas.",
  "A cap is for a day or a month.": "Un plafond vaut pour un jour ou un mois.",
  "A cap is in dollars (usd) or in tokens.": "Un plafond est en dollars (usd) ou en tokens.",
  "A cap stops unattended work or everything.": "Un plafond arrête le travail sans surveillance, ou tout.",
  "A spending cap is an amount between 0.01 and 100000 $ (empty to remove it).": "Un plafond de dépense est un montant entre 0,01 et 100 000 $ (vide pour le retirer).",
  "A token cap is a whole number between 1000 and 100 billion (empty to remove it).": "Un plafond de tokens est un nombre entier entre 1 000 et 100 milliards (vide pour le retirer).",
  "The warning threshold is a percentage between 1 and 99.": "Le seuil d'alerte est un pourcentage entre 1 et 99.",
  "Unknown bot.": "Bot inconnu.",
};
export const cm = (locale: Locale | undefined, english: string, vars: Record<string, string | number> = {}) =>
  (locale === "fr" ? FR[english] ?? english : english).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

export class CapError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, public english: string) { super(english); this.name = "CapError"; }
  text(locale: Locale | undefined) { return cm(locale, this.english); }
}

const hostedOn = () => process.env.HOSTED_MODE === "1" || process.env.HOSTED_MODE === "true";

// ── Time: the user's day and month ──────────────────────────────────────────────────────────────────────────────
/** The user's timezone: their shared profile's, else the one of their check-ins (if set), else UTC. */
export function userTimezone(userId: string): string {
  const p = settings.profile(userId).timezone;
  if (p && isValidTimezone(p)) return p;
  const c = settings.checkins(userId).timezone;
  if (c && isValidTimezone(c)) return c;
  return "UTC";
}

/** The instant of local midnight starting y-m-d (month 1–12, values may overflow: Date.UTC normalises) in `tz`. */
function localMidnight(y: number, m: number, d: number, tz: string): number {
  const n = new Date(Date.UTC(y, m - 1, d));
  const want = n.getTime();
  let guess = want;
  // The zone's offset at that instant, found by comparing wall clocks; twice covers a DST change on the way.
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const diff = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

export interface PeriodBounds { start: number; end: number; key: string }
/** The user's current day or month around `t`: when it started, when it ends, and its label (2026-11-17 / 2026-11). */
export function periodBounds(period: CapPeriod, tz: string, t = now()): PeriodBounds {
  const p = localParts(t, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (period === "day") return { start: localMidnight(p.year, p.month, p.day, tz), end: localMidnight(p.year, p.month, p.day + 1, tz), key: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
  return { start: localMidnight(p.year, p.month, 1, tz), end: localMidnight(p.year, p.month + 1, 1, tz), key: `${p.year}-${pad(p.month)}` };
}

// ── The caps ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CapRecord extends UsageCapView { userId: string }
export const capKey = (setBy: CapSetBy, botId: string | null, period: CapPeriod, unit: CapUnit) => `${setBy}:${botId || "account"}:${period}:${unit}`;
const toCap = (r: any): CapRecord => {
  const botId = r.bot_id ? String(r.bot_id) : null;
  const setBy: CapSetBy = r.set_by === "operator" ? "operator" : "self";
  const period: CapPeriod = r.period === "day" ? "day" : "month";
  const unit: CapUnit = r.unit === "tokens" ? "tokens" : "usd";
  return { userId: r.user_id, key: capKey(setBy, botId, period, unit), botId, period, unit, limit: r.limit_value, mode: r.mode === "everything" ? "everything" : "unattended", warnPercent: r.warn_percent, setBy, updatedAt: r.updated_at };
};
const publicCap = ({ userId: _u, ...c }: CapRecord): UsageCapView => c;

export interface CapInput { botId: string | null; period: CapPeriod; unit: CapUnit; limit: number | null; mode: CapMode; warnPercent: number }
/** Checks a cap as a route receives it (the caller checks that the bot is the account's own). */
export function cleanCapInput(raw: Record<string, unknown>): CapInput {
  const period = raw.period;
  if (period !== "day" && period !== "month") throw new CapError(400, "A cap is for a day or a month.");
  const unit = raw.unit;
  if (unit !== "usd" && unit !== "tokens") throw new CapError(400, "A cap is in dollars (usd) or in tokens.");
  const mode = raw.mode === undefined ? "unattended" : raw.mode;
  if (mode !== "unattended" && mode !== "everything") throw new CapError(400, "A cap stops unattended work or everything.");
  let limit: number | null = null;
  if (raw.limit !== null && raw.limit !== undefined && raw.limit !== "" && raw.limit !== 0) {
    const n = Number(raw.limit);
    if (unit === "usd") {
      if (!Number.isFinite(n) || n < 0.01 || n > 100_000) throw new CapError(400, "A spending cap is an amount between 0.01 and 100000 $ (empty to remove it).");
      limit = Math.round(n * 100) / 100;
    } else {
      if (!Number.isInteger(n) || n < 1000 || n > 100_000_000_000) throw new CapError(400, "A token cap is a whole number between 1000 and 100 billion (empty to remove it).");
      limit = n;
    }
  }
  const warn = raw.warnPercent === undefined || raw.warnPercent === null || raw.warnPercent === "" ? 80 : Number(raw.warnPercent);
  if (!Number.isInteger(warn) || warn < 1 || warn > 99) throw new CapError(400, "The warning threshold is a percentage between 1 and 99.");
  const botId = typeof raw.botId === "string" && raw.botId ? raw.botId : null;
  return { botId, period, unit, limit, mode, warnPercent: warn };
}

export const caps = {
  /** The account's caps in force: its owner's, and (hosted mode only) the operator's on it. */
  list(userId: string): CapRecord[] {
    return q.all("SELECT * FROM usage_caps WHERE user_id = ? ORDER BY set_by DESC, bot_id, period DESC, unit DESC", userId).map(toCap)
      .filter((c) => c.setBy === "self" || hostedOn());
  },
  any: (userId: string) => !!q.get("SELECT 1 FROM usage_caps WHERE user_id = ? LIMIT 1", userId),
  /** Sets (limit > 0) or removes (limit null) one cap. Returns whether something changed. */
  set(userId: string, f: CapInput, setBy: CapSetBy, by: string): boolean {
    if (f.limit === null) return Number(q.run("DELETE FROM usage_caps WHERE user_id = ? AND bot_id = ? AND period = ? AND unit = ? AND set_by = ?", userId, f.botId ?? "", f.period, f.unit, setBy).changes) > 0;
    q.run(`INSERT INTO usage_caps (user_id, bot_id, period, unit, set_by, limit_value, mode, warn_percent, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, bot_id, period, unit, set_by) DO UPDATE SET limit_value = excluded.limit_value, mode = excluded.mode, warn_percent = excluded.warn_percent, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      userId, f.botId ?? "", f.period, f.unit, setBy, f.limit, f.mode, f.warnPercent, by, now());
    emit(userId, { type: "usage" });
    return true;
  },
  /** A bot was deleted: its own caps go with it. */
  forgetBot: (botId: string) => q.run("DELETE FROM usage_caps WHERE bot_id = ?", botId),
};

// ── Measuring ───────────────────────────────────────────────────────────────────────────────────────────────────
/** What was used since `start`: the account's, or one bot's (its helpers included); `operatorOnly`: what the operator paid. */
export function usedSince(userId: string, start: number, botId: string | null, operatorOnly = false): UsageAmount {
  const bot = botId ? " AND (bot_id = ? OR bot_id IN (SELECT id FROM bots WHERE parent_id = ?))" : "";
  const payer = operatorOnly ? " AND payer = 'operator'" : "";
  const r = q.get<{ usd: number | null; tok: number | null }>(`SELECT SUM(cost_usd + est_cost_usd) AS usd, SUM(input_tokens + output_tokens) AS tok FROM usage WHERE user_id = ? AND at >= ?${bot}${payer}`,
    userId, start, ...(botId ? [botId, botId] : []));
  return { usd: r?.usd ?? 0, tokens: r?.tok ?? 0 };
}

function measure(c: CapRecord, tz: string, t: number, memo: Map<string, UsageAmount>): CapStateView {
  const b = periodBounds(c.period, tz, t);
  const k = `${b.start}|${c.botId ?? ""}|${c.setBy}`;
  let used = memo.get(k);
  if (!used) { used = usedSince(c.userId, b.start, c.botId, c.setBy === "operator"); memo.set(k, used); }
  const value = used[c.unit];
  const percent = Math.min(999, Math.floor((value / c.limit) * 100));
  return { ...publicCap(c), used: c.unit === "usd" ? Math.round(value * 10_000) / 10_000 : value, percent, warn: percent >= c.warnPercent, reached: value >= c.limit, periodKey: b.key, resetAt: b.end };
}

/** The bot whose caps count for this bot's work: a helper's is the bot it works for. */
const ownerBot = (bot: BotRecord): BotRecord => (bot.parentId ? bots.byId(bot.parentId) ?? bot : bot);

/** Every cap that applies to this bot's work (the account's and its own), measured now. */
export function statesFor(bot: Pick<BotRecord, "id" | "userId" | "parentId">, t = now()): CapStateView[] {
  const list = caps.list(bot.userId);
  if (!list.length) return [];
  const owner = ownerBot(bot as BotRecord);
  const tz = userTimezone(bot.userId);
  const memo = new Map<string, UsageAmount>();
  return list.filter((c) => c.botId === null || c.botId === owner.id).map((c) => measure(c, tz, t, memo));
}
function accountStates(userId: string, t = now()): CapStateView[] {
  const tz = userTimezone(userId);
  const memo = new Map<string, UsageAmount>();
  return caps.list(userId).filter((c) => c.botId === null).map((c) => measure(c, tz, t, memo));
}

/** Whether a reached cap stops this work: "everything" stops all, "unattended" only work no person started. */
const stops = (s: CapStateView, attended: boolean) => s.reached && (s.mode === "everything" || !attended);

/**
 * The cap that stops this bot's work now, or null. `attended`: a person started this work. Of several, the one that
 * lasts longest (the date the user is given is when the work can really start again).
 */
export function blockingCap(bot: Pick<BotRecord, "id" | "userId" | "parentId">, attended: boolean, t = now()): CapStateView | null {
  const hit = statesFor(bot, t).filter((s) => stops(s, attended));
  if (!hit.length) return null;
  return hit.sort((a, b) => b.resetAt - a.resetAt)[0];
}
/** Whether background work of this bot (routines, goals' next round, nudges, memory upkeep) may not run now. */
export const capHolds = (bot: BotRecord) => (caps.any(bot.userId) ? blockingCap(bot, false) : null);

/**
 * The money still allowed before a cap that stops this work (paid third-party tools reserve their maximum first).
 * null when no money cap applies.
 */
export function moneyLeft(bot: Pick<BotRecord, "id" | "userId" | "parentId">, attended: boolean): { left: number; cap: CapStateView } | null {
  let best: { left: number; cap: CapStateView } | null = null;
  for (const s of statesFor(bot)) {
    if (s.unit !== "usd" || (s.mode !== "everything" && attended)) continue;
    const left = Math.max(0, s.limit - s.used);
    if (!best || left < best.left) best = { left, cap: s };
  }
  return best;
}

// ── Who started the running turn (loop.ts tells; paid tools ask) ─────────────────────────────────────────────────
const attendedTurns = new Map<string, boolean>();
export const markTurn = (botId: string, attended: boolean) => { attendedTurns.set(botId, attended); };
export const clearTurn = (botId: string) => { attendedTurns.delete(botId); };
/** Whether the bot's running turn was started by a person (true when no turn is known: an action of the user's own). */
export const turnAttended = (botId: string) => attendedTurns.get(botId) ?? true;

// ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function amountText(unit: CapUnit, n: number, locale: Locale): string {
  if (unit === "usd") return locale === "fr" ? `${n.toFixed(2).replace(".", ",")} $` : `${n.toFixed(2)} $`;
  return `${Math.round(n).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")} tokens`;
}
export function whenText(at: number, tz: string, locale: Locale): string {
  const f = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: tz, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return `${f.format(at)} (${tz})`;
}
export function capName(c: Pick<UsageCapView, "botId" | "period" | "unit" | "setBy">, locale: Locale): string {
  if (c.setBy === "operator") return cm(locale, c.period === "day" ? "the daily cap the service set on your account" : "the monthly cap the service set on your account");
  const kind = `${c.period === "day" ? "daily" : "monthly"} ${c.unit === "usd" ? "spending" : "token"} cap`;
  if (!c.botId) return cm(locale, `the account's ${kind}`);
  return cm(locale, `{bot}'s ${kind}`, { bot: bots.byId(c.botId)?.name ?? "?" });
}

// ── Notices, once ───────────────────────────────────────────────────────────────────────────────────────────────
/** The period a notice belongs to: the cap's period and its limit (raising the cap makes a new one). */
const noticeKey = (s: CapStateView) => `${s.periodKey}@${s.limit}`;
/** True the first time (per cap, period, limit and kind), false after — also after a restart. */
function once(userId: string, s: CapStateView, kind: string): boolean {
  return Number(q.run("INSERT OR IGNORE INTO usage_cap_notices (user_id, cap_key, period_key, kind, at) VALUES (?, ?, ?, ?, ?)", userId, s.key, noticeKey(s), kind, now()).changes) === 1;
}
/** Counts one more skipped piece of work under this cap; returns the count. */
function countSkip(userId: string, s: CapStateView): number {
  q.run("INSERT INTO usage_cap_notices (user_id, cap_key, period_key, kind, at, count) VALUES (?, ?, ?, 'skip', ?, 1) ON CONFLICT(user_id, cap_key, period_key, kind) DO UPDATE SET count = count + 1", userId, s.key, noticeKey(s), now());
  return q.get<{ count: number }>("SELECT count FROM usage_cap_notices WHERE user_id = ? AND cap_key = ? AND period_key = ? AND kind = 'skip'", userId, s.key, noticeKey(s))?.count ?? 1;
}

/** Where a cap's card and notices go: the bot whose work met it (the bot a helper works for), else the main bot. */
function chatOf(userId: string, bot: BotRecord | null): BotRecord | null {
  const b = bot ? ownerBot(bot) : null;
  if (b && b.kind === "agent" && !b.hidden && b.userId === userId) return b;
  return bots.primary(userId);
}

// ── The card ────────────────────────────────────────────────────────────────────────────────────────────────────
/** A piece of work set aside by a cap: run by "Continue" (as the user's own, since they pressed it). */
export interface HeldWork { botId: string; trigger: Record<string, unknown> }
interface StopRecord { id: string; userId: string; cardBotId: string; capKey: string; periodKey: string; generation: number; thread: number; cardSeq: number | null; held: HeldWork[]; status: string }
const toStop = (r: any): StopRecord => ({
  id: r.id, userId: r.user_id, cardBotId: r.card_bot_id, capKey: r.cap_key, periodKey: r.period_key, generation: r.generation, thread: r.thread, cardSeq: r.card_seq ?? null,
  held: (() => { try { const v = JSON.parse(r.held); return Array.isArray(v) ? v : []; } catch { return []; } })(), status: r.status,
});
export const capStops = {
  byId: (id: string) => { const r = q.get("SELECT * FROM usage_cap_stops WHERE id = ?", id); return r ? toStop(r) : null; },
  pending: (userId: string, s: CapStateView) => { const r = q.get("SELECT * FROM usage_cap_stops WHERE user_id = ? AND cap_key = ? AND period_key = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", userId, s.key, noticeKey(s)); return r ? toStop(r) : null; },
};
const MAX_HELD = 50;

function editCard(stop: StopRecord, change: (c: Extract<Card, { type: "cap" }>) => Extract<Card, { type: "cap" }>) {
  const cardBot = bots.byId(stop.cardBotId);
  if (!cardBot || stop.cardSeq === null || cardBot.generation !== stop.generation) return;
  rows.updateCard(cardBot, stop.generation, stop.cardSeq, (c) => (c.type === "cap" ? change(c) : c));
}

/**
 * The cap's card, made once per cap, period and limit (in the chat of the bot whose work met it), with `held` work set
 * aside on it. `force`: a person's own work was stopped — a new card is made even if the one of this period was
 * already answered (they must see why). Returns the card's record, or null when there is none to add to.
 */
export function capCard(userId: string, s: CapStateView, bot: BotRecord | null, o: { held?: HeldWork; force?: boolean; skipped?: boolean } = {}): StopRecord | null {
  let stop = capStops.pending(userId, s);
  if (!stop) {
    const first = once(userId, s, "reached");
    if (!first && !o.force) return null;
    const cardBot = chatOf(userId, bot);
    if (!cardBot) return null;
    const tz = userTimezone(userId);
    const id = newId("cap");
    const card: Card = {
      type: "cap", stopId: id, botName: s.botId ? bots.byId(s.botId)?.name ?? "" : "", cap: { key: s.key, botId: s.botId, period: s.period, unit: s.unit, limit: s.limit, mode: s.mode, warnPercent: s.warnPercent, setBy: s.setBy, updatedAt: s.updatedAt },
      used: s.used, resetAt: s.resetAt, timezone: tz, held: 0, skipped: 0, canRaise: s.setBy === "self", status: "pending",
    };
    const row = rows.append(cardBot, { kind: "card", card });
    q.run("INSERT INTO usage_cap_stops (id, user_id, card_bot_id, cap_key, period_key, generation, thread, card_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)", id, userId, cardBot.id, s.key, noticeKey(s), cardBot.generation, row.seq, now());
    bots.bumpUnread(cardBot.id);
    if (first) audit(userId, "system", `Usage cap reached: ${capName(s, "en")} (${amountText(s.unit, s.limit, "en")}, ${s.mode === "everything" ? "stops everything" : "stops unattended work"}) until ${new Date(s.resetAt).toISOString().slice(0, 16).replace("T", " ")} UTC`, s.botId);
    stop = capStops.byId(id)!;
  }
  if (o.held && stop.held.length < MAX_HELD) {
    stop.held.push(o.held);
    q.run("UPDATE usage_cap_stops SET held = ? WHERE id = ?", JSON.stringify(stop.held), stop.id);
    editCard(stop, (c) => ({ ...c, held: stop!.held.length }));
  } else if (o.skipped) {
    editCard(stop, (c) => ({ ...c, skipped: (c.skipped ?? 0) + 1 }));
  }
  return stop;
}

/**
 * Background work skipped because of a cap: counted, said once in the activity log (per cap, period and limit), and
 * shown on the cap's card. `what`: what was skipped, for the log.
 */
export function noteSkip(bot: BotRecord, s: CapStateView, what: string, held?: HeldWork) {
  const n = countSkip(bot.userId, s);
  if (n === 1) audit(bot.userId, "system", `${ownerBot(bot).name}: unattended work skipped while ${capName(s, "en")} is reached (first: ${what}); further skips this period are counted, not logged`, ownerBot(bot).id);
  capCard(bot.userId, s, bot, { held, skipped: !held });
  emit(bot.userId, { type: "usage" });
}

/** A person's message runs although an "unattended" cap is reached: said once per cap, period and bot. */
export function noteAttended(bot: BotRecord) {
  const loc = users.localeOf(bot.userId);
  const tz = userTimezone(bot.userId);
  for (const s of statesFor(bot)) {
    if (!s.reached || s.mode !== "unattended" || !once(bot.userId, s, `attended:${ownerBot(bot).id}`)) continue;
    rows.append(ownerBot(bot), { kind: "notice", tone: "info", text: cm(loc, "Usage cap reached ({what}, {limit}): work no one started is paused until {date}. Your own messages still run.", { what: capName(s, loc), limit: amountText(s.unit, s.limit, loc), date: whenText(s.resetAt, tz, loc) }), action: { kind: "settings", section: "usage" } });
  }
}

/** The text a routine's run log and a stopped turn get. */
export function skipText(userId: string, s: CapStateView, english: "skip" | "stopped" | "refused"): string {
  const loc = users.localeOf(userId);
  const tz = userTimezone(userId);
  const vars = { what: capName(s, loc), limit: amountText(s.unit, s.limit, loc), date: whenText(s.resetAt, tz, loc) };
  if (english === "skip") return cm(loc, "A usage cap is reached ({what}, {limit}): skipped. Runs start again on {date}.", vars);
  if (english === "stopped") return cm(loc, "Stopped at a usage cap ({what}, {limit}). What I did so far is kept.", vars);
  return cm(loc, "Not run: {what} ({limit}) is reached until {date}. The message is kept on the card above: raise the cap, then press Continue.", vars);
}

// ── After each usage line (usage.ts): warnings and the "reached" card ───────────────────────────────────────────
export function afterUsage(userId: string, botId: string) {
  if (!caps.any(userId)) return;
  const bot = botId ? bots.byId(botId) : null;
  const states = bot && bot.userId === userId ? statesFor(bot) : accountStates(userId);
  const loc = users.localeOf(userId);
  const tz = userTimezone(userId);
  for (const s of states) {
    if (s.reached) { capCard(userId, s, bot); continue; }
    if (!s.warn || !once(userId, s, "warn")) continue;
    const chat = chatOf(userId, s.botId ? bots.byId(s.botId) : bot);
    const text = cm(loc, "Usage cap at {percent}%: {what} — {used} used of {limit}. It resets on {date}.", { percent: s.percent, what: capName(s, loc), used: amountText(s.unit, s.used, loc), limit: amountText(s.unit, s.limit, loc), date: whenText(s.resetAt, tz, loc) });
    if (chat) rows.append(chat, { kind: "notice", tone: "warn", text, action: { kind: "settings", section: "usage" } });
    audit(userId, "system", `Usage cap at ${s.percent}%: ${capName(s, "en")} (${amountText(s.unit, s.used, "en")} of ${amountText(s.unit, s.limit, "en")})`, s.botId);
  }
}

// ── The card's buttons ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * The user's answer on a cap card. "wait": the card says so (the work comes back at the reset by itself: routines at
 * their next time; what was set aside stays on the card for "Continue"). "raise" (the owner, a cap of their own):
 * the cap's new limit, then what was set aside goes on. "continue": what was set aside goes on as the user's own work,
 * once no cap stops it (a "everything" cap still reached refuses).
 */
export async function answerCapCard(userId: string, stopId: string, action: string, limit?: unknown): Promise<void> {
  const stop = capStops.byId(stopId);
  if (!stop || stop.userId !== userId) throw new CapError(404, "That card does not exist.");
  if (stop.status !== "pending") throw new CapError(409, "This card was already answered.");
  const cap = caps.list(userId).find((c) => c.key === stop.capKey);
  if (action === "wait") {
    if (Number(q.run("UPDATE usage_cap_stops SET status = 'waiting' WHERE id = ? AND status = 'pending'", stop.id).changes) !== 1) throw new CapError(409, "This card was already answered.");
    editCard(stop, (c) => ({ ...c, status: "waiting" }));
    return;
  }
  if (action === "raise") {
    if (!cap) throw new CapError(409, "This card was already answered.");
    if (cap.setBy !== "self") throw new CapError(403, "Only the service's operator can change this cap.");
    const n = Number(limit);
    const input = cleanCapInput({ botId: cap.botId, period: cap.period, unit: cap.unit, limit: n, mode: cap.mode, warnPercent: cap.warnPercent });
    if (input.limit === null || input.limit <= cap.limit) throw new CapError(400, "The new cap must be higher than the current one.");
    caps.set(userId, input, "self", userId);
    audit(userId, "account", `Usage cap raised from its card: ${capName(cap, "en")} ${amountText(cap.unit, cap.limit, "en")} → ${amountText(cap.unit, input.limit, "en")}`, cap.botId);
  } else if (action !== "continue") throw new CapError(400, "This card was already answered.");
  // Everything set aside must be allowed to run now (as the user's own work: they pressed the button).
  for (const h of stop.held) {
    const b = bots.byId(h.botId);
    if (b && blockingCap(b, true)) throw new CapError(409, "This usage cap still stops this work. Raise it (Settings → Usage) or wait until it resets.");
  }
  const status = action === "raise" ? "raised" : "continued";
  if (Number(q.run("UPDATE usage_cap_stops SET status = ? WHERE id = ? AND status = 'pending'", status, stop.id).changes) !== 1) throw new CapError(409, "This card was already answered.");
  editCard(stop, (c) => ({ ...c, status, ...(action === "raise" && cap ? { cap: { ...c.cap, limit: caps.list(userId).find((x) => x.key === cap.key)?.limit ?? c.cap.limit } } : {}) }));
  const { enqueue } = await import("./agent/loop.js");
  for (const h of stop.held) if (bots.byId(h.botId)) enqueue(h.botId, asPersonsWork(h.trigger) as Parameters<typeof enqueue>[1]);
  emit(userId, { type: "usage" });
}

/** Work set aside, run because a person pressed "Continue": it is theirs now (a bot's message is passed on as such). */
function asPersonsWork(t: Record<string, unknown>): Record<string, unknown> {
  if (t.kind === "user") return t;
  if (t.kind === "bot") return { kind: "system", byPerson: true, depth: t.depth, tainted: t.tainted, text: `${String(t.fromName ?? "Another bot")} wrote to you while a usage cap held your work; the user asked you to go on now:\n${String(t.text ?? "")}` };
  const { unattended: _u, goalRound: _g, jobIds: _j, ...rest } = t;
  return { ...rest, kind: "system", byPerson: true };
}

// ── The usage page ──────────────────────────────────────────────────────────────────────────────────────────────
function perBot(userId: string, start: number): Map<string, UsageAmount> {
  return new Map(q.all<{ b: string; usd: number | null; tok: number | null }>(
    `SELECT COALESCE(x.parent_id, u.bot_id) AS b, SUM(u.cost_usd + u.est_cost_usd) AS usd, SUM(u.input_tokens + u.output_tokens) AS tok
     FROM usage u LEFT JOIN bots x ON x.id = u.bot_id WHERE u.user_id = ? AND u.at >= ? GROUP BY b`, userId, start)
    .map((r) => [r.b, { usd: r.usd ?? 0, tokens: r.tok ?? 0 }]));
}
const zero = (): UsageAmount => ({ usd: 0, tokens: 0 });
const round = (a: UsageAmount): UsageAmount => ({ usd: Math.round(a.usd * 10_000) / 10_000, tokens: a.tokens });

/** GET /usage/caps: today and this month for the account and each bot, with their caps. */
export function capsView(userId: string, extra: { owner: boolean; budgetUsd: number | null; budgetSpentUsd: number; budgetResetAt: number }, t = now()): UsageCapsView {
  const tz = userTimezone(userId);
  const day = periodBounds("day", tz, t);
  const month = periodBounds("month", tz, t);
  const memo = new Map<string, UsageAmount>();
  const all = caps.list(userId).map((c) => measure(c, tz, t, memo));
  const today = perBot(userId, day.start);
  const thisMonth = perBot(userId, month.start);
  const list = bots.list(userId).filter((b) => b.kind === "agent");
  return {
    timezone: tz, dayKey: day.key, monthKey: month.key, dayResetAt: day.end, monthResetAt: month.end, owner: extra.owner,
    account: { today: round(usedSince(userId, day.start, null)), month: round(usedSince(userId, month.start, null)), caps: all.filter((c) => c.botId === null) },
    bots: list.map((b) => ({ botId: b.id, name: b.name, today: round(today.get(b.id) ?? zero()), month: round(thisMonth.get(b.id) ?? zero()), caps: all.filter((c) => c.botId === b.id) })),
    budget: { usd: extra.budgetUsd, spentUsd: Math.round(extra.budgetSpentUsd * 10_000) / 10_000, resetAt: extra.budgetResetAt },
  };
}

/** Hosted mode: the operator's caps on one customer, measured now (administration). */
export function operatorCapsOf(userId: string): CapStateView[] {
  const tz = userTimezone(userId);
  const memo = new Map<string, UsageAmount>();
  return caps.list(userId).filter((c) => c.setBy === "operator").map((c) => measure(c, tz, now(), memo));
}
