/** French texts of the turn-control batch (L63, L64, L72, L78, L79, L83, L84, L94, L97, L98), merged into i18n.ts FR. */
export const TURN_FR: Record<string, string> = {
  // L94 (agent/steering.ts, turncontrolroutes.ts)
  "The server restarted before I read your note: “{note}”. It is kept — press « Resume my note » to send it again.": "Le serveur a redémarré avant que je lise ta note : « {note} ». Elle est gardée — appuie sur « Reprendre ma note » pour la renvoyer.",
  "This note was already sent again, or is gone.": "Cette note a déjà été renvoyée, ou n'existe plus.",
  // L63 (agent/stopcommand.ts)
  "{n} helper(s)": "{n} assistant(s)", "{n} background task(s)": "{n} tâche(s) de fond", "{n} teammate(s) working for me": "{n} coéquipier(s) qui travaillai(en)t pour moi",
  " Also stopped: {list}.": " Arrêté aussi : {list}.", "Also stopped: {list}.": "Arrêté aussi : {list}.",
  "Everything is stopped.": "Tout est arrêté.",
  " {n} waiting message(s) or follow-up(s) were cancelled.": " {n} message(s) ou suite(s) en attente annulé(s).",
  " Nothing was waiting.": " Rien n'attendait.",
  " What was already done is kept.": " Ce qui était déjà fait est gardé.",
  " {n} message(s) still wait and will run next — « Stop all » cancels them.": " {n} message(s) attend(ent) encore et passera(ont) ensuite — « Tout arrêter » les annule.",
  // L78 (agent/sidequestion.ts)
  "↪ Side answer:": "↪ Réponse à côté :",
  "↪ I have no quick answer to that. Send it with /apres and I will look into it after the current task.": "↪ Je n'ai pas de réponse rapide. Envoie-la avec /apres et je m'en occupe après la tâche en cours.",
  "I could not answer the side question just now ({detail}). The work under way is not affected.": "Je n'ai pas pu répondre à la question à côté ({detail}). Le travail en cours n'est pas touché.",
  // L72 (agent/loop.ts stepLimitReached, agent/autocontinue.ts)
  "I reached {n} steps and the work is moving forward: I am carrying on on my own ({left} more time(s) at most).": "J'ai atteint {n} étapes et le travail avance : je continue tout seul ({left} fois de plus au maximum).",
  "I stopped after {n} steps: the last stretch was not moving forward, so I did not carry on by myself. Tell me how to go on, or press Continue.": "Je me suis arrêté après {n} étapes : la dernière série n'avançait pas, donc je n'ai pas continué tout seul. Dis-moi comment continuer, ou appuie sur Continuer.",
  // L84 (agent/endcheck.ts)
  "End check: the work still looks unfinished ({reason}), and I already went back to it {n} times. Tell me how to go on.": "Contrôle de fin : le travail semble encore inachevé ({reason}), et j'y suis déjà retourné {n} fois. Dis-moi comment continuer.",
  "End check: not finished yet ({reason}). I am going back to it ({n}/{max}).": "Contrôle de fin : pas encore fini ({reason}). J'y retourne ({n}/{max}).",
  "End check: this needs you before it can be finished — {reason}": "Contrôle de fin : il faut ton aide pour finir — {reason}",
  "End check: this work is blocked — {reason}": "Contrôle de fin : ce travail est bloqué — {reason}",
  // L97 (agent/waitlater.ts)
  "⏰ I will come back to this in {min} min (around {time} UTC): {reason}": "⏰ Je repasse dans {min} min (vers {time} UTC) : {reason}",
  "back in {min} min": "de retour dans {min} min", "Coming back later": "Repasse plus tard",
  // L79 (agent/richquestion.ts)
  "Proposing a plan": "Propose un plan",
  // L98 (agent/undoable.ts)
  "{bot} updated your shared profile ({fields}).": "{bot} a mis à jour ton profil partagé ({fields}).",
  "{bot} saved a new skill: {name}.": "{bot} a enregistré une nouvelle compétence : {name}.",
  "{bot} changed its skill: {name}.": "{bot} a modifié sa compétence : {name}.",
  "{bot} paused the routine {name}.": "{bot} a mis en pause la routine {name}.",
  "{bot} changed the routine {name}.": "{bot} a modifié la routine {name}.",
};
