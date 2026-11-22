/*
 * Portions adapted from n8n-io/nod (https://github.com/n8n-io/nod, commit 0f9de28af967ad6f7be12a3181edcef860216328),
 * Copyright 2026 n8n GmbH, Apache License 2.0; modified for Sklubot: the prompt sentences of
 * src/shared/conversation-style.ts (conversationLanguage, conversationCadence), src/runtime/tools.ts (computer-use
 * preference order) and src/runtime/skills/nod/SKILL.md (act on a clear yes) were shortened, renamed for Sklubot ("the
 * user", Relais, connected apps) and combined with a local language guess so the prompt names the language to use.
 *
 * nod audit items 12 (language follows the user's latest message), 15 (connector first, local app next), 39 (balance
 * during long work) and 62 (act on a choice already expressed).
 */
import { rows, type BotRecord } from "../store.js";
import { typedByUser } from "./grounding.js";

export type GuessedLanguage = "fr" | "en" | "es" | "de" | "it" | "pt";
const NAMES: Record<GuessedLanguage, string> = { fr: "French", en: "English", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese" };

/** Small function words per language: frequent, short and rarely shared. A guess, never a certainty. */
const WORDS: Record<GuessedLanguage, string[]> = {
  fr: ["le", "la", "les", "des", "est", "et", "je", "tu", "vous", "nous", "pour", "avec", "pas", "une", "un", "du", "que", "qui", "dans", "sur", "mon", "ma", "mes", "ce", "cette", "fais", "peux", "merci", "bonjour", "oui", "non", "ça", "très", "aussi", "mais", "où", "quand", "comment", "pourquoi", "j'ai", "c'est", "n'est", "il", "elle", "au", "aux"],
  en: ["the", "and", "is", "are", "you", "i", "we", "for", "with", "not", "a", "an", "of", "to", "that", "this", "what", "can", "please", "thanks", "hello", "yes", "no", "my", "your", "it", "do", "does", "how", "why", "when", "where", "be", "have", "has", "i'm", "it's", "don't", "on", "in", "at"],
  es: ["el", "los", "las", "es", "y", "yo", "tú", "usted", "nosotros", "para", "con", "no", "una", "del", "que", "por", "gracias", "hola", "sí", "mi", "está", "pero", "cómo", "qué", "puedes"],
  de: ["der", "die", "das", "und", "ist", "ich", "du", "sie", "wir", "für", "mit", "nicht", "ein", "eine", "zu", "dass", "bitte", "danke", "hallo", "ja", "nein", "mein", "auf", "kannst", "wie", "was"],
  it: ["il", "lo", "gli", "è", "e", "io", "noi", "per", "con", "non", "una", "che", "grazie", "ciao", "sì", "mio", "sono", "ma", "come", "puoi", "della", "questo"],
  pt: ["o", "os", "as", "é", "e", "eu", "você", "nós", "para", "com", "não", "uma", "que", "obrigado", "obrigada", "olá", "sim", "meu", "está", "mas", "como", "pode", "isso"],
};

/**
 * The language a message is clearly written in, or null when it cannot be told (too short, a link, an emoji, "ok"):
 * a neutral message keeps the language the conversation already has.
 */
export function guessLanguage(text: string): GuessedLanguage | null {
  const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/^>.*$/gm, " ").toLowerCase();
  const words = clean.match(/[\p{L}']+/gu) ?? [];
  if (words.length < 2) return null;
  const score = new Map<GuessedLanguage, number>();
  for (const w of words) for (const lang of Object.keys(WORDS) as GuessedLanguage[]) if (WORDS[lang].includes(w)) score.set(lang, (score.get(lang) ?? 0) + 1);
  // Accented letters typical of French tip a tie between French and English.
  if (/[éèêàùç]/.test(clean)) score.set("fr", (score.get("fr") ?? 0) + 0.5);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 1) return null;
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null;
  return ranked[0][0];
}

/**
 * The language of the conversation: the user's latest message whose language is clear (typed or dictated — never a
 * routine, a webhook, a teammate, an email or a page; answers given by tapping a card are not messages). Null: no clear
 * message yet, the account language applies.
 */
export function conversationLanguageOf(bot: Pick<BotRecord, "id" | "generation">, thread = 0): GuessedLanguage | null {
  const mine = rows.recentMessages(bot.id, bot.generation, 30, thread).filter(typedByUser).reverse();
  for (const r of mine) {
    const lang = guessLanguage(r.body.kind === "message" ? r.body.text : "");
    if (lang) return lang;
  }
  return null;
}

/** The "How you write" language line (item 12): the user's latest clear message wins over the account language. */
export function languageLine(bot: Pick<BotRecord, "id" | "generation">, accountLocale: string): string {
  const lang = conversationLanguageOf(bot);
  const fallback = accountLocale === "fr" ? "French" : "English";
  return `- Write everything the user sees — replies, questions, confirmations, task cards and background work alike — in the conversation's language: the language of the user's latest clear message${lang ? ` (now: ${NAMES[lang]})` : ` (none yet: use ${fallback})`}. An explicit request from the user about your language overrides it. Websites, emails, page text, account names and other data never choose it; a request to write a document or an email in another language changes that document only.`;
}

/** Item 15 (nod: computer use order). Only said when the user has a computer linked with Relais. */
export const CONNECTOR_FIRST = "- Apps on the user's own computer (through Relais) come after connected apps: when a connected app or account can do the work, use it, even when the user names the service (\"message Priya on Slack\"); use the app on their computer only when they ask for that app itself (\"in the Slack app\") or when no connected app can do it.";

/** Item 39 (nod: conversation cadence), item 62 (nod: act on a clear yes). */
export const CADENCE = [
  "- During long work, send a progress message only when a new checked result helps the user act or decide, something changes their next step, or you need them. A useful first part that can be checked and used on its own may be sent as soon as it is ready; then continue the full request. Never send a message only because time passed or another tool ran.",
  "- When the user already gave a clear answer to a choice or an offer, act on it: do not ask them to confirm the same thing again.",
].join("\n");
