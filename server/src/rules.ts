import { q } from "./db.js";
import { clip, newId, now } from "./store.js";
import { RULE_TRIGGERS, type Rule, type RuleChange, type RuleTrigger } from "./shared.js";

/**
 * Rules in the user's own words (spec 07 A2): "ne jamais envoyer d'e-mail à un client sans me demander", "tu peux
 * réserver jusqu'à 50 €". They apply to every bot of the user (bot_id NULL) or to one bot. The bots see them in their
 * prompt; the reviewer of "auto" mode checks each sensitive action against them. A rule never widens what the
 * deterministic floor always asks about (payments, deletions…).
 *
 * Wave 5b: a rule can be tied to one routine, or to a trigger kind ("when an email arrives…"): it then applies only to
 * turns started by that routine / a routine of that kind — given to the bot in that turn's message and to the reviewer
 * for that turn. Rules can be added, changed or removed from the chat (rule_propose, always approved on a card); those
 * changes are recorded with the user's words and can be undone in one click.
 */
export const MAX_RULES = 60;
const toRule = (r: any): Rule => ({
  id: r.id, botId: r.bot_id ?? null, text: r.text, enabled: !!r.enabled, createdAt: r.created_at,
  routineId: r.routine_id ?? null, trigger: (RULE_TRIGGERS as readonly string[]).includes(r.trigger_kind) ? r.trigger_kind : null,
  source: r.source === "chat" ? "chat" : "user", quote: r.quote ?? "",
});
export const isRuleTrigger = (v: unknown): v is RuleTrigger => (RULE_TRIGGERS as readonly string[]).includes(String(v));

/** What started a turn, for scoped rules: the routine and its kind (null for any other turn). */
export interface RuleScope { routineId?: string | null; trigger?: string | null }

export const rules = {
  /** Every rule of the user (account-wide first, then per bot), for the settings page. */
  all: (userId: string) => q.all("SELECT * FROM rules WHERE user_id = ? ORDER BY bot_id IS NOT NULL, routine_id IS NOT NULL, trigger_kind IS NOT NULL, created_at", userId).map(toRule),
  /**
   * The rules that apply to one bot in a turn: the account's and its own, enabled only — and, for a turn a routine
   * started, the ones tied to that routine or to its trigger kind. Without a scope, only the rules that apply everywhere.
   */
  forBot: (userId: string, botId: string, scope: RuleScope = {}) =>
    q.all("SELECT * FROM rules WHERE user_id = ? AND enabled = 1 AND (bot_id IS NULL OR bot_id = ?) ORDER BY bot_id IS NOT NULL, created_at", userId, botId).map(toRule)
      .filter((r) => (!r.routineId && !r.trigger) || (!!r.routineId && r.routineId === scope.routineId) || (!r.routineId && !!r.trigger && r.trigger === scope.trigger)),
  /** Only the rules tied to this routine or its kind (what a routine's turn is told on top of the usual ones). */
  scopedFor: (userId: string, botId: string, scope: RuleScope) => rules.forBot(userId, botId, scope).filter((r) => r.routineId || r.trigger),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM rules WHERE id = ? AND user_id = ?", id, userId); return r ? toRule(r) : null; },
  count: (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rules WHERE user_id = ?", userId)!.n,
  create(userId: string, text: string, botId: string | null, extra: { routineId?: string | null; trigger?: RuleTrigger | null; source?: "user" | "chat"; quote?: string; id?: string; createdAt?: number } = {}): Rule {
    const id = extra.id ?? newId("rul");
    q.run("INSERT INTO rules (id, user_id, bot_id, text, routine_id, trigger_kind, source, quote, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, userId, botId, clip(text.trim(), 500), extra.routineId ?? null, extra.routineId ? null : extra.trigger ?? null, extra.source ?? "user", clip(extra.quote ?? "", 400), extra.createdAt ?? now());
    return toRule(q.get("SELECT * FROM rules WHERE id = ?", id));
  },
  update(id: string, f: { text?: string; enabled?: boolean; botId?: string | null; routineId?: string | null; trigger?: RuleTrigger | null }) {
    if (typeof f.text === "string" && f.text.trim()) q.run("UPDATE rules SET text = ? WHERE id = ?", clip(f.text.trim(), 500), id);
    if (typeof f.enabled === "boolean") q.run("UPDATE rules SET enabled = ? WHERE id = ?", f.enabled ? 1 : 0, id);
    if (f.botId !== undefined) q.run("UPDATE rules SET bot_id = ? WHERE id = ?", f.botId, id);
    if (f.routineId !== undefined || f.trigger !== undefined) q.run("UPDATE rules SET routine_id = ?, trigger_kind = ? WHERE id = ?", f.routineId ?? null, f.routineId ? null : f.trigger ?? null, id);
    return toRule(q.get("SELECT * FROM rules WHERE id = ?", id));
  },
  remove: (id: string) => q.run("DELETE FROM rules WHERE id = ?", id),
};

// ── Changes made from the chat (undoable) ───────────────────────────────────
const toChange = (r: any): RuleChange => ({ id: r.id, action: r.action, ruleId: r.rule_id, botId: r.bot_id ?? null, text: r.text, before: r.before ?? null, quote: r.quote, createdAt: r.created_at, undoneAt: r.undone_at ?? null });
export const ruleChanges = {
  list: (userId: string, limit = 20) => q.all("SELECT * FROM rule_changes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?", userId, limit).map(toChange),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM rule_changes WHERE id = ? AND user_id = ?", id, userId); return r ? toChange(r) : null; },
  /** Records a change; `snapshot`: the whole rule before it (to bring a removed or changed rule back as it was). */
  record(userId: string, f: { action: RuleChange["action"]; rule: Rule; before: Rule | null; botId: string | null; quote: string }): RuleChange {
    const id = newId("rch");
    q.run("INSERT INTO rule_changes (id, user_id, action, rule_id, bot_id, text, before, snapshot, quote, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, userId, f.action, f.rule.id, f.botId, f.rule.text, f.before?.text ?? null, JSON.stringify(f.before ?? {}), clip(f.quote, 400), now());
    return ruleChanges.owned(userId, id)!;
  },
  /** Puts things back as they were before the change. False when it was already undone. */
  undo(userId: string, id: string): boolean {
    const r = q.get<any>("SELECT * FROM rule_changes WHERE id = ? AND user_id = ? AND undone_at IS NULL", id, userId);
    if (!r) return false;
    const snap = (() => { try { return JSON.parse(r.snapshot || "{}"); } catch { return {}; } })() as Partial<Rule>;
    if (r.action === "add") rules.remove(r.rule_id);
    else if (r.action === "change" && snap.text) rules.update(r.rule_id, { text: snap.text, botId: snap.botId ?? null, routineId: snap.routineId ?? null, trigger: snap.trigger ?? null });
    else if (r.action === "remove" && snap.text && !rules.owned(userId, r.rule_id))
      rules.create(userId, snap.text, snap.botId ?? null, { id: r.rule_id, routineId: snap.routineId, trigger: snap.trigger, source: snap.source, quote: snap.quote, createdAt: snap.createdAt });
    q.run("UPDATE rule_changes SET undone_at = ? WHERE id = ?", now(), id);
    return true;
  },
};
