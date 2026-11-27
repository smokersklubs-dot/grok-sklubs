# Audit de Noodle (poteto/noodle) face à Sklubot

Date : 22/11/2026. Clone `--depth 1` en lecture seule, rien exécuté. Lu : `README.md`, `docs/` (introduction, « Thinking in
Noodle », concepts : modes, scheduling, brain, runtimes, events, adapters, skills ; cookbook ; référence CLI et
configuration), les en-têtes des fichiers de `loop/`, `dispatcher/`, `monitor/`, la liste des écrans de `ui/src`, et les 29
compétences de `.agents/skills/`. Côté Sklubot : `routines.ts`, `scheduler.ts`, `agent/goals.ts`, `bgtasks.ts`, `team.ts`,
`nudges.ts`, `loop.ts` (pilotage, reprise), `failures.ts`, `shared.ts` (`Autonomy`), `skills-library/catalog.json`,
`docker/desktop/Dockerfile`.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 12 | 13 | 4 | 7 | 10 |

(47 lignes de fonctions, dont 1 non vérifiée ; plus 29 lignes de compétences : 4 ADAPTER, 7 IDÉE, 18 NON.)

## Licence

**MIT License, « Copyright (c) 2026 Lauren Tan »** (`LICENSE`). Deux compétences ont leur propre licence **Apache 2.0**
(`.agents/skills/skill-creator/LICENSE.txt`, `.agents/skills/frontend-design/LICENSE.txt`) : ce sont des copies des
compétences d'Anthropic, que Sklubot a déjà adaptées depuis `anthropics/skills` (`docs/COMPETENCES.md:23`). Le reste peut
être copié, modifié, revendu en gardant l'avis MIT.

## Ce qu'est Noodle

Un orchestrateur d'agents de code écrit en Go : « des compétences qui se lancent toutes seules ». Chaque compétence peut
avoir un champ `schedule:` écrit **en langage courant** (« après une session qui a produit un gros diff », « quand le
backlog a des éléments sans plan »). Une boucle prépare un instantané de l'état (« mise en place » : backlog, agents
actifs, historique récent, évènements, capacité), un **agent planificateur** lit cet état et écrit des « commandes »
(orders) en plusieurs étapes, Noodle les valide, lance chaque étape dans un worktree git isolé (Claude ou Codex, en local
ou dans des bacs à sable cloud « Sprites »), puis fusionne le travail, une fusion à la fois. Trois modes : auto,
supervisé (fusion validée par un humain), manuel. Option : un « cerveau » (dossier Markdown façon Obsidian) nourri par les
compétences `reflect` / `meditate` / `ruminate`.

## Peut-on l'installer dans l'image de bureau des bots ?

**Non.**
- Noodle lance **en boucle** plusieurs processus `claude` / `codex` (4 en parallèle par défaut, `docs/concepts/runtimes.md`),
  qui consommeraient l'abonnement de l'utilisateur **sans passer** par les plafonds de Sklubot (`usagecaps.ts`,
  `spend.ts`), ni par les accords, la porte des actions irréversibles ou la prudence « contenu extérieur ». En mode
  « auto », le travail est fusionné sans regard humain.
- Il exige un dépôt git, des worktrees, et peut appeler un service cloud tiers (Sprites, avec un jeton).
- **Ce que renvoie l'outil** : des fichiers d'état (`.noodle/orders.json`, `mise.json`, `loop-events.ndjson`), des commits
  fusionnés, un tableau de bord web. **Ce que renvoie l'équivalent Sklubot** : un rapport de tâche de fond qui revient dans
  la discussion (`bgtasks.ts` en-tête), une carte d'objectif avec tours, preuve ou blocage (`goals.ts`), une carte
  « Fichiers modifiés » avec diff et annulation. Sklubot garde l'humain et les plafonds dans la boucle : c'est voulu.
- Ce qu'il faut prendre : quelques **idées** (déclencheurs en langage courant, boucle réfléchir/distiller, relecture par un
  autre modèle, reprise d'un pilotage par contexte reconstruit).

## Tableau complet

Taille : S = moins d'une journée, M = quelques jours, L = une semaine ou plus.

