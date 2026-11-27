# Audit : mattpocock/skills (pack de compétences) face à Sklubot

Dépôt lu : https://github.com/mattpocock/skills, commit `abeeaf95660ba9e8b7c753eb38f441ca707a8823` (clone superficiel, rien exécuté, clone effacé ensuite).

## Comptes

39 compétences inventoriées (20 « engineering », 8 « in-progress », 4 « misc » gelées, 7 « productivity »), plus 4 mécanismes du dépôt.

| Verdict | Nombre |
|---|---|
| ADAPTER (texte réutilisable, MIT) | 6 |
| IDÉE (à réécrire pour Sklubot) | 11 |
| NON | 22 |

Statut côté Sklubot pour les 39 : FAIT 2 · PARTIEL 9 · MANQUANT 9 · DIFFÉRENT 3 · NON REPRIS 16.

## Licence

- Fichier `LICENSE` à la racine : **MIT License**, « Copyright (c) 2026 Matt Pocock ».
- Aucun dossier de compétence n'a sa propre licence : la MIT du dépôt couvre tout. Pour reprendre un texte : garder l'avis de copyright et le texte MIT (comme pour Hermes Bot Kit dans `server/skills-library/*/LICENSE.txt`).
- Exception à surveiller : `skills/engineering/pr/CREDITS.md` dit que la partie « Summary » de `pr` est recopiée presque mot pour mot de la compétence `show-me` du dépôt humanlayer/humanlayer. Sa licence n'a pas été vérifiée ici : ne pas reprendre ce passage sans la lire.
- Les fichiers `agents/openai.yaml` de chaque dossier ne servent qu'à l'affichage dans un autre outil : inutiles pour Sklubot.

## Ce que Sklubot a déjà (vérifié dans le code)

- Bibliothèque intégrée : 17 compétences dans `server/skills-library/catalog.json` (aucune ne vient de ce dépôt).
- Manuel de méthodes : `server/templates/methodes/manuel.md`, ~50 procédures en 11 familles, lues par l'outil `guide_read` (`server/src/agent/guides.ts:115`, chargé par `server/src/agent/workmethods.ts`). Familles proches de ce dépôt : « Cadrer une demande » (l.5), « Rechercher et décider » (l.26), « Modifier un logiciel existant » (l.194), « Utiliser les outils et transmettre le travail » (l.236, dont « Transmettre un dossier entre moteurs » l.249).
- Outils : `ask_user` avec réponses toutes prêtes (`server/src/agent/tools.ts:1205`), `helper_start` / `task_start` pour du travail en parallèle (`tools.ts:1123`, `server/src/agent/bgtasks.ts`), `memory_save` / `memory_search` (`tools.ts:862`, `:876`), `skill_save` / `skill_propose` (`tools.ts:761`, `:785`), `deep_research_start` (recherche approfondie avec registre de preuves, `server/src/researchevidence.ts`), `shell_run` sur l'ordinateur du bot (`tools.ts:301`).
- Relecture d'un bot par un autre sur une carte de fichiers : `server/src/peerreviewstore.ts`, `peerreviewroutes.ts` ; issues GitHub → modification → brouillon de PR avec vérification CI : `server/src/githubissues.ts`, `githubissuegit.ts`.
- Pas de notion de « glossaire », « ADR », « questionnaire », « rétrospective » ni de « TDD » dans `server/src`, `server/templates`, `server/skills-library` (grep vide).

## Tableau complet, une ligne par compétence

Licence de chaque dossier : MIT (celle du dépôt), sauf mention.

