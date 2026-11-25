# Tableau de travail, parcours, automatisations, mémoire d'équipe

Vague 7 (23/11/2026) — backlog L163, L165, L171, L173 (reste), L66 et L70 (restes).
On l'ouvre depuis le **Centre de commandement** : bouton « Ouvrir le tableau ». Une seule fenêtre, cinq onglets.

Salle blanche : le tableau, les dépendances, le carnet d'idées, les déclencheurs et les portées de mémoire sont
écrits à partir de `docs/cleanroom/10-timon.md` seulement (T1 à T8, T67, T68, T79). Aucun code du produit étudié
(licence AGPL) n'a été lu.

Captures : `docs/screenshots/tableau/` (390 et 1440 px, clair et sombre ; `node web/scripts/shots-tableau.mjs`).

## Tableau (L163)

- Une **tâche** a un titre, un texte (ce que le bot lira), un bot, une **priorité** de 1 (le plus urgent) à 5, une
  date « pas avant » facultative, des **dépendances** et des **pièces jointes**.
- Créer une tâche ne lance rien. **« Lancer »** : elle démarre toute seule dès que ce qu'elle attend est fait et que sa
  date est arrivée. Au plus 3 tâches du tableau en même temps par bot.
- Une tâche tourne comme un **objectif** de son bot, dans son propre fil : mêmes tours, mêmes autorisations, même
  limite qu'un objectif ordinaire. Rien n'est dupliqué.
- **Le vrai résultat** : une tâche qui en attend une autre ne démarre que quand celle-ci est **faite**. Si tu as coché
  « Je vérifie le résultat », la tâche finie passe « À relire » : **Accepter** libère la suite, **À corriger** la
  renvoie au bot avec ta remarque, et la suite continue d'attendre. Un bot qui dit « fini » sans dire ce qu'il a
  produit : la tâche passe « Bloquée ».
- Une tâche peut **suivre un Chantier** : elle est faite quand le chantier est fait.
- **Date** : une date sans fuseau horaire, ou un nombre qui ressemble à des secondes, est refusée (rien n'est
  programmé). Une date à plus de 18 h donne un avertissement, jamais un refus.
- **Pièces jointes** : images, documents bureautiques, PDF, texte. 20 fichiers, 15 Mo chacun, 100 Mo par carte,
  300 Mo pour tout le tableau du compte. Pages web, scripts, archives et programmes refusés avec la raison. Le contenu
  doit correspondre au type du nom. Au lancement, les fichiers sont copiés dans la bibliothèque du bot
  (`tableau/<tâche>/`) et le bot reçoit leur chemin.
- **Supprimer** : refusé tant qu'une autre tâche l'attend (le refus nomme lesquelles) ou qu'elle tourne. Ses fichiers
  partent avec elle.
- **Lot** : plusieurs tâches lancées ensemble ⇒ un seul récapitulatif dans la discussion du bot principal quand toutes
  sont finies, les bloquées en premier ; un retour vide est signalé, jamais envoyé vide.
- Un état inconnu laissé par une autre version s'affiche dans « Faites » sans être réécrit.

**Idées** : noter une idée ne lance rien. Numéro, auteur, urgence (critique, bogue, mineur, idée), avancement.
« En faire une tâche » : une seule fois (la deuxième fois, le refus nomme la tâche), la tâche garde une copie des
fichiers. Quand toutes les tâches de l'idée sont faites, l'idée se coche seule ; sinon « Partielle 1/2 ». Une idée
faite n'est jamais rouverte. « Envoyer au chef » : l'idée part au bot principal, qui en discute avant toute tâche.

Code : `server/src/workboard.ts`, `workboardtypes.ts`, `workboardroutes.ts` ; web `WorkBoard.tsx`, `lib/workboard.ts`.
Tests : `server/test/workboard.test.ts`, `web/scripts/workboard.test.mjs`.

## Parcours enregistrés (L165)

- **Enregistrer** : choisis un bot, donne un nom, puis demande au bot de faire le travail une fois dans son navigateur.
  Chaque action qui a marché devient une étape (ouvrir, cliquer — avec les mots du bouton —, taper, touche, défiler,
  lire la page, cliquer / taper / choisir sur un élément nommé). **Arrêter l'enregistrement** à la fin.
