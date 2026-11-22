# Audit de DS-Bot (Fei2411/DS-Bot) face à Sklubot

Étude faite le 22/11/2026, en lecture seule. Dépôt lu : `https://github.com/Fei2411/DS-Bot`, commit `d104d9c` (version 0.3.10 du 22/11/2026, 1 136 fichiers dont 419 de tests). Sklubot lu dans `/home/user/grok-sklubs` au commit `fcad7de` **plus l'arbre de travail non commité** (d'autres sessions y écrivent en ce moment : par exemple `PassageComment.tsx`, `ChatExport.tsx`, `SidebarStatus.tsx` sont encore non suivis par git ; je les compte « PARTIEL (en cours) », jamais « FAIT »). Rien n'a été modifié dans Sklubot. Aucun code de DS-Bot n'a été lancé.

## Ce qu'est DS-Bot

**Ce n'est ni un bot Discord, ni un outil de science des données.** « DS » veut dire **DeepSeek** : DS-Bot est une **équipe de bots IA à vie longue** construite sur **DeepSeek Harness (DSH)**, l'agent open source de DeepSeek. Il existe en trois formes : greffon (plugin) de DSH, application de bureau (Electron, Windows / macOS / Linux, avec son propre DSH) et image Docker (NAS, serveur). Il y a aussi une appli mobile (Expo) reliée par un lien chiffré de bout en bout, et un « navigateur distant ».

En clair, c'est **le produit le plus proche de Sklubot** parmi tous les dépôts étudiés : des bots avec nom, rôle, modèle, mémoire et ordinateur ; un **bot principal « Chief »** qui crée les autres et les groupes ; des **groupes de bots** avec un admin, un objectif par étapes et un tableau des tâches ; des tâches planifiées et des tâches de fond ; un navigateur par bot ; le pilotage de l'ordinateur de l'utilisateur ; des messageries (Slack, Discord, Telegram, WeChat, QQ, Feishu, DingTalk, WeCom) ; des connecteurs (GitHub, mails, MCP) ; un coffre de secrets ; la page d'usage ; des agents CLI locaux (Claude Code, Codex, Cursor…) branchés comme bots. Différence de fond : **DS-Bot tourne sur l'ordinateur de l'utilisateur, pour une seule personne** ; Sklubot est un **service (hébergé ou auto-hébergé), multi-comptes**, où chaque bot a **son propre ordinateur Linux isolé**.

## Licence

- Fichier `LICENSE` (racine, identique à `ds-bot/LICENSE`) : **Apache License, Version 2.0, January 2004**. Fichier `NOTICE` : « DS Bot — Copyright 2026 Fei2411 and the DS Bot contributors — licensed under the Apache License, Version 2.0 ».
- Ce que ça permet : **copier, modifier et vendre le code, y compris dans un produit commercial fermé**, à condition de **garder le texte de la licence**, de **reprendre le `NOTICE`** (les parties qui concernent le code repris), de **signaler dans chaque fichier modifié qu'il a été modifié**, et de **ne pas utiliser les marques** (« DS Bot », « DeepSeek », logos, mascottes). Brevet : licence de brevet accordée, perdue si on attaque en brevet.
- Décision du propriétaire (22/11/2026, `docs/audits/A-FAIRE.md` § « Décisions prises ») : MIT / Apache = **reprise directe avec attribution**. Donc chaque ligne « À faire » ci-dessous est marquée **REUSE** (fichiers amont nommés) ou **IDÉE**.
- Attention à la chaîne d'attribution : une partie de DS-Bot vient elle-même d'autres projets (voir `NOTICE`) : **dsh-im** (MIT, xmanrui) pour les adaptateurs Telegram / Discord / Slack / WeChat et le découpage Markdown (`ds-bot/src/host/im/format.js`) ; **DeepSeek Harness** (MIT) pour la compétence Office et des scripts ; **DSH Remote** (MIT) pour le lien téléphone (`link/`). Reprendre ces fichiers = garder **les deux** mentions (DS-Bot Apache + l'amont MIT). Sklubot cite déjà DeepSeek Harness (MIT) dans `server/src/jobs.ts:13`, `server/src/agent/context.ts:9-19`, `server/src/agent/goals.ts:23`.
- À ne jamais reprendre : le nom, les logos, les 20 personnages / mascottes (`src/client/characters.js`), les logos d'agents (`agent-logos.js`, marques de tiers), le logo DeepSeek dessiné dans `mobile/src/ui/icons.tsx`, et le texte « sponsor » du README.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | **53** |
| PARTIEL | **61** |
| MANQUANT | **30** |
| DIFFÉRENT | **18** |
| NON REPRIS | **5** (plus 3 exclusions regroupées en section 4) |
| Non vérifié | 7 |
| **Total des lignes** | **174** |

Remarque honnête : `docs/audits/A-FAIRE.md` est **en retard sur le code** à plusieurs endroits (exemples vérifiés : L85 « reçu » marqué À FAIRE mais `server/src/agent/receipt.ts` existe et est branché dans `agent/loop.ts:21` ; L168 « mises à jour automatiques » marqué À FAIRE mais `deploy/auto-update.sh` + `test/auto-update.test.ts` existent ; L181 « import depuis Claude Code / Codex » marqué À FAIRE mais `server/src/localimport.ts` existe). J'ai donc jugé **le code**, pas la liste.

Test lancé pour lever un doute : `npx tsx --test test/channels-discord.test.ts test/channels-slack.test.ts` → **12 / 12 réussis** (les canaux Discord et Slack du jour marchent au moins sur faux serveur).

---

## 1. Tableau complet des fonctions

Taille : **S** ≤ 1 jour, **M** 2 à 4 jours, **L** 1 à 2 semaines. Chemins DS-Bot relatifs à la racine du dépôt amont ; chemins Sklubot relatifs à `/home/user/grok-sklubs`.

### 1.1 Discussion

| # | Fonction DS-Bot | Statut | Preuve Sklubot (fichier:ligne, test) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 1 | Un bot = une conversation continue, à vie longue | FAIT | `server/src/agent/loop.ts` (historique par bot, `store.ts history`) ; test `core-engine.test.ts` | — | — |
| 2 | Consigne « une phrase de réponse avant le premier outil, dans la même réponse ; jamais finir sur une promesse » (`ds-bot/src/host/prompt.js:15`) | PARTIEL | règle de point d'étape dans `server/src/agent/prompt.ts` ; renvoi au travail `agent/promises.ts` (test `turn-guards.test.ts`) | Pas la règle « phrase + outil dans la même réponse » ; L55 encore partiel | S |
| 3 | Règles d'équipe dans le prompt : pas de merci ni d'écho de statut entre bots, réponse à un bot en liste de faits, « pas encore discuté » au lieu d'inventer (`prompt.js:9-14`) | PARTIEL | `agent/prompt.ts` (règles d'équipe courtes) ; budget anti-écho `agent/roombudget.ts` | Pas « réponds à un bot par une liste de faits », ni « dis "pas encore discuté" » | S |
| 4 | `ask_user` : carte de choix qui finit le tour | FAIT | `agent/richquestion.ts`, `agent/loop.ts:1611` (`WAITS_FOR_USER`) ; test `turn-cards.test.ts` | — | — |
| 5 | `show_view` : graphique, chiffres clés, tableau, calculatrice à formules locales, progression, confirmation, petit formulaire, HTML isolé, **dans la réponse** (`ds-bot/src/host/tools.js`, `src/client/widget-cell.js`) | MANQUANT | aucune vue de ce type ; `artifact_create` (`agent/pagetools.ts:91`) fait une page à part ; `docs/COUVERTURE.md` « Graphiques, mini-applis… Manquant » | Vues riches dans le fil du chat | M |
| 6 | Vues et cartes aussi dans un groupe (choix listés seulement) | MANQUANT | — | dépend de #5 | S |
| 7 | `/side` : discussion à côté depuis un instantané, sans outils, avec questions de suite | PARTIEL | `agent/sidequestion.ts` (`/btw`, `/apres`) ; test `turn-control.test.ts` | Une seule question : pas de fil de suites dans un panneau | S |
| 8 | Message tapé pendant le travail lu à l'étape suivante | FAIT | `agent/steering.ts:12-18` (notes gardées sur disque) ; test `turn-control.test.ts` | — | — |
| 9 | Message à un bot occupé : le travail en cours passe **en tâche de fond** et le chat répond tout de suite (`CHANGELOG` 0.3.10 « Messages to a busy Bot », `ds-bot/src/host/bot-tasks.js`) | DIFFÉRENT | la note est **ajoutée au tour en cours** (`agent/steering.ts`) ; 3 tâches parallèles (`agent/lanes.ts`, test `lanes.test.ts`) | L'utilisateur attend la fin du tour pour une question sans rapport | M |
| 10 | Commande shell lente qui passe en tâche de fond après un délai **réglable par l'utilisateur** | PARTIEL | `server/src/jobs.ts:8-20` (promotion automatique, idée DSH MIT) | Délai fixe côté serveur, pas de réglage « Travail en arrière-plan » | S |
| 11 | Tâches de fond `task_start / task_send / task_stop / task_list / task_read` | PARTIEL | `agent/bgtasks.ts:170-172` (start, list, stop) ; test `lanes.test.ts` | Pas de `task_send` (relance d'une tâche) ni `task_read` (long résultat) | S |
| 12 | Îlot d'en-tête : progression, accords à donner, arrêt des tâches | PARTIEL | `web/src/components/TaskLanes.tsx` | Accords des tâches de fond pas réunis dans l'îlot | S |
| 13 | Sélection de texte → « Citer » / « Annoter », envoyé avec la citation | PARTIEL | `web/src/components/PassageComment.tsx` **non suivi par git (en cours)** | À vérifier une fois commité (L140) | S |
| 14 | Pastille de lecture d'une longue réponse (retour au début, titre de la section, menu des titres) | MANQUANT | — | — | S |
| 15 | Long collage replié en carte dans la zone de saisie | MANQUANT | rien trouvé dans `web/src/components/Composer.tsx` | — | S |
| 16 | Brouillon non envoyé (texte, images, fichiers) gardé par discussion | MANQUANT | rien dans `Composer.tsx` | — | S |
| 17 | Menu `/` des commandes du bot | FAIT | `web/src/components/ComposerSlash.tsx` | — | — |
| 18 | `@` avec liste des membres | FAIT | `web/src/components/ComposerMentions.tsx` | — | — |
| 19 | « + → Référencer une conversation » : joindre le chat d'un autre bot comme contexte | MANQUANT | — | — | S |
| 20 | Préférence de la touche Entrée (envoyer ou saut de ligne) | NON VÉRIFIÉ | L58 parle d'Entrée / Ctrl+Entrée, rien trouvé dans `Composer.tsx` | — | S |
| 21 | Temps de réflexion exact d'un tour (`ds-bot/src/host/thinking.js`) | MANQUANT | — | — | S |
| 22 | Échec de tour expliqué par **code stable** avec correctifs (clé absente, refusée, solde, connexion) ; « Réessayer » qui **attend le correctif** pour une erreur de clé (`src/client/turn-error.js:27-60`) | PARTIEL | classes structurées `agent/engine-failure.ts` (test `engine-structured.test.ts`), cartes `agent/failures.ts`, « Réessayer maintenant » `failures.ts:517` | Filtre de contenu (403 « audit ») **pas distingué** d'une clé refusée ; identifiant de requête pas montré (COUVERTURE « Partiel ») | S |
| 23 | Réponse coupée : note claire, et détection d'une route à fenêtre plus petite (sortie < 1/8 du budget alors que l'entrée le remplit, `turns.js:283-291`) | PARTIEL | `agent/loop.ts:1021-1030` (coupure par la limite de sortie : avis + message au bot) | Pas la détection « fenêtre réelle plus petite que déclarée » | S |
| 24 | Notification système (bot fini ou carte en attente) sans voler le focus, clic = ouvre la discussion | PARTIEL | `web/src/lib/notify.ts:67` | Règles « seulement si absent / si long » (L151) | S |
| 25 | Barre latérale : accords et questions en attente par bot, groupe et section repliée | PARTIEL | `web/src/components/SidebarStatus.tsx` **non suivi par git (en cours)** | À vérifier une fois commité | S |
| 26 | « Ça t'attend » : toutes les cartes en attente | FAIT | `web/src/components/InboxView.tsx:61` ; test `turn-cards.test.ts` | — | — |
| 27 | Recherche dans une discussion / un groupe | FAIT | `web/src/components/FindBar.tsx`, `server/src/convsearch.ts` ; test `memory-context.test.ts` | — | — |
| 28 | Une erreur d'affichage dans un dialogue ferme seulement ce dialogue | NON VÉRIFIÉ | — | — | S |
| 29 | Cartes réglées (`ask_user`, `show_view`) dépliables en lecture seule | PARTIEL | `TurnCards.tsx` montre la réponse | Pas de dépli « toutes les options » | S |
| 30 | Liens vers fichiers dans la réponse : ouvrent l'aperçu, même écrits en `code` | PARTIEL | `file_send` (`agent/tools.ts:297`), aperçus `attachmentpreviews.ts` | Lien Markdown vers un chemin du bot pas transformé en aperçu | S |

