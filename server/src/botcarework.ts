import { q } from "./db.js";
import { tr } from "./i18n.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "./store.js";

/**
 * L161 (backlog A-FAIRE), three small things that keep a team tidy (our own code; behaviour from the audits):
 *   - « Mise de côté après 14 jours » (Rakazo row 29): a bot nobody used for 14 days (no message, no routine run, nothing
 *     in its chat) moves to the « Masqués » group of the list. Nothing is deleted or stopped: its routines, memory and
 *     chat stay; it comes back by itself as soon as it is used again, or with one click. The main bot, a pinned bot and
 *     a bot marked « ne jamais mettre de côté » are never set aside. A bot the owner brought back gets 14 new days.
 *   - « Raccourcis à revoir » (Ponytail ponytail-debt): when a bot takes a shortcut (« j'ai pris les 50 premiers »), it
 *     notes it with shortcut_note: what it did, what that leaves out, when to look at it again. The owner sees the list;
 *     a shortcut without a moment to revisit is flagged.
 *   - « Il me manque une capacité » (Astryx gap-report): capability_gap notes what the bot could not do for want of a
 *     tool or an access, as a card in its chat and a line in Settings → Team. Nothing is installed, nothing goes out.
 */

export const ASIDE_DAYS = 14;
const DAY = 86_400_000;
export const SHORTCUTS_OPEN_MAX = 200;
export const GAPS_OPEN_MAX = 200;

q.run("CREATE TABLE IF NOT EXISTS bot_aside (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, aside_at INTEGER, back_at INTEGER, never INTEGER NOT NULL DEFAULT 0)");
q.run("CREATE TABLE IF NOT EXISTS bot_shortcuts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, what TEXT NOT NULL, leaves_out TEXT NOT NULL, revisit TEXT NOT NULL, revisit_at INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, done_at INTEGER)");
q.run("CREATE INDEX IF NOT EXISTS bot_shortcuts_user ON bot_shortcuts(user_id, status)");
q.run("CREATE TABLE IF NOT EXISTS capability_gaps (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, what TEXT NOT NULL, why TEXT NOT NULL, tried TEXT NOT NULL, times INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, last_at INTEGER NOT NULL)");
q.run("CREATE INDEX IF NOT EXISTS capability_gaps_user ON capability_gaps(user_id, status)");

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/* ---------- Mise de côté ---------- */

interface AsideRow { aside_at: number | null; back_at: number | null; never: number }
const asideRow = (botId: string) => q.get<AsideRow>("SELECT aside_at, back_at, never FROM bot_aside WHERE bot_id = ?", botId) ?? null;
/** When the bot was last used: its newest chat row (a message, a routine run, a card), or its creation. */
export function lastUse(botId: string): number {
  const r = q.get<{ last: number | null; created: number }>("SELECT (SELECT MAX(created_at) FROM rows WHERE bot_id = b.id) AS last, b.created_at AS created FROM bots b WHERE b.id = ?", botId);
  return Math.max(r?.last ?? 0, r?.created ?? 0);
}

export const aside = {
  view(bot: BotRecord) {
    const r = asideRow(bot.id);
    const last = lastUse(bot.id);
    const eligible = !bot.primary && !bot.pinned && !bot.parentId;
    return { aside: !!r?.aside_at && bot.listHidden, asideAt: r?.aside_at ?? null, lastUse: last, never: !!r?.never, eligible, days: ASIDE_DAYS };
  },
  /** « Ne jamais le mettre de côté », and « Le ressortir » (back in the list, 14 new days). */
  set(bot: BotRecord, o: { never?: boolean; back?: boolean }) {
    const r = asideRow(bot.id);
    q.run("INSERT INTO bot_aside (bot_id, aside_at, back_at, never) VALUES (?, NULL, NULL, 0) ON CONFLICT (bot_id) DO NOTHING", bot.id);
    if (typeof o.never === "boolean") q.run("UPDATE bot_aside SET never = ? WHERE bot_id = ?", o.never ? 1 : 0, bot.id);
    if (o.back && r?.aside_at) bringBack(bot);
    return aside.view(bots.byId(bot.id)!);
  },
};

