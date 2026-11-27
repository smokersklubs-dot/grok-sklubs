import { q } from "../db.js";
import { rules } from "../rules.js";
import { bots, clip, type BotRecord, type UserRecord } from "../store.js";

/**
 * L96 — helpers inherit their parent bot's standing instructions (backlog A-FAIRE L96; behaviour from the CopilotKit,
 * Hermes and OMB audits; our own code).
 *
 * A helper (helper_start) or a background task's worker (task_start) is a new hidden bot: before, it knew nothing of what
 * the owner told its parent ("always answer in English", "never contact this client"). Now its system prompt carries the
 * parent's standing instructions and the parent's own rules (the account-wide rules already apply to every bot), under a
 * heading that says whose they are. On by default; the owner can switch it off for the account (Settings → Team, the same
 * screen as « qui peut demander à qui »).
 * Only words for the prompt: an inherited rule never lets the helper do more by itself (the reviewer of authorize.ts
 * still reads the helper's own rules only, and every approval, the floor and the vault rules apply as before).
 */
q.run("CREATE TABLE IF NOT EXISTS helper_inherit (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL)");

export const inheritOn = (userId: string) => (q.get<{ enabled: number }>("SELECT enabled FROM helper_inherit WHERE user_id = ?", userId)?.enabled ?? 1) === 1;
export function setInherit(userId: string, on: boolean): boolean {
  q.run("INSERT INTO helper_inherit (user_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at", userId, on ? 1 : 0, Date.now());
  return on;
}

/** The block a helper's system prompt gets from its parent (prompt.ts); "" for a bot that is not a helper, or when off. */
export function inheritedBlock(bot: Pick<BotRecord, "parentId">, user: Pick<UserRecord, "id" | "name">): string {
  if (!bot.parentId || !inheritOn(user.id)) return "";
  const parent = bots.byId(bot.parentId);
  if (!parent || parent.userId !== user.id) return "";
  const own = rules.forBot(user.id, parent.id).filter((r) => r.botId === parent.id);
  const instructions = parent.instructions.trim();
  if (!instructions && !own.length) return "";
  const out = [`## Standing instructions ${user.name} gave ${parent.name}, the bot you work for (they apply to your work too)`];
  if (instructions) out.push(clip(instructions, 8000));
  if (own.length) out.push(`Rules ${user.name} set for ${parent.name} (follow them too; a rule that says to ask first wins):\n${own.map((r) => `- ${r.text}`).join("\n")}`);
  return out.join("\n");
}