### 1.2 Bots et équipe

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 31 | Bot principal « Chief » présent au départ, qui guide la mise en place | DIFFÉRENT | `web/src/components/Onboarding.tsx`, recrutement `agent/recruit.ts` | Sklubot guide par un écran, pas par un bot chef | — |
| 32 | Monter l'équipe et les groupes en une phrase au chef | FAIT | `bot_create` `agent/tools-team.ts:208`, `room_create` ; test `recruiter.test.ts` | — | — |
| 33 | Plusieurs bots principaux ; droits : principal / admin de groupe / membre | PARTIEL | « lead » d'un salon = 1ᵉʳ membre (`agent/roomrouting.ts:33`) | Pas de rôle « principal » qui modifie / arrête les autres ; pas d'admin de groupe distinct | M |
| 34 | `stop_bot` : le chef arrête le tour d'un autre bot en disant pourquoi | MANQUANT | « stop » tapé en cascade existe (`agent/stopcommand.ts`) mais pas d'outil pour un bot | — | S |
| 35 | `update_bot` : un bot change ses propres nom, rôle, couleur, modèle, réflexion, dossier, consignes | PARTIEL | `self_update` (`agent/tools.ts`) | Modèle et niveau de réflexion par le bot lui-même non vérifiés | S |
| 36 | Modèle et niveau de réflexion par bot | FAIT | `agent/loop.ts:928` (`effort: bot.effort`) | — | — |
| 37 | Page « modèles de l'équipe » (tous les bots d'un coup) | FAIT | `web/src/components/TeamModels.tsx` | — | — |
| 38 | Modèle par défaut de l'équipe pour les nouveaux bots | NON VÉRIFIÉ | — | — | S |
| 39 | Modèle retiré → retour au dernier modèle qui marchait ; groupe aussi | PARTIEL | santé du modèle `server/src/modelhealth.ts` (test `lot2-model-health.test.ts`) | Bascule automatique au dernier modèle qui marchait pas trouvée | S |
| 40 | Dossier de travail par bot et par groupe | DIFFÉRENT | chaque bot a **son ordinateur** (`server/src/linux.ts`) | Rien de perdu : l'isolation est plus forte | — |
| 41 | Préréglage de permissions (Lecture seule / Espace / Accès complet) ; **même préréglage pour tout un groupe** | PARTIEL | autonomie par bot (`server/src/botdefaults.ts`, « Équilibré ») ; test `floor-autonomy.test.ts` | Pas de réglage « même chose pour tous les membres de ce groupe » | S |
| 42 | **Bot privé** : aucun autre bot ne lit son chat ni sa mémoire ; ses messages sortants et écritures hors dossier sous accord ; dossier protégé après suppression | PARTIEL | isolation par conteneur et mémoire par bot | Pas de drapeau « privé » qui met `bot_message` / `room_post` sous accord et l'exclut des groupes | M |
| 43 | Avatars : 20 personnages, 12 couleurs, **photo** importée, bibliothèque réutilisable | PARTIEL | `web/src/components/Character.tsx`, `CharacterEditor.tsx` | Photo / bibliothèque d'images (COUVERTURE « Manquant ») | S |
| 44 | Sections repliables de bots et groupes, épingles dans la barre latérale | PARTIEL | sections citées par `server/src/pauses.ts:5` | Épingler, sections par travail (L146) | S |
| 45 | **Agents locaux** : Claude Code, Codex, Cursor, Gemini CLI, Copilot, OpenCode… sur l'ordinateur de l'utilisateur, par ACP / JSON-RPC (`ds-bot/src/host/local-agents/*.js`) | PARTIEL | Claude Code et Codex **dans l'ordinateur du bot** (`agent/engine.ts`), `desk-cli.ts` | Pas d'ACP, pas d'agent sur l'ordinateur de l'utilisateur via le Relais (L172) | L |
| 46 | Pont MCP stdio : l'agent CLI garde les outils d'équipe | FAIT | `agent/engine.ts:802-812` (`--mcp-config`) ; test `engine-structured.test.ts` | — | — |
| 47 | Packs chargés à la demande (`use_pack` / `drop_pack`) ; outils d'admin retirés aux bots ordinaires | FAIT | `server/src/llm/toolsearch.ts` ; test `lot2-cache-tools.test.ts` | — | — |
| 48 | Réglage par capacité : « Toujours / Au catalogue / Désactivé » | PARTIEL | portées des compétences (`server/src/skillhealth.ts`, test `skill-health.test.ts`) | Pas pour les serveurs MCP | S |
| 49 | **Manuel intégré** : compétence `ds-bot-manual` (12 fiches) que le bot lit avant d'expliquer ou de changer un réglage | MANQUANT | rien de tel dans `server/skills-library` | Un « manuel de Sklubot » lu par le bot | S |
| 50 | Rapport de bug **rédigé par le bot**, publié seulement après carte d'accord (`report-ds-bot-issue`, `issue-report.js`) | PARTIEL | « Signaler un problème » par l'utilisateur (`server/src/reports.ts`, test `message-reports.test.ts`) | Le bot ne prépare pas le rapport (erreur masquée, étapes, version) | S |
| 51 | Statistiques en direct dans le panneau du bot ; historique des parties | PARTIEL | `DetailsPanel.tsx`, `HistoryViewer.tsx` | Statistiques en direct | S |
| 52 | Accueil d'un nouveau bot qui échoue sans bloquer l'équipe | NON VÉRIFIÉ | — | — | S |

