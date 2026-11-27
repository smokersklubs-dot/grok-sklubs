/**
 * L184 « tableaux de bord épinglés » (OpenClaw audit G20 "pinned dashboards" — behaviour only, our own code).
 *
 * A view card a bot drew in the chat (agent/viewcard.ts: figures, table, chart, progress) can be pinned to the owner's
 * dashboard. The dashboard shows, for each pin, the NEWEST view card with the same title in that bot's chat: when a
 * routine draws « Ventes de la semaine » again every Monday, the pin follows it. Nothing new is drawn: the same checked
 * data and the same components as in the chat. At most 12 pins; a form's fields are not offered on the dashboard.
 */
import { q } from "./db.js";
import { bots, newId, now, rows } from "./store.js";
import type { ViewCard } from "./viewtypes.js";

q.run(`CREATE TABLE IF NOT EXISTS dashboard_pins (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, title TEXT NOT NULL, seq INTEGER NOT NULL, position INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS dashboard_pins_user ON dashboard_pins (user_id, position)");

export const MAX_PINS = 12;
export interface DashboardPin { id: string; botId: string; botName: string; title: string; seq: number; updatedAt: number; card: ViewCard | null }

/** The newest view card titled `title` in the bot's main chat (last 400 rows), else the pinned one if still there. */
function newestView(botId: string, title: string, pinnedSeq: number): { seq: number; at: number; card: ViewCard } | null {
  const bot = bots.byId(botId);
  if (!bot) return null;
  const list = rows.list(bot.id, bot.generation, 400);
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r.body.kind === "card" && r.body.card.type === "view" && r.body.card.title === title) return { seq: r.seq, at: r.createdAt, card: r.body.card };
  }
  const pinned = rows.get(bot.id, bot.generation, pinnedSeq);
  return pinned?.body.kind === "card" && pinned.body.card.type === "view" ? { seq: pinned.seq, at: pinned.createdAt, card: pinned.body.card } : null;
}

/** A form is answered in the chat, not on the dashboard: its form blocks are left out. */
const forDashboard = (card: ViewCard): ViewCard => ({ ...card, blocks: card.blocks.filter((b) => b.kind !== "form") });

export const dashboard = {
  list(userId: string): DashboardPin[] {
    const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
    return q.all<any>("SELECT * FROM dashboard_pins WHERE user_id = ? ORDER BY position, created_at", userId).map((p) => {
      const v = newestView(p.bot_id, p.title, p.seq);
      return { id: p.id, botId: p.bot_id, botName: names.get(p.bot_id) ?? "?", title: p.title, seq: v?.seq ?? p.seq, updatedAt: v?.at ?? p.created_at, card: v ? forDashboard(v.card) : null };
    });
  },
  /** Pins the view card at `seq` of the owner's bot. Throws with a message for the owner. */
  pin(userId: string, botId: string, seq: number): DashboardPin[] {
    const bot = bots.owned(userId, botId);
    const row = bot ? rows.get(bot.id, bot.generation, seq) : null;
    if (!bot || row?.body.kind !== "card" || row.body.card.type !== "view") throw new Error("Only a view drawn in the chat can be pinned.");
    const title = row.body.card.title;
    if (!q.get("SELECT 1 FROM dashboard_pins WHERE user_id = ? AND bot_id = ? AND title = ?", userId, bot.id, title)) {
      const n = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM dashboard_pins WHERE user_id = ?", userId)!.n;
      if (n >= MAX_PINS) throw new Error(`The dashboard holds ${MAX_PINS} views: unpin one first.`);
      q.run("INSERT INTO dashboard_pins (id, user_id, bot_id, title, seq, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId("pin"), userId, bot.id, title, seq, n, now());
    }
    return dashboard.list(userId);
  },
  unpin: (userId: string, id: string) => q.run("DELETE FROM dashboard_pins WHERE id = ? AND user_id = ?", id, userId).changes > 0,
  /** Moves a pin one place up (-1) or down (+1). */
  move(userId: string, id: string, dir: -1 | 1): DashboardPin[] {
    const ids = q.all<{ id: string }>("SELECT id FROM dashboard_pins WHERE user_id = ? ORDER BY position, created_at", userId).map((r) => r.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i >= 0 && j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; ids.forEach((pid, k) => q.run("UPDATE dashboard_pins SET position = ? WHERE id = ?", k, pid)); }
    return dashboard.list(userId);
  },
};
