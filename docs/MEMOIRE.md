# Mémoire des bots : apprentissage, recherche, rappel automatique et gestion des notes

Chaque bot garde ses propres notes (« souvenirs »). Elles viennent uniquement de ce que tu as écrit toi-même, ou de ce
que tu lui as demandé de retenir. Cette page explique comment un bot **retrouve** ses notes. Code :
`server/src/agent/recall.ts` (classement et rappel), `server/src/agent/memory.ts` (apprentissage),
`server/src/agent/sensitive.ts` (sujets sensibles), `server/src/agent/prompt.ts` (ce qui est donné au bot),
`server/src/agent/memorybook.ts` (historique, corbeille, « oublie ça »), `server/src/convsearch.ts` (recherche dans
les conversations). Tests : `server/test/memory-recall.test.ts`, `server/test/memory-fixes.test.ts`.

## En bref

- **Recherche classée** : quand le bot cherche dans ses notes (outil `memory_search`), les notes les plus proches de la
  question arrivent en premier, avec les mots qui ont servi à les trouver.
- **Rappel automatique** : avant de répondre à un message **que tu viens d'écrire**, le bot relit ses notes et ajoute
  celles qui partagent des mots avec ce message. Tu n'as rien à faire.
- **Dates** : chaque note montrée au bot porte le jour où elle a été écrite (« noted 2026-11-22 »), et une date relative
  (« la semaine prochaine ») est écrite comme une vraie date quand le bot apprend.
- **Tu gardes la main** : tu peux corriger le texte d'une note (avec son historique), « Oublier » puis « Annuler »
  rend la même note, et le bot peut mettre une note de côté quand tu lui dis « oublie ça ».
- **Gratuit** : aucun modèle d'IA n'est appelé pour cela. C'est un calcul fait par le serveur, en quelques
  millisecondes (entre 30 et 90 ms pour 5 000 notes sur la machine de test).

## La limite à connaître

