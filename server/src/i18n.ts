import type { Locale } from "./shared.js";

/**
 * Texts the server itself writes into a chat (notices, event lines, step labels, approval titles).
 * English is the key; French is looked up here. Anything missing falls back to English.
 */
const FR: Record<string, string> = {
  "Stopped.": "Arrêté.",
  "Something went wrong: {detail}": "Un problème est survenu : {detail}",
  "This month's budget is used up, so I'm paused. Raise or clear the budget in Settings → Usage to continue.": "Le budget du mois est épuisé, je suis donc en pause. Augmente ou retire le budget dans Réglages → Usage pour continuer.",
  "The reply was cut off because it got too long. Ask me to continue.": "La réponse a été coupée car elle devenait trop longue. Demande-moi de continuer.",
  "I stopped after {n} steps to avoid running away with this. Tell me to continue if it is worth it.": "Je me suis arrêté après {n} étapes pour ne pas m'emballer. Dis-moi de continuer si ça en vaut la peine.",
  "The model declined this request.": "Le modèle a refusé cette demande.",
  "Allow {bot} to run a command?": "Autoriser {bot} à exécuter une commande ?",
  "Allow {bot} to use {app}: {action}?": "Autoriser {bot} à utiliser {app} : {action} ?",
  "Allow {bot} to type the saved {field} for {item}?": "Autoriser {bot} à saisir {field} enregistré pour {item} ?",
  "username": "l'identifiant", "password": "le mot de passe",
  "run a command": "exécuter une commande",
  "use {app}: {action}": "utiliser {app} : {action}",
  "type a saved login for {item}": "saisir un identifiant enregistré pour {item}",
  "This computer": "Cet ordinateur", "Vault": "Coffre",
  "Running routine: {name}": "Routine en cours : {name}",
  "Routine created: {name} — {when}": "Routine créée : {name} — {when}",
  "Routine updated: {name} — {when}": "Routine modifiée : {name} — {when}",
  "paused": "en pause",
  "{names} joined": "{names} a rejoint le groupe", "{names} left": "{names} a quitté le groupe",
  "{bot} created this group with {names}.": "{bot} a créé ce groupe avec {names}.",
  "Waiting for you: {title}": "En attente de toi : {title}", "Connect {name}": "Connecter {name}",
  "Group": "Groupe", "Helper": "Assistant", "Group chat with {n} bots.": "Discussion de groupe avec {n} bots.",
  "Temporary helper working for {name}.": "Assistant temporaire au service de {name}.",
  "Chief of staff": "Bras droit",
  "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots.": "Ton interlocuteur principal. Suit ce qui est en cours, te fait signe quand quelque chose demande ton attention et coordonne les autres bots.",
  // Step labels
  "Looking at the screen": "Regarde l'écran", "Opening a page": "Ouvre une page", "Reading the page": "Lit la page", "Clicking": "Clique",
  "Typing": "Saisit du texte", "Pressing keys": "Appuie sur des touches", "Scrolling": "Fait défiler", "Dragging": "Fait glisser",
  "Reading a page": "Lit une page", "Running a command": "Exécute une commande", "Saving a file": "Enregistre un fichier",
  "Saving a note": "Mémorise une information", "Checking notes": "Consulte sa mémoire", "Setting up a routine": "Prépare une routine",
  "Checking routines": "Consulte ses routines", "Updating a routine": "Modifie une routine", "Removing a routine": "Supprime une routine",
  "Adjusting check-ins": "Règle les points réguliers", "Tracking a task": "Suit une tâche", "Updating a task": "Met à jour une tâche",
  "Messaging a teammate": "Écrit à un coéquipier", "Starting a helper": "Lance un assistant", "Checking on helpers": "Fait le point avec ses assistants",
  "Messaging a helper": "Écrit à un assistant", "Stopping a helper": "Arrête un assistant", "Creating a group": "Crée un groupe",
  "Posting to a group": "Écrit dans un groupe", "Asking you": "Te pose une question", "Asking to connect an app": "Demande à connecter une application",
  "Nothing to report": "Rien à signaler", "Using {app}": "Utilise {app}", "an app": "une application",
  "Sending a file": "Envoie un fichier", "Creating an image": "Crée une image", "Checking saved logins": "Consulte le coffre", "Typing a saved login": "Saisit un identifiant enregistré",
  "not allowed": "non autorisé", "skipped": "ignoré", "stopped": "arrêté",
  // Schedules
  "Every day at {time}": "Tous les jours à {time}", "Weekdays at {time}": "En semaine à {time}", "Every {day} at {time}": "Chaque {day} à {time}",
  "Every hour": "Toutes les heures", "Every {n} minutes": "Toutes les {n} minutes", "Every {n} hours": "Toutes les {n} heures",
  "When its web address is called": "Quand son adresse web est appelée", "Once on {date}": "Une fois, le {date}", "Once": "Une fois",
  "Sunday": "dimanche", "Monday": "lundi", "Tuesday": "mardi", "Wednesday": "mercredi", "Thursday": "jeudi", "Friday": "vendredi", "Saturday": "samedi",
};

export function tr(locale: Locale | undefined, english: string, vars: Record<string, string | number> = {}): string {
  const template = locale === "fr" ? FR[english] ?? english : english;
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

export const pickLocale = (value: unknown, acceptLanguage?: string | null): Locale =>
  value === "fr" || value === "en" ? value : /^\s*fr/i.test(acceptLanguage ?? "") ? "fr" : "en";
