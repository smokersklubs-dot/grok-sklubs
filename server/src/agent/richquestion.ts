import type { Card } from "../shared.js";
import { q } from "../db.js";
import { clip, rows, type BotRecord } from "../store.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L79 — rich question cards and a plan to approve (backlog A-FAIRE L79; behaviour from the Plannotator, mattpocock skills,
 * Hermes, Timon T9 and Spec Kit audits, our own code).
 *
 * ask_user now takes, besides the question and its ready-made answers:
 * - why: one line on why the bot asks; recommended: the answer it suggests (must be one of the options), shown first and
 *   marked; irreversible: the answer leads to something that cannot be undone (the card says so; approvals still apply);
 * - multiple: several answers may be ticked; images: pictures from the bot's own files (paths under files/ or uploads/),
 *   never outside addresses (a picture from the web would tell that site the owner opened the card);
 * - questions: 2 to 4 questions answered on ONE card (each with its options, recommendation, multiple).
 * plan_propose puts a plan in front of the owner: approve, approve with a note, or ask for changes. A new version in the
 * same conversation shows what was added and removed since the previous one.
 * The answer still reaches the bot as the owner's next message, exactly as before (routes.ts cards/:seq/answer).
 */
type QuestionCard = Extract<Card, { type: "question" }>;
type Item = NonNullable<QuestionCard["questions"]>[number];

export const MAX_OPTIONS = 6;
export const MIN_QUESTIONS = 2;
export const MAX_QUESTIONS = 4;
export const MAX_IMAGES = 4;

const strs = (v: unknown, max: number, len = 200) => (Array.isArray(v) ? v.map((x) => clip(String(x ?? "").trim(), len)).filter(Boolean).slice(0, max) : []);
const own = (p: string) => /^(files|uploads)\/[^\0]+$/.test(p) && !p.split("/").includes("..");

function item(raw: Record<string, unknown>): Item | null {
  const question = clip(String(raw.question ?? "").trim(), 500);
  if (!question) return null;
  const options = strs(raw.options, MAX_OPTIONS);
  const rec = clip(String(raw.recommended ?? "").trim(), 200);
  return { question, options, ...(rec && options.includes(rec) ? { recommended: rec } : {}), ...(raw.multiple === true && options.length > 1 ? { multiple: true } : {}), ...(typeof raw.why === "string" && raw.why.trim() ? { why: clip(raw.why.trim(), 300) } : {}) };
}

/** The card for an ask_user call (an error text when the call is not usable). */
export function questionCard(a: Record<string, unknown>): QuestionCard | { error: string } {
  const main = item(a);
  if (!main) return { error: "Write the question." };
  const card: QuestionCard = { type: "question", question: main.question, options: main.options, status: "pending" };
  if (main.recommended) card.recommended = main.recommended;
  if (main.multiple) card.multiple = true;
  if (main.why) card.why = main.why;
  if (a.irreversible === true) card.irreversible = true;
  const images = strs(a.images, MAX_IMAGES, 300).filter(own);
  if (images.length) card.images = images;
  if (Array.isArray(a.questions) && a.questions.length) {
    const list = a.questions.map((x) => (x && typeof x === "object" ? item(x as Record<string, unknown>) : null)).filter((x): x is Item => !!x);
    if (list.length < MIN_QUESTIONS || list.length > MAX_QUESTIONS) return { error: `questions: give ${MIN_QUESTIONS} to ${MAX_QUESTIONS} questions (or ask a single one without it).` };
    card.questions = list;
  }
  return card;
}

