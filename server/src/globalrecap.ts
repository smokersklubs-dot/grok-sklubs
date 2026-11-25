import { q } from "./db.js";
import type { GlobalRecap, GlobalRecapBot } from "./globalrecaptypes.js";
import { tr } from "./i18n.js";
import type { Locale } from "./shared.js";
import { clip, now, users } from "./store.js";
import { doneOf, durationText, needsOf, scopeOf, todaySettings } from "./today.js";

/**
 * L161 « récapitulatif global » (10-timon T69: "the main bot gets, without a model call, a bounded recap of the
 * projects, active and dormant"; behaviour only, our own code). One recap of EVERY bot of the account over the last
 * `days` days (default 7, at most 31): what each finished (the same outcomes "Aujourd'hui" counts, today.ts, so the
 * two never disagree), what waits for the owner now, the goals still open, and the bots left aside — open goals but
 * nothing for DORMANT_DAYS days. No model call, nothing stored.
 *
 * Who sees what: as "Aujourd'hui" — the account's own bots (helpers under the bot they work for), plus what a workspace
 * lets the caller read of shared bots. The bot tool (global_recap) gets the owner's own bots only (`ownOnly`).
 */
export const DORMANT_DAYS = 14;
export const RECAP_MAX_DAYS = 31;
export const RECAP_TEXT_MAX = 2500;
export const RECAP_TEXT_BOTS = 6;
const DAY = 86_400_000;
const marks = (n: number) => Array(n).fill("?").join(", ");

export function recapDays(raw: unknown): number {
  const n = Math.round(Number(raw ?? 7));
  return Number.isFinite(n) && n >= 1 ? Math.min(RECAP_MAX_DAYS, n) : 7;
}

export function globalRecap(userId: string, o: { days?: unknown; ownOnly?: boolean; locale?: Locale } = {}, t = now()): GlobalRecap {
  const days = recapDays(o.days);
  const start = t - days * DAY;
  const full = scopeOf(userId);
  const scope = o.ownOnly ? { ...full, shared: [] } : full;
  const table = todaySettings.table(userId);
  const byTop = new Map<string, GlobalRecapBot>();
  const entry = (id: string, name: string, shared: boolean) => {
    let e = byTop.get(id);
    if (!e) { e = { botId: id, botName: name, shared, finished: 0, minutes: 0, kinds: {}, highlights: [], lastActiveAt: null, openGoals: [], waiting: 0, dormant: false }; byTop.set(id, e); }
    return e;
  };
  for (const b of scope.top) if (b.kind === "agent") entry(b.id, b.name, false);
  for (const a of scope.shared) if (a.bot.kind === "agent") entry(a.bot.id, a.bot.name, true);
  const done = doneOf(userId, scope, start, t + 1).sort((a, b) => b.item.at - a.item.at);
  for (const c of done) {
    const e = entry(c.top.id, c.top.name, c.shared);
    e.finished += c.item.counted;
    e.minutes += c.item.counted * table[c.item.kind];
    e.kinds[c.item.kind] = (e.kinds[c.item.kind] ?? 0) + c.item.counted;
    if (e.highlights.length < 3 && c.item.title) e.highlights.push(c.item.title);
  }
  for (const n of needsOf(userId, scope, t)) if (n.botId && byTop.has(n.botId)) byTop.get(n.botId)!.waiting += n.count ?? 1;
  // Latest line and open goals: the bot with its helpers (own bots) or the shared bot itself.
  const members = new Map<string, string[]>();
  for (const [id, top] of scope.own) members.set(top.id, [...(members.get(top.id) ?? []), id]);
  for (const e of byTop.values()) {
    const ids = members.get(e.botId) ?? [e.botId];
    e.lastActiveAt = q.get<{ at: number | null }>(`SELECT MAX(created_at) AS at FROM rows WHERE bot_id IN (${marks(ids.length)})`, ...ids)?.at ?? null;
    e.openGoals = q.all<{ objective: string }>(`SELECT objective FROM bot_goals WHERE bot_id IN (${marks(ids.length)}) AND status IN ('active', 'paused') ORDER BY created_at LIMIT 3`, ...ids).map((g) => clip(g.objective.replace(/\s+/g, " ").trim(), 120));
    e.dormant = e.openGoals.length > 0 && (e.lastActiveAt === null || t - e.lastActiveAt > DORMANT_DAYS * DAY);
  }
  const list = [...byTop.values()].sort((a, b) => Number(b.dormant) - Number(a.dormant) || b.waiting - a.waiting || b.finished - a.finished || a.botName.localeCompare(b.botName));
  const totals = { finished: 0, minutes: 0, waiting: 0, bots: list.length, dormant: 0 };
  for (const e of list) { totals.finished += e.finished; totals.minutes += e.minutes; totals.waiting += e.waiting; totals.dormant += Number(e.dormant); }
  const recap: GlobalRecap = { days, start, end: t, generatedAt: t, totals, bots: list, text: "" };
  recap.text = recapText(recap, o.locale ?? users.localeOf(userId), t);
  return recap;
}