- Jamais enregistré : un secret (identifiant du coffre, carte, texte qui ressemble à un mot de passe ou une clé), un
  fichier envoyé, la réponse à une fenêtre, un téléchargement. L'étape est marquée « pas rejouée » : le rejeu s'arrête
  là.
- **Rejouer** : sans l'IA, aucun coût de modèle. Contrôles à chaque étape : la page doit rester sur le même site ; un
  clic n'a lieu que si le bouton sous le point porte toujours les mêmes mots ; un élément doit être retrouvé une seule
  fois par son rôle et son nom ; sinon arrêt avec la raison, et rien de plus n'est fait. La politique réseau du bot
  s'applique.
- **Toute étape qui peut engager** (payer, envoyer, commander, supprimer, Entrée, un bouton illisible) attend
  « Autoriser l'étape N », **à chaque exécution**, jamais « toujours ». Un panier se remplit seul ; le paiement attend
  toi.
- **Preuves** : pour chaque étape, adresse, titre, extrait, empreinte du texte, capture quand il y en a une (10
  dernières exécutions gardées).
- **Comparaison de page** : une étape « lire la page » compare le texte avec la fois d'avant (lignes ajoutées /
  retirées). Un changement prévient dans la discussion du bot et peut lancer un déclencheur (surveillance de site).

Code : `server/src/agent/flowrecord.ts` (enregistreur, branché sur les outils du navigateur dans `agent/tools.ts`),
`server/src/flows.ts`. Test : `server/test/flows-automations.test.ts`.

## Automatisations (L173)

- **Routine sans IA** : au lieu d'un tour du bot, la routine rejoue un parcours, envoie un événement à un webhook
  sortant du bot, publie une note, ou lance **ton** script sur l'ordinateur Linux du bot (jamais sur le serveur).
  Aucun appel de modèle. Seul le propriétaire le règle ; aucun outil de bot ne peut le changer.
- **Routines enchaînées** : « démarre après telle routine », seulement si elle a réussi ou dans tous les cas. Une
  boucle est refusée à l'enregistrement.
- **Déclencheurs** sur événements internes : tâche du tableau faite ou bloquée, idée faite, routine réussie ou ratée,
  page surveillée changée, parcours arrêté ⇒ publier une note, rejouer un parcours, lancer une routine, envoyer à un
  webhook. « Essayer » lance l'action une fois. **Un événement causé par un déclencheur n'en lance jamais un autre**.

Code : `server/src/automations.ts`, `internalevents.ts` (appel dans `scheduler.ts`). Test :
`server/test/flows-automations.test.ts`.

## Mémoire d'équipe (L171)

- Des notes par **espace** : un espace de travail (ses membres lisent ; membre et plus écrivent) ou un projet de la
  barre latérale (son propriétaire seul).
- **Isolée par défaut** : un bot reçoit les notes de son projet ; celles de son espace de travail seulement si son
  propriétaire coche « Bots qui lisent cette mémoire ». Jamais celles d'un autre espace. La mémoire personnelle d'un
  bot n'y est jamais copiée toute seule. Le bot les lit comme des informations, jamais comme des consignes.
- **Invités extérieurs** : un admin crée un lien (7 jours, lecture ou lecture + écriture), montré une seule fois. Ce
  qu'un invité écrit attend la relecture d'un admin avant qu'un bot le lise. Lien retiré ou expiré : il ne marche plus.
- **Liens** : une note peut pointer vers un bot, une autre note, une tâche, une idée, une routine, un parcours ou une
  adresse web ; chaque lien est vérifié ; une note affiche « liée depuis ».
- Aucun secret (mot de passe, clé, carte) n'est accepté.

Code : `server/src/teammemory.ts` (section de consigne dans `agent/prompt.ts`). Test : `server/test/teammemory-keep.test.ts`.

## Mémoire que tu contrôles (reste de L66) et leçons du travail (reste de L70)

- **« Ne pas retenir ce message »** (icône cerveau sous un de tes messages) : l'apprentissage automatique ne le lit
  jamais.
