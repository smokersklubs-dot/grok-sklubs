# Audit complet : stitch-skills (google-labs-code) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `google-labs-code/stitch-skills`, commit `62fdcd6` (20/11/2026), 91 fichiers. Rien n'a été exécuté.

Type : **paquet de compétences** pour le service Google Stitch (génération d'écrans par IA). 16 compétences dans 3 plugins (`stitch-design`, `stitch-build`, `stitch-utilities`), quelques scripts (téléchargement `curl`, envoi vers l'API Stitch, capture Puppeteer, validateur de composants React par AST) et 3 petits tests.

Demande du propriétaire : **pour chaque compétence, dire ce qui peut être adapté sans le service Stitch.** C'est la colonne « Sans Stitch » ci-dessous.

## Comptes

| Verdict / statut | Nombre |
|---|---|
| Compétences : ADAPTER | 7 |
| Compétences : IDÉE | 5 |
| Compétences : NON | 4 |
| Mécanismes : FAIT dans Sklubot | 4 |
| Mécanismes : PARTIEL | 4 |
| Mécanismes : MANQUANT | 5 |
| Mécanismes : DIFFÉRENT | 2 |
| Mécanismes : NON REPRIS | 3 |
| **Lignes au total** | **34** |

Lecture rapide : environ **60 % du texte du dépôt ne dépend pas de Stitch** : la méthode « DESIGN.md » (décrire une charte en mots + codes exacts), l'amélioration d'une demande floue en demande précise, le « goût » anti-générique, l'extraction d'une charte depuis du code, la capture d'une page en HTML autonome, la boucle de construction de site avec un « relais » écrit, et les règles React / React Native / shadcn. Sklubot couvre déjà bien le design (8 compétences design dans la bibliothèque) mais **n'a pas de fichier de charte partagé et durable** (sa compétence « Design de marque » range la marque dans la mémoire d'un bot), ni de **méthode pour construire un site de plusieurs pages en plusieurs passes**.

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Dépôt entier | **Apache License 2.0** (`LICENSE`), en-têtes « Copyright 2026 Google LLC » dans les scripts | Copier, modifier, redistribuer, y compris commercialement ; garder le texte de la licence, garder les mentions de copyright, **signaler les fichiers modifiés**. Pas de fichier NOTICE dans le dépôt : rien de plus à recopier. La licence ne donne **aucun droit sur les marques** (§ 6) : ne pas utiliser « Google », « Stitch » comme nom de compétence. |
| Dossiers de compétences | Pas de licence par dossier ; les README de `shadcn-ui` et `remotion` renvoient à la licence racine | Joindre le `LICENSE` racine à chaque compétence adaptée, comme Sklubot le fait déjà (`server/skills-library/*/LICENSE.txt` + `NOTICE`). |

Point de vigilance : `taste-design` reprend un style connu de la communauté (« taste skill ») sans citer d'origine dans le dépôt ; sa licence affichée est celle du dépôt (Apache-2.0). Risque faible, mais à noter dans le NOTICE.

---

## 2. Tableau des compétences

Équivalents Sklubot vérifiés : `server/skills-library/catalog.json` (design-de-marque, frontend-design, canvas-design, theme-factory, presentations, metier-du-design, styles-de-base, modeles-de-pages, opendesign-outil, pages-soignees, video-github, studio-animation), outil `design_reference_layout` (`server/src/agent/tools.ts` l.154), `page_publish` (`server/src/agent/pagetools.ts` l.29), ateliers vidéo `server/src/videoworkflows.ts` l.12-15 (dont Remotion), Studio `server/src/videostudio.ts` l.97.

| # | Compétence | Ce qu'elle fait | Licence | Sans Stitch, ce qui s'adapte | Équivalent Sklubot | Verdict | Taille |
|---|---|---|---|---|---|---|---|
| 1 | `design-md` (utilities) | Analyse un écran (capture + HTML) et écrit `DESIGN.md` : ambiance en adjectifs, couleurs avec **nom descriptif + code hex + rôle**, formes traduites en mots (« coins légèrement arrondis »), profondeur/ombres, règles de mise en page ; ce fichier devient la « source de vérité » pour toutes les pages suivantes. | Apache-2.0 | **Tout sauf la récupération** : remplacer « get_screen » par une capture `browser_open` + `page_read` + `design_reference_layout` d'un site existant ou d'une page déjà publiée. La structure du fichier est indépendante. | « Design de marque » range la marque **dans la mémoire du bot** (`skills-library/design-de-marque/SKILL.fr.md`, « memory_save en une phrase ») ; « Styles de base » a une « fiche de style » ; pas de fichier partagé et versionné. | **ADAPTER** : une compétence « Fiche de charte » qui écrit et relit `charte.md` dans les **fichiers d'équipe** (`server/src/teamfile.ts`), lue par tous les bots avant toute page. | M |
| 2 | `taste-design` (utilities) | Écrit un DESIGN.md « premium, anti-générique » : 3 curseurs (variance, densité, mouvement), interdits précis (pas de héros centré au-delà d'un seuil, pas de rangée de 3 cartes égales, `min-h-[100dvh]` et jamais `h-screen`, squelettes au lieu de roues de chargement, états vides et erreurs obligatoires). | Apache-2.0 | **Entièrement** (aucun appel Stitch dans le fond, seulement dans l'en-tête). | « Règles de métier du design » (`metier-du-design`, signes d'un design « fait par IA ») et `frontend-design` couvrent une partie. Les 3 curseurs et les interdits chiffrés n'y sont pas. | **ADAPTER** : fusionner les règles absentes (curseurs, `100dvh`, états vides/erreurs/chargement) dans `metier-du-design`. | S |
| 3 | `enhance-prompt` (utilities) | Transforme une demande floue (« une page sympa pour mon resto ») en demande structurée : plateforme, type de page, sections numérotées, mots d'ambiance, rôle des couleurs ; tables « vague → précis ». | Apache-2.0 | **Entièrement** : la sortie peut servir de cahier pour `page_publish`, `image_generate` ou un atelier vidéo. | Aucune compétence ne reformule une demande avant de construire. | **ADAPTER** : compétence « Préciser une demande de page » (utile aux non-développeurs, qui écrivent des demandes courtes). | S |
| 4 | `site-md` (utilities) | Écrit `SITE.md` : identité (nom, mission, public, ton), ambiance, structure des fichiers, plan du site coché `[x]/[ ]`, carnet de tâches par priorité, zones de liberté créative. | Apache-2.0 | **Entièrement**. | « Modèles de pages » et « Pages soignées » font une page à la fois ; aucun plan de site multi-pages. | **ADAPTER** (avec n°5) | S |
| 5 | `stitch-loop` (utilities) | Construction de site **en boucle avec relais** : chaque passe lit `next-prompt.md` (page à faire), consulte `SITE.md` (ne pas refaire une page existante) et `DESIGN.md`, génère, intègre, **coche la page**, puis écrit le relais suivant. Vérification visuelle facultative avec Chrome. | Apache-2.0 | **La méthode du relais entière** : remplacer « generate_screen » par `page_publish` (une page = un fichier du site). Le relais écrit permet de reprendre après un arrêt. | Sklubot a des objectifs (`agent/goals.ts`), des tâches (`task_add`) et la reprise après panne (`agent/failures.ts`), mais aucune compétence ne relie plan de site + charte + relais. Une page publiée n'est pas un site (pas de navigation partagée entre pages). | **ADAPTER** : compétence « Site en plusieurs passes » ; c'est le plus gros gain pour « fais-moi un site ». | M |
| 6 | `extract-design-md` (design) | Extrait une charte depuis le **code source** (React, Vue, Svelte, Angular, CSS simple) sans le lancer : détecte le framework par `package.json`, lit Tailwind/thèmes/variables, recense composants et motifs ; 5 fiches par framework. | Apache-2.0 | **Entièrement** (le dépôt le dit : « no build needed »). Utile quand l'utilisateur a déjà un site dans un dépôt GitHub. | `projectimport.ts` importe un zip de projet ; aucune compétence n'en tire la charte. | **ADAPTER** (complète n°1 : charte depuis le code au lieu de l'écran) | S |
| 7 | `extract-static-html` (design) | Capture une page qui tourne en **un seul fichier HTML** (CSS en ligne, images en base64) avec Puppeteer ; options : vue, classe sombre, retirer bandeaux fixes (cookies), hauteur totale, délai ; ou via un sous-agent navigateur. Point d'arrêt : demander à l'utilisateur avant de lancer. | Apache-2.0 (script `snapshot.ts` © Google) | **Entièrement** : sert à archiver une page, à garder une version « avant » ou à repartir d'un site existant. Le script demande Puppeteer (absent de l'image du bureau). | `browser_open` donne une capture image ; `page_read` le texte ; pas de capture HTML autonome. | **IDÉE** : outil « garder une copie de la page » sur le bureau (Chromium y est déjà, `docker/desktop/Dockerfile` l.12 ; le mode `--dump-dom` de Chromium suffit pour une version simple). | M |
| 8 | `generate-design` (design) | Génère/modifie des écrans Stitch ; pipeline d'amélioration de la demande, gabarit de demande (but, plateforme, structure), règle « ne jamais mettre couleurs/polices dans la demande si une charte existe » ; tables « termes de design » et « mots-clés ». | Apache-2.0 | Les 2 fichiers de référence (`design-mappings.md`, `prompt-keywords.md`) et la règle de séparation charte / demande. La génération elle-même = Stitch. | `frontend-design`, `modeles-de-pages`. | **IDÉE** (reprendre les tables dans n°3) | S |
| 9 | `manage-design-system` (design) | Crée/applique une charte dans Stitch ; **point d'arrêt obligatoire** : montrer nom, couleurs clés, polices, arrondis et attendre l'accord avant l'envoi. | Apache-2.0 | Le point d'arrêt « résumer la charte et demander l'accord avant de l'enregistrer pour toute l'équipe ». | `design-de-marque` : « profile_update si l'utilisateur veut que toute l'équipe le sache ». | **IDÉE** (une ligne dans n°1) | S |
| 10 | `code-to-design` (design) | Enchaîne n°7 + n°6 + envoi à Stitch pour retravailler un site existant. | Apache-2.0 | L'enchaînement « capturer la page + extraire la charte » reste utile pour **refaire** un site existant. | Aucun. | **IDÉE** (une section de n°5) | S |
| 11 | `upload-to-stitch` (design) | Script Python qui envoie un fichier à l'API Stitch avec la clé lue dans les fichiers de config de l'agent. | Apache-2.0 | Rien. **Mauvaise pratique** : la compétence dit d'aller lire la clé dans `~/.claude.json` etc. | Coffre Sklubot (`secret_use`), jamais de clé dans un fichier. | **NON** (service + lecture de clés dans des fichiers de config) | — |
| 12 | `react-components` (build) | Transforme un écran en composants Vite + React modulaires : un fichier par motif, logique dans des hooks, textes dans `mockData.ts`, interface `Readonly` par composant, `<Link>` à la place des `href="#"`, logo cliquable vers l'accueil, classes `dark:` partout ; **validateur AST** (`validate.js`, swc) qui refuse un composant sans interface ou avec couleurs en dur ; test. | Apache-2.0 | Les **règles d'architecture** et le validateur (indépendants de Stitch) pour un bot qui livre une petite appli React. | Sklubot livre surtout des pages HTML autonomes (`page_publish`) ; pas de compétence « appli React ». | **IDÉE** : seulement si Sklubot veut livrer des projets React ; sinon garder 5 règles (navigation réelle, logo vers l'accueil, pas de couleur en dur, mode sombre, données séparées) dans « Pages soignées ». | S |
| 13 | `react-native` (build) | Même chose pour React Native : table HTML → composants natifs (`View`, `Text`, `Pressable`, `FlatList`, `SafeAreaView`), `StyleSheet`, thème en constantes ; validateur + test. | Apache-2.0 | La table de correspondance et les règles, sans Stitch. | Aucun (l'appli mobile Sklubot est en Expo, mais les bots ne livrent pas d'appli mobile). | **NON** pour la bibliothèque (public non visé) ; utile aux développeurs de Sklubot eux-mêmes. | — |
| 14 | `react-vite-dashboard` (build) | Tableau de bord React + TanStack Query, jetons depuis DESIGN.md, liste de contrôle WCAG 2.2 AA, tests à 375 et 1280 px ; partie Web3 (ethers/viem). | Apache-2.0 | La liste de contrôle (contraste, clavier, 375/1280 px, pas de secret dans le dépôt). Le Web3 : non. | « Modèles de pages » a un tableau de bord HTML ; « Pages soignées » demande la vérification téléphone + ordinateur. | **NON** (doublon partiel ; Web3 hors sujet). La liste de contrôle est déjà couverte. | — |
| 15 | `shadcn-ui` (build) | Guide shadcn/ui : découverte de composants (via MCP shadcn), installation `npx shadcn add`, registres, personnalisation, migration Tailwind v4 ; exemples (connexion, tableau de données, formulaire) ; test Tailwind v4. | Apache-2.0 | Tout le guide (shadcn est indépendant de Stitch). | Aucun. | **NON** pour les bots (demande un projet React complet + npm) ; utile pour le web de Sklubot (`web/src`). | — |
| 16 | `remotion` (build) | Vidéo de présentation d'une appli à partir de ses écrans : diapositive par écran, transitions, zooms, textes ; liste de contrôle de composition ; exemple `WalkthroughComposition.tsx`. | Apache-2.0 | **Entièrement** avec des captures `browser_open` des pages publiées au lieu des écrans Stitch. | Ateliers vidéo `videoworkflows.ts` l.14 (`remotion`, MIT tiers), l.15 (`shotcraft` : captures produit animées), Studio. | **ADAPTER** comme 8e atelier « visite guidée d'un site ou d'une page publiée » (la liste de contrôle et le gabarit de diapositive sont courts) ; vérifier le doublon avec `shotcraft`. | S |

---

## 3. Mécanismes, scripts et fiabilité

| # | Fonction (stitch-skills) | Statut Sklubot | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| M1 | Points d'arrêt écrits « demander l'accord avant d'envoyer / de lancer » dans chaque compétence qui agit. | FAIT | Cartes d'accord pour les actions externes (`server/src/agent/irreversible.ts`, `ask_user`) ; compétence « Méthode de travail » | — | — |
| M2 | « Portes » (GATE) : une phase n'est finie que si une condition vérifiable est remplie (fichiers téléchargés ET regardés). | PARTIEL | « Méthode de travail » : vérifier avant de dire « fini » | Pas de condition vérifiable par étape dans les compétences design de Sklubot. | S |
| M3 | « Regarder chaque capture » obligatoire avant de coder (audit visuel). | PARTIEL | « Pages soignées » demande de vérifier sur téléphone et ordinateur | Pas de capture automatique de la page publiée renvoyée au bot. | M |
| M4 | Demander avant d'écraser des fichiers existants (« reprendre ou rafraîchir ? »). | FAIT | `page_publish` garde 20 versions (`docs/COMPETENCES.md` § 3) | — | — |
| M5 | Fichier de métadonnées avec « dernière synchro » (`metadata.json`). | MANQUANT | — | Une page publiée ne garde pas d'où vient sa charte ni quand elle a été alignée. | S |
| M6 | Relais écrit `next-prompt.md` pour reprendre une boucle. | PARTIEL | Reprise d'un tour interrompu (`agent/failures.ts`), objectifs (`agent/goals.ts`) | Pas de relais propre à un chantier de site. | S |
| M7 | Validateur AST de composants (swc) + test. | NON REPRIS | — | Hors du périmètre des bots (pas de projets React). | — |
| M8 | Téléchargement « fiable » par `curl -L -f --connect-timeout 10`. | FAIT | `web_fetch` / `guardedFetch` (`server/src/net.ts` l.118) avec refus des adresses privées | Le script Stitch, lui, n'a **aucune** protection réseau : ne pas le reprendre tel quel. | — |
| M9 | Capture HTML autonome (Puppeteer : CSS en ligne, images base64, concurrence limitée, délai global 60 s, retrait des éléments fixes). | MANQUANT | — | Voir compétence n°7. | M |
| M10 | Demander une capture haute définition (`=w{largeur}`). | NON REPRIS | — | Propre au CDN Google. | — |
| M11 | Lecture de la clé API dans les fichiers de config des agents. | NON REPRIS | Coffre Sklubot | Contraire aux règles Sklubot. | — |
| M12 | Séparer charte (niveau projet) et demande (niveau page) pour éviter les conflits. | MANQUANT | — | Les compétences design de Sklubot ne disent pas « si une charte existe, ne redonne pas couleurs et polices dans la demande d'image / de page ». | S |
| M13 | Liste de contrôle accessibilité (WCAG 2.2 AA, focus visible, ordre clavier, `aria-busy`, `aria-describedby`). | FAIT | `metier-du-design` (accessibilité, états) | — | — |
| M14 | Traduction des formes en mots (« pill-shaped ») pour décrire une charte à une IA d'images. | MANQUANT | — | Aide `image_generate` à rester dans la charte. | S |
| M15 | Validation CI des compétences (`.github/workflows/validate-skills.yml`). | DIFFÉRENT | `server/test/skills-library.test.ts` vérifie le catalogue | Équivalent. | — |
| M16 | Noms `stitch::…` non compatibles avec certains outils (le README le dit). | DIFFÉRENT | Sklubot renomme à l'import | Rien de perdu. | — |
| M17 | Retirer bandeaux cookies et éléments fixes avant capture. | PARTIEL | `browser_open` capture la page telle quelle | Option utile pour les captures de rapport. | S |
| M18 | Le README insiste : une IA ne peut pas envoyer un gros fichier en base64 dans un appel d'outil (limite de sortie) → passer par un script. | FAIT | Sklubot envoie les fichiers par `file_send` / `file_save` depuis le bureau, pas en base64 dans le modèle | — | — |

---

## 4. Écarts de comportement (court)

1. **Charte partagée** : chez Stitch, la charte vit dans un fichier relu à chaque génération. Chez Sklubot, elle vit dans la mémoire d'un bot (`design-de-marque` : `memory_save`) ou dans le profil partagé : un deuxième bot ne la retrouve que s'il pense à chercher, et rien n'indique la version. **Correctif** : fichier d'équipe `charte.md` (format DESIGN.md adapté), lu par la compétence « Design de marque » en premier (S/M).
2. **Site multi-pages** : demander « un site de 4 pages » à un bot Sklubot produit 4 `page_publish` indépendants sans plan ni navigation commune. La boucle Stitch tient un plan coché et un relais. **Correctif** : compétence « Site en plusieurs passes » + une page « plan du site » (M).
3. **Demande floue** : Stitch améliore toujours la demande avant de générer. Sklubot construit directement ; un non-développeur obtient une page générique. **Correctif** : « Préciser une demande de page » avec une seule question groupée si des éléments manquent (S).

---

## 5. À faire (classé)

1. Compétence **« Fiche de charte »** (adaptée de `design-md` + `extract-design-md` + point d'arrêt de `manage-design-system`) écrivant `charte.md` dans les fichiers d'équipe — **M**.
2. Compétence **« Site en plusieurs passes »** (adaptée de `stitch-loop` + `site-md` + `code-to-design`) avec `page_publish` — **M**.
3. Compétence **« Préciser une demande de page »** (adaptée de `enhance-prompt` + tables de `generate-design`) — **S**.
4. Ajouter à `metier-du-design` les règles de `taste-design` absentes (3 curseurs, `100dvh`, états vides/erreurs/chargement, interdits de mise en page) — **S**.
5. Atelier vidéo « visite guidée d'un site » adapté de `remotion` (vérifier le recouvrement avec `shotcraft`) — **S**.
6. Outil ou script de bureau « copie HTML autonome d'une page » (Chromium déjà présent) — **M**.
7. Règle « si une charte existe, ne pas redonner couleurs/polices dans la demande d'image » dans `design-de-marque` — **S**.
8. Renvoyer au bot une capture de la page qu'il vient de publier (vérification visuelle systématique) — **M**.

Attribution pour chaque adaptation : `LICENSE.txt` = Apache-2.0 racine du dépôt (inchangé) ; `NOTICE` : « Adapté de github.com/google-labs-code/stitch-skills (commit 62fdcd6), © Google LLC, Apache License 2.0 ; modifié pour Sklubot : retrait des appels au service Stitch, traduction, outils Sklubot » ; aucun nom « Stitch » ni « Google » dans le titre de la compétence.

## 6. Non vérifié

- Les fichiers de référence longs (`design-mappings.md`, `prompt-keywords.md`, `KEYWORDS.md`, `extract-design-md/references/*.md`, exemples DESIGN.md) ont été survolés, pas lus ligne à ligne.
- Le recouvrement exact entre `remotion` (ici) et les ateliers `remotion` / `shotcraft` de Sklubot n'a pas été comparé texte à texte.
- L'origine réelle du style de `taste-design` n'est pas documentée dans le dépôt.
- Aucun test Sklubot lancé (rien de spécifique à tester).
