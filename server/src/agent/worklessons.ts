/**
 * Work lessons for ordinary work, the rest of L70 (audits claude-mem, Noodle, mem0; docs/cleanroom/10-timon.md T66 —
 * ideas only). The chantiers already keep their lessons with evidence (chantiers.ts); this covers every other goal:
 *
 *  - when a goal ends (« fini », « bloqué », « limite atteinte »), a lesson line is kept apart from the notes: what was
 *    asked, how it ended, the bot's own summary and its next steps (the summary's « Next steps / Prochaines étapes »
 *    part when it wrote one), the reason when blocked. No model call: it is the goal's own record.
 *  - the week's review (« Bilan de la semaine »): how many goals ended well or not, per bot, and the failures that came
 *    back at least twice with a similar reason, each turned into a PROPOSED rule. Nothing is written by itself: the
 *    owner accepts (it becomes one of their rules, for that bot) or dismisses a proposal; a dismissed one is not
 *    proposed again.
 *
 * Tables at load; rows go with their bot.
 */
import { createHash } from "node:crypto"; import { tr } from "../i18n.js";
import { q } from "../db.js";
import { rules } from "../rules.js";
import { bots, clip, now, users } from "../store.js";
import { onGoalStatus, type GoalRecord } from "./goals.js";
import { similar } from "./memory.js";

q.run(`CREATE TABLE IF NOT EXISTS work_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL UNIQUE, outcome TEXT NOT NULL, objective TEXT NOT NULL, summary TEXT NOT NULL, next_steps TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS work_lessons_user ON work_lessons(user_id, at)");
q.run(`CREATE TABLE IF NOT EXISTS work_lesson_proposals (
  key TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, rule_id TEXT, at INTEGER NOT NULL, PRIMARY KEY (user_id, key))`);

export type Outcome = "success" | "failure";
export interface WorkLesson { id: number; botId: string; goalId: string; outcome: Outcome; objective: string; summary: string; nextSteps: string; reason: string; at: number }
export interface RuleProposal { key: string; botId: string; botName: string; text: string; evidence: string[]; count: number }
export interface WeekReview { from: number; to: number; success: number; failure: number; perBot: { botId: string; name: string; success: number; failure: number }[]; proposals: RuleProposal[] }

const WEEK = 7 * 86400_000;
const toLesson = (r: any): WorkLesson => ({ id: r.id, botId: r.bot_id, goalId: r.goal_id, outcome: r.outcome, objective: r.objective, summary: r.summary, nextSteps: r.next_steps, reason: r.reason, at: r.at });

/** The « next steps » part of a summary, when the bot wrote one (a heading or a line starting with it). */
export function nextStepsOf(summary: string): string {
  const m = /(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?(?:next steps|prochaines? étapes?|à suivre|ensuite)(?:\*\*)?\s*:?\s*\n?([\s\S]{1,800})/i.exec(summary);
  return m ? clip(m[1].trim(), 600) : "";
}

export function recordLesson(g: Pick<GoalRecord, "id" | "botId" | "userId" | "status" | "objective" | "summary" | "evidence" | "reason">, at = now()): WorkLesson | null {
  if (!["complete", "blocked", "limit"].includes(g.status)) return null;
  const outcome: Outcome = g.status === "complete" ? "success" : "failure";
  const summary = clip((g.summary || g.evidence || "").trim(), 1500);
  q.run("INSERT OR IGNORE INTO work_lessons (user_id, bot_id, goal_id, outcome, objective, summary, next_steps, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    g.userId, g.botId, g.id, outcome, clip(g.objective, 400), summary, nextStepsOf(summary), clip(g.reason || (g.status === "limit" ? "round limit reached" : ""), 400), at);
  const r = q.get("SELECT * FROM work_lessons WHERE goal_id = ?", g.id);
  return r ? toLesson(r) : null;
}
// Chantier tasks keep their own lessons with evidence (chantiers.ts): not counted twice here.
onGoalStatus((g) => { if (g.origin !== "chantier") { try { recordLesson(g); } catch (err) { console.error("[work lessons]", (err as Error).message); } } });

export const workLessons = {
  list: (userId: string, limit = 50) => q.all("SELECT * FROM work_lessons WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?", userId, Math.min(200, limit)).map(toLesson),
};

const keyOf = (botId: string, reason: string) => createHash("sha256").update(`${botId}\n${reason.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 16);

/** The week's review. Proposals: failures of one bot whose reasons look alike, at least twice; dismissed or accepted ones are not offered again. */
export function weekReview(userId: string, at = now()): WeekReview {
  const from = at - WEEK;
  const list = q.all("SELECT * FROM work_lessons WHERE user_id = ? AND at >= ? AND at <= ? ORDER BY at", userId, from, at).map(toLesson);
  const fr = users.localeOf(userId) === "fr";
  const perBot = new Map<string, { botId: string; name: string; success: number; failure: number }>();
  for (const l of list) {
    const b = perBot.get(l.botId) ?? { botId: l.botId, name: bots.byId(l.botId)?.name ?? "?", success: 0, failure: 0 };
    b[l.outcome]++;
    perBot.set(l.botId, b);
  }
  const done = new Set(q.all<{ key: string }>("SELECT key FROM work_lesson_proposals WHERE user_id = ?", userId).map((r) => r.key));
  const proposals: RuleProposal[] = [];
  const failures = list.filter((l) => l.outcome === "failure" && l.reason.trim());
  const used = new Set<number>();
  for (const f of failures) {
    if (used.has(f.id)) continue;
    const group = failures.filter((x) => !used.has(x.id) && x.botId === f.botId && (x.id === f.id || similar(x.reason, f.reason)));
    if (group.length < 2) continue;
    for (const x of group) used.add(x.id);
    const key = keyOf(f.botId, f.reason);
    if (done.has(key)) continue;
    const reason = clip(f.reason.replace(/\s+/g, " ").trim(), 200);
    proposals.push({
      key, botId: f.botId, botName: perBot.get(f.botId)?.name ?? "?", count: group.length,
      text: tr(users.localeOf(userId), "Before starting a piece of work, first check what blocked it {n} times this week: {reason}. If it still holds, tell me at once.", { n: group.length, reason }),
      evidence: group.map((x) => clip(x.objective, 120)),
    });
  }
  return { from, to: at, success: list.filter((l) => l.outcome === "success").length, failure: list.filter((l) => l.outcome === "failure").length, perBot: [...perBot.values()], proposals };
}

export class LessonError extends Error { constructor(public status: 404 | 409, message: string) { super(message); } }

/** The owner's answer to a proposal: « Accepter » makes it one of their rules for that bot; « Écarter » never offers it again. */
export function answerProposal(userId: string, key: string, accept: boolean, at = now()) {
  if (q.get("SELECT 1 FROM work_lesson_proposals WHERE user_id = ? AND key = ?", userId, key)) throw new LessonError(409, "This proposal was already answered.");
  const p = weekReview(userId, at).proposals.find((x) => x.key === key);
  if (!p) throw new LessonError(404, "This proposal is no longer offered.");
  const rule = accept ? rules.create(userId, p.text, bots.owned(userId, p.botId) ? p.botId : null, { source: "user" }) : null;
  q.run("INSERT INTO work_lesson_proposals (key, user_id, status, rule_id, at) VALUES (?, ?, ?, ?, ?)", key, userId, accept ? "accepted" : "dismissed", rule?.id ?? null, at);
  return { rule };
}
