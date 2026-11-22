# Audit complet : agent0ai/agent-zero comparé à Sklubot

Date : 22/11/2026. Dépôt lu : `agent0ai/agent-zero`, commit `a6e41ca` du 20/11/2026 (copie superficielle, 3 370 fichiers, lue sans rien exécuter, puis supprimée).
Sklubot lu dans `/home/user/grok-sklubs` en lecture seule (arbre modifié en parallèle : numéros de ligne approximatifs).

## Licence

**MIT** (`LICENSE`, « Copyright (c) 2025 Agent Zero, s.r.o »). Utiliser, copier, modifier, vendre : permis, à condition de garder la notice et le texte de la licence dans les copies substantielles. Les extensions de la « Plugin Hub » communautaire ont chacune leur licence (à vérifier avant reprise). Le plugin WhatsApp utilise Baileys (client non officiel) : non repris.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 48 |
| PARTIEL | 32 |
| MANQUANT | 17 |
| DIFFÉRENT | 6 |
| NON REPRIS | 5 |
| Non vérifié | 2 |
| **Total fonctions** | **110 lignes** |
| Compétences livrées (tableau à part) | 7 (1 IDÉE, 6 NON) |

Lecture rapide : Agent Zero est un agent unique qui a « tout un ordinateur Linux » (terminal, navigateur, bureau XFCE par Xpra, LibreOffice), extensible par plugins. Côté ordinateur, Sklubot est au même niveau (bureau par bot, instantanés de fichiers par tour, Relais vers l'ordinateur de l'utilisateur). Les idées à prendre sont surtout : **l'interruption immédiate** d'un tour par un message de l'utilisateur (vérifiée à chaque morceau du flux, avec l'autorité de l'utilisateur), **chaque tâche planifiée dans sa propre conversation**, un **contrôle anti-injection par un modèle d'audit** avant chaque outil, le **retour du premier message après la configuration**, le **branchement d'une conversation** depuis n'importe quel message, une **base de connaissances** (documents indexés), les **profils d'agent avec droits par action d'outil**, et l'outil **attendre** (jusqu'à une heure donnée) qui tient compte des interruptions.

## Ce qui a été lu côté Agent Zero

