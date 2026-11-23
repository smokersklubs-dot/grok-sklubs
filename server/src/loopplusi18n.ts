/** French texts of the loop-and-turns batch (L25, L58, L59, L72, L79), merged into i18n.ts FR. */
export const LOOPPLUS_FR: Record<string, string> = {
  // L59 (agent/heldfirst.ts)
  "No AI model is connected yet, so I kept your message. It will go out by itself as soon as a model answers: connect one in Settings → Models.": "Aucun modèle d'IA n'est encore branché, alors j'ai gardé ton message. Il partira tout seul dès qu'un modèle répondra : branches-en un dans Réglages → Modèles.",
  "A model answers now: I am sending the message I kept.": "Un modèle répond maintenant : j'envoie le message que j'avais gardé.",
  // L25 (agent/helperrelay.ts)
  "Also passed to the helper at work: {names}.": "Aussi transmis à l'assistant au travail : {names}.",
  // L58 (agent/sendnow.ts)
  "I stopped the step under way to read your message now. What I did so far is kept.": "J'ai arrêté l'étape en cours pour lire ton message tout de suite. Ce que j'ai déjà fait est gardé.",
  // L72 (agent/timeoutresume.ts)
  "I reached the {min}-minute limit of one turn on a subscription and the work is moving forward: I am carrying on on my own ({left} more time(s) at most).": "J'ai atteint la limite de {min} minutes d'un tour sur abonnement et le travail avance : je continue tout seul ({left} fois de plus au maximum).",
  // L79 (agent/planmode.ts, turnplusroutes.ts)
  "Plan mode is on for this conversation: I will look around and show you a plan before changing anything.": "Mode Plan activé pour cette conversation : je regarde d'abord, puis je te montre un plan avant de changer quoi que ce soit.",
  "Plan mode is off for this conversation.": "Mode Plan désactivé pour cette conversation.",
  "Plan approved: plan mode is off for this conversation, I am getting on with it.": "Plan approuvé : le mode Plan est désactivé pour cette conversation, je m'y mets.",
  "That is not a plan card.": "Ce n'est pas une carte de plan.",
  "I cannot find your request before this plan.": "Je ne trouve pas ta demande avant ce plan.",
  "The review could not be read. Try again.": "La relecture n'a pas pu être lue. Réessaie.",
  "Plan review: every point of your request is covered.": "Relecture du plan : chaque point de ta demande est couvert.",
  "Plan review: some points of your request are not covered.": "Relecture du plan : certains points de ta demande ne sont pas couverts.",
  "Missing: {list}.": "Manque : {list}.",
  "Not asked: {list}.": "Pas demandé : {list}.",
};
