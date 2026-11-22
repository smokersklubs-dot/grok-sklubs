# Audit complet : hallmark (Nutlope / Together AI) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `Nutlope/hallmark`, commit `04977e1` (11/11/2026), v2.0.0, 860 fichiers, 124 Mo (surtout des images du site). Rien n'a été exécuté.

Type : **une compétence de design + outils** pour pages web « qui n'ont pas l'air générées par une IA ». Contenu : `SKILL.md` (154 lignes, « le Plancher » de 16 règles + un déroulé en 8 étapes), ~45 références (gates, anatomie par métier, 21 « macrostructures » de page, 4 genres, 50 thèmes avec photo de page finie, craft, mode sombre, dataviz, formulaires, micro-interactions, refonte…), scripts : `sloplint.mjs` (4 400 lignes, linter statique + rendu dans Chrome à 8 largeurs), `theme.mjs` (tirage de 3 thèmes, tirage de la structure, échafaudage `tokens.css`/`base.css`, journal de rotation, photos), `capture.mjs`, `picture.mjs`, `imagegen.mjs` (Together AI, payant), hook d'édition, installeur qui valide, banc d'évaluation.

Inspiré, dit le README, d'Impeccable, frontend-design (Anthropic), Open Design, Kami et taste-skill : **Sklubot a déjà adapté frontend-design et Open Design**, donc une partie des règles est déjà chez nous.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 10 |
| PARTIEL | 14 |
| MANQUANT | 20 |
| DIFFÉRENT | 4 |
| NON REPRIS | 6 |
| **Total** | **54** |

Compétence (paquet) : 1 compétence → **ADAPTER** par morceaux (Plancher, anatomie par métier, macrostructures, revue « à froid », thèmes sans marque), plus **outil `sloplint` à installer** sur l'ordinateur du bot.

Lecture rapide : Sklubot a déjà, **en texte**, les principaux interdits « fait par une IA » (`metier-du-design` l.33-38 : violet Tailwind, dégradé violet→bleu, emoji comme icônes, chiffres inventés ; `pages-soignees` l.32 : jamais d'avis, logos, témoignages inventés ; `frontend-design` l.44-45 : surtitres en capitales espacées, points médians, flèches collées). Ce qui manque est **le contrôle automatique** : rien ne vérifie la page produite. Hallmark en fait le cœur (`sloplint --render` jusqu'à 0 échec, revue par un sous-agent « à froid »). Deuxième manque : **construire la page à partir du métier** (un restaurant réserve, une boutique vend) au lieu d'un gabarit générique.

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Dépôt et `skills/hallmark/LICENSE` | **MIT License**, © 2026 Hallmark contributors | Copier, modifier, revendre ; garder le copyright et le texte MIT. |
| Photothèque `scripts/photos.json` (755 photos) | Liste de fichiers **Wikimedia Commons** : chacun garde sa licence (CC0, domaine public, CC BY, **CC BY-SA**) ; aucune image dans le dépôt | Utilisable à condition de **créditer chaque photo** (auteur, licence, lien) sur la page — Hallmark le fait. CC BY-SA : la photo modifiée doit rester sous CC BY-SA. |
| Captures des thèmes (`themes/*.jpg`, `site/assets/`) | MIT (dépôt) ; pages fictives | Réutilisables, mais lourdes (124 Mo au total). |
| Polices citées par les thèmes (General Sans, Geist Mono…) | Licences propres à chaque police | Vérifier chaque police avant de l'imposer (certaines ne sont pas sur Google Fonts, seul hôte de polices autorisé par le bac à sable Sklubot). |
| Mention « Powered by Together AI » | marque | Ne pas reprendre. |

---

## 2. Tableau des fonctions

Preuves Sklubot : `server/skills-library/` — `metier-du-design/SKILL.fr.md` (l.33-38 signes IA, l.85 liste de contrôle), `pages-soignees/SKILL.fr.md` (l.32 contenu vrai), `frontend-design/SKILL.md` (l.19 héros, l.32 structure = information, l.44-45 tics), `theme-factory` (10 thèmes), `styles-de-base` (2 styles clair/sombre), `modeles-de-pages` (13 recettes, l.14 vraies données), `design-de-marque`, `presentations` ; `page_publish` (`server/src/agent/pagetools.ts` l.29) ; `browser_open` (`agent/tools.ts` l.150) ; guide intégré « artefact » (`agent/guides.ts` l.14).