- `README.md`, `docs/guides/*` (titres : scheduler, memory, projects, browser, desktop, agent-profiles, usage, local-folders, a0-cli-connector, self-update), `docs/developer/*` (liste).
- `agent.py` (boucle `monologue`, interventions, gestion d'erreurs), `prompts/agent.system.main.solving.md`, `communication.md`, messages de reprise `prompts/fw.*.md`.
- Les 46 plugins de base (`plugins/_*`) : description, `README.md` ou `AGENTS.md` de chacun (error_retry, infection_check, context_doctor, time_travel, tool_access, wait, notify_user, goal, behavior_adjustment, chat_compaction, memory, scheduler, orchestrator, browser, desktop, chat_branching, commands, a2a_chat, email, telegram, migrate_agents, model_config, plugin_scan, a0_cleaner, promptinclude…).
- `tools/` (call_subordinate, parallel, document_query, skills_tool, vision_load), `api/` (liste des 90 points d'entrée), `skills/` (7 compétences, toutes pour développer Agent Zero lui-même).

## Tableau complet des fonctions

Taille : S (moins d'un jour), M (quelques jours), L (une semaine ou plus). Chemins Sklubot depuis `server/src/` ; « test : x » = `server/test/x.test.ts`.

### Chat et boucle d'agent

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Chat | Conversation en flux avec pensées, titre court de chaque étape | FAIT | `agent/loop.ts`, étapes nommées (`setStep`) dans `ChatView.tsx` | — | — |
| Chat | Plusieurs conversations, recherche dans les conversations et messages | FAIT | fils, `conversation_search` (`agent/tools.ts:743`), `CommandPalette.tsx` | — | — |
| Chat | Renommer une conversation ; nom automatique par un petit modèle | MANQUANT | — | Voir audit CopilotKit | S |
| Chat | **Brancher une conversation** depuis n'importe quel message (nouvelle conversation avec l'historique jusque-là) | MANQUANT | — | Utile pour essayer une autre piste sans perdre la première | M |
| Chat | Épingler des conversations, tâches et projets en haut de la liste | MANQUANT | — | — | S |
| Chat | Dossiers par projet dans la barre latérale, glisser-déposer | PARTIEL | sections / projets (`sectionroutes.ts`) | Glisser-déposer, tri | S |
| Chat | Exporter une conversation | MANQUANT | grep : pas d'export de conversation | Export Markdown/JSON d'un fil | S |
| Chat | Pièces jointes, image lue par le modèle (`vision_load`) | FAIT | `uploads.ts`, `visionpayload.ts` ; test : visionpayload | — | — |
| Chat | Commandes « / » configurables (fichiers YAML, modèles de texte), `/stop` | PARTIEL | `@App` (`ComposerMentions.tsx`), palette | Pas de commandes « / » personnelles | S |
| Chat | Affichage de l'occupation de la fenêtre de contexte (jetons) | MANQUANT | `agent/context.ts:108` connaît la fenêtre, rien n'est montré | Petite jauge | S |
| Chat | Compactage manuel de toute la conversation en un résumé (bouton) | PARTIEL | compactage automatique (`agent/context.ts`, `agent/memory.ts`) | Bouton « résumer maintenant » | S |
| Chat | Nouveautés de version montrées une fois | FAIT | annonces (`announcements.ts`, `AnnouncementCard.tsx`) ; test : announcements | — | — |
| Boucle | **Interruption immédiate** : un message tapé pendant le travail est vérifié à chaque morceau du flux et à chaque étape, puis injecté comme « intervention de l'utilisateur » | DIFFÉRENT | `agent/loop.ts:372` : le message entre au prochain pas (`drainSteering`) ; le flux en cours n'est pas coupé | Voir écarts | S |
| Boucle | Intervention transmise aussi aux sous-agents en cours (niveau de diffusion) | MANQUANT | — | Un message de l'utilisateur ne touche pas les assistants en cours | S |
| Boucle | Pause / reprise d'un agent ; « nudge » (relancer un agent figé) | FAIT | `agent/pause.ts` (test : pause), « Arrêter et reprendre » (`agent/watch.ts:22`) | — | — |
| Boucle | File de messages (ajouter, retirer, envoyer) | PARTIEL | steering | File visible | M |
| Boucle | Réponse « raisonnement sans contenu » → message système qui demande la réponse | FAIT | relance d'une réponse vide (`agent/loop.ts:1086`) | — | — |
| Boucle | « Même message deux fois : fais autre chose » | FAIT | appel identique refusé au 5e (`agent/loop.ts:1401`), `LoopGuard` (`agent/reliability.ts:87`) | — | — |
| Boucle | Arrêt après N réponses inutilisables d'affilée « pour ne pas dépenser plus » | FAIT | 2 réponses vides → avis (`agent/loop.ts:1090`) | — | — |
| Boucle | Sortie coupée par la limite : relance pour continuer | FAIT | `agent/loop.ts:1056` | — | — |
| Boucle | Réparation du JSON des appels d'outils mal formés (crochets manquants, XML) | DIFFÉRENT | Sklubot utilise les appels d'outils natifs des fournisseurs | Peu utile, sauf modèles locaux | — |
| Boucle | Nouvel essai après une exception critique (1 par défaut) avec message « continue ta tâche si possible » | FAIT | essais + secours (`agent/reliability.ts`, `agent/loop.ts:495`) ; test : failures (16/16 lancé ce jour) | — | — |
| Boucle | Refus du fournisseur (politique de contenu) : arrêt visible, pas de nouvel essai | FAIT | `agent/loop.ts:1068` (`refusal`) | — | — |
| Boucle | Mode objectif (goal) : tant qu'un objectif est actif, la réponse finale ne termine pas le travail | FAIT | « Goal mode carries on in the next round » (`agent/loop.ts:1148`), `agent/goals.ts` ; test : wave5 | — | — |
| Boucle | Barre d'objectif au-dessus de la zone de saisie, `/goal`, pause / reprise / modifier | PARTIEL | `GoalsAndJobs.tsx` | Barre visible dans le chat | S |

### Prompt (méthode)

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Prompt | « Définis un succès observable, fais un plan court » | MANQUANT | — | Une phrase | S |
| Prompt | « Les mémoires sont des préférences et faits stables, pas l'historique des tâches » | PARTIEL | `agent/memory.ts` n'extrait que des faits tapés | Règle dans `memory_save` | S |
| Prompt | Comparer les résultats aux attentes, revoir le plan quand les preuves divergent | MANQUANT | — | — | S |
| Prompt | Longues tâches : notes de progrès compactes (trouvailles, approches ratées, chemins, trous) | PARTIEL | `progress_update` (`agent/tools-team.ts:32`) | « approches ratées » à noter pour ne pas les refaire | S |
| Prompt | En synthèse : ne pas promouvoir une affirmation non soutenue en fait | MANQUANT | — | — | S |
| Prompt | Code : lire avant de changer, reproduire le bug, relancer le même contrôle, changements minimaux, nettoyer ses fichiers temporaires | MANQUANT | rien de spécifique au code dans `agent/prompt.ts` | Guide « code » (les bots codeurs utilisent Claude Code/Codex qui ont le leur) | S |
| Prompt | « Un délai dépassé, une sortie partielle ou un résultat plausible n'est pas un succès vérifié » | MANQUANT | — | Une phrase importante | S |
| Prompt | Rapport final : séparer faits vérifiés et hypothèses, nommer les contrôles non lancés | PARTIEL | rapport final (`agent/prompt.ts:165`) | « contrôles non lancés » | S |
| Prompt | Persévérer : nouvelle preuve ou autre approche au lieu de répéter | PARTIEL | `agent/prompt.ts:156` (« find a different way ») | — | — |
| Prompt | Fichiers `*.promptinclude.md` d'un espace de travail injectés dans le prompt (budget de jetons) | DIFFÉRENT | instructions de projet (`agent/prompt.ts:248`), consignes permanentes | Pas de fichiers lus depuis l'espace de travail | — |
| Prompt | Règles de comportement fusionnées par un petit modèle (« ajuste ton comportement ») et mises en tête du prompt | FAIT | `rule_propose` avec carte d'accord (`agent/prompt.ts:146`), `rules.ts` ; test : rule-words | — | — |
| Prompt | Date et heure dans le prompt | FAIT | heure dans chaque message (`agent/loop.ts:714`) | — | — |

### Ordinateur, navigateur, bureau

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Ordinateur | Ordinateur Linux complet dans Docker (terminal, Python, Node) | FAIT | `linux.ts`, `docker/desktop` ; test : linux | — | — |
| Ordinateur | Exécution de code par SSH sur une autre machine | PARTIEL | Relais vers l'ordinateur de l'utilisateur (`agent/mycomputer.ts`) | Pas de SSH vers un serveur choisi | M |
| Ordinateur | Bureau XFCE en direct dans le panneau (Xpra), prise en main | FAIT | écran en direct (`vnc.ts`, `LiveScreen.tsx`), `takeover.ts` | — | — |
| Ordinateur | Bureau qui s'adapte à la taille du panneau (portrait compris) | NON VÉRIFIÉ | `ComputerViewer.tsx` | — | — |
| Ordinateur | LibreOffice : Writer, Calc, Impress, fichiers ODF, coédition | PARTIEL | LibreOffice installé (`agent/prompt.ts:112`), `office.ts` (conversion) | Pas de « coédition » visible pensée pour l'utilisateur | M |
| Ordinateur | Éditeur Markdown dans le panneau, l'utilisateur et l'agent écrivent le même document | MANQUANT | artefacts (`ArtifactPanel.tsx`), pages (`PageVersions.tsx`) | Édition partagée en direct d'un fichier | M |
| Ordinateur | Éditeur de texte natif pour l'agent (lire, écrire, patcher un fichier) | FAIT | `file_save`, shell ; moteurs Claude Code/Codex | — | — |
| Ordinateur | **Voyage dans le temps** de l'espace de travail : historique, différences, revenir à un état | FAIT | `snapshots.ts` (instantanés git privés par tour, annulation) | Sklubot : 20 derniers tours ; pas de vue « différences » complète à vérifier | — |
| Ordinateur | Nettoyage automatique de l'espace disque (caches, vieux profils, captures) avec revue | FAIT | `diskwatch.ts`, `disk.ts` ; test : team-disk | — | — |
| Ordinateur | Dossiers locaux montés dans le conteneur | FAIT | dossier `~/team`, Relais pour les fichiers de l'utilisateur | — | — |
| Ordinateur | A0 CLI : relier le terminal de son ordinateur à l'agent | FAIT | Sklubot Relais (`relay.ts`, `docs/RELAIS-PROTOCOLE.md`) ; test : relay | — | — |
| Navigateur | Navigateur Playwright (Patchright, moins détectable) | DIFFÉRENT | navigateur de bureau réel dans l'ordinateur du bot | Équivalent ou mieux | — |
| Navigateur | Captures d'écran des étapes importantes gardées dans l'historique | PARTIEL | `screen_view`, journal | Galerie des captures d'un tour | S |
| Navigateur | **Mode Annoter** : l'utilisateur clique un élément de la page pour le montrer, demander un changement, laisser un commentaire | MANQUANT | `design_reference_layout` (référence de design, `agent/prompt.ts:241`) | Annotation par clic sur l'écran du bot | M |
| Navigateur | Extensions Chrome installables dans le navigateur de l'agent | NON VÉRIFIÉ | `docker/desktop` | — | — |
| Navigateur | Utiliser le navigateur de son propre ordinateur (profils, confidentialité des pages) | FAIT | Relais (`agent/mycomputer.ts`) | — | — |
| Navigateur | Arrêt du navigateur inactif | FAIT | mise en veille des ordinateurs (`config.ts:74`) | — | — |

### Mémoire, connaissances, compétences

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Mémoire | Mémoire vectorielle (FAISS) avec embeddings | PARTIEL | mots-clés (`agent/recall.ts`) ; test : memory-recall (12/12 lancé ce jour) | Rappel par le sens | M |
| Mémoire | Outil mémoire unique : charger, sauver, supprimer, oublier | FAIT | `memory_save`, `memory_search` (`agent/tools.ts:862-876`), écran mémoire | — | — |
| Mémoire | Consolidation des mémoires (fusion des doublons) | FAIT | consolidation (`config.ts:173` `consolidateIdleMin`) | — | — |
| Mémoire | Tableau de bord mémoire : chercher, filtrer, modifier, nettoyage en masse | PARTIEL | `Brain.tsx` | Nettoyage en masse à vérifier | S |
| Mémoire | Mémoire par projet | PARTIEL | instructions de projet (`agent/prompt.ts:248`) | Mémoire propre au projet | M |
| Mémoire | « Ne mémorise pas les commandes ponctuelles, l'état temporaire ni les détails d'implémentation » | PARTIEL | extraction limitée aux faits tapés (`agent/memory.ts:145`) | Règle dans la description de `memory_save` | S |
| Connaissances | **Base de connaissances** : dossiers de documents importés, indexés, interrogés | MANQUANT | — | Voir « À faire » | M |
| Connaissances | `document_query` : charger, découper, indexer et répondre sur un document local ou distant | PARTIEL | lecture de PDF/OCR (`ocr`, `office.ts`), shell | Pas d'index ni de Q&R sur un gros document | M |
| Compétences | Compétences chargées dans la conversation à la demande | FAIT | `skill_read` (index dans `agent/prompt.ts:233`) ; test : skills-library | — | — |
| Compétences | Importer des compétences avec aperçu et scan | FAIT | `skillsgithub.ts`, `skillscan.ts` ; test : skill-scan | — | — |
| Compétences | Créer une compétence (`build-skill`) | FAIT | `skill_save`, `skill_propose` | — | — |
| Compétences | Visibilité des compétences par profil d'agent | PARTIEL | compétences par bot | — | — |

### Plusieurs agents

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Agents | Agent subordonné (`call_subordinate`) avec un profil (développeur, chercheur, hacker) ; profil inconnu → erreur réparable | FAIT | `helper_start` (`agent/tools.ts:1123`), `bot_message` | Profils pour les assistants | S |
| Agents | Outil `parallel` : lancer plusieurs appels d'outils indépendants, attendre par ID, récupérer, annuler | PARTIEL | tâches de fond (`agent/bgtasks.ts`), appels parallèles du modèle | Pas d'attente « par ID » d'un lot d'outils | M |
| Agents | Profils d'agent avec droits **par action d'outil** (mémoire:lire, éditeur:écrire, code:terminal…) | PARTIEL | `disabledTools` par famille (`agent/prompt.ts:136`), « careful » | Granularité par action | M |
| Agents | Éditeur de profils (mode simple / avancé, revue avant enregistrement) | PARTIEL | `BotSettings.tsx` | — | — |
| Agents | Agent-à-agent distant (A2A) | MANQUANT | — | Protocole ouvert | M |
| Agents | Orchestrer des agents CLI externes (Codex, Claude Code, Cursor, Gemini, Grok, OpenCode) par une compétence | DIFFÉRENT | moteurs intégrés Claude Code / Codex (`agent/engine.ts`) | — | — |
| Agents | Serveur MCP exposé (Agent Zero comme outil d'un autre agent) | FAIT | `botmcp.ts` ; test : bot-api | — | — |
| Agents | Client MCP : ajouter des serveurs, scanner, journal par serveur | FAIT | `connectors.ts`, `mcp.ts` ; test : connector-errors | Journal par serveur à vérifier | — |
| Agents | Éditeurs compatibles ACP reliés par le CLI | NON REPRIS | — | Hors cible | — |

### Tâches planifiées

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Tâches | Tâches planifiées (cron), ponctuelles (ad hoc) et planifiées en plusieurs dates (plan) | FAIT | routines cron, ponctuelles (`runAt`), surveillances (`routines.ts:143`) ; test : wave3 | Plan à plusieurs dates : non | S |
| Tâches | Créées par formulaire ou en parlant, avec fuseau | FAIT | `routine_create` (`agent/tools.ts:898`), `GoalsAndJobs.tsx` | — | — |
| Tâches | **Chaque tâche a sa propre conversation** | MANQUANT | `fireRoutine` (`scheduler.ts:48`) : chat principal | Voir écarts | M |
| Tâches | Rattrapage unique au démarrage ; tâches désactivées ou en échec pas rattrapées ; un passage coupé par l'arrêt demande ton attention | FAIT | `catchUp` (`scheduler.ts:184`), actions incertaines (`index.ts:101`) | — | — |
| Tâches | Changer un horaire repart de ce changement ; fuseau conservé | FAIT | `routines.ts` | — | — |
| Tâches | Outil `wait` : pause jusqu'à une durée ou une heure, tient compte des pauses et des interventions | PARTIEL | routine ponctuelle (`runAt`) | Attendre **dans** le tour (ex. « relance le build dans 10 min et dis-moi ») | S |
| Tâches | `notify_user` : prévenir pendant une longue tâche (info, succès, avertissement, erreur, progrès ; priorité) | FAIT | `progress_update`, push (`push.ts`) | Priorité haute / normale | — |

### Canaux et voix

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Canaux | Telegram (polling ou webhook, une session par utilisateur, fichiers, commandes « / », menus de droits) | FAIT | `telegram.ts` (commandes, `docs/API.md` wave 5b) ; test : non trouvé | Test dédié | S |
| Canaux | E-mail : relève IMAP/Exchange, réponses SMTP dans le fil, liste blanche d'expéditeurs | FAIT | `botmail.ts:181` (adresse du bot), `accountmail.ts` ; test : wave6-mail | Relève IMAP d'une boîte existante : non | M |
| Canaux | WhatsApp par Baileys | NON REPRIS | `telegram.ts:21` | Client non officiel | — |
| Voix | Synthèse locale Kokoro | FAIT | `voice/kokoro.ts` ; test : voice-fish-kokoro | — | — |
| Voix | Reconnaissance Whisper locale | FAIT | `voice/session.ts:324` (whisper-cpp) ; test : voice-transcribe | — | — |

### Sécurité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Sécurité | **Contrôle anti-injection** : un modèle d'audit lit les pensées (et l'appel d'outil) et laisse passer, demande des explications (boucle limitée) ou arrête l'agent | PARTIEL | contenu extérieur marqué (`tainted`), règles durcies et revue automatique des actions sensibles (`agent/authorize.ts`, `judge`) ; test : security | Pas de juge sur **tous** les outils ; Sklubot est déterministe (plus sûr pour les actions sensibles), le juge est une couche en plus | M |
| Sécurité | Politique d'outils par projet / profil, appliquée aussi aux agents délégués | PARTIEL | `disabledTools` par bot ; assistants héritent du contenu extérieur (`helper_start` `c.tainted`) | Pas par projet | S |
| Sécurité | Scan de sécurité des plugins tiers par un modèle | FAIT | `skillscan.ts` (compétences) ; test : skill-scan | — | — |
| Sécurité | Validateur de plugins (structure, motifs de code) | NON REPRIS | pas de plugins de code chez Sklubot | — | — |
| Sécurité | Variables et secrets par projet | PARTIEL | coffre, `secret_request`, relais de secrets (`egress.ts`) | Secrets par projet | S |
| Sécurité | Migration depuis d'autres agents : secrets, sessions, raisonnements cachés et exécutions rejouables **exclus** ; aperçu sans écriture ; consentement | PARTIEL | import Grok (`grokimport.ts`) ; test : grok-import | Import depuis Claude Code / Hermes / OpenClaw / Codex | M |
| Sécurité | Interface web liée à 127.0.0.1 par défaut ; jeton CSRF | FAIT | `hardening.ts`, sessions ; test : security-review | — | — |
| Sécurité | Tunnel d'accès à distance intégré | NON REPRIS | Sklubot est un serveur en ligne | — | — |

### Réglages, modèles, administration

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Modèles | Modèle principal + **modèle utilitaire** (résumés, noms, consolidation) + embeddings + vision | FAIT | petit modèle pour mémoire et routage (`agent/memory.ts` `ask`, `agent/roomrouting.ts`) | — | — |
| Modèles | Préréglages de modèles sélectionnables par projet, profil d'agent et conversation | PARTIEL | modèle par bot, secours par compte (`agent/reliability.ts:18`) | Par conversation / par projet | S |
| Modèles | Rotation de plusieurs clés d'API par fournisseur | MANQUANT | — | Déjà noté (audit OpenClaw A16) | S |
| Modèles | Connexion avec un compte ChatGPT (Codex) par code d'appareil | FAIT | `subscriptionconnect.ts` (Codex) ; test : codex-retry | — | — |
| Modèles | Modèles locaux (Ollama…) avec guide pour l'usage d'outils | PARTIEL | fournisseur compatible OpenAI (`providers.ts`) | Guide « modèle local » | S |
| Accueil | Assistant de première configuration ; **le premier message tapé reprend tout seul** dans la même conversation une fois le modèle connecté | PARTIEL | `Onboarding.tsx` | Le premier message n'est pas gardé pendant la configuration | S |
| Accueil | Cartes de découverte sur l'écran d'accueil | FAIT | idées de premières tâches (`ideas.ts`), `TodayView.tsx` | — | — |
| Admin | Sauvegarde / restauration avec aperçu groupé et test | FAIT | `autobackup.ts`, `backupcheck.ts`, `backuparchive.ts` ; test : auto-backup, backup-drill | — | — |
| Admin | Mise à jour automatique planifiée avec sauvegarde, choix de version | PARTIEL | `deploy/` | Mise à jour depuis l'interface | M |
| Admin | API HTTP : envoyer un message, journal, fichiers, réinitialiser, terminer un chat | FAIT | `botapi.ts`, `docs/API-BOT.md` ; test : bot-api | — | — |
| Admin | Notifications : créer, historique, marquer lu | FAIT | `push.ts`, `NotificationsSection.tsx` | — | — |
| Admin | Plugin Hub communautaire (+100), installation par ZIP / Git / index | NON REPRIS | Sklubot n'exécute pas de plugins de code tiers | Choix de sécurité ; la bibliothèque de compétences joue ce rôle | — |
| Admin | Lanceur de bureau (Docker guidé, instances) | DIFFÉRENT | compagnon Electron, serveur hébergé | — | — |
| Admin | Gestionnaire de fichiers de l'espace de travail (envoyer, télécharger, renommer, extraire une archive) | PARTIEL | bibliothèque `~/files`, `SpendSkillsFiles.tsx` | Extraire une archive, renommer depuis l'interface | S |
| Admin | Projets git (cloner un dépôt dans un projet) | PARTIEL | GitHub (`githubcontents.ts`, `githubissuegit.ts`) | — | — |

### Compétences livrées (`skills/`)

| Compétence | Ce qu'elle fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| a0-create-agent | Créer un profil d'agent Agent Zero | MIT | `bot_create` | NON (propre à Agent Zero) |
| a0-create-plugin | Créer un plugin Agent Zero | MIT | — | NON (pas de plugins de code) |
| a0-development | Développer Agent Zero | MIT | — | NON |
| a0-manage-plugin | Gérer les plugins | MIT | — | NON |
| build-skill | Écrire une compétence (structure, déclencheurs) | MIT | `skill_save`, `docs/COMPETENCES.md` | IDÉE (vérifier nos consignes d'écriture de compétence) |
| scheduled-tasks | Créer une tâche planifiée correctement | MIT | `routine_create` + consigne « vérifie le résultat » (`agent/prompt.ts:170`) | NON (déjà couvert) |
| setup-a0-cli | Installer le connecteur CLI | MIT | Relais | NON |

## Écarts de comportement, flux par flux

### 1. Premier message à un bot

- **Agent Zero.** Le premier message part même sans modèle : la conversation demande de connecter un modèle (fournisseur, compte, local ; modèle principal et utilitaire), puis **reprend le message d'origine** dans la même conversation. Le prompt « résolution de problème » demande un succès observable et un plan court.
- **Sklubot.** Accueil en étapes avant d'écrire (`web/src/components/Onboarding.tsx`) ; si aucun cerveau ne répond, le premier message tombe sur une erreur ou un avis.
- **Correction.** Garder le premier message pendant la connexion du cerveau et le rejouer une fois connecté (S). Une phrase « dis ce qui prouvera que c'est fini, puis un plan court » pour les tâches à plusieurs étapes (S).

### 2. Un bot qui utilise son ordinateur sur un lien

- **Agent Zero.** Navigateur Playwright visible dans le panneau, captures des étapes clés dans l'historique, mode **Annoter** où la personne clique un élément pour le désigner.
- **Sklubot.** Ouvre le lien sur son écran devant l'utilisateur (`agent/prompt.ts:57`), références d'éléments, page_read. Au niveau.
- **Différence.** L'utilisateur ne peut pas **montrer** un élément au bot ; il doit le décrire.
- **Correction.** Mode « Montrer » sur l'écran en direct : un clic envoie au bot la référence de l'élément et une capture recadrée (M).

### 3. Tâche longue qui échoue au milieu puis reprend

- **Agent Zero.** Boucle sans limite de pas qui ne s'arrête que par l'outil « réponse » ; exception critique → message « cette erreur s'est produite, continue ta tâche si possible » et un nouvel essai ; arrêt après N réponses inutilisables. Prompt : « un délai dépassé ou un résultat plausible n'est pas un succès vérifié ».
- **Sklubot.** Essais, modèle de secours, coordinateur d'échecs, 60 pas puis « Continuer » (`agent/loop.ts:1156`). Testé (failures 16/16 aujourd'hui). Plus solide qu'Agent Zero sur la reprise.
- **Fragilité Sklubot.** Pas de délai d'inactivité sur l'appel modèle (voir audit CopilotKit, point 1). Pas de phrase « un délai dépassé n'est pas un succès ».
- **Corrections.** Ajouter la phrase (S). Délai d'inactivité de flux (S).

### 4. Approbations

- **Agent Zero.** Pas d'approbation par action. À la place : politique d'outils par profil et par action, et un **contrôle anti-injection** par un modèle d'audit qui lit le raisonnement de l'agent avant chaque outil (passer / demander des explications / arrêter).
- **Sklubot.** Cartes d'approbation, citations, plancher, contenu extérieur (`agent/authorize.ts`). Bien plus protecteur pour les actions qui sortent.
- **Idée.** Le juge anti-injection couvre un trou différent : un bot qui, après avoir lu une page piégée, fait des choses **non sensibles** mais hors sujet (lire des fichiers privés, changer ses notes). Sklubot durcit déjà après contenu extérieur ; un juge léger sur les outils de lecture privée après contenu extérieur serait une couche en plus (M).

### 5. Mémoire apprise puis rappelée

- **Agent Zero.** Mémoire vectorielle (FAISS), consolidation, mémoire par projet, base de connaissances importée. Prompt : « les mémoires sont des préférences stables, pas l'historique des tâches ; ne mémorise pas les commandes ponctuelles ».
- **Sklubot.** Extraction prouvée par extrait, rappel par mots (`agent/recall.ts`), consolidation. Testé (memory-recall 12/12 aujourd'hui).
- **Différences.** Pas de rappel par le sens ; pas de **base de documents** (un client ne peut pas donner « nos 40 fiches produit » à interroger) ; pas de mémoire par projet.
- **Corrections.** Base de connaissances par bot ou projet : dossier de documents découpés et cherchés (mots-clés d'abord, sens ensuite) (M). Mémoire par projet (M).

### 6. Une routine qui se déclenche

- **Agent Zero.** Chaque tâche planifiée a **sa propre conversation**, retrouvable depuis la tâche ; rattrapage unique au démarrage ; une tâche en échec n'est pas rattrapée ; un passage coupé par l'arrêt demande l'attention.
- **Sklubot.** Rattrapage et incertitude équivalents. Mais tout passe dans le chat principal (`scheduler.ts:48`) : l'historique gonfle, et un message tapé pendant la routine hérite de ses droits (`agent/loop.ts:372`, défaut déjà relevé).
- **Correction.** Option « conversation propre » : la routine tourne dans un fil dédié et seul son résultat est posté dans le chat (M). Cela règle aussi le mélange des droits.

### 7. Conversation de groupe avec plusieurs bots

- **Agent Zero.** Un agent principal et ses subordonnés (profils) ; un message de l'utilisateur est **diffusé** comme intervention au subordonné en cours.
- **Sklubot.** Salons, routage, `bot_message`, assistants. Plus riche. Mais un message de l'utilisateur au bot principal n'atteint pas l'assistant qui travaille pour lui.
- **Correction.** Quand l'utilisateur écrit au bot qui attend un assistant (`bot_message` avec `wait`, `helper_start`), proposer de transmettre (ou transmettre « stop ») (S).

### 8. Appel vocal

- **Agent Zero.** Kokoro (synthèse) et Whisper (reconnaissance), sans appel temps réel complet.
- **Sklubot.** Appel complet avec détection de parole, interruption à la voix (`voice/session.ts`). Mieux.

### 9. Livraison d'un fichier ou d'une page

- **Agent Zero.** Fichiers dans l'espace de travail, lien dans la réponse ; éditeur Markdown partagé ; LibreOffice.
- **Sklubot.** `file_send`, artefacts, pages, instantanés de fichiers par tour avec annulation (`snapshots.ts`). Au niveau.
- **Idée.** Édition partagée en direct d'un document Markdown (M).

### 10. Accueil d'un nouvel utilisateur

- Voir flux 1 : le message d'origine qui reprend après configuration est la meilleure idée. Sklubot : appel d'essai en fin d'accueil manquant (déjà noté).

### 11. Erreur de moteur ou de fournisseur

- **Agent Zero.** Un nouvel essai, puis erreur visible ; refus de contenu jamais réessayé.
- **Sklubot.** Classement, disjoncteur, secours, carte de remèdes, limite d'abonnement (`agent/failures.ts`, `agent/sublimit.ts`). Mieux, testé.

### 12. Redémarrage en plein travail

- **Agent Zero.** Un passage de tâche coupé par l'arrêt « demande ton attention ».
- **Sklubot.** `recoverInterruptedTurns`, actions incertaines jamais rejouées. Mieux.

### 13. Message tapé pendant le travail

- **Agent Zero.** Le message est vérifié **à chaque morceau du flux** (`handle_intervention` appelé dans les rappels de flux, `agent.py:423-519`) : l'agent est coupé net et le message entre comme « intervention de l'utilisateur », avec les pièces jointes. Pas d'héritage de droits d'une tâche planifiée, puisque chaque tâche a sa conversation.
- **Sklubot.** Le message attend la fin du pas en cours (un long appel modèle ou un long outil peut durer des minutes) puis est fondu dans le tour.
- **Corrections.** Couper le flux du modèle en cours quand un message de l'utilisateur arrive et reprendre le pas avec le message (S/M). Marquer le message fondu comme « intervention de l'utilisateur » avec ses droits à lui (S).

### 14. Attente programmée dans un tour

- **Agent Zero.** Outil `wait` (durée ou heure), qui prolonge l'échéance si l'agent est mis en pause et affiche le temps restant.
- **Sklubot.** Il faut créer une routine ponctuelle ; le bot perd le fil du tour.
- **Correction.** Outil `wait_until` borné (ex. 60 min max) qui libère la file pendant l'attente et reprend le même tour (S/M).

## À faire, du plus utile au moins utile

1. **Interrompre le flux en cours** quand l'utilisateur écrit, et marquer le message comme intervention avec ses propres droits (S/M).
2. **Routine dans sa propre conversation**, seul le résultat dans le chat (M).
3. **Garder le premier message pendant la connexion du cerveau** et le rejouer ensuite (S).
4. **Base de connaissances** (dossier de documents indexés et interrogés) par bot ou projet (M).
5. **Phrases de méthode** : succès observable + plan court ; « délai dépassé ou résultat plausible ≠ succès vérifié » ; « ne promeus pas une affirmation non soutenue » ; rapport qui nomme les contrôles non lancés (S).
6. **Brancher une conversation** depuis un message (M).
7. **Outil `wait_until`** borné dans le tour (S/M).
8. **Transmettre un message (ou un stop) de l'utilisateur à l'assistant en cours** (S).
9. **Juge anti-injection léger** sur les lectures privées après contenu extérieur (M).
10. **Mode « Montrer »** : cliquer un élément de l'écran du bot pour le désigner (M).
11. **Droits par action d'outil** dans les profils (lire / écrire) (M).
12. **Mémoire par projet** et règle « pas d'historique de tâche en mémoire » dans `memory_save` (S/M).
13. **Export d'une conversation** ; **jauge de contexte** ; **bouton « résumer maintenant »** (S).
14. **Commandes « / » personnelles** (S).
15. **Préréglages de modèles par conversation et par projet** ; **rotation de plusieurs clés** (S).
16. **Import depuis Claude Code / Hermes / OpenClaw / Codex** avec aperçu, secrets exclus (M).
17. **Épingler** des conversations et projets (S).
18. **Édition partagée en direct** d'un document Markdown (M).
19. **Relève IMAP** d'une boîte mail existante comme canal (M).
20. **A2A** (agent à agent distant) (M).

## Non vérifié

- Je n'ai pas lu le code des plugins en entier, seulement leurs fichiers de description : les comportements décrits viennent de `README.md` / `AGENTS.md` des plugins et des guides, plus la boucle `agent.py`.
- Côté Sklubot : adaptation du bureau en portrait, extensions Chrome dans le navigateur des bots, journal par serveur MCP, nettoyage de mémoire en masse, vue « différences » complète des instantanés.
- Tests Sklubot lancés aujourd'hui : `failures.test.ts` (16/16), `memory-recall.test.ts` (12/12), `conversation-grant.test.ts` (11/11, pour l'audit CopilotKit).
