/**
 * L145 « Tour d'accueil d'un nouveau bot » (backlog A-FAIRE): in an empty chat, one question with 3 choices and four
 * starter requests fitted to the bot's role, chosen here from its name, role and description (no model, nothing sent
 * until the owner clicks). The texts are in the dictionaries (every language).
 */
export type RoleKind = "writing" | "marketing" | "code" | "research" | "money" | "support" | "design" | "organise" | "general";
interface Pick { label: string; prompt: string }
export interface Welcome { role: RoleKind; question: string; choices: Pick[]; starters: Pick[] }

const WORDS: [RoleKind, RegExp][] = [
  ["code", /\b(code|coder|dév\b|dev\b|développ|developer|programm|logiciel|software|github|api|bug|site web|website|appli)/i],
  ["marketing", /\b(marketing|réseaux|social|instagram|tiktok|linkedin|seo|pub|ads|campagne|campaign|newsletter|brand|marque|communication)/i],
  ["writing", /\b(rédact|écri|ecri|writer|writing|copy|texte|article|blog|traduct|translat|correct)/i],
  ["research", /\b(recherche|research|veille|analyst|analyse|étude|etude|watch|investig|sourc)/i],
  ["money", /\b(compta|account|financ|factur|invoice|budget|devis|quote|trésor|treso|banque|bank|fiscal|tax|impôt)/i],
  ["support", /\b(support|client|customer|sav|service|helpdesk|répond|reply|mail|e-mail|inbox|boîte)/i],
  ["design", /\b(design|graphi|image|visuel|visual|logo|photo|vidéo|video|montage|illustr|ui|ux)/i],
  ["organise", /\b(assistant|agenda|calendar|planning|organis|organiz|secrétaire|secretary|tâche|task|projet|project|rappel|remind)/i],
];

/** The role kind from the bot's own words (first match in a fixed order). */
export function roleOf(text: string): RoleKind {
  for (const [kind, re] of WORDS) if (re.test(text)) return kind;
  return "general";
}

/**
 * The texts live in the dictionaries (web/src/i18n, keys `starter.<role>.q`, `.c1`…`.c3` and `.s1`…`.s4`, each with its
 * `.prompt`), so every language gets them. `text` is the app's `t` (a node test passes a lookup of its own).
 */
export function welcomeFor(bot: { name: string; label?: string; description?: string; instructions?: string }, text: (key: string) => string): Welcome {
  const role = roleOf([bot.label, bot.description, bot.instructions?.slice(0, 600), bot.name].filter(Boolean).join(" "));
  const pick = (id: string): Pick => ({ label: text(`starter.${role}.${id}`), prompt: text(`starter.${role}.${id}.prompt`) });
  return { role, question: text(`starter.${role}.q`), choices: ["c1", "c2", "c3"].map(pick), starters: ["s1", "s2", "s3", "s4"].map(pick) };
}
