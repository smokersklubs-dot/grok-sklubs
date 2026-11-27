/**
 * L175 « Livrer par demande d'intégration » (workboardpr.ts): the owner-facing texts. English is the key; French here
 * (tutoiement, simple words). Kept apart from worki18n.ts so this feature does not grow a shared dictionary.
 * test/board-pr-delivery.test.ts checks that every dt("…") / DeliveryError("…") text of workboardpr*.ts has its line.
 */
import type { Locale } from "./shared.js"; import { localize } from "./lang/index.js";

export const DELIVERY_FR: Record<string, string> = {
  "That card does not exist.": "Cette carte n'existe pas.",
  "Give the GitHub repository as owner/name.": "Donne le dépôt GitHub sous la forme propriétaire/nom.",
  "Give the folder of the project in the bot's files (where it cloned the repository).": "Donne le dossier du projet dans les fichiers du bot (là où il a cloné le dépôt).",
  "That branch name is not valid.": "Ce nom de branche n'est pas valable.",
  "Choose one of your GitHub Code accounts (Apps).": "Choisis un de tes comptes GitHub Code (Applis).",
  "Give both the name and the e-mail of the identity, or neither.": "Donne le nom et l'e-mail de l'identité, ou aucun des deux.",
  "This task is being delivered: wait for the end or stop it first.": "Cette tâche est en cours de livraison : attends la fin ou arrête-la d'abord.",
  "Nothing waits for your go-ahead on this task.": "Rien n'attend ton accord sur cette tâche.",
  "There is nothing to retry on this delivery.": "Il n'y a rien à relancer sur cette livraison.",
  "This task is not delivered by a pull request.": "Cette tâche n'est pas livrée par une demande d'intégration.",
  "This task has no bot: its project folder cannot be found.": "Cette tâche n'a pas de bot : son dossier de projet est introuvable.",
  "The project folder “{folder}” is not a git clone in the bot's files: nothing was sent.": "Le dossier de projet « {folder} » n'est pas un clone git dans les fichiers du bot : rien n'a été envoyé.",
  "The project folder's git settings contain “{key}”, which Sklubot does not run for safety. Remove it, then retry.": "Les réglages git du dossier de projet contiennent « {key} », que Sklubot ne lance pas par prudence. Retire-le, puis relance.",
  "The project folder does not point at {repo} (its origin is “{origin}”): nothing was sent.": "Le dossier de projet ne pointe pas vers {repo} (son origine est « {origin} ») : rien n'a été envoyé.",
  "The repository identity (name and e-mail) is not set: set it on the task or in the clone, then retry.": "L'identité du dépôt (nom et e-mail) n'est pas réglée : règle-la sur la tâche ou dans le clone, puis relance.",
  "The project folder has no commit yet.": "Le dossier de projet n'a encore aucun enregistrement.",
  "GitHub did not accept this account (HTTP {status}): reconnect it in the apps.": "GitHub n'a pas accepté ce compte (HTTP {status}) : reconnecte-le dans les applis.",
  "This GitHub account cannot push to {repo} (or the repository is archived).": "Ce compte GitHub ne peut pas pousser dans {repo} (ou le dépôt est archivé).",
  "First delivery to {repo}: your go-ahead is needed before anything is pushed.": "Première livraison vers {repo} : ton accord est nécessaire avant toute poussée.",
  "The connected GitHub account ({login}) is not the one you allowed ({expected}): allow it, or reconnect the right one.": "Le compte GitHub connecté ({login}) n'est pas celui que tu as autorisé ({expected}) : autorise-le, ou reconnecte le bon.",
  "The repository identity changed ({ident}): your go-ahead is needed again.": "L'identité du dépôt a changé ({ident}) : ton accord est de nouveau nécessaire.",
  "GitHub could not be read: {detail}": "Impossible de lire GitHub : {detail}",
  "The branch “{branch}” on GitHub moved without Sklubot (now {sha}): nothing was overwritten. Look at it on GitHub, then retry or choose another branch.": "La branche « {branch} » sur GitHub a bougé sans Sklubot (maintenant {sha}) : rien n'a été écrasé. Regarde-la sur GitHub, puis relance ou choisis une autre branche.",
  "There is nothing new to deliver: the project folder has no commit that {base} does not already have.": "Rien de neuf à livrer : le dossier de projet n'a aucun enregistrement que {base} n'ait déjà.",
  "More than 200 commits to send: deliver in smaller parts.": "Plus de 200 enregistrements à envoyer : livre en plus petites parties.",
  "Commit {sha} is signed “{who}”, not the repository identity “{ident}”: nothing was pushed.": "L'enregistrement {sha} est signé « {who} », pas avec l'identité du dépôt « {ident} » : rien n'a été poussé.",
  "Commit {sha} mentions “{what}” (an internal reference): nothing was pushed. Reword it, then retry.": "L'enregistrement {sha} mentionne « {what} » (une référence interne) : rien n'a été poussé. Reformule-le, puis relance.",
  "GitHub refused the push (the branch may have moved): nothing was overwritten. {detail}": "GitHub a refusé la poussée (la branche a peut-être bougé) : rien n'a été écrasé. {detail}",
  "GitHub did not open the pull request (HTTP {status}).": "GitHub n'a pas ouvert la demande d'intégration (HTTP {status}).",
  "You refused this delivery: nothing was pushed.": "Tu as refusé cette livraison : rien n'a été poussé.",
  "The pull request was closed without being merged.": "La demande d'intégration a été fermée sans être intégrée.",
  "The pull request was merged into “{into}”, not into “{base}”: it is not delivered yet.": "La demande d'intégration a été intégrée dans « {into} », pas dans « {base} » : ce n'est pas encore livré.",
  "Board task “{title}”: waiting for your go-ahead to push to {repo} (open the board).": "Tâche du tableau « {title} » : attend ton accord pour pousser vers {repo} (ouvre le tableau).",
  "Board task “{title}”: pull request opened — {url}": "Tâche du tableau « {title} » : demande d'intégration ouverte — {url}",
  "Board task “{title}”: delivery stopped — {note}": "Tâche du tableau « {title} » : livraison arrêtée — {note}",
  "Pull request open: done when it is merged.": "Demande d'intégration ouverte : faite quand elle sera intégrée.",
};

export function dt(locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}): string {
  const t = localize(locale, en, DELIVERY_FR);
  return t.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}
