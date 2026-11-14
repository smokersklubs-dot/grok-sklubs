import { q } from "./db.js";
import { clip, newId, now } from "./store.js";
import type { Rule } from "./shared.js";

/**
 * Rules in the user's own words (spec 07 A2): "ne jamais envoyer d'e-mail à un client sans me demander", "tu peux
 * réserver jusqu'à 50 €". They apply to every bot of the user (bot_id NULL) or to one bot. The bots see them in their
 * prompt; the reviewer of "auto" mode checks each sensitive action against them. A rule never widens what the
 * deterministic floor always asks about (payments, deletions…).
 */
export const MAX_RULES = 60;
const toRule = (r: any): Rule => ({ id: r.id, botId: r.bot_id ?? null, text: r.text, enabled: !!r.enabled, createdAt: r.created_at });

export const rules = {
  /** Every rule of the user (account-wide first, then per bot), for the settings page. */
  all: (userId: string) => q.all("SELECT * FROM rules WHERE user_id = ? ORDER BY bot_id IS NOT NULL, created_at", userId).map(toRule),
  /** The rules that apply to one bot: the account's and its own, enabled only. */
  forBot: (userId: string, botId: string) => q.all("SELECT * FROM rules WHERE user_id = ? AND enabled = 1 AND (bot_id IS NULL OR bot_id = ?) ORDER BY bot_id IS NOT NULL, created_at", userId, botId).map(toRule),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM rules WHERE id = ? AND user_id = ?", id, userId); return r ? toRule(r) : null; },
  count: (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rules WHERE user_id = ?", userId)!.n,
  create(userId: string, text: string, botId: string | null): Rule {
    const id = newId("rul");
    q.run("INSERT INTO rules (id, user_id, bot_id, text, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, botId, clip(text.trim(), 500), now());
    return toRule(q.get("SELECT * FROM rules WHERE id = ?", id));
  },
  update(id: string, f: { text?: string; enabled?: boolean }) {
    if (typeof f.text === "string" && f.text.trim()) q.run("UPDATE rules SET text = ? WHERE id = ?", clip(f.text.trim(), 500), id);
    if (typeof f.enabled === "boolean") q.run("UPDATE rules SET enabled = ? WHERE id = ?", f.enabled ? 1 : 0, id);
    return toRule(q.get("SELECT * FROM rules WHERE id = ?", id));
  },
  remove: (id: string) => q.run("DELETE FROM rules WHERE id = ?", id),
};
