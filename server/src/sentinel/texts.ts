import type { Locale, SentinelLink, SentinelSeverity } from "../shared.js";

/**
 * Sentinelle — what an incident says, in plain French (and English): a title, what is happening, and what to do. The
 * incident keeps only numbers and short identifiers (`params`); names (a bot's, a routine's, an account's e-mail) are
 * looked up when the page is shown, and only the viewer's own names are shown as such (view.ts).
 */
export interface TextVars { [k: string]: string | number }
interface Entry { title: [fr: string, en: string]; explain: [string, string]; fix: [string, string] }

const PROVIDER: Record<string, [string, string]> = {
  claude_code: ["Claude Code", "Claude Code"], codex: ["Codex", "Codex"], anthropic: ["Anthropic", "Anthropic"], openai: ["OpenAI", "OpenAI"],
};
const CODE: Record<string, [string, string]> = {
  overloaded: ["surcharge du fournisseur", "provider overloaded"], server: ["erreur du serveur du fournisseur", "provider server error"],
  network: ["problème réseau", "network problem"], timeout: ["délai dépassé", "timed out"], other: ["autre erreur", "other error"],
  auth: ["authentification", "authentication"], rate_limit: ["limite de débit", "rate limit"], context: ["contexte trop long", "context too long"],
};
const DOCKER: Record<string, [string, string]> = {
  proxy_refused: ["requêtes refusées par le proxy", "requests refused by the proxy"], daemon_unreachable: ["démon Docker injoignable", "Docker daemon unreachable"], other: ["autres erreurs", "other errors"],
};