function bringBack(bot: BotRecord) {
  q.run("UPDATE bot_aside SET aside_at = NULL, back_at = ? WHERE bot_id = ?", now(), bot.id);
  if (bot.listHidden) { bots.patch(bot.id, { listHidden: false }); bots.announce(bots.byId(bot.id)); }
}

/**
 * One pass over every account (hourly, and once after start): sets aside the bots unused for 14 days, brings back the
 * ones used again, and forgets the « mis de côté » mark of a bot the owner showed again by hand. Returns what it did.
 */
export function sweepAside(at = now()): { setAside: string[]; back: string[] } {
  const out = { setAside: [] as string[], back: [] as string[] };
  const marked = q.all<{ bot_id: string; aside_at: number }>("SELECT bot_id, aside_at FROM bot_aside WHERE aside_at IS NOT NULL");
  for (const m of marked) {
    const bot = bots.byId(m.bot_id);
    if (!bot) continue;
    if (!bot.listHidden) { q.run("UPDATE bot_aside SET aside_at = NULL, back_at = ? WHERE bot_id = ?", at, bot.id); continue; } // shown again by hand
    if (lastUse(bot.id) > m.aside_at) { bringBack(bot); out.back.push(bot.id); audit(bot.userId, "system", tr(users.localeOf(bot.userId), "{bot} is back in the list: it was used again", { bot: bot.name }), bot.id); }
  }
  const candidates = q.all<{ id: string }>("SELECT id FROM bots WHERE kind = 'agent' AND hidden = 0 AND is_primary = 0 AND pinned = 0 AND list_hidden = 0 AND parent_id IS NULL");
  for (const c of candidates) {
    const r = asideRow(c.id);
    if (r?.never) continue;
    const since = Math.max(lastUse(c.id), r?.back_at ?? 0);
    if (at - since < ASIDE_DAYS * DAY) continue;
    const bot = bots.byId(c.id)!;
    q.run("INSERT INTO bot_aside (bot_id, aside_at, back_at, never) VALUES (?, ?, NULL, 0) ON CONFLICT (bot_id) DO UPDATE SET aside_at = excluded.aside_at", bot.id, at);
    bots.patch(bot.id, { listHidden: true });
    bots.announce(bots.byId(bot.id));
    audit(bot.userId, "system", tr(users.localeOf(bot.userId), "{bot} was set aside (in « Hidden »): not used for {n} days. Nothing was deleted.", { bot: bot.name, n: ASIDE_DAYS }), bot.id);
    out.setAside.push(bot.id);
  }
  return out;
}

let started = false;
export function startAsideSweep() {
  if (started || process.env.NO_SCHEDULER === "1") return;
  started = true;
  const pass = () => { try { sweepAside(); } catch (err) { console.error("[bot aside]", (err as Error).message); } };
  setTimeout(pass, 60_000).unref();
  setInterval(pass, 3_600_000).unref();
}

/* ---------- Raccourcis à revoir ---------- */

/** A date the bot wrote (YYYY-MM-DD, or « dans N jours / in N days / N weeks »), as a time; null when it is only words. */
export function revisitTime(words: string, from = now()): number | null {
  const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(words);
  if (iso) { const t = Date.UTC(+iso[1], +iso[2] - 1, +iso[3]); return Number.isFinite(t) ? t : null; }
  const rel = /\b(\d{1,3})\s*(jours?|days?|semaines?|weeks?|mois|months?)\b/i.exec(words);
  if (!rel) return null;
  const n = +rel[1];
  const unit = rel[2].toLowerCase();
  return from + n * (unit.startsWith("j") || unit.startsWith("d") ? DAY : unit.startsWith("s") || unit.startsWith("w") ? 7 * DAY : 30 * DAY);
}

export interface ShortcutView { id: string; botId: string; botName: string; what: string; leavesOut: string; revisit: string; revisitAt: number | null; due: boolean; noRevisit: boolean; createdAt: number }

