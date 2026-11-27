import { config } from "../config.js";
import { bots, clip, rows, users, type BotRecord } from "../store.js";
import { bgTaskHooks } from "./bgtasks.js";
import { gt } from "./guardtext.js";
import { askAndWait, waitsOn } from "./team.js";
import type { ToolContext, ToolOutput } from "./tools.js";

/**
 * L25 — a question from a helper or a teammate goes first to the bot that gave it the work, not to the owner. When the
 * asking bot is a helper its parent is asked (a background task's worker keeps asking on its task card, which is the
 * owner's own channel for that task); when it is working on a message another bot
 * sent it, that bot is asked. The delegating bot answers for the owner when it can decide from what it knows (its
 * instructions, its memory, the conversation); otherwise it answers ASK_OWNER and the question goes to the owner as
 * before. A question the floor reserves for the owner — money, deleting, a secret or a code, signing, anything that
 * cannot be undone — always goes to the owner. When the delegating bot decided, its own chat (which the owner reads) gets
 * a "décidée pour toi" line saying what was asked and answered, which the owner can correct there or turn into a rule.
 * Idea from the Noah / Agent Zero audits (behaviour only, our own code).
 */

/** Questions only the owner may answer (the floor): never decided by another bot. */
const FLOOR = [
  /\b(pa(y|ie|yer|iement|yment)|acheter|achat|buy|purchase|order|commande[rz]?|€|\$|eur(os)?|usd|carte bancaire|credit card|abonnement|subscription|facture[rz]?|invoice|virement|transfer|refund|rembourse)/i,
  /\b(supprim|delete|effac|erase|remove|retir|wipe|résili|cancel my|close (the|my) account)/i,
  /\b(mot de passe|password|passcode|code (de|à|a) (vérification|validation|2fa|sms)|2fa|otp|secret|token|api key|clé d['’]api|cl[ée]s? priv)/i,
  /\b(sign(er|ature)?|contrat|contract|légal|legal|avocat|lawyer|consent|accord juridique)\b/i,
  /\b(irr[ée]versible|cannot be undone|ne peut pas être annul|d[ée]finitiv|permanent)/i,
  /\b(publi(er|sh|cation)|poster publiquement|post publicly|envoyer à tous|send to (all|everyone)|newsletter)/i,
];
export const isFloorQuestion = (question: string) => FLOOR.some((re) => re.test(question));

/** The bot that gave this bot its current work: its parent for a helper, else the bot whose message it answers. */
export function delegatorOf(bot: BotRecord, thread = 0, origin?: string): BotRecord | null {
  const ok = (b: BotRecord | null | undefined) => (b && b.kind === "agent" && b.userId === bot.userId && b.id !== bot.id ? b : null);
  // A background task's worker asks on its card in the main chat (bgtasks.ts): that card is the owner's channel for it.
  if (bot.parentId) return bgTaskHooks.isTaskHelper(bot.id) ? null : ok(bots.byId(bot.parentId));
  if (origin !== "bot") return null;
  const last = rows.recentMessages(bot.id, bot.generation, 10, thread).reverse().find((r) => r.body.kind === "message" && r.body.role === "user");
  return last && last.body.kind === "message" && last.body.origin?.kind === "bot" ? ok(bots.byId(last.body.origin.id)) : null;
}

export const ASK_OWNER = "ASK_OWNER";
/** This turn answers a question another bot passed up (the message it works on is one of ours). */
function answeringQuestion(c: ToolContext): boolean {
  const last = rows.recentMessages(c.bot.id, c.bot.generation, 10, c.thread ?? 0).reverse().find((r) => r.body.kind === "message" && r.body.role === "user");
  return !!last && last.body.kind === "message" && last.body.text.startsWith("[Question from ");
}
const WAIT_MS = () => Math.min(config.botWaitMaxSec, 120) * 1000;

/**
 * Called first by ask_user. Returns the tool's result when the delegating bot answered (or must be answered through the
 * final message), or null: the question then goes to the owner as before.
 */
export async function routeQuestion(a: Record<string, unknown>, c: ToolContext): Promise<ToolOutput | null> {
  const question = String(a.question ?? "").trim();
  if (!question || isFloorQuestion(question)) return null;
  const lead = delegatorOf(c.bot, c.thread ?? 0, c.origin);
  if (!lead) return null;
  const { isPaused } = await import("./loop.js");
  if (isPaused(lead)) return null;
  // The lead waits for this very turn's answer (bot_message with wait): asking it back would never end. The question
  // goes back to it as this turn's final words instead.
  if (waitsOn(lead.id, c.bot.id) && answeringQuestion(c))
    return { content: `Do not ask the user yourself: reply with exactly ${ASK_OWNER} as your final message — ${lead.name} then asks the user.`, summary: ASK_OWNER };
  if (waitsOn(lead.id, c.bot.id))
    return { content: `${lead.name} gave you this work and is waiting for your answer right now. Do not ask the user: end your turn with your question as your final message — it goes straight back to ${lead.name}, who will decide or ask the user.`, summary: lead.name };
  const options = (Array.isArray(a.options) ? a.options.map(String) : []).slice(0, 6);
  const ask = `[Question from ${c.bot.name}, about the work you gave it. Answer it yourself, for ${c.user.name}, when you can decide from what you know (your instructions, your memory, this conversation): reply with the answer only. If only ${c.user.name} can decide, reply with exactly ${ASK_OWNER}.]\n${question}${options.length ? `\nSuggested answers: ${options.join(" / ")}` : ""}`;
  const r = await askAndWait(c.bot, lead, ask, c.depth, !!c.tainted, WAIT_MS(), c.signal);
  if (r.kind !== "reply") return null;
  const answer = r.text.trim();
  if (!answer || answer.includes(ASK_OWNER)) return null;
  const loc = users.localeOf(c.bot.userId);
  rows.append(lead, { kind: "notice", tone: "info", text: gt(loc, "Question from {helper}, decided for you by {lead}: “{question}” → “{answer}”. Not what you want? Write the right answer here, or make it a rule.", { helper: c.bot.name, lead: lead.name, question: clip(question, 300), answer: clip(answer, 300) }) }, 0);
  bots.bumpUnread(lead.id);
  return { content: `${lead.name}, who gave you this work, answered for ${c.user.name}: ${clip(answer, 4000)}\nGo on with that answer. (${c.user.name} can see this decision and may correct it later.)`, summary: `${lead.name}: ${clip(answer, 60)}`, outside: r.tainted };
}
