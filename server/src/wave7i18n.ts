/** French texts of wave 7 (L164 accessibility tree, L172 other agents, L174 plugins, L177 phone, L178 shared documents, L179 live vaults). */
export const WAVE7_FR: Record<string, string> = {
  // L164
  "Allow {bot} to press “{label}” in {app} on {device}?": "Autoriser {bot} à appuyer sur « {label} » dans {app} sur {device} ?",
  "press “{label}” on {device}": "appuyer sur « {label} » sur {device}",
  "These words commit something (send, pay, delete, publish, confirm…): you are asked every time.": "Ces mots engagent quelque chose (envoyer, payer, supprimer, publier, confirmer…) : on te demande à chaque fois.",
  "not available": "pas disponible", "password field": "champ mot de passe", "not found": "introuvable",
  // L172
  "Allow {bot} to send this to the agent {agent} ({kind})?": "Autoriser {bot} à envoyer ceci à l'agent {agent} ({kind}) ?",
  "{bot} has read outside content. Allow it to send this to the agent {agent}?": "{bot} a lu du contenu extérieur. L'autoriser à envoyer ceci à l'agent {agent} ?",
  "work with the agent {agent}": "travailler avec l'agent {agent}", "Message: “{message}”": "Message : « {message} »", "Other agents": "Autres agents",
  "The agent's address must start with https://.": "L'adresse de l'agent doit commencer par https://.",
  "Give the agent's address (https://…).": "Donne l'adresse de l'agent (https://…).",
  "This address gives no Agent Card.": "Cette adresse ne donne pas de fiche d'agent (Agent Card).",
  "This agent offers no JSON-RPC interface (the only one Sklubot speaks).": "Cet agent n'offre pas d'accès JSON-RPC (le seul que Sklubot parle).",
  "At most 20 other agents.": "20 autres agents au plus.",
  // L174
  "No such plugin.": "Ce greffon n'existe pas.", "No such bot.": "Ce bot n'existe pas.",
  "This bot already has a plugin of that name: remove it first.": "Ce bot a déjà un greffon de ce nom : retire-le d'abord.",
  "A bot can have 10 plugins at most.": "Un bot peut avoir 10 greffons au plus.",
  "The safety check found a danger in this plugin: read the findings, then accept them to install it anyway.": "Le contrôle de sécurité a trouvé un danger dans ce greffon : lis les points relevés, puis accepte-les pour l'installer quand même.",
  "It says it needs no internet, but runs with the bot's computer's internet rules.": "Il dit ne pas avoir besoin d'internet, mais tourne avec les règles internet de l'ordinateur du bot.",
  "The bot's computer has no internet: this plugin's network use will be refused.": "L'ordinateur du bot n'a pas internet : l'usage du réseau par ce greffon sera refusé.",
  "Not in the bot's allowed sites, so refused: {hosts}.": "Pas dans les sites autorisés du bot, donc refusé : {hosts}.",
  // L177
  "This request is no longer waiting.": "Cette demande n'attend plus.", "This photo cannot be read.": "Cette photo ne peut pas être lue.",
  // L178
  "No such document.": "Ce document n'existe pas.", "At most {n} shared documents.": "{n} documents partagés au plus.",
  "The document is too long.": "Le document est trop long.", "This change cannot be read.": "Cette modification ne peut pas être lue.",
  "This change was made on an unknown version: reload the document.": "Cette modification vient d'une version inconnue : recharge le document.",
  "This change was made on a version too old: reload the document.": "Cette modification vient d'une version trop ancienne : recharge le document.",
  "This change no longer fits the document: reload it.": "Cette modification ne colle plus au document : recharge-le.",
  "That version is no longer kept.": "Cette version n'est plus gardée.", "That change is no longer kept.": "Cette modification n'est plus gardée.",
  "That change was already undone.": "Cette modification a déjà été annulée.",
  // L179
  "Paste the service account token (it starts with ops_).": "Colle le jeton du compte de service (il commence par ops_).",
  "The server address must start with https://.": "L'adresse du serveur doit commencer par https://.",
  "The client_id of a Bitwarden personal API key looks like user.xxxxxxxx-….": "Le client_id d'une clé d'API personnelle Bitwarden ressemble à user.xxxxxxxx-….",
  "Give the client_secret and the master password.": "Donne le client_secret et le mot de passe principal.",
  "The vault could not be read: {why}": "Le coffre n'a pas pu être lu : {why}",
  "Unknown vault.": "Coffre inconnu.", "This vault is not connected.": "Ce coffre n'est pas connecté.", "Not found.": "Introuvable.",
  "live vault unreachable": "coffre en direct injoignable",
  // Tool labels (the live activity line)
  "Reading an app on your computer": "Lit une appli sur ton ordinateur", "Using an app on your computer": "Utilise une appli sur ton ordinateur",
  "Waiting for a photo from your phone": "Attend une photo de ton téléphone", "Waiting for your position": "Attend ta position",
  "Listing shared documents": "Liste les documents partagés", "Reading a shared document": "Lit un document partagé", "Writing in a shared document": "Écrit dans un document partagé",
  "Listing other agents": "Liste les autres agents", "Working with another agent": "Travaille avec un autre agent", "Proposing a plugin": "Propose un greffon",
  "already waiting": "déjà en attente", "refused": "refusé", "no answer": "pas de réponse", "photo": "photo", "position": "position", "agent error": "erreur de l'agent", "stale reference": "référence périmée",
};
