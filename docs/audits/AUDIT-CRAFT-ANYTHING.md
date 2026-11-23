# Audit : storytold/craft-anything (outil d'étude et de reconstruction) face à Sklubot

Dépôt lu : https://github.com/storytold/craft-anything, commit `e64d7cb73d7f39323b7040a984e0f9b3f7981146`, 1 190 fichiers (Rust). Clone superficiel, rien exécuté, clone effacé ensuite.

## Ce que c'est

Une application de bureau + une ligne de commande + un serveur MCP en Rust : on désigne un site, une appli ou un jeu, on dit ce qu'on veut, et l'outil **étudie** l'original, fait **construire** un nouveau projet par un agent de code (Claude Code d'abord, Codex, Copilot, Grok, d'autres via ACP), **compare** le résultat avec l'original (captures à trois largeurs, test intégré d'un jeu, exécutions d'une appli) et **affine**. 305 outils moteur (+ ceux des couches IA et installation, ~320), dont un vrai moteur de rétro-ingénierie (désassembleur, décompilateur, Android, Apple, .NET, Java, Frida, GDB, Ghidra en option). Deux modes : **Clean room** (par défaut : rien de l'intérieur de l'original n'est lu) et **Deep** (tout est lu, « pour usage privé »).

## Comptes

67 lignes (fonctions, écrans, mécanismes de fiabilité/sécurité ; les 305 outils sont regroupés en 7 lignes par famille).

| Statut Sklubot | Nombre |
|---|---|
| FAIT | 18 |
| PARTIEL | 19 |
| MANQUANT | 4 |
| DIFFÉRENT | 11 |
| NON REPRIS | 13 |
| NON VÉRIFIÉ | 1 (coût des tours repris) |

Plus 1 ligne d'en-tête de famille sans statut. Côté « ce qui manque », 18 actions sont classées dans « À faire ».

## Licence

- `LICENSE-MIT` + `LICENSE-APACHE` + `NOTICE` : **MIT OR Apache-2.0, au choix**, « Copyright (c) 2026 ArtCraft Team and the Craft Anything contributors ».
- **Pas libres** : le nom « ArtCraft », son logo et ses marques (`docs/brand/LICENSE-brand.txt` : marques déposées, interdiction de les utiliser pour autre chose que Craft Anything) et l'icône d'application (`assets/app-icon/LICENSE.txt`). Polices : OFL 1.1 ; icônes Lucide : ISC.
- Sklubot respecte déjà cela : `server/templates/artifacts/Craft-Anything-LICENSE` et `Craft-Anything-NOTICE` (copie du NOTICE), `install-craft.sh` copie `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` dans `/usr/local/share/doc/craft-anything/`. Aucune marque ArtCraft n'est reprise (vérifié par grep). Le nom « Craft Anything » est cité comme source, ce qui est permis (ce n'est pas une marque protégée par le fichier brand, qui ne vise que « ArtCraft »).

## Ce que Sklubot a déjà pris (vérifié)

| Élément pris | Où dans Sklubot | Test |
|---|---|---|
| Binaire officiel `craft-anything-cli` 0.6.1, téléchargé depuis les « releases » GitHub, **SHA-256 vérifié** pour amd64/arm64, version contrôlée, avis de licence copiés | `docker/desktop/install-craft.sh` (appelé à la construction de l'image et par l'outil `craft_workspace`) | aucun test trouvé (`grep craft server/test` vide) |
| Outil `craft_workspace` : prépare le CLI et dit au bot d'utiliser `--clean-room`, et pour une reconstruction web : `rebuild --backend Codex --build-with 'Plain HTML and CSS' --rounds 0 --unattended` puis `artifact_from_file` | `server/src/agent/creative-tools.ts:6-19` | aucun test |
| Mesure de mise en page d'une référence (viewport, typographie, sections, marges, fonds, colonnes), script adapté de `LAYOUT_JS` v0.6.1 (MIT), sans texte de titres ni valeurs de formulaires | `server/templates/artifacts/craft-layout.js`, `server/src/artifact-design.ts:11-19` (vérifie que l'onglet est bien sur l'adresse demandée, refuse les adresses avec identifiants), outil `design_reference_layout` (`server/src/agent/tools.ts:154`), `server/src/computer.ts:247` | aucun test (`layoutExpression` absent de `server/test`) |
| Documentation | `docs/ARTEFACTS.md` (§ « Design et références », « Fonctionnement ») | — |

