import type { Locale, SentinelLink, SentinelSeverity } from "../shared.js"; import { localize } from "../lang/index.js";

/**
 * Sentinelle — what an incident says, in plain French (and English): a title, what is happening, and what to do. The
 * incident keeps only numbers and short identifiers (`params`); names (a bot's, a routine's, an account's e-mail) are
 * looked up when the page is shown, and only the viewer's own names are shown as such (view.ts).
 */
export interface TextVars { [k: string]: string | number }
interface Entry { title: string; explain: string; fix: string }

/** French for every text above, keyed by the English text (other languages: server/src/lang/<code>.ts, docs/LANGUES.md). */
const SENTINEL_FR: Record<string, string> = {
  "provider overloaded": "surcharge du fournisseur",
  "provider server error": "erreur du serveur du fournisseur",
  "network problem": "problème réseau",
  "timed out": "délai dépassé",
  "other error": "autre erreur",
  "authentication": "authentification",
  "rate limit": "limite de débit",
  "context too long": "contexte trop long",
  "requests refused by the proxy": "requêtes refusées par le proxy",
  "Docker daemon unreachable": "démon Docker injoignable",
  "other errors": "autres erreurs",
  "The tool “{tool}” keeps failing": "L'outil « {tool} » échoue souvent",
  "{failed} of {total} calls failed in the last hour ({bot}).": "{failed} appels sur {total} ont échoué dans la dernière heure ({bot}).",
  "Open the bot to read the error. Often: a connection to redo, a site that changed, or a tool setting. If the tool is no longer needed, turn it off in the bot's settings.": "Ouvre le bot pour lire l'erreur. Souvent : une connexion à refaire, un site qui a changé ou un réglage de l'outil. Si l'outil ne sert plus, désactive-le dans les réglages du bot.",
  "{provider} refuses the sign-in": "Connexion refusée par {provider}",
  "{n} authentication failure(s) in the last hour: the key or the session is no longer accepted (for example an expired “refresh token” for Claude Code or Codex).": "{n} échec(s) d'authentification dans la dernière heure : la clé ou la session n'est plus acceptée (par exemple un « refresh token » expiré pour Claude Code ou Codex).",
  "Open Settings → Models. Choose your Claude or ChatGPT subscription and check the bot’s connection. For an API provider, check its key on the same page.": "Ouvre Réglages → Modèles. Choisis ton abonnement Claude ou ChatGPT et vérifie la connexion du bot. Pour un fournisseur API, vérifie sa clé sur cette même page.",
  "{provider} rate limit reached": "Limite de débit atteinte chez {provider}",
  "{n} “too many requests” (429) refusals in the last hour. The bots wait and retry, but everything slows down.": "{n} refus « trop de requêtes » (429) dans la dernière heure. Les bots attendent et réessaient, mais tout ralentit.",
  "Spread routines over the day, run fewer bots at once, or add a backup model (Settings → Models → Reliability).": "Étale les routines dans la journée, réduis le nombre de bots qui travaillent en même temps, ou ajoute un modèle de secours (Réglages → Modèles → Fiabilité).",
  "Conversations too long for {provider}": "Conversations trop longues pour {provider}",
  "{n} call(s) refused in the last hour because the conversation is longer than the model accepts.": "{n} appel(s) refusé(s) dans la dernière heure car la conversation dépasse la taille que le modèle accepte.",
  "The bots already summarise their history; if it goes on, pick a model with a bigger context window or start a new thread.": "Les bots résument déjà l'historique ; si ça continue, choisis un modèle à plus grande fenêtre de contexte ou commence un nouveau fil.",
  "Model failures at {provider}": "Échecs du modèle chez {provider}",
  "{n} model call(s) failed in the last hour ({code}).": "{n} appel(s) au modèle ont échoué dans la dernière heure ({code}).",
  "If the provider has an outage, wait for it to pass; otherwise add a backup model (Settings → Models). The details are in the server's log.": "Si le fournisseur a un incident en cours, attends qu'il passe ; sinon ajoute un modèle de secours (Réglages → Modèles). Le détail est dans le journal du serveur.",
  "Turns get stuck without progress": "Des tours restent bloqués sans progrès",
  "{n} turn(s) went more than 5 minutes without any progress in the last 6 hours.": "{n} tour(s) sont restés plus de 5 minutes sans le moindre progrès ces 6 dernières heures.",
  "Look at the screens of the bots' computers (a frozen window, a sign-in to redo) and at the server's load (CPU, memory).": "Regarde l'écran des ordinateurs des bots concernés (fenêtre figée, connexion à refaire), et la charge du serveur (processeur, mémoire).",
  "The subscription tool stops mid-turn": "L'outil d'abonnement s'arrête en plein travail",
  "{n} time(s) in the last 6 hours, Claude Code or Codex stopped before the end of the turn.": "{n} fois ces 6 dernières heures, Claude Code ou Codex s'est arrêté avant la fin du tour.",
  "Check the subscription connection in Settings → Models, then check the free memory on the bot’s computer.": "Vérifie la connexion de l’abonnement dans Réglages → Modèles, puis la mémoire disponible sur le bureau du bot.",
  "The AI is slow to answer": "L'IA tarde à répondre",
  "{n} turn(s) got no answer at all from the AI for more than 20 seconds in the last 6 hours.": "{n} tour(s) sont restés plus de 20 secondes sans la moindre réponse de l'IA ces 6 dernières heures.",
  "Usually temporary (a busy provider). If it lasts, check the subscription's connection or add a backup model.": "C'est souvent passager (fournisseur chargé). Si ça dure, vérifie la connexion de l'abonnement ou ajoute un modèle de secours.",
  "A routine keeps failing": "Une routine échoue à répétition",
  "The routine {routine} failed {n} times in a row.": "La routine {routine} a échoué {n} fois de suite.",
  "Open the bot's routines to read the last error, fix the cause (a connection, the instructions), then run it again.": "Ouvre les routines du bot pour lire la dernière erreur, corrige la cause (connexion, consigne), puis relance-la.",
  "A routine was paused": "Une routine a été mise en pause",
  "The server paused the routine {routine} ({n} failure(s) in a row).": "La routine {routine} a été mise en pause par le serveur ({n} échec(s) de suite).",
  "Open the bot's routines to read why, fix it, then turn the routine back on.": "Ouvre les routines du bot pour lire la raison, corrige-la, puis réactive la routine.",
  "Connections to redo": "Connexions à refaire",
  "{n} connection(s) or key(s) are no longer accepted ({account}).": "{n} connexion(s) ou clé(s) ne sont plus acceptées ({account}).",
  "Settings → Connections: sign in again or replace the key. The routines that depend on it wait, paused.": "Réglages → Connexions : refais la connexion ou remplace la clé. Les routines qui en dépendent attendent en pause.",
  "Work has been waiting in the queue for long": "Du travail attend dans la file depuis longtemps",
  "{n} message(s) have been waiting for more than 2 hours (the oldest for {age} min).": "{n} message(s) attendent depuis plus de 2 heures (le plus ancien depuis {age} min).",
  "A bot may be stuck on a turn that never ends: open it and press “Stop”, or restart the server. Nothing is lost: the queue resumes in order.": "Un bot est peut-être bloqué sur un tour qui ne finit pas : ouvre-le et appuie sur « Arrêter », ou redémarre le serveur. Rien n'est perdu : la file reprend dans l'ordre.",
  "Disk almost full": "Disque presque plein",
  "{freeMb} MB free out of {totalMb} MB for Sklubot's data (threshold: {minMb} MB).": "Il reste {freeMb} Mo libres sur {totalMb} Mo pour les données de Sklubot (seuil : {minMb} Mo).",
  "Free some space: old database copies, unused Docker images (docker system prune), the bots' files. Or grow the disk.": "Libère de la place : anciennes copies de la base, images Docker inutiles (docker system prune), fichiers des bots. Ou agrandis le disque.",
  "Disk full": "Disque plein",
  "Only {freeMb} MB left: the database may refuse writes and the bots stop.": "Il ne reste que {freeMb} Mo libres : la base de données peut refuser d'écrire et les bots s'arrêter.",
  "Free some space now (docker system prune, old database copies), then grow the disk.": "Libère de la place tout de suite (docker system prune, anciennes copies de la base), puis agrandis le disque.",
  "Backups are failing": "La sauvegarde échoue",
  "The last backup failed ({failures} failure(s) in a row).": "La dernière sauvegarde a échoué ({failures} échec(s) de suite).",
  "Settings → Account → Automatic backup: test the storage connection, check the keys and the bucket's space, then “Back up now”.": "Réglages → Compte → Sauvegarde automatique : teste la connexion au stockage, vérifie les clés et la place dans le bucket, puis « Sauvegarder maintenant ».",
  "No recent backup": "Pas de sauvegarde récente",
  "The last successful backup is {hours} hours old.": "La dernière sauvegarde réussie date de {hours} heures.",
  "Settings → Account → Automatic backup: check it is on, then “Back up now”. With deploy/backup.sh, check its cron job.": "Réglages → Compte → Sauvegarde automatique : vérifie qu'elle est activée, puis lance « Sauvegarder maintenant ». Avec le script deploy/backup.sh, vérifie sa tâche planifiée (cron).",
  "Customer accounts out of AI budget": "Comptes clients au bout de leur budget IA",
  "{n} account(s) spent their whole AI budget for the month: their bots wait on your keys.": "{n} compte(s) ont dépensé tout leur budget IA du mois : leurs bots attendent sur tes clés.",
  "Nothing urgent: offer a top-up or another plan (Settings → Administration).": "Rien d'urgent : propose une recharge ou un autre forfait (Réglages → Administration).",
  "Docker does not answer": "Docker ne répond pas",
  "The Docker engine (through Sklubot's proxy) does not answer ({code}): the bots' computers cannot start.": "Le moteur Docker (via le proxy de Sklubot) ne répond pas ({code}) : les ordinateurs des bots ne peuvent pas démarrer.",
  "Check that the docker-proxy service runs (docker compose ps) and that Docker is started on the server.": "Vérifie que le service docker-proxy tourne (docker compose ps) et que Docker est démarré sur le serveur.",
  "Docker proxy errors": "Erreurs du proxy Docker",
  "{n} call(s) to Docker failed in the last hour ({class}).": "{n} appel(s) à Docker ont échoué dans la dernière heure ({class}).",
  "Read the docker-proxy service's log: a refused request points to a setting to review; an unreachable daemon, a stopped or overloaded Docker.": "Lis le journal du service docker-proxy : une requête refusée signale un réglage à revoir ; un démon injoignable, un Docker arrêté ou surchargé.",
  "Unusual spending": "Dépense inhabituelle",
  "{last} $ spent in the last 24 hours, against {base} $ a day on average the week before ({account}).": "{last} $ dépensés ces dernières 24 heures, contre {base} $ par jour en moyenne la semaine d'avant ({account}).",
  "Settings → Usage shows which bot spends. A routine running in a loop can be paused; you can also set a cap (Settings → Usage → Caps).": "Réglages → Consommation montre quel bot dépense. Une routine qui tourne en boucle se met en pause ; tu peux aussi fixer un plafond (Réglages → Consommation → Plafonds).",
  "Burst of failed sign-ins": "Rafale d'échecs de connexion",
  "{n} failed sign-ins in 15 minutes, from {sources} address(es). Someone may be trying passwords.": "{n} tentatives de connexion ratées en 15 minutes, depuis {sources} adresse(s). C'est peut-être quelqu'un qui essaie des mots de passe.",
  "Sklubot already slows the attempts down. If it goes on, block the addresses on your firewall or proxy, and make sure the accounts have strong passwords.": "Les essais sont déjà freinés par Sklubot. Si ça continue, bloque les adresses en cause sur ton pare-feu ou ton proxy, et vérifie que les comptes ont des mots de passe solides.",
  "Many errors in the server's log": "Beaucoup d'erreurs dans le journal du serveur",
  "{n} errors written to the server's log in one hour.": "{n} erreurs écrites dans le journal du serveur en une heure.",
  "Read the server's log (docker compose logs sklubot) to find the cause; a repeating error usually has a single origin.": "Lis le journal du serveur (docker compose logs sklubot) pour en trouver la cause ; une erreur qui se répète a souvent une seule origine.",
  "Uncaught exception": "Exception non rattrapée",
  "{n} uncaught exception(s) in the last hour: the server went on, but an action may have stopped short.": "{n} exception(s) non rattrapée(s) dans la dernière heure : le serveur a continué, mais une action a pu s'arrêter net.",
  "Read the server's log around “[uncaught]” and report it if it repeats.": "Lis le journal du serveur autour de « [uncaught] » et signale-le si ça se répète.",
  "The scheduler stopped": "Le planificateur ne tourne plus",
  "Its last tick was {min} minutes ago: routines and reminders no longer go out.": "Son dernier passage date de {min} minutes : les routines et les rappels ne partent plus.",
  "Restart the server. If it comes back, read the server's log.": "Redémarre le serveur. Si ça revient, lis le journal du serveur.",
  "E-mail sign-ups closed: the server sends no e-mails": "Inscriptions par e-mail fermées : le serveur n'envoie pas d'e-mails",
  "The server is open to the public but cannot send e-mails: since address verification is mandatory, sign-ups with an e-mail and password are refused (only “Continue with Google” works) and “Forgot password?” does not work.": "Le serveur est ouvert au public mais ne sait pas envoyer d'e-mails : la vérification de l'adresse étant obligatoire, les inscriptions par e-mail et mot de passe sont refusées (seul « Continuer avec Google » marche) et « Mot de passe oublié ? » ne marche pas.",
  "Settings → Account → Server e-mails: set up an SMTP account (or the SMTP_* variables), then send a test e-mail. See docs/OUVERTURE-PUBLIQUE.md.": "Réglages → Compte → E-mails du serveur : configure un compte SMTP (ou les variables SMTP_*), puis envoie un e-mail de test. Voir docs/OUVERTURE-PUBLIQUE.md.",
  "Open sign-ups without address verification": "Inscriptions ouvertes sans vérification d'adresse",
  "EMAIL_VERIFICATION=0: anyone can create an account with someone else's address and use it at once (spam, abuse, throwaway accounts).": "EMAIL_VERIFICATION=0 : n'importe qui peut créer un compte avec l'adresse de quelqu'un d'autre et l'utiliser aussitôt (spam, abus, comptes jetables).",
  "Remove EMAIL_VERIFICATION=0 from the server's environment (with an SMTP account set up) and redeploy.": "Retire EMAIL_VERIFICATION=0 de l'environnement du serveur (avec un compte SMTP configuré) et redéploie.",
  "Open sign-ups without an anti-robot check": "Inscriptions ouvertes sans vérification anti-robot",
  "Anyone can sign up, without Cloudflare Turnstile: only the rate limits slow robots down.": "Les inscriptions sont ouvertes à tous, sans Cloudflare Turnstile : seules les limites de débit freinent les robots.",
  "Create a Turnstile widget in the Cloudflare dashboard, then add TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to the server's environment and redeploy.": "Crée un widget Turnstile dans le tableau de bord Cloudflare, puis ajoute TURNSTILE_SITE_KEY et TURNSTILE_SECRET_KEY à l'environnement du serveur et redéploie.",
  "Warning": "Attention",
  "Critical": "Critique",
  "New incident": "Nouvel incident",
  "{n} new incidents": "{n} nouveaux incidents",
  "Incident resolved": "Incident résolu",
  "{n} incidents resolved": "{n} incidents résolus",
  "Incident escalated": "Incident aggravé",
  "Monitoring: daily summary": "Surveillance : le point du jour",
  "Minor signals of the last 24 hours (nothing urgent):": "Petits signaux des dernières 24 heures (rien d'urgent) :",
  "Your Sklubot server's Sentinelle noticed this:": "La Sentinelle de ton serveur Sklubot a remarqué ceci :",
  "What to do:": "Que faire :",
  "Open the Monitoring page:": "Ouvrir la page Surveillance :",
  "You get this because you watch this server (Settings → Monitoring to change the alerts).": "Tu reçois ce message parce que tu surveilles ce serveur (Réglages → Surveillance pour changer les alertes).",
  "Back to normal:": "C'est rentré dans l'ordre :",
  "a bot of the account {account}": "un bot du compte {account}",
  "a deleted bot": "un bot supprimé",
  "your account": "ton compte",
  "a deleted account": "un compte supprimé",
  "of a bot of the account {account}": "d'un bot du compte {account}",
};

