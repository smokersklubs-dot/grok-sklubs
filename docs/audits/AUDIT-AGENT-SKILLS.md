# Audit : addyosmani/agent-skills (pack de compétences) face à Sklubot

Dépôt lu : https://github.com/addyosmani/agent-skills, commit `8c99fa36d90068c82d547f7c12a9d67a3e95f4ee` (clone superficiel, rien exécuté, clone effacé ensuite).

## Comptes

26 compétences, 5 « personas » (agents), 10 commandes, 7 listes de contrôle (`references/`), 4 mécanismes (crochets, évaluations, plugins multi-outils, cache) = 52 lignes.

| Verdict | Nombre |
|---|---|
| ADAPTER (texte réutilisable, MIT) | 5 |
| IDÉE (à réécrire) | 16 |
| NON | 31 |

Statut côté Sklubot (52 lignes) : FAIT 4 · PARTIEL 16 · MANQUANT 9 · DIFFÉRENT 3 · NON REPRIS 20.

## Licence

- `LICENSE` : **MIT License**, « Copyright (c) 2025 Addy Osmani ». Aucun dossier n'a de licence propre : la MIT couvre tout. Reprise possible avec l'avis de copyright.
- Taille : `code-review-and-quality` (21 648 caractères) et `constraint-driven-development` (22 205) dépassent la limite d'import de Sklubot (`MAX_SKILL_CHARS = 20_000`, `server/src/skillsgithub.ts:154`) : l'import les refusera « trop longue ». Les autres font 6 à 17 ko : importables, mais trop longues pour être mises en entier dans le prompt (Sklubot n'inline les compétences que si leur total fait ≤ 6 000 caractères, `server/src/agent/prompt.ts:230` ; sinon il liste les noms et le bot les lit avec `skill_read`).
- Pack 100 % orienté développeurs (spécifier, coder, tester, livrer). Pour le public de Sklubot (non-développeurs), seules 4–5 compétences parlent directement à l'utilisateur.

## Ce que Sklubot a déjà (vérifié)

- Bibliothèque : 17 compétences (`server/skills-library/catalog.json`), aucune de ce dépôt. Design et accessibilité des pages : `metier-du-design`, `pages-soignees`, `frontend-design` (grep WCAG/contraste positif).
- Manuel de méthodes (`server/templates/methodes/manuel.md`), familles « Cadrer une demande » (l.5), « Rechercher et décider » (l.26), « Concevoir une interface utilisable » (l.152), « Modifier un logiciel existant » (l.194), « Réviser et livrer un artefact » (l.215).
- Outils : `ask_user` (`server/src/agent/tools.ts:1205`), `helper_start` (`:1123`), `shell_run` (`:301`), `browser_open`/`element_snapshot` (`:150`, `:212`), relecture entre bots (`server/src/peerreviewstore.ts`), issues GitHub → brouillon de PR + CI (`server/src/githubissuegit.ts`), garde-fou des commandes irréversibles (`server/src/agent/irreversible.ts:47`).
- Ordinateur du bot (`docker/desktop/Dockerfile:12`) : Chromium présent ; pas de Lighthouse, axe-core, pa11y ni serveur MCP Chrome DevTools.

## Tableau complet

Licence de chaque ligne : MIT (dépôt).

### Compétences « cadrer » (utiles à tous)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| interview-me | Trouver ce que la personne veut vraiment : écrire une hypothèse en une phrase avec un pourcentage de confiance, poser **une** question à la fois, s'arrêter vers 95 % ; ne pas l'utiliser en routine ou sans humain présent. | `ask_user` (une question, réponses prêtes) ; manuel « Écrire le brief en quatre lignes » (manuel.md:9). | PARTIEL : pas de méthode « hypothèse + confiance + arrêt », pas de règle « jamais en routine ». | **ADAPTER** : la meilleure compétence du pack pour un patron non technique. Ajouter la règle « pas pendant une routine ou une tâche de fond : noter la question pour plus tard ». | S |
| idea-refine | Affiner une idée floue : reformuler, varier (divergence), regrouper et éprouver (convergence), finir par une page « one-pager » ; annexes cadres de pensée, critères, exemples. | Rien de dédié. | MANQUANT | **ADAPTER** (texte + `frameworks.md`, `refinement-criteria.md` ; pas le script `.sh`) : « aide-moi à creuser mon idée de business ». Sortie en page Sklubot. | S |
| spec-driven-development | Écrire un cahier des charges (objectifs, périmètre, critères) avant de construire. | Manuel « Écrire le brief » (l.9), « Définir le test de réception » (l.12). | PARTIEL : deux lignes de manuel, pas de modèle de document. | IDÉE : un modèle « cahier des charges » dans `modeles-de-pages` (déjà « cahier des charges » cité dans le catalogue : vérifier qu'il suffit). | S |
| planning-and-task-breakdown | Découper un travail en tâches ordonnées, estimer, repérer ce qui peut se faire en parallèle. | `task_add`/`create_task`, objectifs (`agent/goals.ts`), `helper_start` pour le parallèle. | PARTIEL : pas d'ordre ni de dépendances entre tâches. | IDÉE : dépendances et ordre dans le tableau de tâches. | M |
| doubt-driven-development | Faire contre-examiner chaque décision non triviale par un relecteur « à contexte neuf » avant de la garder ; liste précise de ce qui est non trivial (irréversible, frontière, propriété invérifiable). | Relecture entre bots sur une carte de fichiers (`peerreviewstore.ts`) ; `helper_start` peut servir de relecteur neuf. | PARTIEL : la relecture n'est déclenchée qu'à la demande, pas avant une affirmation risquée (« c'est sûr », « ça passe »). | IDÉE : dans « Méthode de travail », avant une action irréversible ou une affirmation non vérifiable, faire relire par un helper neuf. | S |
| source-driven-development | Fonder chaque choix sur la documentation officielle, citer la source. | Manuel « Remonter à la source primaire » (l.33), registre de preuves de la recherche approfondie (`server/src/researchevidence.ts`). | FAIT (recherche) — test : non cherché | NON (couvert) | — |
| context-engineering | Bien préparer le contexte d'un agent (fichiers de règles, changement de tâche, qualité qui baisse). | Sklubot gère le contexte côté serveur (`server/src/agent/context.ts`). | DIFFÉRENT | NON (l'utilisateur n'a pas à le faire) | — |
| using-agent-skills | Méta-compétence : comment trouver et lancer la bonne compétence. | Liste « Your skills » dans le prompt (`prompt.ts:226-239`). | FAIT (autrement) | NON | — |

### Compétences « construire » (développeur)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| incremental-implementation | Livrer par tranches fines et vérifiables, derrière un interrupteur si besoin. | Manuel « Livrer une modification verticale » (l.207), « Prioriser un premier parcours complet » (l.21). | FAIT (en résumé) | NON | — |
| test-driven-development | Rouge-vert-refactor, prouver par un test, test pour chaque bogue signalé. | Rien. | MANQUANT | NON pour le grand public ; possible dans une famille « Développeur » optionnelle (le texte est sous MIT). | S |
| debugging-and-error-recovery | Recherche de cause racine pas à pas : reproduire, isoler, corriger, empêcher le retour. | Manuel « Tester une hypothèse à la fois » (l.204). | PARTIEL | IDÉE : enrichir la procédure du manuel. | S |
| api-and-interface-design | Concevoir des API et contrats stables. | — | NON REPRIS | NON (développeur) | — |
| frontend-ui-engineering | Interfaces accessibles, adaptatives, « qualité production ». | `frontend-design`, `metier-du-design`, `pages-soignees`. | FAIT | NON (couvert) | — |
| code-simplification | Simplifier du code sans changer son comportement. | — | NON REPRIS | NON | — |
| deprecation-and-migration | Retirer un vieux système, migrer une base sans coupure (expand/contract). | — | NON REPRIS | NON | — |
| git-workflow-and-versioning | Branches, commits atomiques, conflits, PR. | Brouillon de PR des issues GitHub (`githubissuegit.ts`). | NON REPRIS | NON (développeur) | — |
| constraint-driven-development | Écrire la barre de qualité du projet (chiffres) dans `CONSTRAINTS.md` et surveiller qu'un agent ne la baisse pas en douce (seuil retiré, test désactivé). | Rien. | MANQUANT | IDÉE : l'idée « l'agent ne doit pas abaisser la barre en silence » vaut aussi hors code (ex. un bot qui baisse le nombre de prospects demandé). Texte trop long pour l'import (22 ko). | M |

### Compétences « vérifier / livrer »

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| code-review-and-quality | Relecture sur 5 axes (justesse, lisibilité, architecture, sécurité, performance) avant fusion. | Relecture entre bots (`peerreviewstore.ts`) ; test cité : `server/test/github-issue-workflow.test.ts` (non lancé). | PARTIEL : pas de grille d'axes donnée au relecteur. | IDÉE : donner la grille au bot relecteur. Texte trop long pour l'import (21,6 ko). | S |
| accessibility-engineering | Audit WCAG 2.2 AA avec axe-core / pa11y, tri des violations, lecteur d'écran, contrastes. | Règles d'accessibilité dans `metier-du-design` ; aucun outil d'audit automatique sur l'ordinateur du bot. | PARTIEL : règles oui, mesure non. | **ADAPTER** (texte) + IDÉE : installer un outil d'audit (axe-core en ligne de commande) dans l'image du bot pour que « Pages soignées » vérifie vraiment. Le script `audit-a11y.sh` : ne pas reprendre sans lecture. | M |
| browser-testing-with-devtools | Tester dans un vrai navigateur via le serveur MCP Chrome DevTools : DOM, erreurs console, réseau, performances. | `browser_open`, `page_read`, `element_snapshot` (`tools.ts:150-243`) : capture + texte + éléments ; pas d'erreurs console ni de réseau. | PARTIEL : le bot ne voit pas les erreurs JavaScript d'une page qu'il a publiée. | IDÉE : un outil « erreurs de la page » (console + requêtes échouées) pour vérifier les pages publiées. | M |
| performance-optimization | Core Web Vitals, temps de chargement, requêtes N+1, profilage. | Rien d'outillé. | MANQUANT | IDÉE : mesure Lighthouse sur les pages publiées (voir ci-dessus). | M |
| security-and-hardening | Durcir le code (OWASP Top 10, saisie, authentification, stockage). | Sécurité du serveur Sklubot lui-même (`hardening.ts`, `egress.ts`) ; rien pour le code que les bots écrivent. | NON REPRIS | NON (développeur) ; le contrôle de sécurité des compétences existe (`skillscan.ts`). | — |
| observability-and-instrumentation | Journaux, métriques, traces, alertes. | Sentinelle et santé du serveur (`server/src/sentinel`, `health.ts`). | NON REPRIS | NON (développeur) | — |
| ci-cd-and-automation | Mettre en place l'intégration et le déploiement continus. | Vérification CI d'un brouillon de PR (`checkCI` dans `githubissuegit.ts`). | NON REPRIS | NON | — |
| documentation-and-adrs | Notes de décision (ADR), détecter une doc qui ne correspond plus au code. | Manuel « Rédiger une note de décision » (l.42). | PARTIEL | NON (développeur) | — |
| shipping-and-launch | Liste avant mise en ligne : surveillance, déploiement progressif, plan de retour arrière. | Manuel « Ouvrir le téléchargement livré » (l.228), « Vérifier une restauration » (l.231). | PARTIEL | **ADAPTER** une version non technique : « Avant de lancer » (site, boutique, campagne) : vérifier liens, téléphone, mentions légales, plan B. | S |

### Personas (`agents/`)

| Persona | Ce qu'il fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| code-reviewer | Relecteur senior, 5 axes. | Relecture entre bots. | PARTIEL | IDÉE (voir code-review) |
| security-auditor | Menaces, OWASP, secrets, dépendances. | — | NON REPRIS | NON |
| test-engineer | Stratégie et écriture de tests. | — | NON REPRIS | NON |
| accessibility-auditor | Audit clavier, lecteur d'écran, WCAG. | Règles dans `metier-du-design`. | PARTIEL | IDÉE : un modèle de bot « Contrôleur qualité des pages » (accessibilité + téléphone + liens). M |
| web-performance-auditor | Core Web Vitals, chargement. | — | MANQUANT | IDÉE (même bot que ci-dessus) |

### Commandes (`commands/*.toml`)

| Commande | Ce qu'elle fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| spec | Lance le cahier des charges. | `/skill <nom>` existe (`web/src/components/Composer.tsx:49`) : une fois la compétence ajoutée, elle se lance ainsi. | PARTIEL (pas de compétence « cahier des charges ») | IDÉE (S) |
| planning | Lance le découpage. | — | MANQUANT | idem |
| build | Implémente (option « auto » autonome). | `task_start` | DIFFÉRENT | NON |
| test | Lance TDD. | — | NON REPRIS | NON |
| review | Lance la relecture. | Bouton de relecture sur une carte de fichiers (`peerreviewroutes.ts`). | FAIT (pour les fichiers) | NON |
| code-simplify | Lance la simplification. | — | NON REPRIS | NON |
| ship | Lance **en parallèle** 3 relecteurs spécialisés (code, sécurité, tests) puis fusionne leurs rapports en une décision « on lance / on ne lance pas » avec plan de retour arrière. | `@everyone` / règle « everyone » d'un groupe font répondre tous les bots (`server/src/agent/team.ts:120-163`), et `helper_start` permet le parallèle ; rien ne fusionne les avis en une décision. | PARTIEL | IDÉE (M) : « demander l'avis de plusieurs bots puis décider » dans un groupe : chaque bot répond seul, puis un bot synthétise go/no-go. Valable hors code (lancer une campagne, signer un devis). |
| a11y | Lance l'audit d'accessibilité. | — | MANQUANT | idem a11y |
| webperf | Lance l'audit de performance. | — | MANQUANT | idem |
| constraints | Lance l'écriture des contraintes. | — | MANQUANT | idem |

### Listes de contrôle (`references/`)

| Fichier | Contenu | Sklubot | Verdict |
|---|---|---|---|
| definition-of-done.md | Ce que « fini » veut dire. | « Méthode de travail » : vérifier avant de dire « fini » (`skills-library/methode-de-travail`). | FAIT (court). IDÉE : une liste « fini » par type de livrable. |
| accessibility-checklist.md | Liste WCAG. | `metier-du-design`. | PARTIEL. **ADAPTER** possible (MIT), à fusionner. |
| performance-checklist.md | Liste performance web. | — | IDÉE |
| security-checklist.md | Liste sécurité code. | — | NON |
| observability-checklist.md | Liste journaux/métriques. | — | NON |
| testing-patterns.md | Modèles de tests. | — | NON |
| orchestration-patterns.md | Façons d'orchestrer plusieurs agents (éventail, chaîne, relecteur). | Groupes avec routage automatique (`agent/roomrouting.ts`), helpers, passation (`room_handoff`). | DIFFÉRENT. IDÉE : relire pour le coordinateur de groupe. |

### Mécanismes du dépôt

| Mécanisme | Ce que c'est | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| Évaluations à 3 niveaux (`evals/`) | 1) structure des compétences ; 2) **déclenchement** : pour des phrases types, la bonne compétence sort en tête, et deux descriptions trop proches sont signalées (calcul lexical, gratuit, en CI) ; 3) comportement réel, payant, à la demande. | Contrôle de sécurité des compétences (`skillscan.ts`, test `server/test/skill-scan.test.ts`). Rien ne vérifie que deux compétences d'un bot ne se marchent pas dessus. | MANQUANT | IDÉE (M) : à l'ajout d'une compétence, signaler « ressemble beaucoup à ta compétence X » (description presque identique) ; utile car les bots accumulent des compétences apprises. |
| Crochet de début de séance | Injecte la méta-compétence quand l'outil ne sait pas router seul. | Prompt Sklubot liste les compétences. | FAIT | NON |
| Cache « SDD » (`hooks/sdd-cache-*.sh`) | Garde en cache les pages de doc officielles déjà lues. | Cache des réponses de recherche (`fresh` dans `search_web`, `tools.ts:809`). | PARTIEL | NON (script) |
| `simplify-ignore` | Marquer des zones de code à ne pas simplifier. | — | NON REPRIS | NON |
| Plugins pour 5 outils (Claude, Codex, Gemini, OpenCode, Cursor) | Mêmes compétences pour plusieurs outils. | Sklubot a son propre format (`skillstypes.ts`) et l'import GitHub de `SKILL.md`. | DIFFÉRENT | NON |

## Écarts de comportement (court)

1. **Interroger avant d'agir.** Le dépôt écrit une hypothèse et un pourcentage de confiance, puis pose une question à la fois jusqu'à ~95 %, et interdit l'interrogatoire hors présence humaine. Sklubot : `ask_user` sans méthode d'arrêt ; rien n'empêche un bot en routine de poser une question qui restera sans réponse des heures (non vérifié dans `routines.ts` ; à contrôler). Correctif : adapter `interview-me` et ajouter la règle « en routine, noter la question au lieu de bloquer ».
2. **Vérifier une page publiée.** Le dépôt mesure (console, réseau, axe, Lighthouse). Sklubot « vérifie sur téléphone et ordinateur » par captures (`pages-soignees`) : une erreur JavaScript invisible à l'écran passe. Correctif : outil « erreurs de la page ».
3. **Plusieurs avis puis une décision.** `/ship` lance des relecteurs indépendants en parallèle puis fusionne. Sklubot : `@everyone` fait répondre chaque bot, mais personne ne synthétise et les bots voient les réponses des autres (avis non indépendants). Correctif : mode « tour de table » où chacun répond sans voir les autres, puis une synthèse go/no-go.
4. **Compétences trop longues.** Deux compétences du pack sont refusées à l'import (> 20 000 caractères) sans possibilité de les couper ; l'utilisateur ne peut rien en faire. Correctif : proposer « garder les N premiers caractères » ou découper en annexes.

## À faire, par ordre de valeur

1. Compétence « Comprendre ce que tu veux vraiment » adaptée d'`interview-me` (hypothèse + confiance, une question, arrêt, jamais en routine) — S.
2. Compétence « Creuser une idée » adaptée d'`idea-refine` (+ cadres et critères) — S.
3. Outil « erreurs de la page » + audit d'accessibilité/performance des pages publiées (axe-core, Lighthouse dans l'image du bot) — M.
4. « Tour de table » dans un groupe : avis indépendants de plusieurs bots, puis synthèse go/no-go (idée `/ship`) — M.
5. Compétence « Avant de lancer » (version non technique de `shipping-and-launch`) — S.
6. Alerte « compétence presque identique à une autre » à l'ajout (idée des évaluations de déclenchement) — M.
7. Règle « ne pas baisser la barre en silence » dans « Méthode de travail » (idée `constraint-driven`) — S.
8. Relecture entre bots avec grille d'axes et relecteur neuf avant affirmation risquée (idées `code-review`, `doubt-driven`) — S.
9. Import : accepter une compétence > 20 000 caractères en la découpant, ou la tronquer avec avertissement — S.
10. Dépendances entre tâches (idée `planning`) — M.
11. Modèle de bot « Contrôleur qualité des pages » — S.
12. Famille optionnelle « Développeur » (TDD, débogage, relecture) pour les comptes qui codent — M.

## Non vérifié

- Que les routines empêchent un bot de poser une question bloquante (`routines.ts` non lu).
- Le test de relecture entre bots (non lancé).
- Le modèle « cahier des charges » de `modeles-de-pages` (cité dans le catalogue, non ouvert).
- Les scripts du dépôt (`audit-a11y.sh`, `quality-gate.mjs`, crochets) : non lus en détail, non exécutés.
