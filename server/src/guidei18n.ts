/**
 * The texts the server writes for the owner in the « pas à pas » cards and the setup list (stepguide.ts, guidechecks.ts,
 * L145 / L153), in the engine warm-up (enginewarmup.ts, L145) and in the plan → board card (boardplan.ts, L163). English
 * is the key; French here (tutoiement, simple words). Kept apart from i18n.ts like worki18n.ts does.
 * test/guide-plan-warmup.test.ts checks that every gt("…") text of these files has its French line.
 */
import type { Locale } from "./shared.js";

export const GUIDE_FR: Record<string, string> = {
  // Checks (guidechecks.ts)
  "No model answers yet for your bots.": "Aucun modèle ne répond encore pour tes bots.",
  "Your bots have a model they can use.": "Tes bots ont un modèle utilisable.",
  "You have no bot yet.": "Tu n'as encore aucun bot.",
  "You have at least one bot.": "Tu as au moins un bot.",
  "The model answered.": "Le modèle a répondu.",
  "The model does not answer yet: {reason}": "Le modèle ne répond pas encore : {reason}",
  "The engine is not warmed up yet: {state}.": "Le moteur n'est pas encore préchauffé : {state}.",
  "Two-factor sign-in is on.": "La double vérification est activée.",
  "Two-factor sign-in is still off.": "La double vérification est encore désactivée.",
  "Automatic backups are set up and on.": "Les sauvegardes automatiques sont réglées et activées.",
  "Automatic backups are not set up or are switched off.": "Les sauvegardes automatiques ne sont pas réglées ou sont coupées.",
  "A backup worked in the last 3 days.": "Une sauvegarde a marché ces 3 derniers jours.",
  "No backup worked in the last 3 days.": "Aucune sauvegarde n'a marché ces 3 derniers jours.",
  "The bots' computers are ready.": "Les ordinateurs des bots sont prêts.",
  "The bots' computers are not ready: {reason}.": "Les ordinateurs des bots ne sont pas prêts : {reason}.",
  "This installation does not use bot computers: nothing to do.": "Cette installation n'utilise pas d'ordinateurs de bots : rien à faire.",
  "The Docteur line is fine now.": "La ligne du Docteur est bonne maintenant.",
  "The Docteur still says: to fix.": "Le Docteur dit encore : à corriger.",
  "Only the owner of this installation can check this.": "Seul le propriétaire de cette installation peut vérifier ça.",
  "Unknown check.": "Vérification inconnue.",
  // Guides (stepguide.ts)
  "What remains to set up": "Ce qui reste à installer",
  "Let's finish setting up, together. Each step has a « Vérifier » button that confirms it worked. Nothing here costs money, and keys or passwords are typed in Settings, never in this chat.":
    "Finissons l'installation ensemble. Chaque étape a un bouton « Vérifier » qui confirme que ça a marché. Rien ici n'est payant, et les clés ou mots de passe se tapent dans Réglages, jamais dans cette discussion.",
  "Everything is set up: nothing remains to install.": "Tout est installé : il ne reste rien à faire.",
  "Connect an AI model": "Brancher un modèle d'IA",
  "In Settings → Models: your Claude or ChatGPT subscription, or a key from a provider. Type the key there, never in the chat.":
    "Dans Réglages → Modèles : ton abonnement Claude ou ChatGPT, ou une clé d'un fournisseur. Tape la clé là-bas, jamais dans la discussion.",
  "Check that the model answers": "Vérifier que le modèle répond",
  "« Vérifier » sends a tiny test message to your main bot's model (or looks at its engine's warm-up).":
    "« Vérifier » envoie un tout petit message d'essai au modèle de ton bot principal (ou regarde le préchauffage de son moteur).",
  "Prepare the bots' computers": "Préparer les ordinateurs des bots",
  "On the machine that runs Sklubot, in the Sklubot folder, type this command once (it is free; it takes a few minutes).":
    "Sur la machine qui fait tourner Sklubot, dans le dossier de Sklubot, tape cette commande une fois (c'est gratuit ; ça prend quelques minutes).",
  "Turn on two-factor sign-in": "Activer la double vérification",
  "In Settings → Account: scan the code with an authenticator app on your phone, then type the 6 digits it shows.":
    "Dans Réglages → Compte : scanne le code avec une appli d'authentification sur ton téléphone, puis tape les 6 chiffres qu'elle affiche.",
  "Set up automatic backups": "Régler les sauvegardes automatiques",
  "In Settings → Account → Backups: choose where they go and switch them on.": "Dans Réglages → Compte → Sauvegardes : choisis où elles vont et active-les.",
  "Fix it step by step": "Réparer pas à pas",
  "Follow the steps in order; « Vérifier » tells you when it is fixed.": "Suis les étapes dans l'ordre ; « Vérifier » te dit quand c'est réparé.",
  "Do what the Docteur says": "Faire ce que dit le Docteur",
  "Type this on the machine that runs Sklubot:": "Tape ça sur la machine qui fait tourner Sklubot :",
  "Restart Sklubot": "Redémarrer Sklubot",
  "Stop Sklubot and start it again so it reads the change.": "Arrête Sklubot et relance-le pour qu'il lise le changement.",
  "Check with the Docteur": "Vérifier avec le Docteur",
  "« Vérifier » runs this Docteur line again.": "« Vérifier » relance cette ligne du Docteur.",
  "Make a strong secret": "Créer un secret solide",
  "Put it in the .env file as SESSION_SECRET": "Le mettre dans le fichier .env comme SESSION_SECRET",
  "Open the .env file of Sklubot and replace the line SESSION_SECRET=… with the secret you just made. Do not paste it in the chat.":
    "Ouvre le fichier .env de Sklubot et remplace la ligne SESSION_SECRET=… par le secret que tu viens de créer. Ne le colle pas dans la discussion.",
  "Free some disk space": "Libérer de la place sur le disque",
  "Delete old files you no longer need, or empty the bots' trash in Settings.": "Supprime de vieux fichiers dont tu n'as plus besoin, ou vide la corbeille des bots dans Réglages.",
  "Install an authenticator app": "Installer une appli d'authentification",
  "On your phone: any authenticator app works (for example the one already on your phone). It is free.": "Sur ton téléphone : n'importe quelle appli d'authentification marche (par exemple celle déjà sur ton téléphone). C'est gratuit.",
  "This guide does not exist.": "Ce guide n'existe pas.",
  "You have no main bot to show the guide.": "Tu n'as pas de bot principal pour montrer le guide.",
  "There is no such card here.": "Il n'y a pas cette carte ici.",
  "This card is closed.": "Cette carte est fermée.",
  "Unknown step.": "Étape inconnue.",
  "This step is checked by the server: press « Vérifier ».": "Cette étape est vérifiée par le serveur : appuie sur « Vérifier ».",
  "Unknown action.": "Action inconnue.",
  // Engine warm-up (enginewarmup.ts)
  "This bot does not run on a subscription engine.": "Ce bot ne tourne pas sur un moteur d'abonnement.",
  "The engine is not installed on this bot's computer.": "Le moteur n'est pas installé sur l'ordinateur de ce bot.",
  "The bot's computer could not start: {reason}": "L'ordinateur du bot n'a pas pu démarrer : {reason}",
  "This installation has no bot computers.": "Cette installation n'a pas d'ordinateurs de bots.",
  // Plan → board (boardplan.ts)
  "Give the plan at least one task.": "Donne au moins une tâche au plan.",
  "At most {n} tasks in one plan.": "Au plus {n} tâches dans un plan.",
  "Task {n} needs a title.": "La tâche {n} a besoin d'un titre.",
  "Task {n} waits on a task that is not before it in the plan.": "La tâche {n} attend une tâche qui n'est pas avant elle dans le plan.",
  "Task {n}: there is no bot called “{name}”.": "Tâche {n} : il n'y a pas de bot appelé « {name} ».",
  "The board is too full for this plan ({n} tasks at most): delete finished tasks first.": "Le tableau est trop plein pour ce plan ({n} tâches au plus) : supprime d'abord les tâches finies.",
  "Tick at least one task.": "Coche au moins une tâche.",
  "This plan was already answered.": "Ce plan a déjà reçu une réponse.",
  "Plan put on the board: {n} task(s).": "Plan mis sur le tableau : {n} tâche(s).",
  "Plan put on the board and launched: {n} task(s).": "Plan mis sur le tableau et lancé : {n} tâche(s).",
  "Nobody holds the role “{role}” yet: here is a proposal for a bot to take it. Nothing is created until you press « Créer ».":
    "Personne ne tient encore le rôle « {role} » : voici une proposition de bot pour le prendre. Rien n'est créé avant que tu appuies sur « Créer ».",
  "You have no main bot to show the proposal.": "Tu n'as pas de bot principal pour montrer la proposition.",
  "{name} now holds its role on the work board.": "{name} tient maintenant son rôle sur le tableau de travail.",
  "A bot already holds this role.": "Un bot tient déjà ce rôle.",
  "The lead is the main bot: it needs no new bot.": "Le chef est le bot principal : pas besoin d'un nouveau bot.",
  "Unknown role.": "Rôle inconnu.",
  "A proposal for this role is already waiting for you.": "Une proposition pour ce rôle t'attend déjà.",
  "Take the board tasks of the role “{role}” (the work board gives them to you). Start by saying hello in one line.":
    "Prends les tâches du tableau du rôle « {role} » (le tableau de travail te les confie). Commence par dire bonjour en une ligne.",
  "Nobody holds this role on the work board, and tasks of this kind would wait for nobody.": "Personne ne tient ce rôle sur le tableau de travail, et les tâches de ce genre n'auraient personne pour les faire.",
  "Coder": "Codeur", "Reviewer": "Relecteur", "Researcher": "Chercheur", "Writer": "Documentaliste", "Helper": "Assistant",
  "You write and change code for the work board's tasks, in small steps, and say what you changed and how you checked it.":
    "Tu écris et modifies du code pour les tâches du tableau de travail, par petites étapes, et tu dis ce que tu as changé et comment tu l'as vérifié.",
  "You review the work of the other bots: you look for bugs, risks and missing tests, and say clearly « OK » or « à corriger », with why.":
    "Tu relis le travail des autres bots : tu cherches les bogues, les risques et les tests qui manquent, et tu dis clairement « OK » ou « à corriger », avec pourquoi.",
  "You look things up for the work board's tasks: you read sources, give the links, and never invent a figure.":
    "Tu cherches des informations pour les tâches du tableau de travail : tu lis des sources, tu donnes les liens, et tu n'inventes jamais un chiffre.",
  "You write the documentation of what the team made: short, simple words, with examples.": "Tu écris la documentation de ce que l'équipe a fait : court, en mots simples, avec des exemples.",
  "You take the small chores of the work board: tidying, renaming, simple checks.": "Tu prends les petites corvées du tableau de travail : ranger, renommer, vérifications simples.",
};

/** The owner's text: French when the account is in French and the text has its line, else the English key. */
export function gt(locale: Locale | undefined, english: string, vars: Record<string, string | number> = {}): string {
  const template = locale === "fr" ? GUIDE_FR[english] ?? english : english;
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}
