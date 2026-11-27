/**
 * L161 « Glossaire en infobulles » (backlog A-FAIRE): the few technical words the app cannot avoid, each with a plain
 * explanation, shown when the word is pointed at, focused or tapped (components/Gloss.tsx). French and English here;
 * other languages in their dictionary file, `side.gloss` (web/src/i18n/sides.ts, docs/LANGUES.md).
 */
const TEXT = {
  fr: {
    context: "Contexte",
    contextText: "Ce que le bot garde en tête de la conversation en cours. Quand c'est plein, il en fait un résumé et continue.",
    token: "Jeton",
    tokenText: "Un petit morceau de texte (environ trois quarts d'un mot). Les modèles d'IA comptent et facturent en jetons.",
    model: "Modèle",
    modelText: "Le « cerveau » d'IA qui écrit les réponses. Certains sont plus rapides, d'autres plus forts ou moins chers.",
    compact: "Compacter",
    compactText: "Remplacer le début de la conversation par un résumé, pour faire de la place sans rien oublier d'important.",
    trash: "Corbeille",
    trashText: "Un bot supprimé y reste 30 jours : tu peux le restaurer avec ses conversations, notes et compétences.",
    macro: "Macro",
    macroText: "Un petit programme caché dans un fichier Office. Sklubot ne l'exécute jamais : il montre seulement le contenu.",
    automatic: "Automatique",
    automaticText: "Une conversation lancée sans toi : par une routine, un e-mail reçu, un webhook ou un autre bot.",
  },
  en: {
    context: "Context",
    contextText: "What the bot keeps in mind from the current conversation. When it is full, it writes a summary and carries on.",
    token: "Token",
    tokenText: "A small piece of text (about three quarters of a word). AI models count and bill in tokens.",
    model: "Model",
    modelText: "The AI “brain” that writes the answers. Some are faster, others stronger or cheaper.",
    compact: "Compact",
    compactText: "Replace the start of the conversation with a summary, to make room without forgetting what matters.",
    trash: "Trash",
    trashText: "A deleted bot stays there for 30 days: you can restore it with its conversations, notes and skills.",
    macro: "Macro",
    macroText: "A small program hidden in an Office file. Sklubot never runs it: it only shows the content.",
    automatic: "Automatic",
    automaticText: "A conversation started without you: by a routine, an incoming email, a webhook or another bot.",
  },
};
export type GlossTerm = "context" | "token" | "model" | "compact" | "trash" | "macro" | "automatic";
/** The table read by `sideText("gloss", GLOSS_TEXT, locale)` (components/Gloss.tsx). No import here: tests load it alone. */
export const GLOSS_TEXT = TEXT;
/** Per word, its French and English [word, explanation]. */
export const GLOSSARY = Object.fromEntries((Object.keys(TEXT.en).filter((k) => !k.endsWith("Text")) as GlossTerm[])
  .map((k) => [k, { fr: [TEXT.fr[k], TEXT.fr[`${k}Text`]], en: [TEXT.en[k], TEXT.en[`${k}Text`]] }])) as Record<GlossTerm, { fr: [string, string]; en: [string, string] }>;