### 1.3 Groupes

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 53 | Mode « l'admin répond d'abord » | DIFFÉRENT | mode « auto » : un petit modèle choisit, sinon le « lead » (`agent/roomrouting.ts:13-35`) ; test `room-routing.test.ts` | — | — |
| 54 | Mode « tout le monde, dans l'ordre » | MANQUANT | — | Utile pour un tour de table | S |
| 55 | Plusieurs `@` dans un message → travail en parallèle | FAIT | `wakeInRoom(…, [bots])` (`agent/team.ts`) | — | — |
| 56 | `[PASS]` : un membre sans rien de neuf se tait | FAIT | `stay_quiet` (`agent/tools.ts:1224`) | — | — |
| 57 | Une session cachée par membre et par groupe : le groupe ne lit jamais le chat privé | DIFFÉRENT | le salon est un enregistrement à part (`kind: "room"`) | — | — |
| 58 | **Mémoire de groupe** (lue seulement dans ce groupe) | MANQUANT | aucune mémoire de salon (`grep` vide) | — | M |
| 59 | Objectif par étapes : alignement (« goal-grill »), tâches par étape, preuve vérifiée avant d'avancer, réveil de l'admin si rien ne tourne | FAIT | « Chantier » `server/src/chantiers.ts`, `chantierrunner.ts`, `chantierchecks.ts` ; test `chantier.test.ts` | — | — |
| 60 | Tableau des tâches du groupe (qui fait quoi) | PARTIEL | tâches du chantier ; `task_add` par bot | Pas de tableau pour un salon ordinaire | S |
| 61 | Liste à cocher partagée du groupe | PARTIEL | idem | — | S |
| 62 | Lignes « fichiers modifiés » par membre, avec revue des différences en ligne | MANQUANT | `PeerReview.tsx` est une relecture entre bots, pas une liste de changements | — | M |
| 63 | **Marque de vérification** : réponse qui lie un fichier absent, ou qui annonce un travail alors que rien ne tourne (`ds-bot/src/host/claims.js`) | PARTIEL | reçu « dit mais pas fait » `agent/receipt.ts:1-7` | Lien vers fichier absent ; « je suis en train de… » sans rien qui tourne | S |
| 64 | Journal du groupe en ajout seul (`ledger.js`) | DIFFÉRENT | lignes SQLite (`store.ts rows`) | — | — |
| 65 | Passations imbriquées : la réponse remonte seulement quand tout ce qui a été confié dessous est revenu (`handoffs.js`) | PARTIEL | `bot_message` réponse plus tard ou `wait` (`agent/tools.ts:1025`) | Pas d'attente « tous les sous-travaux revenus » | M |
| 66 | `request_id` : une demande nommée n'est livrée qu'une fois, même répétée sur plusieurs tours (`requests.js`) | PARTIEL | `agent/sameaction.ts` (dans un tour) ; test `turn-guards.test.ts` | Entre plusieurs tours ou après une perte de réponse | S |
| 67 | `reply_to: "user"` : chaque bot répond lui-même à l'utilisateur dans son chat | MANQUANT | — | — | S |
| 68 | Poster dans un groupe depuis l'extérieur | FAIT | `room_post` (`agent/tools.ts:1118`) | — | — |
| 69 | Passer la main à un autre membre, visible par tous | FAIT | `room_handoff` (`agent/tools-room.ts`) ; test `roombudget.test.ts` | — | — |
| 70 | Accords d'outils des membres (sessions cachées) répondus depuis le chat du groupe | PARTIEL | cartes dans la discussion du bot ; « À toi » | Pas montrées dans le groupe | S |
| 71 | Message arrivé pendant la clôture d'un tour de groupe mis en file, pas perdu | NON VÉRIFIÉ | — | — | S |

