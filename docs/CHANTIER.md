# Chantier : un gros travail partagé entre plusieurs bots

Un **chantier**, c'est un travail trop gros pour un seul bot, découpé en tâches. Chaque tâche a son bot, son « fini » écrit à l'avance, et elle est vérifiée avant de passer à la suite. Tu approuves le plan, tu décides quand il faut, le reste avance tout seul.

La méthode vient de l'article sur les flux de travail à plusieurs modèles que tu as partagé. Ses huit principes, et ce que Sklubot en fait :

| Principe | Dans Sklubot |
|---|---|
| 1. Décrire le comportement en exigences vérifiables | Le plan sépare **observé** (sûr), **supposé** (à confirmer) et **questions ouvertes** (toi seul peux répondre). Chaque exigence a sa vérification. On reconstruit un comportement, jamais le code, les textes, les noms ou les images d'un autre produit (règles de salle blanche). |
| 2. Un travail borné par participant | Chaque tâche a un bot (donc son modèle), un rôle (recherche, cahier des charges, construction, vérification) et un livrable précis. |
| 3. Dessiner le schéma avant de lancer | Les tâches sans lien avancent en même temps ; une tâche qui a besoin d'une autre attend. Chaque lien dit ce qui passe (sources, cahier des charges, code, rapport d'échec). Deux tâches qui touchent le même fichier ne tournent jamais en même temps. |
| 4. Définir « fini » pour chaque tâche | Le **contrat** : ce qu'elle reçoit, ce qu'elle livre, les vérifications, ce qui ne doit pas changer. Écrit avant de lancer. |
| 5. Une boucle qui peut refuser | Produire → vérifier → corriger → revérifier. Les vérifications exactes (nombre de fichiers, tailles, champs, ordre, textes, taille des images) sont faites par un programme. Le sens et la qualité visuelle sont jugés par un **bot relecteur**, sur des critères écrits. Deux modèles d'accord, ce n'est pas une preuve : un « oui » sans raison ne compte pas, et une vérification ratée par le programme ne peut pas être rattrapée par le relecteur. |
| 6. Ne renvoyer que ce qui a échoué | Seule la tâche en échec repart, avec un **rapport d'échec**. Après la réparation, la vérification d'ensemble est refaite. Au bout de **3 essais** (réglable), la branche s'arrête, tous les essais et leurs preuves sont gardés, et une carte te demande quoi faire. |
| 7. Garder les leçons, avec leur preuve | Une vérification ratée puis réussie devient une **leçon** (règle, preuve, s'applique à). Elle est ajoutée aux vérifications des chantiers suivants qui lui ressemblent. Tu peux la modifier ou la retirer. |
| 8. Automatiser les passages de relais | Vérifications réussies → la suite démarre. Échec → la tâche repart. Limite atteinte → la branche s'arrête. Décision nécessaire → on te demande et on attend. Le périmètre, les questions ouvertes et les actions qui engagent (publier, payer, supprimer) restent à toi. |

## Lancer un chantier

1. Dans la zone de message, menu **+** → **Nouveau chantier** (ou Centre de commandement → **Nouveau chantier**).
2. Écris ce que tu veux obtenir, choisis le bot qui fait le plan, puis **Préparer le plan**. Bouton **Voir un exemple** : « Outil qui transforme un article en cartes pour les réseaux sociaux ».
3. Le plan arrive (une notification et un message dans la discussion du bot). Lis-le, corrige-le, **réponds aux questions ouvertes**, puis **Approuver et lancer**. Tant qu'il reste quelque chose à régler, la page te le dit et rien ne démarre.

Sur le téléphone : onglet **Tâches** → **Chantiers**. Tu peux lire, approuver un plan prêt, répondre aux cartes et arrêter. Pour corriger un plan, ouvre-le sur l'ordinateur.

## Pendant le chantier

- **Le schéma** : chaque tâche est une case colorée — gris en attente, bleu en cours, vert acceptée, orange en réparation, rouge bloquée. Chaque flèche porte le nom de ce qui passe. Sur le téléphone, le schéma devient une liste d'étapes.
- **Une tâche** (touche sa case) : son contrat, ses essais, le résultat de chaque vérification (obtenu / attendu) et les rapports d'échec.
- **Chaque tâche travaille dans son propre fil** de la discussion de son bot, comme un objectif. Tu peux l'ouvrir et suivre ses étapes. Tes réglages ne changent pas : une action à valider (publier, payer, supprimer, toute action irréversible) t'attend dans ce fil, la tâche attend avec elle.
- **Les cartes « À toi de décider »** :
  - *Limite d'essais atteinte* : « Une tentative de plus », « C'est bon, accepter » ou « Arrêter cette branche ».
  - *Une tâche a besoin de toi* (le bot est bloqué) : « C'est réglé, reprendre » ou « Arrêter cette branche ».
  - *Le relecteur n'est pas sûr* (par exemple, il ne peut pas voir des images) : « C'est bon, accepter » ou « À refaire ».
  Tu peux ajouter un mot pour le bot : il le reçoit avec le rapport.
- **Dire « continue » / Redire quelque chose** : sur une tâche en cours. On te demande pourquoi, en quelques mots : c'est compté pour améliorer les prochains chantiers.
- **Arrêter le chantier** : les tâches en cours s'arrêtent, tout ce qui est fait est gardé.

## Le rapport d'échec

| Champ | Ce qu'il dit |
|---|---|
| Partie | La tâche en cause (pour une vérification d'ensemble : la tâche dont le résultat est faux) |
| Conditions | Numéro de l'essai, le bot, ce qu'il a reçu |
| Ce qui ne va pas | Chaque vérification ratée, avec ce qui a été obtenu |
| Attendu | Ce qu'il fallait |
| À réparer seulement | Les fichiers de cette tâche, et ce qui ne doit pas changer |
| Revérifié ensuite | Les vérifications refaites, puis les vérifications d'ensemble qui en dépendent |

## Les chiffres d'un chantier

Durée (depuis ton accord), coût (estimé : ce que chaque bot a dépensé pendant ses essais, plus le plan et les relectures), défauts restants, nombre d'essais, tes interventions, nombre de fois où tu as dû dire « continue » et nombre de choses redites (chacune avec sa raison).

## L'exemple : article → cartes pour les réseaux sociaux

Coller un texte → corriger les cartes dans un éditeur → exporter une image par carte. Quatre tâches :

- **Recherche** (Ada) : `sources.md`, les tailles d'image conseillées avec leurs sources.
- **Cahier des charges** (Cid) : `exigences.md` et `cards.json`. Elle avance **en même temps** que la recherche.
- **Export des images** (Bea, relue par Cid) : attend les deux ; reçoit leurs fichiers. Son contrat, tiré de l'article :
  - autant d'images que de cartes ;
  - images dans l'ordre de l'éditeur ;
  - à la taille choisie (1080 × 1350) ;
  - le texte de chaque carte présent ;
  - périmètre : ne pas changer la génération du texte, ne pas changer l'éditeur.
- **Vérification d'ensemble** (Cid) : refait le compte des images sur le résultat de l'export.

Si le premier export oublie une carte, le rapport dit « autant d'images que de cartes : 2 fichiers — attendu 3 fichiers ». Seul l'export repart ; la recherche et le cahier des charges ne sont pas refaits. Une fois réparé, la vérification d'ensemble passe, et une leçon « Vérifier : autant d'images que de cartes » est gardée pour les prochains exports.

## Limites connues

- Le contrat d'une tâche ne se modifie pas une fois le chantier lancé (arrête la branche et recrée un chantier).
- Un « continue » tapé directement dans le fil n'est pas compté ; le bouton **Reprendre** de l'objectif et « Dire continue » le sont.
- Le relecteur lit les fichiers texte ; il ne voit pas les images : il répond « pas sûr » et la décision te revient.
- Le coût est une estimation : si un bot fait autre chose pendant un essai, cette dépense compte aussi.

## Pour les développeurs

Serveur : `server/src/chantiers.ts` (tables créées au chargement, vérification du plan, leçons, chiffres), `chantierplanner.ts` (tour de planification), `chantierrunner.ts` (tâches lancées comme objectifs dans leur fil, rapport, limite, cartes, reprise), `chantierchecks.ts` (vérifications et relecteur), `chantierroutes.ts` (`/api/chantiers…`), `chantiertypes.ts`, `chantierexample.ts`. Les objectifs préviennent le chantier par `onGoalStatus` (`agent/goals.ts`). Web : `web/src/components/Chantier.tsx`, `web/src/lib/chantiers.ts`, galerie `?dev=gallery&section=chantier`. Téléphone : `mobile/src/screens/Chantiers.tsx`. Tests : `server/test/chantier.test.ts`, `web/scripts/chantier.test.mjs`, `mobile/__tests__/chantier.test.ts`. Captures : `docs/screenshots/chantier/`.
