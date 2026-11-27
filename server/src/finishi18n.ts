/**
 * French of the server texts of L161 (second half): the queue of a shared computer (sharedqueue.ts), late answers
 * (agent/lateanswer.ts), bot themes (botthemes.ts), the notes archive (notesarchive.ts), the global recap
 * (globalrecap.ts). Merged into i18n.ts's dictionary.
 */
export const FINISH_FR: Record<string, string> = {
  // sharedqueue.ts
  "The shared computer is being used by {holders}. I am waiting for my turn (next in line). I will go on by myself as soon as it is free.":
    "L'ordinateur partagé est utilisé par {holders}. J'attends mon tour (je suis le prochain). Je reprends tout seul dès qu'il se libère.",
  "The shared computer is being used by {holders}. I am waiting for my turn: number {position} in line, behind {ahead}. I will go on by myself as soon as it is free.":
    "L'ordinateur partagé est utilisé par {holders}. J'attends mon tour : {position}e dans la file, derrière {ahead}. Je reprends tout seul dès qu'il se libère.",
  "I waited {time} for the shared computer; it is my turn now, I am going on.": "J'ai attendu {time} l'ordinateur partagé ; c'est mon tour, je reprends.",
  "The shared computer was still in use after {time}: I stopped waiting. Ask me again in a moment, or add a shared computer (Settings → Computers).":
    "L'ordinateur partagé était encore pris après {time} : j'ai arrêté d'attendre. Redemande-moi dans un moment, ou ajoute un ordinateur partagé (Réglages → Ordinateurs).",
  "another bot": "un autre bot",
  // agent/lateanswer.ts
  "Answer noted. The conversation has moved on since this question, so I keep it for my next message instead of starting the old work again.":
    "Réponse notée. La conversation est passée à autre chose depuis cette question : je la garde pour mon prochain message au lieu de relancer l'ancien travail.",
  "Answer noted. The work this question was for is closed, so it is only kept, nothing starts again.":
    "Réponse notée. Le travail de cette question est clos : elle est seulement gardée, rien ne repart.",
  // botthemes.ts
  "{bot} proposes a colour theme for the app: {name}": "{bot} propose un thème de couleurs pour l'appli : {name}",
  "Theme applied: {name}": "Thème appliqué : {name}", "Back to the app's own colours": "Retour aux couleurs d'origine de l'appli",
  // globalrecap.ts
  "Recap of your bots, last {days} days": "Récapitulatif de tes bots, {days} derniers jours",
};
