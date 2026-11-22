# Audit complet : OpenClaw comparé à Sklubot

Date : 22/11/2026. Dépôt lu : `openclaw/openclaw`, commit `3c8c7bf7` du 21/11/2026 (copie locale déjà présente, lue sans rien exécuter).
Sklubot lu dans `/home/user/grok-sklubs` (lecture seule ; d'autres agents modifiaient l'arbre pendant l'audit, voir « Non vérifié »).

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 92 |
| PARTIEL | 42 |
| MANQUANT | 26 |
| DIFFÉRENT | 12 |
| NON REPRIS | 19 |
| **Total** | **191 lignes** |

Lecture rapide : Sklubot couvre bien la sécurité, les approbations, la reprise après redémarrage et les routines simples. Les vrais trous sont dans **le comportement du cœur** : un appel au modèle qui se fige n'est jamais coupé tout seul, les routines tournent dans le chat principal, un message tapé pendant une routine hérite des droits de la routine, la mémoire ne trouve que par mots identiques, et il n'y a qu'un seul canal (Telegram, texte seul).

## Licence

**MIT** (`LICENSE`, « Copyright (c) 2026 OpenClaw Foundation »). Elle permet d'utiliser, copier, modifier, fusionner, publier, distribuer, sous-licencier et vendre, à condition de garder la notice de copyright et le texte de la licence dans toute copie substantielle. Pas de clause de brevet, pas d'obligation de publier nos changements. Le nom et le logo « OpenClaw » ne sont pas donnés par la licence : on ne les reprend pas. Les dépendances tierces ont leurs propres licences (`THIRD_PARTY_NOTICES.md`), à vérifier avant de copier du code qui en dépend.

## Ce qui a été lu côté OpenClaw (code, pas seulement la doc)

- Boucle d'agent : `packages/agent-core/src/agent-loop.ts` (boucle, steering, exécution d'outils), `tool-repeat-guard.ts`.
- Reprises et bascule : `src/agents/embedded-agent-runner/run/failover-retry-controller.ts`, `llm-idle-timeout.ts`, `incomplete-turn-recovery.ts`, `settled-turn-finalization.ts`, `assistant-failure.ts`, `helpers.ts`.
- File et steering : `src/auto-reply/reply/queue/state.ts`, docs `concepts/queue.md`, `queue-steering.md`.
- Compaction et contexte : `src/agents/agent-settings.ts`, `tool-result-limits.ts`, `embedded-agent-runner/tool-result-truncation.ts`, `compaction-safety-timeout.ts`, `agent-hooks/compaction-safeguard-quality.ts`, `src/auto-reply/reply/memory-flush-plan.ts`.
- Sessions : `src/config/sessions/reset-policy.ts`, `src/gateway/session-restart-resume-prompt.ts`, `src/logging/diagnostic.ts`.
- Cron : `src/cron/service/jobs-scheduling.ts`, liste de `src/cron/service/*`, docs `automation/cron-jobs/*`.
- Approbations et politique d'outils : `docs/tools/exec-approvals.md`, `docs/gateway/permission-modes.md`, `src/gateway/exec-approval-lifecycle.ts` (repli `askFallback`), `src/pairing/pairing-store-model.ts`.
- Mémoire : `docs/concepts/memory.md`, `src/agents/agent-tools.memory-flush.ts`, `src/link-understanding/*`.
- Inventaire : toutes les pages de résumé de `docs/` (tools, concepts, gateway, nodes, web, automation, channels, plugins, cli), liste des 200+ extensions, des commandes « / » et des outils d'agent.

Le dépôt fait plus d'un million de lignes (`src/agents` seul : 609 000). Les petits plugins de canaux et de fournisseurs sont regroupés sur une ligne chacun, comme demandé.

## Tableau complet des fonctions