/** The recap in a few lines, bounded (RECAP_TEXT_MAX characters, RECAP_TEXT_BOTS bots, the others counted). */
export function recapText(r: GlobalRecap, locale: Locale, t = now()): string {
  const fr = locale === "fr";
  const head = `${tr(locale, "Recap of your bots, last {days} days", { days: r.days })} — ${fr
    ? `${r.totals.finished} chose${r.totals.finished > 1 ? "s" : ""} finie${r.totals.finished > 1 ? "s" : ""}${r.totals.minutes ? ` (≈ ${durationText(r.totals.minutes)} gagnées, estimation)` : ""}, ${r.totals.waiting} t'attend${r.totals.waiting > 1 ? "ent" : ""}.`
    : `${r.totals.finished} finished${r.totals.minutes ? ` (≈ ${durationText(r.totals.minutes)} saved, estimate)` : ""}, ${r.totals.waiting} waiting for you.`}`;
  const ago = (at: number) => `${Math.max(0, Math.floor((t - at) / DAY))} ${fr ? "j" : "d"}`;
  const lines = [head];
  const shown = r.bots.filter((b) => b.finished || b.waiting || b.dormant || b.openGoals.length).slice(0, RECAP_TEXT_BOTS);
  for (const b of shown) {
    const parts = [fr ? `${b.finished} finie${b.finished > 1 ? "s" : ""}` : `${b.finished} finished`];
    if (b.waiting) parts.push(fr ? `${b.waiting} t'attend${b.waiting > 1 ? "ent" : ""}` : `${b.waiting} waiting`);
    if (b.highlights[0]) parts.push(fr ? `dernier : « ${clip(b.highlights[0], 90)} »` : `latest: "${clip(b.highlights[0], 90)}"`);
    if (b.dormant) parts.push(fr ? `au point mort ${b.lastActiveAt === null ? "sans avoir commencé" : `depuis ${ago(b.lastActiveAt)}`} (objectif « ${clip(b.openGoals[0], 80)} »)` : `left aside ${b.lastActiveAt === null ? "before starting" : `for ${ago(b.lastActiveAt)}`} (goal "${clip(b.openGoals[0], 80)}")`);
    else if (b.openGoals[0]) parts.push(fr ? `en cours : « ${clip(b.openGoals[0], 80)} »` : `working on: "${clip(b.openGoals[0], 80)}"`);
    lines.push(`• ${b.botName}${b.shared ? (fr ? " (partagé)" : " (shared)") : ""} : ${parts.join(" ; ")}`);
  }
  const quiet = r.bots.length - shown.length;
  if (quiet > 0) lines.push(fr ? `• ${quiet} autre${quiet > 1 ? "s" : ""} bot${quiet > 1 ? "s" : ""} sans rien de neuf.` : `• ${quiet} other bot${quiet > 1 ? "s" : ""} with nothing new.`);
  let text = lines.join("\n");
  if (text.length > RECAP_TEXT_MAX) text = `${text.slice(0, RECAP_TEXT_MAX - 1).replace(/\n[^\n]*$/, "")}\n…`;
  return text;
}