const T: Record<string, Entry> = {
  tool_errors: {
    title: ["L'outil « {tool} » échoue souvent", "The tool “{tool}” keeps failing"],
    explain: ["{failed} appels sur {total} ont échoué dans la dernière heure ({bot}).", "{failed} of {total} calls failed in the last hour ({bot})."],
    fix: ["Ouvre le bot pour lire l'erreur. Souvent : une connexion à refaire, un site qui a changé ou un réglage de l'outil. Si l'outil ne sert plus, désactive-le dans les réglages du bot.", "Open the bot to read the error. Often: a connection to redo, a site that changed, or a tool setting. If the tool is no longer needed, turn it off in the bot's settings."],
  },
  "turn_failures:auth": {
    title: ["Connexion refusée par {provider}", "{provider} refuses the sign-in"],
    explain: ["{n} échec(s) d'authentification dans la dernière heure : la clé ou la session n'est plus acceptée (par exemple un « refresh token » expiré pour Claude Code ou Codex).", "{n} authentication failure(s) in the last hour: the key or the session is no longer accepted (for example an expired “refresh token” for Claude Code or Codex)."],
    fix: ["Reconnecte le compte : pour Claude Code ou Codex, Réglages du bot → Cerveau → « Se connecter » ; pour une clé d'API, remplace-la dans Réglages → Modèles.", "Sign in again: for Claude Code or Codex, the bot's settings → Brain → “Sign in”; for an API key, replace it in Settings → Models."],
  },
  "turn_failures:rate_limit": {
    title: ["Limite de débit atteinte chez {provider}", "{provider} rate limit reached"],
    explain: ["{n} refus « trop de requêtes » (429) dans la dernière heure. Les bots attendent et réessaient, mais tout ralentit.", "{n} “too many requests” (429) refusals in the last hour. The bots wait and retry, but everything slows down."],
    fix: ["Étale les routines dans la journée, réduis le nombre de bots qui travaillent en même temps, ou ajoute un modèle de secours (Réglages → Modèles → Fiabilité).", "Spread routines over the day, run fewer bots at once, or add a backup model (Settings → Models → Reliability)."],
  },
  "turn_failures:context": {
    title: ["Conversations trop longues pour {provider}", "Conversations too long for {provider}"],
    explain: ["{n} appel(s) refusé(s) dans la dernière heure car la conversation dépasse la taille que le modèle accepte.", "{n} call(s) refused in the last hour because the conversation is longer than the model accepts."],
    fix: ["Les bots résument déjà l'historique ; si ça continue, choisis un modèle à plus grande fenêtre de contexte ou commence un nouveau fil.", "The bots already summarise their history; if it goes on, pick a model with a bigger context window or start a new thread."],
  },
  turn_failures: {
    title: ["Échecs du modèle chez {provider}", "Model failures at {provider}"],
    explain: ["{n} appel(s) au modèle ont échoué dans la dernière heure ({code}).", "{n} model call(s) failed in the last hour ({code})."],
    fix: ["Si le fournisseur a un incident en cours, attends qu'il passe ; sinon ajoute un modèle de secours (Réglages → Modèles). Le détail est dans le journal du serveur.", "If the provider has an outage, wait for it to pass; otherwise add a backup model (Settings → Models). The details are in the server's log."],
  },
  "engine_watch:stalled": {
    title: ["Des tours restent bloqués sans progrès", "Turns get stuck without progress"],
    explain: ["{n} tour(s) sont restés plus de 5 minutes sans le moindre progrès ces 6 dernières heures.", "{n} turn(s) went more than 5 minutes without any progress in the last 6 hours."],
    fix: ["Regarde l'écran des ordinateurs des bots concernés (fenêtre figée, connexion à refaire), et la charge du serveur (processeur, mémoire).", "Look at the screens of the bots' computers (a frozen window, a sign-in to redo) and at the server's load (CPU, memory)."],
  },
  "engine_watch:gone": {
    title: ["L'outil d'abonnement s'arrête en plein travail", "The subscription tool stops mid-turn"],
    explain: ["{n} fois ces 6 dernières heures, Claude Code ou Codex s'est arrêté avant la fin du tour.", "{n} time(s) in the last 6 hours, Claude Code or Codex stopped before the end of the turn."],
    fix: ["Souvent une session expirée ou un manque de mémoire dans l'ordinateur du bot : reconnecte l'abonnement (Réglages du bot → Cerveau) et vérifie la mémoire libre du serveur.", "Often an expired session or a lack of memory in the bot's computer: sign in to the subscription again (bot settings → Brain) and check the server's free memory."],
  },
  "engine_watch:silent": {
    title: ["L'IA tarde à répondre", "The AI is slow to answer"],
    explain: ["{n} tour(s) sont restés plus de 20 secondes sans la moindre réponse de l'IA ces 6 dernières heures.", "{n} turn(s) got no answer at all from the AI for more than 20 seconds in the last 6 hours."],
    fix: ["C'est souvent passager (fournisseur chargé). Si ça dure, vérifie la connexion de l'abonnement ou ajoute un modèle de secours.", "Usually temporary (a busy provider). If it lasts, check the subscription's connection or add a backup model."],
  },
  "routine_failures:failing": {
    title: ["Une routine échoue à répétition", "A routine keeps failing"],
    explain: ["La routine {routine} a échoué {n} fois de suite.", "The routine {routine} failed {n} times in a row."],
    fix: ["Ouvre les routines du bot pour lire la dernière erreur, corrige la cause (connexion, consigne), puis relance-la.", "Open the bot's routines to read the last error, fix the cause (a connection, the instructions), then run it again."],
  },
  "routine_failures:paused": {
    title: ["Une routine a été mise en pause", "A routine was paused"],
    explain: ["La routine {routine} a été mise en pause par le serveur ({n} échec(s) de suite).", "The server paused the routine {routine} ({n} failure(s) in a row)."],
    fix: ["Ouvre les routines du bot pour lire la raison, corrige-la, puis réactive la routine.", "Open the bot's routines to read why, fix it, then turn the routine back on."],
  },
  connector_auth: {
    title: ["Connexions à refaire", "Connections to redo"],
    explain: ["{n} connexion(s) ou clé(s) ne sont plus acceptées ({account}).", "{n} connection(s) or key(s) are no longer accepted ({account})."],
    fix: ["Réglages → Connexions : refais la connexion ou remplace la clé. Les routines qui en dépendent attendent en pause.", "Settings → Connections: sign in again or replace the key. The routines that depend on it wait, paused."],
  },
  queue_stuck: {
    title: ["Du travail attend dans la file depuis longtemps", "Work has been waiting in the queue for long"],
    explain: ["{n} message(s) attendent depuis plus de 2 heures (le plus ancien depuis {age} min).", "{n} message(s) have been waiting for more than 2 hours (the oldest for {age} min)."],
    fix: ["Un bot est peut-être bloqué sur un tour qui ne finit pas : ouvre-le et appuie sur « Arrêter », ou redémarre le serveur. Rien n'est perdu : la file reprend dans l'ordre.", "A bot may be stuck on a turn that never ends: open it and press “Stop”, or restart the server. Nothing is lost: the queue resumes in order."],
  },
  "disk_low:low": {
    title: ["Disque presque plein", "Disk almost full"],
    explain: ["Il reste {freeMb} Mo libres sur {totalMb} Mo pour les données de Sklubot (seuil : {minMb} Mo).", "{freeMb} MB free out of {totalMb} MB for Sklubot's data (threshold: {minMb} MB)."],
    fix: ["Libère de la place : anciennes copies de la base, images Docker inutiles (docker system prune), fichiers des bots. Ou agrandis le disque.", "Free some space: old database copies, unused Docker images (docker system prune), the bots' files. Or grow the disk."],
  },
  "disk_low:full": {
    title: ["Disque plein", "Disk full"],
    explain: ["Il ne reste que {freeMb} Mo libres : la base de données peut refuser d'écrire et les bots s'arrêter.", "Only {freeMb} MB left: the database may refuse writes and the bots stop."],
    fix: ["Libère de la place tout de suite (docker system prune, anciennes copies de la base), puis agrandis le disque.", "Free some space now (docker system prune, old database copies), then grow the disk."],
  },
  "backup:failed": {
    title: ["La sauvegarde échoue", "Backups are failing"],
    explain: ["La dernière sauvegarde a échoué ({failures} échec(s) de suite).", "The last backup failed ({failures} failure(s) in a row)."],
    fix: ["Réglages → Compte → Sauvegarde automatique : teste la connexion au stockage, vérifie les clés et la place dans le bucket, puis « Sauvegarder maintenant ».", "Settings → Account → Automatic backup: test the storage connection, check the keys and the bucket's space, then “Back up now”."],
  },
  "backup:old": {
    title: ["Pas de sauvegarde récente", "No recent backup"],
    explain: ["La dernière sauvegarde réussie date de {hours} heures.", "The last successful backup is {hours} hours old."],
    fix: ["Réglages → Compte → Sauvegarde automatique : vérifie qu'elle est activée, puis lance « Sauvegarder maintenant ». Avec le script deploy/backup.sh, vérifie sa tâche planifiée (cron).", "Settings → Account → Automatic backup: check it is on, then “Back up now”. With deploy/backup.sh, check its cron job."],
  },
  hosted_budget: {
    title: ["Comptes clients au bout de leur budget IA", "Customer accounts out of AI budget"],
    explain: ["{n} compte(s) ont dépensé tout leur budget IA du mois : leurs bots attendent sur tes clés.", "{n} account(s) spent their whole AI budget for the month: their bots wait on your keys."],
    fix: ["Rien d'urgent : propose une recharge ou un autre forfait (Réglages → Administration).", "Nothing urgent: offer a top-up or another plan (Settings → Administration)."],
  },
  "docker:unreachable": {
    title: ["Docker ne répond pas", "Docker does not answer"],
    explain: ["Le moteur Docker (via le proxy de Sklubot) ne répond pas ({code}) : les ordinateurs des bots ne peuvent pas démarrer.", "The Docker engine (through Sklubot's proxy) does not answer ({code}): the bots' computers cannot start."],
    fix: ["Vérifie que le service docker-proxy tourne (docker compose ps) et que Docker est démarré sur le serveur.", "Check that the docker-proxy service runs (docker compose ps) and that Docker is started on the server."],
  },
  "docker:errors": {
    title: ["Erreurs du proxy Docker", "Docker proxy errors"],
    explain: ["{n} appel(s) à Docker ont échoué dans la dernière heure ({class}).", "{n} call(s) to Docker failed in the last hour ({class})."],
    fix: ["Lis le journal du service docker-proxy : une requête refusée signale un réglage à revoir ; un démon injoignable, un Docker arrêté ou surchargé.", "Read the docker-proxy service's log: a refused request points to a setting to review; an unreachable daemon, a stopped or overloaded Docker."],
  },
  cost_spike: {
    title: ["Dépense inhabituelle", "Unusual spending"],
    explain: ["{last} $ dépensés ces dernières 24 heures, contre {base} $ par jour en moyenne la semaine d'avant ({account}).", "{last} $ spent in the last 24 hours, against {base} $ a day on average the week before ({account})."],
    fix: ["Réglages → Consommation montre quel bot dépense. Une routine qui tourne en boucle se met en pause ; tu peux aussi fixer un plafond (Réglages → Consommation → Plafonds).", "Settings → Usage shows which bot spends. A routine running in a loop can be paused; you can also set a cap (Settings → Usage → Caps)."],
  },
  login_failures: {
    title: ["Rafale d'échecs de connexion", "Burst of failed sign-ins"],
    explain: ["{n} tentatives de connexion ratées en 15 minutes, depuis {sources} adresse(s). C'est peut-être quelqu'un qui essaie des mots de passe.", "{n} failed sign-ins in 15 minutes, from {sources} address(es). Someone may be trying passwords."],
    fix: ["Les essais sont déjà freinés par Sklubot. Si ça continue, bloque les adresses en cause sur ton pare-feu ou ton proxy, et vérifie que les comptes ont des mots de passe solides.", "Sklubot already slows the attempts down. If it goes on, block the addresses on your firewall or proxy, and make sure the accounts have strong passwords."],
  },
  "error_rate:log": {
    title: ["Beaucoup d'erreurs dans le journal du serveur", "Many errors in the server's log"],
    explain: ["{n} erreurs écrites dans le journal du serveur en une heure.", "{n} errors written to the server's log in one hour."],
    fix: ["Lis le journal du serveur (docker compose logs sklubot) pour en trouver la cause ; une erreur qui se répète a souvent une seule origine.", "Read the server's log (docker compose logs sklubot) to find the cause; a repeating error usually has a single origin."],
  },
  "error_rate:uncaught": {
    title: ["Exception non rattrapée", "Uncaught exception"],
    explain: ["{n} exception(s) non rattrapée(s) dans la dernière heure : le serveur a continué, mais une action a pu s'arrêter net.", "{n} uncaught exception(s) in the last hour: the server went on, but an action may have stopped short."],
    fix: ["Lis le journal du serveur autour de « [uncaught] » et signale-le si ça se répète.", "Read the server's log around “[uncaught]” and report it if it repeats."],
  },
  scheduler: {
    title: ["Le planificateur ne tourne plus", "The scheduler stopped"],
    explain: ["Son dernier passage date de {min} minutes : les routines et les rappels ne partent plus.", "Its last tick was {min} minutes ago: routines and reminders no longer go out."],
    fix: ["Redémarre le serveur. Si ça revient, lis le journal du serveur.", "Restart the server. If it comes back, read the server's log."],
  },
};

