# Plafonds d'usage

Des limites sur ce que consomme un compte, ou un seul bot, **par jour** et **par mois**, **en dollars** et/ou **en
tokens**. Réglages → Consommation pour le compte, réglages d'un bot (onglet Général, sous le point de contrôle des
dépenses) pour un bot. En mode hébergé, l'opérateur peut aussi en fixer sur le compte d'un client (Administration →
Clients → Gérer). Code : `server/src/usagecaps.ts` ; base : migration 8 (`usage_caps`, `usage_cap_notices`,
`usage_cap_stops`). Idée reprise (idée seulement, code propre) de la fonction « usage caps » d'OpenMausBot
(Apache-2.0), déjà listé dans `docs/CLEANROOM.md`.

## Ce qui est compté

| Unité | Compte | Remarque |
|---|---|---|
| `usd` | coûts connus + estimation prudente des modèles sans prix (`cost_usd + est_cost_usd`) | comme le budget mensuel et les points de contrôle ; un tour **Claude Code / Codex coûte 0 $** : un plafond en dollars ne protège pas un abonnement |
| `tokens` | entrée (lecture du cache comprise, comme sur la page Consommation) + sortie, de tous les modèles | les tours Claude Code / Codex donnent leurs tokens : **c'est le plafond en tokens qui protège un abonnement** |

- Un plafond **de bot** compte ce bot et ses aides (tâches de fond). Un plafond **du compte** compte tous les bots.
- Un plafond **de l'opérateur** (mode hébergé) ne compte que ce que paient les clés du service (`usage.payer =
  'operator'`) : les clés et abonnements propres du client ne le regardent pas. Le client le voit, ne peut ni le changer
  ni le relever. Hors mode hébergé, ces plafonds n'existent pas.
- **Jour et mois de l'utilisateur** : le fuseau de son profil partagé, sinon celui de ses points quotidiens, sinon UTC.
  La remise à zéro se fait à minuit chez lui (changement d'heure compris) et la date affichée est dans ce fuseau.

## Ce qu'un plafond atteint arrête (« mode », par plafond)

- **Travail sans surveillance** (par défaut) : ce que personne n'a lancé — routines et webhooks, tours suivants d'un
  objectif, messages entre bots, tâches de fond, comptes rendus de tâches de fond, mails reçus par le bot, points
  quotidiens, passes de suggestions, entretien de la mémoire. **Le message qu'une personne vient d'écrire passe**, avec
  une notice (une fois par plafond et par période). « Lancer maintenant » une routine à la main passe aussi.
- **Tout** : les messages des personnes aussi. Le message refusé est gardé sur la carte ; « Continuer » le relance.

Arrêt **à un point sûr** : avant le début d'un tour, et avant l'étape suivante d'un tour d'API (au même endroit que le
point de contrôle des dépenses) ; une action déjà lancée finit d'abord. Un tour Claude Code / Codex donne ses tokens à
sa fin : son plafond est vérifié avant le tour suivant. Les outils tiers payants réservent leur coût maximal dans la
marge restante du plafond en dollars.

## Ce que l'utilisateur voit

- **Alerte** : une notice au seuil (80 % par défaut, réglable), une seule fois par plafond, période et limite.
- **Carte « Plafond d'usage atteint »** dans le chat du bot concerné (une par plafond, période et limite) : relever le
  plafond (propriétaire, plafond du compte ou d'un bot), attendre la remise à zéro (date et heure dans son fuseau),
  changer de modèle (ouvre les réglages du bot), « Continuer » ce qui a été mis de côté.
- **Travail de fond sauté** : pas de notice à chaque fois. Une ligne dans le journal d'activité par plafond et période,
  le compteur « sautés » sur la carte, et pour une routine la ligne « sautée » de son historique d'exécutions (une
  routine ponctuelle n'est pas perdue : elle attend la remise à zéro). Un objectif est mis en pause avec la raison.
- **Page Consommation** : barres par bot et pour le compte, aujourd'hui et ce mois-ci, en dollars et en tokens, avec
  chaque plafond et le budget mensuel.

## Différence avec les autres limites (toutes restent en place ; la première atteinte arrête le travail)

| Limite | Portée | Période | Unité | Arrête |
|---|---|---|---|---|
| **Plafonds d'usage** | compte, bot (+ opérateur en mode hébergé) | jour / mois, fuseau de l'utilisateur | $ et/ou tokens | travail sans surveillance, ou tout |
| **Budget mensuel** (Réglages → Consommation) | compte | mois civil UTC | $ | tout ; inchangé (alerte à 80 %) |
| **Point de contrôle des dépenses** | un travail (chat, tâche, exécution de routine) | depuis la dernière intervention de l'utilisateur | $ | ce travail, avec une carte « continuer / relever / arrêter » |
| **Budget IA de l'offre** (mode hébergé) | compte client | mois civil UTC | € sur les clés du service | les appels sur les clés du service |
| **Plafond quotidien des outils tiers** | bot | jour UTC | $ des outils payants | l'appel d'outil |

### Heures d'ordinateur (L95)

Un plafond **séparé** sur le temps où les ordinateurs Linux des bots sont allumés, par compte et par mois (mois UTC),
dans **Réglages → Consommation → Heures d'ordinateur** (vide ou 0 : pas de plafond ; entre 0,5 et 744 h). En mode
hébergé, l'opérateur peut fixer `COMPUTER_HOURS_MONTH` (heures par mois et par compte client ; les opérateurs n'y sont
pas soumis) : le plus bas des deux compte. Chaque minute, le temps de chaque ordinateur allumé est ajouté à son
compte. Plafond atteint : aucun ordinateur endormi n'est rallumé (le bot reçoit une phrase claire : relever le plafond
ou attendre le 1er), ceux qui ne font rien s'endorment, une action en cours se termine ; un seul avis par mois.
Code : `server/src/computerhours.ts`, `computerhoursroutes.ts` (`GET/PUT /api/usage/computer-hours`),
`web/src/components/ComputerHours.tsx` ; test : `server/test/computer-hours.test.ts`.

**Ordinateurs sans bot** : un ordinateur (conteneur `sklubot=desktop`) qui tourne depuis plus d'une heure alors
qu'aucun bot, ordinateur partagé ou ordinateur gratuit de ce serveur ne lui correspond est **arrêté** au démarrage puis
toutes les heures — jamais supprimé (son disque reste).

Le budget mensuel n'a pas été transformé en plafond : son comportement (mois UTC, tout s'arrête) est conservé tel
quel, et sa barre est affichée avec celles des plafonds.

## API

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/usage/caps` | – | `UsageCapsView` |
| PUT | `/usage/caps` | `{ botId: string \| null, period: "day" \| "month", unit: "usd" \| "tokens", limit: number \| null, mode?: "unattended" \| "everything", warnPercent?: 1–99 }` (`limit` vide ou 0 : retire) | `UsageCapsView` |
| POST | `/usage/caps/stops/:stopId` | `{ action: "wait" \| "continue" \| "raise", limit? }` | `{ ok }` (409 si un plafond « tout » arrête encore le travail) |
| GET / PUT | `/admin/customers/:uid/caps` (mode hébergé, opérateurs) | comme ci-dessus, sans `botId` | `{ caps: CapStateView[] }` |

Un webhook d'une routine sautée répond `200 { ok: true, skipped: "usage_cap" }` (pas d'erreur : un expéditeur qui
réessaie ne s'emballe pas).