/** Extra properties of ask_user's input schema. */
export const QUESTION_PROPS = {
  why: { type: "string", description: "One line: why you need this answer" },
  recommended: { type: "string", description: "The answer you suggest (one of the options)" },
  irreversible: { type: "boolean", description: "True when the answer leads to something that cannot be undone" },
  multiple: { type: "boolean", description: "The user may pick several options" },
  images: { type: "array", items: { type: "string" }, description: `Up to ${MAX_IMAGES} pictures from your own files (paths starting with files/ or uploads/) to show with the question` },
  questions: {
    type: "array", description: `To ask ${MIN_QUESTIONS} to ${MAX_QUESTIONS} related questions on one card (then "question" is the card's title)`,
    items: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } }, recommended: { type: "string" }, multiple: { type: "boolean" }, why: { type: "string" } }, required: ["question"] },
  },
};

/** The steps of the last plan proposed in this conversation, for the "what changed" of a new version. */
function lastPlan(bot: BotRecord, thread: number): { steps: string[]; version: number } | null {
  const r = q.get<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'card' AND body LIKE '%\"plan\":%' ORDER BY seq DESC LIMIT 1", bot.id, bot.generation, thread);
  if (!r) return null;
  try { const c = (JSON.parse(r.body) as { card?: QuestionCard }).card; return c?.plan ? { steps: c.plan.steps, version: c.plan.version } : null; } catch { return null; }
}

export const PLAN_OPTIONS = { en: ["Approve", "Approve with a note", "Change it"], fr: ["Approuver", "Approuver avec une note", "Le modifier"] };

/** A plan card: its steps, its version and, from version 2 on, the steps added and removed since the last one. */
export function planCard(bot: BotRecord, thread: number, a: Record<string, unknown>, locale: "fr" | "en"): QuestionCard | { error: string } {
  const title = clip(String(a.title ?? "").trim(), 200);
  const steps = strs(a.steps, 20, 400);
  if (!title || steps.length < 2) return { error: "A plan needs a title and at least 2 steps." };
  const prev = lastPlan(bot, thread);
  const plan: NonNullable<QuestionCard["plan"]> = { steps, version: (prev?.version ?? 0) + 1 };
  if (prev) { plan.added = steps.filter((s) => !prev.steps.includes(s)); plan.removed = prev.steps.filter((s) => !steps.includes(s)); }
  const card: QuestionCard = { type: "question", question: title, options: PLAN_OPTIONS[locale], status: "pending", plan, recommended: PLAN_OPTIONS[locale][0] };
  if (typeof a.why === "string" && a.why.trim()) card.why = clip(a.why.trim(), 300);
  if (a.irreversible === true) card.irreversible = true;
  return card;
}

/** Puts the card in the chat (the turn's conversation). */
export const postQuestion = (bot: BotRecord, card: QuestionCard, thread?: number) => rows.append(bot, { kind: "card", card }, thread || undefined);

export const planTools: BuiltinTool[] = [{
  spec: {
    name: "plan_propose",
    description: "Before a medium or long task, or one with steps that cannot be undone, put your plan in front of the user to approve: a title, 2 to 20 short steps, and why. They approve it, approve it with a note, or ask for changes; their answer arrives as their next message. This ends your turn. To propose a revised plan, call it again: the card shows what changed since the last version.",
    inputSchema: { type: "object", properties: { title: { type: "string", description: "What the plan is for" }, steps: { type: "array", items: { type: "string" }, description: "The steps, in order, one short line each" }, why: { type: "string", description: "One line: why you ask before starting" }, irreversible: { type: "boolean", description: "True when a step cannot be undone" } }, required: ["title", "steps"] },
  },
  activity: "waiting", label: "Proposing a plan",
  async run(a: Record<string, any>, c: ToolContext): Promise<ToolOutput> {
    const card = planCard(c.bot, c.thread ?? 0, a, c.user.locale === "fr" ? "fr" : "en");
    if ("error" in card) return { content: card.error, isError: true };
    postQuestion(c.bot, card, c.thread);
    return { content: `Plan v${card.plan!.version} is in front of the user. Stop here and wait for their answer; do not start the work before they approve it.`, summary: `v${card.plan!.version} · ${clip(card.question, 60)}`, endTurn: true };
  },
}];
