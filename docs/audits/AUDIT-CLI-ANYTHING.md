# Audit : HKUDS/CLI-Anything face à Sklubot

Type : **PACK DE SKILLS + méthode** : ~85 « harnais » (des CLI Python qui pilotent un vrai logiciel : Blender, GIMP,
LibreOffice, Zoom…), 71 `SKILL.md` dans `skills/`, une commande `/cli-anything` pour en générer de nouveaux
(`cli-anything-plugin/HARNESS.md`), un gestionnaire `cli-hub`, un protocole d'aperçu. Clone superficiel lu le
2026-11-22, jamais exécuté, supprimé après écriture.

Attention au nom : Sklubot installe déjà **Craft Anything** (`docker/desktop/install-craft.sh`,
`storytold/craft-anything` v0.6.1, MIT/Apache) pour `design_reference_layout`. **Ce n'est pas le même projet** que
CLI-Anything ; rien de CLI-Anything n'est aujourd'hui dans Sklubot (`grep -ri cli-anything` : 0 résultat).

## Comptes

Mécanismes de la méthode et de l'outillage (tableau 1) :

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 5 | 6 | 6 | 3 | 4 |

Skills (tableau 2, 70 lignes) : **ADAPTER 4 · IDÉE 17 · NON 49**.

## Licence

`LICENSE` à la racine : **Apache License 2.0** ; `cli-anything-plugin/LICENSE` : Apache-2.0 aussi. **Aucun dossier de
skill n'a de licence propre** : chacun est donc sous Apache-2.0 du dépôt. Chaque harnais **appelle** un logiciel
tiers qui a sa propre licence (Blender, Inkscape, MuseScore, Audacity, Kdenlive : GPL ; LibreOffice : MPL ; Calibre :
GPL) : appeler un programme en ligne de commande ne contamine pas Sklubot, mais **installer** ces logiciels dans l'image
du bot ajoute leur licence et leur poids. Plusieurs harnais visent des services payants ou des clés (AnyGen, MiniMax,
Novita, Exa, Mailchimp, Zoom, Tigris) : clés à passer par le relais `sklubot-api`, jamais dans l'ordinateur du bot.

