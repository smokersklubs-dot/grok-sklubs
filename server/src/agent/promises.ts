import { rows } from "../store.js";
import { gt } from "./guardtext.js";
import type { Turn } from "./loop.js";

/**
 * L21 — "I'll do it" is not "it is done". A turn that ends on a promise or on "shall I go on?" without calling any tool
 * (« je m'en occupe », « je continue ? », "I'll fetch the rest") is sent back to do the work, at most MAX_PROMISE_NUDGES
 * times; after that the turn ends with an honest notice instead of being counted as a success. Same for a routine whose
 * only words are a waiting line. Idea from the CopilotKit / OpenClaw audits (behaviour only, our own code).
 *
 * Only the end of the reply is looked at (its last ~260 characters): a full report that says "I'll explain below" earlier
 * is not a promise. A turn that waits for the user on purpose (ask_user, a card) or a goal round is left alone.
 */
export const MAX_PROMISE_NUDGES = 2;

const PATTERNS: RegExp[] = [
  // French
  /\bje\s+m['’](en|y)\s+(occupe|charge|mets|attaque)\b/i,
  /\bje\s+(vais|m['’]en vais)\s+(m['’]en\s+occuper|le\s+faire|la\s+faire|les\s+faire|faire|chercher|regarder|vérifier|verifier|lancer|récupérer|recuperer|continuer|préparer|preparer|envoyer|creuser|analyser|rédiger|rediger|commencer)\b/i,
  /\bje\s+(continue|poursuis|reprends|lance|m['’]y\s+remets)\s*(\?|…|\.\.\.)/i,
  /\b(tu\s+veux|voulez-vous|veux-tu)\s+(que\s+je\s+)?(continue|poursuive|continuer|poursuivre|lance|aille plus loin)/i,
  /\b(on|je)\s+(continue|y\s+va)\s*\?/i,
  /\b(je\s+reviens\s+(vers\s+toi|vers\s+vous|avec)|je\s+te\s+tiens\s+au\s+courant|un\s+instant|patiente|je\s+regarde\s+ça|je\s+regarde\s+ca)\b/i,
  // English
  /\bI['’]?(ll| will| am going to|'m going to| am about to)\s+(now\s+)?(fetch|get|grab|look|check|do|handle|take care|continue|start|run|go|dig|search|prepare|send|write|work|pull|gather|finish)\b/i,
  /\b(shall|should|can)\s+I\s+(continue|go on|proceed|keep going|start)\b[^.!]*\?/i,
  /\b(want|would you like)\s+me\s+to\s+(continue|go on|proceed|keep going|do (it|that|this))\b[^.!]*\?/i,
  /\b(let me|give me a (moment|minute|sec))\b(?!\s+know)/i,
  /\b(working on it|on it!|stand by|hang tight|I['’]ll get back to you|I['’]ll report back)\b/i,
];

/** Whether the end of this reply is a promise to act (or a "shall I go on?") rather than a result. */
export function endsOnPromise(said: string): boolean {
  // Quoted words are not the bot's own promise: a reply that quotes a question or a tool's instructions (« Comment on
  // continue ? », "I'll check") is a citation. Quoted spans are taken out before looking.
  // Taken out on the whole reply first, so a quotation that starts before the tail is not cut in half.
  const tail = said.replace(/"[^"\n]{0,400}"|«[^»\n]{0,400}»|“[^”\n]{0,400}”/g, " ").trim().slice(-260);
  if (!tail) return false;
  return PATTERNS.some((p) => p.test(tail));
}

const nudges = new WeakMap<object, number>();

/** Work the bot was asked to do (by its owner, a member, the Bot API, a routine, or a bot that waits for the answer). */
function isWork(turn: Pick<Turn, "origin" | "ask" | "goalId" | "waitsUser">): boolean {
  if (turn.goalId || turn.waitsUser) return false;
  return !!turn.ask || ["user", "api", "member", "routine", "resume"].includes(turn.origin ?? "");
}

const NUDGE = "[System: your last reply announced work (or asked whether to go on) but you did not call any tool, so nothing was done. Do the work now with your tools, in this turn — the user asked for it. If you truly cannot do it, say plainly what blocks you and what you need. Do not announce it again.]";

/**
 * Called when a step ended with words and no tool call. Returns the nudge to send back to the model (the turn goes on),
 * or null. After MAX_PROMISE_NUDGES nudges, a notice says plainly that the work was not done, and null is returned.
 */
export function promiseNudge(turn: Turn, said: string): string | null {
  if (!said || !isWork(turn) || !endsOnPromise(said)) return null;
  const n = nudges.get(turn) ?? 0;
  if (n < MAX_PROMISE_NUDGES) { nudges.set(turn, n + 1); return NUDGE; }
  if (n === MAX_PROMISE_NUDGES) {
    nudges.set(turn, n + 1);
    // Not a success: like a missing report (loop.ts), the run is not "done" and a waiting bot gets no promise as its answer.
    turn.missingReport = true;
    turn.lastText = "";
    rows.append(turn.bot, { kind: "notice", tone: "warn", text: gt(turn.user.locale, "{bot} said it would do it, but did not (asked {n} times to do the work). Nothing is confirmed: ask again, or tell it how to go on.", { bot: turn.bot.name, n: MAX_PROMISE_NUDGES }) }, turn.thread);
  }
  return null;
}
