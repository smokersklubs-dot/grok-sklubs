/**
 * L161 « Glossaire en infobulles » (backlog A-FAIRE): the few technical words the app cannot avoid, each with a plain
 * explanation in French and English, shown when the word is pointed at, focused or tapped (components/Gloss.tsx).
 */
export const GLOSSARY = {
  context: { fr: ["Contexte", "Ce que le bot garde en tête de la conversation en cours. Quand c'est plein, il en fait un résumé et continue."], en: ["Context", "What the bot keeps in mind from the current conversation. When it is full, it writes a summary and carries on."] },
  token: { fr: ["Jeton", "Un petit morceau de texte (environ trois quarts d'un mot). Les modèles d'IA comptent et facturent en jetons."], en: ["Token", "A small piece of text (about three quarters of a word). AI models count and bill in tokens."] },
  model: { fr: ["Modèle", "Le « cerveau » d'IA qui écrit les réponses. Certains sont plus rapides, d'autres plus forts ou moins chers."], en: ["Model", "The AI “brain” that writes the answers. Some are faster, others stronger or cheaper."] },
  compact: { fr: ["Compacter", "Remplacer le début de la conversation par un résumé, pour faire de la place sans rien oublier d'important."], en: ["Compact", "Replace the start of the conversation with a summary, to make room without forgetting what matters."] },
  trash: { fr: ["Corbeille", "Un bot supprimé y reste 30 jours : tu peux le restaurer avec ses conversations, notes et compétences."], en: ["Trash", "A deleted bot stays there for 30 days: you can restore it with its conversations, notes and skills."] },
  macro: { fr: ["Macro", "Un petit programme caché dans un fichier Office. Sklubot ne l'exécute jamais : il montre seulement le contenu."], en: ["Macro", "A small program hidden in an Office file. Sklubot never runs it: it only shows the content."] },
  automatic: { fr: ["Automatique", "Une conversation lancée sans toi : par une routine, un e-mail reçu, un webhook ou un autre bot."], en: ["Automatic", "A conversation started without you: by a routine, an incoming email, a webhook or another bot."] },
} as const;
export type GlossTerm = keyof typeof GLOSSARY;
export const glossOf = (term: GlossTerm, lang: "fr" | "en") => GLOSSARY[term][lang];