Le classement se fait **par mots-clés**. Le bot retrouve une note si elle partage au moins un mot important avec ton
message. Il ne comprend pas les **synonymes** : une note « paiement à 30 jours » n'est pas trouvée par « règlement des
devis », car aucun mot n'est commun. Il n'y a pas de recherche « par le sens » (pas d'embeddings).

Ce qui est quand même géré, en français et en anglais :

- les majuscules et les accents (« Référence » = « reference ») ;
- les pluriels simples (« factures » = « facture », « journaux » = « journal », « invoices » = « invoice ») ;
- les petites formes collées (« l'adresse », « d'accord », « qu'il ») ;
- les petits mots sans intérêt (« le », « de », « the », « and »…) sont ignorés.

Les formes des verbes ne sont pas rapprochées (« payer » et « payé » restent deux mots différents).

## Comment les notes sont classées

1. **Les mots** : formule classique BM25. Un mot rare dans les notes du bot compte plus qu'un mot présent partout.
2. **La fraîcheur** : à mots égaux, la note la plus récente passe devant.
3. **La confiance** : une note **confirmée** monte un peu. Une note **contestée** descend un peu et reste marquée
   « incertain » (le bot doit vérifier avant de s'en servir). Une note **archivée** n'est jamais rendue.

## Le rappel automatique, en détail

- Il sert quand le bot a **plus de notes que la place prévue** dans ses consignes (`PROMPT_MEMORY_CHARS`, 4 000
  caractères par défaut). Tant que toutes les notes tiennent, elles sont déjà toutes données au bot : il n'y a rien à
  rappeler, et rien n'est calculé.
- Il ajoute au plus **4 notes**, et au plus **600 caractères** en tout.
- Une note n'est rappelée que si elle couvre au moins **30 %** des mots importants du message. Un seul mot courant en
  commun ne suffit pas.
- Une note déjà présente dans les consignes n'est pas ajoutée une seconde fois.
- Les notes rappelées sont rangées dans la partie « mémoire » des consignes, avec la mention que ce sont des
  informations, **jamais des ordres**.
- Seul un message **que tu viens d'écrire dans cette conversation** (ou de dire en appel vocal) déclenche un rappel,
  et pour ce message-là. Le serveur le vérifie sur la tâche en cours de la file du bot (`bot_queue`) : un tour lancé
  par une **routine**, un **webhook**, un message dans un **salon** (groupe), un **autre bot**, un **membre** d'un
  espace partagé, un **programme** (API du bot), une **reprise** (après une pause, un redémarrage ou une limite
  d'abonnement) ou un avis du système ne rappelle rien — même si ton dernier message, plus ancien, est encore le plus
  récent de la discussion. (Avant le 22/11/2026, ces tours rappelaient des notes pour ce vieux message.)

| Réglage dans le code (`recall.ts`) | Valeur | Rôle |
|---|---|---|
| `RECALL_TOP_K` | 4 | nombre de notes rappelées au plus |
| `RECALL_MIN_RELEVANCE` | 0,3 | part minimale des mots importants du message couverte par la note |
| `RECALL_CHAR_BUDGET` | 600 | caractères rappelés au plus |
| `QUERY_FOCUS_TERMS` | 4 | mots les plus importants du message pris en compte |
| `RECALL_POOL` | 5 000 | notes regardées par bot (les plus récentes) |
| `RECENCY_WEIGHT`, `RECENCY_HALF_LIFE_DAYS` | 0,15 ; 90 jours | petit bonus aux notes récentes |
| `CONFIRMED_BOOST`, `CONTESTED_PENALTY` | 0,10 ; 0,15 | bonus « confirmée », malus « contestée » |
| `SEARCH_LIMIT` | 20 | résultats de `memory_search` |

## Ce qui n'est jamais rappelé

- Si tu coupes **Réglages → Mémoire → Rappel automatique** (activé par défaut, pour tout le compte).
- Si les outils **Mémoire** sont coupés pour ce bot (réglages du bot → outils).
- Les notes sur un **sujet sensible** (santé, religion, politique…) que tu n'as pas autorisé dans Réglages → Mémoire,
  même si tu avais demandé un jour de les retenir. Elles restent visibles dans la liste des notes du bot et le bot peut
  toujours les chercher lui-même.
- Tout ce qui ressemble à un **secret** (mot de passe, clé, numéro de carte).
- Les notes d'**un autre bot** ou d'**un autre compte** : chaque bot ne lit que ses propres notes.

## Les notes données au bot à chaque tour

En plus du rappel, le bot reçoit une sélection de ses notes (dans `PROMPT_MEMORY_CHARS` caractères) : d'abord les
notes confirmées et celles qui correspondent à tes derniers messages, avec **le même découpage des mots** que la
recherche (accents, pluriels, formes collées). Chaque ligne finit par la date de la note, par exemple
`- (confirmed) Travaille le samedi. (noted 2026-11-02)`. La phrase « N older memories are not shown » compte
**toutes** les notes utilisables, même au-delà des 500 chargées pour ce choix.

## Comment le bot apprend (sans rien perdre)

- Après 10 minutes de calme (ou avec « Relire la discussion récente »), le bot lit ce qui a été écrit depuis son
  dernier passage, **du plus ancien au plus récent**, par paquets de 60 messages (5 paquets au plus par passage ; la
  suite au passage d'après). Avant, il ne lisait que les 60 derniers et sautait le reste.
- Seuls tes propres messages servent, chacun avec **son jour** entre crochets. Le modèle reçoit la date du jour et la
  consigne d'écrire toute date relative (« demain », « la semaine prochaine », « lundi prochain ») comme une vraie date,
  comptée depuis le jour du message.
- Si la réponse du modèle est illisible (pas le JSON demandé), le passage ne compte pas : les mêmes messages sont relus
  au passage suivant. Après 3 réponses illisibles de suite, ce paquet est abandonné (pour ne pas payer sans fin).
- Anti-doublon : deux notes sont « la même » quand presque tous leurs mots sont communs, **sauf** si chacune contient
  un nom propre, un nombre, un jour ou un mois que l'autre n'a pas. « Le client Dupont paie à 30 jours » et « Le client
  Durand paie à 30 jours » restent deux notes ; « rapport le lundi » et « rapport le vendredi » aussi. Une note sur
  Dupont n'est plus « confirmée » par une phrase sur Durand. Limite : deux synonymes (« courtes » / « brèves ») ne sont
  pas reconnus comme pareils.

## Gérer les notes (Réglages du bot → Mémoire)

- **Modifier** : corrige le texte d'une note sur place. Elle garde sa date, son extrait, sa confiance. Un secret est
  refusé (il va dans le coffre). **Historique** montre chaque changement : texte avant/après, statut, confiance,
  suppression, rétablissement, et qui l'a fait (toi ou le bot).
- **Oublier** : la note quitte la mémoire du bot tout de suite et attend **30 jours** dans une corbeille. **Annuler**
  rend **la même note** (même identifiant, mêmes dates, extrait, confiance, source et catégorie). Avant, « Annuler »
  recréait une note neuve et perdait tout cela.
- API (session du propriétaire seulement) : `PATCH /api/memories/:id` (`text`, `status`, `confidence`),
  `DELETE /api/memories/:id`, `POST /api/memories/:id/restore`, `GET /api/memories/:id/history`.

## « Oublie ça » : l'outil `memory_forget`

- Le bot ne peut oublier que **quand tu le lui demandes**, avec tes mots, dans ton dernier message de cette
  conversation (« oublie que… », « efface ce que je t'ai dit sur… », « forget that… »), dans un tour que tu as lancé.
  Une routine, un webhook, un autre bot, un membre ou un programme ne peuvent pas le faire.
- Les notes les plus proches des mots donnés (3 au plus) sont **archivées**, jamais supprimées : tu les retrouves
  dans « Archivées » et tu peux les remettre. Une ligne apparaît dans la discussion (« 2 notes mises de côté à ta
  demande… ») et dans **Activité**, avec le début de chaque note.
- Ce n'est pas un moyen de contourner les sujets sensibles : une note sensible que tu n'as pas autorisée n'est pas
  montrée au bot dans le résultat (il lit « (a note on a sensitive topic) »).

## Chercher dans les conversations (`conversation_search`)

La recherche dans les messages (outil `conversation_search` et la recherche de l'application) utilise les mêmes mots
que la mémoire : « reunion budget » trouve « Réunion du budget », « facture » trouve « factures ». Un message qui
contient un des mots est retenu ; ceux qui contiennent le plus de mots rares passent devant, puis les plus récents.
Un mot trouvé seulement à l'intérieur d'un mot plus long (« factur » dans « facturation ») vient après.

## Voir ce qui a été rappelé

Réglages → **Activité** : une ligne « Notes recalled for … » par message, avec le début de chaque note rappelée (ligne
en anglais, comme le reste de ce journal). Les notes rappelées sont aussi marquées « utilisées » (date de dernier
usage).