### productivity/ (utile à un non-développeur)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| grilling | Interroge l'utilisateur par « tours » : à chaque tour, toutes les questions dont les prérequis sont réglés, chacune avec la réponse recommandée (« oui » = accepter). Les faits, le bot les cherche lui-même au lieu de les demander. Fin quand plus rien n'est supposé en silence. | `ask_user` pose une question à la fois avec réponses prêtes (`tools.ts:1205`) ; manuel « Lever une incertitude à moindre coût » (manuel.md:18). Pas de méthode « arbre de décisions en tours ». | PARTIEL : il manque la règle « une salve de questions + réponse recommandée » et « ne jamais demander un fait qu'on peut trouver ». | **ADAPTER** : excellent pour cadrer un projet avec un patron non technique ; à traduire, et brancher sur la carte `ask_user` (plusieurs questions dans une carte). | S (texte) / M (carte multi-questions) |
| grill-me | Raccourci qui lance `grilling`. | — | NON REPRIS | NON (doublon de grilling) | — |
| handoff | Résume la conversation dans un document pour qu'un autre agent reprenne ; ne recopie pas ce qui existe déjà, renvoie par chemin ; masque clés et données perso. | `room_handoff` (passer la main dans un groupe), manuel « Transmettre un dossier entre moteurs » (manuel.md:249), contexte de reprise après erreur (`agent/failures.ts`). | DIFFÉRENT : Sklubot passe la main entre bots/moteurs dans le serveur ; pas de « fiche de passation » écrite que l'utilisateur peut lire. | IDÉE : ajouter au manuel la règle « masquer les secrets et données perso dans toute passation » et « pointer, ne pas recopier ». | S |
| teach | Transforme un dossier en « école » sur plusieurs séances : `MISSION.md` (pourquoi), ressources fiables, leçons HTML courtes et interactives, fiches mémo, journal de ce qui est acquis, distinction mémorisation à court / long terme. | Rien. `server/src/teach.ts` est l'inverse (l'utilisateur montre une tâche au bot, qui en fait une compétence). | MANQUANT | **ADAPTER** : un « bot professeur » est très parlant pour un non-développeur (apprendre Excel, l'anglais pro, la compta). Les leçons HTML collent aux pages de Sklubot (`page_publish`, bac à sable). Prévoir aussi un modèle d'équipe « Professeur particulier ». | M |
| to-questionnaire | Quand l'utilisateur ne peut pas décider seul : l'interroger seulement sur « à qui » et « ce qu'il faut récupérer », puis rédiger un questionnaire Markdown pour cette personne (contexte, comment répondre, questions par thème, la plus importante d'abord, une idée par question). | Rien (grep « questionnaire » vide). | MANQUANT | **ADAPTER** : très utile au quotidien (questions à un comptable, un fournisseur, un client). Sortie en fichier d'équipe ou en page. | S |
| wait-what | « Je n'ai pas compris : reformule » en anglais technique simplifié et avec le glossaire du projet. | Compétence « Réponses courtes » (`skills-library/conversation-courte`) et ton simple de `prompt.ts`. Pas de bouton « je n'ai pas compris ». | PARTIEL | IDÉE : un bouton « Explique plus simplement » sous une réponse, qui relance avec une consigne de reformulation. | S |
| writing-for-agents | Guide d'écriture des compétences et des fichiers de consignes : ce qui change vraiment le comportement, éviter les phrases sans effet, mécanique des compétences. | Contrôle de sécurité des compétences (`server/src/skillscan.ts`) ; pas de guide de rédaction pour `skill_save`. | PARTIEL : la qualité des compétences écrites par les bots n'est guidée que par la description de l'outil (`tools.ts:761`). | IDÉE : condenser 10 règles dans la description de `skill_save` / `skill_propose` et dans le manuel. | S |