const fill = (s: string, vars: TextVars) => s.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? "" : String(vars[k])));
const pick = (pair: [string, string], loc: Locale) => (loc === "fr" ? pair[0] : pair[1]);

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
  const i = loc === "fr" ? 0 : 1;
  const all: TextVars = { ...params, ...vars };
  if (typeof params.provider === "string") all.provider = PROVIDER[params.provider]?.[i] ?? params.provider;
  if (typeof params.code === "string") all.code = CODE[params.code]?.[i] ?? params.code;
  if (typeof params.class === "string") all.class = DOCKER[params.class]?.[i] ?? params.class;
  return { title: fill(pick(e.title, loc), all), explanation: fill(pick(e.explain, loc), all), fix: fill(pick(e.fix, loc), all) };
}

/** Words of the alerts and the page, by key. */
const W: Record<string, [string, string]> = {
  severity_info: ["Info", "Info"], severity_warn: ["Attention", "Warning"], severity_critical: ["Critique", "Critical"],
  new_one: ["Nouvel incident", "New incident"], new_many: ["{n} nouveaux incidents", "{n} new incidents"],
  resolved_one: ["Incident résolu", "Incident resolved"], resolved_many: ["{n} incidents résolus", "{n} incidents resolved"],
  escalated: ["Incident aggravé", "Incident escalated"],
  digest_title: ["Surveillance : le point du jour", "Monitoring: daily summary"],
  digest_intro: ["Petits signaux des dernières 24 heures (rien d'urgent) :", "Minor signals of the last 24 hours (nothing urgent):"],
  mail_intro: ["La Sentinelle de ton serveur Sklubot a remarqué ceci :", "Your Sklubot server's Sentinelle noticed this:"],
  mail_fix: ["Que faire :", "What to do:"], mail_open: ["Ouvrir la page Surveillance :", "Open the Monitoring page:"],
  mail_footer: ["Tu reçois ce message parce que tu surveilles ce serveur (Réglages → Surveillance pour changer les alertes).", "You get this because you watch this server (Settings → Monitoring to change the alerts)."],
  now_ok: ["C'est rentré dans l'ordre :", "Back to normal:"],
  some_bot: ["un bot du compte {account}", "a bot of the account {account}"], removed_bot: ["un bot supprimé", "a deleted bot"],
  your_account: ["ton compte", "your account"], removed_account: ["un compte supprimé", "a deleted account"],
  some_routine: ["d'un bot du compte {account}", "of a bot of the account {account}"],
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
    case "disk_low": case "docker": case "queue_stuck": case "scheduler": case "error_rate": case "login_failures": case "engine_watch": return { kind: "health" };
    default: return null;
  }
}