### 2.1 Le Plancher (16 règles non négociables)

| # | Règle | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| P1 | Toute couleur et toute police passent par un jeton `:root` ; aucune valeur littérale après. | PARTIEL | `styles-de-base` (fiche de style), `theme-factory` | Pas une règle obligatoire ; non contrôlé. | S |
| P2 | Jamais `transition: all` ; jamais animer `width/height/top/left`. | PARTIEL | `metier-du-design` (mouvement) | Pas formulé ainsi ; non contrôlé. | S |
| P3 | Jamais un seul mot en italique dans un titre romain. | MANQUANT | — | — | S |
| P4 | `overflow-x: clip` sur `html` et `body` ; jamais `100vw`. | MANQUANT | — | Évite la barre de défilement horizontale sur téléphone (bug fréquent des pages générées). | S |
| P5 | Pistes de grille avec images en `minmax(0, 1fr)` ; grands titres `overflow-wrap: break-word; min-width: 0`. | MANQUANT | — | Idem (débordements sur mobile). | S |
| P6 | Chaque élément interactif a un `:focus-visible` immédiat. | PARTIEL | `metier-du-design` (accessibilité) | Non contrôlé. | S |
| P7 | Repli `prefers-reduced-motion` pour chaque animation ; contenu visible **sans JavaScript**. | PARTIEL | `metier-du-design` | « Visible sans script » absent. | S |
| P8 | Jamais de chiffre, témoignage, mur de logos ou nombre d'études de cas inventés. | FAIT | `pages-soignees` l.32, `metier-du-design` l.38, `modeles-de-pages` l.14 | — | — |
| P9 | Jamais de surtitre (« eyebrow ») ni d'étiquette en capitales espacées. | FAIT | `frontend-design` l.45 | — | — |
| P10 | Jamais de méta reliées par des points médians, de flèches collées aux liens, de points de statut décoratifs. | FAIT | `frontend-design` l.45 | — | — |
| P11 | Jamais de dégradé violet→bleu, de carte dans une carte, d'emoji comme icône, de fenêtre de navigateur dessinée à la main. | PARTIEL | `metier-du-design` l.33-35 (dégradé, emoji) ; `frontend-design` l.44 (cartes) | « Fenêtre de navigateur dessinée » absente. | S |
| P12 | Titre, phrase et action principale du héros visibles à 1280×800 sans défiler. | MANQUANT | — | Vérifiable automatiquement. | S |
| P13 | ~80 mots par écran ; héros = titre + une phrase + actions. | MANQUANT | — | — | S |
| P14 | Conteneur plafonné et centré (à 1920 px les marges grandissent, pas la mesure). | MANQUANT | — | — | S |
| P15 | « Tampon » en tête de CSS : décisions prises, ligne de critique, dérogations. | MANQUANT | — | Trace des choix utile pour reprendre/modifier une page plus tard. | S |
| P16 | Lancer `sloplint --render` avant de rendre ; corriger chaque FAIL, corriger ou justifier chaque REFLEX. | MANQUANT | — | Voir T1. | M |