## Tableau 1 : mécanismes de la méthode et de l'outillage

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Méthode | `/cli-anything <dépôt>` : analyser le code d'un logiciel, concevoir une CLI, l'écrire, la tester, écrire son SKILL.md, la publier (7 phases, HARNESS.md) | MANQUANT | — | Un bot qui a un terminal et Claude Code/Codex (Dockerfile ligne 27) pourrait le faire à la demande ; aucune compétence ne le guide | M |
| Méthode | « Utiliser le vrai logiciel, ne pas le réimplémenter » (ex. produire un ODF puis le convertir par le vrai LibreOffice) | FAIT | `office_convert/recalculate/render` par LibreOffice dans l'ordinateur du bot (`server/src/office.ts`, docs/ORDINATEUR.md) ; test `server/test/wave10-linux.test.ts` (non lancé) | — | — |
| Méthode | Vérifier la sortie (images ffmpeg au début/milieu/fin d'une vidéo, niveaux RMS de l'audio) | PARTIEL | `video_frames` (docs/ORDINATEUR.md) ; `office_render` | Pas de règle « vérifie le fichier produit » dans la consigne des bots | S |
| Méthode | Sortie JSON + texte humain pour chaque commande | DIFFÉRENT | Outils natifs, résultats texte | — | — |
| Méthode | REPL « peau » commune (`repl_skin.py`) | NON REPRIS | — | Interface terminal humaine | — |
| Méthode | `--dry-run` + sauvegarde automatique après une commande réussie, jamais après une erreur | PARTIEL | Instantanés de fichiers avant/après un tour (`server/src/snapshots.ts`, carte « fichiers » + diff, peerreview.ts) | Pas de « dry-run » proposé aux outils de modification de fichiers | S |
| Méthode | Verrou de fichier de session (`_locked_save_json`, écriture atomique) | PARTIEL | Ordinateur partagé : un conducteur à la fois (linux.ts `SharedComputerInUseError`) | Deux bots qui écrivent le même fichier du dossier d'équipe (`/root/team`) : pas de verrou vu | M |
| Méthode | Liste blanche des arguments passés aux sous-processus (codecs), échappement Script-Fu/XML, chemins normalisés, fichiers de clés en 0600 (SECURITY.md) | PARTIEL | Le bot est root dans **son** conteneur : l'injection d'argument n'y menace que lui ; clés hors de l'ordinateur (relais `sklubot-api`) ; `destructiveCommand` (irreversible.ts:44-52) | — | — |
| Méthode | SKILL.md généré automatiquement depuis la CLI (`skill_generator.py`) | MANQUANT | `skill_propose`/`skill_save` : le bot rédige une compétence (tools list) | Générer la fiche à partir du `--help` d'un outil installé | S |
| Méthode | Tests unitaires + e2e par harnais (2 461 tests annoncés), `TEST.md` | DIFFÉRENT | Tests du serveur Sklubot | — | — |
| Méthode | Publication PyPI (`cli-anything-<nom>`) | NON REPRIS | — | — | — |
| Hub | `cli-hub install <nom>` (pip/npm/brew), registre public, méta-skill de découverte | PARTIEL | `sklubot-install` (paquets Debian restaurés après reconstruction, docs/ORDINATEUR.md) ; installs pip/npm `--user` gardés dans le volume | Pas de catalogue d'outils CLI pour bots ; le bot cherche seul | M |
| Hub | Registre des dates/versions, comptage des visites | NON REPRIS | — | — | — |
| Skills | Installation des skills par `npx skills add HKUDS/CLI-Anything --skill <s>` | FAIT (équivalent) | Import de compétences depuis GitHub, en brouillon, licence détectée, rien d'exécuté (docs/COMPETENCES.md §2) | Les SKILL.md de CLI-Anything supposent que la CLI est installée : importés seuls, ils sont inutiles | — |
| Aperçu | **Protocole d'aperçu** : un « bundle » (manifeste, résumé, artefacts avec rôles), aperçu en direct, `trajectory.json` (suite des étapes et rendus), budget de performance, « principe de vérité » (ne jamais montrer un aperçu périmé comme actuel) — `docs/PREVIEW_PROTOCOL.md` | PARTIEL | Pages/artefacts publiés et versionnés, captures dans le chat ; `frame()` pour les démos | Une **trajectoire visuelle** d'un travail créatif (rendu à chaque étape) montrée à l'utilisateur | M |
| Backend | « Motif MCP » : une CLI qui enveloppe un serveur MCP existant (safari-mcp, DOMShell) | FAIT (équivalent) | `local_tool_server_add` (tools.ts:1300) | — | — |
| Backend | Pont local par HTTP vers un logiciel qui tourne (Obsidian Local REST, Zotero, jeux via mod) | DIFFÉRENT | Relais Electron : shell et fichiers sur l'ordinateur de l'utilisateur (`companion/src/main/capabilities/`) | Les API locales (Obsidian, Zotero) de l'utilisateur ne sont pas exposées | M |
| Docs | Démos vidéo, rapport technique (arXiv) | NON REPRIS | — | — | — |
| Guides | Traduction de filtres (ffmpeg ↔ MLT), précision des timecodes | MANQUANT | `server/templates/video-workflow.py` | Utile si montage vidéo par MLT | S |
| Guides | Guide « méthodologie d'aperçu » | MANQUANT | — | — | S |
| Sécurité | Durcissement des fichiers de jeton contre traversée de chemin et liens (Sketch) | FAIT (esprit) | `resolveInWorkspace` (computer.ts:412), `files.js` réels-chemins | — | — |
| Sécurité | Écriture SQLCipher « sauvegarde obligatoire avant écriture forcée » (Rekordbox) | FAIT (esprit) | `my_file_write` : l'ancienne version part à la corbeille (files.js en-tête) | — | — |
| Qualité | Passe qualité/sécurité régulière sur les harnais existants | MANQUANT | — | Les outils installés par les bots ne sont jamais revus | — |

## Tableau 2 : un skill par ligne

Licence de **chaque** dossier : Apache-2.0 (celle du dépôt ; aucun fichier propre). « Équivalent » vérifié dans
`server/skills-library/catalog.json` (16 compétences : design, pages, méthode, e-mail, vidéo GitHub, OpenDesign),
`server/templates/` (assistant, boutique, prospection, réseaux sociaux, secrétariat, SEO, service client, finances,
veille, vidéo, MoneyPrinter, OpenMan) et `docs/COMPETENCES.md`, plus les outils natifs.

