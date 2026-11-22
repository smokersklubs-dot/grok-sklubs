import { tr } from "../i18n.js";
import type { ToolUseBlock } from "../llm/index.js";
import { clip } from "../store.js";
import type { Ask, Decision } from "./authorize.js";
import { normalize, userWordsFor } from "./grounding.js";
import type { Turn } from "./loop.js";

/**
 * L36 — a light anti-injection judge on PRIVATE reads after outside content (Agent Zero audit, idea only).
 *
 * Once a turn has read outside content (a page, an email, an app's data), that content may try to make the bot dig into
 * the owner's private things — notes (memory), other conversations, the list of vault items, the files of the owner's
 * computer — so that a later step carries them out. Before such a read, the server checks, without any model call,
 * that the owner's OWN recent words in this conversation (the floor's narrow window, grounding.ts) cover it:
 *   - a word of the query or path (4 letters or more, accents and case ignored) appears in what they wrote, or
 *   - they named that kind of thing ("mémoire", "notes", "fichier", "coffre", "conversation", "souviens-toi"…).
 * Otherwise a card asks, single use, saying that outside content was read; the owner's "Refuse" ends it. Nothing changes
 * for a turn that read nothing from outside, or for a read the owner's words clearly cover.
 */
export const PRIVATE_READS: Record<string, { what: string; words: RegExp; query: (a: Record<string, unknown>) => string }> = {
  memory_search: { what: "notes (memory)", words: /\b(memoire|memory|memories|note|notes|souvien|rappel|remember|recall|retien)/, query: (a) => String(a.query ?? "") },
  conversation_search: { what: "other conversations", words: /\b(conversation|discussion|echange|chat|historique|history|dit|said|parle|talked)/, query: (a) => String(a.query ?? "") },
  vault_list: { what: "vault", words: /\b(coffre|vault|identifiant|login|mot de passe|password|cle|key|secret|carte|card)/, query: () => "" },
  my_files: { what: "files on your computer", words: /\b(fichier|file|dossier|folder|document|ordinateur|computer|disque)/, query: (a) => `${a.folder ?? ""} ${a.path ?? ""}` },
  my_file_read: { what: "files on your computer", words: /\b(fichier|file|dossier|folder|document|ordinateur|computer|lis|read|ouvre|open)/, query: (a) => `${a.folder ?? ""} ${a.path ?? ""}` },
};

const words = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);

/** Whether the owner's recent words cover this private read. */
export function privateReadCovered(said: string[], name: string, input: Record<string, unknown>): boolean {
  const rule = PRIVATE_READS[name];
  if (!rule) return true;
  const text = normalize(said.join("\n"));
  if (!text.trim()) return false;
  if (rule.words.test(text)) return true;
  const mine = new Set(words(text));
  return words(rule.query(input)).some((w) => mine.has(w));
}

/** The card for a private read after outside content that the owner's words do not cover, or null. */
export function privateReadGate(turn: Turn, call: ToolUseBlock, d: Decision): Ask | null {
  const rule = PRIVATE_READS[call.name];
  if (!rule || !turn.tainted || d.kind !== "allow" || d.grant?.by === "retry") return null;
  const said = userWordsFor(turn.bot, turn.thread, Date.now(), { narrow: true }).map((w) => w.text);
  if (privateReadCovered(said, call.name, call.input)) return null;
  const loc = turn.user.locale;
  const what = tr(loc, rule.what);
  const q = clip(rule.query(call.input).trim(), 120);
  return {
    kind: "ask", policyKey: `private read: ${call.name}`, once: true, fixed: true, source: tr(loc, "Outside content"),
    title: tr(loc, "{bot} has read outside content and now wants to look in your {what}. Allow it?", { bot: turn.bot.name, what }),
    reason: tr(loc, "look in your {what}", { what }),
    why: tr(loc, "A page or a message may be trying to make the bot search your private things. Allow only if you asked for it."),
    ...(q ? { note: tr(loc, "Looking for: {q}", { q }) } : {}),
  };
}
