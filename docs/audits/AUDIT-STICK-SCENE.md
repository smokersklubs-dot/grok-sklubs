# Audit : nilbuild/stick-scene face à Sklubot

Type : **PACK DE SKILLS (1 skill)** + une petite bibliothèque JavaScript (`runtime/stick.js`, 1 313 lignes, un élément
`<stick-scene>` sur `<canvas>`, sans dépendance) + 2 scripts de contrôle visuel (`scripts/frames.mjs`,
`scripts/motion.mjs`) + ~35 scènes d'exemple. Le skill fait dessiner par l'agent de petites scènes animées de
bonhommes-bâtons qui montrent ce que fait un produit (pour une page d'accueil). Clone superficiel lu le 2026-11-22,
jamais exécuté, supprimé après écriture.

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 5 | 6 | 7 | 2 | 1 |

(22 lignes de mécanismes, dont 1 « IDÉE », + 1 skill.) Verdict du skill : **ADAPTER**.

## Licence

`LICENSE` : **MIT** (© 2026 Kamran Ahmed). Le skill, la bibliothèque `stick.js`, les scripts et les exemples peuvent
être copiés et modifiés (y compris commercialement) en gardant la notice. Le style « ink-and-butter » est celui de
l'auteur, livré sous MIT par lui : réutilisable. Le runtime charge par défaut la police **Balsamiq Sans depuis Google
Fonts** (attribut `no-font` pour l'éviter) ; la police elle-même est sous licence OFL. Le contrôle visuel demande
`playwright@1.56.1` (Apache-2.0), installé à part.

## Équivalents Sklubot vérifiés

`server/skills-library/catalog.json` : `studio-animation` (Studio vidéo, techniques par plan dont `canvas-animation`,
`doodle-timelapse`, `expressive-character`), `canvas-design` (affiches PNG/PDF), `pages-soignees`, `frontend-design`,
`modeles-de-pages`, `design-de-marque`. Rien sur des **illustrations animées intégrées à une page**. Les pages des bots
acceptent scripts et polices Google (`server/src/pagefiles.ts:37-55` : `script-src 'self' 'unsafe-inline'`,
`font-src` Google Fonts) : `stick.js` y fonctionnerait.

## Tableau des mécanismes

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Méthode | Comprendre le produit en 2 lignes (ce que fait l'utilisateur, ce qu'il obtient) | PARTIEL | `pages-soignees`, `methode-de-travail` | Pas de règle « une idée par illustration » | S |
| Méthode | **Proposer 2-3 métaphores, laisser choisir** (sauf « vas-y ») | PARTIEL | `ask_user` existe (liste des outils) ; aucune compétence ne demande de proposer des pistes avant une illustration | Moins d'allers-retours sur un visuel raté | S |
| Méthode | Catalogue de métaphores éprouvées (levier, tampon, tapis roulant, tableau d'épingles…) et liste des erreurs déjà faites (`references/craft.md`) | MANQUANT | — | — | S |
| Méthode | Règles de style : encre #141414, une seule couleur d'accent, beaucoup de vide, peu de mots ; le personnage n'est jamais caché ; « montrer le résultat, pas le travail » | PARTIEL | `metier-du-design`, `styles-de-base` | Pas pour l'illustration animée | S |
| Méthode | « Un agent ne réagit pas instantanément » : un temps de réflexion visible avant l'action | IDÉE | — | Utile aussi pour les animations de l'interface Sklubot (bots qui « réfléchissent ») | — |
| Méthode | Pas de logos d'autres entreprises ; noms en texte simple | FAIT (esprit) | Règle OpenDesign appliquée : pas de systèmes imitant des marques (docs/COMPETENCES.md) | — | — |
| Runtime | Un élément `<stick-scene>` sans dépendance, un `<canvas>` | MANQUANT | — | — | S (copie) |
| Runtime | Déclencheurs : `view` (à mi-écran), `click`, `hover`, `loop` | MANQUANT | — | — | — |
| Runtime | **Mouvement réduit** respecté (une image fixe, jamais d'animation) — `stick.js:939` | PARTIEL | Règles d'accessibilité dans les compétences de design | Vérification que les animations des pages des bots respectent `prefers-reduced-motion` | S |
| Runtime | Ne dessine pas hors écran (`IntersectionObserver`, `stick.js:1120`) | MANQUANT | — | Économie de batterie sur mobile | — |
| Runtime | `aria-label` automatique depuis le `label` de la scène (`stick.js:1224`) | PARTIEL | Règles a11y dans les compétences | — | — |
| Runtime | Thème de couleurs global (`STICK.theme`) | DIFFÉRENT | `design-de-marque` applique la marque de l'utilisateur | — | — |
| Runtime | Option `no-font` (ne pas appeler Google) | FAIT (esprit) | CSP des pages limite les polices à Google Fonts (pagefiles.ts:46) | — | — |
| Contrôle | **Planche-contact** : la scène figée à des instants choisis, rendue en une image PNG que l'agent regarde (`scripts/frames.mjs`, Playwright) | PARTIEL | `screen_view` / `video_frames` après ouverture de la page dans le navigateur du bot (docs/ORDINATEUR.md) | Pas d'outil « rends ma page à ces instants » ; le bot regarde un seul moment | M |
| Contrôle | **Vérificateur de mouvement à 60 i/s** : articulations qui sautent, bras dans le visage, accessoire sur la tête, coude à l'envers (`scripts/motion.mjs`) | MANQUANT | — | Les défauts entre deux images ne se voient pas sur une capture | M |
| Contrôle | Erreurs de la page signalées pendant le rendu | MANQUANT | — | Console JS des pages publiées (voir AUDIT-CHROME-DEVTOOLS-MCP) | M |
| Contrôle | « Regarde chaque planche avant de dire que c'est fini » | FAIT (esprit) | Règle « vérifier le rendu » dans `pages-soignees` / design | — | — |
| Itération | Demandes de correction en langage simple (« la bulle déborde », « plus lent », « joue au clic ») | FAIT | Conversation + `page_edit` + versions de page (pagefiles.ts « VERSIONS ») | — | — |
| Intégration | Copier `stick.js` et la scène dans le dossier statique ; ordre des scripts ; Astro `is:inline` | DIFFÉRENT | Pages Sklubot = HTML + fichiers relatifs (`page_source` lit les fichiers d'une page) | — | — |
| Vitrine | Site de démonstration (`site/`, `showcase/`), ~90 scènes publiées | NON REPRIS | — | — | — |
| Vidéo | GIF d'exemples | FAIT (équivalent) | Studio vidéo (`studio-animation`) pour les films ; `frame()` pour les démos | — | — |

## Le skill

| Skill | Ce qu'il fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `stick-scene` | Proposer 2-3 métaphores, écrire une scène à partir du modèle, la vérifier par planche-contact et contrôle de mouvement, l'intégrer à la page | MIT | Aucun pour l'illustration animée de page ; `studio-animation` pour les films | **ADAPTER** : compétence « Illustration animée de page » avec `stick.js` livré comme fichier de la compétence (texte JS, ~40 ko), la règle « proposer 2-3 idées » et une vérification par captures dans le navigateur du bot |

## Peut-on l'installer ?

- **Le runtime** (`stick.js`) : oui, c'est un fichier statique à joindre à une page ; aucune installation.
- **Le contrôle visuel** (`frames.mjs`, `motion.mjs`) : dans l'ordinateur du bot, faisable sans risque pour l'hôte :
  `npm i playwright-core@1.56.1` dans un dossier de travail et pointer Playwright sur le Chromium déjà installé
  (`/usr/bin/chromium`) pour éviter le téléchargement de navigateurs. Non testé.
- L'import de compétences GitHub de Sklubot ne prend **que le texte des SKILL.md** (docs/COMPETENCES.md §2 : « autres
  fichiers non importés ») : importé tel quel, le skill serait **inutilisable** (il renvoie à `runtime/stick.js`,
  `templates/`, `scripts/`). Il faut l'adapter à la main (ou que l'import sache joindre des fichiers non exécutables
  vérifiés).

## Écarts de comportement (court)

1. **« Ajoute une illustration qui montre ce que fait mon produit. »** stick-scene : 2-3 pistes, choix, scène, planche
   de 8 images vérifiée, contrôle du mouvement, intégration. Sklubot : le bot génère une image fixe (`image_generate`)
   ou écrit une animation CSS/canvas à la main, vérifiée au mieux par une capture. **Correction (M)** : compétence
   adaptée + outil (ou script) « planche-contact » qui capture une page à plusieurs instants dans le navigateur du bot.
2. **Import de compétences avec fichiers.** stick-scene a besoin de ses fichiers. Sklubot n'importe que le texte.
   **Correction (M)** : permettre de joindre à une compétence des fichiers **non exécutés côté serveur** (JS/CSS/
   modèles), copiés dans l'ordinateur du bot à l'activation, avec la même vérification de licence.

## À faire (classé)

1. Compétence « Illustration animée de page » adaptée de stick-scene, avec `stick.js` (MIT, notice) (M).
2. Script/outil « planche-contact » : rendre une page à N instants dans le navigateur du bot et renvoyer une image (M).
3. Règle « proposer 2-3 idées avant un visuel » dans les compétences de design (S).
4. Vérifier `prefers-reduced-motion` dans les pages animées publiées (contrôle avant `page_publish`) (S).
5. Import de compétences avec fichiers d'accompagnement non exécutables (M).

## Non vérifié

- Je n'ai pas exécuté `stick.js`, `frames.mjs` ni `motion.mjs`.
- Compatibilité exacte de `stick.js` avec la CSP sandbox des pages Sklubot (déduite de `pageCsp()`, non testée).
- Playwright 1.56.1 avec le Chromium de Debian bookworm de l'image : non testé.
