# Audit de Spec Kit (github/spec-kit) face à Sklubot

Date : 22/11/2026. Clone `--depth 1` en lecture seule (version 1.4.4.dev0), rien exécuté. Lu : `README.md`,
`templates/commands/*.md`, `templates/*-template.md`, `extensions/*`, `presets/*`, `workflows/*`, `bundles/*`, la liste des
modules de `src/specify_cli` (moteur de workflows, téléchargements, catalogues). Côté Sklubot : `server/skills-library/catalog.json`
(16 compétences), `docs/COMPETENCES.md`, `server/templates/`, `server/src/agent/guides.ts` (9 guides), `goals.ts`,
`store.ts` (`skillText`), `tools.ts` (`ask_user`, `skill_save`), `routines.ts`, `skillscan.ts`, `docker/desktop/Dockerfile`.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 7 | 10 | 7 | 5 | 12 |

(41 lignes de mécanismes ; plus 38 lignes de compétences/commandes : 6 ADAPTER, 14 IDÉE, 18 NON.)

## Licence

**MIT License, « Copyright GitHub, Inc. »** (`LICENSE`). Un seul autre fichier de licence : `extensions/template/LICENSE`
(modèle à copier). Tout peut être copié, modifié, revendu, en gardant l'avis MIT. Les catalogues « communautaires »
(204 extensions, 44 préréglages, 4 workflows) pointent vers des dépôts tiers aux licences variées : le README dit
lui-même qu'ils **ne sont ni audités ni recommandés**.

## Ce qu'est Spec Kit

Un **pack de commandes (compétences) et de modèles** pour agents de code, plus une CLI Python (`specify`) qui les installe
dans un projet. La méthode « Spec-Driven Development » : constitution (principes du projet) → spécification (quoi et
pourquoi, sans technique) → clarification (5 questions au plus) → plan → tâches → exécution → « convergence » (comparer le
résultat à la spec et ajouter ce qui manque). Deux méthodes en extension : **corriger un bogue** (évaluer → corriger →
vérifier) et **évaluer une idée** (accueil → recherche → définition → mise en forme → décision go / à clarifier / stop). Un
moteur de workflows enchaîne les commandes avec des **portes de validation humaine**.

Le public de Spec Kit, ce sont des développeurs ; mais plusieurs méthodes sont **générales** et valent pour un patron de
PME qui confie un projet à ses bots : clarifier avant d'agir, évaluer une idée, vérifier qu'un livrable couvre la demande.

## Peut-on l'installer dans l'image de bureau des bots ?

