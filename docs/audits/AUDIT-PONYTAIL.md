# Audit : DietrichGebert/ponytail (compétence de code + crochets + tableau de coûts) face à Sklubot

Dépôt lu : https://github.com/DietrichGebert/ponytail, commit `ebd8654c2c627f721eb8f9c0d1bd4090a29f9e10`, 219 fichiers (clone superficiel, rien exécuté, clone effacé ensuite).

## Comptes

6 compétences, 6 commandes, 11 crochets/modules, 3 éléments d'interface (bandeau, tableau, ligne d'état), 12 exemples, 3 bancs d'essai, 23 fichiers de tests, 20 intégrations d'outils = 31 lignes de fonctions (les intégrations et exemples sont groupés).

| Statut Sklubot | Nombre |
|---|---|
| FAIT | 5 |
| PARTIEL | 7 |
| MANQUANT | 5 |
| DIFFÉRENT | 3 |
| NON REPRIS | 11 |

Verdicts : ADAPTER 2 · IDÉE 10 · NON 19.

## Licence

- `LICENSE` : **MIT License**, « Copyright (c) 2026 DietrichGebert ». Le front-matter de `skills/ponytail/SKILL.md` répète `license: MIT`.
- Le nom « Ponytail », le logo et les images (`assets/`) sont la marque de l'auteur : ne pas les reprendre (règle Sklubot : pas de marque d'un autre produit). Le **texte** des compétences est réutilisable avec l'avis MIT, sous un autre nom.
- Le README annonce des chiffres de banc d'essai (« −53 % de code », etc.) : non vérifiés ici, ne pas les citer.

## Ce que c'est

Une seule consigne (« développeur senior paresseux ») : avant d'écrire du code, prendre la première solution qui tient sur une échelle (faut-il le faire ? existe déjà dans le projet ? bibliothèque standard ? fonction native ? dépendance déjà installée ? une ligne ? sinon le minimum), sans jamais couper validation, gestion d'erreurs, sécurité, accessibilité ; un petit test pour toute logique risquée ; et **chaque réponse finit par ce qui n'a pas été fait ou vérifié et les risques**. Autour : relecture, audit, registre des raccourcis, et un bandeau de coûts pour Claude Code.

## Point important côté Sklubot

Les bots « sur abonnement » de Sklubot font tourner Claude Code ou Codex dans leur ordinateur Linux (`server/src/agent/engine.ts:1-10`, installés par `docker/desktop/Dockerfile:28`). Les plugins de ce type peuvent donc, techniquement, s'installer dans l'image du bot. Ce n'est pas recommandé ici : les crochets écrivent des fichiers dans `~/.config/ponytail/` à chaque tour, s'activent pour toute la session et ne visent que le code ; Sklubot ne veut pas de comportement caché ajouté à un moteur.

## Tableau complet

Licence de chaque ligne : MIT (dépôt), sauf les images/logo (marque).

### Compétences (`skills/`)

