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
devis », car aucun mot n'est commun. La recherche « par le sens » existe en **option**, désactivée par défaut (voir
« Mémoire par le sens » plus bas) ; sans elle, rien ne quitte le serveur.

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

- **Quand ?** Après 10 minutes de calme (ou avec « Relire la discussion récente »), et aussi **tout de suite** (dans la
  minute, dès que le bot a fini de répondre) quand tu le corriges ou lui donnes une consigne durable : « non, je t'ai
  dit… », « je te l'ai déjà dit », « c'est faux », « à partir de maintenant », « dorénavant », « no, I told you »,
  « from now on »… Et au plus tard tous les **20 messages** de toi, même sans pause. Seuls tes messages comptent : une
  phrase de correction écrite par le bot, une routine, un webhook ou un autre bot ne déclenche rien (`learningDue`,
  `server/src/agent/memory.ts`).
- Le bot lit ce qui a été écrit depuis son
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
- **« Ne rien retenir »** (Réglages du bot → Mémoire) : tant que c'est activé, ce bot n'apprend plus rien de sa
  conversation et `memory_save` refuse — sauf si tu lui demandes toi-même, en toutes lettres, de retenir quelque chose
  (« retiens que… »). Les notes déjà là restent.

## La fiche sur moi, commune à tous tes bots

Réglages → **Profil** : ton nom, ton fuseau horaire, ton entreprise et tes préférences. Tous tes bots la lisent à
chaque message (« About the user (shared profile…) »). Une note apprise par un bot peut y aller d'un clic :
**« Ajouter à ma fiche »** sur la note (Réglages du bot → Mémoire). Tes autres bots la savent alors, sans la
réapprendre. Une note qui ressemble à un secret est refusée ; la fiche est limitée à 2 000 caractères.

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

Depuis L73, les messages sont dans un **index plein texte** (SQLite FTS5, intégré à Node) tenu à jour à chaque message
écrit ou modifié : la recherche ne relit plus tous les messages. L'index plie les accents et cherche chaque mot comme
un début de mot. S'il ne trouve rien (un bout de référence comme « 452 » dans « A-4521 »), l'ancienne lecture complète
prend le relais. Les messages déjà écrits sont indexés une fois, au premier démarrage.

- **Filtre de date** : le bot peut donner `since` et `until` (jours AAAA-MM-JJ, le dernier jour compris) ; la recherche
  de l'appli accepte `?since=` et `?until=`.
- **Messages autour** : chaque résultat porte son numéro (`#12`). Le bot demande `around_seq: 12` pour lire les
  messages juste avant et après (3 par défaut, 10 au plus), dans la même conversation et le même fil. API :
  `GET /api/bots/:id/around?seq=12&count=3`.

## Les résumés de conversation (compactage)

Quand une conversation devient trop longue pour le modèle, le début est remplacé par un résumé (le fil visible ne
change pas). Depuis L80 :

1. **D'abord, « note ce qui compte »** : un passage d'apprentissage silencieux garde en notes ce que tu as dit d'important
   (mêmes règles que l'apprentissage : tes messages seulement).
2. **Un seul prompt à sections fixes** : qui tu es ; objectifs, préférences, consignes ; décisions ; faits, noms,
   nombres, liens ; ce qui a été fait et le résultat ; ce qui reste ouvert ou promis.
3. **Contrôle du résultat** : toutes les sections, assez long, plus court que ce qu'il remplace, aucun secret. Sinon le
   modèle le refait une fois en sachant pourquoi ; un deuxième échec ne remplace **rien** (la conversation reste
   entière) et le prochain essai attend 10 minutes.
4. **Une ligne visible** dans la discussion : « J'ai résumé le début de notre conversation… ».

Réglages du bot → Mémoire : la jauge **« Contexte rempli à X % »**, le bouton **Compacter**, et **« Voir le
résumé »** (le dernier résumé, sa date, combien de messages il remplace).

## Ce que reçoit ce bot

Réglages du bot → Mémoire → **« Ce que reçoit ce bot »** : les consignes que le bot lit avec ton prochain message, dans
l'ordre, un morceau par titre, chacun s'ouvre pour être lu, avec sa taille (environ 1 jeton pour 4 caractères) et s'il
est fixe ou change à chaque message. Au-dessus, **« Ce que ton bot voit de sa mémoire »** : combien de notes il a,
combien sont dans ses consignes, combien restent à retrouver avec la recherche, et ce que cela coûte par message.
C'est une estimation : les applis connectées du moment et les notes rappelées pour ton message peuvent changer un peu.
Rien n'est écrit, aucun modèle n'est appelé. API : `GET /api/bots/:id/prompt-view`.

## Mémoire par le sens (option, désactivée par défaut)

Réglages → Mémoire → **« Mémoire par le sens »**. Quand tu l'actives, `memory_search` trouve aussi les notes qui disent
la même chose avec d'autres mots (« ma voiture » trouve « la Clio »). Pour cela, **le texte de tes notes et des
recherches est envoyé à ton fournisseur d'IA** pour être transformé en « vecteurs » (embeddings), avec une clé que ton
compte a **déjà** : un de tes fournisseurs (Réglages → Modèles), puis, hors mode hébergé, la clé OpenAI du serveur.
Seuls OpenAI (`text-embedding-3-small`) et Mistral (`mistral-embed`) sont reconnus. Jamais de nouveau service payant.
Le classement par mots et celui par le sens sont fusionnés (fusion des rangs, `fuseRankings` dans `recall.ts`). Les
vecteurs sont gardés par note et refaits si son texte change. Sans clé, ou en cas d'erreur, la recherche par mots
répond seule. Limite : le rappel automatique avant chaque message reste par mots (il ne peut pas attendre le
fournisseur) ; le sens sert à `memory_search`, que le bot utilise avant de te redemander quelque chose.

## Voir ce qui a été rappelé

Réglages → **Activité** : une ligne « Notes recalled for … » par message, avec le début de chaque note rappelée (ligne
en anglais, comme le reste de ce journal). Les notes rappelées sont aussi marquées « utilisées » (date de dernier
usage).
