import { findSecrets, type SensitiveCategory } from "../shared.js";
import { rows, settings, type BotRecord } from "../store.js";
import { normalize, typedByUser } from "./grounding.js";

/**
 * What memory never learns on its own (spec 07 A8): sensitive topics — health, religion, politics, sexuality, origin,
 * a precise location, financial account numbers, legal matters — unless the user turned that topic on in Settings →
 * Memory, or explicitly asked to remember that one thing; and anything that looks like a secret (a password, a card or
 * an account number, a key), never. Deterministic keyword lists (French and English) and patterns.
 */

const WORDS: Record<SensitiveCategory, string[]> = {
  health: ["sante", "malade", "maladie", "medecin", "medicament", "traitement", "diagnostic", "cancer", "diabete", "depression", "anxiete", "enceinte", "grossesse", "handicap", "therapie", "psychiatre", "psychologue", "hopital", "allergie", "allergique", "health", "illness", "disease", "doctor", "medication", "diagnosis", "pregnant", "pregnancy", "disability", "therapy", "therapist", "hospital", "allergy", "allergic", "mental health", "hiv", "vih"],
  religion: ["religion", "religieux", "religieuse", "catholique", "chretien", "musulman", "musulmane", "juif", "juive", "bouddhiste", "athee", "mosquee", "eglise", "synagogue", "ramadan", "religious", "catholic", "christian", "muslim", "jewish", "buddhist", "atheist", "mosque", "church"],
  politics: ["politique", "vote pour", "je vote", "parti politique", "syndicat", "syndique", "militant", "election", "political", "politics", "votes for", "i vote", "party member", "union member", "activist", "democrat", "republican"],
  sexuality: ["sexualite", "sexuel", "sexuelle", "gay", "lesbienne", "bisexuel", "bisexuelle", "homosexuel", "homosexuelle", "transgenre", "orientation sexuelle", "identite de genre", "sexuality", "sexual", "lesbian", "bisexual", "homosexual", "transgender", "sexual orientation", "gender identity"],
  origin: ["origine ethnique", "ethnie", "nationalite", "sans papiers", "titre de sejour", "statut migratoire", "refugie", "ethnic origin", "ethnicity", "immigration status", "undocumented", "refugee", "visa status"],
  location: ["j'habite au", "j'habite a", "mon adresse", "mon domicile", "code d'acces de l'immeuble", "digicode", "my address", "i live at", "home address", "door code", "gps"],
  financial: ["iban", "bic", "numero de compte", "numero de carte", "rib", "account number", "card number", "routing number", "sort code", "salaire", "salary", "dette", "debt", "credit score"],
  legal: ["casier judiciaire", "condamnation", "condamne", "proces", "garde a vue", "criminal record", "conviction", "convicted", "lawsuit", "arrested"],
};

/** Patterns that point to a category whatever the words: an IBAN, a street address with a number, GPS coordinates. */
const PATTERNS: [SensitiveCategory, RegExp][] = [
  ["financial", /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/],
  ["location", /\b\d{1,4}\s*(?:bis|ter)?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|impasse|allee|allée|place|quai|route|street|st\.|road|rd\.|lane|drive)\b/i],
  ["location", /-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/],
];

const hasWord = (hay: string, w: string) => ` ${hay} `.includes(` ${normalize(w)} `);

export function sensitiveCategory(text: string): SensitiveCategory | null {
  for (const [cat, re] of PATTERNS) if (re.test(text)) return cat;
  const n = normalize(text);
  for (const cat of Object.keys(WORDS) as SensitiveCategory[]) if (WORDS[cat].some((w) => hasWord(n, w))) return cat;
  return null;
}

/** Luhn check, for card numbers. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Lines that look like a password, a key or a card number: never remembered, never imported. */
export function looksSecret(text: string): boolean {
  // The formats a pasted message is masked for (shared.ts findSecrets): provider keys, tokens, "password: …".
  if (findSecrets(text).length) return true;
  if (/\b(password|passwd|mot de passe|mdp|passcode|code pin|pin code|api[_ -]?key|cl[eé] (d'?)?api|secret|token)\b[^\n:=]{0,30}[:=]\s*\S+/i.test(text)) return true;
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) return true; }
  if (/\b(sk|pk|rk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}\b/.test(text)) return true;
  // A long random-looking token (letters and digits mixed, 24+ characters, no spaces).
  return /\b(?=[A-Za-z0-9_\-]{24,}\b)(?=[^\s]*\d)(?=[^\s]*[a-z])(?=[^\s]*[A-Z])[A-Za-z0-9_\-]{24,}\b/.test(text);
}

/** The user's last message asks, in so many words, to remember something. */
export function explicitRemember(bot: BotRecord, thread = 0): boolean {
  const last = rows.recentMessages(bot.id, bot.generation, 12, thread).filter(typedByUser).pop();
  if (!last || last.body.kind !== "message") return false;
  return /\b(retiens|retenir|souviens|souviens-toi|rappelle-toi|memorise|memoriser|note bien|garde en memoire|n'oublie pas|remember|memorize|keep in mind|note that|don't forget)\b/.test(normalize(last.body.text));
}

/**
 * The user's last message asks, in so many words, to forget something ("oublie que…", "efface ce que je t'ai dit sur…",
 * "forget that…"): the only thing that lets memory_forget act (memorybook.ts).
 */
export function explicitForget(bot: BotRecord, thread = 0): boolean {
  const last = rows.recentMessages(bot.id, bot.generation, 12, thread).filter(typedByUser).pop();
  if (!last || last.body.kind !== "message") return false;
  return /\b(oublie|oublies|oublier|oubliez|efface|effacer|effacez|supprime|supprimer|supprimez|retire|retirer|forget|delete|erase|remove)\b/.test(normalize(last.body.text));
}

export type MemoryVerdict = { ok: true; category: SensitiveCategory | null } | { ok: false; reason: string };

/** Whether a note may be kept (`explicit`: the user asked to remember it, in their own words). Reasons for the model, in English. */
export function memoryVerdict(userId: string, text: string, explicit: boolean): MemoryVerdict {
  if (looksSecret(text)) return { ok: false, reason: "This looks like a secret (a password, a key or a card number): it is never kept in memory. Secrets go in the vault." };
  const category = sensitiveCategory(text);
  if (!category) return { ok: true, category: null };
  if (settings.memory(userId).allowSensitive[category] || explicit) return { ok: true, category };
  return { ok: false, reason: `This touches a sensitive topic (${category}), which is not remembered unless the user asks you to remember it explicitly or allows it in Settings → Memory.` };
}