### 2.2 Déroulé d'une construction

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| D1 | **Pré-vol** : lire le projet (polices, palette, framework, `design.md` verrouillé qui prime sur tout), citer fichier:ligne, dire ce qui est gardé et introduit ; cache. | PARTIEL | `design-de-marque` (profil, mémoire, fichiers, site) | Pas de fichier de charte verrouillé partagé (même constat que AUDIT-STITCH-SKILLS). | M |
| D2 | **Marque réelle** : jamais « thématiser » une vraie marque de mémoire (`brand-truth.md`). | FAIT | `design-de-marque` : relever sur le site officiel, ne jamais inventer | — | — |
| D3 | **Une seule question groupée** (matériel : captures, photos, vrais chiffres, citation nommée, logos autorisés ; public ; usage ; ton) ; champs sautés = déduits et annoncés en une ligne ; **les faits ne sont jamais déduits** ; pas de question en mode sans tête. | PARTIEL | `design-de-marque` : « une seule question courte » | La question ne demande pas le **matériel** (photos, chiffres, citations) ; pas de ligne « ce que j'ai supposé ». | S |
| D4 | Genre choisi en silence (atmosphérique / moderne-minimal / ludique / éditorial) selon les mots du prompt. | MANQUANT | — | — | S |
| D5 | Portée : un composant seul, un écran d'appli, une page. | PARTIEL | Guide « artefact » | — | — |
| D6 | **Inventaire du matériel** : réel / images / absent ; la forme de la page suit (avec photos → on ouvre sur la photo). | MANQUANT | — | — | S |
| D7 | **Le métier de la page** (`anatomy.md`) : s'abonner, réserver, visiter, assister, acheter, essayer, s'inscrire, embaucher, rejoindre, écouter — où les vrais sites du secteur placent l'action, autour de quoi ils sont construits (la carte, la programmation, les numéros), comment ils finissent. | MANQUANT | `modeles-de-pages` = types de documents (rapport, tarifs, accueil…), pas métiers | Très utile pour les commerces de la cible Sklubot (restaurant, salon, boutique). | S |
| D8 | **21 macrostructures** (bento, long document, héros défilant, chiffres d'abord, établi, FAQ conversationnelle, manifeste, photographique, citation, spécimen, catalogue, lettre, index, récit de flux, studio partagé, empilement de fonctions, spécimen typo, portfolio, carte/diagramme, écosystème, terrain de jeu de composants). | PARTIEL | `modeles-de-pages` (13 recettes) | 21 formes de page plus variées ; chargées une à la fois. | S |
| D9 | **Tirage** (`theme.mjs draw`) : structure, posture du héros, navigation, pied, première section, place de l'action, deux compositions à éviter — **en évitant ce que le journal a déjà servi**. | MANQUANT | — | Deux pages Sklubot de suite se ressemblent ; un journal de rotation par compte l'éviterait. | M |
| D10 | **Signature** : la chose dont le visiteur se souviendra, sur le premier écran. | PARTIEL | `frontend-design` l.19 (le héros) | — | — |
| D11 | **Direction** : thème nommé > « sur mesure » (`direction.md`) > tirage de 3 thèmes adaptés, choix motivé. | PARTIEL | `theme-factory` (10 thèmes à choisir), `styles-de-base` | Pas de tirage motivé selon le prompt. | S |
| D12 | **50 thèmes** = matériaux (papier, typo, couleurs oklch, surfaces, composants, texture) ≤ 8 Ko chacun + photo d'une page finie ; un thème n'impose jamais le contenu ni l'ordre. | PARTIEL | `theme-factory` 10 thèmes, `styles-de-base` 2 | 50 thèmes sans marque, très au-dessus. Vérifier les polices (Google Fonts seulement dans le bac à sable). | M |
| D13 | Chargement **minimal** des références (« charger plus est le plus gros coût évitable »). | FAIT | Sklubot : `skill_read` / `guide_read` à la demande | — | — |
| D14 | **Bloc « Choix »** affiché une fois : structure, thème, chrome, héros, signature, sections, matériel (réel/images/absent), état du contrôle — **fenêtre pour que l'utilisateur redirige**. | MANQUANT | — | Pour un non-développeur : voir les choix avant la page entière, et pouvoir dire « non, plutôt… ». | S |
| D15 | Proposer de **verrouiller le système** en `design.md` pour les pages suivantes. | MANQUANT | — | Même idée que la « fiche de charte ». | S |
| D16 | **Échafaudage** `tokens.css` + `base.css` (ce que le Plancher a déjà décidé) : le modèle n'écrit que la page. | MANQUANT | `page_publish` accepte des fichiers `.css` à côté | Un `base.css` Sklubot fourni (débordements, focus, mouvement réduit, conteneur) éviterait les erreurs à chaque page. | S |
| D17 | `patterns.md` : contrôles dans **8 états**, emplacement pour image, **fait manquant**, formulaire qui n'envoie nulle part, une seule apparition animée, comparaisons. | PARTIEL | `metier-du-design` (états) ; « à compléter » pour les faits | Le formulaire « qui n'envoie nulle part encore » correspond au bac à sable Sklubot (formulaires bloqués) : à expliquer au visiteur. | S |
| D18 | **Héros d'abord** : construire nav + héros seuls, contrôler, **revue à froid**, puis le reste. | MANQUANT | — | Corrige tôt ce qui coûte cher plus tard. | S |
| D19 | Une idée par écran : titre ≤ 7 mots, phrase ≤ 12 mots, 6-9 sections, ≤ 450 mots visibles. | MANQUANT | — | — | S |
| D20 | **Montrer, pas décrire** : images de l'utilisateur, **captures du vrai produit** (prises par le script), sinon le produit reconstruit, sinon photothèque ; emplacements remplaçables. | PARTIEL | `browser_open` capture ; `image_generate` | Pas de photothèque libre créditée ; pas de règle « emplacement remplaçable ». | M |
| D21 | Invariants de page : un style de bouton principal, une largeur de conteneur, un écart de colonnes, un rayon par niveau, pas plus de groupes centrés que de groupes alignés à gauche. | PARTIEL | `metier-du-design` | — | S |
| D22 | Feuilles existantes en **ajout seul** (imports après le dernier `@import`), réutiliser les noms de jetons du projet. | NON REPRIS | — | Les bots publient des pages neuves. | — |
| D23 | **Journal** `.hallmark/log.json` (structure, thème, héros, nav, photos, signature, empreinte…) pour la rotation. | MANQUANT | — | Voir D9. | M |
| D24 | **Balayage** : `sloplint --render`, portes jugées, **revue finale par un sous-agent en contexte neuf** (premier mot : recapturer / reconstruire / corriger / livrer), demande de matériel finale (chaque emplacement, sa taille, le matériel qui améliorerait le plus la page), mise à jour du bloc Choix ; **« un faux succès est lui-même du bâclage »**. | MANQUANT | « Méthode de travail » : vérifier avant « fini » | Pas de relecteur à froid ; pas de « demande de matériel » à la fin. Sklubot a `helper_start` (aide) qui pourrait servir de relecteur. | M |
| D25 | Vérification **budgétée** : une inspection groupée, un lot de corrections, au plus une ronde de confirmation. | MANQUANT | — | Évite les boucles de corrections coûteuses. | S |
| D26 | Mode **rapide** (`--fast`, « vite », « brouillon », « prototype »). | MANQUANT | — | — | S |
| D27 | **Refonte** nommée : garder contenu et câblage, changer système et mise en page ; `sloplint --before` relève liens, champs, gestionnaires, titres ; `--kept` échoue si l'un disparaît. **Audit** : rapport seul. Jamais toucher un design existant sans qu'on le demande ; jamais supprimer une route sans plan approuvé. | PARTIEL | `page_edit` + 20 versions (`docs/COMPETENCES.md` § 3) | Le contrôle « rien de perdu » (liens, champs) d'une page refaite n'existe pas. | M |
| D28 | Dataviz, mode sombre, défilement scénarisé, texture, polices, formulaires (`interaction-and-states.md`), responsive : références à la demande. | PARTIEL | `metier-du-design`, `styles-de-base` (sombre) | — | S |

### 2.3 Outils

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| T1 | `sloplint.mjs` : linter statique (HTML/CSS/TSX/Vue, Tailwind) de ~114 portes en 3 niveaux (Plancher FAIL, Reflex à justifier, Finish à répondre), dérogations écrites dans le tampon, sortie JSON. | MANQUANT | — | Rien ne contrôle les pages des bots. | M |
| T2 | `sloplint --render` : rendu dans Chrome (puppeteer-core) à **8 largeurs**, captures, vérifs mesurées (débordement horizontal, héros au-dessus de la ligne de flottaison, focus…) ; `--stage hero` ; `--url` pour un serveur de dev. | MANQUANT | `browser_open` (une capture) | Même constat que AUDIT-ANATOMY : pas de capture téléphone automatique après publication. | M |
| T3 | `theme.mjs deal / draw / scaffold / log / photos` (avec `--save` qui ne télécharge **que** depuis `upload.wikimedia.org`, 4 essais, respect du 429). | MANQUANT | — | — | M |
| T4 | `capture.mjs` : captures du vrai produit (URL, serveur de dev, appli). | PARTIEL | `browser_open`, `screen_view` | — | S |
| T5 | `picture.mjs` : traitement des photos selon le thème (sépia, sourdine…). | MANQUANT | Pillow/ffmpeg sur le bureau | — | S |
| T6 | `imagegen.mjs` : génération d'images via l'API Together (clé `TOGETHER_API_KEY`), sinon repli « art CSS / emplacement étiqueté ». | DIFFÉRENT | `image_generate` (fournisseurs de Sklubot) | Le **repli honnête** (emplacement étiqueté plutôt qu'image inventée) est bon à reprendre. | S |
| T7 | `install.mjs` : valide chaque thème et référence avant de copier. | FAIT | `server/test/skills-library.test.ts` | — | — |
| T8 | `install-hook.mjs` / `lint-hook.mjs` : contrôle du Plancher à chaque modification de fichier (Claude Code). | DIFFÉRENT | — | Équivalent Sklubot possible : contrôle au `page_publish`/`page_edit`. | M |
| T9 | `refcheck.mjs` : vérifie les renvois entre références. | FAIT | Tests de la bibliothèque | — | — |
| T10 | Tests (`theme.test.mjs`, `capture.test.mjs`, `sloplint-render.test.mjs`, `reroll-exhaustion.test.mjs`, fixtures « slopped », « eyebrow », « tailwind », « waiver », « kept »). | DIFFÉRENT | Sklubot a ses tests | — | — |
| T11 | Banc d'évaluation (8 briefs dont « tente des chiffres inventés », grille de juge visuel en 6 axes, matrice modèles × packs). | MANQUANT | — | Méthode pour mesurer la qualité des pages Sklubot. | L |
| T12 | Photothèque 755 photos Commons, sans photos de banques d'images ré-uploadées, crédit sur la page. | MANQUANT | — | Une photothèque libre et créditée vaut mieux que des images générées pour un commerce réel. | M |

### 2.4 Divers

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| X1 | Site vitrine + captures de 50 thèmes. | NON REPRIS | — | — | — |
| X2 | Plugin Claude Code, marketplace. | NON REPRIS | Bibliothèque Sklubot | — | — |
| X3 | Feuille de route publique. | NON REPRIS | — | — | — |
| X4 | Harnais Codex/OpenCode (`flow.md` § Harnesses). | NON REPRIS | — | — | — |
| X5 | « Powered by Together AI » dans la compétence. | NON REPRIS | — | Marque. | — |
| X6 | Règle « nommer les fichiers touchés avant ; jamais supprimer une route sans plan approuvé ». | FAIT | Cartes d'accord sur les actions irréversibles (`server/src/agent/irreversible.ts`) | — | — |

---

## 3. Sur l'ordinateur du bot ?

- **`sloplint` statique** : Node seul (Node 22 présent), aucun appel réseau dans le contrôle statique. **Sûr.**
- **`sloplint --render`** : demande `puppeteer-core` (npm, Apache-2.0) + Chrome. L'image a Chromium (`docker/desktop/Dockerfile` l.12) mais pas puppeteer-core ; à installer **à la construction de l'image**, version épinglée. La partie rendu ne fait qu'un `fetch` des feuilles de style de la page elle-même (`sloplint-render.mjs` l.159). **Sûr.**
- **`theme.mjs photos --save`** : télécharge seulement depuis `upload.wikimedia.org`. **Sûr**, mais passe par le réseau du bureau.
- **`imagegen.mjs`** : clé Together → ne pas utiliser (Sklubot a ses fournisseurs).
- **Ce que l'outil rend** : liste JSON des fautes par porte (`FAIL`/`REFLEX`/`WARN`, fichier, ligne, porte), captures à 8 largeurs. **Équivalent Sklubot** : rien (la page est publiée sans contrôle ; le bot peut prendre une capture avec `browser_open`).
- Recommandation : copie figée du dossier `skills/hallmark/scripts` (MIT) dans l'image, ou récupération à la demande ; appel par le bot via `shell_run` sur le fichier de la page **avant** `page_publish`. Mieux encore : porter 10-15 règles du Plancher dans un contrôle serveur au moment de `page_publish` (marche aussi sans bureau).

---

## 4. Écarts de comportement

1. **Une page de commerce.** Hallmark : une question groupée qui demande le **matériel** (photos, vrais chiffres, citations), identifie le métier (« réserver »), place l'action là où les vrais sites du secteur la mettent, tire un thème motivé, montre le bloc Choix, construit le héros seul et le fait relire à froid, contrôle à 8 largeurs, puis demande le matériel manquant. Sklubot : `design-de-marque` cherche la marque puis une question courte ; `pages-soignees`/`modeles-de-pages` donnent des recettes par type de document ; le bot construit tout d'un coup et publie. **Écarts** : pas de question sur le matériel (la page finit pleine de « à compléter » sans que l'utilisateur sache quoi fournir), pas de structure par métier, pas de contrôle automatique. **Correctifs** : D3/D7/D24 (S chacun) + T1/T2 (M).
2. **Deux pages de suite se ressemblent.** Hallmark garde un journal et tire en évitant ce qui a déjà servi. Sklubot n'a pas de mémoire des choix de design passés (sauf si le bot l'écrit en mémoire). **Correctif** : journal de design par compte (M).
3. **Un faux succès.** Hallmark interdit d'écrire « 0 échec » sans avoir lancé le contrôle (« un faux succès est lui-même du bâclage »). Sklubot demande de vérifier mais n'a aucun résultat de contrôle à citer. **Correctif** : que `page_publish` renvoie un court rapport de contrôle que le bot doit reprendre tel quel (M).

---

## 5. À faire (classé)

1. Contrôle automatique au `page_publish` (10-15 règles du Plancher : jetons, `transition: all`, `100vw`/débordement, `:focus-visible`, mouvement réduit, héros sous 1280×800, emoji-icônes, dégradé violet→bleu, carte dans carte) avec rapport renvoyé au bot — **M**.
2. Installer `sloplint` (+ `puppeteer-core` épinglé) sur l'ordinateur du bot et l'exiger dans `pages-soignees` avant publication — **M**.
3. Fournir un `base.css` Sklubot (débordements, focus, mouvement réduit, conteneur, grilles d'images) à joindre à chaque page — **S**.
4. Compétence **« Page d'un commerce par métier »** : anatomie des 10 métiers + 21 macrostructures, adaptée (MIT, crédit) — **S**.
5. Dans `design-de-marque`/`pages-soignees` : **une question groupée sur le matériel** (photos, chiffres, citations, logos autorisés) et une ligne « ce que j'ai supposé » — **S**.
6. **Bloc « Choix »** montré avant de construire toute la page + héros d'abord — **S**.
7. **Relecture à froid** par une aide (`helper_start`) avec un verdict en un mot (recapturer / reconstruire / corriger / livrer) — **M**.
8. Journal de design par compte pour varier structure et thème d'une page à l'autre — **M**.
9. Étendre `theme-factory` avec une sélection de thèmes Hallmark sans marque (polices Google Fonts seulement) — **M**.
10. Photothèque libre Wikimedia Commons avec crédit automatique en bas de page — **M**.
11. Contrôle « rien de perdu » à la refonte d'une page (liens, champs, titres avant/après) — **M**.
12. Ajouter à `metier-du-design` les règles absentes (P3, P4, P5, P12-P14, « visible sans JavaScript », « pas de fenêtre de navigateur dessinée ») — **S**.

## 6. Non vérifié

- Les ~114 portes de `gates.md` et les 4 400 lignes de `sloplint.mjs` n'ont pas été lues une à une (structure, niveaux, exemples lus).
- Les 50 fichiers de thèmes : un seul ouvert (Coral) ; licences des polices citées non vérifiées.
- Pas de test du linter sur une page Sklubot réelle (aucun code exécuté).
- WebGL/polices hors Google Fonts dans le bac à sable Sklubot : non vérifié.