| Compétence | Ce qu'elle fait | Équivalent Sklubot | Statut | Verdict | Taille |
|---|---|---|---|---|---|
| ponytail (consigne principale, 3,5 ko) | Échelle « le plus petit changement complet », jamais couper la sécurité, test pour la logique risquée, commentaire `shortcut:` pour une limite connue, fin de réponse « ce que j'ai sauté / pas vérifié / risques ». Trois niveaux : lite (propose la version plus petite), full, ultra (conteste la demande). | « Méthode de travail » (`server/skills-library/methode-de-travail/SKILL.md`) : vérifier avant « fini », dire un échec, ne rien inventer. Ne dit **pas** « finis par ce que tu n'as pas vérifié », ni « réutilise l'existant avant de créer ». Manuel « Modifier un logiciel existant » (`server/templates/methodes/manuel.md:194`). | PARTIEL | **ADAPTER** (texte, sans le nom) : 1) la règle de fin de réponse « pas vérifié / risques » dans « Méthode de travail » pour **tous** les bots — S ; 2) l'échelle « faut-il le faire ? existe déjà ? natif ? » dans une compétence « Code sobre » pour les bots qui codent — S. | S |
| ponytail-review | Relire un changement « comme celui qu'on réveille la nuit quand ça casse » : lire le diff **et** le code autour (appelants), tracer le flux, estimer la charge attendue ; chercher dans l'ordre bogue, risque, montée en charge, test manquant, vitesse, code en trop ; chaque constat exige un cas concret (« telle entrée donne tel mauvais résultat »), sinon pas de constat. | Relecture entre bots d'une carte de fichiers (`server/src/peerreviewstore.ts`, `startPeerReview`) ; test qui la mentionne : `server/test/github-issue-workflow.test.ts` (non lancé). | PARTIEL : pas de grille, pas d'exigence « un cas concret par constat ». | **ADAPTER** la grille et la règle « pas de cas concret, pas de constat » dans la consigne du bot relecteur. | S |
| ponytail-audit | Même contrôle sur tout le dépôt : carte du code d'abord (points d'entrée, flux, charge), puis constats classés « à corriger d'abord ». | Rien pour auditer un dépôt entier ; `github_read_repository` lit un dépôt (`server/src/githubcontents.ts`). | MANQUANT | IDÉE : réservé aux comptes qui codent. | M |
| ponytail-debt | Recense les commentaires `shortcut:` (limite + quand revoir) en un registre ; signale ceux sans déclencheur (« ceux qui pourrissent »). | Rien. | MANQUANT | IDÉE hors code : quand un bot fait un raccourci (« j'ai pris les 50 premiers prospects »), le noter dans une liste « à revoir » visible, avec quand revoir. | M |
| ponytail-gain | Affiche le tableau des gains mesurés par le banc d'essai. | — | NON REPRIS | NON (publicité du dépôt) | — |
| ponytail-help | Aide-mémoire des commandes. | — | NON REPRIS | NON | — |

### Commandes et modes

| Fonction | Ce qu'elle fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| `/ponytail lite|full|ultra|off` | Change l'intensité pour la session ; affichée au démarrage. | Pas de « mode » de bot réglable dans le chat ; la personnalité et les consignes se changent dans la fiche du bot. | DIFFÉRENT | IDÉE (S) : un réglage « Style : propose plus simple / normal / conteste mes demandes » par bot. |
| `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt` | Lancent les compétences. | `/skill <nom>` existe déjà (`web/src/components/Composer.tsx:49`, `server/src/agent/loop.ts:337`). | FAIT (une fois la compétence ajoutée) | NON |
| Désactivation par la parole (« stop ponytail », « normal mode ») | Le suivi de mode lit la phrase et coupe. | — | NON REPRIS | NON |
| Variable `PONYTAIL_DEFAULT_MODE` / `config.json` | Niveau par défaut. | — | NON REPRIS | NON |

### Crochets et modules (`hooks/`)

| Module | Ce qu'il fait | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| ponytail-activate.js | Au début de séance, injecte la consigne et affiche le mode. | Prompt construit par le serveur (`server/src/agent/prompt.ts`). | FAIT (autrement) | NON |
| ponytail-mode-tracker.js | Lit chaque message pour repérer `/ponytail …` et garde le mode dans un fichier. | — | NON REPRIS | NON |
| ponytail-subagent.js | Transmet le mode aux sous-agents. | Les helpers et tâches de fond reçoivent leur propre prompt (`server/src/agent/bgtasks.ts`). Non vérifié qu'ils héritent des compétences du bot parent. | PARTIEL / non vérifié | IDÉE (S) : vérifier qu'un helper hérite des compétences et règles du bot. |
| ponytail-map.js | **Carte du code** : liste ce qui existe déjà (fonctions de haut niveau par langage, hors tests et code généré) pour que « réutiliser d'abord » ne coûte pas une recherche. | Rien. | MANQUANT | IDÉE (M) pour bots qui codent : carte du dépôt jointe au contexte. |
| ponytail-instructions.js / ponytail-config.js / ponytail-runtime.js | Construisent la consigne selon le niveau ; lisent la config ; détectent l'outil hôte. | — | NON REPRIS | NON (plomberie) |
| ponytail-band-import.js | Importe les séances Claude Code passées dans le registre de coûts, avec un tarif par million de jetons tiré de la page officielle de prix (date de vérification en commentaire). | Sklubot enregistre chaque appel avec son coût (`server/src/usage.ts`, `record`) et l'affiche dans le journal (`web/src/components/SpendSkillsFiles.tsx:191-233`). | FAIT (pour Sklubot) | NON |
| Ligne d'état (`ponytail-statusline.sh/.ps1`) | Affiche le mode dans la barre d'état. | — | NON REPRIS | NON |
| `__init__.py` (greffon pour Hermes Agent) | Injecte la consigne avant chaque tour ; réécrit les commandes reçues par passerelle. | — | NON REPRIS | NON |

### Interface (bandeau et tableau, pour Claude Code)

| Élément | Ce qu'il montre | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| Bandeau au-dessus de la saisie | Coût de la tâche, du dernier tour, moyenne par tour ; jetons ; temps de travail de l'agent ; % de réutilisation de code ; tests passés après le dernier changement. | Journal des dépenses (par ligne, total), coûts des routines (`SpendSkillsFiles.tsx:500`), plafonds (`server/src/usagecaps.ts`, `web/src/components/UsageCaps.tsx`). Non vérifié qu'une tâche de fond montre **son** coût sur sa carte. | PARTIEL | IDÉE (S) : sur la carte d'une tâche de fond et sous une longue réponse, « ce travail a coûté X $ / Y min ». |
| Tableau (`board.ts`) | Page HTML autonome, sans serveur ni réseau : 30 derniers jours, coût / temps / jetons par projet, chaque séance avec ses tests, jours actifs ; données gardées sur la machine. | Vue « Aujourd'hui » et centre de commande (`TodayView.tsx`, `CommandView.tsx`), journal. | DIFFÉRENT | IDÉE (M) : un graphique « coût et temps par bot sur 30 jours ». |
| Carte de partage (SVG 1200×630) | Image à partager de ses chiffres. | — | NON REPRIS | NON (marque) |

### Bancs d'essai, exemples, tests, intégrations

| Élément | Contenu | Sklubot | Statut | Verdict |
|---|---|---|---|---|
| benchmarks/ (promptfoo, « agentic » avec juge) | Compare le même agent avec / sans la consigne : lignes de code, justesse, comportement, juge. | Sklubot n'a pas de banc d'essai des compétences ou des consignes. | MANQUANT | IDÉE (L) : petit banc « avec / sans compétence » sur 10 tâches types, pour décider d'ajouter une compétence à la bibliothèque. |
| examples/ (12 cas : CSV, anti-rebond, copie profonde, e-mail, regroupement, défilement infini, fenêtre modale, nombres, limite de débit, compte à rebours, paramètres d'URL) | Avant / après. | — | NON REPRIS | NON (exemples développeur) |
| tests/ (23 fichiers) | Testent crochets, plugins, import, désinstallation, Windows, UTF-8. | — | NON REPRIS | NON |
| 20 intégrations (Claude Code, Codex, Copilot, Cursor, Gemini, OpenCode, Windsurf, Kiro, Qoder, Kimi, Grok, Devin, Cline, OpenClaw, pi, Hermes…) | La même consigne chargée dans chaque outil. | Import de `SKILL.md` depuis GitHub (`server/src/skillsgithub.ts`). | FAIT (le `SKILL.md` principal s'importerait : 3,5 ko, sous la limite de 20 000) | NON |
| Avertissement d'authenticité | « N'installez que depuis ce dépôt ; il ne livre jamais de .exe/.dll. » | Contrôle de sécurité des compétences (`server/src/skillscan.ts`). | DIFFÉRENT | NON |

## Peut-on l'installer dans l'image du bot ?

- Techniquement oui (Claude Code et Codex y sont déjà). Mais : crochets qui s'exécutent à chaque message, fichiers écrits hors du dossier de travail, mode actif en permanence, aucun lien avec les approbations de Sklubot. **Ne pas installer.** Reprendre le texte (MIT) dans une compétence de la bibliothèque, que l'utilisateur ajoute lui-même.
- Ce que rend l'outil externe : une réponse de code plus courte + une ligne de risques ; un bandeau de coûts. Ce que rend Sklubot aujourd'hui : la réponse du bot + le coût dans le journal (pas sur la carte de la tâche, non vérifié).

## Écarts de comportement

1. **Fin de réponse.** Ponytail impose à chaque réponse une ou deux lignes « ce que j'ai sauté ou pas vérifié, et les risques ». Sklubot (« Méthode de travail » §7) : « le résultat d'abord, puis ce qui reste à faire ». Ce qui *n'a pas été vérifié* n'est pas demandé : un bot peut dire « c'est fait » sans dire qu'il n'a pas testé sur téléphone. Correctif S : ajouter cette ligne au §7.
2. **Relecture.** Ponytail : pas de constat sans cas concret, lire les appelants, estimer la charge. Sklubot : relecture sans grille. Correctif S.
3. **Raccourcis oubliés.** Ponytail rend les raccourcis traçables (`shortcut:` + registre). Sklubot : un raccourci pris par un bot disparaît dans le fil. Correctif M : liste « à revoir ».
4. **Coût visible pendant le travail.** Ponytail montre le coût de la tâche en cours. Sklubot montre les coûts après coup dans le journal. Correctif S : coût sur la carte de tâche.

## À faire, par ordre de valeur

1. Ajouter à « Méthode de travail » : finir par « ce que je n'ai pas vérifié / les risques » en une ligne — S.
2. Grille de relecture (bogue, risque, charge, test manquant, vitesse, en trop) + « pas de cas concret, pas de constat » pour la relecture entre bots — S.
3. Coût et durée affichés sur la carte d'une tâche de fond et d'une routine en cours — S.
4. Compétence « Code sobre » (échelle de réutilisation, ne jamais couper la sécurité, petit test pour logique risquée), sans le nom ni le logo — S.
5. Liste « raccourcis à revoir » tenue par les bots — M.
6. Vérifier que les helpers héritent des compétences et règles du bot parent — S.
7. Réglage de style par bot (propose plus simple / normal / conteste) — S.
8. Graphique coût/temps par bot sur 30 jours — M.
9. Carte du dépôt pour les bots qui codent (idée `ponytail-map`) — M.
10. Banc d'essai « avec / sans compétence » avant d'ajouter une compétence à la bibliothèque — L.

## Non vérifié

- Les chiffres du README (banc d'essai) : non reproduits.
- Que les tâches de fond Sklubot affichent leur propre coût (carte non lue).
- Que les helpers héritent des compétences du bot (`bgtasks.ts` lu en tête seulement).
- Le contenu exact de `benchmarks/agentic/*.py` (non lu, non exécuté).
