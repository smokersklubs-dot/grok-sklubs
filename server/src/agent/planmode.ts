import { q } from "../db.js";
import { tr } from "../i18n.js";
import { clip, rows, users, type BotRecord } from "../store.js";
import { groundable, type Decision } from "./authorize.js";
import { ask } from "./memory.js";
import { PLAN_OPTIONS } from "./richquestion.js";
import type { Turn } from "./loop.js";
import type { ToolUseBlock } from "../llm/index.js";

/**
 * L79 — « mode Plan » and « relire mon plan contre la demande » (backlog A-FAIRE L79; behaviour from the Plannotator,
 * mattpocock skills, Spec Kit and Timon T9 audits; our own code).
 *
 * - Plan mode, per conversation (bot + thread): typed « /plan <demande> » (or the route) turns it on. While it is on, the
 *   bot is told to look around (reading only) and put its plan in front of the owner with plan_propose; every tool that
 *   changes something (authorize.ts groundable: a sensitive tool, a gate, an app write, something that carries outside
 *   content further…) is refused with a plain reason until the owner approves a plan proposed since it was turned on.
 *   Approving (« Approuver », « Approuver avec une note ») ends plan mode for that conversation; « /plan off » too.
 *   Plan mode only ADDS refusals: an approved plan never lifts an approval, the floor or a vault rule.
 * - « Relire mon plan contre la demande »: a separate model call (no tools, the helper model, memory.ts ask) compares a plan
 *   card with the owner's request it answers and lists what the plan leaves out and what it adds that was not asked. The
 *   result is shown under the card; the owner then answers the card as usual.
 */
q.run("CREATE TABLE IF NOT EXISTS plan_mode (bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, since INTEGER NOT NULL, PRIMARY KEY (bot_id, thread))");

export const planModeOn = (botId: string, thread: number) => q.get<{ since: number }>("SELECT since FROM plan_mode WHERE bot_id = ? AND thread = ?", botId, thread || 0)?.since ?? null;
export function setPlanMode(botId: string, thread: number, on: boolean): boolean {
  if (on) q.run("INSERT INTO plan_mode (bot_id, thread, since) VALUES (?, ?, ?) ON CONFLICT(bot_id, thread) DO UPDATE SET since = excluded.since", botId, thread || 0, Date.now());
  else q.run("DELETE FROM plan_mode WHERE bot_id = ? AND thread = ?", botId, thread || 0);
  return on;
}

/** « /plan <request> » → on (with the request), « /plan off » → off; null: not the command. */
export function planCommand(raw: string): { on: true; text: string } | { on: false } | null {
  const m = /^\s*\/plan(?:\s+([\s\S]*))?$/i.exec(String(raw ?? ""));
  if (!m) return null;
  const rest = (m[1] ?? "").trim();
  if (/^(off|stop|arr[eê]t|fin|non|no)$/i.test(rest)) return { on: false };
  return { on: true, text: rest };
}

/** What the model is told at the top of a turn while plan mode is on. */
export const PLAN_MODE_NOTE = "[Plan mode is on for this conversation: before changing anything, look around as much as you need (reading only), then put your plan in front of the user with plan_propose and end your turn. Tools that change something are refused until the user approves a plan.]";

const APPROVALS = [...PLAN_OPTIONS.en.slice(0, 2), ...PLAN_OPTIONS.fr.slice(0, 2)].map((s) => s.toLowerCase());
/** Whether an answer on a plan card approves it ("Approve", "Approve with a note: …"). */
export const approves = (answer: string | undefined) => { const a = String(answer ?? "").trim().toLowerCase(); return APPROVALS.some((o) => a === o || a.startsWith(`${o}:`) || a.startsWith(`${o} :`) || a.startsWith(`${o} —`) || a.startsWith(`${o}\n`)); };

/** A plan card of this conversation approved since `since`. */
function approvedSince(bot: BotRecord, thread: number, since: number): boolean {
  const list = q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'card' AND body LIKE '%\"plan\":%' AND created_at >= ? ORDER BY seq DESC LIMIT 5", bot.id, bot.generation, thread || 0, since);
  for (const r of list) {
    try {
      const c = (JSON.parse(r.body) as { card?: { status?: string; answer?: string; plan?: unknown } });
      if (c.card?.plan && c.card.status === "answered" && approves(c.card.answer)) return true;
    } catch { /* unreadable row */ }
  }
  return false;
}