const PROVIDER: Record<string, string> = {
  claude_code: "Claude Code", codex: "Codex", anthropic: "Anthropic", openai: "OpenAI",
};
const CODE: Record<string, string> = {
  overloaded: "provider overloaded", server: "provider server error",
  network: "network problem", timeout: "timed out", other: "other error",
  auth: "authentication", rate_limit: "rate limit", context: "context too long",
};
const DOCKER: Record<string, string> = {
  proxy_refused: "requests refused by the proxy", daemon_unreachable: "Docker daemon unreachable", other: "other errors",
};

const T: Record<string, Entry> = {
  tool_errors: {
    title: "The tool “{tool}” keeps failing",
    explain: "{failed} of {total} calls failed in the last hour ({bot}).",
    fix: "Open the bot to read the error. Often: a connection to redo, a site that changed, or a tool setting. If the tool is no longer needed, turn it off in the bot's settings.",
  },
  "turn_failures:auth": {
    title: "{provider} refuses the sign-in",
    explain: "{n} authentication failure(s) in the last hour: the key or the session is no longer accepted (for example an expired “refresh token” for Claude Code or Codex).",
    fix: "Open Settings → Models. Choose your Claude or ChatGPT subscription and check the bot’s connection. For an API provider, check its key on the same page.",
  },
  "turn_failures:rate_limit": {
    title: "{provider} rate limit reached",
    explain: "{n} “too many requests” (429) refusals in the last hour. The bots wait and retry, but everything slows down.",
    fix: "Spread routines over the day, run fewer bots at once, or add a backup model (Settings → Models → Reliability).",
  },
  "turn_failures:context": {
    title: "Conversations too long for {provider}",
    explain: "{n} call(s) refused in the last hour because the conversation is longer than the model accepts.",
    fix: "The bots already summarise their history; if it goes on, pick a model with a bigger context window or start a new thread.",
  },
  turn_failures: {
    title: "Model failures at {provider}",
    explain: "{n} model call(s) failed in the last hour ({code}).",
    fix: "If the provider has an outage, wait for it to pass; otherwise add a backup model (Settings → Models). The details are in the server's log.",
  },
  "engine_watch:stalled": {
    title: "Turns get stuck without progress",
    explain: "{n} turn(s) went more than 5 minutes without any progress in the last 6 hours.",
    fix: "Look at the screens of the bots' computers (a frozen window, a sign-in to redo) and at the server's load (CPU, memory).",
  },
  "engine_watch:gone": {
    title: "The subscription tool stops mid-turn",
    explain: "{n} time(s) in the last 6 hours, Claude Code or Codex stopped before the end of the turn.",
    fix: "Check the subscription connection in Settings → Models, then check the free memory on the bot’s computer.",
  },
  "engine_watch:silent": {
    title: "The AI is slow to answer",
    explain: "{n} turn(s) got no answer at all from the AI for more than 20 seconds in the last 6 hours.",
    fix: "Usually temporary (a busy provider). If it lasts, check the subscription's connection or add a backup model.",
  },
  "routine_failures:failing": {
    title: "A routine keeps failing",
    explain: "The routine {routine} failed {n} times in a row.",
    fix: "Open the bot's routines to read the last error, fix the cause (a connection, the instructions), then run it again.",
  },
  "routine_failures:paused": {
    title: "A routine was paused",
    explain: "The server paused the routine {routine} ({n} failure(s) in a row).",
    fix: "Open the bot's routines to read why, fix it, then turn the routine back on.",
  },
  connector_auth: {
    title: "Connections to redo",
    explain: "{n} connection(s) or key(s) are no longer accepted ({account}).",
    fix: "Settings → Connections: sign in again or replace the key. The routines that depend on it wait, paused.",
  },
  queue_stuck: {
    title: "Work has been waiting in the queue for long",
    explain: "{n} message(s) have been waiting for more than 2 hours (the oldest for {age} min).",
    fix: "A bot may be stuck on a turn that never ends: open it and press “Stop”, or restart the server. Nothing is lost: the queue resumes in order.",
  },
  "disk_low:low": {
    title: "Disk almost full",
    explain: "{freeMb} MB free out of {totalMb} MB for Sklubot's data (threshold: {minMb} MB).",
    fix: "Free some space: old database copies, unused Docker images (docker system prune), the bots' files. Or grow the disk.",
  },
  "disk_low:full": {
    title: "Disk full",
    explain: "Only {freeMb} MB left: the database may refuse writes and the bots stop.",
    fix: "Free some space now (docker system prune, old database copies), then grow the disk.",
  },
  "backup:failed": {
    title: "Backups are failing",
    explain: "The last backup failed ({failures} failure(s) in a row).",
    fix: "Settings → Account → Automatic backup: test the storage connection, check the keys and the bucket's space, then “Back up now”.",
  },
  "backup:old": {
    title: "No recent backup",
    explain: "The last successful backup is {hours} hours old.",
    fix: "Settings → Account → Automatic backup: check it is on, then “Back up now”. With deploy/backup.sh, check its cron job.",
  },
  hosted_budget: {
    title: "Customer accounts out of AI budget",
    explain: "{n} account(s) spent their whole AI budget for the month: their bots wait on your keys.",
    fix: "Nothing urgent: offer a top-up or another plan (Settings → Administration).",
  },
  "docker:unreachable": {
    title: "Docker does not answer",
    explain: "The Docker engine (through Sklubot's proxy) does not answer ({code}): the bots' computers cannot start.",
    fix: "Check that the docker-proxy service runs (docker compose ps) and that Docker is started on the server.",
  },
  "docker:errors": {
    title: "Docker proxy errors",
    explain: "{n} call(s) to Docker failed in the last hour ({class}).",
    fix: "Read the docker-proxy service's log: a refused request points to a setting to review; an unreachable daemon, a stopped or overloaded Docker.",
  },
  cost_spike: {
    title: "Unusual spending",
    explain: "{last} $ spent in the last 24 hours, against {base} $ a day on average the week before ({account}).",
    fix: "Settings → Usage shows which bot spends. A routine running in a loop can be paused; you can also set a cap (Settings → Usage → Caps).",
  },
  login_failures: {
    title: "Burst of failed sign-ins",
    explain: "{n} failed sign-ins in 15 minutes, from {sources} address(es). Someone may be trying passwords.",
    fix: "Sklubot already slows the attempts down. If it goes on, block the addresses on your firewall or proxy, and make sure the accounts have strong passwords.",
  },
  "error_rate:log": {
    title: "Many errors in the server's log",
    explain: "{n} errors written to the server's log in one hour.",
    fix: "Read the server's log (docker compose logs sklubot) to find the cause; a repeating error usually has a single origin.",
  },
  "error_rate:uncaught": {
    title: "Uncaught exception",
    explain: "{n} uncaught exception(s) in the last hour: the server went on, but an action may have stopped short.",
    fix: "Read the server's log around “[uncaught]” and report it if it repeats.",
  },
  scheduler: {
    title: "The scheduler stopped",
    explain: "Its last tick was {min} minutes ago: routines and reminders no longer go out.",
    fix: "Restart the server. If it comes back, read the server's log.",
  },
  "public_signup:no_mail": {
    title: "E-mail sign-ups closed: the server sends no e-mails",
    explain: "The server is open to the public but cannot send e-mails: since address verification is mandatory, sign-ups with an e-mail and password are refused (only “Continue with Google” works) and “Forgot password?” does not work.",
    fix: "Settings → Account → Server e-mails: set up an SMTP account (or the SMTP_* variables), then send a test e-mail. See docs/OUVERTURE-PUBLIQUE.md.",
  },
  "public_signup:no_verification": {
    title: "Open sign-ups without address verification",
    explain: "EMAIL_VERIFICATION=0: anyone can create an account with someone else's address and use it at once (spam, abuse, throwaway accounts).",
    fix: "Remove EMAIL_VERIFICATION=0 from the server's environment (with an SMTP account set up) and redeploy.",
  },
  "public_signup:no_turnstile": {
    title: "Open sign-ups without an anti-robot check",
    explain: "Anyone can sign up, without Cloudflare Turnstile: only the rate limits slow robots down.",
    fix: "Create a Turnstile widget in the Cloudflare dashboard, then add TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to the server's environment and redeploy.",
  },
};

