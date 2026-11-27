import { q } from "../db.js";
import { clip, rows, type BotRecord } from "../store.js";
import type { Trigger } from "./turn-request.js";

/**
 * L63 — « résumé de progression réutilisé si tu réécris après Stop » (backlog A-FAIRE L63; behaviour from the Nightly,
 * Noodle and Timon T24 audits; our own code).
 *
 * When the owner stops a turn (the Stop button, a typed « stop », « Tout arrêter », « Envoyer maintenant »), what that turn
 * had already done in its conversation — its steps (tool, status, short result) and the start of what it had written —
 * is kept as a short recap (stop_recaps, on disk). The next turn the owner starts in the same conversation, within a day,
 * gets that recap at the top: reuse the progress, do not start over, and take the new message into account first. Used
 * once, then dropped. A subscription tool (Claude Code, Codex) whose process was killed mid-turn may not have recorded
 * its last steps in its own session: the recap is built from what the chat shows, so it reaches the next turn either way.
 * Nothing is recorded when the stopped turn had done nothing yet.
 */
q.run("CREATE TABLE IF NOT EXISTS stop_recaps (bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL, recap TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (bot_id, thread))");

export const RECAP_TTL_MS = 24 * 3_600_000;
const MAX_STEPS = 25;

/** The steps the chat shows in this conversation since `since` (a turn's start), oldest first (L72 progress test too). */
export function stepsSince(bot: BotRecord, thread: number, since: number): { tool: string; args?: Record<string, unknown> }[] {
  return rows.list(bot.id, bot.generation, 300, undefined, thread).filter((r) => r.createdAt >= since).sort((a, b) => a.seq - b.seq)
    .flatMap((r) => (r.body.kind === "step" ? [{ tool: r.body.tool, args: r.body.args }] : []));
}

/** The recap of what a turn did in this conversation since `since` (its start); "" when it did nothing visible. */
export function recapSince(bot: BotRecord, thread: number, since: number): string {
  const list = rows.list(bot.id, bot.generation, 300, undefined, thread).filter((r) => r.createdAt >= since).sort((a, b) => a.seq - b.seq);
  const steps: string[] = [];
  let said = "";
  for (const r of list) {
    if (r.body.kind === "step") {
      const args = Object.entries(r.body.args ?? {}).slice(0, 3).map(([k, v]) => `${k}=${clip(typeof v === "string" ? v : JSON.stringify(v), 80)}`).join(", ");
      steps.push(`- ${r.body.tool}${args ? ` (${args})` : ""}: ${r.body.status}${r.body.summary ? ` — ${clip(r.body.summary, 160)}` : ""}`);
    } else if (r.body.kind === "message" && r.body.role === "assistant" && r.body.text.trim()) said = r.body.text;
  }
  if (!steps.length && !said.trim()) return "";
  const shown = steps.length > MAX_STEPS ? [`- (${steps.length - MAX_STEPS} earlier steps left out)`, ...steps.slice(-MAX_STEPS)] : steps;
  return [shown.length ? `Steps it had taken:\n${shown.join("\n")}` : "", said.trim() ? `It had already written: "${clip(said.replace(/\s+/g, " ").trim(), 600)}"` : ""].filter(Boolean).join("\n");
}

/** loop.ts, when the owner stopped a turn: keeps the recap of that turn for the next one in the conversation. */
export function noteStopped(bot: BotRecord, thread: number, since: number): boolean {
  const recap = recapSince(bot, thread, since);
  if (!recap) return false;
  q.run("INSERT INTO stop_recaps (bot_id, thread, generation, recap, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, thread) DO UPDATE SET generation = excluded.generation, recap = excluded.recap, at = excluded.at", bot.id, thread || 0, bot.generation, clip(recap, 6000), Date.now());
  return true;
}

/** Whether a turn is the owner's own (their message, or the answer to their note right after a stop). */
const ownersTurn = (t: Exclude<Trigger, { kind: "resume" }>) => (t.kind === "user" && !t.member && !t.api) || (t.kind === "system" && t.origin === "user");

/** The recap for the owner's next turn in this conversation (once); "" when there is none or it is too old. */
export function takeRecap(bot: BotRecord, thread: number, trigger: Exclude<Trigger, { kind: "resume" }>): string {
  if (!ownersTurn(trigger)) return "";
  const r = q.get<{ recap: string; generation: number; at: number }>("SELECT recap, generation, at FROM stop_recaps WHERE bot_id = ? AND thread = ?", bot.id, thread || 0);
  if (!r) return "";
  q.run("DELETE FROM stop_recaps WHERE bot_id = ? AND thread = ?", bot.id, thread || 0);
  if (r.generation !== bot.generation || Date.now() - r.at > RECAP_TTL_MS) return "";
  return `[Your previous turn in this conversation was stopped by the user before it finished. Reuse what it had already done — do not start over or redo it; check the current state when it matters — and take the user's new message into account first.\n${r.recap}]`;
}