Statuts : FAIT, PARTIEL, MANQUANT, DIFFÉRENT, NON REPRIS. Taille du travail restant : S (moins d'un jour), M (quelques jours), L (une semaine ou plus). Les chemins Sklubot partent de `server/src/` sauf mention. « test : x » = fichier `server/test/x.test.ts`.

### A. Boucle d'agent, file d'attente, fiabilité (le cœur)

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| A1 | Boucle modèle → outils → modèle, en streaming | FAIT | `agent/loop.ts:923` (`modelLoop`) ; test : wave4, wave2 | — | — |
| A2 | Une file par session, sessions en parallèle, plafond global de tours simultanés | ✅ en partie (2026-11-22, L99 : une file par fil, 3 tâches par bot au plus, `agent/lanes.ts` ; pas de plafond global du serveur) — était DIFFÉRENT | `agent/loop.ts:216` (`inQueue`) : une seule file **par bot** | Un fil de discussion, une routine et le chat principal du même bot attendent les uns derrière les autres. Pas de plafond global. L'utilisateur perd : son message attend derrière une routine longue. | M |
| A3 | Steering : un message tapé pendant le travail entre dans le tour en cours à la prochaine frontière | FAIT | `agent/loop.ts:362-383`, `:1514` ; test : pause, apps (partiel) | Aucun test ne couvre « message tapé pendant une routine » (voir écart n° 13) | — |
| A4 | Modes de file `followup`, `collect`, `interrupt` et commande `/queue` | MANQUANT | — | Un seul comportement (fusion dans le tour). Pas de « traite ça après », pas de « arrête et prends le nouveau ». | M |
| A5 | Plafond de file (20) et règle quand elle déborde (résumer, jeter l'ancien, refuser) | MANQUANT | `agent/loop.ts:205` : liste sans limite | Une rafale de 100 messages entre telle quelle dans le tour. | S |
| A6 | Regroupement des rafales (attente de 500 ms) | MANQUANT | — | Trois messages envoyés coup sur coup partent en trois blocs. | S |
| A7 | Message d'une autre personne pendant un tour : garde l'autorité de son auteur | FAIT | `agent/loop.ts:346` : un membre n'entre jamais dans le tour du propriétaire ; test : wave6-workspaces | — | — |
| A8 | Dédoublonnage des messages entrants (20 min) | PARTIEL | `telegram.ts:85` (offset Telegram) | Rien pour l'API bot ou les webhooks (un appel rejoué lance deux tours). | S |
| A9 | Garde anti-répétition d'outil : note au 3e appel identique, arrêt au 20e, outils d'attente exemptés (`repeatable`) | DIFFÉRENT | `agent/loop.ts:1399` (5e appel identique refusé), `agent/reliability.ts:87` (`LoopGuard` : 4 échecs ou 4 résultats identiques arrêtent le tour) ; test : wave4 | Plus strict, donc moins cher. Mais aucune exemption pour les outils qui attendent : `screen_view` sur un écran qui ne bouge pas, `job_output` sur un travail muet, `page_read` d'une page en chargement peuvent arrêter un tour sain. | S |
| A10 | Coupe un appel modèle muet depuis 120 s (300 s en local), puis nouvel essai ou autre modèle | MANQUANT | `agent/watch.ts:306` : seulement un avis avec boutons ; `llm/openai-compat.ts:118` : `fetch` sans délai | Un flux qui se fige bloque le tour, donc toute la file du bot, tant que personne ne clique. | S |
| A11 | Budget de temps par tentative (48 h) et par exécution planifiée (60 min) | PARTIEL | `config.ts:119` : 60 min pour les tours sur abonnement seulement | Aucun budget de temps pour un tour sur modèle API (seule limite : 60 pas, `config.ts:67`). | S |
| A12 | Chien de garde de session bloquée : arrêt automatique après 5 min sans progrès | PARTIEL | `agent/watch.ts:295-312` ; test : watch | L'avis propose « Arrêter et reprendre », mais rien ne se passe si personne n'est là (routine de nuit, objectif). | S |
| A13 | Nouveaux essais avec attente croissante, part de hasard, respect de `Retry-After` | FAIT | `agent/reliability.ts:40`, `agent/loop.ts:1010` ; test : wave4 | — | — |
| A14 | Budget long pour les limites de débit (16 tentatives, 90 s à 60 s d'attente chacune) | PARTIEL | `store.ts:686` : 3 essais par défaut (6 au plus), puis `agent/failures.ts:37` : 2 nouveaux tours | Budget plus court ; passe plus vite en échec visible lors d'une panne de quelques minutes. | S |
| A15 | Bascule vers un modèle de secours | FAIT | `agent/reliability.ts:18`, `agent/loop.ts:1018` ; test : wave4, failures | — | — |
| A16 | Rotation de plusieurs clés ou comptes d'un même fournisseur, avec mise au repos | MANQUANT | — | Une seule clé par fournisseur. | M |
| A17 | File commune « attente de limite de débit » partagée entre sessions | PARTIEL | `agent/failures.ts:38` (disjoncteur à partir de 3 bots) ; test : failures | Le disjoncteur réagit après coup ; il ne retient pas les appels avant qu'ils échouent. | M |
| A18 | Réponse coupée par la limite de sortie : suite automatique | FAIT | `agent/loop.ts:1051` ; test : wave4 | — | — |
| A19 | Réponse vide : une relance, puis un avis clair | FAIT | `agent/loop.ts:1086` ; test : wave4 | — | — |
| A20 | Passe finale sans outils quand le tour finit sans réponse écrite | FAIT | `agent/loop.ts:1076` ; **aucun test trouvé** | À tester. | S |
| A21 | Réparation des appels d'outil restés sans résultat | FAIT | `agent/loop.ts:430` (`repairDangling`) ; test non identifié | — | — |
| A22 | Appel d'outil mal formé ou écrit en texte : une correction demandée au modèle | PARTIEL | `agent/loop.ts:1405` (arguments invalides renvoyés au modèle) | Rien pour un appel d'outil écrit en texte au lieu d'un vrai appel. | S |
| A23 | Contexte trop long : résumer puis réessayer le même modèle | FAIT | `agent/loop.ts:1002` ; test : wave10-context | — | — |
| A24 | Résumé automatique avant d'atteindre la limite (75 à 80 %) | FAIT | `agent/loop.ts:1125`, `agent/context.ts:191` ; test : wave10-context | — | — |
| A25 | Résumé entre deux tours | FAIT | `agent/memory.ts:70` ; pas de test dédié trouvé | Ne tourne que pour le chat principal (`agent/loop.ts:699`), pas pour les fils. | S |
| A26 | Mode « safeguard » : le résumé est contrôlé (structure, demandes en attente, identifiants exacts), corrigé une fois, et un avertissement visible s'il est dégradé | MANQUANT | — | Un mauvais résumé est accepté tel quel et remplace l'historique. | M |
| A27 | Avant de résumer, un tour silencieux écrit ce qui compte en mémoire (memory flush) | MANQUANT | — | Ce qui n'était pas en mémoire disparaît du contexte du bot au résumé. | M |
| A28 | L'historique complet reste sur disque après résumé | DIFFÉRENT | `agent/memory.ts:103` remplace l'historique du modèle ; le chat visible reste, `conversation_search` le retrouve (`agent/tools.ts:742`) | Pas de perte pour l'utilisateur. Les résultats d'outils d'origine, eux, ne sont plus relisibles par le bot. | — |
| A29 | `/compact` à la main, avec consigne (« garde surtout X ») | PARTIEL | `routes.ts:1168` (bouton) | Pas de consigne. | S |
| A30 | Élagage des vieux résultats d'outils dans la requête | FAIT | `agent/context.ts:36` ; test : wave10-context | — | — |
| A31 | Plafond de taille par résultat d'outil selon la fenêtre du modèle (16 000 à 64 000 caractères, 30 % de la fenêtre au plus) | PARTIEL | `agent/context.ts:210` (commandes), `connectors.ts:461` (60 000 pour les apps) | Pas de règle commune liée à la fenêtre : un résultat d'app de 60 000 caractères part entier vers un petit modèle. | S |
| A32 | Vieilles images retirées du contexte | FAIT | `agent/context.ts:60` ; test : wave10-context | — | — |
| A33 | Cache de prompt : partie stable en haut, partie changeante en bas, points de cache sur l'historique | PARTIEL | `llm/anthropic.ts:88` : un seul point de cache, sur le prompt système | La mémoire choisie change à chaque tour et se trouve au milieu du prompt (`agent/prompt.ts:217`) : tout ce qui suit sort du cache. Aucun point de cache sur les messages : un tour de 40 pas repaie tout l'historique à chaque pas. | S |
| A34 | Outils de lecture lancés en parallèle | FAIT | `agent/loop.ts:1546` ; test : wave10 | — | — |
| A35 | Arrêt immédiat (`/stop`) qui retire aussi le droit d'agir | FAIT | `agent/loop.ts:391`, `:1449` | — | — |
| A36 | Reprise après redémarrage : un message « regarde où tu en es et continue » | FAIT | `agent/loop.ts:1678` ; test : engine-queue, pause, wave2 | — | — |
| A37 | Les messages acceptés sont gardés sur disque et rejoués dans l'ordre | FAIT | `agent/loop.ts:233` (`bot_queue`) ; test : engine-queue | — | — |
| A38 | Action dont l'issue est inconnue : jamais rejouée toute seule | FAIT | `agent/executions.ts:76`, `agent/loop.ts:1581` ; test : wave5, failures | — | — |
| A39 | Réponse silencieuse (`NO_REPLY`) | FAIT | `agent/tools.ts:1279` (`stay_quiet`) | — | — |
| A40 | Long message découpé et diffusé par blocs selon le canal | PARTIEL | `telegram.ts:56` (coupe à 4096) | Pas d'aperçu qui se met à jour sur Telegram. | S |
| A41 | Indicateur « écrit… » sur le canal | PARTIEL | Web : activité en direct ; `telegram.ts:127` : seulement 👀 | Pas de « typing » Telegram. | S |
| A42 | Un seul message de progression mis à jour pendant le travail | FAIT | `agent/loop.ts:1205` (`Caption`), `progress_update` ; test : features, spec06 | — | — |
| A43 | Niveau de réflexion réglable par message (`/think`, `/fast`) | PARTIEL | `agent/loop.ts:959` (réglage du bot) | Pas de réglage pour un seul message. | S |
| A44 | Voir le raisonnement et le détail des outils (`/verbose`, `/trace`, `/reasoning`) | PARTIEL | Légende en direct, lignes d'étape | Pas de vue trace à la demande. | S |
| A45 | Crochets de plugin dans la boucle (`before_tool_call`, `before_prompt_build`…) | NON REPRIS | — | Sklubot n'a pas de système de plugins ; règles et approbations couvrent le besoin de l'utilisateur. | — |
| A46 | Pas de limite de pas (seulement un budget de temps) | DIFFÉRENT | `config.ts:67` (60 pas), `agent/loop.ts:1143` | Une tâche longue s'arrête et attend « Continuer », sauf routine (une reprise) ou objectif. Plus sûr pour la dépense, moins autonome. | — |

### B. Sessions et conversations

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| B1 | Une conversation principale suivie sur tous les canaux | FAIT | Telegram écrit dans le chat du bot (`telegram.ts:108`) | — | — |
| B2 | Sessions séparées par groupe ou par expéditeur | DIFFÉRENT | Salons = entités à part ; fils (`agent/loop.ts:536`) | Pas de perte. | — |
| B3 | Remise à zéro quotidienne (4 h) ou après inactivité | DIFFÉRENT | Conversation continue + résumé (`agent/memory.ts:70`) | Pas de perte ; le contexte peut dériver sur des mois. | — |
| B4 | `/new`, `/reset` | FAIT | `routes.ts:949`, `store.ts:339` | — | — |
| B5 | Bifurquer ou revenir en arrière dans une conversation | MANQUANT | `routes.ts:720` duplique le bot, pas la conversation à un point donné | — | M |
| B6 | Recherche dans les conversations passées | FAIT | `agent/tools.ts:742` ; test : wave2, security | — | — |
| B7 | Export d'une session et d'un « trajet » de débogage expurgé | PARTIEL | `routes.ts:1351` (export des données), `routes.ts:1258` (historique) | Pas de paquet de débogage d'un tour (prompt, outils, erreurs) expurgé. | M |
| B8 | Outils entre sessions : envoyer, lancer, attendre, lire l'historique | FAIT | `agent/tools.ts:1085` (`bot_message` avec attente), `:1123` (`helper_start`) ; test : ask-wait, app | — | — |
| B9 | `/btw` : question à côté pendant le travail, sans polluer la tâche | MANQUANT | — | Toute question tapée entre dans le tour en cours. | M |
| B10 | Objectif durable de session (`/goal`) avec budget | FAIT | `agent/goals.ts:89` ; test : wave10, wave5 | — | — |
| B11 | Carte de plan et d'avancement | FAIT | `agent/tools.ts:1020` (`task_add`) | — | — |
| B12 | `/status`, `/usage`, `/context` (ce que voit le modèle, tailles) | PARTIEL | Page usage, `agent/memory.ts:108` | Pas de vue « ce qui est dans le contexte et combien ça pèse ». | S |
| B13 | Journal d'état durable de session, observateurs | NON REPRIS | — | Mécanique interne propre à leur architecture. | — |

### C. Mémoire

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| C1 | Mémoire en fichiers Markdown (`MEMORY.md`, notes du jour) | DIFFÉRENT | Notes en base (`agent/memory.ts:199`) | Pas de notes du jour détaillées : seulement des faits d'une phrase (300 caractères, 8 par passe). | — |
| C2 | Profil utilisateur (`USER.md`) | FAIT | `agent/prompt.ts:187`, `profile_update` ; test : wave4 | — | — |
| C3 | Personnalité (`SOUL.md`, `IDENTITY.md`) | FAIT | `agent/prompt.ts:88`, `:244` | — | — |
| C4 | Recherche mémoire hybride (vecteurs + mots clés) | PARTIEL | `agent/recall.ts` (BM25), `agent/tools.ts:876` | Mots clés seulement : « ma voiture » ne retrouve pas « mon véhicule ». `recall.ts` est **non commité et sans test** au moment de l'audit. | M |
| C5 | Rappel automatique avant le tour | PARTIEL | `agent/prompt.ts:17` (`pickMemories`) ; test : wave5 ; `agent/recall.ts:223` en cours | Même limite : mots identiques. | S |
| C6 | « Dreaming » : consolidation de fond en trois phases, avec journal lisible | PARTIEL | `agent/memory.ts:137`, `:310` ; test : wave5, wave5b | Extraction simple après 10 min de calme. Pas de tri par usage ni de journal pour l'utilisateur. | M |
| C7 | Provenance de chaque souvenir, suppression | FAIT | `agent/memory.ts:194` (extrait exact exigé) ; test : wave5 | — | — |
| C8 | Sujets sensibles et secrets écartés de la mémoire | FAIT | `agent/sensitive.ts:71` ; test : memory-guard | — | — |
| C9 | Import de la mémoire d'un autre assistant | FAIT | `agent/memory.ts:247` ; aucun test trouvé | À tester. | S |
| C10 | Wiki mémoire, coffre de connaissances avec preuves | MANQUANT | — | — | L |
| C11 | Intentions permanentes (« quand X arrive, fais Y ») retenues depuis la conversation | PARTIEL | `scheduler.ts:164` (surveillance), `native/triggers.ts:167` | Le bot doit créer une routine ; pas de condition d'événement générale. | M |
| C12 | Moteurs de mémoire externes (Honcho, LanceDB, GBrain) | NON REPRIS | — | Services tiers ; pas utile avant C4. | — |

### D. Compétences

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| D1 | Compétences lues à la demande | FAIT | `agent/prompt.ts:221` ; test : wave2 | — | — |
| D2 | Bibliothèque et installation depuis un dépôt | FAIT | `skillslibrary.ts`, `skillsgithub.ts` ; test : skills-library | — | — |
| D3 | Contrôle de sécurité à l'installation | FAIT | `skillscan.ts:154` ; test : skill-scan | — | — |
| D4 | Apprentissage tout seul après un travail, annulation, ménage des compétences jamais utilisées | PARTIEL | `agent/tools.ts:785` (`skill_propose`), `teach.ts:80` | Le bot propose pendant le tour ; pas de revue de fond, pas de ménage. | M |
| D5 | Compétence activée seulement si ses prérequis sont là | MANQUANT | — | — | S |
| D6 | Commande « / » par compétence | FAIT | `agent/loop.ts:337` (`/skill`) | — | — |

### E. Routines et automatisation

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| E1 | Planification cron, une fois, intervalle, fuseau | FAIT | `scheduler.ts:30` ; test : wave5b, engine-queue | — | — |
| E2 | Exécution **isolée** (session neuve, sans l'historique du chat) ou dans la session au choix | MANQUANT | `scheduler.ts:92` : toujours dans le chat principal | Chaque passage gonfle l'historique du chat et bloque la file du bot. | M |
| E3 | Livraison du résultat : canal choisi, webhook, ou rien ; preuve de livraison | PARTIEL | `agent/loop.ts:740` (push, Telegram) | Pas de webhook sortant ni de choix de destination. | S |
| E4 | Après une erreur : nouvel essai à 30 s, 1 min, 5 min, 15 min, 60 min | PARTIEL | `routines.ts:17` : notification à 3 échecs, pause à 5 | Pas de nouvel essai avant le prochain horaire. | S |
| E5 | Rattrapage des horaires manqués | FAIT | `scheduler.ts:184`, `:123` | — | — |
| E6 | Un seul passage à la fois | FAIT | `scheduler.ts:83` | — | — |
| E7 | Chien de garde du passage (60 min) avec nettoyage qui libère la session | MANQUANT | `routines.ts:19` (`STALE_RUN_MS` 2 h) ne libère que le drapeau, pas la file du bot | Voir A10. | S |
| E8 | Relance si la réponse n'est qu'un « je m'en occupe » | MANQUANT | — | Une routine peut livrer une phrase d'attente comme résultat. | S |
| E9 | Webhooks entrants | FAIT | `routes.ts:400` ; test : wave4, security | — | — |
| E10 | Déclencheur à l'arrivée d'un e-mail | FAIT | `native/triggers.ts:167` ; test : apps, wave6-mail | — | — |
| E11 | Boîte IMAP surveillée par un agent lecteur restreint | PARTIEL | `botmail.ts:57` (boîte du bot) | Pas d'IMAP quelconque. | M |
| E12 | Événements MCP qui lancent une automatisation | MANQUANT | — | — | M |
| E13 | Tour de veille (heartbeat) qui peut rester silencieux | FAIT | `scheduler.ts:197`, `stay_quiet` ; test : wave4, wave5 | — | — |
| E14 | Heures actives et heures calmes | FAIT | `push.ts:162` | — | — |
| E15 | Ordres permanents | FAIT | `rules.ts:27` ; test : rule-words, wave5b | — | — |
| E16 | Scripts déclenchés sur événements internes | NON REPRIS | — | Scripts sur le serveur : risque en mode hébergé. | — |

### F. Ordinateur, navigateur, exécution

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| F1 | Navigateur piloté par références d'éléments | FAIT | `screen-elements.ts` ; test : elements | — | — |
| F2 | Pilotage du bureau (capture, clic, clavier) | FAIT | `computer.ts`, `linux.ts` ; test : desk, linux | — | — |
| F3 | Extension Chrome pour agir dans les onglets connectés de l'utilisateur | DIFFÉRENT | Sklubot Relais (`relay.ts`, `agent/mycomputer.ts`) ; test : relay | Pas de perte. | — |
| F4 | Connexion à la main et reprise de contrôle | FAIT | `takeover.ts:23`, `agent/tools.ts:1221` ; test : wave3 | — | — |
| F5 | Commandes et travaux d'arrière-plan | FAIT | `jobs.ts:94` ; test : wave10, wave10-linux | — | — |
| F6 | Bac à sable par agent | FAIT | `linux.ts`, `dockerproxy.ts` ; test : dockerproxy | — | — |
| F7 | Mode « élevé » : sortir du bac à sable | NON REPRIS | `agent/loop.ts:1335` demande toujours | Retrait d'une sécurité. | — |
| F8 | Outils de code : patch, diff, worktrees, code mode, essaim | DIFFÉRENT | Claude Code et Codex dans l'ordinateur du bot (`agent/engine.ts:669`) ; test : engine-finish | Pas de perte pour l'usage visé. | — |
| F9 | Instantanés des fichiers et retour arrière | FAIT | `snapshots.ts:207` ; test : wave9 | — | — |
| F10 | Portail : montrer à l'utilisateur un serveur lancé par le bot | PARTIEL | `agent/pagetools.ts:12` (pages publiées) | Pas d'accès direct à un serveur de dev du bot. | M |
| F11 | Téléphone comme outil : appareil photo, position, SMS, écran | PARTIEL | `agent/mycomputer.ts:240` (écran et touches) ; test : phone | Pas d'appareil photo ni de position. SMS : non repris (données personnelles). | M |
| F12 | Transfert de fichiers avec l'appareil de l'utilisateur | FAIT | `my_file_read`, `my_file_write` ; test : wave5b-files | — | — |

### G. Web, médias, outils

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| G1 | Lecture de page avec garde contre les adresses privées | FAIT | `agent/tools.ts:286`, `net.ts` ; test : security | — | — |
| G2 | Recherche web, 12 fournisseurs | PARTIEL | `search.ts:13` (Brave), recherche native du modèle | Peu de fournisseurs ; pas de fournisseur sans clé (SearXNG, DuckDuckGo). | S |
| G3 | Recherche sur X | FAIT | `xsearch.ts` | — | — |
| G4 | Liens du message lus d'office avant le tour (3 liens, 30 s) | DIFFÉRENT | `agent/links.ts` : consigne d'ouvrir le lien sur l'écran du bot ; test : links | Voir écart n° 2. | — |
| G5 | Recherche approfondie | FAIT | `researchreports.ts:35` ; test : research-reports | — | — |
| G6 | PDF et documents | FAIT | `attachmentpreviews.ts:35`, `office.ts` ; test : large-attachments | — | — |
| G7 | Images reçues comprises | FAIT | `visionpayload.ts` ; test : visionpayload | — | — |
| G8 | Création d'images | FAIT | `images.ts:10` ; test : media-tools | — | — |
| G9 | Création de vidéos | FAIT | `video.ts:36` ; test : media-tools | — | — |
| G10 | Création de musique | MANQUANT | — | — | M |
| G11 | Catalogue d'outils compact (recherche d'outil au lieu de tout envoyer) | MANQUANT | `agent/loop.ts:475` : tous les outils à chaque appel | Avec beaucoup d'apps, les outils mangent le contexte. | M |
| G12 | Client MCP | FAIT | `connectors.ts:293` ; test : oauth, connector-errors | — | — |
| G13 | Serveur MCP vers l'extérieur | FAIT | `botmcp.ts`, `teammcp.ts` ; test : bot-api, team-mcp | — | — |
| G14 | Décisions typées par un petit modèle | PARTIEL | `agent/authorize.ts:91`, `agent/roomrouting.ts:76` | Pas d'outil général. | S |
| G15 | Flux de travail typés avec reprises (Lobster) | NON REPRIS | — | Moteur à part ; routines et objectifs couvrent le besoin. | — |
| G16 | Question à l'utilisateur sans perdre la tâche | FAIT | `agent/tools.ts:1205` | — | — |
| G17 | Identifiants que le bot ne voit jamais | FAIT | `agent/tools.ts:584` ; test : wave3 | — | — |
| G18 | Réactions | FAIT | `agent/tools.ts:511` | — | — |
| G19 | Sondages | MANQUANT | — | — | S |
| G20 | Widgets dans le chat, tableaux de bord épinglés | PARTIEL | Artefacts (`artifact_create`) ; test : pages-artifacts | Pas de tableau de bord épinglé. | M |
| G21 | Thème choisi par l'agent | NON REPRIS | — | Gadget. | — |

### H. Voix

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| H1 | Conversation vocale continue, avec interruption | FAIT | `voice/session.ts:22` ; test : wave6-voice | — | — |
| H2 | Synthèse vocale, plusieurs moteurs | FAIT | `voice/speak.ts:37` ; test : voice-speak, voice-fish-kokoro | — | — |
| H3 | Notes vocales reçues transcrites | PARTIEL | `voice/transcribe.ts:25` (web) | Pas sur Telegram. | S |
| H4 | Appels téléphoniques | NON REPRIS | — | Fournisseur payant seulement. | — |
| H5 | Mot de réveil | MANQUANT | — | — | M |
| H6 | Le bot rejoint une réunion (Meet, Zoom, Teams, Slack) | PARTIEL | `meetings.ts:23` (enregistrement fourni) | Ne rejoint pas la réunion. | L |
| H7 | FaceTime | NON REPRIS | — | Mac seulement, API non officielle. | — |

### I. Canaux

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| I1 | Telegram complet (groupes, sujets, photos, vocal, aperçu en direct, boutons) | PARTIEL | `telegram.ts:108` ; test : wave2, wave5b | Texte seul, un seul chat privé. | M |
| I2 | Discord | MANQUANT | — | — | M |
| I3 | Slack comme canal de discussion | MANQUANT | Slack n'existe que comme app-outil | — | M |
| I4 | WhatsApp, iMessage, Zalo personnel (comptes personnels, API non officielles) | NON REPRIS | — | API non officielles. | — |
| I5 | Autres canaux (Signal, Matrix, IRC, Mattermost, Teams, Google Chat, LINE, Feishu, Nextcloud, Nostr, Twitch, SMS…) | MANQUANT | — | À la demande seulement. | L |
| I6 | Chat web | FAIT | `web/src/components/ChatView.tsx` | — | — |
| I7 | E-mail comme canal | FAIT | `botmail.ts:57` ; test : wave6-mail | — | — |
| I8 | Appairage des inconnus (code 8 caractères, 1 h, 3 en attente) et listes d'accès | PARTIEL | `store.ts:305` (code de liaison) | Un seul interlocuteur possible. | S |
| I9 | Groupes : réponse sur mention, liste autorisée | FAIT | `agent/team.ts`, `agent/roomrouting.ts:76` ; test : room-routing | Salons internes seulement. | — |
| I10 | Frein aux boucles entre bots (20 échanges par minute) | FAIT | `agent/team.ts:8` (3 rebonds), `agent/roombudget.ts` ; test : roombudget | — | — |
| I11 | Messages d'ambiance gardés comme contexte sans réponse | PARTIEL | Non vérifié en détail | — | S |
| I12 | Routage canal → agent | FAIT | Un bot Telegram par bot | — | — |
| I13 | Protocole agent à agent (A2A) | PARTIEL | `botapi.ts:19`, `botmcp.ts` | Pas le protocole A2A. | M |
| I14 | Mise en forme par canal | PARTIEL | Telegram en texte brut | — | S |

### J. Équipe

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| J1 | Plusieurs agents isolés | FAIT | Bots ; test : isolation | — | — |
| J2 | Sous-agents (5 niveaux), résultat annoncé | FAIT | `agent/tools.ts:1123` (1 niveau), `agent/bgtasks.ts:18` (3 tâches) ; test : app | Un seul niveau, voulu. | — |
| J3 | Modèles d'agents | FAIT | Test : team-templates | — | — |
| J4 | Plusieurs personnes, rôles | FAIT | `workspaces.ts:5` ; test : wave6-workspaces | — | — |
| J5 | Tableau de cartes | PARTIEL | `web/src/components/TasksView.tsx` | Pas de colonnes ni de règles. | M |
| J6 | Rapports d'équipe | PARTIEL | `githubactivity.ts` | — | M |
| J7 | Agent délégué d'une organisation | NON REPRIS | — | Hors cible. | — |

### K. Approbations et sécurité

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| K1 | Outils autorisés ou interdits par agent | FAIT | `agent/loop.ts:1314` ; test : floor-autonomy | — | — |
| K2 | Modes : lecture seule, demander, revue automatique, accès complet | FAIT | `agent/loop.ts:1355`, `agent/authorize.ts:91` ; test : floor-autonomy, wave5 | — | — |
| K3 | Liste de commandes autorisées, liée au binaire exact | DIFFÉRENT | Approbation liée à l'empreinte de l'action (`agent/executions.ts`) | Pas de perte : l'ordinateur du bot est isolé. | — |
| K4 | Approbation à usage unique | FAIT | `agent/loop.ts:1471` ; test : wave5 | — | — |
| K5 | Expiration des approbations | FAIT | `agent/loop.ts:1818`, `agent/stuck.ts:12` ; test : wave4 | — | — |
| K6 | Approuver depuis le canal | FAIT | `telegram.ts` (👍/👎) ; test : wave5b | — | — |
| K7 | Le temps du tour s'arrête pendant l'attente | FAIT | `agent/loop.ts:1491` | — | — |
| K8 | Contenu extérieur traité comme donnée | FAIT | `agent/loop.ts:1293`, `:1643` ; test : security, wave5 | Sklubot va plus loin. | — |
| K9 | Auto-contrôle de sécurité de l'installation, avec correction | MANQUANT | — | — | M |
| K10 | Journal d'activité | FAIT | `journal.ts:19` | — | — |
| K11 | Coffre et masquage des secrets | FAIT | `store.ts:854` ; test : wave3, data-key | — | — |
| K12 | 1Password, HashiCorp Vault | NON REPRIS | — | Services tiers. | — |
| K13 | Règles d'installation de plugins | NON REPRIS | — | Pas de plugins. | — |
| K14 | Garde réseau | FAIT | `net.ts`, `egress.ts` ; test : security | — | — |

### L. Réglages, exploitation, accueil

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| L1 | Assistant de premier lancement qui **vérifie que le modèle répond** | PARTIEL | `web/src/components/Onboarding.tsx:25` | On peut finir l'accueil sans cerveau qui marche. | S |
| L2 | `doctor` : contrôles et réparations guidées | PARTIEL | `sentinel/index.ts:89`, `health.ts:61`, `monitor.ts:51` ; test : sentinel, monitor | Détecte, ne répare pas. | M |
| L3 | Paquet de diagnostic à envoyer au support | MANQUANT | — | — | S |
| L4 | Sauvegarde | FAIT | `autobackup.ts:101` ; test : auto-backup, backup-drill | — | — |
| L5 | Mise à jour automatique | NON REPRIS | — | Service hébergé. | — |
| L6 | Santé du service | FAIT | `monitor.ts:51` ; test : monitor | — | — |
| L7 | Suivi d'usage et de coût | FAIT | `usage.ts:283` ; test : costs | — | — |
| L8 | Connexion des modèles : abonnement, clés | FAIT | `subscriptionconnect.ts`, `apimodels.ts` ; test : ai-accounts-hosted | — | — |
| L9 | Modèles locaux | PARTIEL | `apimodels.ts:207` (API compatible) | Pas de démarrage à la demande. | M |
| L10 | Rechargement de config, plusieurs passerelles, PostgreSQL, Tailscale | NON REPRIS | — | Choix d'hébergement différents. | — |
| L11 | Métriques OpenTelemetry / Prometheus | MANQUANT | — | — | M |
| L12 | Import depuis un autre assistant | PARTIEL | `grokimport.ts` ; test : grok-import | Une seule source. | M |
| L13 | Notifications | FAIT | `push.ts:184` | — | — |
| L14 | Langues | FAIT | `i18n.ts` | — | — |

### M. Mobile, bureau, développeur

| # | Fonction OpenClaw | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| M1 | App de bureau | DIFFÉRENT | `companion/` (Electron) | Pas de perte. | — |
| M2 | Apps iOS et Android | FAIT | `mobile/`, `android/` | — | — |
| M3 | Interface terminal | NON REPRIS | — | Public non développeur. | — |
| M4 | API compatible OpenAI (`/v1/chat/completions`, `/v1/responses`) | MANQUANT | `botapi.ts:19` : API propre | — | M |
| M5 | Appel direct d'un outil par HTTP | NON REPRIS | — | Contourne les approbations. | — |
| M6 | Kit de plugins | NON REPRIS | — | Compétences, MCP et connecteurs API suffisent. | — |
| M7 | Moteurs externes (Claude Code, Codex) | FAIT | `agent/engine.ts:669` ; test : engine-finish, codex-retry | — | — |
| M8 | Machines cloud jetables | NON REPRIS | — | Hors cible. | — |
| M9 | Lancer un tour depuis la ligne de commande | PARTIEL | `botapi.ts` (par `curl`) | Pas d'outil dédié. | S |

## Écarts de comportement, flux par flux

Pour chaque flux : comment OpenClaw fait, comment Sklubot fait, ce qui est plus solide ou plus clair chez eux, et la correction concrète.

### 1. Premier message à un bot

- **OpenClaw.** Le message entre dans la boîte de la session, puis dans la file globale (`docs/concepts/queue.md`). Le prompt est en sections fixes, les parties stables en haut et les parties changeantes sous une « frontière de cache » ; la date et les faits du moment voyagent dans un message à part (`docs/concepts/system-prompt.md`). Un fichier `BOOTSTRAP.md` donne un rituel de première rencontre, avec la règle « la demande de l'utilisateur passe d'abord ».
- **Sklubot.** `submitUserMessage` (`agent/loop.ts:362`) met le message en file sur disque, `newTurn` (`:440`) construit le prompt (`agent/prompt.ts:82`), l'heure est dans le message (`agent/loop.ts:716`). La garde « premier mot » prévient après 20 s de silence (`agent/watch.ts:295`).
- **Différences.** (a) Le prompt de Sklubot met la mémoire choisie au milieu (`agent/prompt.ts:217`), avant les compétences, les guides et les consignes : comme ce choix change selon les derniers messages, la fin du prompt n'est presque jamais en cache. (b) Un seul point de cache (`llm/anthropic.ts:88`), aucun sur l'historique. (c) Le prompt OpenClaw a deux sections que Sklubot n'a qu'en une phrase : « agis dans le tour, continue jusqu'au bout, vérifie avant de conclure » et « si tu promets un travail futur, mets en place le rappel avant de finir ».
- **Corrections.** Déplacer « Ce dont tu te souviens », « Tes routines » et « En ce moment » à la fin du prompt ou dans le message du tour (S). Ajouter un point de cache sur le dernier message d'outil de chaque pas (S). Ajouter les deux paragraphes « exécution » et « travail promis » (S).

### 2. Un lien donné, sans dire quoi en faire

- **OpenClaw.** Option « compréhension de liens » : avant le tour, il lit lui-même jusqu'à 3 liens du message, 30 s chacun, avec garde réseau (`src/link-understanding/defaults.ts:2-5`, `apply.ts`). Le contenu arrive dans le contexte : le modèle n'a pas à décider.
- **Sklubot.** Une consigne d'une ligne demande au bot d'ouvrir le lien sur son écran (`agent/links.ts`, `agent/loop.ts:718`), et le prompt le répète (`agent/prompt.ts:54`). C'est mieux pour l'utilisateur : il voit la page en direct.
- **Fragilités de Sklubot.** (a) La consigne n'est posée que pour le message qui lance le tour. Un lien tapé **pendant** le travail passe par le steering (`agent/loop.ts:373`) sans consigne. (b) Les sites nommés dans un message de steering ne sont pas ajoutés à `turn.hosts` (seul le premier message l'est, `:712`). Si le bot a déjà lu du contenu extérieur, ouvrir ce lien déclenche une carte « autoriser l'ouverture de ce site ? » alors que l'utilisateur vient de le taper (`taintGuard`, `:1296`). (c) Tout repose sur l'obéissance du modèle : s'il ignore la consigne, rien ne lit la page.
- **Corrections.** Dans `drainSteering`, ajouter la consigne de lien et les sites du message à `turn.hosts` (S). Filet de sécurité : si le tour finit sans avoir ouvert ni lu un lien que l'utilisateur a donné, relancer une fois (S).

### 3. Tâche longue qui échoue au milieu puis reprend

- **OpenClaw.** Pas de limite de pas. Chaque tentative a un budget de temps. Un flux muet 120 s est coupé (`run/llm-idle-timeout.ts:34`), puis jusqu'à 8 essais sur 90 s pour une panne passagère et 16 tentatives pour une limite de débit (`run/failover-retry-controller.ts:34-41`, `:74`). La reprise continue la même conversation avec une consigne : « les résultats d'outils enregistrés disent ce qui est fait ; ne vérifie que les actions dont l'issue est inconnue » (`docs/concepts/retry.md`). L'utilisateur voit un état à côté de l'indicateur de travail (numéro d'essai, heure du prochain), pas un message par échec.
- **Sklubot.** 3 essais avec attente (`agent/loop.ts:1010`), puis le modèle de secours (`:1018`), puis le coordinateur d'échecs : 2 nouveaux tours espacés de 20 à 120 s, un coéquipier, ou une carte avec des remèdes (`agent/failures.ts:37`). 60 pas puis « Continuer » (`agent/loop.ts:1143`).
- **Où OpenClaw est plus solide.** (a) **Flux figé** : Sklubot n'a aucun délai d'inactivité sur l'appel modèle. `llm/openai-compat.ts:118` appelle `fetch` avec le seul signal d'arrêt. L'avis « semble bloqué » arrive après 5 min (`agent/watch.ts:306`) et attend un clic. Sans personne, le tour reste ouvert pour toujours et bloque la file du bot. (b) La reprise après échec passe par un nouveau tour ; correct, mais le budget est court pour une panne de 5 minutes. (c) Chaque essai raté écrit un avis dans le chat (`agent/loop.ts:999`, `:1025`) ; OpenClaw garde le chat propre.
- **Corrections.** Délai d'inactivité par appel modèle (120 s sans aucun octet → erreur passagère, donc essai suivant ou secours) (S). Pour un tour que personne n'a lancé : « Arrêter et reprendre » automatique au bout du délai de blocage (S). Budget de temps total d'un tour API, comme les 60 min des abonnements (S).

### 4. Approbations

- **OpenClaw.** Quatre modes par session ; en mode revue automatique, un refus du relecteur revient au bot avec la raison, sans carte ; trois refus de suite demandent un humain (`docs/gateway/permission-modes.md`). L'attente d'approbation met en pause le budget de temps. Sans réponse, un repli configuré s'applique (`src/gateway/exec-approval-lifecycle.ts:615`).
- **Sklubot.** `judge` puis `authorize` (`agent/loop.ts:1314`, `agent/authorize.ts:91`), carte liée à l'empreinte exacte de l'action et à usage unique (`:1471`), contenu extérieur qui durcit tout (`:1293`). C'est plus strict qu'OpenClaw, et bien testé.
- **Fragilité.** Tout nouveau message du propriétaire fait expirer la carte en attente (`expireEngineApprovals`, `agent/loop.ts:364` ; `supersede`, `:1739`). Si l'utilisateur répond « oui vas-y » en texte au lieu de cliquer, l'action est annulée avec la consigne « ne réessaie pas sauf s'il le demande », et le bot doit redemander. OpenClaw garde l'approbation ouverte quand un message arrive.
- **Correction.** Si le message tapé pendant une carte en attente est un accord ou un refus court, le traiter comme la réponse à la carte ; sinon garder le comportement actuel (S).

### 5. Mémoire apprise puis rappelée plus tard

- **OpenClaw.** Le bot écrit lui-même dans des fichiers : `MEMORY.md` (chargé à chaque session), notes du jour, `USER.md`. Avant chaque résumé de conversation, un tour silencieux note ce qui compte (`src/auto-reply/reply/memory-flush-plan.ts:16`). La recherche mêle vecteurs et mots clés. Une consolidation de fond trie les notes et tient un journal lisible.
- **Sklubot.** Après 10 min de calme, un petit modèle tire au plus 8 faits des seuls messages tapés par l'utilisateur, chacun avec l'extrait exact (`agent/memory.ts:137-201`). Le prompt montre les notes qui partagent des mots avec les 3 derniers messages (`agent/prompt.ts:17`). `memory_search` cherche par mots (`agent/recall.ts`).
- **Où OpenClaw est plus solide.** (a) Rappel par le sens : chez Sklubot, une note sans mot commun avec la question n'est pas trouvée. (b) Ce que le bot a découvert en travaillant (un chemin, une décision, un résultat) n'est appris que s'il appelle `memory_save` ; rien ne le sauve avant un résumé. (c) Le résumé entre tours coupe son entrée aux 200 000 derniers caractères (`agent/memory.ts:60`) : le début d'une très longue conversation n'entre même pas dans le résumé.
- **Où Sklubot est plus sûr.** Preuve par extrait, sujets sensibles filtrés, notes contestées : à garder.
- **Corrections.** Recherche par le sens en plus des mots (M). Tour silencieux « note ce qui compte » avant chaque résumé (M). Finir, tester et commiter `agent/recall.ts` (S).

### 6. Une routine qui se déclenche

- **OpenClaw.** Par défaut dans une session isolée, neuve, sans l'historique du chat ; le résultat est ensuite annoncé dans la conversation choisie, une seule fois, après confirmation de livraison (`docs/automation/cron-jobs/delivery.md`). Chien de garde de 60 min, nettoyage qui libère la session. Après une erreur : nouvel essai à 30 s, 1 min, 5 min, 15 min, 60 min (`src/cron/service/jobs-scheduling.ts:92`). Si la réponse n'est qu'un « je m'en occupe », une relance demande le vrai résultat.
- **Sklubot.** `fireRoutine` (`scheduler.ts:48`) met le travail dans la file du bot, dans le chat principal. Créneau réservé pour ne jamais tirer deux fois, rattrapage, saut « rien de neuf », pause après 5 échecs : solide et testé.
- **Où OpenClaw est plus solide.** (a) Isolation : chez Sklubot, chaque passage ajoute ses étapes à l'historique du chat et accélère les résumés. (b) Pendant la routine, le bot n'est pas libre pour son propriétaire (voir flux 13). (c) Pas de nouvel essai après une erreur : il faut attendre l'horaire suivant. (d) Une routine dont l'appel modèle se fige bloque la file du bot sans limite ; `STALE_RUN_MS` (2 h) libère le drapeau, pas la file.
- **Corrections.** Option « passage isolé » : la routine tourne dans un fil ou un assistant caché et seul son résultat arrive dans le chat (M). Nouvel essai avec attente croissante avant de compter un échec (S). Voir flux 3 pour le délai.

### 7. Conversation de groupe à plusieurs bots

- **OpenClaw.** Réponse sur mention, liste autorisée, frein de 20 échanges par minute entre deux bots (`docs/channels/bot-loop-protection.md`), messages non adressés gardés comme contexte.
- **Sklubot.** Mention d'abord, puis choix de qui répond par règles puis petit modèle (`agent/roomrouting.ts`), 3 rebonds au plus (`agent/team.ts:8`), budget de messages du salon. Testé (room-routing, roombudget).
- **Différence.** Les salons de Sklubot sont internes : pas de vrai groupe Telegram, Discord ou Slack avec des humains extérieurs. Sur le fond, le comportement de Sklubot est au niveau.
- **Correction.** Aucune sur le comportement ; le manque est le canal (I1, I2).

### 8. Appel vocal

- **OpenClaw.** Mode Talk sur les apps, et un plugin d'appels téléphoniques.
- **Sklubot.** Micro en flux, détection de parole, transcription, réponse lue phrase par phrase, interruption par la voix (`voice/session.ts:22`). Testé (wave6-voice).
- **Différence.** Au niveau. Les appels téléphoniques demandent un fournisseur payant : non repris.

### 9. Livraison d'un fichier ou d'une page

- **OpenClaw.** Une fois la réponse finale confirmée comme livrée au canal, la boucle s'arrête ; un envoi de progression ne compte pas comme réponse ; les doublons sont retirés (`docs/concepts/agent-loop.md`, « Reply shaping »).
- **Sklubot.** `file_send`, `file_save`, pages et artefacts ; règle du prompt « ne dis jamais que c'est fait sans résultat d'outil » (`agent/prompt.ts:181`) ; passe « rapport final » si le tour finit muet (`agent/loop.ts:1076`).
- **Différence.** Sklubot n'a pas de preuve de livraison côté Telegram : `tell` (`agent/loop.ts:740`) envoie sans vérifier ni réessayer. La passe « rapport final » n'a pas de test.
- **Corrections.** Essais avec attente sur l'envoi Telegram, et avis dans le chat si l'envoi échoue (S). Test de la passe « rapport final » (S).

### 10. Accueil d'un nouvel utilisateur

- **OpenClaw.** L'assistant détecte l'accès IA déjà présent, puis **fait un vrai appel au modèle** avant de finir (`src/wizard/setup.inference-verification.ts`), propose l'import de mémoire, et termine par une note de sécurité.
- **Sklubot.** 4 ou 5 étapes (payer, notifications, équipe, nom, idées), toutes passables (`web/src/components/Onboarding.tsx:77`).
- **Différence.** Sklubot peut finir l'accueil sans cerveau qui marche ; le premier message tombe alors sur une erreur ou un avis.
- **Correction.** À la fin de l'accueil, un appel d'essai au modèle ; s'il échoue, dire pourquoi et proposer le remède avant le premier message (S).

### 11. Erreur de moteur ou de fournisseur

- **OpenClaw.** Classe l'erreur, tourne entre plusieurs comptes du même fournisseur, garde en mémoire qu'un modèle est saturé pour que les autres sessions l'évitent, et donne un message final qui nomme le modèle limité, l'heure de retour et où changer de modèle (`docs/concepts/model-failover.md`).
- **Sklubot.** Classement stable, un seul avis par panne, disjoncteur par fournisseur, entraide entre bots, carte avec remèdes (`agent/failures.ts`). Limite d'abonnement gérée avec heure de retour (`agent/sublimit.ts`). Testé (failures, sublimit).
- **Différence.** Au niveau, et plus lisible pour un non-développeur. Manque la rotation de plusieurs clés (A16).

### 12. Redémarrage en plein travail

- **OpenClaw.** À l'arrêt propre, il note quelles sessions travaillaient ; au démarrage, une seule consigne « regarde l'état et continue », sous l'autorité de la personne d'origine, revérifiée (`docs/gateway/restart-recovery.md`). Les messages en attente suivent dans l'ordre. La consigne de reprise est cachée du chat.
- **Sklubot.** `recoverInterruptedTurns` (`agent/loop.ts:1678`) : même idée, avec prudence si le bot avait déjà agi ; file rejouée dans l'ordre ; les approbations orphelines expirent (`:1781`). Testé (engine-queue, pause, wave2).
- **Différence.** Au niveau. Sklubot affiche un avis « le serveur a redémarré », ce qui est clair.

### 13. Messages tapés pendant que le bot travaille

- **OpenClaw.** Le message entre à une frontière sûre, sous l'identité et les droits de son auteur ; trois autres modes au choix ; file bornée à 20 ; une question à côté (`/btw`) ne touche pas la tâche.
- **Sklubot.** Tout message du propriétaire pour la même conversation entre dans le tour en cours (`agent/loop.ts:372`).
- **Défaut réel.** Si le tour en cours est une **routine**, un message d'un autre bot ou une relance système, le message de l'utilisateur y est fondu, mais le tour garde son origine. Conséquences lues dans le code : ses fichiers personnels sont refusés (« seulement dans un travail que l'utilisateur a lancé », `agent/mycomputer.ts:305`), « crée-moi une routine » est refusé (« une routine ne peut pas créer d'autres routines », `agent/tools.ts:919`), et le tour reste marqué « contenu extérieur » si la routine l'était. Aucun test ne couvre ce cas.
- **Corrections.** Ne jamais fondre un message de personne dans un tour que la personne n'a pas lancé : le mettre en file comme un tour à elle, juste après (S). Plus tard : mode « traite ça après » et question à côté (M).

### 14. Conversation très longue

- **OpenClaw.** Résumé contrôlé, vidage mémoire avant, séparateur « Contexte résumé » visible avec les jetons gagnés, avertissement si le résumé est dégradé, repli si le résumé échoue ou dépasse 180 s (`src/agents/embedded-agent-runner/compaction-safety-timeout.ts:9`).
- **Sklubot.** Deux mécanismes : entre tours (`agent/memory.ts:70`, seuil 300 000 caractères) et dans le tour à 80 % de la fenêtre (`agent/context.ts:191`), coupe propre entre appel et résultat, avis dans le chat pour le second.
- **Différences.** (a) Le résumé entre tours est invisible pour l'utilisateur. (b) Il utilise un autre prompt, plus pauvre, que celui du tour (pas de sections fixes). (c) Aucun contrôle du résultat. (d) Les fils ne sont résumés que dans le tour.
- **Corrections.** Un seul prompt de résumé, celui à sections, pour les deux cas (S). Ligne discrète dans le chat à chaque résumé (S). Contrôle simple : sections présentes, demandes en attente reprises, sinon un second essai (M).

### 15. Bot qui tourne en rond

- **OpenClaw.** Compare seulement nom et arguments. Au 3e appel identique, une note dans le résultat : « change d'approche ». Au 20e, arrêt avec un message clair. Les outils d'attente sont exemptés (`packages/agent-core/src/tool-repeat-guard.ts:13-14`, `:36`).
- **Sklubot.** 5e appel identique refusé (`agent/loop.ts:1401`), arrêt du tour après 4 échecs de suite du même outil ou 4 résultats identiques (`agent/reliability.ts:87`), puis carte avec remèdes.
- **Différence.** Sklubot coupe plus tôt, ce qui protège la dépense. Mais il passe de « rien » à « arrêt » sans prévenir le modèle, et n'exempte pas les outils d'attente.
- **Corrections.** Au 2e résultat identique, ajouter une note au résultat (« même résultat que la dernière fois, change d'approche ») avant l'arrêt au 4e (S). Exempter `job_output`, `screen_view` et `page_read` de la règle « même résultat » (S).

## À faire, du plus utile au moins utile

> **Mise à jour du 2026-11-22 (chantier « cœur : fiabilité »).** Les lignes marquées ✅ sont faites et testées (`server/test/core-timeouts.test.ts`, `core-reliability.test.ts`, `core-engine.test.ts`) ; « en partie » dit ce qui reste. Détail dans `docs/COUVERTURE.md`, section « Cœur : fiabilité ».

1. ✅ **Fait (2026-11-22).** Tout appel modèle muet est coupé (180 s par défaut, `MODEL_IDLE_TIMEOUT_SEC`) et traité comme une panne passagère : relances, secours, puis carte d'échec (A10). **S**
2. ✅ **Fait (2026-11-22).** Un message de l'utilisateur n'est plus fondu dans un tour de routine, de bot ou système : il devient son propre tour, à lui, juste après (flux 13). **S**
3. ✅ **Fait en partie (2026-11-22).** Un appel modèle figé ne bloque plus un tour que personne ne regarde (il est coupé, relancé, puis l'échec est traité tout seul), et chaque appel a un plafond de 30 min (`MODEL_CALL_TIMEOUT_MIN`). Reste : un budget de temps pour le tour API entier, et l'arrêt automatique d'un outil figé (A11, A12, E7). **S**
4. Passage isolé pour les routines : seul le résultat arrive dans le chat (E2). **M**
5. Recherche mémoire par le sens en plus des mots ; finir, tester et commiter `agent/recall.ts` (C4, C5). **M**
6. Tour silencieux « note ce qui compte » avant chaque résumé de conversation (A27). **M**
7. ✅ Fait (2026-11-22, `llm/cachelayout.ts`). Cache de prompt : sections changeantes à la fin, point de cache sur l'historique (A33). **S**
8. Nouvel essai avec attente croissante après l'échec d'une routine, avant de compter l'échec (E4). **S**
9. ✅ **Fait (2026-11-22).** Garde anti-boucle : note d'avertissement au modèle dès le 2e résultat identique ou le 2e échec de suite ; les outils d'attente (`screen_view`, `job_output`, `page_read`…) ont une limite plus haute mais bornée (12, `LOOP_POLL_SAME_RESULT`) (A9). **S**
10. Steering : ajouter la consigne de lien et les sites nommés par l'utilisateur à `turn.hosts` (flux 2). **S**
11. Accueil : appel d'essai au modèle avant le premier message (L1). **S**
12. Telegram : photos, notes vocales, « écrit… », essais sur l'envoi, avis si l'envoi échoue (I1, H3, A41, flux 9). **M**
13. ✅ **Traité autrement (2026-11-22), par sécurité.** Un texte tapé ne fait plus expirer la carte, mais il ne vaut jamais accord ni refus : la carte reste ouverte et se répond avec ses boutons ; le message est gardé et traité après la réponse (flux 4). **S**
14. Un seul prompt de résumé à sections, ligne visible dans le chat, contrôle simple du résumé (A26, flux 14). **M**
15. Budget d'essais plus long pour les limites de débit, et état d'essai affiché à côté de l'indicateur au lieu d'un avis par échec (A14). **S**
16. Plafond de taille des résultats d'outils lié à la fenêtre du modèle (A31). **S**
17. Tests manquants : passe « rapport final », résumé entre tours, import de mémoire, message pendant une routine (✅ ce dernier est fait depuis le 2026-11-22 : `core-reliability.test.ts`, point 6) (A20, A25, C9). **S**
18. File d'attente : plafond, regroupement des rafales, dédoublonnage API et webhooks (✅ le dédoublonnage des envois du chat web et mobile est fait depuis le 2026-11-22 ; ✅ webhooks : dédoublonnage par identifiant de livraison et regroupement des rafales faits le 2026-11-22, L20 ; l'API de bot reste à faire) (A5, A6, A8). **S**
19. Discord comme canal (I2). **M**
20. Question à côté pendant le travail, et mode « traite ça après » (B9, A4). **M**
21. Auto-contrôle de sécurité de l'installation et paquet de diagnostic (K9, L3). **M**
22. Plusieurs clés par fournisseur avec rotation (A16). **M**
23. Catalogue d'outils compact quand il y a beaucoup d'apps (G11). **M**
24. Deux paragraphes de prompt : « agis jusqu'au bout et vérifie » et « travail promis = rappel posé » (flux 1). **S**
25. Relance d'une routine qui ne rend qu'une phrase d'attente (E8). **S**
26. Résumé entre tours pour les fils ; `/compact` avec consigne (A25, A29). **S**
27. Livraison des routines vers un webhook ou une destination choisie (E3). **S**
28. Vue « ce qui est dans le contexte » (B12). **S**
29. Slack comme canal ; appairage de plusieurs interlocuteurs Telegram (I3, I8). **M**
30. Apprentissage de compétences en tâche de fond, ménage des compétences inutilisées, prérequis (D4, D5). **M**
31. Téléphone : appareil photo et position (F11). **M**
32. API compatible OpenAI (M4). **M**
33. Bifurquer une conversation, export de débogage d'un tour (B5, B7). **M**
34. Le reste, à la demande : musique, sondages, mot de réveil, bot qui rejoint une réunion, tableaux de bord épinglés, métriques, wiki mémoire, IMAP, événements MCP, autres canaux (G10, G19, H5, H6, G20, L11, C10, E11, E12, I5). **M à L**

## Non vérifié

- **Aucun test OpenClaw lancé, aucun code OpenClaw exécuté** (consigne). Les comportements viennent de la lecture du code et de la doc du dépôt ; quand seule la doc a été lue pour un point, le tableau cite la doc.
- Côté OpenClaw, lu en détail : la boucle `agent-core`, le contrôleur d'essais, les constantes de file, de résumé, de cron et d'appairage. **Non lu ligne à ligne** : `src/gateway` (640 000 lignes), les moteurs de mémoire (`extensions/memory-core`, `active-memory`), le détail des 200 extensions, les apps natives, l'interface web. Leur présence est établie par l'arborescence et les pages de résumé.
- Tests Sklubot lancés et verts : wave10-context (7), watch (14), failures (16), engine-queue (14), wave3 (16), wave4 (22), memory-guard (7), pause (12), ask-wait (7). Les autres fichiers de test n'ont pas été lancés ; « test : x » dans le tableau veut dire « ce fichier contient ce sujet », pas « je l'ai vu passer ».
- **Aucun essai en vrai** de Sklubot (pas de bot lancé, pas d'appel modèle). Les défauts des flux 2, 4, 13 et 15 sont déduits du code ; ils sont à confirmer par un test avant correction.
- Délai par défaut du SDK Anthropic : `llm/anthropic.ts` ne règle aucun délai. Le SDK en a peut-être un pour l'ouverture de la connexion ; je n'ai pas vérifié s'il couvre un flux qui se fige en cours de route. Pour les fournisseurs compatibles OpenAI, il n'y en a aucun, c'est sûr.
- Faux positifs de la garde anti-boucle sur `screen_view` et `job_output` : probables d'après le code, non reproduits.
- L'arbre Sklubot changeait pendant l'audit : `agent/recall.ts` et `policyassume.ts` non commités, `agent/prompt.ts`, `routes.ts`, `shared.ts`, `store.ts` modifiés. Les numéros de ligne peuvent avoir bougé de quelques lignes.
- Non vérifiés côté Sklubot : le comportement exact des messages d'ambiance dans les salons (I11), le contenu de l'app mobile et de l'app Android, l'interface web au-delà de l'accueil, la duplication de bot (garde-t-elle l'historique ?), la liste complète des fournisseurs de recherche.
- La clause MIT a été lue dans `LICENSE` ; les licences des dépendances (`THIRD_PARTY_NOTICES.md`) n'ont pas été passées en revue.
