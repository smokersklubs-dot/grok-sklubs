# Audit complet : OpenMausBot comparé à Sklubot

- Dépôt lu : `github.com/milind-soni/OpenMausBot`, commit `87d8a79` (22/11/2026), version 0.1.176, 9 210 fichiers. Lecture seule, rien exécuté, copie supprimée à la fin.
- Sklubot lu : `/home/user/grok-sklubs`, le 22/11/2026 entre 02:20 et 03:10 UTC. **D'autres sessions modifiaient l'arbre pendant la lecture** (`agent/loop.ts`, `prompt.ts`, `tools.ts`, `authorize.ts`, `routes.ts`, `agent/recall.ts` apparu à 03:07) : les numéros de ligne peuvent avoir bougé de quelques lignes.
- Rien n'a été écrit dans Sklubot.

## Compteurs

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS | Total |
|---|---|---|---|---|---|
| 107 | 73 | 63 | 11 | 10 | 264 |

Comment lire « FAIT » : le fichier et la ligne de la fonction sont donnés, avec un fichier de test qui la touche. Le signe **†** veut dire : trouvé par recherche de mots et lecture de l'en-tête du fichier, fonction pas relue ligne à ligne. Six fichiers de test ont été lancés (voir « Non vérifié ») ; les autres tests sont cités, pas lancés.

## En une page : pourquoi OpenMausBot « ne marche pas comme Sklubot »

Le propriétaire a raison : les deux produits ne se comportent pas pareil, même là où la liste des fonctions se ressemble. Les 8 différences de fond :

1. **Sklubot demande, OpenMausBot fait.** Chez OpenMausBot tout nouveau bot est en « Accès complet » : il agit, dit en une ligne ce qu'il a choisi, et chaque changement a un bouton **Annuler**. Chez Sklubot tout nouveau bot est « careful » = il demande toujours (`server/src/store.ts:219`), et le prompt l'oblige à recopier les mots de l'utilisateur dans `user_quote` pour chaque action (`agent/prompt.ts:156`).
2. **Un nouveau message annule l'accord en attente.** Chez Sklubot, écrire au bot pendant qu'une carte d'accord attend fait expirer la carte et saute les actions prévues (`agent/loop.ts:1739`, `supersede`). Chez OpenMausBot une ligne tapée ne répond jamais à une carte et ne l'annule pas : elle attend son tour.
3. **Les accords expirent.** 25 minutes chez Sklubot (`config.ts:191`). Chez OpenMausBot une carte posée dans la discussion de la personne n'a pas d'horloge du tout.
4. **Un bot Sklubot ne fait qu'une chose à la fois.** Une routine, un collègue ou un fil qui tourne bloque la file du bot (`agent/loop.ts:216`). OpenMausBot fait tourner jusqu'à 3 fils par bot, et chaque routine dans une discussion cachée à part.
5. **Les routines écrivent dans la discussion principale.** Chez Sklubot une routine est un tour dans le fil 0 (`agent/turn-request.ts:31`) : ses étapes s'affichent dans le chat et gonflent le contexte. Chez OpenMausBot seul le résultat arrive, et « rien de neuf » ne poste rien.
6. **Le navigateur du bot renvoie des images, pas du texte.** Chaque action d'écran de Sklubot renvoie une capture (`agent/tools.ts:149-200`). OpenMausBot renvoie l'arbre de la page en texte, avec des références, et dit ce que l'action a fait apparaître ou disparaître : moins d'allers-retours, moins cher, moins d'erreurs de clic.
7. **Session perdue = bot amnésique, sans le dire.** Si Claude Code ou Codex ne retrouve plus sa session, Sklubot relance avec le seul dernier message (`agent/engine.ts:847` et `:936`). OpenMausBot reconstruit la discussion depuis le chat et l'écrit : « … il a continué dans une nouvelle session ».
8. **Le cache du modèle est mal utilisé.** Sklubot ne met en cache que le prompt système (`llm/anthropic.ts:88`), et ce prompt contient des parties qui changent à chaque tour (souvenirs choisis selon les derniers mots, routines, équipe : `agent/prompt.ts:205-221`). Les messages ne sont jamais mis en cache : un tour de 60 étapes renvoie tout l'historique plein tarif à chaque étape. OpenMausBot sépare une moitié stable et une moitié qui bouge, et garde le cache chaud.

## 1. Licence

- **Apache License 2.0** (`LICENSE`, `package.json` : `"license": "Apache-2.0"`). © 2026 Milind Soni et contributeurs. Le projet était sous MIT avant.
- **Exception : le dossier `enterprise/`** est sous « OpenMausBot Enterprise License » (code visible, pas libre : production = clé de licence payante, pas de revente ni de marque blanche sans contrat). → on n'y touche pas.
- **Marques** : les noms « OpenMausBot », « MausBot » et la mascotte appartiennent à Supamaus Software Private Limited. Apache 2.0 ne donne pas le droit de les utiliser.
- Ce qu'Apache 2.0 permet : lire, copier, modifier, vendre, à condition de garder les mentions de copyright, le fichier `NOTICE`, et de dire ce qui a été modifié. Elle donne aussi une licence de brevets.
- Le dépôt contient du code repris d'autres projets (T3 Code MIT, Cache Tax MIT, Hermes MIT, Cua Driver MIT, Cline / Roo-Code / Gemini CLI Apache 2.0) : toute copie doit garder leurs mentions.
- **Pour Sklubot** : la règle du projet reste « idées seulement, code à nous » (c'est ce qu'écrit déjà `agent/watch.ts:36`). Une copie de code serait légale avec les mentions, mais ce n'est pas la méthode choisie.

## 2. Tableau complet des fonctions

Taille : **S** ≤ 1 jour, **M** 2 à 4 jours, **L** 1 à 2 semaines. Chemins Sklubot relatifs à `server/src/` sauf indication.