export const shortcuts = {
  note(bot: BotRecord, a: { what?: unknown; leaves_out?: unknown; revisit?: unknown }): ShortcutView | string {
    const what = text(a.what, 300);
    if (!what) return "Say which shortcut you took (what).";
    const open = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_shortcuts WHERE user_id = ? AND status = 'open'", bot.userId)!.n;
    if (open >= SHORTCUTS_OPEN_MAX) return "The list of shortcuts to revisit is full (200): ask the user to review it first.";
    const revisit = text(a.revisit, 160);
    const id = newId("sc");
    q.run("INSERT INTO bot_shortcuts (id, user_id, bot_id, what, leaves_out, revisit, revisit_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, bot.userId, bot.id, what, text(a.leaves_out, 300), revisit, revisit ? revisitTime(revisit) : null, now());
    return shortcuts.list(bot.userId).find((s) => s.id === id)!;
  },
  list(userId: string, at = now()): ShortcutView[] {
    return q.all<any>("SELECT * FROM bot_shortcuts WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC", userId).map((r) => ({
      id: r.id, botId: r.bot_id, botName: bots.byId(r.bot_id)?.name ?? "", what: r.what, leavesOut: r.leaves_out, revisit: r.revisit,
      revisitAt: r.revisit_at ?? null, due: r.revisit_at != null && r.revisit_at <= at, noRevisit: !r.revisit, createdAt: r.created_at,
    })).sort((a, b) => Number(b.due) - Number(a.due) || Number(b.noRevisit) - Number(a.noRevisit) || b.createdAt - a.createdAt);
  },
  /** « Revu » (kept as done) or « Retirer ». False when it is not one of this account's open shortcuts. */
  close(userId: string, id: string, how: "done" | "remove"): boolean {
    if (how === "remove") return q.run("DELETE FROM bot_shortcuts WHERE id = ? AND user_id = ?", id, userId).changes > 0;
    return q.run("UPDATE bot_shortcuts SET status = 'done', done_at = ? WHERE id = ? AND user_id = ? AND status = 'open'", now(), id, userId).changes > 0;
  },
};

/* ---------- Il me manque une capacité ---------- */

export interface GapView { id: string; botId: string; botName: string; what: string; why: string; tried: string; times: number; createdAt: number; lastAt: number }

export const capabilityGaps = {
  /** Notes the gap (the same wording from the same bot counts once more instead of a new line) and posts a card in its chat. */
  note(bot: BotRecord, a: { what?: unknown; why?: unknown; tried?: unknown }, thread = 0): GapView | string {
    const what = text(a.what, 200);
    if (!what) return "Say which capability is missing (what).";
    const why = text(a.why, 300);
    const same = q.get<{ id: string }>("SELECT id FROM capability_gaps WHERE bot_id = ? AND status = 'open' AND lower(what) = lower(?)", bot.id, what);
    let id = same?.id;
    if (id) q.run("UPDATE capability_gaps SET times = times + 1, last_at = ?, why = CASE WHEN ? != '' THEN ? ELSE why END WHERE id = ?", now(), why, why, id);
    else {
      const open = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM capability_gaps WHERE user_id = ? AND status = 'open'", bot.userId)!.n;
      if (open >= GAPS_OPEN_MAX) return "The list of missing capabilities is full (200): ask the user to review it first.";
      id = newId("gap");
      q.run("INSERT INTO capability_gaps (id, user_id, bot_id, what, why, tried, created_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, bot.userId, bot.id, what, why, text(a.tried, 300), now(), now());
    }
    const loc = users.localeOf(bot.userId);
    rows.append(bot, { kind: "notice", tone: "info", text: tr(loc, "Missing capability noted for you: {what}. Nothing was installed. You will find it in Settings → Team.", { what: clip(what, 160) }), action: { kind: "settings", section: "team" } }, thread);
    audit(bot.userId, "system", `${bot.name}: ${tr(loc, "missing capability")} — ${clip(what, 160)}`, bot.id);
    return capabilityGaps.list(bot.userId).find((g) => g.id === id)!;
  },
  list: (userId: string): GapView[] => q.all<any>("SELECT * FROM capability_gaps WHERE user_id = ? AND status = 'open' ORDER BY last_at DESC", userId).map((r) => ({
    id: r.id, botId: r.bot_id, botName: bots.byId(r.bot_id)?.name ?? "", what: r.what, why: r.why, tried: r.tried, times: r.times, createdAt: r.created_at, lastAt: r.last_at,
  })),
  close: (userId: string, id: string): boolean => q.run("UPDATE capability_gaps SET status = 'done' WHERE id = ? AND user_id = ? AND status = 'open'", id, userId).changes > 0,
};