const fill = (s: string, vars: TextVars) => s.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? "" : String(vars[k])));
const pick = (english: string, loc: Locale) => localize(loc, english, SENTINEL_FR);

/** The catalogue entry for a kind and its variant (params.v), falling back to the kind alone. */
export function entryKey(kind: string, variant?: string): string | null {
  if (variant && T[`${kind}:${variant}`]) return `${kind}:${variant}`;
  return T[kind] ? kind : null;
}
export const hasText = (kind: string, variant?: string) => entryKey(kind, variant) !== null;

/** Title, explanation and fix of an incident, in the viewer's language. `vars` already holds names where allowed. */
export function render(kind: string, params: TextVars, vars: TextVars, loc: Locale): { title: string; explanation: string; fix: string } {
  const key = entryKey(kind, typeof params.v === "string" ? params.v : undefined);
  if (!key) return { title: kind, explanation: "", fix: "" };
  const e = T[key];
  const all: TextVars = { ...params, ...vars };
  if (typeof params.provider === "string") all.provider = PROVIDER[params.provider] ? pick(PROVIDER[params.provider], loc) : params.provider;
  if (typeof params.code === "string") all.code = CODE[params.code] ? pick(CODE[params.code], loc) : params.code;
  if (typeof params.class === "string") all.class = DOCKER[params.class] ? pick(DOCKER[params.class], loc) : params.class;
  return { title: fill(pick(e.title, loc), all), explanation: fill(pick(e.explain, loc), all), fix: fill(pick(e.fix, loc), all) };
}