## Tableau complet

Taille = effort côté Sklubot. Licence de chaque ligne : MIT OR Apache-2.0 (sauf marques).

### Parcours principal (étudier → construire → vérifier → prêt)

| Fonction | Ce que fait Craft Anything | Sklubot | Statut | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Reconstruire un site public en mode clean room | Capture le site comme un visiteur (captures, texte visible, mesures, couleurs, polices, menus ouverts), fait construire, compare. | `craft_workspace` + CLI dans l'ordinateur du bot ; guide « artefact » (`server/src/agent/guides.ts:14`). | PARTIEL | Le bot lance `rebuild --rounds 0` : **aucune boucle de vérification/affinage** (0 tour de contrôle) ; aucun retour à l'utilisateur du « % ressemblant ». | M |
| Étapes visibles Study → Build → Check → Ready | L'écran Projet montre les 4 étapes, ce que fait l'agent en mots simples, les cartes question/approbation, le score de ressemblance, « ouvrir le résultat / le dossier ». | Cartes de tâche de fond (`server/src/agent/bgtasks.ts`), `progress_update`, cartes d'artefact (`docs/ARTEFACTS.md`). | DIFFÉRENT | Pas d'étapes nommées pour une création ; l'utilisateur voit un fil, pas « où on en est ». | M |
| Score de ressemblance par contrôle | Après chaque tour : « ta construction ressemble à X % » (texte + captures par largeur, titres manquants, mots manquants). | Rien. | MANQUANT | Comparer une page refaite à sa référence (texte et captures) et le dire. | M |
| Contrôle à trois largeurs d'écran | Mesure l'original et la copie à 3 largeurs, captures dans `checks/round-N/`. | « Pages soignées » demande de regarder la page au téléphone et à l'ordinateur (captures par le bot). | PARTIEL | Pas de comparaison automatique ; dépend du bot. | M |
| Boucle « affiner jusqu'à proche » avec limite de tours | Rondes de contrôle, arrêt à la limite ou quand c'est assez proche (réglage « quand une construction est assez bonne »). | Rien pour une création ; loop guard générique (`server/src/agent/loop.ts:1111`). | MANQUANT | Seuil « assez bon » + nombre de tours. | M |
| Arrêt quand rien ne change | Deux tours de l'agent sans changer les fichiers → arrêt ; empreinte des fichiers gardée entre relances ; message clair si le registre est abîmé. | Loop guard sur appels répétés (`loop.ts:136`, `repeats`). | PARTIEL | La détection Sklubot porte sur les appels identiques, pas sur « aucun progrès dans les fichiers ». | M |
| Contrôle gardé si rien n'a bougé | Un contrôle réussi n'est pas refait tant que rien de ce qu'il regarde n'a changé. | — | NON REPRIS | Optimisation interne. | — |
| Reprendre / modifier un projet existant | `--continue-in <dossier>`, `--existing edit` (l'agent modifie en place), « Try again ». | Révision d'un artefact depuis sa source (`artifact` + versions, `docs/ARTEFACTS.md`). | FAIT (pour les artefacts) — test : `server/test/pages-artifacts.test.ts` | — | — |
| Projet d'un dossier à soi | Partir d'un dossier existant : « c'est l'appli » ou « c'est de la matière ». | Fichiers d'équipe, bibliothèque du bot. | DIFFÉRENT | — | — |
| Plusieurs constructions à la fois | File d'attente : N en parallèle, les autres attendent dans l'ordre. | `MAX_BG_TASKS = 3` par bot (`bgtasks.ts`). | FAIT (autrement) | — | — |
| « Just ask » / `/btw` | Poser une question sur une construction (« où sont les fichiers ? ») sans lancer de tour ni rien changer. | Message pendant un tour : rejoint le tour en cours (`steering`, `loop.ts:204-381`). | DIFFÉRENT | Pas de question « à côté » qui n'interrompt ni ne modifie le travail. | S |
| Notes pendant que l'agent travaille | La note est donnée à l'agent **à son prochain outil** (crochet après chaque outil), « reprendre » possible tant qu'elle n'est pas lue ; une note non lue n'est pas perdue à la fermeture. | `steering` : le message est plié dans le tour à l'étape suivante (`loop.ts:647`, `:713`) ; pour un moteur CLI, « text steering only » (`loop.ts:369`). | PARTIEL | Pas de « reprendre ma note » ; non vérifié qu'une note en attente survit à un redémarrage du serveur (stockée en mémoire : `const steering = new Map`). | S |
| Choix de la pile technique | Table `stacks.toml` : phrases qui demandent une pile, pile par défaut par type. | Le bot choisit librement. | NON REPRIS | — | — |
| Jeux : `--self-test`, fiche « mécanique », captures `--screenshot` | Exige du jeu reconstruit un test automatique et une fiche de règles chiffrées. | — | NON REPRIS | Hors sujet pour Sklubot. | — |
| Applis console comparées par leurs exécutions | Lance l'original et la copie avec les mêmes entrées. | — | NON REPRIS | Lance du code tiers. | — |
| Images et modèles 3D générés (clé fal.ai, budget par projet, opt-in) | `assets_image_generate`, `project_assets_budget`, `project_assets_allow`. | `image_generate`, `video_generate` (`tools.ts:366`, `:407`), plafonds (`server/src/usagecaps.ts`). | PARTIEL | Pas de **budget par projet/création** ; plafonds globaux ou par bot. | S |
| Builds épinglés | Garder une version qui tourne pendant que l'agent continue (`project_pin_*`). | Versions des pages/artefacts (20 max, « Rétablir »). | FAIT (autrement) | — | — |
| Dupliquer / renommer / supprimer un projet | `project_duplicate`, `project_rename`, `project_delete`. | Pages : versions, partage ; pas de « dupliquer un artefact » vérifié. | PARTIEL | Dupliquer un artefact. | S |

### Questions, approbations, sécurité

| Fonction | Ce que fait Craft Anything | Sklubot | Statut | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Boîte de réception (questions à choix, approbations) | L'agent écrit une demande dans `inbox/`, l'appli affiche une carte, la réponse revient ; marche entre processus. | `ask_user`, cartes d'approbation (`agent/authorize.ts`), `wait_reply`. | FAIT | — | — |
| Qui répond aux questions de l'agent | Réglage « Les questions de l'agent : me demander / décider seul » par projet (`project_questions_set`). | Pas de réglage ; consigne « ask_user seulement pour une vraie décision » (`prompt.ts:159`). | PARTIEL | Réglage par bot/tâche « décide seul pour les petites questions ». | S |
| Approbations par type d'action | Menu sous la saisie et `/approvals <type> <choix>` ; « Auto » par défaut. | Règles et autorisations (`agent/ruletools.ts`, `conversationgrants.ts`), mode d'autonomie du bot. | FAIT (autrement, plus fin) | — | — |
| **Mode `--unattended` utilisé par Sklubot** | Questions → **première réponse choisie automatiquement**, approbations → **refusées** (`apps/craft-anything-cli/src/rebuild_cmd.rs:257-271`). | `craft_workspace` dit au bot d'utiliser `--unattended` (`creative-tools.ts:17`). | DIFFÉRENT | L'utilisateur **ne voit jamais** les questions du constructeur : elles sont tranchées au hasard du premier choix. Les relayer en `ask_user` (le CLI sait poser les questions au terminal ; ou via son serveur MCP + `project_inbox_answer`). | M |
| Clean room imposé par le code | En clean room, seule une liste blanche d'outils tourne (`crates/engine/src/clean_room.rs`) ; les autres refusent et disent comment passer en Deep. | Le bot reçoit seulement la phrase « Use --clean-room » (`creative-tools.ts:17`). Aucun blocage de `--deep` / `settings_set deep_mode true` dans `shell_run` (grep vide). | PARTIEL | Un bot (ou une page lue qui le manipule) peut lancer le CLI en mode Deep : décompilation, lecture du JavaScript d'un site, Frida. Bloquer `--deep` et `deep_mode` dans `shell_run`, ou installer un fichier de réglages verrouillé. | S |
| Avertissement honnête « ce n'est pas un bac à sable » | Le README dit que le clean room est une règle d'outil, pas une isolation du système. | L'ordinateur du bot est un conteneur Docker séparé (`docs/ORDINATEUR.md`). | FAIT (mieux isolé) | — | — |
| « Demander avant de lancer quoi que ce soit » | Réglage Sécurité : les outils qui exécutent du code d'une cible ou modifient un téléphone demandent d'abord, sauf autorisation par projet. | `shell_run` sur l'ordinateur du bot ; commandes irréversibles demandées (`agent/irreversible.ts:47`). | DIFFÉRENT | — | — |
| « Étudier une appli en la lançant » (opt-in) | Lance l'original une fois pour photographier sa fenêtre. | — | NON REPRIS | Exécuter un programme tiers. | — |
| Connexion à un site pour l'étudier (`web_site_sign_in` / `sign_out`) | Ouvre une session sur le site cible et peut l'oublier. | Coffre (`vault_type`, `totp_code`, `email_code_type`), prise en main (`ask_takeover`). | FAIT (autrement) | — | — |
| Clés d'API : trousseau du système, sinon fichier réservé au propriétaire, jamais dans les journaux | `crates/ai/src/keys.rs`. | Coffre chiffré (`server/src/agecrypt.ts`, `datakey.ts`), `secret_use`. | FAIT | — | — |
| Journaux d'échec masquant les secrets, sans le message de la personne | `crates/engine/src/failure_log.rs`. | Détection de secrets collés (`server/src/pastedsecrets.ts`), anonymisation (`agent/anonymise.ts`). | PARTIEL / non vérifié | Non vérifié que les journaux d'échec Sklubot masquent les options secrètes des commandes. | S |
| Plugins vérifiés (MCP, WASM sans accès fichiers) | Un plugin de contrôle WASM ne lit pas les fichiers : il reçoit la construction en JSON, plafonnée. | Outils locaux MCP proposés et approuvés (`local_tool_server_add`, `tools.ts:1300`). | DIFFÉRENT | — | — |
| Mise à jour vérifiée de l'appli | Vérifie les versions et installe avec vérification. | Version figée + SHA-256 (`install-craft.sh`). | FAIT (figé, plus sûr) | Pas d'alerte quand une nouvelle version existe. | S |

### Fiabilité du moteur (agents de code)

| Mécanisme | Craft Anything | Sklubot | Statut | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Politique de nouvelle tentative typée | La décision de réessayer vient d'un **type** d'erreur (authentification, facturation, programme absent → s'arrêter ; coupure, limite, sortie sans erreur typée → 3 essais max), **jamais** d'une recherche de mots anglais dans le message (`docs/STATUS.md` « Builder retry policy », `crates/ai/src/failure.rs`). | Attente exponentielle avec gigue (`server/src/agent/reliability.ts:36-45`) ; mais le classement des erreurs moteur se fait par **expressions régulières sur le texte** (`agent/engine.ts:642` `NOT_SIGNED_IN`, `agent/sidereply.ts` `classify`). | PARTIEL | Un message d'erreur reformulé par Claude Code ou Codex casse le classement. Préférer les champs structurés (`subtype`, `rate_limit_event`, codes) quand ils existent. | M |
| Limite d'abonnement Claude (`rate_limit_event` « rejected ») | Ne réessaie pas, dit quelle limite et quand elle revient. | Pareil : `claudeLimitFrom` (`engine.ts:827-829`, `sublimit.ts`). | FAIT | — | — |
| Coût d'un tour Claude Code repris | `total_cost_usd` est le total **de la session** : un tour qui reprend une session compte tout ce qui précède ; Craft soustrait le total gardé après le tour précédent (`cli_agents/claude_cost.rs`, vérifié en direct le 2026-11-09). | Sklubot enregistre `e.usage` (jetons) du résultat (`engine.ts:836-837`), pas `total_cost_usd`. | NON VÉRIFIÉ | Vérifier si `usage` du résultat d'un tour `--resume` est lui aussi cumulé ; si oui, les jetons (et coûts) des bots sur abonnement sont **surcomptés** à chaque tour. Test simple : deux tours repris, comparer. | S |
| Sessions orphelines | Chaque tour garde un verrou système sur sa fiche ; au démarrage, les fiches sans verrou (appli tuée en plein tour) sont nettoyées (`cli_agents/unfinished.rs`). | Session gardée par bot (`engine_sessions`, `engine.ts:191-199`) ; session perdue → nouvelle (`engine.ts:845`, `CODEX_LOST_SESSION` `:860`). | PARTIEL | Non vérifié qu'un processus `claude`/`codex` tué au redémarrage du serveur est bien arrêté dans le conteneur. | S |
| Serveur MCP en échec au démarrage | Si son propre serveur MCP échoue dans l'événement `init` de Claude Code, il arrête le CLI au lieu de laisser l'agent travailler sans outils. | Sklubot lit `init` pour l'identifiant de session seulement (`engine.ts:810`). | MANQUANT | Vérifier dans `init` que le serveur MCP de Sklubot est « connected » ; sinon arrêter et dire « les outils Sklubot ne sont pas joints ». | S |
| Reprise sans rejouer | Une nouvelle tentative API reprend l'historique sans réinsérer le message ni rejouer les outils finis. | Réponse coupée → « continue où tu t'es arrêté » (`loop.ts:1056`). | FAIT (cas principal) | — | — |
| Espacement des requêtes | Rythme par service (requêtes/seconde ou minute) (`ai/src/pace.rs`). | Backoff + Retry-After (`reliability.ts`). | PARTIEL | Pas d'espacement préventif. | S |
| Gestion du contexte | Résultats d'outils anciens raccourcis, puis résumé, transcript sur disque (`ai/src/context.rs`) ; taille de fenêtre lue sur le serveur de modèle (`window.rs`). | `server/src/agent/context.ts`. | FAIT (non comparé en détail) | — | — |
| Fichiers versionnés | Chaque fichier enregistré a une version et des étapes de migration ; un fichier d'une version plus récente arrête avec « mets à jour l'appli ». | Migrations SQLite (`server/src/migrations`). | FAIT (autrement) | — | — |
| Journal de projet en JSONL | Chaque appel d'outil, tour, consentement, erreur et message, par jour (`engine/src/journal.rs`). | Journal (`server/src/journal.ts`), audit. | FAIT | — | — |
| Tests sans toucher la machine réelle | Aides de test, « stand-ins » de runs et de CLI. | Faux serveurs MCP et fixtures (`server/test/fixtures/fake-mcp-stdio.mjs`). | FAIT | — | — |
| Activité détaillée | Action en cours en mots, dernières lignes à l'écran, tout dans `build-activity.log`. | Étapes d'outils et `watch.ts` (sortie qui commence). | PARTIEL | Pas de journal d'activité téléchargeable par tâche. | S |

### Écrans (appli egui)

| Écran | Ce qu'il montre | Sklubot | Statut |
|---|---|---|---|
| Premier lancement (4 écrans passables : bienvenue → qui construit → but → fini) | Configure d'abord l'agent qui construit. | Mise en route (`docs/MISE-EN-ROUTE.md`), connexion des comptes IA. | FAIT (autrement) |
| Accueil simple « Que veux-tu faire ? » + projets | Deux questions numérotées, gros bouton Démarrer, lien discret « juste regarder ». | « + → Créer un artefact » dans le chat (`docs/ARTEFACTS.md`). | DIFFÉRENT |
| Make (pour débutants) | « Que veux-tu recréer ? », « Dis ce que tu veux », Clean room / Deep, « Construit par ». | — (tout passe par le chat) | DIFFÉRENT |
| Projet (étapes à gauche, fil à droite) | Voir parcours principal. | Carte d'artefact + atelier « Agrandir et voir les versions ». | PARTIEL |
| Atelier avancé (listes, onglets, inspecteur, console, tâches, journal) | Pour experts. | — | NON REPRIS |
| Palette de commandes Ctrl/⌘K + formulaire généré depuis le schéma de chaque outil | Lancer n'importe quel outil à la main. | — | NON REPRIS (public non développeur) |
| Glossaire au survol (mode débutant) | Mots techniques expliqués en mots simples. | Ton simple dans le prompt. | MANQUANT (IDÉE S : infobulles sur les termes de l'interface Sklubot comme « routine », « connecteur », « moteur ») |
| Usage (temps, jetons, coût par projet, total de la séance) | `usage.json` additionné entre redémarrages. | Journal des dépenses (`web/src/components/SpendSkillsFiles.tsx:191-233`), coûts des routines. | PARTIEL (pas de coût par création/artefact) |
| Rapport lisible (Markdown) de la conversation + preuves | `core_report_write`. | Rapports de recherche approfondie (`server/src/researchreports.ts`). | PARTIEL (pas d'export « rapport de cette conversation ») |
| Cartes de preuve « Montre-moi la preuve » | Chaque réponse a ses preuves (confiance, couverture, limites). | Registre de preuves de la recherche (`server/src/researchevidence.ts`). | PARTIEL (seulement pour la recherche) |
| Collage d'images Ctrl+V | Dans la saisie. | Pièces jointes dans le Composer. | FAIT (non vérifié pour Ctrl+V) |
| Barre de titre (Clean room / Deep, moteur, Simple / Avancé) | État toujours visible. | — | NON REPRIS |
| Fichiers de jeu (déballer les images d'un jeu après confirmation) | — | — | NON REPRIS (droits d'auteur) |
| Moteurs de jeu (Unity / Unreal / Godot pas à pas) | — | — | NON REPRIS |
| Dossiers de projets | Où vont les projets. | Bibliothèque du bot. | DIFFÉRENT |
| 11 langues (fichiers TSV) | — | FR/EN (`server/src/i18n.ts`). | DIFFÉRENT |

### Familles d'outils (305 outils moteur)

| Famille (nombre) | Exemples | Sklubot | Statut / verdict |
|---|---|---|---|
| Essentiels `core` (36) | cible, preuves, **questions ouvertes** (`core_unknown_add/verify`), **hypothèses** (`core_hypothesis_record`), constats, plan, brief, **passation** (`core_handoff_write`), rapport. | Manuel « Tenir un registre de preuves » (`manuel.md:30`), mémoire, objectifs. | PARTIEL — IDÉE (M) : pour une tâche longue, une liste « questions ouvertes / hypothèses » visible et cochable par l'utilisateur. |
| Sites web `browser` (24) | capture de site, états (menus, dialogues, onglets), comparaison de pixels, parcours scripté vérifiable, **faux backend « stand-in »**, couverture de code, outils MCP trouvés dans la page. | `browser_open`, `page_read`, `element_*` (`tools.ts:150-243`). | PARTIEL — IDÉE (M) : « parcours enregistré puis rejoué » pour vérifier qu'un formulaire marche encore (routine de surveillance de site). La capture « menus ouverts » est disponible via le CLI déjà installé. |
| Comparer et reconstruire `application` (17) | registre de reconstruction, « à quel point la reconstruction est complète », vérifier une affirmation. | — | NON REPRIS (rétro-ingénierie) |
| Projets `projects` (21) | voir parcours principal. | — | voir lignes ci-dessus |
| Construire `build` (6) | lire/écrire/éditer des fichiers du projet, liste de contrôle, commande de construction. | `shell_run`, `file_save`. | FAIT (autrement) |
| Moteurs et réglages `setup` (9) | installer Ghidra, plugins. | — | NON REPRIS |
| Programmes natifs (55), Apple (14), formats (36), .NET (8), Android (14), Java (6), téléphone ADB (24), Electron/JS (11), exécution/GDB/Rizin (14), Frida (9), base SQLite (1) | désassemblage, décompilation, instrumentation. | — | NON REPRIS : rétro-ingénierie de logiciels tiers ; risque juridique et de sécurité pour un produit grand public ; incompatible avec la règle « clean room » de Sklubot (`docs/CLEANROOM.md`). |
| Couche IA | 9 adaptateurs d'agents (Aider, Antigravity, Copilot, Devin, Grok, Hermes, Maki, OpenCode, « dsh »), ACP, SSH distant, détection des agents installés. | Claude Code et Codex seulement (`engine.ts`). | DIFFÉRENT — IDÉE (L) : ACP permettrait d'ajouter d'autres agents CLI avec un seul adaptateur. |

## Peut-on installer davantage dans l'image du bot ?

- C'est déjà fait (CLI 0.6.1 figé et vérifié). Ce qu'il ne faut **pas** ajouter : l'appli de bureau (inutile), Ghidra, Frida, GDB/Rizin, ADB (outils de rétro-ingénierie).
- Ce que rend l'outil Sklubot `design_reference_layout` : un JSON de mesures (viewport, tailles de police, sections, marges, fonds, colonnes) d'une page **déjà ouverte**. Ce que rend le CLI Craft Anything : une capture complète (texte visible, titres, captures par largeur, états de menus), une construction et des contrôles chiffrés. Sklubot n'utilise que la mesure et une construction **sans contrôle** (`--rounds 0`).
- Le serveur MCP du CLI (`craft-anything-cli mcp`) pourrait être branché comme outil local, mais il expose les 305 outils, y compris ceux de rétro-ingénierie : seulement avec une liste blanche stricte.

## Écarts de comportement

1. **Questions du constructeur avalées.** Craft Anything, lancé à la main, pose ses questions et approbations à la personne. Sklubot le lance en `--unattended` : chaque question prend la première réponse, chaque approbation est refusée (`rebuild_cmd.rs:257-271`), et l'utilisateur n'en sait rien. Correctif M : lancer sans `--unattended` derrière un pont qui transforme chaque question en `ask_user` (ou au minimum, après le run, lister à l'utilisateur les questions et réponses choisies automatiquement, lues dans `questions.json` du projet).
2. **Construction sans vérification.** Craft Anything compare et affine (rondes de contrôle). Sklubot impose `--rounds 0` (`creative-tools.ts:17`) : aucune comparaison, aucun « X % ressemblant ». Le bot doit ensuite regarder lui-même. Correctif S : `--rounds 1` ou 2 quand il y a une référence, et rendre le score à l'utilisateur.
3. **Clean room seulement conseillé.** Craft Anything l'impose dans son moteur ; Sklubot se contente de « Use --clean-room » dans un message d'outil. Comme le bot lit des pages web (contenu extérieur qui peut tenter de le manipuler), un passage en `--deep` est possible. Correctif S : refuser dans `shell_run` toute commande `craft-anything-cli` contenant `--deep` ou `deep_mode`, et écrire au démarrage un réglage `deep_mode=false`.
4. **Erreurs classées par mots.** Craft Anything a retiré toute décision fondée sur des mots anglais du message d'erreur. Sklubot classe les erreurs moteur par regex (`engine.ts:642`, `sidereply.ts`). Correctif M : se fonder d'abord sur les champs structurés du flux JSON.
5. **Coût des tours repris.** Craft a mesuré que le coût total renvoyé par Claude Code est cumulatif sur une session reprise. Sklubot reprend toujours la session (`--resume`, `engine.ts:801`) et additionne `usage` à chaque tour : à vérifier tout de suite, car un cumul fausserait plafonds et journal des bots sur abonnement.
6. **Outils Sklubot absents sans le dire.** Craft arrête le CLI si son serveur MCP n'a pas démarré. Sklubot ne contrôle pas l'état de son serveur MCP dans `init` : le bot peut travailler sans mémoire, coffre ni approbations Sklubot, et répondre comme si de rien n'était. Correctif S.
7. **Notes pendant le travail.** Les deux plient la note dans le tour en cours ; Craft garde la note sur disque (survit à une fermeture) et permet de la reprendre. Sklubot la garde en mémoire (`Map`) : perdue si le serveur redémarre pendant le tour (non vérifié qu'un autre mécanisme la rattrape).

## À faire, par ordre de valeur

1. ✅ **Vérifié (2026-11-22).** `usage` d'un tour `--resume` n'est **pas** cumulé (Claude Code 2.1.330, trois tours) ; seuls `total_cost_usd` et `modelUsage` le sont, et Sklubot ne les lit pas. Rien à corriger ; testé (`engine-failure.ts` `claudeTurnTokens`, `engine-structured.test.ts`) — S.
2. ✅ **Fait (2026-11-22).** Garde devant le CLI dans l'image (`--clean-room` forcé, `--deep` / `deep_mode` refusés) + refus dans `shell_run` (`install-craft.sh`, `agent/craft-run.ts`) — S.
3. ✅ **Fait en partie (2026-11-22).** Montré après coup : `craft_workspace` `report: true` affiche dans le chat les questions tranchées seules et les refus. Reste : relais en direct en `ask_user` — M.
4. ✅ **Fait en partie (2026-11-22).** 2 rondes seulement pour le site du propriétaire (ses propres mots), « X % ressemblant » dans le rapport. Reste : les captures — S.
5. ✅ **Fait (2026-11-22).** Claude Code : `init` lu, outil arrêté, message + carte ; Codex : serveur `required` (`agent/engine.ts`, `engine-failure.ts`) — S.
6. ✅ **Fait (2026-11-22).** Claude Code : `assistant.error`, `api_error_status`, forme de la session perdue ; classe `server_fault` jamais relancée (Codex : pas de champ structuré) — M.
7. ✅ **Fait en partie (2026-11-22).** `install-craft.sh` et la politique de `craft_workspace` testés (`craft-install.test.ts`). Reste : `layoutExpression` — S.
8. Détection « aucun progrès » (rien n'a changé dans les fichiers après 2 tours) pour les tâches de création — M.
9. ✅ FAIT (23/11, `agent/creationplus.ts`) — Budget par création (images/vidéos générées) en plus des plafonds globaux — S.
10. Étapes nommées (étudier / construire / vérifier / prêt) sur la carte d'une création — M.
11. Notes pendant un tour gardées sur disque + « reprendre ma note » — S.
12. Question « à côté » (`/btw`) qui n'interrompt pas le travail — S.
13. ✅ FAIT (23/11, questions ouvertes sur la carte d'une création) — Liste « questions ouvertes / hypothèses » visible sur une tâche longue — M.
14. Parcours web enregistré puis rejoué pour surveiller un site (formulaire, panier) — M.
15. Infobulles de glossaire sur les termes de l'interface — S.
16. Export « rapport de cette conversation » (Markdown/PDF) — S.
17. ✅ FAIT (23/11, alerte une fois par version, rien n'est installé) — Alerte quand une nouvelle version vérifiée de Craft Anything existe — S.
18. Adaptateur ACP pour d'autres agents CLI — L.

## Non vérifié

- Si `usage` du résultat Claude Code est cumulé sur une session reprise (point 1) : pas de test en direct possible ici.
- Que les processus `claude`/`codex` du conteneur sont tués quand le serveur redémarre en plein tour.
- Que les journaux d'échec Sklubot masquent les options secrètes des commandes.
- Le collage Ctrl+V d'images dans le Composer.
- Les 305 outils un par un (regroupés par famille depuis `docs/tools.md`) ; `docs/STATUS.md` lu partiellement (sections « Builder retry policy », « Build progress across runs »).
- Aucun test Sklubot lancé pour cette partie : il n'en existe pas pour le code repris de Craft Anything.
