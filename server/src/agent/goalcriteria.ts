/**
 * L89 — goals that say when they are really finished (idea from Spec Kit and agent-skills' "acceptance criteria"; our
 * own code):
 *
 * - When a goal is proposed (goal_propose criteria) or at its first round (goal_criteria), the bot sets 3 to 7 success
 *   criteria — each one a check someone could see from outside.
 * - A goal with criteria closes only with evidence for EACH criterion (goal_update complete, criteria_evidence), and does
 *   not close on its own: it stops at « attend ton accord » (status "blocked", review pending). The owner's « Valider »
 *   (goal action "accept") marks it complete; « Reprendre » sends it back to work.
 * - A goal without criteria behaves exactly as before.
 */
import { q } from "../db.js";
import type { BuiltinTool } from "./tools.js";
import { clip } from "../store.js";

q.run("CREATE TABLE IF NOT EXISTS goal_criteria (goal_id TEXT NOT NULL, idx INTEGER NOT NULL, text TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', PRIMARY KEY (goal_id, idx))");
q.run("CREATE TABLE IF NOT EXISTS goal_reviews (goal_id TEXT PRIMARY KEY, summary TEXT NOT NULL, evidence TEXT NOT NULL, at INTEGER NOT NULL)");

export const CRITERIA_MIN = 3;
export const CRITERIA_MAX = 7;

export interface Criterion { text: string; evidence?: string }

export const criteriaOf = (goalId: string): Criterion[] =>
  q.all<{ text: string; evidence: string }>("SELECT text, evidence FROM goal_criteria WHERE goal_id = ? ORDER BY idx", goalId).map((r) => ({ text: r.text, ...(r.evidence ? { evidence: r.evidence } : {}) }));

/** Checks and cleans a list of criteria: 3 to 7 non-empty lines. Returns the list or the problem in words. */
export function cleanCriteria(raw: unknown): string[] | string {
  if (!Array.isArray(raw)) return `Give ${CRITERIA_MIN} to ${CRITERIA_MAX} success criteria as a list.`;
  const list = raw.map((x) => clip(String(x ?? "").replace(/\s+/g, " ").trim(), 200)).filter(Boolean);
  if (list.length < CRITERIA_MIN || list.length > CRITERIA_MAX) return `Give ${CRITERIA_MIN} to ${CRITERIA_MAX} success criteria (you gave ${list.length}): each one a check someone could see from outside.`;
  return list;
}

export function setCriteria(goalId: string, list: string[]): void {
  q.tx(() => {
    q.run("DELETE FROM goal_criteria WHERE goal_id = ?", goalId);
    list.forEach((t, i) => q.run("INSERT INTO goal_criteria (goal_id, idx, text) VALUES (?, ?, ?)", goalId, i, t));
  });
}

/** Evidence for each criterion, in order: the problem in words, or null when every criterion has its evidence. */
export function recordEvidence(goalId: string, raw: unknown): string | null {
  const crit = criteriaOf(goalId);
  if (!crit.length) return null;
  const ev = Array.isArray(raw) ? raw.map((x) => clip(String(x ?? "").replace(/\s+/g, " ").trim(), 600)) : [];
  const missing = crit.map((c, i) => (ev[i] ? null : `${i + 1}. ${c.text}`)).filter(Boolean);
  if (ev.length !== crit.length || missing.length) return `Give criteria_evidence: one piece of evidence per success criterion, in order (${crit.length}). Missing:\n${missing.join("\n") || "(the list has the wrong length)"}`;
  q.tx(() => { ev.forEach((e, i) => q.run("UPDATE goal_criteria SET evidence = ? WHERE goal_id = ? AND idx = ?", e, goalId, i)); });
  return null;
}

export const reviewOf = (goalId: string) => q.get<{ summary: string; evidence: string }>("SELECT summary, evidence FROM goal_reviews WHERE goal_id = ?", goalId) ?? null;
export const startReview = (goalId: string, summary: string, evidence: string) => q.run("INSERT INTO goal_reviews (goal_id, summary, evidence, at) VALUES (?, ?, ?, ?) ON CONFLICT(goal_id) DO UPDATE SET summary = excluded.summary, evidence = excluded.evidence, at = excluded.at", goalId, summary, evidence, Date.now());
export const endReview = (goalId: string) => q.run("DELETE FROM goal_reviews WHERE goal_id = ?", goalId);

/** What the goal card adds: the criteria (with their evidence) and whether the goal waits for the owner's « Valider ». */
export function criteriaCard(goalId: string): { criteria?: Criterion[]; review?: boolean } {
  const criteria = criteriaOf(goalId);
  return { ...(criteria.length ? { criteria } : {}), ...(reviewOf(goalId) ? { review: true } : {}) };
}

/** The tool that sets the criteria of the conversation's goal (proposed or active). `find` is goals.openFor. */
export function criteriaTool(find: (botId: string, thread: number) => { id: string; status: string } | null, onSet: (goalId: string) => void): BuiltinTool {
  return {
    spec: {
      name: "goal_criteria",
      description: `Goal mode: set the ${CRITERIA_MIN} to ${CRITERIA_MAX} success criteria of this conversation's goal — each one a check someone could see from outside (a file that opens, a number reached, a page live). Do it at the first round. The goal then closes only with evidence for each criterion, and waits for the user's approval.`,
      inputSchema: { type: "object", properties: { criteria: { type: "array", items: { type: "string" }, description: `${CRITERIA_MIN} to ${CRITERIA_MAX} success criteria` } }, required: ["criteria"] },
    },
    activity: "planning", label: "Setting the goal's criteria", group: "tasks",
    run: async (a, c) => {
      const g = find(c.bot.id, c.thread ?? 0);
      if (!g || (g.status !== "active" && g.status !== "proposed")) return { content: "There is no open goal in this conversation.", isError: true };
      const list = cleanCriteria(a.criteria);
      if (typeof list === "string") return { content: list, isError: true };
      setCriteria(g.id, list);
      onSet(g.id);
      return { content: `Saved ${list.length} success criteria. Close the goal only with evidence for each one (goal_update complete with criteria_evidence).`, summary: `${list.length} criteria` };
    },
  };
}