/** Words of the alerts and the page, by key. */
const W: Record<string, string> = {
  severity_info: "Info", severity_warn: "Warning", severity_critical: "Critical",
  new_one: "New incident", new_many: "{n} new incidents",
  resolved_one: "Incident resolved", resolved_many: "{n} incidents resolved",
  escalated: "Incident escalated",
  digest_title: "Monitoring: daily summary",
  digest_intro: "Minor signals of the last 24 hours (nothing urgent):",
  mail_intro: "Your Sklubot server's Sentinelle noticed this:",
  mail_fix: "What to do:", mail_open: "Open the Monitoring page:",
  mail_footer: "You get this because you watch this server (Settings → Monitoring to change the alerts).",
  now_ok: "Back to normal:",
  some_bot: "a bot of the account {account}", removed_bot: "a deleted bot",
  your_account: "your account", removed_account: "a deleted account",
  some_routine: "of a bot of the account {account}",
};
export const word = (key: string, loc: Locale, vars: TextVars = {}) => fill(W[key] ? pick(W[key], loc) : key, vars);
export const severityWord = (s: SentinelSeverity, loc: Locale) => word(`severity_${s}`, loc);

/** Where "Ouvrir" goes for a kind (bot links are made per viewer in view.ts). */
export function linkFor(kind: string): SentinelLink | null {
  switch (kind) {
    case "turn_failures": return { kind: "settings", section: "models" };
    case "connector_auth": return { kind: "settings", section: "connectors" };
    case "backup": return { kind: "settings", section: "account" };
    case "cost_spike": return { kind: "settings", section: "usage" };
    case "hosted_budget": return { kind: "settings", section: "admin" };
    case "public_signup": return { kind: "settings", section: "account" };
    case "disk_low": case "docker": case "queue_stuck": case "scheduler": case "error_rate": case "login_failures": case "engine_watch": return { kind: "health" };
    default: return null;
  }
}
