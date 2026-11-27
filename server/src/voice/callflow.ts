import type { Card, Locale } from "../shared.js";
import { needsFloorCode } from "../floorapproval.js";

/**
 * L154 — a call that never leaves the user in silence (backlog A-FAIRE L154; behaviour from the OMB, Rakazo, CopilotKit and
 * Hermes audits, our own code). Pure helpers used by voice/session.ts:
 *
 *  - the short sentences the call says by itself (an immediate « D'accord, je regarde. », « Je travaille encore. » every
 *    30 s while the bot works, « La suite est écrite dans le chat. » after a long answer, the approval question);
 *  - `clearYesNo`: a spoken approval counts only when the whole utterance is a clear « oui » or « non » (a few polite
 *    words allowed: « oui merci », « non, pas maintenant »). « oui mais… », « non… enfin oui » or anything longer is not an
 *    answer;
 *  - `voiceApprovable`: which approval cards may be answered by voice at all. Never the floor (an action that cannot be
 *    undone — a payment, a deletion, a message sent — or a single-use card that says why it always asks: floorapproval.ts
 *    needsFloorCode), never a payment or a deletion by name, never the private cards (a card number, the vault, a code, the
 *    owner's own computer: the same list as the chat channels, telegram.ts privateApproval), and never for someone who is
 *    not the bot's owner. Those are answered on the screen; the call says so.
 */

const PHRASES = {
  fr: {
    ack: ["D'accord, je regarde.", "Bien reçu, je m'en occupe.", "OK, un instant."],
    waiting: ["Je travaille encore.", "Toujours dessus, encore un moment.", "Ça avance, je reviens vers toi."],
    rest: "La suite est écrite dans le chat.",
    ask: "J'ai besoin de ton accord : {title}. Dis oui ou non.",
    onScreen: "J'ai besoin de ton accord pour : {title}. Celui-là se valide à l'écran.",
    unclear: "Je n'ai pas compris. Dis juste oui ou non, ou réponds à l'écran.",
    giveUp: "Je laisse la demande à l'écran : réponds-y quand tu veux.",
    yes: "C'est noté, j'y vais.",
    no: "D'accord, je ne le fais pas.",
  },
  en: {
    ack: ["Okay, I'm looking.", "Got it, I'm on it.", "Okay, one moment."],
    waiting: ["I'm still working on it.", "Still on it, one more moment.", "It's moving along, I'll get back to you."],
    rest: "The rest is written in the chat.",
    ask: "I need your approval: {title}. Say yes or no.",
    onScreen: "I need your approval for: {title}. That one is approved on the screen.",
    unclear: "I didn't get that. Just say yes or no, or answer on the screen.",
    giveUp: "I'll leave the request on the screen: answer it whenever you like.",
    yes: "Noted, I'm doing it.",
    no: "Okay, I won't do it.",
  },
} as const;
export type PhraseKey = Exclude<keyof (typeof PHRASES)["fr"], "ack" | "waiting">;

export interface CallPhrases {
  ack(n: number): string;
  waiting(n: number): string;
  say(key: PhraseKey, vars?: Record<string, string>): string;
}
export function callPhrases(locale: Locale): CallPhrases {
  const p = locale === "fr" ? PHRASES.fr : PHRASES.en;
  return {
    ack: (n) => p.ack[Math.abs(n) % p.ack.length],
    waiting: (n) => p.waiting[Math.abs(n) % p.waiting.length],
    say: (key, vars = {}) => p[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ""),
  };
}

/** When the call speaks by itself (ms). */
export const ACK_AFTER_MS = 800;
export const STILL_WORKING_MS = 30_000;
/** A long answer: the first sentences are read, the rest stays in the chat. */
export const SPOKEN_SENTENCES = 3;
export const SPOKEN_CHARS = 420;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
const YES = new Set(["oui", "ouais", "oui oui", "oui merci", "oui vas y", "oui c'est bon", "oui d'accord", "oui s'il te plait", "oui je confirme", "je confirme", "d'accord", "vas y",
  "yes", "yeah", "yep", "yes please", "yes go ahead", "go ahead", "yes i confirm", "i confirm", "okay yes", "ok yes"]);
const NO = new Set(["non", "non non", "non merci", "non pas maintenant", "non surtout pas", "surtout pas", "non annule", "annule", "non laisse tomber", "laisse tomber", "pas maintenant",
  "no", "nope", "no thanks", "no thank you", "not now", "no don't", "don't", "cancel", "no cancel"]);

/** "yes" / "no" when the whole utterance is a clear answer; null otherwise (never a guess). */
export function clearYesNo(said: string): "yes" | "no" | null {
  const s = fold(said);
  if (!s || s.split(" ").length > 5) return null;
  if (YES.has(s)) return "yes";
  if (NO.has(s)) return "no";
  return null;
}

/** Few words, no clear answer: probably meant as one (asked again), rather than a new request for the bot. */
export const shortUtterance = (said: string) => fold(said).split(" ").filter(Boolean).length <= 4;

const PRIVATE_TOOL = /^(card:|myfiles:|mycomputer:|vault:|secret:|totp:|email code:)/;
const PAY_OR_DELETE = /pay|purchase|checkout|refund|transfer|invoice|billing|card_fill|stripe|paypal|delete|remove|trash|wipe|erase|destroy|drop|purge|supprim|efface|paiement|achat|virement/i;

/** Whether this approval card may be answered by a spoken « oui » / « non » (see the module comment). */
export function voiceApprovable(card: Pick<Extract<Card, { type: "approval" }>, "tool" | "irreversible" | "once" | "why" | "status">, byOwner: boolean): boolean {
  if (!byOwner || card.status !== "pending") return false;
  if (needsFloorCode(card)) return false;
  if (PRIVATE_TOOL.test(card.tool) || PAY_OR_DELETE.test(card.tool)) return false;
  return true;
}