### 1.4 Longues conversations

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 72 | Seuil lié à la fenêtre du modèle **et plafonné à 380 000 jetons** pour garder le cache du fournisseur (`steward.js:9-30`) | PARTIEL | dans un tour : 80 % de la fenêtre (`agent/context.ts:13`) ; entre tours : **300 000 caractères fixes** (`server/src/config.ts:160`) | Pas de plafond (fenêtre de 1 M chez DeepSeek = compactage à 800 k) ; seuil entre tours sans lien avec le modèle | S |
| 73 | « Gardien du contexte » : choisit entre condenser sur place et ouvrir une **nouvelle partie** avec note de passation | DIFFÉRENT | résumé unique `agent/memory.ts:107` | — | — |
| 74 | Point de contrôle qui garde **les messages de l'utilisateur mot pour mot** à côté du résumé | PARTIEL | garde les 4 derniers tours (`config.ts:182`), le reste est résumé | Les anciens messages de l'utilisateur sont paraphrasés | S |
| 75 | Anciennes parties cherchables (FTS5) avec ancres | FAIT | `server/src/convsearch.ts` ; test `memory-context.test.ts` | — | — |
| 76 | Tout appel « hors journal » (résumés, gardien, lecture d'images) compté dans l'usage | FAIT | `record()` (`server/src/usage.ts`) appelé par `context.ts`, `roomrouting.ts` | — | — |

### 1.5 Mémoire

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 77 | Revue au repos par le modèle : **garder, modifier ou retirer** des notes | PARTIEL | `agent/memory.ts:221` `consolidate`, `:445` `learningDue` ; test `memory-fixes.test.ts` | Sklubot ajoute et confirme ; il ne modifie ni ne retire tout seul (carte de contradiction seulement) | S |
| 78 | Trois portées : bot, groupe, équipe | PARTIEL | bot + « Fiche sur moi » partagée (`agent/promptview.ts:52`) | Groupe (#58) ; équipe distincte de la fiche | M |
| 79 | Format Markdown lisible (`MEMORY.md` + sujets `[[topic]]`) | DIFFÉRENT | notes en base, avec citation des mots de l'utilisateur (`shared.ts:477`) | — | — |
| 80 | Place limitée dans le prompt, trop-plein vers « earlier » sans jamais échouer | DIFFÉRENT | N notes montrées, le reste par `memory_search` (`agent/promptview.ts`) | — | — |
| 81 | **Épingle** : une note que l'automatique ne touche jamais | MANQUANT | `Memory` n'a pas de champ épingle (`shared.ts:477`) | — | S |
| 82 | **Date de fin** (`until`) après laquelle la note disparaît du prompt | MANQUANT | idem | — | S |
| 83 | Journal de chaque changement, annulation en 2 clics tant que la note n'a pas rebougé | PARTIEL | `memory_history` (`agent/memorybook.ts:20`), corbeille 30 jours | Pas de liste « annuler ce changement » | S |
| 84 | **Rangement quotidien** (doublons fusionnés, fini archivé, ≤ 1/5 des notes), annulable d'un bloc (`memory-tidy.js`) | MANQUANT | — | (L70) | M |
| 85 | Résumé en prose de toute la mémoire, refait quand elle change | MANQUANT | — | — | S |
| 86 | « Demander ou corriger » la mémoire depuis le panneau (un appel modèle sur les notes seules, mêmes contrôles) | MANQUANT | — | — | S |
| 87 | Déplacer une note vers l'équipe, un autre bot ou un groupe | PARTIEL | « Ajouter à ma fiche » (`memoryviewroutes.ts`) | — | S |
| 88 | Ligne « Mémoire mise à jour » dans le chat, qui ouvre le panneau | MANQUANT | rien trouvé | — | S |
| 89 | Refus des clés, mots de passe, numéros d'identité | FAIT | `agent/memory.ts:215`, `agent/memorybook.ts:62` ; test `memory-fixes.test.ts` | — | — |
| 90 | « La mémoire est une donnée » ; ne rien retenir de ce qu'une page demande | FAIT | seulement les mots de l'utilisateur (`agent/memory.ts:258`) | — | — |
| 91 | Rappel automatique de notes en message séparé (le cache tient) | FAIT | `agent/recall.ts`, `llm/cachelayout.ts` ; test `lot2-cache-tools.test.ts` | — | — |
| 92 | Lire la mémoire d'un autre bot (public) sur demande | MANQUANT | — | Faible valeur | S |
| 93 | Mémoire archivée (pas effacée) à la suppression d'un bot ou d'un groupe | NON VÉRIFIÉ | — | — | S |
| 94 | Mémoire coupée entièrement par un réglage | FAIT | « Ne rien retenir » `agent/memoryprefs.ts` | — | — |

### 1.6 Apprendre du travail

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 95 | Passe de fond (équipe au repos, au plus toutes les quelques heures) qui propose une compétence ou une règle de projet, en carte | PARTIEL | `skill_propose` (`agent/tools.ts:720`) et `rule_propose` (`agent/ruletools.ts`) lancés par le bot | Pas de passe de fond sur plusieurs conversations (L131) | M |
| 96 | Idées refusées mémorisées : la même ne revient pas (`learning.js:1-6`) | MANQUANT | rien trouvé | — | S |
| 97 | Bancs avec vrai modèle (gardien du contexte, apprentissage) | PARTIEL | `bench-memory-recall-fr.test.ts`, `bench-pr-review.test.ts` | Pas de banc pour le résumé | S |

### 1.7 Navigateur

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 98 | Navigateur isolé par bot, connexions gardées | FAIT | navigateur dans l'ordinateur du bot (`server/src/computer.ts`) | — | — |
| 99 | Lecture de la page en Markdown, références `[#n]`, Shadow DOM, iframes même origine, invisible ignoré | FAIT | `agent/elements.ts`, `server/src/screen-elements.ts` ; test `browser-text.test.ts` | — | — |
| 100 | Iframes d'un autre site signalées par une ligne | PARTIEL | L14 : signalées, pas lues | — | M |
| 101 | Jamais la valeur des champs mot de passe, carte, code à usage unique | PARTIEL | valeur relue masquée pour un mot de passe (`screen-elements.ts:391`) | Champs carte (`cc-*`) et code SMS non vérifiés | S |
| 102 | Limites annoncées (taille, nœuds, temps) ; « résultat coupé » dit | PARTIEL | relevé limité | Phrase « coupé à N » non vérifiée | S |
| 103 | Clic classé par ses mots : paiement → main rendue ; publication → accord | FAIT | `agent/bind.ts:10-24` (contrôle sous le point, jugé et lié au site) ; test `browser-tabs.test.ts` | — | — |
| 104 | **Suppression en 2 temps** : 1ᵉʳ clic refusé avec instantané, 2ᵉ clic avec `confirm` sur le même élément marqué d'un jeton (`browser/session.js:681-690`) | MANQUANT | une carte d'accord, pas cette vérification d'élément | — | S |
| 105 | Écriture incertaine (POST vu après le clic) jamais refaite à l'aveugle | FAIT | L74 « envoyé mais non confirmé » ; test `browser-text.test.ts` | — | — |
| 106 | Téléchargements sous accord, capturés dans l'action qui les lance | MANQUANT | L75 « reste : téléchargements » | — | S |
| 107 | Retour arrière (`browser_back`) | MANQUANT | L75 | — | S |
| 108 | Envoi de fichier limité à des dossiers permis | FAIT | `element_upload` (`agent/tools-elements.ts`) | — | — |
| 109 | Autorisations d'actions **bot × site × actions × durée** | PARTIEL | « pour cette conversation / toujours » limité au même domaine (`agent/scopedkeys.ts`) ; test `security-lot1.test.ts` | Pas de durée ni de liste d'actions par site | S |
| 110 | Passer la main (connexion, captcha, paiement) et reprendre | FAIT | `ask_takeover` (`agent/tools.ts:1166`), `server/src/takeover.ts` | — | — |
| 111 | `browser_task` : un sous-agent navigateur qui rend réponse + étapes | PARTIEL | assistants `helper_start` (`agent/tools.ts:1064`) | Pas spécialisé navigateur | M |
| 112 | Script de plusieurs actions en un appel | FAIT | `run_steps` (`agent/tools-steps.ts`) | — | — |
| 113 | Import de cookies depuis les navigateurs de l'utilisateur ou un fichier | NON REPRIS | — | Exclu par `A-FAIRE.md` § 4 (copie de sessions personnelles) | — |
| 114 | localhost / réseau local permis, métadonnées cloud refusées | DIFFÉRENT | `server/src/net.ts` `assertPublicUrl` refuse aussi le réseau local (normal pour un serveur) | — | — |

### 1.8 Ordinateur de l'utilisateur

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 115 | Niveaux par bot : voir seulement / arrière-plan / premier plan (`computer/catalog.js:89-94`) | MANQUANT | outils `my_*` (`agent/mycomputer.ts`) sans niveau par bot | — | M |
| 116 | Applis autorisées par bot | PARTIEL | liste « garder à l'écart » (`server/src/relayguard.ts`) ; test `relay-guard.test.ts` | Liste blanche par bot | S |
| 117 | Applis protégées jamais données (réglages, gestionnaires de mots de passe) | FAIT | `server/src/relayguard.ts` ; test `relay-guard.test.ts` | — | — |
| 118 | Une appli / la souris à un seul bot à la fois (baux, `computer/leases.js`) | MANQUANT | L161 « file annoncée pour un ordinateur partagé » | — | S |
| 119 | Barre en haut quand un bot travaille, pause / prise en main | PARTIEL | compagnon Electron (`companion/src/main/main.js`) | Barre visible + pause non vérifiées | S |
| 120 | Outil inconnu = premier plan (refus par défaut) ; enregistrement et rejeu d'écran entier refusés | DIFFÉRENT | refus par défaut dans `relayguard.ts` | — | — |

### 1.9 Messageries

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 121 | Slack (Socket Mode) | FAIT | `server/src/slack.ts` ; test `channels-slack.test.ts` (passé) | — | — |
| 122 | Discord (Gateway, jeton de bot officiel) | FAIT | `server/src/discord.ts:1-25` ; test `channels-discord.test.ts` (passé) | — | — |
| 123 | Telegram | FAIT | `server/src/telegram.ts`, `telegramplus.ts` ; test `channels-telegram.test.ts` | — | — |
| 124 | **Groupes de messagerie** : `@bot` dans un salon Slack / serveur Discord / groupe Telegram relié à un groupe de bots | MANQUANT | messages privés seulement (`docs/CANAUX.md:24`, `:28`) | — | M |
| 125 | Cartes (question, formulaire, choix multiple) dans la messagerie ; réponse par numéro ou `!card <code>` où il n'y a pas de boutons ; carte périmée refusée | PARTIEL | boutons ✅ / ❌ d'accord (`discord.ts:316`) | Questions et formulaires ; réponse par numéro | S |
| 126 | Accord « en course » : la 1ʳᵉ réponse gagne, l'autre carte se retire (`approvals.js:1-5`) | PARTIEL | `answerApproval` (`server/src/channelrelay.ts`) ; « Tu as déjà répondu » (`i18n.ts:603`) | Retrait du bouton sur Slack / Discord quand on répond dans l'appli : non vérifié | S |
| 127 | Envoi raté gardé pour un renvoi à la main ; seuls les morceaux non livrés relancés | MANQUANT | L76 « envoi vérifié et réessayé » manque | — | S |
| 128 | Reconnexion à attentes croissantes 250 ms → 30 s (`im/platforms/retry.js:1-5`) | NON VÉRIFIÉ | — | — | S |
| 129 | Images Markdown d'une réponse envoyées comme images | PARTIEL | fichiers joints envoyés (`discord.ts:92`, `telegramplus.ts:141`) | Images citées dans le texte | S |
| 130 | Réponse renvoyée strictement au chat d'origine | FAIT | `server/src/channelrelay.ts` | — | — |
| 131 | Découpage Markdown qui garde les blocs de code entiers (`im/format.js`) | PARTIEL | `splitMessage` (`channelrelay.ts`) | Re-fermeture des blocs de code coupés non vérifiée | S |
| 132 | WeChat (iLink), QQ, Feishu / Lark, DingTalk, WeCom | NON REPRIS | — | Marché chinois ; WeChat iLink imite une version de client (`weixin.js:27-29`) : statut d'API officielle non prouvé | — |
| 133 | Boîte mail existante (IMAP) | FAIT | `server/src/imapwatch.ts` ; test `channels-imap.test.ts` | — | — |

### 1.10 Connecteurs, capacités, secrets

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 134 | GitHub | FAIT | `server/src/githubapp.ts` ; test `github-issue-workflow.test.ts` | — | — |
| 135 | Gmail, QQ Mail, 163 et boîtes IMAP / SMTP avec réglages prêts | PARTIEL | `server/src/accountmail.ts` (test `account-mail.test.ts`) | Préréglages par fournisseur | S |
| 136 | E-mail écrit par un bot en attente de confirmation par défaut | FAIT | `server/src/botmailrecipients.ts`, `native/mailproof.ts` ; test `security-lot1.test.ts` | — | — |
| 137 | Serveur MCP distant : OAuth dynamique ou en-tête fixe | FAIT | `server/src/connectors.ts`, `catalog.ts:11` ; test `oauth.test.ts` | — | — |
| 138 | Import des configs MCP de Claude Desktop, Cursor, VS Code | MANQUANT | `localimport.ts` importe des **bots**, pas les configs MCP | — | S |
| 139 | Serveur distant en « lecture seule » (outils `readOnlyHint` seulement) | FAIT | `server/src/connectors.ts:26`, `:44` | — | — |
| 140 | Capacités partagées attachées par bot ; commande locale ajoutée par un bot = accord avant de tourner | FAIT | `local_tool_server_add`, `web/src/components/LocalTools.tsx` ; test `irreversible-skills-localtools.test.ts` | — | — |
| 141 | `request_secret` : carte sécurisée, le bot ne voit jamais la valeur | FAIT | `secret_request` (`agent/tools.ts:525`) | — | — |
| 142 | Secret pour « tous les bots » ou « ce bot » ; dernier usage | FAIT | `server/src/vaultaccess.ts` ; test `security-lot1.test.ts` | — | — |
| 143 | Secret injecté en variable du shell + masqué partout | DIFFÉRENT | `secret_use` côté serveur (le secret n'entre jamais dans le shell) | Plus sûr chez Sklubot | — |
| 144 | Chiffrement au repos par phrase de passe, démarrage verrouillé | DIFFÉRENT | clé de données du serveur (`server/src/datakey.ts`) ; test `data-key.test.ts` | — | — |
| 145 | Avertissement si la page n'est pas en HTTPS quand on tape un secret | DIFFÉRENT | service en HTTPS | — | — |

### 1.11 Recherche, documents, images, voix

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 146 | Recherche « auto » : la recherche **native de la route du bot**, avec sa propre clé (Anthropic, OpenAI Responses, Gemini, DeepSeek, Kimi, Zhipu…) (`ds-bot/web-search.js`) | PARTIEL | natif Anthropic seulement (`llm/anthropic.ts:115`) ; sinon Brave ou SearXNG (`server/src/search.ts:1-25`) ; **sans eux : erreur** | Bots DeepSeek / OpenRouter sans recherche si le serveur n'a pas de clé Brave ni de SearXNG | M |
| 147 | Repli sans clé : pages de résultats Bing / DuckDuckGo | NON REPRIS | — | Grattage de pages de résultats : contraire aux conditions des moteurs | — |
| 148 | Ligne « moteur utilisé » sur chaque résultat ; « ne devine jamais d'adresse » si la recherche échoue (`prompt.js:20`) | PARTIEL | erreur claire dans `search.ts` | Pas la ligne « moteur », pas la consigne | S |
| 149 | **Images lues pour les modèles texte seul** : un modèle de vision les décrit avant l'envoi, texte gardé en cache (`ds-bot/src/host/images.js:1-4`) | MANQUANT | **`llm/openai-compat.ts:16`** remplace l'image par « [An image was here; this model does not read images.] » | Un bot DeepSeek (préréglage `images: false`, `apimodels.ts:35`) ne voit **aucune** capture ni photo | M |
| 150 | Lecture de documents (PDF, Word, PowerPoint, image) en texte | PARTIEL | rendu `server/src/office.ts`, OCR `server/src/media.ts` | Outil unique « lire ce document » | S |
| 151 | Office : créer, vérifier, réparer et modifier `.docx/.pptx/.xlsx` **sans rien installer** ; rendu en images pour contrôler la mise en page (`ds-bot/src/office/*.js`, `office.js`) | PARTIEL | LibreOffice dans l'ordinateur du bot : convertir, recalculer, rendre (`server/src/office.ts:7-15`) | Contrôle et réparation des paquets OOXML, modifications ciblées (bloc, commentaires, suivi des modifications) | M |
| 152 | PDF lu en rendant ses pages en images | PARTIEL | rendu `office.ts` | Consigne dans le prompt (`prompt.js:21`) | S |
| 153 | Lecture à voix haute et dictée | FAIT | `server/src/voice/*` ; tests `voice-speak.test.ts`, `voice-transcribe.test.ts` | — | — |
| 154 | Services DeepSeek (OCR, voix, dictée) avec la clé de l'utilisateur | DIFFÉRENT | voix Piper / Fish / Kokoro (`server/src/voice/piper.ts`) | — | — |

### 1.12 Tâches planifiées

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 155 | Tâches planifiées par bot ou groupe ; pause / reprise ; suivent la conversation | FAIT | `server/src/routines.ts`, `routineplus.ts` ; test `nod-routines.test.ts` | — | — |
| 156 | Consigne : ne pas créer de doublon parce qu'une réponse tarde ; dire si la planification est indisponible | PARTIEL | `routine_create` (`agent/tools.ts:838`) | Consigne anti-doublon non vérifiée | S |
| 157 | Rappel de groupe arrivé comme un message de l'utilisateur dans le groupe | PARTIEL | routines par bot | Routine propre à un salon non vérifiée | S |

### 1.13 Mobile, à distance, API

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 158 | Appli téléphone appairée par QR, lien Noise chiffré de bout en bout par un relais | DIFFÉRENT | appli mobile sur compte (`mobile/`) ; relais téléphone `server/src/relay.ts` ; test `phone.test.ts` | — | — |
| 159 | Écran « Ça t'attend » sur le téléphone | PARTIEL | « À toi » web (`InboxView.tsx`) | Vérifier l'équivalent mobile | S |
| 160 | Fichier livré enregistré sur le téléphone (envoi par morceaux) | NON REPRIS | — | Propre à son lien chiffré ; Sklubot sert les fichiers en HTTPS | — |
| 161 | Navigateur distant (même interface que le téléphone) | DIFFÉRENT | Sklubot **est** une appli web | — | — |
| 162 | **Accès MCP** pour d'autres agents : jeton par client, bots cochés, jamais un bot privé ; accords et secrets restent sur l'ordinateur | FAIT | `server/src/botmcp.ts`, `teammcp.ts` ; tests `nod-mcp.test.ts`, `team-mcp.test.ts` | — | — |
| 163 | Plafond de bande passante du relais par adresse et par heure | NON REPRIS | — | Propre à son relais | — |
| 164 | Image Docker pour NAS / serveur | FAIT | `docker/`, `docs/INSTALLATION-VPS.md` | — | — |

### 1.14 Réglages, administration, fiabilité

| # | Fonction DS-Bot | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| 165 | Réglages : page d'accueil avec invite de clé **sur place** quand le fournisseur d'un bot n'en a pas ; palette `Ctrl+K` | PARTIEL | `web/src/components/CommandPalette.tsx` ; santé des modèles `ModelHealth.tsx` | Invite de clé sur place depuis la page d'accueil | S |
| 166 | Usage : jetons par période, par bot, par modèle | FAIT | `server/src/usage.ts` ; test `usage-caps.test.ts` (Sklubot montre aussi le coût) | — | — |
| 167 | Verrou « un seul hôte » avec battement de cœur ; l'autre en lecture seule (`home-lock.js`) | FAIT | `server/src/datalock.ts` ; test `data-lock.test.ts` | — | — |
| 168 | Reprise après redémarrage : tour coupé repris une fois avec « vérifie ce qui est fait avant de refaire » ; accord en attente déclaré perdu ; réponse déjà produite livrée depuis le journal, demande jamais renvoyée (`resume.js:1-27`) | FAIT | `agent/restartguard.ts:11-24`, notes `agent/steering.ts` ; test `turn-guards.test.ts` | Voir écarts : réponses entre bots après redémarrage non vérifiées | — |
| 169 | Journal d'erreurs local masqué (clés, secrets, dossier personnel), rotation à 1 Mo | PARTIEL | `web/src/components/Incidents.tsx`, `server/src/monitor.ts` | Fichier local masqué non vérifié | S |
| 170 | Vérification de mise à jour et proposition | FAIT | `deploy/auto-update.sh` ; test `auto-update.test.ts` | — | — |
| 171 | « doctor » de réparation | FAIT | `server/src/doctor.ts`, `doctorroutes.ts` | — | — |
| 172 | Thème, couleur d'accent, bulle ou plat, largeurs, niveau d'animation (calme / normal / vif), animations en pause fenêtre cachée | PARTIEL | thèmes clair / sombre | Couleur d'accent, mise en page des messages, niveau d'animation | S |
| 173 | 7 langues d'interface | DIFFÉRENT | français et anglais | — | — |
| 174 | Banc d'essai avec faux modèle, captures automatiques, test de fumée | FAIT | `server/src/llm/demo.ts`, `server/test/` (155 fichiers) | — | — |

(Total : 174 lignes : 53 FAIT, 61 PARTIEL, 30 MANQUANT, 18 DIFFÉRENT, 5 NON REPRIS, 7 non vérifiées. Les lignes « NON REPRIS » 113, 132, 147, 160, 163 et les autres exclusions sont détaillées en section 4.)

---

## 2. Écarts de comportement (flux par flux)

Pour chaque flux : comment fait DS-Bot, comment fait Sklubot, puis ce qui est plus solide ou plus clair chez DS-Bot et la correction proposée. Je dis aussi où Sklubot est meilleur.

### F1. Premier message à un bot
- **DS-Bot** : au premier lancement, le bot principal « Chief » existe déjà. S'il n'y a pas de modèle utilisable, il **reste sur une carte de modèle** et **salue une fois qu'un modèle marche** (`ds-bot/README.md` § Models). Prompt : identité + règles d'équipe en une seule section **stable octet par octet** pour garder le cache (`prompt.js:1-2`, `:59-77`).
- **Sklubot** : écran d'accueil avec appel d'essai réel (`Onboarding.tsx`, `modelhealth.ts`). Le prompt est découpé pour le cache (`llm/cachelayout.ts`).
- **Écart** : chez Sklubot, un premier message envoyé avant que le modèle marche n'est **pas gardé puis rejoué** (L59 encore partiel). **Correction** : garder ce message et le rejouer à la connexion du modèle (IDÉE, S).

### F2. Un bot qui ouvre un lien sans qu'on le lui dise
- **DS-Bot** : `read_browser` lit la page en Markdown ; le mode interactif doit être activé par l'utilisateur ; si `web_search` échoue, la consigne dit « utilise un outil navigateur, sinon dis pourquoi la recherche manque, ne devine jamais d'adresse » (`prompt.js:20`).
- **Sklubot** : plus fort ici : lien tapé reconnu même sans `http` (`agent/links.ts`), relance si le lien n'a jamais été ouvert (`agent/linknudge.ts`), relevé de page par références.
- **Écart réel, et fragile chez Sklubot** : pour un **modèle texte seul** (préréglage DeepSeek, `apimodels.ts:35` `images: false`), **toute image devient la phrase « [An image was here; this model does not read images.] »** (`llm/openai-compat.ts:16`, `:44`, `:47`). `browser_open` promet pourtant « une capture vient quand les mots ne suffisent pas » (`agent/tools.ts:146`) : cette capture est perdue, et une photo envoyée par l'utilisateur aussi. DS-Bot fait décrire chaque image par un modèle de vision avant l'envoi, garde le texte par pièce jointe (le cache tient) et réessaie après un délai (`images.js:1-4`, `:31-40`). **Correction** : REUSE `ds-bot/src/host/images.js` adapté (M).

### F3. Une longue tâche qui échoue au milieu puis reprend
- **DS-Bot** : `task_start` lance la tâche dans une session à part ; une tâche ratée ou arrêtée est montrée au groupe ; « Réessayer » repart vers l'origine du tour (`turns.js:304-310`) ; consigne « une tâche arrêtée n'est pas un livrable, dis ce qui reste » (`references/tasks.md`).
- **Sklubot** : reprise bornée par le progrès (`agent/autocontinue.ts`), contrôle de fin indépendant (`agent/endcheck.ts`), 3 tâches parallèles (`agent/lanes.ts`).
- **Écart** : Sklubot n'a ni `task_send` (relancer une tâche avec une précision) ni `task_read` (lire un long résultat) (`agent/bgtasks.ts:170-172`). **Correction** : ajouter les deux (IDÉE, S).

### F4. Les accords
- **DS-Bot** : accord « en course » : la carte de l'appli, du téléphone et de la messagerie ; la **première réponse gagne et les autres se retirent** (`approvals.js:1-5`). Navigateur : un clic **paiement** rend la main ; un clic **suppression** est d'abord refusé avec un instantané, puis accepté au 2ᵉ appel avec `confirm` seulement si **le même élément** porte encore le jeton posé (`browser/session.js:681-690`) ; les téléchargements attendent un accord. Autorisations par **bot × site × actions × durée**.
- **Sklubot** : plus solide sur le fond : accord lié à ce qui est vraiment sous le clic et au site (`agent/bind.ts:10-24`), empreinte du texte approuvé (`native/mailproof.ts`), plancher avec code TOTP (`floorapproval.ts`), accords gardés au redémarrage (L4).
- **Écarts** : (a) pas de vérification « même élément » avant une suppression dans une page ; (b) pas de durée dans les autorisations par site (`agent/scopedkeys.ts`) ; (c) téléchargements non contrôlés ; (d) retrait des boutons Slack / Discord quand on a déjà répondu dans l'appli : non vérifié. **Corrections** : REUSE la partie suppression et téléchargements de `browser/session.js` (S) ; IDÉE durée d'autorisation (S).

### F5. Une préférence apprise puis rappelée plus tard
- **DS-Bot** : quand une conversation se tait, un modèle relit le nouveau et **garde, modifie ou retire** des notes ; chaque note a un identifiant court, une **date de fin** possible et une **épingle** que l'automatique ne touche pas ; tout changement va dans `journal.jsonl` avec avant / après, annulable ; un **rangement** au plus une fois par jour fusionne les doublons et archive le fini (au plus 1/5 des notes), annulable d'un bloc ; trois portées (bot, groupe, équipe) (`ds-bot/README.md` § Memory ; `memory-review.js`, `memory-tidy.js`, `memory-entries.js`).
- **Sklubot** : plus prudent sur l'origine : seulement les mots de l'utilisateur, avec la citation (`agent/memory.ts:258`), confirmation quand le fait revient, veto anti-confusion (`similar`, test `memory-fixes.test.ts`), rappel hors du prompt système (cache).
- **Écarts** : une préférence **qui change** n'est pas mise à jour toute seule (seule une carte de contradiction existe) ; une note **datée** (« jusqu'à fin mars ») reste pour toujours ; pas d'épingle ; pas de rangement ; pas de mémoire de groupe. **Corrections** : champs `pinned` et `until` (IDÉE, S) ; rangement annulable (REUSE `memory-tidy.js`, M) ; mémoire de salon (IDÉE, M).

### F6. Une routine qui se déclenche
- **DS-Bot** : dépend du service de planification de DSH ; la tâche arrive **dans le chat du bot**, suit la conversation quand elle change de partie ; pause / reprise avec contrôle de concurrence ; consigne : établir l'heure et le fuseau, ne pas créer de doublon, dire si la planification manque (`references/tasks.md`).
- **Sklubot** : plus complet : fil propre (`agent/routinethread.ts`), cadre « personne ne regarde » (`agent/routineframe.ts`), `routine_fail`, contrôle de fin.
- **Écart** : la consigne anti-doublon (« ne recrée pas un rappel parce que la réponse tarde ») n'a pas été trouvée. (L62, nouvel essai à attente croissante, reste listé À FAIRE ; `scheduler.ts` est en cours de modification dans l'arbre, donc non jugé.) **Correction** : une ligne de consigne (IDÉE, S).

### F7. Un groupe avec plusieurs bots
- **DS-Bot** : l'admin répond d'abord et appelle les autres avec `@` ; mode « tous dans l'ordre » ; plusieurs `@` = travail en parallèle ; `[PASS]` ; une session cachée par membre et par groupe ; mémoire et dossier de groupe ; objectif par étapes ; tableau des tâches ; **marque de vérification** sur une réponse qui lie un fichier absent ou qui annonce un travail alors que rien ne tourne (`claims.js:1-8`) ; passations imbriquées qui remontent seules (`handoffs.js:1-8`).
- **Sklubot** : « qui répond » intelligent (petit modèle en 1,5 s, sinon le lead ; « Plutôt demander à… ») (`agent/roomrouting.ts:13-35`), « proposer d'abord », budget anti-boucle gardé en base (L53), `room_handoff`.
- **Écarts** : pas de mode « tous dans l'ordre » ; pas de mémoire de groupe ; le reçu (`agent/receipt.ts`) ne voit pas un **lien vers un fichier qui n'existe pas** ni un « je suis en train d'exporter » sans rien qui tourne ; une demande transmise ne revient pas « avec tout ce qui a été confié dessous ». **Corrections** : REUSE `claims.js` (S) ; IDÉE mode tour de table (S) ; IDÉE passations imbriquées (M).

### F8. Un appel vocal
- **DS-Bot** : pas d'appel ; seulement lecture à voix haute et dictée (`speech-playback.js`, `voice.js`).
- **Sklubot** : bien plus avancé (appel en flux `server/src/voice/session.ts`). **Rien à reprendre.**

### F9. Livrer un fichier ou une page
- **DS-Bot** : un lien Markdown vers un chemin ouvre l'aperçu ; un lien vers un fichier absent est marqué (`claims.js`) ; un lien relatif est rendu absolu quand le texte passe à un autre bot (`links.js:1-6`) ; images envoyées dans les messageries.
- **Sklubot** : `file_send`, artefacts, pages publiées avec contrôle automatique (`pagecheck.ts`).
- **Écart** : un bot qui écrit « voici le fichier [rapport.pdf](rapport.pdf) » alors que le fichier n'existe pas n'est pas repéré. **Correction** : REUSE `claims.js` `missingFileRefs` (S).

### F10. Accueil d'un nouvel utilisateur
- **DS-Bot** : le chef guide ; la page d'accueil des réglages demande **la clé manquante sur place** ; le bot lit le **manuel intégré** avant d'expliquer ou de changer un réglage (`prompt.js:25`, `skills/ds-bot-manual/`).
- **Sklubot** : écran d'accueil + santé du modèle.
- **Écart** : un bot Sklubot à qui on demande « comment je relie Discord ? » n'a pas de source sûre et peut inventer un menu. **Correction** : compétence « manuel de Sklubot » écrite à partir de `docs/*.md` (IDÉE pour le texte ; REUSE seulement la forme SKILL.md + `references/`, S).

### F11. Erreur du moteur ou du fournisseur
- **DS-Bot** : un code stable donne la phrase et les correctifs ; **le filtre de contenu (403 « audit ») est séparé d'une clé refusée**, avec « la clé n'est pas en cause, modifie le message » (`turn-error.js:33-36`, `turns.js:40`) ; pour une erreur de clé, **Réessayer attend que la clé change** ; l'identifiant de requête est gardé ; une fin bien trop courte avec une entrée pleine fait soupçonner une fenêtre plus petite (`turns.js:283-291`).
- **Sklubot** : classes structurées (`agent/engine-failure.ts`), délais et relances (`llm/timeouts.ts`), panne fournisseur avec « Réessayer maintenant » (`failures.ts:517`).
- **Écarts** : 403 de filtre de contenu vu comme une erreur d'accès (mauvais remède proposé) ; pas d'identifiant de requête ; pas de soupçon de fenêtre plus petite. **Corrections** : IDÉE (S chacune).

### F12. Redémarrage pendant le travail
- **DS-Bot** : `inflight.json` note chaque tour en cours et chaque message livré ; au démarrage, chaque tour coupé est repris **une fois** avec « vérifie ce qui est déjà fait avant de refaire » ; un accord en attente est déclaré perdu (« redemande si besoin ») ; une réponse **déjà produite** pendant que le greffon ne regardait pas est **livrée au bot qui l'attend, depuis le journal**, et la demande n'est jamais renvoyée (`resume.js:1-27`).
- **Sklubot** : très solide : arrêt en douceur, marqueur d'action non protégée → carte « Continuer » au lieu d'un rejeu (`agent/restartguard.ts:11-24`), notes tapées gardées (`steering.ts`), accords gardés (L4).
- **Écart possible** : le sort d'une **réponse entre bots** produite juste avant l'arrêt (le bot demandeur la reçoit-il ?) n'a pas été vérifié chez Sklubot. **Correction** : écrire le test (S).

### F13. Message envoyé à un bot occupé
- **DS-Bot** : le travail en cours **passe en tâche de fond** et la discussion répond tout de suite ; un message gardé ainsi avant un redémarrage est livré après (`CHANGELOG` 0.3.10).
- **Sklubot** : la note entre dans le tour en cours à l'étape suivante, accusé « Noté » (`steering.ts`).
- **Écart** : pour une question **sans rapport** (« au fait, c'est quoi le code wifi ? »), l'utilisateur attend la fin d'un long travail. **Correction** : proposer « Mettre le travail en cours en arrière-plan » quand le message ne parle pas de la tâche (IDÉE, M — décision du propriétaire, car cela coûte un tour de plus).

### F14. Une conversation très longue
- **DS-Bot** : seuil = part de la fenêtre du modèle **plafonnée à 380 000 jetons** (au-delà, le cache du fournisseur n'aide plus) ; un petit appel décide « condenser » ou « nouvelle partie avec note » ; le point de contrôle garde **les messages de l'utilisateur mot pour mot** (`steward.js:9-30`).
- **Sklubot** : entre tours, **300 000 caractères fixes** quel que soit le modèle (`config.ts:160`), 4 derniers tours gardés (`config.ts:182`) ; dans un tour, 80 % de la fenêtre (`agent/context.ts:13`), avec contrôle du résumé.
- **Écarts** : pour un modèle de 1 M de jetons (DeepSeek), le compactage dans un tour attend 800 000 jetons : tours très chers sans cache ; les anciennes consignes de l'utilisateur sont paraphrasées. **Corrections** : plafond absolu (IDÉE, S) ; garder les messages de l'utilisateur tels quels dans le résumé (IDÉE, S).

---

## 3. À faire (classé, le plus utile d'abord)

Chaque ligne : une phrase, la taille, **REUSE** (fichiers amont, Apache-2.0, garder `LICENSE` + `NOTICE` + mention « modifié ») ou **IDÉE**.

1. **Images lisibles par les modèles texte seul** : décrire chaque image par un modèle de vision avant l'envoi, avec cache par pièce jointe, au lieu de la phrase « image ici » — M — **REUSE** `ds-bot/src/host/images.js` (+ constantes `OCR_*` de `constants.js`).
2. **Recherche par la route du bot** (DeepSeek, OpenAI Responses, Gemini, Kimi…) avec sa propre clé, ligne « moteur utilisé », consigne « ne devine pas d'adresse », avant de dire « aucune recherche configurée » — M — **REUSE** `ds-bot/web-search.js` (sans le repli Bing / DuckDuckGo).
3. **Marque de vérification** : lien vers un fichier absent, ou « je suis en train de… » sans rien qui tourne, ajouté au reçu existant — S — **REUSE** `ds-bot/src/host/claims.js` (+ `links.js`), en ajoutant les phrases françaises.
4. **Groupes Slack / Discord / Telegram** : `@bot` dans un salon relié à un groupe de bots (aujourd'hui messages privés seulement) — M — **REUSE** idées de liaison de `ds-bot/src/host/im/index.js` et `platforms/discord.js` / `slack.js` (le code Sklubot reste celui du jour).
5. **Mémoire : épingle et date de fin**, plus la revue qui **met à jour ou retire** une note quand l'utilisateur change d'avis — S — **IDÉE** (format de `memory-entries.js`).
6. **Mémoire de groupe** lue seulement dans le salon — M — **IDÉE**.
7. **Rangement quotidien de la mémoire**, annulable d'un bloc, au plus 1/5 des notes — M — **REUSE** `ds-bot/src/host/memory-tidy.js`.
8. **Vues riches dans le chat** (graphique, chiffres clés, tableau, calculatrice, petit formulaire qui renvoie la réponse) — M — **REUSE** `ds-bot/src/client/widget-cell.js`, `cells.js` et le schéma `show_view` de `ds-bot/src/host/tools.js`.
9. **Seuil de compactage plafonné** (par ex. 380 000 jetons) et lié à la fenêtre du modèle entre les tours ; messages de l'utilisateur gardés mot pour mot dans le résumé — S — **REUSE** `linesFor` de `ds-bot/src/host/steward.js`.
10. **Suppression en 2 temps et téléchargements sous accord** dans le navigateur — S — **REUSE** passages correspondants de `ds-bot/src/host/browser/session.js` (`delete-check`, `download`).
11. **Manuel de Sklubot** lu par le bot avant d'expliquer ou de changer un réglage — S — **IDÉE** (forme de `ds-bot/src/host/skills/ds-bot-manual/`, texte à nous).
12. **Envoi raté gardé et renvoyable ; seuls les morceaux non livrés relancés ; reconnexion à attentes croissantes** sur les canaux — S — **REUSE** `ds-bot/src/host/im/platforms/retry.js` et `ds-bot/src/host/im/format.js` (chaîne : dsh-im MIT).
13. **Cartes de question et formulaires dans les messageries**, réponse par numéro, carte périmée refusée — S — **IDÉE** (`ds-bot/src/host/im/view-choices.js`, `view-form.js` à lire pour l'idée).
14. **Filtre de contenu distingué d'une clé refusée** ; « Réessayer » qui attend un changement de clé ; identifiant de requête montré — S — **IDÉE** (`client/turn-error.js`).
15. **`request_id`** : une demande nommée à un autre bot livrée une seule fois, même sur plusieurs tours — S — **REUSE** `ds-bot/src/host/requests.js`.
16. **`task_send` et `task_read`** pour les tâches de fond — S — **IDÉE**.
17. **Bot privé** : drapeau qui met ses messages sortants sous accord et l'exclut des groupes — M — **IDÉE** (`privacy.js`).
18. **Message sans rapport à un bot occupé** : proposer de passer le travail en arrière-plan — M — **IDÉE** (décision du propriétaire).
19. **Niveaux d'ordinateur par bot** (voir / arrière-plan / premier plan) et liste blanche d'applis par bot pour le Relais — M — **REUSE** `ds-bot/src/host/computer/catalog.js` (classement des actions, refus par défaut).
20. **Un seul bot par appli / souris** sur l'ordinateur de l'utilisateur (baux) — S — **REUSE** `ds-bot/src/host/computer/leases.js`.
21. **Passations imbriquées** : la réponse remonte quand tout ce qui a été confié dessous est revenu — M — **IDÉE** (`handoffs.js`).
22. **Office sans LibreOffice** : contrôle et réparation des paquets `.docx/.pptx/.xlsx`, lecture par blocs, modifications ciblées — M — **REUSE** `ds-bot/src/office/*.js` et les compétences `office/skills/` (chaîne : DeepSeek Harness MIT pour `office/SKILL.md`).
23. **Mode « tous dans l'ordre »** dans un salon — S — **IDÉE**.
24. **Rapport de bug préparé par le bot** (erreur masquée, étapes, version), envoyé après carte — S — **IDÉE** (`issue-report.js`, compétence `report-ds-bot-issue`).
25. **Idées de compétence refusées mémorisées** et passe de fond sur plusieurs conversations — M — **IDÉE** (`learning.js`).
26. **Résumé en prose de la mémoire**, « Demander / corriger » depuis le panneau, ligne « Mémoire mise à jour » dans le chat — S — **IDÉE**.
27. **Journal des changements de mémoire annulable** en 2 clics — S — **IDÉE**.
28. **Référencer une conversation** comme contexte — S — **IDÉE**.
29. **Brouillon gardé par discussion**, long collage replié en carte, pastille de lecture des longues réponses, temps de réflexion affiché — S chacun — **IDÉE**.
30. **Détection « fenêtre plus petite que déclarée »** sur une réponse coupée — S — **REUSE** `prematureCutOff` de `ds-bot/src/host/turns.js`.
31. **Autorisations par site avec durée** — S — **IDÉE**.
32. **Import des configs MCP** de Claude Desktop / Cursor / VS Code — S — **IDÉE** (en auto-hébergé ; en hébergé, seulement collé par l'utilisateur).
33. **Même autonomie pour tous les membres d'un salon** — S — **IDÉE**.
34. **Stop d'un bot par un bot principal**, avec la raison — S — **IDÉE**.
35. **`reply_to: "user"`** : les bots répondent eux-mêmes à l'utilisateur — S — **IDÉE**.
36. **Règles d'équipe du prompt** : réponse à un bot en liste de faits, « pas encore discuté », pas de merci ni d'écho, une phrase avant le premier outil dans la même réponse — S — **REUSE** lignes de `TEAM_RULES` de `ds-bot/src/host/prompt.js` (traduites et adaptées).
37. **Test** : une réponse entre bots produite juste avant un redémarrage arrive bien au bot qui l'attendait — S — **IDÉE**.
38. **Photo d'avatar** et bibliothèque d'images réutilisables — S — **IDÉE**.
39. **Couleur d'accent, mise en page des messages, niveau d'animation** — S — **IDÉE**.
40. **Lignes « fichiers modifiés » avec revue des différences** dans un salon — M — **IDÉE**.

## 4. Non repris (exclu exprès) et pourquoi

| Élément de DS-Bot | Pourquoi |
|---|---|
| Repli de recherche sans clé qui **gratte les pages de résultats** de Bing et DuckDuckGo (`web-search.js`) | Grattage contraire aux conditions des moteurs ; Sklubot reste sur des API (Brave, SearXNG, recherche native du fournisseur). |
| **Import des cookies** des navigateurs de l'utilisateur, déchiffrement des cookies Chrome / Edge, « remote debugging » pour les extraire (`app/src/cookie-import.mjs`, `cookie-parse.mjs`) | Copie de sessions personnelles et contournement du chiffrement du navigateur ; déjà exclu par `A-FAIRE.md` § 4. |
| **WeChat iLink, QQ, Feishu / Lark, DingTalk, WeCom** | Marché chinois, hors cible ; pour WeChat iLink, le client imite un numéro de version d'appli (`weixin.js:27-29`) : pas de preuve d'API publique et documentée → risque de compte bloqué. |
| Services DeepSeek dédiés (OCR, voix, dictée DeepSeek) | Propres à un fournisseur ; Sklubot a ses propres voix. |
| Lien téléphone Noise et relais à plafond de bande passante (`link/`) ; envoi de fichiers par morceaux sur ce lien | Propre à une appli locale ; Sklubot est un service en HTTPS. |
| Mise à jour de DSH, `ds-bot doctor` des épingles de profil, greffon DSH | Propre à DeepSeek Harness. |
| Noms, logos, 20 personnages, logos d'agents tiers, logo DeepSeek, texte sponsor | Marques (Apache-2.0 ne donne aucun droit sur les marques). |
| Rien de dangereux trouvé côté « self-bot » | Les adaptateurs Discord / Slack / Telegram utilisent des **jetons de bot officiels** (`platforms/discord.js:30-33` refuse un jeton qui n'est pas un bot). Aucun retrait de garde-fou trouvé : au contraire, paiement toujours rendu à l'utilisateur, applis protégées, enregistrement d'écran refusé. |

## 5. Non vérifié

- Préférence de la touche Entrée (#20), erreur de rendu isolée par dialogue (#28), modèle par défaut des nouveaux bots (#38), accueil d'un nouveau bot qui échoue (#52), message mis en file à la clôture d'un tour de groupe (#71), reconnexion à attentes croissantes des canaux Sklubot (#128), mémoire archivée à la suppression (#93) : cherchés par mots-clés sans résultat net ; il faudrait lire les écrans ou écrire un test.
- Les fichiers Sklubot non suivis par git (`PassageComment.tsx`, `SidebarStatus.tsx`, `ChatExport.tsx`) et les fichiers modifiés non commités (`scheduler.ts`, `loop.ts`, `steering.ts`…) : en cours d'écriture par une autre session, jugés « PARTIEL (en cours) » ou pas jugés.
- La recherche web en production : si le VPS a `BRAVE_API_KEY` ou `SEARXNG_URL`, l'écart n° 2 est moins grave (mais reste vrai pour un auto-hébergement sans clé).
- Le statut officiel de l'API WeChat iLink (aucune documentation publique lue).
- Le code de DS-Bot n'a pas été lancé (règle du brief) : ses comportements sont décrits d'après le code et la documentation, pas observés.