**Possible mais inutile par défaut ; à garder pour un usage « projet de code » à la demande.**
- `specify-cli` est un paquet Python (PyPI) sous MIT, sans télémétrie trouvée (le seul mot « telemetry » est un
  commentaire sur les crochets d'autres outils, `src/specify_cli/events/__init__.py:514`). Les téléchargements de modèles
  sont bornés (taille, extraction d'archives, liens symboliques refusés : `_download_security.py`, `_file_policy.py`).
- Le bureau a déjà `uv` et Claude Code/Codex (`docker/desktop/Dockerfile:28-44`). Une ligne épinglée
  (`uv tool install specify-cli==<version>`) suffirait. Mais la CLI ne fait qu'**écrire des fichiers de consignes** dans un
  dépôt ; elle n'apporte rien à un bot qui ne fait pas de code, et les catalogues communautaires installeraient du code
  tiers non relu. Mieux : le laisser à `sklubot-install` (installation à la demande) et **interdire** les catalogues
  communautaires.
- **Ce que renvoie l'outil** : des fichiers `spec.md`, `plan.md`, `tasks.md`, des listes de contrôle, des rapports
  d'analyse dans `.specify/` ; dans un workflow, un état de passage (étape, verdict de porte) qu'on peut reprendre.
  **Ce que renvoie l'équivalent Sklubot** : une compétence lue par `skill_read` (texte avec « Use when / Needs / Steps /
  Approvals / How to check / What to hand back », `store.ts:548-557`), un objectif avec tours et preuve de fin
  (`goals.ts`), des cartes de question et d'accord. Pas de fichiers de spécification ni de portes déclaratives.

## Tableau des mécanismes

Taille : S = moins d'une journée, M = quelques jours, L = une semaine ou plus.

| Domaine | Fonction Spec Kit | Statut | Preuve Sklubot (fichier:ligne) | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Méthode | Constitution : principes du projet relus avant chaque étape | FAIT | Consignes de projet (`prompt.ts:246`), règles en langage naturel (`rules.ts`), consignes du bot (`prompt.ts:247`) | — | — |
| Méthode | Spécification sans technique, avec récits utilisateurs prioritaires (P1, P2…), scénarios « Étant donné / Quand / Alors », critères de réussite mesurables, cas limites (`templates/spec-template.md`) | MANQUANT | — | Pour un gros travail confié à un bot (site, campagne, dossier), aucun document « ce que tu attends exactement » n'est produit et validé | M |
| Méthode | Marques `[NEEDS CLARIFICATION]` : l'agent ne devine pas, il marque | PARTIEL | Consigne générale de demander ce qui manque (`prompt.ts:239` « ask for the specific missing input ») | Pas de liste visible des points flous | S |
| Méthode | Clarification : au plus 5 questions ciblées, choisies par une grille (portée, données, parcours, erreurs, contraintes…), une à la fois, réponses écrites dans la spec (`templates/commands/clarify.md`) | PARTIEL | `ask_user` (une question, 6 choix, `tools.ts:1205`) | Pas de méthode « grille + 5 questions max + réponses consignées » | S |
| Méthode | Plan technique séparé de la spec (`plan-template.md`) | PARTIEL | `goal_propose` (objectif seul) | Voir audit Plannotator : plan par étapes à approuver | M |
| Méthode | Tâches ordonnées par dépendances, marquées parallélisables `[P]`, groupées par récit utilisateur (`tasks-template.md`) | PARTIEL | Tâches du bot (`task_add`, `task_update`), assistants en parallèle (`helper_start`) | Pas d'ordre de dépendance ni de marque « peut se faire en parallèle » | S |
| Méthode | Analyse de cohérence non destructive entre spec, plan et tâches (`analyze.md`) | MANQUANT | — | « Est-ce que mon plan couvre toute la demande ? » avant d'agir | S |
| Méthode | Convergence : comparer le résultat à la spec et ajouter ce qui manque comme nouvelles tâches, jusqu'à « Converged » (`converge.md`) | PARTIEL | Mode objectif : tours jusqu'à « terminé avec preuve » ou « bloqué » (`goals.ts` en-tête) | La preuve n'est pas comparée point par point à une liste de critères écrite au départ | M |
| Méthode | Listes de contrôle personnalisées (« tests unitaires pour l'anglais ») — `checklist.md` | PARTIEL | Champ « How to check the result » d'une compétence (`store.ts:554`) | Pas de liste cochée générée pour un livrable | S |
| Méthode | Passations (« handoffs ») : chaque commande propose la suivante | FAIT | Cartes et propositions de suite ; compétence « Méthode de travail » | — | — |
| Workflows | Moteur de workflows déclaratifs (YAML) : étapes `command`, `gate`, `if_then`, `do_while`, `fan_out`, `fan_in`, `github`, `init` (`src/specify_cli/workflows/step/`) | MANQUANT | Routines (une consigne déclenchée), objectifs (tours), tâches | Pas d'enchaînement « étape 1 → validation → étape 2 → si… alors… » défini par l'utilisateur | L |
| Workflows | **Porte de validation** entre deux étapes (approuver / rejeter → arrêter) | PARTIEL | Accords d'actions, `goal_propose`, compétences avec « Steps that need the user's approval » (`store.ts:553`) | La validation porte sur une action, pas sur « le livrable de l'étape 1 avant l'étape 2 » | M |
| Workflows | Reprise d'une exécution interrompue (`command_resume.py`, état persistant) | FAIT | File durable des bots (`bot_queue`), reprise après redémarrage (`recoverInterruptedTurns` `loop.ts:1664`), objectifs qui survivent | — | — |
| Workflows | Surcouches (« overlays ») pour modifier un workflow installé sans le copier | NON REPRIS | — | — | — |
| Workflows | Entrées demandées au lancement (`inputs: prompt:`) | PARTIEL | Routine avec texte fixe | Pas de formulaire de paramètres au lancement d'une routine | S |
| Extensions | Crochets avant/après une commande (`hooks.before_clarify`…), obligatoires ou facultatifs | DIFFÉRENT | Règles qui s'appliquent à chaque action ; relecteur automatique (mode Auto) | — | — |
| Extensions | **Erreur de lecture d'un fichier de crochets jamais ignorée en silence** (`clarify.md` : « do not skip silently ») | FAIT | Esprit identique : `failures.ts` (cartes avec remèdes), « Jamais d'impasse » | — | — |
| Extensions | Évènements du cycle de vie de l'agent (`specify event`) | NON REPRIS | — | — | — |
| Préréglages | Remplacer modèles, commandes, vocabulaire, méthode pour une équipe ; normes réglementaires | PARTIEL | Modèles d'équipe (`server/templates/*.md`, `docs/MODELES-EQUIPE.md`), format d'équipe (`teammd.ts`) | Pas de « couche » qui remplace une compétence de base pour toute une organisation | M |
| Préréglages | Remplacement local à un projet, ordre de résolution des couches | DIFFÉRENT | Une compétence du bot gagne sur une compétence partagée de même nom (`prompt.ts:229`) | — | — |
| Préréglages | Inventaire : « quelle couche fournit cette commande ? » (`artifacts`) | MANQUANT | — | Dire d'où vient une compétence (bibliothèque, import GitHub, appris) est fait par drapeau, pas par inventaire | S |
| Catalogues | Catalogues officiels et communautaires, recherche (`specify extension search`) | PARTIEL | Bibliothèque de 16 compétences (`skills-library/catalog.json`), import GitHub (`skillsgithub.ts`) | Pas de recherche dans un catalogue tiers ; c'est voulu | — |
| Catalogues | Catalogue privé d'une organisation, avec authentification | MANQUANT | — | Utile pour une agence qui veut ses compétences validées | M |
| Catalogues | Avertissement « une liste n'est pas un audit » | FAIT | Contrôle de sécurité des compétences importées : brouillon tant que non accepté (`skillscan.ts`, `store.ts:558`) | Sklubot fait plus : analyse du texte | — |
| Catalogues | Hors ligne / derrière un pare-feu (sources locales) | DIFFÉRENT | Bibliothèque embarquée dans le serveur | — | — |
| Sécurité | Téléchargements bornés, extraction d'archives sûre, liens symboliques refusés (`_download_security.py`, `_file_policy.py`) | FAIT | `uploadlimits.ts`, `tarstream.ts`, `backuparchive.ts` | — | — |
| Sécurité | Bundles : ensemble prêt pour un rôle (« bugfix », « assess ») | FAIT | Modèles d'équipe : bots + compétences par métier (`server/templates/*.md`) | — | — |
| Intégrations | 43 agents de code pris en charge (Copilot, Claude, Gemini, Cursor…) | NON REPRIS | Moteurs Claude Code et Codex | — | — |
| Intégrations | Serveur MCP de la CLI (`command_mcp.py`) | NON REPRIS | — | — | — |
| Intégrations | Mise à jour du fichier de contexte de l'agent (`agent-context`) | NON REPRIS | — | — | — |
| Intégrations | Git : créer la branche, valider son nom, commit auto | NON REPRIS | — | Code | — |
| Intégrations | GitHub : transformer les tâches en tickets | DIFFÉRENT | Outils GitHub (`githubissues.ts`) | Pas depuis une liste de tâches | — |
| CLI | `specify init`, `check`, `version`, mise à jour, désinstallation | NON REPRIS | — | — | — |
| CLI | Scripts en bash, PowerShell et Python pour chaque commande | NON REPRIS | — | — | — |
| CLI | Auto-test des extensions (`selftest`) | NON REPRIS | — | — | — |
| Docs | README en anglais, japonais, coréen, chinois ; « spec-driven.md » (philosophie) | DIFFÉRENT | Docs en français | — | — |
| Docs | Guides air-gapped, CI, projets existants | NON REPRIS | — | — | — |
| Docs | Citation académique (`CITATION.cff`), lettres d'information | NON REPRIS | — | — | — |
| Qualité | Tests nombreux (`tests/`), versionnage des opérations | NON REPRIS | Tests Sklubot (`server/test`, 115 fichiers) | — | — |
| Méthode | Évaluation d'une idée avant d'investir (accueil → recherche → définition → forme → décision) | MANQUANT | Guide « Recherche et synthèse » (`guides.ts:86`) | Voir compétences : **à adapter** | S |
| Méthode | Correction de bogue en 3 temps avec rapport par bogue (évaluer → corriger → vérifier que le symptôme a disparu) | MANQUANT | Incidents (`failures.ts`), « Incidents » à l'écran | Pour un utilisateur : « ça ne marche pas » sur un site ou un fichier livré par le bot → évaluer, réparer, prouver | S |

## Compétences et commandes, une par ligne

Licence de chaque dossier : MIT (celle du dépôt ; aucun dossier n'a de licence propre sauf le modèle d'extension, MIT
aussi). Équivalents cherchés dans `server/skills-library/catalog.json`, `server/templates/`, `guides.ts`,
`docs/COMPETENCES.md`.

| Compétence / commande | Ce qu'elle fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `speckit.constitution` | Crée ou met à jour les principes du projet | MIT | Consignes de projet, règles | NON (déjà couvert) |
| `speckit.specify` | Écrit la spécification depuis une demande en langage courant | MIT | — | **ADAPTER** : « Cahier des charges » d'un projet confié au bot (quoi, pour qui, critères de réussite, hors périmètre), validé en carte |
| `speckit.clarify` | Détecte les zones floues, pose 5 questions max une à une, consigne les réponses | MIT | `ask_user` | **ADAPTER** : compétence « Clarifier avant d'agir » (grille simple, 3 à 5 questions, réponses gardées) |
| `speckit.plan` | Plan technique et documents de conception | MIT | `goal_propose` | IDÉE (plan par étapes, voir Plannotator) |
| `speckit.tasks` | Liste de tâches ordonnée par dépendances, `[P]` pour parallèle | MIT | `task_add` | IDÉE |
| `speckit.analyze` | Vérifie la cohérence spec / plan / tâches sans rien modifier | MIT | — | **ADAPTER** : « Relire mon plan contre la demande » avant de lancer un gros travail |
| `speckit.checklist` | Génère une liste de contrôle sur mesure | MIT | « How to check » des compétences | **ADAPTER** : liste de vérification d'un livrable (devis, site, e-mail de masse) |
| `speckit.implement` | Exécute les tâches une par une | MIT | Mode objectif | NON (déjà couvert par les tours) |
| `speckit.converge` | Compare le résultat à la spec, ajoute ce qui manque | MIT | Objectif « terminé avec preuve » | **ADAPTER** : à la fin d'un objectif, cocher chaque critère de réussite avec sa preuve |
| `speckit.assess.intake` | Normalise une idée brute (texte, lien, ticket) | MIT | — | IDÉE (partie de « Évaluer une idée ») |
| `speckit.assess.research` | Rassemble des preuves : clients, marché, existant, données | MIT | Guide « Recherche et synthèse », recherche approfondie (`researchreports.ts`) | IDÉE |
| `speckit.assess.define` | Définit le problème : qui, quelle douleur, buts, non-buts, mesures | MIT | — | IDÉE |
| `speckit.assess.shape` | Options de solution, périmètre, « appétit », compromis | MIT | — | IDÉE |
| `speckit.assess.decide` | Porte go / à clarifier / stop | MIT | — | **ADAPTER** : les 5 étapes d'« assess » réunies en **une** compétence « Évaluer une idée » pour entrepreneurs (verdict argumenté) |
| `speckit.bug.assess` | Évalue un rapport de bogue, propose un remède | MIT | Incidents | IDÉE (« ça ne marche pas » sur un livrable) |
| `speckit.bug.fix` | Applique le remède, note ce qui a changé | MIT | Carte « Fichiers modifiés » | IDÉE |
| `speckit.bug.test` | Vérifie que le symptôme d'origine a disparu, rapport | MIT | Relecture par un autre bot (`peerreview.ts`) | IDÉE |
| `speckit.git.commit` | Commit automatique après une commande | MIT | — | NON (code) |
| `speckit.git.feature` | Crée une branche numérotée | MIT | — | NON (code) |
| `speckit.git.initialize` | Initialise un dépôt | MIT | — | NON (code) |
| `speckit.git.remote` | Détecte l'adresse du dépôt distant | MIT | — | NON (code) |
| `speckit.git.validate` | Vérifie le nom de branche | MIT | — | NON (code) |
| `speckit.github.taskstoissues` | Tâches → tickets GitHub | MIT | `githubissues.ts` | NON (développeurs) |
| `speckit.agent-context.update` | Met à jour le fichier de contexte de l'agent | MIT | — | NON |
| `selftest` | Teste le cycle de vie d'une extension | MIT | — | NON |
| `extensions/template` (`example`) | Modèle pour écrire une extension | MIT | — | NON |
| Préréglage `lean` | Commandes minimales : juste la consigne, juste le livrable | MIT | — | IDÉE (version courte des compétences pour petits modèles) |
| Préréglage `constitution-sync` | Propage les principes dans les modèles | MIT | — | NON |
| Préréglage `scaffold` | Modèle de préréglage | MIT | — | NON |
| Préréglage `self-test` | Remplace tous les modèles pour tester | MIT | — | NON |
| Workflow `speckit` | specify → porte → plan → porte → tasks → implement | MIT | Objectifs | IDÉE (portes entre étapes) |
| Workflow `bugfix` | évaluer → porte humaine → corriger → tester | MIT | — | IDÉE |
| Workflow `assess` | accueil → … → décision avec porte de verdict | MIT | — | NON (repris dans la compétence « Évaluer une idée ») |
| Bundle `assess` | Ensemble prêt « tri des idées » | MIT | Modèles d'équipe | NON (doublon) |
| Bundle `bugfix` | Ensemble prêt « tri des bogues » | MIT | — | NON (doublon) |
| Modèle `spec-template.md` | Gabarit de spécification | MIT | — | IDÉE (base du « Cahier des charges ») |
| Modèle `checklist-template.md` | Gabarit de liste de contrôle | MIT | — | IDÉE |
| Modèle `tasks-template.md`, `plan-template.md`, `constitution-template.md` | Gabarits techniques | MIT | — | NON (code) |

Total : 38 lignes — 6 ADAPTER, 14 IDÉE, 18 NON.

## Écarts de comportement (court)

1. **Une demande floue et ambitieuse** (« fais-moi un site pour mon restaurant »).
   - Spec Kit : l'agent écrit d'abord une spec (pour qui, quoi, critères de réussite, hors périmètre), marque les points
     flous, pose au plus 5 questions **une à la fois** avec une réponse recommandée, puis seulement planifie.
   - Sklubot : le prompt dit « Deliver the result or ask for the specific missing input » (`prompt.ts:239`). Selon le
     modèle, le bot se lance avec des suppositions ou pose une liste de questions d'un coup. Rien ne garde les réponses
     pour la suite du travail (sauf la mémoire si l'utilisateur les répète).
   - Correctif : compétence de bibliothèque « Clarifier avant d'agir » (3 à 5 questions une à une, choix recommandé, réponses
     écrites dans une note de projet) et « Cahier des charges » validé en carte pour tout objectif. Taille S.

2. **Savoir quand c'est fini.** Spec Kit « converge » : chaque critère de la spec est vérifié contre le résultat, ce qui
   manque redevient tâche. Sklubot : le bot déclare l'objectif terminé « avec preuve » (`goals.ts`), mais la preuve n'est
   pas confrontée à une liste écrite au départ. Correctif : quand un objectif est accepté, enregistrer 3 à 7 critères de
   réussite ; la clôture exige une preuve par critère, montrée dans la carte. Taille M.

3. **Enchaîner des étapes avec validation.** Spec Kit : workflow YAML avec portes ; on reprend où on s'était arrêté.
   Sklubot : une routine lance une consigne ; un objectif avance par tours ; il n'y a pas d'« étape 2 seulement après ton
   accord sur l'étape 1 » définie par l'utilisateur. Correctif minimal : dans un objectif, une étape marquée « attend
   ton accord » met l'objectif en pause avec une carte montrant le livrable de l'étape. Taille M.

## À faire (du plus utile au moins utile)

1. Compétence « Clarifier avant d'agir » (adaptée de `clarify`) — S.
2. Compétence « Évaluer une idée » (adaptée d'`assess`, en une seule compétence, verdict go / à préciser / stop) — S.
3. Critères de réussite enregistrés à l'acceptation d'un objectif, et clôture avec preuve par critère (adapté de `converge`) — M.
4. « Cahier des charges » d'un projet confié au bot, validé en carte (adapté de `specify` + `spec-template`) — M.
5. Compétence « Liste de vérification d'un livrable » (adaptée de `checklist`) — S.
6. « Relire mon plan contre la demande » avant un gros travail (adapté d'`analyze`) — S.
7. Étape « attend ton accord » dans un objectif (porte entre deux étapes) — M.
8. Formulaire de paramètres au lancement d'une routine — S.
9. Compétence « Réparer un livrable qui ne marche pas » (évaluer → réparer → prouver) — S.
10. Catalogue privé de compétences pour une organisation — M.

## Non vérifié

- Le comportement réel des commandes avec un agent (non lancées).
- Le contenu des 204 extensions communautaires (non lues, volontairement).
- La qualité des réponses de Sklubot face à une demande floue (pas de test de bout en bout lancé).