/**
 * Before a call (loop.ts processCalls, ahead of the usual decision): in plan mode, a tool that changes something is
 * refused until a plan is approved. Null: plan mode has nothing to say (the usual decision follows).
 */
export function planGate(turn: Pick<Turn, "bot" | "user" | "thread" | "builtin" | "remote">, call: ToolUseBlock): Decision | null {
  const since = planModeOn(turn.bot.id, turn.thread);
  if (since === null || call.name === "plan_propose" || !groundable(turn, call.name)) return null;
  if (approvedSince(turn.bot, turn.thread, since)) {
    setPlanMode(turn.bot.id, turn.thread, false);
    rows.append(turn.bot, { kind: "notice", tone: "info", text: tr(turn.user.locale, "Plan approved: plan mode is off for this conversation, I am getting on with it.") });
    return null;
  }
  return { kind: "block", reason: "Plan mode is on: nothing may be changed before the user approves a plan. Put your plan in front of them with plan_propose and end your turn." };
}

// ── « Relire mon plan contre la demande » ──
export interface PlanReview { verdict: "ok" | "gaps"; missing: string[]; extra: string[]; note: string }

const REVIEW_SYSTEM = "You compare a plan with the request it is meant to carry out. Answer with ONE line of JSON only: {\"verdict\":\"ok\"|\"gaps\",\"missing\":[\"what the request asks that no step covers\"],\"extra\":[\"steps that do something the request did not ask\"],\"note\":\"one short sentence\"}. Each list has at most 5 short items, in the request's language. verdict is ok when nothing is missing.";

/** The review in a model's answer; null when unreadable. */
export function readReview(answer: string): PlanReview | null {
  const m = /\{[\s\S]*\}/.exec(String(answer ?? ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => clip(String(x ?? "").replace(/\s+/g, " ").trim(), 200)).filter(Boolean).slice(0, 5) : []);
    const missing = list(j.missing);
    const verdict = j.verdict === "ok" && !missing.length ? "ok" : "gaps";
    return { verdict, missing, extra: list(j.extra), note: clip(String(j.note ?? "").replace(/\s+/g, " ").trim(), 240) };
  } catch { return null; }
}

/** The plan card at `seq` and the owner's request before it in the same conversation; null when `seq` is not a plan card. */
export function planAndRequest(bot: BotRecord, seq: number): { steps: string[]; title: string; request: string; thread: number } | null {
  const row = rows.get(bot.id, bot.generation, seq);
  if (row?.body.kind !== "card" || row.body.card.type !== "question" || !row.body.card.plan) return null;
  const thread = row.thread ?? 0;
  const before = rows.list(bot.id, bot.generation, 200, seq, thread).filter((r) => r.body.kind === "message" && r.body.role === "user" && !(r.body.origin && r.body.origin.kind === "bot"));
  const last = before[before.length - 1];
  const request = last?.body.kind === "message" ? last.body.text : "";
  return { steps: row.body.card.plan.steps, title: row.body.card.question, request, thread };
}

/** Runs the review and writes it under the card. Throws a plain error when there is nothing to compare. */
export async function reviewPlan(bot: BotRecord, seq: number, run: typeof ask = ask): Promise<PlanReview> {
  const loc = users.localeOf(bot.userId);
  const found = planAndRequest(bot, seq);
  if (!found) throw new Error(tr(loc, "That is not a plan card."));
  if (!found.request.trim()) throw new Error(tr(loc, "I cannot find your request before this plan."));
  const answer = await run(bot, REVIEW_SYSTEM, `Request:\n${clip(found.request, 6000)}\n\nPlan "${found.title}":\n${found.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  const review = readReview(answer);
  if (!review) throw new Error(tr(loc, "The review could not be read. Try again."));
  const parts = [review.verdict === "ok" ? tr(loc, "Plan review: every point of your request is covered.") : tr(loc, "Plan review: some points of your request are not covered.")];
  if (review.missing.length) parts.push(tr(loc, "Missing: {list}.", { list: review.missing.join(" ; ") }));
  if (review.extra.length) parts.push(tr(loc, "Not asked: {list}.", { list: review.extra.join(" ; ") }));
  if (review.note) parts.push(review.note);
  rows.append(bot, { kind: "notice", tone: review.verdict === "ok" ? "info" : "warn", text: parts.join(" ") }, found.thread || undefined);
  return review;
}