| Skill | Ce qu'il fait | Équivalent Sklubot | Verdict |
|---|---|---|---|
| cli-hub-meta-skill | Découvrir et installer les CLI du catalogue | `sklubot-install`, `local_tool_server_add` | IDÉE : fiche « trouver et installer un outil CLI » pour l'ordinateur du bot |
| cli-anything-libreoffice | Documents ODF réels, conversion par LibreOffice | `office_convert/recalculate/render` (office.ts) | NON (déjà couvert ; IDÉE : création de documents structurés) |
| cli-anything-drawio | Créer/éditer/exporter des diagrammes draw.io | Aucun | ADAPTER : les bots font souvent des schémas ; export SVG/PNG ; draw.io desktop est Apache-2.0 mais lourd (Electron) → préférer un export par fichier XML + rendu |
| cli-anything-mermaid | Diagrammes Mermaid, rendu via mermaid.ink | Aucun (pages HTML peuvent inclure Mermaid) | ADAPTER, **sans** mermaid.ink (service externe qui reçoit le contenu) : rendu local via `@mermaid-js/mermaid-cli` |
| cli-anything-gimp | Retouche d'images (en fait basée sur Pillow) | Pillow + ImageMagick dans l'image (Dockerfile) ; `image_generate` | IDÉE : fiche « retouches courantes avec Pillow/ImageMagick » |
| cli-anything-inkscape | Graphismes vectoriels | Aucun | IDÉE (Inkscape GPL, ~100 Mo) |
| cli-anything-krita | Peinture numérique, calques, export | Aucun | NON (niche) |
| cli-anything-blender | Scènes 3D, rendu | Aucun | NON (très lourd ; utile seulement pour un public 3D) |
| cli-anything-freecad | CAO paramétrique (258 commandes) | Aucun | NON (niche) |
| cli-anything-threemf | Fichiers 3MF d'impression 3D | Aucun | NON (niche) |
| cli-anything-cloudcompare | Nuages de points 3D | Aucun | NON (niche) |
| cli-anything-qgis | Cartes SIG, couches, exports | Aucun | NON (niche, lourd) |
| cli-anything-audacity | Montage audio | ffmpeg dans l'image | IDÉE : fiche « couper/normaliser un son avec ffmpeg » |
| cli-anything-kdenlive | Montage vidéo (MLT) | ffmpeg, `video-workflow.py`, MoneyPrinter | IDÉE (MLT/melt : montage multi-pistes reproductible) |
| cli-anything-shotcut | Montage vidéo (MLT XML) | idem | IDÉE (même moteur que Kdenlive ; choisir un seul) |
| cli-anything-openscreen | Éditer des enregistrements d'écran (zooms, rampes) | `frame()` démos | IDÉE : vidéos de démonstration plus soignées |
| cli-anything-videocaptioner | Transcrire, traduire, incruster des sous-titres | `transcribe`, `listen_screen`, ffmpeg | ADAPTER : sous-titres incrustés = demande fréquente (réseaux sociaux) ; le harnais annonce ASR gratuit, à vérifier |
| cli-anything-obs-studio | Éditer les scènes OBS | Aucun | NON (OBS sur l'ordinateur de l'utilisateur, hors portée) |
| cli-anything-musescore | Partitions : transposer, exporter PDF/MIDI | Aucun | NON (niche) |
| cli-anything-rekordbox | Bibliothèque DJ, platines | Aucun | NON (niche, base chiffrée de l'utilisateur) |
| cli-anything-wavetone | Logiciel Windows WaveTone | Aucun | NON (Windows, niche) |
| cli-anything-live2d | Modèles Live2D | Aucun | NON (niche) |
| cli-anything-comfyui | Files d'attente ComfyUI (génération d'images locale) | `image_generate` (fournisseurs) | IDÉE : connecteur pour un ComfyUI de l'utilisateur |
| cli-anything-ollama | LLM locaux Ollama | Moteurs de Sklubot | NON (les modèles se règlent dans Sklubot, pas par le bot) |
| cli-anything-novita | API IA compatible OpenAI | Moteurs Sklubot | NON (fournisseur payant) |
| cli-anything-minimax | Chat et voix MiniMax | Voix Sklubot | NON (payant) |
| cli-anything-anygen | Slides/documents via API AnyGen | Compétence « Présentations » (catalog.json) | NON (payant, doublon) |
| cli-anything-exa | Recherche web Exa | `search_web`, Agent Reach (Exa intégré, Dockerfile) | NON (déjà couvert) |
| cli-anything-intelwatch | Veille concurrentielle / OSINT | Modèle `veille-recherche.md` | IDÉE (sources à vérifier ; OSINT sur des personnes : NON) |
| cli-anything-browser | Navigateur par l'arbre a11y vu comme un système de fichiers (DOMShell, extension Chrome) | `element_snapshot` & co. | IDÉE : présentation « ls/cd/cat » d'une page ; extension tierce : NON |
| cli-anything-safari | Safari sur macOS via safari-mcp (84 outils) | Relais (pixels) | NON (macOS, navigateur de l'utilisateur) |
| cli-anything-web-yu-pri | Poste japonaise via le navigateur | — | NON (service local au Japon) |
| cli-anything-macrocli | Macros d'interface paramétrées, appelables en CLI | Routines | IDÉE : routines rejouables (voir « flow » dans AUDIT-AGENT-BROWSER) |
| cli-anything-iterm2 | Envoyer du texte à iTerm2, lire la sortie | `my_command` (Relais) | NON (macOS ; `my_command` couvre sous double accord) |
| cli-anything-iterm2-ctl | Variante du précédent | idem | NON |
| cli-anything-zoom | Réunions, participants, enregistrements | Composio (`composio-connect`, catalog.ts) | NON (passer par le connecteur officiel) |
| cli-anything-mailchimp | API Mailchimp (303 commandes) | Composio ; Klaviyo (catalog.ts) | NON (connecteur) |
| cli-anything-n8n | Flux n8n | Routines, Composio | IDÉE : connecteur n8n auto-hébergé |
| cli-anything-dify-workflow | Fichiers DSL Dify | — | NON |
| cli-anything-notebooklm | NotebookLM (expérimental, outil non officiel) | — | NON (pas d'API officielle) |
| cli-anything-obsidian | Notes Obsidian via Local REST API | Mémoire Sklubot ; Relais fichiers partagés | ADAPTER : lire/écrire les notes d'un coffre Obsidian **partagé par le Relais** (fichiers .md), sans le plugin REST |
| cli-anything-joplin | Notes Joplin | Mémoire ; Relais | IDÉE |
| cli-anything-siyuan | Notes SiYuan | — | NON (niche) |
| cli-anything-mubu | Plans Mubu | — | NON (niche, Chine) |
| cli-anything-zotero | Bibliothèque Zotero | — | IDÉE (chercheurs : connecteur API web Zotero officiel plutôt que l'appli) |
| cli-anything-calibre | Livres numériques : métadonnées, conversion | Aucun | IDÉE (conversion EPUB/PDF utile ; Calibre ~200 Mo, GPL) |
| cli-anything-openrefine | Nettoyer des données en désordre | pandas dans l'image | IDÉE : fiche « nettoyer un tableur avec pandas » |
| cli-anything-firefly-iii | Finances personnelles Firefly III | Modèle `suivi-finances.md` | IDÉE (connecteur API pour qui l'héberge) |
| cli-anything-chromadb | Base vectorielle | Mémoire Sklubot | NON (interne) |
| cli-anything-tigris | Stockage objet Tigris | — | NON (payant) |
| cli-anything-adguardhome | Blocage DNS AdGuard Home | — | NON (administration réseau de l'utilisateur, risque) |
| cli-anything-rms | Gestion de routeurs Teltonika | — | NON |
| cli-anything-jumpserver | Bastion JumpServer | — | NON (accès à des serveurs : risque élevé) |
| cli-anything-eth2-quickstart | Déployer un nœud Ethereum | — | NON (crypto, serveurs) |
| cli-anything-pm2 | Processus Node | `job_*` (tâches de fond) | NON (développeur) |
| cli-anything-wiremock | Serveur de bouchons HTTP | — | NON (développeur) |
| cli-anything-lldb | Débogueur LLDB | — | NON (développeur) |
| cli-anything-renderdoc | Captures RenderDoc | — | NON (développeur) |
| cli-anything-nsight-graphics | Nsight (Windows) | — | NON |
| cli-anything-unrealinsights | Traces Unreal | — | NON |
| cli-anything-nslogger | Journaux NSLogger | — | NON |
| cli-anything-cloudanalyzer | QA de cartographie/perception | — | NON |
| cli-anything-unimol-tools | Prédiction de propriétés moléculaires | — | NON (niche) |
| cli-anything-godot | Projets Godot | — | NON (développeur jeux) |
| cli-anything-sbox | Moteur s&box | — | NON |
| cli-anything-slay-the-spire-ii | Jouer à un jeu via un mod | — | NON |
| cli-anything-seaclip | Tableau de projet SeaClip | Tâches Sklubot | NON |
| cli-anything-eez-studio | Projets EEZ / LVGL | — | NON |
| cli-anything-ccswitch | Configs d'outils de code IA | — | NON |
| cli-anything-quietshrink | Compresser des vidéos sur Mac (HEVC matériel) | ffmpeg | NON (macOS) |

(Total : ADAPTER 4 = drawio, mermaid, videocaptioner, obsidian. IDÉE 17, dont deux fortes : méta-skill « outil CLI »
et la méthode `/cli-anything` comme compétence de bot. NON 49.)

## Peut-on l'installer dans l'image des bots ?

- **Le dépôt entier : non.** ~85 harnais Python, chacun avec ses dépendances et souvent un gros logiciel (Blender,
  QGIS, FreeCAD) : des Go d'image pour une minorité d'usages.
- **À la demande, oui, sans risque pour l'hôte** : le bot peut déjà `pip install --user` un harnais publié
  (`cli-anything-<nom>` sur PyPI) et `sklubot-install` le logiciel Debian sous-jacent ; tout reste dans son conteneur
  sans privilèges. Ce qui manque : une compétence qui l'explique, et la vérification de l'origine (PyPI : noms
  usurpables — Sklubot a déjà eu ce cas avec Agent Reach, installé depuis GitHub et pas PyPI, Dockerfile ligne 34).
- Ce que renvoie l'outil vs Sklubot : un harnais renvoie du JSON (`--json`) sur un **projet fichier** qu'il modifie
  et peut prévisualiser ; Sklubot renvoie, via `shell_run`, la sortie texte de la commande. Pas de perte, mais pas de
  « bundle d'aperçu » montrable à l'utilisateur.

## Écarts de comportement (court)

1. **« Fais-moi un schéma de ce processus. »** CLI-Anything : harnais drawio/mermaid → fichier + rendu PNG/SVG vérifié.
   Sklubot : le bot écrit une page HTML ou une image générée ; pas de format de diagramme modifiable. **Correction (S)** :
   installer `mermaid-cli` (rendu local, sans mermaid.ink) et une fiche « diagrammes ».
2. **« Ajoute des sous-titres à cette vidéo. »** CLI-Anything : transcrire → corriger/traduire → incruster, en étapes
   vérifiables. Sklubot : `transcribe` + ffmpeg à la main ; pas de fiche. **Correction (S)** : compétence « sous-titres »
   (SRT, incrustation ffmpeg, contrôle d'une image avec `video_frames`).
3. **Travail créatif long.** CLI-Anything : aperçu à chaque étape + trajectoire, « jamais un aperçu périmé présenté comme
   actuel ». Sklubot : captures éparses dans le chat. **Correction (M)** : carte « trajectoire » (vignettes des rendus
   successifs d'un fichier livré).
4. **Logiciel sans API.** CLI-Anything : générer un harnais depuis le code source. Sklubot : le bot clique dans l'appli
   (pixels) ou abandonne. **Correction (M)** : compétence « écrire un petit outil CLI pour un logiciel » adaptée de
   HARNESS.md (phases 1-6, sans publication), à utiliser avec Claude Code/Codex déjà installés dans l'image.

## À faire (classé)

1. Compétence « diagrammes » + `mermaid-cli` local dans l'image (S).
2. Compétence « sous-titres » adaptée de videocaptioner avec les outils existants (S).
3. Compétence « trouver/installer un outil CLI » (méta-skill), avec la règle « depuis la source officielle, version figée, empreinte vérifiée » (S) — **fait le 22/11/2026** (`installer-un-outil-cli`).
4. Compétence « notes Obsidian » sur un coffre partagé par le Relais (fichiers .md) (M).
5. Compétence « écrire un harnais CLI » adaptée de HARNESS.md (phases 1-6) (M). En partie le 22/11/2026 : `petit-outil-cli` (écrite pour Sklubot, pas le harnais complet).
6. Règle « vérifier le fichier produit » (frames vidéo, niveaux audio, rendu de document) dans la méthode de travail (S).
7. Carte « trajectoire » d'aperçus pour le travail créatif (M).
8. Verrou d'écriture sur les fichiers du dossier d'équipe partagé (M).
9. Fiches IDÉE au cas par cas : retouche Pillow/ImageMagick, audio ffmpeg, nettoyage pandas, Calibre (S chacune) — **fait le 22/11/2026** (`retouche-d-images`, `audio-ffmpeg`, `nettoyer-des-donnees`, `livres-numeriques`).

## Non vérifié

- Aucun harnais n'a été exécuté ; leurs promesses (ASR gratuit de videocaptioner, 2 461 tests) ne sont pas vérifiées.
- Je n'ai pas lu le code de chaque harnais, seulement les SKILL.md, HARNESS.md, SECURITY.md, PREVIEW_PROTOCOL.md et
  les guides.
- Le test `wave10-linux.test.ts` (outils bureautiques) n'a pas été lancé.