### Discussion

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Discussion | Réponse qui s'écrit en direct, avec les étapes d'outils | FAIT | `agent/loop.ts:962` (onText), `agent/loop.ts:1223` (StreamingRow) ; test `wave4.test.ts` | — | — |
| Discussion | Ligne « ce que je fais et pourquoi » avant un travail long (règle de prompt pour tous les bots) | PARTIEL | `agent/prompt.ts:164` (progress_update pendant le travail) | Pas de règle « une ligne avant de commencer, avec la durée attendue » | S |
| Discussion | Règles d'écriture communes : répondre d'abord, s'arrêter quand c'est fini, ne jamais nommer les outils, une seule question à la fois | PARTIEL | `agent/prompt.ts:177-184` (5 lignes) | « Regarde avant de demander », « une seule chose demandée », « dis ce que tu n'as pas fait et l'autre moyen » | S |
| Discussion | Plusieurs fils indépendants par bot (« Nouveau fil », « Tous les fils », dossiers de fils) | PARTIEL | `agent/loop.ts:541` (fil = réponse sous un message), `web/src/components/ThreadPanel.tsx` ; test `waveA.test.ts` | Fils libres, liste des fils, dossiers, titre automatique | L |
| Discussion | Jusqu'à 3 fils qui travaillent en même temps pour un bot | ✅ FAIT (2026-11-22, L99 : `agent/lanes.ts`) — était MANQUANT | `agent/loop.ts:216` : une seule file par bot | Plusieurs tours en parallèle par bot | L |
| Discussion | Modèle propre à un fil | MANQUANT | — | — | S |
| Discussion | Modifier un message envoyé : nouvelle branche, retour en arrière (fork, rewind) | MANQUANT | aucune route d'édition dans `routes.ts:657-1260` | Édition, branches, navigation entre versions | M |
| Discussion | Bouton « Réessayer » sur un message en échec | PARTIEL | `agent/loop.ts:1179` (Continuer), `agent/failures.ts:342` (carte avec remèdes) ; test `failures.test.ts` (lancé, 16/16) | Pas de « Réessayer » sur un message ordinaire | S |
| Discussion | Épingler un message, menu des messages épinglés | MANQUANT | — | — | S |
| Discussion | Copier une réponse en un clic | MANQUANT | `web/src/components/Transcript.tsx:324` : actions = réaction, fil, écouter | Bouton copier | S |
| Discussion | Exporter la transcription | PARTIEL | `routes.ts:1258` (lire une ancienne génération) | Export en fichier (Markdown / JSON) | S |
| Discussion | Réactions sur un message | FAIT | `routes.ts:798` ; test `wave5b.test.ts` | — | — |
| Discussion | 👍 / 👎 sur un message du bot = réponse (« oui, envoie ») qui relance le bot ; sur une carte = autoriser / refuser | PARTIEL | `telegram.ts:184` (seulement dans Telegram), `agent/loop.ts:1672` (retour lu au tour suivant) | Dans l'appli web, la réaction ne répond pas et ne relance pas | S |
| Discussion | Messages envoyés pendant que le bot travaille : file visible, modifiable, livrée au bot en cours de tour | PARTIEL | `agent/loop.ts:398` (drainSteering, modèles API) ; aucun test trouvé | Bots sur abonnement : le message attend la fin du tour (`agent/loop.ts:827`). Pas de liste « en attente » dans le composeur | M |
| Discussion | Stop qui vise un tour précis (un double clic n'arrête pas le message suivant) ; ligne « Tu as arrêté ceci », jamais une erreur | PARTIEL | `routes.ts:947`, `agent/loop.ts:787` (« Stopped. ») | Pas d'identifiant de tour dans le Stop | S |
| Discussion | Un arrêt que personne n'a demandé s'affiche comme une panne, pas comme « Arrêté » | FAIT | `agent/loop.ts:751` (timed out / stalled / stopped séparés) ; test `watch.test.ts` (lancé, 14/14) | — | — |
| Discussion | Envoi sûr contre les doublons (identifiant d'envoi) | MANQUANT | `routes.ts:821` | Un envoi répété par le réseau crée deux messages | S |
| Discussion | Puce de consommation par discussion : entrée non cachée, cachée, sortie, coût | PARTIEL | `llm/anthropic.ts:166` (cachedTokens), `usage.ts` † | Pas de puce dans l'en-tête de la discussion | S |
| Discussion | Recherche dans les bots et les messages | FAIT | `web/src/components/CommandPalette.tsx`, `FindBar.tsx`, outil `conversation_search` ; test `wave3.test.ts` | Pas d'index pour le chinois / japonais (sans objet aujourd'hui) | — |
| Discussion | Aperçu d'un lien au survol | MANQUANT | — (déjà noté dans `docs/COUVERTURE.md`) | — | S |
| Discussion | Citer un passage sélectionné | MANQUANT | — | — | S |
| Discussion | Pièces jointes, capture collée, glisser-déposer | FAIT | `uploads.ts`, `web/src/components/Composer.tsx:158` ; test `large-attachments.test.ts` | — | — |
| Discussion | Aperçu de fichiers (Markdown, HTML, images, vidéo) | FAIT | `attachmentpreviews.ts`, `web/src/components/PagePreview.tsx` ; test `wave5b-files.test.ts` † | — | — |
| Discussion | Carte de question avec choix à un tap et valeur par défaut | FAIT | outil `ask_user` (`agent/tools.ts`), `web/src/components/Cards.tsx` ; test `ask-wait.test.ts` | — | — |
| Discussion | Widgets : rangée de boutons, formulaire prérempli avec la valeur actuelle | PARTIEL | `ask_user` avec choix | Formulaires et arbres de widgets | M |
| Discussion | Page HTML / mini-appli affichée dans la discussion | FAIT | `agent/pagetools.ts` (artifact_create), `web/src/components/ArtifactPanel.tsx` ; test `pages-artifacts.test.ts` | — | — |
| Discussion | Montrer du doigt une partie d'une page au bot (« pointé ») | MANQUANT | — | — | M |
| Discussion | Style de réponse « conversationnel » réglable par bot | MANQUANT | `agent/prompt.ts:177` (style fixe) | — | S |
| Discussion | Règles pour tous les bots | FAIT | `rules.ts`, `agent/prompt.ts:209` ; test `rule-words.test.ts` | — | — |
| Discussion | Profil « À propos de moi » lu par tous les bots, que les bots complètent | FAIT | `agent/prompt.ts:187`, outil `profile_update` ; test `wave4.test.ts` | — | — |
| Discussion | L'heure voyage avec chaque message, pas dans le prompt système | FAIT | `agent/loop.ts:716` ; pas de test dédié | — | — |
| Discussion | Étiquette unique sur chaque ligne qui ne vient pas de la personne : `[De qui · quoi · autorité]`, imitations neutralisées | PARTIEL | `agent/turn-request.ts:60-70` (texte selon l'origine) | Pas de format unique ni de neutralisation des imitations vérifiée | M |
| Discussion | « Repartir de zéro » : nouvelle session, les messages restent à l'écran | DIFFÉRENT | `routes.ts:949`, `store.ts:338` : nouvelle génération, l'ancienne se lit dans l'historique | Rien de perdu ; l'ancien fil n'est plus à l'écran | — |
| Discussion | Résumé écrit pendant que la discussion est au repos (le tour suivant démarre vite) | MANQUANT | `agent/loop.ts:1125` et `agent/memory.ts:70` : le résumé se fait pendant que la personne attend | Résumé « à chaud » en tâche de fond | M |
| Discussion | Fenêtre d'aide des raccourcis clavier | PARTIEL | `web/src/components/CommandPalette.tsx` (Ctrl+K) | Liste des raccourcis | S |
| Discussion | Mode Simple / Avancé de toute l'interface | MANQUANT | — (déjà dans `docs/COUVERTURE.md`) | — | M |

### Bots et équipe

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Bots | Un bot = nom, rôle, instructions, modèle, mémoire, compétences | FAIT | `store.ts:219`, `web/src/components/BotSettings.tsx` ; test `app.test.ts` | — | — |
| Bots | Choix du modèle par bot, fournisseurs indisponibles grisés avec la raison | FAIT | `providers.ts`, `web/src/components/Brain.tsx`, `TeamModels.tsx` ; test `openrouter.test.ts` † | — | — |
| Bots | Le défaut d'un nouveau bot est une IA qui a répondu à un petit test | MANQUANT | `apimodels.ts:222` (test d'un modèle à la demande) | Test en arrière-plan et choix automatique du défaut | M |
| Bots | « Nouveau bot » créé d'un clic ; « Configure-moi » en une phrase | PARTIEL | `web/src/components/Modals.tsx` †, outil `self_update` ; test `wave4.test.ts` | Réglages « défauts des nouveaux bots » | S |
| Bots | Modèles prêts à l'emploi avec brouillon à relire | FAIT | `teamfile.ts:593`, `web/src/components/TeamTemplates.tsx` ; test `team-templates.test.ts` | — | — |
| Bots | Équipe entière installée depuis un fichier Markdown ou un lien GitHub | FAIT | `teammd.ts`, `teammdimport.ts` ; test `team-markdown.test.ts` | — | — |
| Bots | Partager un bot ou un département (dossier, lien, dépôt communautaire) | PARTIEL | `agent/teamexport.ts`, outil `team_export` | Publication vers un dépôt, lien géré (déjà dans `docs/COUVERTURE.md`) | M |
| Bots | Menu du bot : épingler, non lu, dupliquer, masquer, supprimer | FAIT | `routes.ts:712`, `routes.ts:720`, `web/src/components/Sidebar.tsx` ; test `wave3.test.ts` | — | — |
| Bots | Départements avec instructions partagées (jamais modifiables par un bot) | FAIT | `sectionroutes.ts`, `agent/prompt.ts:241` ; test `pause.test.ts` | — | — |
| Bots | Chef de cabinet par département : reçoit les pannes des bots, relance leur travail, propose des réglages | PARTIEL | `agent/prompt.ts:93` (un seul bot principal par compte), `agent/failures.ts:146` (entraide) | Un chef par département, relance du fil d'un collègue | M |
| Bots | Le chef crée un spécialiste tout de suite, avec « Annuler » | DIFFÉRENT | `agent/recruit.ts:18` (carte à valider), outil `bot_create` ; test `recruiter.test.ts` | L'utilisateur doit cliquer avant ; plus prudent, plus lent | — |
| Bots | Changements faits par un bot (profil, compétence, modèle, mémoire) appliqués tout de suite avec « Détails » et « Annuler » | PARTIEL | `routes.ts:906` (annuler une ligne), outil `self_update` | La plupart passent par une carte à valider avant | M |
| Bots | Carte « Qui rend compte à qui » (équipe à plusieurs personnes) | MANQUANT | `workspaces.ts:70` (rôles, partage) | — | M |
| Bots | Un bot peut parler à n'importe quel autre bot ; liste de bots autorisés possible | FAIT | outil `bot_message`, `agent/team.ts:68` ; test `ask-wait.test.ts` | — | — |
| Bots | Déléguer un travail et reprendre automatiquement quand la réponse revient | FAIT | `agent/team.ts:68` (settleAsk), `bot_message` avec `wait` ; test `ask-wait.test.ts` | — | — |
| Bots | Registre unique des délégations (arbre, budgets, 10 invariants testés, une seule politique de redémarrage) | PARTIEL | `agent/team.ts`, `agent/loop.ts:1678` | Pas d'arbre enregistré ni de budget par demande ; règles réparties | L |
| Bots | Même demande posée deux fois au même bot : une seule réponse | MANQUANT | — | — | S |
| Bots | Aides temporaires pour un travail à part | FAIT | outil `helper_start` (`agent/tools.ts:1123`) ; test `app.test.ts` | — | — |
| Bots | Deuxième avis : ouvrir un fil sur un autre modèle (`start_thread` + `list_models`) | MANQUANT | — | — | M |
| Bots | Duo rédacteur / vérificateur avant livraison (3 tours au plus, vérificateur sur un autre fournisseur) | PARTIEL | `peerreview.ts:11`, `web/src/components/PeerReview.tsx` | Relecture à la demande, pas automatique avant de livrer | M |
| Bots | « Burst » : découper en lots parallèles, carte « Lancer », réponse fusionnée | MANQUANT | — (déjà dans `docs/COUVERTURE.md`) | — | M |
| Bots | Tâche de fond avec carte de suivi | FAIT | `agent/bgtasks.ts:10` ; test `wave5.test.ts` | — | — |
| Bots | Mode objectif (le bot enchaîne les tours jusqu'au but) | FAIT | `agent/goals.ts:89` ; test `wave10.test.ts` | — | — |
| Bots | Choisir les outils d'un bot un par un (liste autorisée / exclue) | PARTIEL | familles d'outils (`bot.disabledTools`) | Sélection outil par outil | S |
| Bots | Pont `find_tool` / `use_tool` pour les petits modèles locaux | MANQUANT | — | — | M |
| Bots | Pause d'un bot, d'un département, de tout | FAIT | `pauses.ts:17`, `agent/loop.ts:265` ; test `pause.test.ts` | — | — |
| Bots | Avatar en image (envoyée ou générée) | MANQUANT | — (déjà dans `docs/COUVERTURE.md`) | — | S |
| Bots | Mascottes et marque MausBot | NON REPRIS | — | Marque déposée | — |

### Groupes

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Groupes | Groupe de plusieurs bots avec instructions et dossier communs | FAIT | outils `room_create`, `room_post` ; test `room-routing.test.ts` (lancé, 16/16) | — | — |
| Groupes | « Auto » : un modèle rapide choisit qui répond, sinon le bot principal | FAIT | `agent/roomrouting.ts:42`, `:164` ; test `room-routing.test.ts` | — | — |
| Groupes | Limites anti-boucle entre bots | FAIT | `agent/roombudget.ts`, `agent/tools.ts:1072` ; test `roombudget.test.ts` | — | — |
| Groupes | « stop @Bot » / « reprends » : mettre un bot du groupe en attente, gardé après redémarrage | MANQUANT | — | — | S |
| Groupes | Temps limite d'un membre réglable (un bot muet ne bloque pas le groupe) | PARTIEL | `agent/watch.ts:112` (surveillance générale) | Pas de limite propre au groupe | S |
| Groupes | Les messages envoyés pendant qu'un bot répond restent hors du fil jusqu'à la fin | PARTIEL | `agent/loop.ts:398` | Non vérifié pour les groupes | S |
| Groupes | Notes de travail repliées (« A travaillé N min »), seule la réponse finale est lue par les autres | PARTIEL | `agent/loop.ts:1101` (lignes d'étapes) | Repli en une ligne | S |
| Groupes | « A fini sans résumé » : le bot est relancé une fois pour un résultat court | FAIT | `agent/loop.ts:1076-1083`, `agent/turn-request.ts:79` ; test `wave4.test.ts` † | — | — |
| Groupes | Même demande à plusieurs membres = un seul message partagé | MANQUANT | — | — | S |
| Groupes | Refus quand un @nom est porté par plusieurs membres | MANQUANT | `agent/team.ts` | — | S |
| Groupes | Consommation par groupe | MANQUANT | — | — | S |

### Mémoire

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Mémoire | Mémoire lisible, modifiable, supprimable | FAIT | `routes.ts:1152`, `web/src/components/Brain.tsx` ; test `app.test.ts` | — | — |
| Mémoire | Le bot retient tout seul après les discussions | FAIT | `agent/memory.ts:137` (consolidate), `:310` (balayage au repos) ; test `wave5.test.ts` | — | — |
| Mémoire | Rappel automatique avant chaque tour | PARTIEL | `agent/prompt.ts:17` (pickMemories), `agent/recall.ts:229` (ajouté pendant l'audit) ; test `memory-recall.test.ts` (non lancé) | Le rappel va dans le prompt système (casse le cache) au lieu d'être placé devant le message ; mots-clés seulement | S |
| Mémoire | « Rêve » : une passe qui lit plusieurs discussions ensemble | MANQUANT | — | Peu utile tant qu'un bot n'a qu'une discussion | M |
| Mémoire | Rangement de la mémoire quand elle grossit | PARTIEL | `agent/memory.ts:119` (similar), statuts contesté / confirmé | Pas de rangement périodique | S |
| Mémoire | « Souviens-toi » / « oublie » dans la discussion ; un fait oublié n'est jamais rajouté | PARTIEL | outil `memory_save`, `routes.ts:2533` | Liste des faits oubliés à ne pas remettre | S |
| Mémoire | Journal des changements de mémoire, hors de portée du bot | PARTIEL | `journal.ts` † (journal général non modifiable) | Journal propre à la mémoire | S |
| Mémoire | Mémoire d'équipe partagée | MANQUANT | — (déjà dans `docs/COUVERTURE.md`) | — | L |
| Mémoire | Ce que le bot sait de ses autres discussions (annoncé une fois) | MANQUANT | — | Lié aux fils multiples | M |
| Mémoire | Import / export de la mémoire | FAIT | `agent/memory.ts:247`, `:261`, `routes.ts:2657` ; test `wave5b.test.ts` | — | — |
| Mémoire | Sujets sensibles et secrets jamais retenus | FAIT | `agent/sensitive.ts` ; test `memory-guard.test.ts` | — | — |

### Compétences

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Compétences | Compétence = dossier avec `SKILL.md` ; le bot ne reçoit que l'index | FAIT | `agent/prompt.ts:221-229`, outil `skill_read` ; test `skills-library.test.ts` | — | — |
| Compétences | Index limité (30 compétences, 4 000 octets) avec note de ce qui est coupé | PARTIEL | `agent/prompt.ts:225` (tout en clair sous 6 000 caractères, sinon liste) | Pas de plafond sur la liste | S |
| Compétences | Le bot écrit ses compétences ; `/learn` | FAIT | outils `skill_save`, `skill_propose` ; test `irreversible-skills-localtools.test.ts` | — | — |
| Compétences | Apprentissage automatique en arrière-plan après beaucoup d'étapes | MANQUANT | — | — | M |
| Compétences | Bibliothèque partagée, import GitHub | FAIT | `skillslibrary.ts`, `skillsgithub.ts` ; test `skills-library.test.ts` | — | — |
| Compétences | Contrôle de sécurité à l'arrivée | FAIT | `skillscan.ts:154` ; test `skill-scan.test.ts` | Sklubot est plus strict (un « risque » reste en brouillon) | — |
| Compétences | Partage automatique d'une compétence apprise à tout le département | PARTIEL | `agent/prompt.ts:230` (compétences partagées par les collègues) | Réglage Non / Demander / Automatique | S |
| Compétences | Compétences des autres outils de l'ordinateur (Claude, Codex) reprises à l'accueil | MANQUANT | — | — | S |
| Compétences | Compétence apprise par démonstration | FAIT | `teach.ts:80` ; test `waveA.test.ts` | Sklubot seulement | — |

### Routines et déclencheurs

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Routines | Une fois, chaque jour, jours choisis, toutes les N minutes, cron avec fuseau | FAIT | `cron.ts`, `routines.ts`, outil `routine_create` ; test `app.test.ts` | — | — |
| Routines | Le bot crée la routine dans le même tour, sans demander, avec carte Modifier / Pause / Annuler | PARTIEL | `agent/prompt.ts:169`, outil `routine_create` | Carte d'accord selon l'autonomie ; pas de carte Modifier / Pause / Annuler | S |
| Routines | Chaque exécution dans une discussion cachée ; seul le résultat arrive dans le chat | MANQUANT | `agent/turn-request.ts:31` : la routine tourne dans le fil principal | Discussion à part + « Voir l'exécution » | M |
| Routines | « Rien de neuf » : aucun message, aucune notification | FAIT | outil `stay_quiet`, `agent/loop.ts:804` (statut « quiet ») ; test `features.test.ts` † | — | — |
| Routines | Une exécution qui a besoin de toi pose sa question dans le chat (« a besoin de toi ») | PARTIEL | `agent/loop.ts:804` (« Waiting for your approval ») | La question peut expirer en 25 min | S |
| Routines | Rattrapage après une coupure : seule la plus récente tourne, les départs sont étalés | PARTIEL | `scheduler.ts:184` (24 h, une par routine) | Pas d'étalement : après une longue coupure tout part en même temps | S |
| Routines | « Aussi au démarrage de l'appli » | MANQUANT | — | Peu utile sur un serveur toujours allumé | S |
| Routines | « Se souvenir de la dernière exécution » | DIFFÉRENT | la routine tourne dans la discussion du bot, donc elle voit ses passages précédents | Rien de perdu ; contexte plus lourd | — |
| Routines | Modèle propre à une routine | MANQUANT | — | — | S |
| Routines | Une seule exécution à la fois | FAIT | `scheduler.ts:81-84` ; test `wave5b.test.ts` † | — | — |
| Routines | Limite de travail d'une exécution ; abandon après 1 h derrière un bot occupé | PARTIEL | `config.ts:67` (60 étapes), `:119` (60 min sur abonnement) | Pas d'abandon d'une exécution qui attend derrière le bot | S |
| Routines | Un échec relance une fois, sauf si recommencer ne peut que répéter | PARTIEL | `agent/failures.ts:146` (nouvel essai, 2 au plus) | Non vérifié pour une routine arrêtée par la limite de temps | S |
| Routines | Échecs répétés : les exécutions sont espacées, jamais coupées | DIFFÉRENT | `scheduler.ts:249-261` : après N échecs la routine est mise en pause | L'utilisateur doit la relancer à la main | S |
| Routines | Limite d'abonnement atteinte : l'exécution repart une minute après la remise à zéro | PARTIEL | `agent/sublimit.ts:219` ; test `sublimit.test.ts` | Règle « la prochaine exécution fait déjà le travail » | S |
| Routines | Exécution dont le tour a disparu : jamais « en cours » pour toujours | PARTIEL | `agent/loop.ts:801-805` | Pas de surveillance périodique des exécutions orphelines | S |
| Routines | Webhook avec secret, jeton Bearer conseillé, secret masqué et remplaçable | FAIT | `routes.ts` (`/hooks/:token`) † ; test `app.test.ts` | Bearer et rotation non vérifiés | — |
| Routines | Même événement livré deux fois = une seule exécution (7 jours) | PARTIEL | `routines.ts:162` (`native_seen`, applis intégrées) | ✅ Webhooks aussi depuis le 2026-11-22 (L20, `hooktrust.ts`) | S |
| Routines | Événements d'applis connectées (nouveau mail, message Slack…) | FAIT | `native/triggers.ts` ; test `apps.test.ts` | — | — |
| Routines | « Vérifie plus tard » / « attends que… » (`check_back`, `wait_until`) | PARTIEL | surveillance `scheduler.ts:154` (watch), routine unique | Outil simple pour reprendre la même discussion plus tard | M |
| Routines | Sauter sans appeler le modèle quand rien n'a changé | FAIT | `scheduler.ts:98-139` ; test `security.test.ts` † | — | — |
| Routines | Calendrier des automatisations, journal des exécutions | PARTIEL | `routes.ts:1200`, `web/src/components/GoalsAndJobs.tsx` † | Vue calendrier | S |
| Routines | Brief quotidien, rappels proactifs | FAIT | `agent/nudges.ts:61`, `today.ts:43` ; test `today.test.ts` | — | — |
| Routines | Routine « lecture et brouillon seulement » | PARTIEL | règles par routine (`agent/loop.ts:711`) | Mode dédié | S |

### Ordinateur et navigateur

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Ordinateur | Bureau Linux isolé par bot, dossier durable | FAIT | `linux.ts`, `docker/desktop` ; test `linux.test.ts` (non lancé) | — | — |
| Ordinateur | Écran en direct, prise de main puis rendre la main | FAIT | `vnc.ts`, `takeover.ts:23`, `web/src/components/ComputerViewer.tsx` ; test `wave3.test.ts` | — | — |
| Ordinateur | L'ordinateur de l'utilisateur piloté par le bot, avec accord | FAIT | `agent/mycomputer.ts`, `relay.ts:165`, `companion/` ; test `relay.test.ts` | — | — |
| Ordinateur | Actions en arrière-plan sur l'ordinateur de l'utilisateur, sans voler la souris | MANQUANT | `agent/mycomputer.ts` (outils `my_click`, `my_type`) | — | L |
| Ordinateur | Clic envoyé mais non confirmé : « ne reclique pas, vérifie » | MANQUANT | — | — | S |
| Ordinateur | Ordinateur partagé entre bots : file d'attente annoncée (« 2e dans la file, X l'utilise »), reprise automatique | PARTIEL | `sharedcomputers.ts:106`, `agent/loop.ts:778` (« tous occupés, redis-moi de continuer ») ; test `shared-computers.test.ts` | Pas de place dans la file ni de reprise automatique | S |
| Ordinateur | Une capture identique n'est pas renvoyée au modèle | PARTIEL | `agent/context.ts` (seules les dernières captures sont renvoyées) | Dédoublonnage par empreinte | S |
| Ordinateur | Ordinateur éteint tout seul quand il est au repos | FAIT | `freecomputers.ts:133`, `routes.ts:1617` ; test `free-computers.test.ts` | — | — |
| Ordinateur | Commandes longues : délai par appel, tâche détachée, jamais de boucle d'attente | PARTIEL | `jobs.ts`, outils `job_list`, `job_output` ; test `wave10-linux.test.ts` † | Règles de prompt sur les délais et les commandes à ne pas relancer | S |
| Ordinateur | Liste noire de commandes jamais approuvées toutes seules (effacer un disque, etc.) | PARTIEL | `agent/irreversible.ts`, `agent/authorize.ts:76` ; test `irreversible-skills-localtools.test.ts` | Les bots sur abonnement tournent sans garde dans leur ordinateur (`agent/engine.ts:795`) | S |
| Ordinateur | Points de sauvegarde du dossier avant chaque tour, « Annuler » | FAIT | `snapshots.ts:207`, `routes.ts:906` ; test `auto-backup.test.ts` † | — | — |
| Ordinateur | Téléphone Android piloté par câble USB | MANQUANT | — | — | L |
| Ordinateur | Ordinateurs cloud Boat (service payant) | NON REPRIS | — | Fournisseur payant ; Sklubot héberge les siens | — |
| Ordinateur | Bureau sur son propre VPS par SSH | DIFFÉRENT | `deploy/`, `docker-compose.vps.yml` : tout Sklubot tourne sur le VPS | Rien de perdu | — |
| Ordinateur | Dossiers de l'ordinateur prêtés au cloud, copie tenue à jour | MANQUANT | — (déjà dans `docs/COUVERTURE.md`) | — | L |
| Navigateur | Vrai Chrome propre au bot, visible en direct | FAIT | `computer.ts:174`, outil `browser_open` ; test `features.test.ts` † | — | — |
| Navigateur | Ouvrir une page renvoie sa structure en texte avec des références | PARTIEL | `agent/tools.ts:149` (capture), `:212` (element_snapshot à part) ; test `elements.test.ts` | Trois appels au lieu d'un ; image par défaut | M |
| Navigateur | Le résultat d'une action dit ce qui est apparu, disparu, la page atteinte | MANQUANT | `agent/tools.ts:219` (renvoie une capture) | — | M |
| Navigateur | « La page signale… » : requêtes en échec, erreurs, CAPTCHA détecté | MANQUANT | — | — | M |
| Navigateur | Onglets, retour / avant, attendre un texte, fenêtres d'alerte, envoi de fichier | MANQUANT | liste des 87 outils : aucun | — | M |
| Navigateur | Preuves : chaque étape gardée avec image, citée dans le compte rendu | MANQUANT | — | — | M |
| Navigateur | Un seul appel à la fois par navigateur | FAIT | `takeover.ts:23`, `agent/tools.ts:254` ; test `wave3.test.ts` † | — | — |
| Navigateur | Le bot ouvre de lui-même un lien donné par l'utilisateur, sur son écran | FAIT | `agent/links.ts:40`, `agent/prompt.ts:54` ; test `links.test.ts` (lancé, 8/8) | Sklubot est plus explicite | — |
| Navigateur | Carte « Connexion nécessaire » : Ouvrir, Fait, Annuler, Enregistrer un identifiant | FAIT | outil `ask_takeover`, `web/src/components/Cards.tsx` ; test `wave3.test.ts` | « Enregistrer un identifiant » depuis la carte non vérifié | — |
| Navigateur | Identifiant saisi par le serveur, seulement sur son site, code à usage unique compris | FAIT | outils `vault_type`, `totp_code`, `totp.ts` ; test `totp.test.ts` | — | — |
| Navigateur | Code reçu par e-mail lu et tapé par le serveur | FAIT | outil `email_code_type` ; test `wave5.test.ts` | — | — |
| Navigateur | Scripts de page bloqués une minute après la saisie d'un mot de passe | MANQUANT | — | Sklubot n'a pas d'outil de script de page : risque plus faible | S |
| Navigateur | Sortie réseau du navigateur limitée aux adresses publiques | FAIT | `net.ts:45`, `deploy/bots-firewall.sh` ; test `security.test.ts` † | — | — |
| Navigateur | Utiliser le Chrome de l'utilisateur (« My Chrome ») | PARTIEL | `agent/mycomputer.ts` (écran entier) | Pilotage du navigateur de l'utilisateur par ses éléments | M |
| Navigateur | Étapes enregistrées et rejouées sans modèle (« saved steps ») | MANQUANT | `teach.ts` (démonstration → compétence en texte) | Rejeu direct | L |

### Voix

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Voix | Écouter une réponse, lecture automatique | FAIT | `voice/speak.ts`, `web/src/components/ListenControls.tsx` ; test `voice-speak.test.ts` | — | — |
| Voix | Voix par bot | FAIT | `voice/botvoice.ts` ; test `voice-bots.test.ts` | — | — |
| Voix | Voix locales sans clé | FAIT | `voice/piper.ts`, `voice/kokoro.ts` ; test `voice-fish-kokoro.test.ts` | Sklubot : tout est auto-hébergé | — |
| Voix | Markdown réécrit pour être dit | FAIT | `speechtext.ts` ; test `voice-speak.test.ts` † | — | — |
| Voix | Dictée dans le composeur | FAIT | `voice/transcribe.ts`, `web/src/components/Composer.tsx:212` ; test `voice-transcribe.test.ts` | — | — |
| Voix | Appel où l'on peut couper la parole | FAIT | `voice/session.ts:133` (bargeIn), `voice/vad.ts` ; test `wave6-voice.test.ts` | — | — |
| Voix | Pendant l'appel, la voix dit toutes les 30 s que le bot travaille encore | MANQUANT | `voice/session.ts:88` (sait si le bot travaille, ne le dit pas) | — | S |
| Voix | Répondre « oui » / « non » à voix haute à une demande d'accord, décidé par le serveur | MANQUANT | aucun accord dans `voice/session.ts` | — | M |
| Voix | Fiche de fin d'appel (durée, ce que le bot a fait) | PARTIEL | `calls.ts:40` (callSummaryText) | En cours selon `docs/COUVERTURE.md` | S |
| Voix | Raccroche après 5 min de silence ; coupure si le son ne se connecte pas en 20 s | PARTIEL | `voice/session.ts` † | Non vérifié | S |
| Voix | Note vocale envoyée par le bot (texte = légende) | MANQUANT | — | — | S |
| Voix | Appels « Live » par GPT-Live, Azure, Gemini, ElevenLabs | NON REPRIS | — | Clés payantes de tiers ; Sklubot a son propre appel en direct | — |

### Applis connectées et canaux

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Applis | 500+ applis par Composio (service tiers) | DIFFÉRENT | `native/` (API officielles Google, Microsoft, Slack), `catalog.ts` (MCP) ; test `apps.test.ts` | Beaucoup moins d'applis ; aucune dépendance à un tiers | — |
| Applis | Plusieurs comptes étiquetés par appli | FAIT | `native/accounts.ts` ; test `apps.test.ts` | — | — |
| Applis | Outils d'une appli accordés bot par bot (tout, liste, rien) | PARTIEL | `native/access.ts` † | Liste exacte par bot non vérifiée | S |
| Applis | Santé de chaque connexion (marche / à reconnecter) d'après l'usage réel | PARTIEL | `native/accounts.ts` (« se reconnecter »), `web/src/components/KeysHealthLinks.tsx` † | Vérification périodique des connexions peu utilisées | S |
| Applis | Brouillons Gmail : « brouillon » n'autorise jamais l'envoi | FAIT | `native/tools.ts`, `agent/loop.ts:1366` (judgeNative) ; test `apps.test.ts` | — | — |
| Applis | Carte « Envoyer en ton nom ? » | FAIT | `agent/loop.ts:1803` (waitForApproval) ; test `floor-autonomy.test.ts` | — | — |
| Applis | Ajouter ses propres serveurs MCP, y compris depuis la discussion | FAIT | `connectors.ts`, outil `local_tool_server_add` ; test `irreversible-skills-localtools.test.ts` | — | — |
| Applis | Recherche X et recherche web par un service tiers (treg) | DIFFÉRENT | `xsearch.ts:26` (API officielle), `reach.ts` ; test `wave4.test.ts` | Rien de perdu | — |
| Applis | Publication sur les réseaux par Postiz | MANQUANT | — | Ajout possible comme serveur MCP | S |
| Applis | Boîte e-mail IMAP / SMTP de l'utilisateur pour le bot | PARTIEL | `botmail.ts` (adresse propre au bot), Gmail / Outlook dans `native/` ; test `wave6-mail.test.ts` | IMAP générique | M |
| Canaux | Bot dans Slack (messages privés, mentions, accords dans le fil) | PARTIEL | `native/` (outils et déclencheurs Slack) | Canal complet (déjà dans `docs/COUVERTURE.md`) | L |
| Canaux | Bot dans Telegram | FAIT | `telegram.ts:52` ; test `wave2.test.ts` | Sklubot seulement | — |
| Canaux | Rejoindre une réunion (Meet), notes en direct | MANQUANT | `meetings.ts:33` (transcrire un enregistrement envoyé) | Présence en réunion (service ou comptes développeur) | L |
| Canaux | API par bot (clé, message, réponse) | FAIT | `botapi.ts:365` ; test `bot-api.test.ts` | — | — |
| Canaux | Serveur MCP pour piloter l'équipe depuis Claude Desktop ou Cursor | FAIT | `botmcp.ts:40`, `teammcp.ts` ; test `team-mcp.test.ts` | — | — |
| Canaux | Commande sans écran pour scripts et CI (`run`, `wait`, `export`, `team apply`) | MANQUANT | `desk-cli.ts:15` (outil de test du bureau) | — | M |

### Fichiers, pages, médias

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fichiers | Remettre un fichier dans la discussion ; erreur claire si le fichier manque | FAIT | outils `file_save`, `file_send` (`agent/tools.ts:355`) ; test `features.test.ts` | — | — |
| Fichiers | Bibliothèque de fichiers du bot | FAIT | `routes.ts:1674` ; test `wave5b-files.test.ts` † | — | — |
| Fichiers | Fichiers d'équipe partagés, avec « qui a changé quoi » | PARTIEL | `agent/prompt.ts:112` (dossier `~/team`) ; test `team-disk.test.ts` | Historique des changements | S |
| Pages | Publier une page à un lien, versions, retrait | FAIT | `pageroutes.ts:22`, outils `page_publish`, `page_edit` ; test `pages-artifacts.test.ts` | — | — |
| Pages | Publier un site sur le compte Netlify de l'utilisateur | MANQUANT | — | — | M |
| Médias | Créer une image | FAIT | `images.ts:10`, outil `image_generate` ; test `features.test.ts` | — | — |
| Médias | Modifier une image, images de référence, plafond d'images par jour | PARTIEL | `images.ts` | Modification et plafond quotidien | S |
| Médias | Vidéos jointes lues par le modèle (images extraites) | FAIT | outil `video_frames`, `media.ts` ; test `media-tools.test.ts` | — | — |
| Thèmes | Le bot change l'apparence de l'appli (couleurs, polices, CSS), 30 retours en arrière, raccourci de secours | MANQUANT | `web/src/store.ts:76` (clair / sombre / système) | — | M |

### Accords et sécurité

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Accords | Niveaux d'accès par bot et par discussion (Demander, Modifications, Auto, Complet) | FAIT | `shared.ts:61` (careful, balanced, trusted, auto), `agent/authorize.ts:28` ; test `floor-autonomy.test.ts` | Niveau par discussion : `agent/conversationgrants.ts` (ajouté pendant l'audit) | — |
| Accords | Nouveau bot en « Accès complet » par défaut | DIFFÉRENT | `store.ts:219` : « careful » par défaut | Beaucoup plus de cartes ; plus sûr, mais le bot « ne fait pas » | S |
| Accords | Cartes Autoriser / Refuser dans la discussion | FAIT | `agent/loop.ts:1803`, `web/src/components/Cards.tsx` ; test `wave5.test.ts` | — | — |
| Accords | « Toujours autoriser » lié à une action exacte, liste de taille fixe | PARTIEL | `agent/loop.ts:1868` (decideApproval « always ») | Taille maximale de la liste non vérifiée | S |
| Accords | Une carte posée dans le chat de la personne n'expire pas | MANQUANT | `config.ts:191` (25 min) | — | S |
| Accords | Une ligne tapée n'annule jamais une carte en attente | MANQUANT | `agent/loop.ts:1739` (supersede) | Le message devrait attendre ou passer à côté | S |
| Accords | Changer le niveau pendant que le bot travaille | PARTIEL | `routes.ts:657` | Effet sur le tour en cours non vérifié | S |
| Accords | Le niveau d'un chef couvre le travail qu'il délègue ; rien venu de l'extérieur ne monte un niveau | PARTIEL | `agent/turn-request.ts:35` (startsTainted) | Règle de niveau hérité explicite | M |
| Accords | Contenu de page, mail, webhook = information, jamais un ordre | FAIT | `agent/prompt.ts:159`, `agent/loop.ts:1293` (taintGuard) ; test `security.test.ts` | — | — |
| Accords | Action faite une seule fois ; résultat « incertain » jamais rejoué | FAIT | `agent/executions.ts:15` ; test `failures.test.ts` | — | — |
| Accords | Journal des décisions | FAIT | `journal.ts`, `agent/loop.ts:1626` ; test `migrations.test.ts` † | — | — |
| Sécurité | Coffre : identifiants, secrets, import de fichier | FAIT | `store.ts:854`, `vault-import.ts`, `web/src/components/VaultSection.tsx` ; test `wave3.test.ts` | — | — |
| Sécurité | Le bot demande un secret sur une carte sécurisée, par son nom, jamais dans le chat | FAIT | outils `secret_request`, `secret_use` ; test `wave3.test.ts` | — | — |
| Sécurité | Carte « Utiliser un secret déjà enregistré » | MANQUANT | — | — | S |
| Sécurité | Coffre 1Password ou Bitwarden relié en direct | MANQUANT | `vault-import.ts:10` (import d'un fichier seulement) | — | M |
| Sécurité | Valeurs du coffre masquées dans le chat, les résultats d'outils et les journaux | FAIT | `store.ts:854` (redactSecrets), `agent/loop.ts:1734` ; test `security.test.ts` † | — | — |
| Sécurité | Secret collé dans le chat : détecté et mis au coffre | FAIT | `pastedsecrets.ts`, `routes.ts:1044` ; test `security-fixes.test.ts` † | Sklubot seulement | — |
| Sécurité | Boîte étanche autour du moteur (bubblewrap, seccomp, courtier d'identifiants) | DIFFÉRENT | chaque bot dans son conteneur Docker, `dockerproxy.ts:21`, `egress.ts:40` ; test `dockerproxy.test.ts` | Rien de perdu | — |
| Sécurité | Double authentification, sessions, appareils | FAIT | `twofactor.ts:155` ; test `totp.test.ts` | — | — |
| Sécurité | Relais téléphone chiffré de bout en bout | MANQUANT | `relay.ts` (déjà dans `docs/COUVERTURE.md`) | — | L |

### Fiabilité

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Fiabilité | Avis « pas encore de réponse » après 20 s, avec « Changer d'IA » | FAIT | `agent/watch.ts:112`, `config.ts:132` ; test `watch.test.ts` (lancé) | — | — |
| Fiabilité | Tour muet arrêté ; une commande qui consomme du processeur n'est pas « muette » | FAIT | `agent/watch.ts:14-33`, `config.ts:133` ; test `watch.test.ts` | Sklubot demande avant d'arrêter (avis à 5 min) | — |
| Fiabilité | Moteur dont le processus a disparu : tour terminé tout de suite avec un message clair | FAIT | `agent/loop.ts:762-768` (EngineGone) ; test `engine-finish.test.ts` (lancé, 4/4) | — | — |
| Fiabilité | Nouveaux essais avec attente, puis modèle de secours | FAIT | `agent/loop.ts:1010-1027`, `agent/reliability.ts:18`, `:40` ; test `wave4.test.ts` | — | — |
| Fiabilité | Le secours doit savoir faire la même chose (mêmes outils, même dossier) | MANQUANT | `agent/reliability.ts:18` (modelChain : seulement « configuré ») | Vérifier que le secours accepte outils et images | S |
| Fiabilité | Limite d'abonnement : le secours prend le relais, retour au moteur d'origine après la remise à zéro, un seul avis | FAIT | `agent/sublimit.ts:219`, `agent/loop.ts:666` ; test `sublimit.test.ts` | — | — |
| Fiabilité | Jamais deux comptes du même abonnement pour contourner une limite | FAIT | `agent/reliability.ts:18` (secours = modèles API) | Par construction | — |
| Fiabilité | Session du moteur perdue : discussion reconstruite depuis le chat, et c'est dit | MANQUANT | `agent/engine.ts:847`, `:936` : nouvelle session avec le seul dernier message, sans avis | Reconstruction + ligne d'information | M |
| Fiabilité | Rejouer un message seulement si le moteur ne l'avait pas accepté | PARTIEL | `agent/engine.ts:935` (Codex : rien produit), `agent/loop.ts:1678` (drapeau « acted ») ; test `codex-retry.test.ts` (lancé, 6/6) | Claude Code : pas de test « rien produit » avant de rejouer | S |
| Fiabilité | Garde anti-boucle | DIFFÉRENT | `agent/reliability.ts:87` (LoopGuard : 4 fois = arrêt) ; test `wave4.test.ts` | OpenMausBot signale sans arrêter. Rien de perdu | — |
| Fiabilité | Tour arrêté par une limite : reprise automatique tant qu'il avance, arrêt après 2 reprises sans progrès | PARTIEL | `agent/loop.ts:1143-1157` : bouton « Continuer » (routine : une fois toute seule) | Reprise automatique avec mesure du progrès | M |
| Fiabilité | Fichier de passation écrit quand un tour finit sans réponse | PARTIEL | `agent/loop.ts:513-531` (note au modèle de secours) | Pas de fichier pour les reprises | S |
| Fiabilité | Redémarrage : tour coupé relancé une fois, jamais s'il avait déjà agi vers l'extérieur | FAIT | `agent/loop.ts:1678-1704` ; test `engine-queue.test.ts` | — | — |
| Fiabilité | Redémarrage : une question en attente reste posée | PARTIEL | `agent/loop.ts:1781` | Les accords des bots sur abonnement sont perdus au redémarrage | M |
| Fiabilité | Erreur que rien n'a attrapée : tour arrêté, ou serveur arrêté proprement puis relancé ; plus de 10 erreurs = relance | PARTIEL | `index.ts:129-130` : l'erreur est écrite, le serveur continue | Risque de continuer dans un état abîmé | M |
| Fiabilité | Arrêt propre du serveur | FAIT | `index.ts:146-147` ; test `deploy.test.ts` † | — | — |
| Fiabilité | Panne causée par le serveur lui-même (disque plein, plus de mémoire, connexion expirée) : pas de relance inutile | PARTIEL | `failuretypes.ts:12` (11 classes), `agent/loop.ts:753` (disque) ; test `failures.test.ts` | Classe « faute du serveur » qui interdit la relance | S |
| Fiabilité | Le réglage qui répare est posé sur la ligne d'erreur | PARTIEL | `agent/failures.ts:342` (carte avec remèdes), `web/src/components/Incidents.tsx` | Sélecteur de modèle directement dans la ligne | S |
| Fiabilité | Coupe-circuit quand un fournisseur tombe pour plusieurs bots | FAIT | `agent/failures.ts:38` (BREAKER_BOTS) ; test `failures.test.ts` | Sklubot seulement | — |
| Fiabilité | Cache du modèle : moitié stable et moitié variable, liste d'outils identique à chaque tour | PARTIEL | `llm/anthropic.ts:88` (une seule marque de cache), `agent/prompt.ts:205-221` (parties variables dedans) | Séparer le variable ; marquer aussi les messages | M |
| Fiabilité | Garder le cache chaud entre deux tours | MANQUANT | — | — | S |
| Fiabilité | Gros résultat d'outil rangé dans un fichier | FAIT | `agent/tools.ts:166` (spillIfLong), `agent/context.ts` ; test `wave10-context.test.ts` | — | — |
| Fiabilité | Résumé automatique à 80 % de la fenêtre | FAIT | `agent/loop.ts:1125`, `config.ts:165` ; test `wave10-context.test.ts` | — | — |
| Fiabilité | Sentinelle : détecteurs, incidents, alertes | FAIT | `sentinel/detectors.ts`, `agent/failureroutes.ts` ; test `sentinel.test.ts` | — | — |
| Fiabilité | Commande de diagnostic qui répare | PARTIEL | `health.ts:125`, `monitor.ts:110`, `backupcheck.ts` | Réparation automatique | M |
| Fiabilité | Plafonds de consommation (jour, mois, par bot) | FAIT | `usagecaps.ts:220` ; test `usage-caps.test.ts` | — | — |
| Fiabilité | Sauvegarde et restauration | FAIT | `autobackup.ts:101`, `backuparchive.ts` ; test `backup-drill.test.ts` | — | — |
| Fiabilité | Un seul serveur à la fois sur le dossier de données | MANQUANT | — | — | S |

### Réglages, accueil, applis, service

| Domaine | Fonction d'OpenMausBot | État | Preuve dans Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Accueil | Accueil : relier une IA, premier bot qui liste ce qui reste à faire et le fait avec toi | PARTIEL | `web/src/components/Onboarding.tsx:77` (5 étapes), `publicsignup.ts:417` | Liste « reste à faire » tenue par le bot principal | M |
| Accueil | Venir de Grok Bot : import | FAIT | `grokimport.ts:50`, `web/src/components/GrokImport.tsx` ; test `grok-import.test.ts` | — | — |
| Accueil | Annonces et « Quoi de neuf » | FAIT | `announcements.ts`, `web/src/components/AnnouncementsView.tsx` ; test `announcements.test.ts` | — | — |
| Accueil | Page « Aujourd'hui » | FAIT | `today.ts:43`, `web/src/components/TodayView.tsx` ; test `today.test.ts` | — | — |
| Accueil | Boîte de réception unique (« À toi », « Pour info », « Fait ») | PARTIEL | `web/src/components/TodayView.tsx`, `TasksView.tsx` † | Boîte à trois onglets où répondre répond au bot | M |
| Réglages | Clés enregistrées une fois, jamais réaffichées, rechargées à chaud | FAIT | `web/src/components/SecretsFilesProviders.tsx`, `datakey.ts` ; test `data-key.test.ts` | — | — |
| Réglages | Moteurs sur abonnement : Claude Code, Codex | FAIT | `agent/engine.ts:784`, `:873` ; test `engine-queue.test.ts` | — | — |
| Réglages | Autres moteurs (Grok CLI, Gemini, Cursor, OpenCode, Qwen…) par le protocole ACP | MANQUANT | `agent/engine.ts:16` (deux moteurs) | — | L |
| Réglages | Fournisseurs compatibles OpenAI, OpenRouter, modèles locaux | FAIT | `llm/openai-compat.ts`, `openrouter.ts`, `apimodels.ts:222` ; test `openrouter.test.ts` | Ollama non vérifié | — |
| Réglages | Modèle d'aide (petit, pas cher) pour les titres, le tri, la mémoire | PARTIEL | `agent/roomroutes.ts:11` (modèle rapide pour les groupes), `agent/memory.ts:17` | Un réglage commun | S |
| Réglages | Mise à jour automatique des moteurs et du catalogue de modèles | PARTIEL | `agent/engine.ts:92-141` (catalogue Codex relu) | Mise à jour des outils eux-mêmes | S |
| Réglages | 16 langues d'interface | PARTIEL | `shared.ts:146` (fr, en) | 14 langues | M |
| Réglages | Statistiques d'usage anonymes envoyées à l'éditeur | NON REPRIS | — | Vie privée | — |
| Réglages | Signaler un bug à l'équipe MausBot (`@devs`) | NON REPRIS | — | Leur service. « Signaler à l'opérateur » reste à faire (`docs/COUVERTURE.md`) | — |
| Applis | Appli de bureau | FAIT | `companion/` ; test `phone.test.ts` † | — | — |
| Applis | Mise à jour automatique de l'appli de bureau | MANQUANT | `companion/LISEZMOI.md:154` (laissée de côté exprès) | — | S |
| Applis | Appli Android | FAIT | `android/`, `.github/workflows/android.yml` | — | — |
| Applis | Appli iOS | MANQUANT | — (compte Apple Developer nécessaire) | — | L |
| Applis | Notifications appli fermée | PARTIEL | `push.ts:184` (Web Push) ; test `wave3.test.ts` | APNs / FCM natifs | M |
| Applis | Web installable sur téléphone | FAIT | `web/public/sw.js` ; `web/scripts/check-responsive.mjs` | — | — |
| Applis | Associer un téléphone par QR ; plusieurs serveurs dans une appli | PARTIEL | `sign-in-link.ts`, `emaillink.ts` | QR et plusieurs serveurs | M |
| Service | Offre hébergée, plans, crédits | DIFFÉRENT | `hosted.ts`, `credits.ts`, `billing/paddle.ts` ; test `hosted.test.ts` | Offre propre à Sklubot | — |
| Service | MausBot Cloud (leur service) et ses écrans d'achat | NON REPRIS | — | Leur service commercial | — |
| Service | Dossier `enterprise/` (administration d'entreprise, bibliothèque d'organisation, budgets sous licence) | NON REPRIS | — | Licence non libre | — |
| Service | Connexion à « OpenMaus Admin » pour les modèles de l'entreprise | NON REPRIS | — | Leur service | — |
| Service | Offres de sponsors (ModelGo, Boat) dans l'interface | NON REPRIS | — | Publicité | — |
| Service | Blocs de code repris de T3 Code, Cache Tax, Hermes | NON REPRIS | — | Méthode « idées seulement » | — |
| Service | Équipe à plusieurs personnes : audiences, rôles, bots partagés | PARTIEL | `workspaces.ts:70`, `botaccessroutes.ts` ; test `wave6-workspaces.test.ts` | Boîte de réception par personne, « l'assistant répond pour toi » | L |
| Service | Liste des personnes dans la barre latérale et dans les @mentions | MANQUANT | `web/src/components/ComposerMentions.tsx` (bots et applis) | — | M |
| Service | Journal d'activité d'administration | FAIT | `journal.ts`, `hostedroutes.ts` ; test `hosted.test.ts` † | — | — |

## 3. Écarts de comportement, parcours par parcours

« OMB » = OpenMausBot (chemins relatifs à son dépôt). « SK » = Sklubot (chemins relatifs à `server/src/`).

### 3.1 Premier message à un bot

- **OMB.** Le bot est créé d'un clic, en Accès complet (`docs/approval-levels.md`, lignes 22-29). Son IA par défaut est une IA qui a répondu à un message de test (`server/tested-ai.ts`). Le prompt système est assemblé par un seul constructeur (`server/system-prompt.ts:89`) : identité, règles de tous les bots, instructions du bot, puis des sections ; il sort deux moitiés, « stable » et « variable » (`:49`, `:109-112`). Il finit toujours par 8 règles de conversation (`server/reply-habits.ts:3`) : une ligne avant un travail long, répondre d'abord, s'arrêter quand c'est fini, regarder avant de demander, ne jamais nommer les outils. En Accès complet s'ajoute : « ne t'arrête pas pour demander de confirmer ; trouve, prends un choix raisonnable, dis-le en une ligne » (`:277`). Si rien n'arrive en 20 s : avis avec « Changer d'IA » (`server/first-reply-rescue.ts:11`).
- **SK.** Le message entre dans la file du bot (`agent/loop.ts:362`, `:216`), puis `runScopedTurn` (`:548`). Le prompt (`agent/prompt.ts:82`) fait environ 45 puces dans « How you work », puis le profil, l'équipe, les routines, les règles, les souvenirs, les compétences, un long paragraphe de consignes créatives (`:236`), les guides, les instructions du bot **à la fin**. Avis à 20 s présent (`agent/watch.ts:112`).
- **Écarts.**
  1. Bot « careful » par défaut (`store.ts:219`) : dès la première action sensible, une carte.
  2. Le prompt impose `user_quote` (`agent/prompt.ts:156`) : le modèle doit recopier les mots exacts de l'utilisateur, sinon carte. Aucune règle de ce genre chez OMB.
  3. Les instructions propres au bot arrivent après 200 lignes de consignes générales ; chez OMB elles sont en 3e position, avant tout ce qui nomme un outil.
  4. Pas de règle « regarde avant de demander » ni « une seule question ».
- **Correctifs.** (a) Nouveau bot en « balanced » avec un choix clair à l'accueil. (b) Remonter les instructions du bot juste après l'identité. (c) Ajouter 6 à 8 règles de conversation courtes à la fin du prompt. (d) Sortir du prompt système ce qui change à chaque tour.

### 3.2 Le bot utilise son ordinateur sur un lien, sans qu'on le lui dise

- **OMB.** Pas de consigne spéciale « ouvre les liens ». Le bot a un vrai Chrome (`server/browser/prompt.ts:7`). `agent_browser_open` renvoie directement l'arbre de la page avec des références (`e12`). Chaque action répond par ce qu'elle a fait apparaître ou disparaître, la page atteinte, l'onglet ouvert. Le résultat peut finir par « Page reported… » : requêtes en échec, erreurs, CAPTCHA (alors `request_sign_in`, jamais de tentative). Outils en plus : onglets, retour, attente d'un texte, alertes, envoi de fichier, état des téléchargements. Chaque étape est gardée comme preuve (`server/browser-evidence.ts`). Un seul appel à la fois par navigateur (`server/browser-lane.ts`).
- **SK.** Sklubot est **plus explicite** : consigne dans le prompt (`agent/prompt.ts:54-66`) et rappel dans le tour quand le message de l'utilisateur contient un lien public (`agent/links.ts:40-58`). Testé (`test/links.test.ts`, 8/8).
- **Points faibles de SK.**
  1. `browser_open` renvoie une **capture d'écran** (`agent/tools.ts:149-152`) ; il faut `page_read` puis `element_snapshot` pour lire et agir. Trois appels là où OMB en fait un.
  2. Chaque clic, frappe ou défilement renvoie une capture (`agent/tools.ts:170-200`) : le modèle regarde des pixels pour savoir si ça a marché.
  3. Pas d'onglets, pas de retour arrière, pas d'attente, pas de gestion des alertes, pas d'envoi de fichier dans un formulaire.
  4. Bots sur abonnement : le rappel de lien n'existe que si le tour a l'outil `browser_open` (`agent/links.ts:57`), et Claude Code garde `WebFetch` et `WebSearch` (`agent/engine.ts:796`). Le modèle peut lire la page hors de vue malgré la consigne. Aucun test ne prouve que le vrai moteur ouvre le navigateur.
  5. Après avoir lu une page, le tour est « contaminé » : plus de cartes ensuite (`agent/loop.ts:1293`). Un tour sur abonnement l'est dès le départ (`agent/loop.ts:645`).
- **Correctifs.** (a) `browser_open` et `element_click` renvoient texte + liste d'éléments + « ce qui a changé » ; capture seulement à la demande ou si la page n'a pas d'arbre. (b) Ajouter onglets, retour, attendre, alerte, envoi de fichier. (c) Bots sur abonnement : retirer `WebFetch` quand le navigateur du bot est prêt, ou vérifier après coup que le lien a été ouvert à l'écran. (d) Un test de bout en bout avec le vrai bureau.

### 3.3 Longue tâche qui échoue au milieu puis reprend

- **OMB.** Un registre unique (`docs/runtime-contract.md`, `server/runtime/`) suit chaque travail. Un tour coupé par une limite se remet en file tout seul, avec « pourquoi et où en sont les étapes » ; deux reprises de suite sans appel d'outil réussi, ou la même erreur trois fois : arrêt « bloqué » (§6). Un fichier de passation est écrit (`server/turn-continuation.ts:27`). Seule une limite dépassée fait reprendre : une erreur du fournisseur ne relance pas (`:86`). Si la session du moteur est perdue, la discussion est reconstruite (`server/context-rebuild.ts`) et une ligne le dit (`server/resume-recovery.ts:44`). Rejouer n'est permis que si le moteur n'avait rien accepté (`:16-22`).
- **SK.** Nouveaux essais avec attente (`agent/loop.ts:1010`), modèle de secours (`:1018`), réponse coupée recousue (`:1051`), limite de 60 étapes puis bouton « Continuer » (`:1156`), 60 min sur abonnement puis « Continuer » (`:759`), avis de blocage à 5 min, garde anti-boucle, coordinateur d'échecs (`agent/failures.ts:342`). Tests : `failures.test.ts`, `watch.test.ts`, `codex-retry.test.ts` passent.
- **Écarts.**
  1. **Session perdue** : `agent/engine.ts:847` (Claude Code) et `:936` (Codex) relancent avec le seul message courant. Le bot oublie tout, l'utilisateur n'est pas prévenu. Le secours vers un modèle API reçoit, lui, les 10 derniers messages (`agent/loop.ts:520`) : la reprise sur le même moteur est donc moins bonne que le secours.
  2. Limite d'étapes ou de temps : SK attend un clic ; OMB reprend seul tant que ça avance.
  3. Coût : chaque étape renvoie tout l'historique sans cache (`llm/anthropic.ts:88`), captures comprises.
  4. Pas de fichier de passation.
- **Correctifs.** (a) À la perte de session : envoyer les derniers messages et étapes comme dans `engineFallback`, et afficher une ligne. (b) Reprise automatique bornée par le progrès (2 reprises sans outil réussi = arrêt avec carte). (c) Marque de cache sur le dernier message.

### 3.4 Accords

- **OMB.** Accès complet par défaut. Les seules demandes sont celles du moteur lui-même (`server/permission-proxy.ts`), affichées en cartes. OMB n'ajoute aucun accord à lui ; chaque changement qu'un bot fait à sa configuration s'applique tout de suite avec « Annuler » (`server/direct-apply.ts`). Une liste noire de commandes reste (`server/safety-floor.ts`). Une carte dans le chat de la personne n'a pas d'horloge ; un travail délégué attend 3 jours avec un rappel par jour (`docs/runtime-contract.md` §6). Une ligne tapée ne répond jamais à une carte (§2). 👍 / 👎 répondent. Au redémarrage, la question reste posée (§5).
- **SK.** `judge` (`agent/loop.ts:1314`) puis `authorize.ts` : bot « careful » = toujours demander ; « balanced » / « trusted » = la citation des mots de l'utilisateur est vérifiée ; « auto » = un modèle relecteur ; un socle qui demande toujours (paiements, suppressions). Exécution unique et « incertain » (`agent/executions.ts`). C'est plus riche et plus sûr qu'OMB.
- **Ce qui gêne.**
  1. Trop de cartes par défaut.
  2. Écrire au bot annule l'accord en attente (`agent/loop.ts:1739-1753`).
  3. Les accords expirent en 25 min (`config.ts:191`) ; ceux des bots sur abonnement sont perdus au redémarrage (`agent/loop.ts:1781`).
  4. La réaction 👍 ne répond à une carte que dans Telegram (`telegram.ts:184`).
  5. Bots sur abonnement : Claude Code tourne en `bypassPermissions` dans son ordinateur (`agent/engine.ts:795`) pendant que les outils Sklubot du même tour demandent tout, puisque le tour est « contaminé » dès le départ (`agent/loop.ts:645`). L'utilisateur voit un bot qui fait mille choses sans demander, puis s'arrête pour une broutille.
- **Correctifs.** (a) Défaut « balanced ». (b) Un nouveau message pendant une carte : le garder en attente et laisser la carte ouverte (bouton « Laisser tomber » à part). (c) Pas d'expiration pour une carte dans le chat du propriétaire, ou une relance « toujours d'actualité ? ». (d) 👍 / 👎 sur la carte dans l'appli web. (e) Une ligne avec « Annuler » pour les changements réversibles (profil, compétence, routine en pause).

### 3.5 Mémoire apprise puis rappelée

- **OMB.** Fichiers lisibles (`MEMORY.md`, `memory/<sujet>.md`, `docs/memory.md`). Capture après les tours par un modèle d'aide (`server/memory-capture.ts`), rangement, « rêve » sur plusieurs discussions (`server/memory-dream.ts`). Le rappel est placé **devant le message**, jamais dans le prompt système, 6 000 caractères au plus, marqueurs neutralisés (`server/recall.ts:29`). Journal hors de portée du bot (`server/memory-journal.ts`). Un fait retiré n'est jamais rajouté (`server/profile-learned.ts`).
- **SK.** `memory_save`, consolidation au repos (`agent/memory.ts:310`), choix des souvenirs par mots communs dans le prompt système (`agent/prompt.ts:17`, 4 000 caractères), rappel BM25 ajouté pendant l'audit (`agent/recall.ts:229`), statuts contesté / confirmé, sujets sensibles. Bon niveau.
- **Écarts.** (1) Le rappel est dans le prompt système, donc le cache saute dès que les mots de l'utilisateur changent. (2) Mots-clés seulement : « ma voiture » ne retrouve pas « la Clio ». (3) Pas de liste « ne plus jamais retenir ». (4) Une consolidation attend que la discussion soit calme : un fait dit juste avant une longue tâche peut manquer au tour suivant.
- **Correctifs.** Placer le rappel devant le message ; garder la trace des faits oubliés.

### 3.6 Une routine se déclenche

- **OMB.** Chaque exécution travaille dans une discussion cachée ; seul le dernier message est posté, sous le nom de l'automatisation (`server/automation-reports.ts`). « NOTHING NEW » : rien n'est posté. « NEEDS INPUT: » : question dans le chat (`server/system-prompt.ts:306`). Rien ne tombe au milieu de ta discussion : le message attend la fin de la réponse en cours. Rattrapage : la plus récente si elle a moins de 12 h, départs étalés de 15 s (`server/routine-catch-up.ts:16`). Un échec relance une fois, sauf blocage, arrêt demandé, refus, plafond ou faute du serveur (`server/routine-recovery.ts`). Trois échecs de suite : exécutions espacées d'1 h puis 4 h, **jamais coupées** (`server/routine-failure-spacing.ts:23`). Exécution dont le tour a disparu depuis 5 min : relancée ou mise en échec (`server/routine-run-watch.ts:8`).
- **SK.** La routine est un tour ordinaire du bot dans le fil principal (`agent/turn-request.ts:31`). Retard dit au bot (`scheduler.ts:126-129`). Rattrapage sur 24 h (`:184`). « Rien de neuf » sans appel au modèle (`:98-139`), ce qu'OMB ne fait que pour ses routines à vérifications. Échec : ligne dans le chat, notification après N, **pause automatique** après plus (`:249-261`).
- **Écarts.**
  1. Les étapes de la routine s'affichent dans la discussion et entrent dans son contexte : résumés plus fréquents, coût en hausse.
  2. Pendant la routine, le bot ne répond pas à l'utilisateur (une seule file).
  3. Une routine en pause après des échecs ne repart pas seule.
  4. Pas d'étalement des départs après une coupure.
- **Correctifs.** (a) Faire tourner la routine dans un fil (le mécanisme existe) et ne poster que le résultat avec « Voir l'exécution ». (b) Remplacer la pause automatique par un espacement. (c) Étaler les rattrapages.

### 3.7 Discussion de groupe avec plusieurs bots

- **OMB.** Chaque membre garde sa session. Qui répond : @mention, bot principal, tous, ou Auto (un petit modèle en quelques centaines de millisecondes, qui retombe sur le principal s'il est éteint ou hésite : `docs/decision-model.md`). Les messages envoyés pendant qu'un bot répond restent hors du fil (`server/channel-queue.ts`). « stop @Bot » le met en attente, gardé après redémarrage (`server/room-holds.ts`). Limite de silence par membre (`server/room-turn-timeout.ts`). Un bot qui finit sans réponse est relancé une fois. Budget de messages (`server/room-post-budget.ts`).
- **SK.** `agent/roomrouting.ts` : choix rapide, mode « offre d'abord », mode discret, 30 choix par minute ; `agent/roombudget.ts` contre les boucles. Tests : 16/16.
- **Écarts.** Pas de « stop @Bot », pas de limite de temps propre au groupe, pas de repli des notes de travail, pas de message unique pour une même demande à plusieurs membres. Chaque membre n'ayant qu'une file, un membre occupé ailleurs fait attendre le groupe.

### 3.8 Appel vocal

- **OMB.** Deux modes. « À tour de rôle » : un seul parle à la fois. « Live » : une voix (GPT-Live) parle à la place du bot ; chaque demande part au bot comme un message « via l'appel », la voix lit la réponse ; toutes les 30 s la voix sait que le bot travaille encore ; un « oui » ou « non » net répond à une demande d'accord, décidé par le serveur (« ok » seul ne compte pas) ; une fiche de l'appel reste dans le chat ; fin après 5 min de silence (`docs/voice-mode.md`, `server/live-call.ts`).
- **SK.** Tout auto-hébergé : micro vers le serveur, whisper.cpp, Piper / Kokoro / Fish, détection de parole, coupure de parole (`voice/session.ts:133`), consigne « dit à voix haute » (`agent/turn-request.ts:68`), résumé d'appel (`calls.ts:40`). Avantage SK : aucune clé nécessaire.
- **Écarts.** Pas d'accord à la voix, pas de « je travaille encore », reconnexion et choix du micro manquants côté web (`docs/COUVERTURE.md`).

### 3.9 Livraison d'un fichier ou d'une page

- **OMB.** `attach_file` signale un fichier manquant ; le prompt interdit de coller un chemin comme lien (`server/system-prompt.ts:143`). Page au lien MausBot (5 Mo, 200 fichiers), site sur Netlify avec jeton au coffre, lien vérifié avant d'être annoncé.
- **SK.** `file_save`, `file_send`, `artifact_create`, `page_publish` avec versions, `file_public_link`. Équivalent. Manquent : Netlify, vérification du lien avant de l'annoncer (non trouvée), « montrer du doigt » une partie de page.

### 3.10 Accueil d'un nouvel utilisateur

- **OMB.** Si une IA marche déjà, aucune étape ; sinon « Relier une IA ». Premier bot : MausBot, chef de cabinet, dont le premier message liste ce qui reste à faire et le fait avec toi (`server/initial-greeting.ts`, `server/helper-followup.ts`). Mode Simple par défaut.
- **SK.** `web/src/components/Onboarding.tsx:77` : comment payer, notifications, équipe, nom, idées (un texte posé dans le composeur). Inscription publique complète (`publicsignup.ts`).
- **Écarts.** Pas de liste « reste à faire » tenue par le bot, pas de test de l'IA avant le premier message, pas de mode Simple.

### 3.11 Erreur du moteur ou du fournisseur

- **OMB.** Erreurs à clé traduite (`server/user-errors.ts`, plus de 60 avis). Le réglage qui répare est sur la ligne (`src/components/FailedTurnFix.tsx`). Limite : le secours continue, retour au moteur d'origine après la remise à zéro, un avis par période (`server/limit-failover.ts`, `server/limit-notices.ts`). Le secours doit avoir les mêmes outils et le même dossier (`server/automatic-recovery.ts:24`). Une faute du serveur n'est jamais relancée (`server/host-fault.ts`).
- **SK.** 11 classes (`failuretypes.ts:12`), décision pure et testée (`agent/failures.ts:146`), une carte avec remèdes, coupe-circuit, entraide, attente de la remise à zéro (`agent/sublimit.ts`). **Niveau comparable, parfois meilleur.**
- **Écarts.** (1) Aucune vérification que le modèle de secours accepte outils et images. (2) Pas de classe « faute du serveur ». (3) Le réglage n'est pas dans la ligne. (4) `index.ts:129` : une erreur non attrapée est seulement écrite.

### 3.12 Redémarrage pendant le travail

- **OMB.** Tableau de règles (`docs/runtime-contract.md` §5) : en file = repart ; en cours sans action extérieure = une relance avec « vérifie ce qui est déjà fait » ; en cours après un envoi ou un paiement = pas de relance, c'est dit ; en attente de la personne = reste posé. Erreur grave : sortie propre puis relance (`server/crash-guard.ts`). Un seul serveur sur les données (`server/data-dir-lease.ts`).
- **SK.** `agent/loop.ts:1678-1733` : file rejouée dans l'ordre, tour coupé repris selon le drapeau « acted », ligne « Le serveur a redémarré ». Proche d'OMB, testé (`engine-queue.test.ts`).
- **Écarts.** (1) Accords des bots sur abonnement perdus (`agent/loop.ts:1781`). (2) Pas de verrou sur le dossier de données. (3) Pas de sortie propre après une erreur grave.

### 3.13 Écrire au bot pendant qu'il travaille

- **OMB.** Le message attend dans une file visible sous le composeur, modifiable, et survit à Stop (`server/steer-queue.ts`). Les moteurs qui le permettent le reçoivent en cours de tour. Le prompt dit : « quand la personne écrit pendant que tu travailles, réponds-lui d'abord » (`server/system-prompt.ts:288`).
- **SK.** Modèles API : le message est injecté à l'étape suivante (`agent/loop.ts:398`, `:1074`). Abonnement : il attend la fin du tour, jusqu'à 60 min (`:827`). Si une carte attend : elle est annulée (3.4). Aucun test trouvé pour `drainSteering`.
- **Correctifs.** File visible ; règle « réponds d'abord » ; pour Claude Code, envoi en cours de tour (entrée en flux) à étudier avec la documentation officielle.

### 3.14 Limite d'usage de l'abonnement

- **OMB.** Lit l'usage du plan, connaît l'heure de remise à zéro, prévient une fois, bascule sur le secours, revient ensuite ; une routine arrêtée par la limite repart une minute après (`server/limit-resets.ts`, `server/limit-failover.ts`).
- **SK.** `agent/sublimit.ts` : mêmes idées, testées. Équivalent.

## 4. À faire, du plus utile au moins utile

> **Mise à jour du 2026-11-22 (chantier « cœur : fiabilité »).** Les lignes marquées ✅ sont faites et testées (`server/test/core-reliability.test.ts`, `core-engine.test.ts`, `core-timeouts.test.ts`) ; « en partie » dit ce qui reste. Détail dans `docs/COUVERTURE.md`, section « Cœur : fiabilité ».

1. ✅ **Fait (2026-11-22).** **Ne plus annuler un accord quand l'utilisateur écrit** : la carte reste ouverte, le message est gardé et traité après la réponse ; un « oui » tapé ne vaut jamais accord (`agent/approval-wait.ts`, `agent/loop.ts`). S
2. ✅ **Fait (2026-11-22).** **Session du moteur perdue** : la nouvelle session reçoit les derniers messages gardés (30 au plus, 12 000 caractères au plus) et une ligne le dit dans le chat, pour Claude Code et Codex (`agent/session-rebuild.ts`). M Suite (2026-11-22) : Claude Code 2.1.330 écrit « session introuvable » dans `errors` et non plus dans `result` ; la session perdue est maintenant reconnue par sa forme (`error_during_execution`, aucun tour, pas d'`init`), sinon elle n'était jamais rouverte (`agent/engine-failure.ts`).
3. **Routines dans un fil à part**, seul le résultat dans le chat, avec « Voir l'exécution ». M
4. **Navigateur en texte** : `browser_open` et les clics renvoient la structure de la page et ce qui a changé ; capture à la demande. M
5. **Défaut « balanced »** pour les nouveaux bots, avec un choix clair à l'accueil. S
6. ✅ Fait (2026-11-22, `llm/cachelayout.ts`). **Cache du modèle** : sortir du prompt système les souvenirs, routines et équipe ; marquer le dernier message. M
7. ✅ **Fait en partie (2026-11-22).** **Cartes sans expiration** dans le chat du propriétaire : fait (modèles API : la carte attend sans horloge ; abonnement : la demande est « mise de côté » après 25 min et sa réponse compte toujours). Reste : 👍 / 👎 pour y répondre dans l'appli web. S
8. ✅ (2026-11-22, L99) **Plusieurs tours en parallèle par bot** (fils indépendants), pour qu'une routine ou un collègue ne bloque plus la discussion. L
9. **Reprise automatique bornée par le progrès** après la limite d'étapes ou de temps. M
10. **Outils de navigateur manquants** : onglets, retour, attendre un texte, alertes, envoi de fichier. M
11. **Règles de conversation** à la fin du prompt, et instructions du bot remontées en tête. S
12. **Bots sur abonnement et liens** : retirer `WebFetch` quand le navigateur est prêt, et un test avec le vrai bureau. S
13. ✅ **Fait (2026-11-22).** **Erreur non attrapée** : le tour concerné est arrêté, sa file est libérée, l'échec passe par le coordinateur d'échecs et une carte s'affiche ; le serveur et les autres bots continuent (`agent/crashguard.ts`, `index.ts`). M
14. **Échecs de routine** : espacer au lieu de mettre en pause. S
15. **File d'attente visible** des messages envoyés pendant le travail ; test de `drainSteering` (✅ le test existe depuis le 2026-11-22 : `core-reliability.test.ts`, point 6 ; la file visible reste à faire). M
16. **Accords à la voix** pendant un appel, et « je travaille encore » toutes les 30 s. M
17. ✅ **Fait (2026-11-22).** **Accords des bots sur abonnement gardés au redémarrage** : la demande est gardée en base (table `parked_approvals`), la carte reste ouverte, et un « oui » relance l'action exacte, une seule fois. Ce qui ne peut pas reprendre (relais d'identifiants, API de bot, membre d'équipe) expire avec un bouton « Relancer ». M
18. **Vérifier que le modèle de secours accepte outils et images** avant de basculer. S
19. **Changements réversibles appliqués avec « Annuler »** (profil, compétence, routine en pause) au lieu d'une carte. M
20. **Modifier un message / branches.** M
21. **Copier, épingler, exporter, réessayer** sur un message. S
22. **« stop @Bot »** dans un groupe, gardé après redémarrage. S
23. **Rappel de mémoire devant le message**, et liste des faits oubliés. S
24. ✅ **Fait en partie (2026-11-22).** **Identifiant d'envoi** contre les doublons : fait, web et mobile (`server/src/sendkeys.ts`, `mobile/shared/sendKey.ts`). Reste : **Stop qui vise un tour**. S
25. **Résumé à chaud** pendant le repos de la discussion. M
26. **Résultat d'un clic « envoyé mais non confirmé »**. S
27. **Deuxième avis sur un autre modèle**. M
28. **« Burst »** en lots parallèles. M
29. **`check_back` / `wait_until`** dans la même discussion. M
30. ✅ **Fait (2026-11-22).** **Classe « faute du serveur »** (`server_fault`) qui interdit la relance : outils Sklubot non joints au moteur, mémoire / fichiers / base pleins (codes d'erreur, pas de phrases) ; une carte, jamais de nouvel essai ni de passage à un collègue (`agent/failures.ts`). S
31. **Réglage qui répare dans la ligne d'erreur.** S
32. **Étalement des rattrapages** de routines. S
33. **Test de l'IA avant de la proposer par défaut.** M
34. **Premier bot qui liste et fait ce qui reste à installer.** M
35. **Widgets** : boutons et formulaires préremplis. M
36. **Chef par département**, relance du fil d'un collègue. M
37. **File d'attente annoncée** pour un ordinateur partagé, avec reprise automatique. S
38. **Thèmes créés par le bot.** M
39. **Publication Netlify.** M
40. **Coffre 1Password / Bitwarden en direct.** M
41. **Autres moteurs par ACP.** L
42. **Commande sans écran pour scripts et CI.** M
43. **Preuves d'étapes de navigateur.** M
44. **Boîte de réception à trois onglets.** M
45. **Style « conversationnel »**, modèle par fil, modèle par routine. S
46. **Note vocale envoyée par le bot.** S
47. ✅ **Fait (2026-11-22, L50).** **Verrou « un seul serveur »** sur le dossier de données : `DATA_DIR/server.lock`, 2e serveur refusé avec un message en français, verrou abandonné repris tout seul (`server/src/datalock.ts`, test `data-lock.test.ts`). S
48. **Sélection d'outils un par un** et pont `find_tool` / `use_tool`. M
49. **Autres langues.** M
50. Le reste des lignes PARTIEL / MANQUANT du tableau (aperçu de lien, citation, avatar image, apprentissage automatique de compétences, rêve, mémoire d'équipe, Android par USB, étapes rejouées, rejoindre une réunion, appli iOS, liste des personnes…), dans l'ordre du tableau.

## 5. Non vérifié

- **Rien n'a tourné en vrai.** OpenMausBot n'a pas été lancé : son comportement est décrit d'après son code, ses documents et ses commentaires. Ses 1 171 fichiers de test n'ont pas été lus.
- **Sklubot en conditions réelles** : aucun tour avec un vrai modèle, un vrai Claude Code ou Codex, un vrai bureau Docker. Les tests lancés utilisent des doubles : `links` (8/8), `watch` (14/14), `failures` (16/16), `engine-finish` (4/4), `codex-retry` (6/6), `room-routing` (16/16). Les autres tests sont cités par leur nom, pas lancés. `live.test.ts`, `desk.test.ts` et `linux.test.ts` (vrai matériel) non lancés.
- **Lignes marquées †** : preuve par recherche de mots et en-tête de fichier.
- **Trous dans la lecture d'OpenMausBot** : `server/index.ts` (15 283 lignes) lu par extraits ; dossiers `electron/`, `cloudflare/`, `connector/`, `relay/`, `packages/phone-protocol/`, `evals/`, `skills/` non ouverts ; `docs/cloud-pro.md`, `docs/team-cloud.md`, `docs/self-hosting.md`, `docs/composio.md`, `docs/custom-mcp-servers.md`, `docs/ios-companion.md`, `docs/phone-push.md`, `docs/analytics.md` survolés. Les fonctions d'équipe sur leur cloud sont donc résumées, pas détaillées. Le contenu exact d'`enterprise/LICENSE` n'a pas été lu (seulement `LICENSING.md`).
- **Numéros de ligne d'OpenMausBot** : sûrs pour `system-prompt.ts`, `first-reply-rescue.ts`, `resume-recovery.ts`, `turn-continuation.ts`, `routine-catch-up.ts`, `routine-failure-spacing.ts`, `routine-run-watch.ts`, `automatic-recovery.ts`, `recall.ts`, `reply-habits.ts`, `browser/prompt.ts` ; ailleurs seul le fichier est cité.
- **Côté Sklubot, pas vérifié** : la puce de consommation dans l'en-tête ; le Bearer et la rotation des webhooks ; les limites mémoire / processeur par ordinateur de bot ; le détail de `native/access.ts` ; la fin d'appel après silence ; `agent/conversationgrants.ts` et `agent/recall.ts`, arrivés pendant l'audit.
- **Coût réel du cache** (écart n° 8) : déduit du code de `llm/anthropic.ts`, pas mesuré sur une facture. Le chemin `llm/openai-compat.ts` n'a pas été relu pour le cache.
- **Applis mobiles et de bureau de Sklubot** (`mobile/`, `android/`, `companion/`) : présence constatée, code non relu.