### Planification et routines

| Domaine | Fonction Noodle | Statut | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Planif | Déclencheur **en langage courant** jugé par un agent (« quand… », pas un cron) — `docs/thinking-in-noodle.md` | PARTIEL | Routines cron / une fois / webhook / surveillance d'une page ou d'un fichier / e-mail / Slack / agenda (`tools.ts` `routine_create`) ; coups de coude proactifs (`nudges.ts`, lecture seule, budget séparé) | Pas de routine « quand une facture arrive en retard de plus de 30 jours » jugée sur l'état des applis. Les coups de coude s'en approchent mais ne sont pas réglables par une phrase | M |
| Planif | Agent planificateur qui lit l'état et décide quoi faire ensuite | PARTIEL | Bot principal et routage de salon (`roomrouting.ts`) | Pas de planificateur d'équipe qui répartit un backlog entre bots | L |
| Planif | Instantané d'état visible (`mise.json` : backlog, actifs, historique, capacité, avertissements) | PARTIEL | « Aujourd'hui » (`today.ts`), état des bots | L'utilisateur ne voit pas « ce que le bot savait quand il a décidé » | S |
| Planif | Commandes en plusieurs étapes, validées contre le registre avant exécution (`loop/order_audit.go`) | DIFFÉRENT | Objectifs par tours (`goals.ts`) | — | — |
| Planif | Commandes devenues invalides retirées avec évènement `order.dropped` | NON REPRIS | — | — | — |
| Planif | Composer sans câbler : chaque compétence dit quand elle tourne, le planificateur ordonne | MANQUANT | Les compétences sont lues quand la situation correspond (`prompt.ts:227`) mais n'ont pas de « quand me lancer tout seul » | Une compétence avec « à lancer automatiquement quand… » transformée en routine | M |
| Planif | Évènements extérieurs injectés (`noodle event emit ci.failed …`) lus comme **contexte, pas comme ordres** | FAIT | Routines webhook (`/hooks/:token`), contenu marqué extérieur (`startsTainted`, `loop.ts:704`) | — | — |
| Planif | Évènements internes (étape finie, échec, conflit, relance) | FAIT | Journal d'activité, cartes d'échec (`failures.ts`), évènements `routine` (`scheduler.ts:90`) | — | — |
| Planif | Backlog dans un fichier, ou synchronisé (GitHub Issues, Linear, Jira) par adaptateurs `sync` / `done` | PARTIEL | Tâches du bot (`task_add`), tickets GitHub (`githubissues.ts`) | Pas d'adaptateur Linear/Jira/Trello ; pas de « marquer fait là-bas » | M |
| Planif | Réaction immédiate quand un fichier de commande change | NON REPRIS | — | — | — |

### Exécution et parallélisme