- **Un fait retiré n'est jamais réappris tout seul** : une note supprimée ou oubliée laisse une trace ; l'apprentissage
  et un `memory_save` non demandé l'ignorent. Seul ton « retiens… » explicite, ou « Annuler », la ramène.
- **Conversation neuve proposée** : après une note retirée, un avis dans la discussion du bot propose « Nouvelle
  conversation » (la conversation en cours peut encore la contenir). Rien n'est remis à zéro sans toi.
- **Leçons du travail ordinaire** : chaque objectif fini, bloqué ou arrivé à sa limite laisse une leçon (demande, issue,
  résumé, prochaines étapes, raison). Les chantiers gardent les leurs.
- **Bilan de la semaine** : réussites et échecs par bot ; un échec qui revient au moins 2 fois avec une raison
  semblable devient une **règle proposée**. Rien n'est écrit sans toi : « En faire une règle » ou « Écarter ».

Code : `server/src/agent/memorykeep.ts`, `server/src/agent/worklessons.ts`. Test : `server/test/teammemory-keep.test.ts`.

## Rôles, modèles et décisions (reste de L163)

- **Type et modèle d'une tâche** : code, relecture, recherche, documentation ou corvée ; un modèle peut être choisi sur la tâche.
- **Rôles** (bouton « Rôles et modèles ») : pour chaque type, un bot et un modèle ; « Épinglé » : ce bot prend toutes les tâches de ce type. Le chef est ton bot principal, sauf si tu en choisis un autre.
- **Quel modèle** : celui de la tâche, sinon celui du rôle, sinon celui du bot (puis ses réglages habituels). Un modèle qui ne peut pas tourner est ignoré.
- **Qui exécute** : le bot épinglé du rôle ; sinon le bot choisi, sauf si c'est le chef ou s'il tient un autre rôle — alors le bot du rôle ; sinon le bot du rôle ; sinon personne (la tâche ne démarre pas). La carte dit « exécutée par … » et pourquoi. Aucun bot n'est créé tout seul.
- **Jeux de modèles** : garde les modèles des rôles sous un nom (50 au plus) et réapplique-les d'un clic ; un modèle qui n'existe plus est sauté et nommé.
- **Décisions qui t'attendent** : en haut du tableau, les tâches à relire, bloquées (avec la raison) ou que personne ne peut faire.
- Le choix du modèle par groupe de tâches dans le plan (T9) n'est pas fait : le modèle se règle ensuite sur la tâche ou le rôle.

## Plan créé depuis la discussion et bot pour un rôle (fin de L163)

- **Plan dans la discussion** : quand tu demandes « planifie ce travail », le bot montre une carte « Plan pour le tableau » (outil `board_plan_propose`, 12 tâches au plus) : chaque tâche avec son type, son bot (ou « selon le rôle »), sa priorité et les tâches qu'elle attend. Rien n'est créé avant ton clic.
- Tu décoches ce que tu ne veux pas, tu choisis « Lancer tout de suite » ou non, puis « Mettre sur le tableau ». Tout est créé, ou rien (tableau trop plein : refus avant de créer). Une tâche qui attendait une tâche décochée ne l'attend plus.
- **Bot pour un rôle que personne ne tient** : une carte de proposition (« Nouveau coéquipier ») arrive dans la discussion de ton bot principal, une par rôle, jamais deux fois tant qu'une attend. Le bot n'est créé que si tu appuies sur « Créer » ; il tient alors le rôle et prend le modèle du bot principal. Aussi depuis « Rôles et modèles » → « Proposer un bot ».

## Limites connues

- Le rejeu d'un parcours utilise le navigateur du bot : s'il travaille en même temps dans ce navigateur, les deux se
  gênent (rien n'est cliqué si la page a changé, le rejeu s'arrête).
- Le plan ne choisit pas encore « dans cette conversation / une nouvelle » ni un modèle par groupe (T9) ; les rôles valent
  pour tout le tableau (pas de projets séparés).
- Le tableau se rafraîchit toutes les 10 s quand il est ouvert (pas d'événement temps réel dédié).