### engineering/ (surtout pour un bot qui code sur son ordinateur)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| ask-matt | Routeur : dit quelle compétence ou quel enchaînement utiliser. | Répertoire `guide_read("methodes")` (`workmethods.ts`, `methodDirectory`). | FAIT (autrement) — no test vu pour le répertoire | NON (propre à ce dépôt) | — |
| code-review | Relit les changements depuis un point fixe sur deux axes en parallèle : respect des règles écrites du dépôt, et conformité à la demande d'origine ; rapport côte à côte. | Relecture par un autre bot d'une carte de fichiers (`peerreviewstore.ts`, `startPeerReview`) ; tests : `server/test` à vérifier, non lancés. | PARTIEL : la relecture Sklubot ne sépare pas « règles du dépôt » et « conforme à la demande ». | IDÉE : donner au bot relecteur ces deux axes dans sa consigne. | S |
| codebase-design | Vocabulaire des « modules profonds », « concevoir deux fois », où placer une couture. | Manuel « Modifier un logiciel existant » (manuel.md:194). | NON REPRIS | NON (trop développeur, Sklubot vise des non-développeurs) | — |
| diagnosing-bugs | Boucle de diagnostic : reproduire, hypothèses une par une, mesurer, avec un script de boucle humain-dans-la-boucle. | Manuel « Tester une hypothèse à la fois » (manuel.md:204), « Capturer le comportement de départ » (l.201). | PARTIEL (l'idée y est, en une ligne) | IDÉE : enrichir la procédure du manuel (reproduire d'abord, garder une trace par hypothèse). Ne pas reprendre le script `.sh`. | S |
| domain-modeling | Tenir un `GLOSSARY.md` et des ADR (notes de décision d'architecture). | Manuel « Rédiger une note de décision » (manuel.md:42). | PARTIEL | NON (développeur) ; l'idée « note de décision » existe déjà. | — |
| grill-with-docs | Comme grilling, mais écrit glossaire et ADR au fil de l'eau. | — | NON REPRIS | NON (développeur) | — |
| implement-spec | Implémente le résultat de to-spec / to-tickets. | — | NON REPRIS | NON (dépend de la chaîne du dépôt) | — |
| implement | Implémente un travail à partir d'un cahier des charges ou de tickets. | Méthode de travail (`skills-library/methode-de-travail`). | DIFFÉRENT | NON | — |
| improve-codebase-architecture | Cherche les modules à « approfondir », rapport HTML visuel, puis interroge sur le choix. | — | NON REPRIS | NON (développeur). L'idée « rapport HTML puis choix » existe via les pages. | — |
| pr | Rédiger le texte d'une demande de fusion (PR), avec visuels (arbres, Mermaid, diffs). | Brouillon de PR des issues GitHub (`githubissuegit.ts`, `openDraft`). | PARTIEL : le texte de PR Sklubot est généré sans guide. | IDÉE seulement : la partie « Summary » vient d'un autre dépôt (voir Licence). | S |
| prototype | Prototype jetable pour répondre à une question de logique ou d'interface. | Guide « artefact » (`guides.ts:14`) et compétence « Pages soignées ». | FAIT (pour l'interface : pages interactives) | NON (couvert) | — |
| research | Lance un agent en arrière-plan qui lit les sources primaires et écrit un fichier Markdown qui cite chaque affirmation. | `deep_research_start` + registre de preuves (`researchevidence.ts`, `researchreports.ts`) ; manuel « Remonter à la source primaire » (manuel.md:33). | FAIT (plus complet) | NON (couvert) | — |
| retro | Rétrospective d'une séance : navigation, contrôles automatiques, règles, consignes inutiles, coût des outils, accès à l'info ; propositions classées par gravité. | Coordinateur d'échecs (`agent/failures.ts`) et `skill_propose` après une tâche ; pas de bilan « qu'est-ce qui m'a fait perdre du temps ». | PARTIEL | IDÉE : une routine hebdo « bilan du bot » qui propose des règles/compétences à partir des échecs de la semaine (les données existent : `failures`, `tool_errors`). | M |
| setup-matt-pocock-skills | Configure le dépôt (gestionnaire de tickets, étiquettes, docs). | — | NON REPRIS | NON (propre au dépôt) | — |
| tdd | Développement piloté par les tests (rouge-vert-refactor), conseils sur les mocks. | — | MANQUANT | NON pour la bibliothèque grand public ; possible plus tard dans une famille « développeur » optionnelle. | S |
| to-spec | Transforme la conversation en cahier des charges publié dans le gestionnaire de tickets, sans nouvel interrogatoire. | Manuel « Écrire le brief en quatre lignes » (manuel.md:9). `create_task` existe. | PARTIEL | IDÉE : « fais-moi le cahier des charges de ce qu'on vient de dire » → fichier d'équipe. Généraliser hors code. | S |
| to-tickets | Découpe un plan en tickets « traçants », chacun avec ce qui le bloque. | `task_add` / `create_task` (tâches suivies, sans dépendances). | PARTIEL : pas de liens « bloqué par » entre tâches. | IDÉE : dépendances entre tâches du tableau. | M |
| triage | Fait passer issues et PR externes par des états (catégoriser, vérifier, interroger, fiche pour agent). | Lecture des issues GitHub (`githubissues.ts`). | NON REPRIS | NON (gestion de projet open source) | — |
| wayfinder | Grand chantier sur plusieurs séances : carte partagée de tickets de décision, résolus un par un. | Objectifs (`goal_propose` / `goal_update`, `agent/goals.ts`). | DIFFÉRENT | IDÉE : sous un objectif, une liste de décisions ouvertes à trancher avec l'utilisateur. | M |
| wizard | Génère un script bash interactif qui guide un humain dans les étapes que lui seul peut faire (ouvrir telle page, copier telle clé, saisie masquée). | `secret_request` (carte sécurisée pour une clé, `tools.ts:584`), `connector_request`, `ask_takeover`. | DIFFÉRENT : Sklubot le fait mieux pour un non-développeur (cartes dans l'appli, pas de terminal). | IDÉE : une carte « pas à pas » (étapes cochées, liens, champ secret masqué) au lieu d'une seule demande. Ne pas reprendre le script. | M |

### in-progress/ (instables, l'auteur les dit en cours)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| chief-of-staff | Un « chef de cabinet » poursuit un objectif long : tout faire faire par des sous-agents au contexte neuf, proposer des tâches récurrentes, tenir un **wiki** (index + une page par sujet, ingérer / consulter / nettoyer, écrire l'historique). | Objectifs, helpers (`tools.ts:1123`), routines (`tools.ts:898`), mémoire courte en phrases (`memory_save`) et fichiers d'équipe. | PARTIEL : pas de wiki structuré tenu par le bot, pas de « nettoyage » périodique de la mémoire (contradictions, pages orphelines). | **ADAPTER** (texte MIT, mais marqué « en cours ») : la partie wiki + routine de nettoyage est l'idée la plus forte du dépôt pour un bot qui travaille des mois. | M |
| claude-handoff | Passe la conversation à un agent neuf en arrière-plan. | `task_start` (`bgtasks.ts`). | FAIT | NON | — |
| loop-me | Interroge l'utilisateur sur les flux de travail qu'il veut construire. | Recruteur de bots (`agent/recruit.ts`). | PARTIEL | IDÉE : réutiliser la méthode grilling dans l'entretien du recruteur. | S |
| setup-ts-deep-modules | Branche dependency-cruiser dans un dépôt TypeScript. | — | NON REPRIS | NON (développeur) | — |
| software-factory | Vocabulaire pour concevoir une « usine logicielle » (exécuteurs, hébergeurs git, suivi). | — | NON REPRIS | NON | — |
| writing-fragments | Écriture, phase 1 : extraire des fragments bruts sans structure. | Rien de spécifique (modèles d'équipe « SEO contenu », « Réseaux sociaux » dans `server/templates/`). | MANQUANT | **ADAPTER** avec les deux suivantes, en une compétence « Écrire un article avec toi » en 3 temps. | S |
| writing-beats | Écriture, phase 2 : ordonner la matière en « temps », chaque terme expliqué avant d'être utilisé. | idem | MANQUANT | **ADAPTER** (voir ci-dessus) | S |
| writing-shape | Écriture, phase 3 : 2–3 débuts possibles, l'utilisateur choisit, puis paragraphe par paragraphe, écrit au fur et à mesure dans le fichier. | idem | MANQUANT | **ADAPTER** (voir ci-dessus) | S |

### misc/ (gelées par l'auteur)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict |
|---|---|---|---|---|
| git-guardrails-claude-code | Crochets qui bloquent les commandes git destructrices (push, reset --hard, clean, branch -D) avant exécution. | `server/src/agent/irreversible.ts:47` : motif qui reconnaît `git push --force/-f/--delete`, `reset --hard`, `clean -f`. | PARTIEL : `git branch -D` et un simple `git push` (non forcé) ne sont pas dans ce motif. | IDÉE (S) : ajouter `branch -D` au motif. Script propre à Claude Code : NON. |
| migrate-to-shoehorn | Migrer des tests TypeScript vers une bibliothèque précise. | — | NON REPRIS | NON |
| scaffold-exercises | Créer des dossiers d'exercices pour un cours. | — | NON REPRIS | NON |
| setup-pre-commit | Installer Husky + lint-staged. | — | NON REPRIS | NON |

### Mécanismes du dépôt (hors compétences)

| Mécanisme | Ce que c'est | Sklubot | Verdict |
|---|---|---|---|
| `disable-model-invocation: true` | Certaines compétences ne se lancent que si l'utilisateur les appelle (pas d'initiative du modèle). | Les compétences Sklubot sont lues quand le bot le décide (`skill_read`). Pas d'option « seulement sur demande ». | IDÉE (S) : un drapeau « seulement quand je le demande » par compétence, utile pour les procédures lourdes. |
| `argument-hint` | Indice affiché pour ce qu'il faut taper après la commande. | FAIT : `/skill <nom>` en début de message force une compétence, avec liste de choix (`web/src/components/Composer.tsx:49-69`, `server/src/agent/loop.ts:337`). Pas d'indice « quoi taper après ». | IDÉE (S) : afficher l'indice d'argument de la compétence dans la liste `/skill`. |
| `.out-of-scope/` | Un fichier par idée refusée, avec la raison. | `docs/FEUILLE-DE-ROUTE.md`, `docs/COUVERTURE.md`. | NON (organisation du projet) |
| Fichiers annexes (`*-FORMAT.md`, `DEEPENING.md`…) chargés à la demande | Une compétence = un court `SKILL.md` + des annexes lues seulement si besoin. | L'import GitHub ne lit **que** `SKILL.md` (COMPETENCES.md §2 : « autres fichiers non importés »). | PARTIEL : une compétence importée de ce dépôt perd ses annexes (ex. `teach` perd ses 4 formats, `tdd` perd `mocking.md`). IDÉE (M) : importer aussi les `.md` voisins (texte seulement, même contrôle de sécurité). |

## Écarts de comportement (court, c'est un pack de textes)

1. **Questions à l'utilisateur.** Le dépôt : une salve de questions numérotées, chacune avec la réponse conseillée, et le bot cherche lui-même les faits. Sklubot : `ask_user` termine le tour avec une question et quelques réponses prêtes (`tools.ts:1205`). Pour un cadrage, cela fait beaucoup d'allers-retours. Correctif : permettre plusieurs questions dans une carte, avec une réponse conseillée pré-cochée.
2. **Import d'une compétence de ce dépôt.** Plusieurs compétences renvoient à des annexes (`[MISSION-FORMAT.md](./MISSION-FORMAT.md)`). L'import Sklubot ne garde que `SKILL.md` : le bot suivrait un lien vers un fichier absent. Correctif : importer les `.md` voisins ou signaler « cette compétence cite N fichiers non importés » dans la carte d'import.
3. **Mémoire sur la durée.** Le dépôt (chief-of-staff) : un wiki relu avant chaque décision et nettoyé régulièrement. Sklubot : phrases courtes en mémoire, cherchées par mots-clés « sans synonymes » (description de `memory_search`, `tools.ts:876`). Sans nettoyage, des faits contradictoires s'accumulent. Correctif : routine de nettoyage de la mémoire proposée par le bot (contradictions, doublons), avec accord.
4. **Passation.** Le dépôt impose de masquer clés et données personnelles dans toute fiche de passation. Côté Sklubot, `pastedsecrets.ts` existe (détection de secrets collés) ; non vérifié qu'il s'applique aux résumés de passation `room_handoff`.

## À faire, par ordre de valeur

1. Compétence « Interroger pour cadrer » adaptée de `grilling` (salve de questions + réponse conseillée, faits cherchés par le bot) — S ; puis carte `ask_user` à plusieurs questions — M.
2. Compétence « Professeur particulier » adaptée de `teach` (mission, ressources fiables, leçons en pages, fiches, suivi des acquis) + modèle d'équipe — M.
3. Compétence « Questionnaire à envoyer » adaptée de `to-questionnaire` — S.
4. Compétence « Écrire un article avec toi » (fragments → temps → mise en forme) adaptée des 3 `writing-*` — S.
5. Wiki du bot + routine de nettoyage de la mémoire, idée de `chief-of-staff` — M.
6. Import GitHub : prendre aussi les fichiers `.md` voisins d'un `SKILL.md`, ou au moins avertir — M.
7. Routine « bilan de la semaine » qui transforme les échecs en propositions de règles/compétences (idée `retro`) — M.
8. Carte « pas à pas » pour les étapes que seul l'humain peut faire (idée `wizard`) — M.
9. Relecture entre bots sur deux axes : règles écrites / conformité à la demande (idée `code-review`) — S.
10. Drapeau « seulement quand je le demande » (la compétence ne sert que via `/skill`, qui existe déjà) — S.
11. Liens « bloqué par » entre tâches (idée `to-tickets`) et décisions ouvertes sous un objectif (idée `wayfinder`) — M.
12. Bouton « Explique plus simplement » (idée `wait-what`) — S.
13. Ajouter `git branch -D` au motif des commandes irréversibles (`irreversible.ts:47`) — S.

## Non vérifié

- La licence de humanlayer/humanlayer (passage recopié dans `pr`).
- Les tests de la relecture entre bots : `server/test/github-issue-workflow.test.ts` la mentionne, non lancé.
- Que la détection de secrets s'applique aux passations entre bots.