| Domaine | Fonction Noodle | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Exécution | Chaque étape dans un espace isolé (worktree git) | DIFFÉRENT | Chaque bot a son ordinateur Linux et son dossier (`ORDINATEUR.md`), assistants avec leur propre conversation (`team.ts:109`) | — | — |
| Exécution | Plafond de concurrence global et par environnement (`[concurrency]`, `max_concurrent`) | FAIT | `MAX_BG_TASKS` par bot (`bgtasks.ts`), file par bot (`inQueue`) | — | — |
| Exécution | Choix du modèle par étape (« routage ») | PARTIEL | Modèle par bot + modèles de secours (`reliability.ts:18`) ; assistants héritent | Pas « petit modèle pour trier, gros pour rédiger » au sein d'une tâche | S |
| Exécution | Environnement cloud (Sprites) pour paralléliser hors machine | NON REPRIS | Ordinateurs partagés / gratuits (`sharedcomputers.ts`, `freecomputers.ts`) | Service tiers | — |
| Exécution | Fusion sérialisée (une à la fois) et retour en arrière possible | DIFFÉRENT | Carte « Fichiers modifiés » : annuler en un clic | — | — |
| Exécution | Récupération après plantage : étapes restées « en fusion » reprises, sessions encore vivantes **adoptées** par PID (`loop/reconcile.go`, `monitor/pid_observer.go`) | FAIT | `recoverInterruptedTurns` (`loop.ts:1664`) : reprise prudente si le bot avait déjà agi ; file durable `bot_queue` | — | — |
| Exécution | Commandes échouées archivées avec résumé, que le planificateur peut relancer (`reconcileFailedOrders`) | FAIT | Cartes d'échec avec remèdes, « réessayer » (`failures.ts`) | — | — |
| Exécution | Pilotage en direct : interrompre et rediriger une session sans la tuer ; sinon tuer et relancer **avec un contexte de reprise reconstruit depuis le journal** (`loop/cook_steer.go`) | PARTIEL | Messages ajoutés pendant le tour (`drainSteering`, `loop.ts:388, 1046`) ; bascule moteur → modèle de secours avec la liste de ce qui a déjà été fait (`loop.ts:510-530`) | Pour un moteur Claude Code/Codex en cours, un message n'interrompt pas le tour (non vérifié en détail) | S |
| Exécution | Classement des échecs : faute de l'agent planificateur, faute de l'agent exécutant, ou panne du système (`agent_mistake_envelope.go`, `failure_envelope.go`) | PARTIEL | `failures.ts` classe fournisseur / boucle / quota | Pas de distinction « le bot s'est trompé » vs « le service est en panne » montrée à l'utilisateur (non vérifié) | S |
| Exécution | Réparations du moniteur « au mieux » qui n'arrêtent jamais la planification (`session_meta_repair.go`) | FAIT | Veille de tour (`watch.ts`), surveillance (`monitor.ts`) | — | — |
| Exécution | Préambule commun ajouté à chaque session (`dispatcher/preamble.go`) | FAIT | Invite système commune (`prompt.ts`) | — | — |

### Confiance et validation

| Domaine | Fonction Noodle | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Confiance | « Cadran de confiance » : auto / supervisé / manuel, mêmes compétences, seul change qui déclenche | FAIT | Autonomie du bot : `careful`, `balanced`, `trusted`, `auto` (`shared.ts:61`) ; mode Auto avec relecteur | — | — |
| Confiance | Changement de mode tracé (quand, pourquoi) | PARTIEL | Révisions du bot (`db.ts:246`), journal d'audit | Pas de « pourquoi » saisi | S |
| Confiance | File de relecture : ce qui attend une validation humaine (écran `reviews`, `ReviewBanner.tsx`) | PARTIEL | Cartes en attente dans chaque discussion | Pas de vue unique de tout ce qui attend (voir audit Plannotator) | M |
| Confiance | Relecture par **un autre modèle** (Claude relu par Codex et inversement) — `adversarial-review` | PARTIEL | Relecture par un autre bot (`peerreview.ts`), relecteur automatique (mode Auto) | On ne force pas un fournisseur différent du bot relu | S |
| Confiance | Porte qualité après exécution (correction, discipline de périmètre, principes) — `quality` | PARTIEL | Relecture des fichiers sur demande | Pas automatique après une tâche de fond | S |

### Mémoire (« cerveau »)

| Domaine | Fonction Noodle | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Mémoire | Cerveau Markdown versionné (principes, conventions, erreurs passées, plans), un sujet par fichier, liens `[[…]]` | DIFFÉRENT | Notes courtes par bot (`memory.ts`), compétences (`skills`), consignes de projet | Pas de « carnet » structuré par sujet | — |
| Mémoire | `reflect` après chaque session : ce qui a marché ou non, corrections du cerveau | MANQUANT | `consolidate` n'apprend que des faits sur l'utilisateur (`memory.ts:160`) | Voir audits mem0/claude-mem : « leçons apprises du travail » | M |
| Mémoire | `meditate` : élague, fusionne, dégage des principes après plusieurs réflexions | MANQUANT | Recul des notes non confirmées après 90 jours (`prompt.ts:30`) | Pas de passe qui **réorganise** la mémoire (doublons, contradictions, principes) | M |
| Mémoire | `ruminate` : fouille les anciennes conversations pour ce qui n'a jamais été noté | PARTIEL | `consolidate` sur les messages depuis la marque ; « Revoir » manuel | Pas de passe sur l'historique ancien (avant la marque, ou après un reset) | S |
| Mémoire | `refine` : transforme des tâches floues en demandes précises par questions ciblées | MANQUANT | — | Voir audit Spec Kit (« Clarifier avant d'agir ») | S |

### Interface et outils

| Domaine | Fonction Noodle | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Interface | Tableau de bord : état de la boucle, rail des étapes, cartes de métriques | FAIT | « Aujourd'hui », incidents, usage (`Incidents.tsx`, `Credits.tsx`) | — | — |
| Interface | Fil du planificateur (pourquoi il a choisi) | PARTIEL | Ligne de routage de salon avec la raison (`roomrouting.ts:298`) | Pas pour les routines et coups de coude (non vérifié) | S |
| Interface | Fil des agents, outils regroupés, flux en direct virtualisé | FAIT | Étapes groupées dans la discussion, en direct (`ChatView.tsx`, `bus.ts`) | — | — |
| Interface | Topologie (qui travaille sur quoi) | DIFFÉRENT | Liste des bots, assistants et tâches | — | — |
| Interface | Visionneuse de diff | FAIT | `FileDiff` (`SecretsFilesProviders.tsx:86`) | — | — |
| Interface | Page d'accueil (onboarding) | FAIT | `Onboarding.tsx` | — | — |
| Interface | Raccourcis clavier dans le fil | NON VÉRIFIÉ | — | — | — |
| CLI | `start`, `status`, `skills list`, `schema`, `worktree *`, `event emit`, `reset` | NON REPRIS | `desk-cli.ts` (outil de bureau) | Développeurs | — |
| CLI | Installation : « donne ce texte à ton agent » (l'agent installe en lisant `INSTALL.md`) | NON REPRIS | — | Risque : faire suivre à un agent des consignes distantes | — |
| Config | `.noodle.toml` (mode, routage, compétences, concurrence, agents, runtime, serveur, adaptateurs) | DIFFÉRENT | Réglages dans l'interface | — | — |
| Config | Plusieurs dossiers de compétences, compétences sans `schedule` jamais planifiées | DIFFÉRENT | Bibliothèque + compétences du bot + partagées | — | — |
| Qualité | Tests d'intégration à grande échelle, banc de performance de la boucle (`loop/integration_scale_test.go`, `bench_test.go`) | NON REPRIS | Tests Sklubot | — | — |
| Qualité | Test d'immuabilité des jeux de données de test (`fixtures_immutability_test.go`) | NON REPRIS | — | — | — |
| Divers | Prototype, exemples, scripts `mise` | NON REPRIS | — | — | — |
| Divers | Génération de types Go → TypeScript (`tygo.yaml`) | NON REPRIS | Types partagés `shared.ts` | — | — |
| Divers | Recherche et installation de compétences de « l'écosystème ouvert » (`find-skills`) | NON REPRIS | Import GitHub avec contrôle de sécurité, brouillon tant que non accepté (`skillscan.ts`) | Installer sans contrôle serait dangereux | — |

### Compétences (`.agents/skills/`, 29)

Licence : MIT (celle du dépôt) sauf `skill-creator` et `frontend-design` (Apache 2.0, fichier propre, origine Anthropic).
Équivalents cherchés dans `server/skills-library/catalog.json`, `server/templates/`, `guides.ts`, `docs/COMPETENCES.md`.

| Compétence | Ce qu'elle fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `reflect` | Après une session : ce qui a marché, ce qui a raté, corrections ; « retiens ça » | MIT | `consolidate` (faits sur l'utilisateur seulement) | **ADAPTER** : « leçons de mon travail », proposées en carte |
| `meditate` | Audit périodique de la mémoire : élaguer, fusionner, dégager des principes | MIT | Recul à 90 jours | **ADAPTER** : passe hebdo « ranger ma mémoire » (doublons, contradictions → carte) |
| `ruminate` | Fouille les anciennes conversations pour ce qui n'a pas été noté | MIT | `conversation_search`, « Revoir » | IDÉE |
| `brain` | Lire/écrire le carnet Markdown | MIT | `memory_*`, fichiers du bot | NON (autre modèle de mémoire) |
| `refine` | Rend une tâche floue précise par questions ciblées | MIT | `ask_user` | **ADAPTER** (fusionner avec « Clarifier avant d'agir », audit Spec Kit) |
| `unslop` | Retire les tics d'écriture d'IA d'un texte (docs, posts, articles) | MIT | Partie « anti-AI-slop » de « Règles de métier du design » (`skills-library/metier-du-design`), pour le visuel seulement | **ADAPTER** : « Écrire comme un humain » pour e-mails, posts, articles, en français et anglais |
| `plan` | Plan par phases pour une tâche moyenne ou grosse, sans exécuter | MIT | `goal_propose` | IDÉE |
| `execute` | Méthode d'exécution : périmètre, découpage, vérification | MIT | « Méthode de travail » (`skills-library/methode-de-travail`) | NON (déjà couvert) |
| `quality` | Porte qualité après exécution | MIT | `peerreview.ts` | IDÉE (relecture auto après une tâche de fond) |
| `review` | Relecture : architecture → qualité → tests → performance, problèmes numérotés avec 2 options chacun | MIT | Relecteur | IDÉE (format « chaque problème avec deux options et leurs compromis ») |
| `adversarial-review` | Relecteurs du modèle opposé, plusieurs angles critiques, synthèse | MIT | `peerreview.ts` | IDÉE (forcer un autre fournisseur) |
| `debugging` | Méthode de recherche de cause racine | MIT | — | IDÉE (version non technique : « quelque chose ne marche pas ») |
| `oops` | Réparer une construction cassée, un état périmé | MIT | — | NON (code) |
| `schedule` | Le planificateur de Noodle | MIT | — | NON (propre à Noodle) |
| `noodle` | Mode d'emploi de la CLI Noodle | MIT | — | NON |
| `todo` | Ajouter/terminer/voir des tâches dans `todos.md` | MIT | `task_add`, `task_update` | NON (déjà couvert) |
| `commit` | Messages de commit conventionnels | MIT | — | NON (code) |
| `worktree` | Gérer des worktrees git | MIT | — | NON (code) |
| `codex` | Déléguer à la CLI Codex | MIT | Moteur Codex | NON |
| `testing` | Développement piloté par les tests pour Noodle | MIT | — | NON (code) |
| `ast-grep` | Recherche structurelle de code | MIT | — | NON (code) |
| `go-best-practices` | Bonnes pratiques Go | MIT | — | NON (code) |
| `react-best-practices` | Bonnes pratiques React | MIT | — | NON (code) |
| `ts-best-practices` | Sûreté des types TypeScript | MIT | — | NON (code) |
| `interaction-design` | Micro-interactions, transitions, états de chargement | MIT | « Design soigné (pages web) » | IDÉE (compléter pour les pages animées des bots) |
| `make-interfaces-feel-better` | Principes pour des interfaces soignées (ombres, bordures, typo) | MIT | « Design soigné », « Règles de métier du design » | NON (déjà couvert) |
| `frontend-design` | Interfaces distinctives | Apache 2.0 | « Design soigné (pages web) », adaptée de la même source | NON (déjà adaptée) |
| `skill-creator` | Créer ou mettre à jour une compétence | Apache 2.0 | `skill_save` avec parties structurées (`tools.ts:761`) | NON (déjà couvert) |
| `find-skills` | Trouver et installer des compétences de l'écosystème | MIT | Import GitHub contrôlé (`skillsgithub.ts`, `skillscan.ts`) | NON (installation sans contrôle) |

Total : 29 lignes — 4 ADAPTER, 7 IDÉE, 18 NON.

## Écarts de comportement

Noodle n'a ni chat, ni voix, ni salons, ni inscription : seuls les flux « routine qui se déclenche », « tâche longue qui
échoue puis reprend », « redémarrage pendant le travail », « validations » et « mémoire » se comparent.

1. **Une routine qui se déclenche.**
   - Noodle : la condition est une phrase ; à chaque cycle, l'agent planificateur la confronte à un instantané d'état
     (backlog, évènements récents, historique) et décide ; on peut lire l'instantané.
   - Sklubot : une routine part sur une horloge, un webhook, un changement de page/fichier, un e-mail, un message Slack ou
     un évènement d'agenda (`routine_create`), avec « une exécution à la fois », retard affiché, mise en pause après
     plusieurs échecs (`scheduler.ts:261-265`). C'est plus prévisible et moins cher. Ce qui manque : une condition métier
     (« si un client n'a pas répondu depuis 5 jours »). Les coups de coude (`nudges.ts`) font une passe proactive, mais on
     ne peut pas leur donner sa propre phrase.
   - Correctif : routine « condition » = une phrase + une source (boîte mail, agenda, tableur) vérifiée à intervalle par
     une passe **lecture seule** bon marché (comme les coups de coude), qui ne lance le vrai tour que si la condition est
     vraie. Taille M.

2. **Tâche longue qui échoue au milieu, puis reprend / redémarrage.**
   - Noodle : au démarrage, il retrouve les étapes coincées « en fusion », adopte les sessions encore vivantes par PID,
     archive les commandes échouées avec un résumé pour que le planificateur décide de relancer.
   - Sklubot : `recoverInterruptedTurns` (`loop.ts:1664-1680`) reprend les tours coupés, prudemment si le bot avait déjà agi ;
     file durable ; cartes d'échec avec remèdes. **Équivalent, et plus prudent** sur les actions déjà faites. Rien à reprendre.

3. **Rediriger un bot en plein travail.** Noodle : interruption en direct, sinon arrêt et relance avec un **résumé de
   progression reconstruit depuis le journal** (`buildSteerResumeContext`). Sklubot : pour un tour API, le message est
   glissé entre deux étapes (`loop.ts:1046`) ; pour un moteur, il attend probablement la fin du tour (non vérifié) ; lors
   d'une bascule moteur → secours, Sklubot construit déjà la liste « ce qui a été fait, ne le refais pas »
   (`loop.ts:510-530`). Correctif : réutiliser ce même résumé quand l'utilisateur appuie sur « Stop » puis réécrit, pour que
   le tour suivant ne recommence pas de zéro. Taille S.

4. **Apprendre de son travail.** Noodle (avec brainmaxxing) : réfléchir après chaque session, distiller périodiquement,
   fouiller l'ancien. Sklubot : apprend des faits sur la personne, jamais des leçons sur son propre travail. Correctif
   commun aux audits mem0 et claude-mem : « leçons » proposées en carte + passe hebdomadaire de rangement. Taille M.

5. **Relecture.** Noodle : relecture par le modèle **opposé**, angles critiques multiples, problèmes numérotés avec deux
   options. Sklubot : un bot relecteur (souvent le même fournisseur) donne un verdict global. Correctif : choisir par défaut
   un relecteur d'un autre fournisseur quand il est disponible, et demander « problèmes numérotés + deux options ». Taille S.

## À faire (du plus utile au moins utile)

1. Leçons de travail (`reflect`) + rangement périodique de la mémoire (`meditate`) proposés en carte — M.
2. Routine « condition en langage courant » vérifiée en lecture seule, qui ne lance le tour que si c'est vrai — M.
3. Compétence « Écrire comme un humain » (adaptée d'`unslop`) pour e-mails et posts — S.
4. Relecteur d'un autre fournisseur par défaut, format « problèmes numérotés + deux options » — S.
5. Relecture automatique (porte qualité) à la fin d'une tâche de fond, si l'utilisateur l'active — S.
6. Résumé de progression réutilisé après « Stop » + nouvelle consigne — S.
7. Compétence « Clarifier une demande floue » (fusion `refine` + `clarify` de Spec Kit) — S.
8. Choix d'un petit modèle pour les étapes simples d'une tâche (routage par étape) — S.
9. Afficher « ce que le bot savait quand il a décidé » pour une routine ou un coup de coude — S.
10. Adaptateurs de backlog (Trello, Linear, Notion) avec « marquer fait » — M.

## Non vérifié

- Le comportement du pilotage pendant un tour de moteur Claude Code/Codex dans Sklubot.
- L'affichage de la raison d'un coup de coude ou d'une routine.
- Les raccourcis clavier des deux interfaces.
- Le dépôt `brainmaxxing` (cité par Noodle, non cloné).
