# Audit : meta/astryx face à Sklubot

Type : **système de design** (React 19 + StyleX, 150+ composants, 58 modèles de pages, 172 exemples de blocs, 7 thèmes)
livré avec une **CLI pensée pour les agents** (`@astryxdesign/cli`, serveur MCP, manifeste JSON) et **1 skill**
(`plugins/astryx/skills/astryx`). Statut : bêta. Clone superficiel (697 Mo) lu le 2026-11-22, jamais exécuté, supprimé
après écriture.

Ce dépôt ne pilote pas d'ordinateur et ne fait pas de relecture de code : il touche Sklubot à deux endroits,
**les pages que les bots construisent** (`page_publish`, compétences « Pages soignées », « Modèles de pages »…) et
**l'interface web de Sklubot elle-même** (`web/`, React 19 sans bibliothèque de composants : dépendances = React,
zustand, marked, dompurify, noVNC).

## Comptes

| FAIT | PARTIEL | MANQUANT | DIFFÉRENT | NON REPRIS |
|---|---|---|---|---|
| 4 | 8 | 11 | 6 | 9 |

(38 lignes + 1 skill.)

## Licence

`LICENSE` : **MIT** (© 2026 Meta Platforms, Inc.). Tout est réutilisable (code, modèles, thèmes, textes de la CLI et
du skill), y compris commercialement, en gardant la notice MIT. Pas de télémétrie trouvée dans le README de la CLI ;
la commande `blog` lit un flux publié (sortie réseau) et `gap-report` envoie un signalement au paquet propriétaire
(sortie réseau : à ne lancer qu'avec accord).

## Tableau complet

### Composants, thèmes, modèles

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Composants | 150+ composants accessibles typés (dialogues, tableaux, formulaires, calendrier, palette de commandes, chat…) | DIFFÉRENT | Pages des bots : HTML/CSS libre guidé par les compétences `frontend-design`, `pages-soignees`, `styles-de-base` (catalog.json) ; interface Sklubot : composants maison | Les bots réinventent boutons/tableaux à chaque page ; qualité variable | — |
| Composants | Composants de **chat** (bulles, liste, appels d'outils, citation, dictée, composeur) | DIFFÉRENT | Chat Sklubot fait maison (`web/src/components`) | Rien de perdu ; source d'idées d'accessibilité | — |
| Thèmes | 7 thèmes (neutral, butter, chocolate, matcha, stone, gothic, y2k) ; thème = surcharges de variables CSS ; mode sombre | PARTIEL | `theme-factory`, `design-de-marque`, `styles-de-base` (2 styles) | Thèmes prêts et cohérents avec des composants | S |
| Thèmes | Éditeur de thème « vérifié » (expérimental) | MANQUANT | — | Vérifier contraste et cohérence d'un thème de marque | M |
| Modèles | **58 modèles de pages** (tableaux de bord ×7, formulaires/assistants ×6, connexion ×4, tableaux ×9, paiement, kanban, paramètres, galerie, documentation…) | PARTIEL | `modeles-de-pages` : 13 modèles adaptés d'OpenDesign (docs/COMPETENCES.md) | Tableaux de bord, tableaux filtrables, assistants multi-étapes, kanban | M |
| Modèles | 172 exemples de blocs (un par composant) | MANQUANT | — | — | M |
| Modèles | **`astryx build "<but de la page>"`** : choisit le modèle de départ et liste ce qui manque | MANQUANT | Le bot choisit seul dans la compétence | Démarrer toujours d'un modèle éprouvé | S |
| Règle | « Avant de livrer, relire chaque fichier ; remplacer div/span bruts, CSS importé, couleurs/px en dur par composant ou jeton, puis construire » (SKILL.md) | PARTIEL | Compétence `pages-soignees` ; `design_reference_layout` mesure une référence (tools.ts:154) | Contrôle automatique « pas de couleur en dur » avant `page_publish` | S |
| Export | **Une page Astryx en un seul fichier HTML autonome** (expérimental) | MANQUANT | Pages publiées : HTML + fichiers, CSP sandbox qui permet scripts inline et CDN (`server/src/pagefiles.ts:37-55`) | Compatible en principe : un bot pourrait construire en React/Astryx dans son ordinateur puis publier le HTML unique | M |
| Texte riche | `@astryxdesign/richtext` (éditeur Lexical) | NON REPRIS | — | Pas besoin dans les pages | — |
| Graphiques | `@astryxdesign/vega`, `charts` (non publiés) | NON REPRIS | — | Non publiés sur npm | — |
| Natif | `@astryxdesign/native` (canary, iOS/Android/macOS/Windows) | NON REPRIS | App mobile Expo (`mobile/`) | Expérimental, jamais stable | — |
| Shadcn | Registre shadcn interne + `upgrade` qui rafraîchit les composants copiés | NON REPRIS | — | — | — |

### CLI pour agents

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| CLI | `search` classé (composants, hooks, docs, modèles, thèmes ; fautes de frappe tolérées ; commande suivante suggérée) | PARTIEL | `skill_read`, `guide_read` (PARALLEL_SAFE, loop.ts:1537) | Recherche classée dans le contenu des compétences | S |
| CLI | `component <Nom>` / `hook` / `docs <sujet>` avec niveaux de détail (`brief/compact/full`) et texte « dense » économe en jetons | PARTIEL | Compétences lues en entier | **Lecture progressive** d'une compétence longue (index, puis section) | S |
| CLI | Docs auto-décrites : `manifest --json` (toutes les commandes, options, types de réponse) | DIFFÉRENT | Schémas d'outils natifs | — | — |
| CLI | Enveloppe JSON typée, codes d'erreur + suggestions | DIFFÉRENT | Résultats d'outils texte | — | — |
| CLI | `mcp` : toutes les commandes en outils MCP | FAIT (équivalent) | `local_tool_server_add` peut l'ajouter (tools.ts:1300) | — | — |
| CLI | `init` : écrit le guide Astryx dans `AGENTS.md`/`CLAUDE.md` (bloc géré avec empreinte sha256) | DIFFÉRENT | Compétences ajoutées par la bibliothèque | Idée : bloc géré avec empreinte pour savoir si l'utilisateur l'a modifié | — |
| CLI | Installation globale + version du projet prioritaire | NON REPRIS | — | — | — |
| CLI | `template <nom> <chemin>` : générer un modèle | MANQUANT | — | — | S |
| CLI | `theme add/switch/build/author` | MANQUANT | — | — | S |
| CLI | `swizzle` (copier la source d'un composant pour la modifier) | NON REPRIS | — | Développeur | — |
| CLI | `upgrade` + codemods, hooks post-codemod | NON REPRIS | — | Développeur | — |
| CLI | **`doctor`** : contrôles de santé du projet et de l'environnement | PARTIEL | `linuxReady`, `ready()` (linux.ts:788) | Un « doctor » de l'ordinateur du bot (voir AUDIT-AGENT-BROWSER) | S |
| CLI | **`gap-report`** : l'agent signale un composant manquant au paquet propriétaire | MANQUANT | — | Idée forte : un bot signale « il me manque un outil pour X » à l'admin (au lieu de bricoler) | S |
| CLI | `discover` intégrations, `integration` (créer/vérifier un paquet d'intégration) | NON REPRIS | — | — | — |
| CLI | Langues : anglais, chinois, « dense » | PARTIEL | Compétences FR + EN (`SKILL.fr.md`) | — | — |
| CLI | `blog` (flux publié) | NON REPRIS | — | — | — |

### Qualité, tests, accessibilité

| Domaine | Fonction | Statut | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| Éval | **Vibe tests** : mêmes demandes données à des agents avec différents systèmes ; composants attendus cachés à l'agent ; catégories et complexité ; mesures comparables (`internal/vibe-tests`) | MANQUANT | — | Mesurer si une compétence de Sklubot (pages, design) améliore vraiment les pages produites | M |
| Éval | Tests de « pureté du prompt », de découverte de la CLI, de nommage | MANQUANT | — | — | M |
| A11y | Spécification d'accessibilité par composant (`internal/a11y-spec`), manifestes a11y | PARTIEL | Règles a11y dans les compétences de design | Vérification automatique des pages publiées (voir Lighthouse, AUDIT-CHROME-DEVTOOLS-MCP) | M |
| Tests | Harnais d'interaction Playwright, tests de performance | FAIT (esprit) | Tests Sklubot réels sur conteneurs (elements.test.ts…) | — | — |
| Lint | Plugin ESLint du système | MANQUANT | — | Contrôle « jetons plutôt que couleurs en dur » pour les pages des bots | S |
| IME | Garde IME documentée (`IME_GUARD_DESIGN.md`) : ne pas envoyer pendant une composition de caractères (japonais, chinois…) | FAIT | `isComposing` / `keyCode === 229` dans `web/src/components/Composer.tsx:400,414`, `ThreadPanel.tsx:68`, `ComposerMentions.tsx:77` ; test : non trouvé | — | — |
| Docs | Docsite, Storybook, bac à sable en ligne | FAIT (esprit) | Galerie de compétences, « Lire le texte » (docs/COMPETENCES.md) | — | — |
| Contrat | « Contrat de synchronisation » : un changement d'architecture exige la mise à jour de la doc (en tête du README) | DIFFÉRENT | Docs françaises (docs/COUVERTURE.md, FEUILLE-DE-ROUTE.md) | — | — |

### Skill (1)

| Skill | Ce qu'il fait | Licence | Équivalent Sklubot | Verdict |
|---|---|---|---|---|
| `astryx` | Utiliser la CLI Astryx : toujours partir d'un modèle (`build` → `template` → `component`), relire chaque fichier pour remplacer div/couleurs en dur par composants/jetons, construire puis livrer le build | MIT | `pages-soignees`, `modeles-de-pages`, `frontend-design` | **IDÉE** : reprendre la règle « partir d'un modèle, relire, remplacer les valeurs en dur, construire avant de livrer » dans `pages-soignees` ; **ADAPTER** seulement si on installe la CLI dans l'ordinateur des bots |

## Peut-on l'installer dans l'image des bots ?

Possible, sans risque pour l'hôte : `npm i -g @astryxdesign/cli` (Node 22 présent ; le dépôt demande Node 22+). Mais
les pages Astryx sont des **applications React** : il faut un projet, `npm install` (React 19, StyleX), un build, puis
l'export HTML unique (expérimental) pour publier dans Sklubot. Lourd pour une page de présentation ; utile pour des
**outils internes** (tableau de bord, formulaire) qu'un bot livre à l'utilisateur. Recommandation : ne pas l'ajouter à
l'image ; le laisser installable à la demande et écrire une compétence « appli React avec Astryx » si la demande existe.
`gap-report` et `blog` sortent sur le réseau : à ne pas lancer sans accord.

Ce que renvoie l'outil vs Sklubot : Astryx renvoie des docs de composants, des fichiers de modèle et un build ; Sklubot
renvoie le texte d'une compétence et laisse le bot écrire tout le HTML.

## Écarts de comportement (court)

1. **« Fais-moi un tableau de bord des ventes. »** Astryx : `build` choisit `dashboard-scorecard`, génère le modèle,
   le bot remplace le contenu, relit, construit. Sklubot : le bot écrit une page HTML à partir de zéro guidé par
   `pages-soignees` ; la mise en page varie d'une fois à l'autre. **Correction (M)** : ajouter à `modeles-de-pages` des
   modèles HTML statiques de tableau de bord, tableau filtrable, assistant multi-étapes (inspirés d'Astryx, MIT).
2. **Vérifier une page avant de la livrer.** Astryx : règle explicite + lint. Sklubot : rien d'automatique avant
   `page_publish`. **Correction (S)** : contrôle léger avant publication (couleurs en dur hors variables, images sans
   `alt`, boutons sans texte) renvoyé au bot comme remarques.
3. **Il manque un outil au bot.** Astryx : `gap-report`. Sklubot : le bot bricole ou abandonne. **Correction (S)** :
   outil `capability_gap` qui note la demande pour l'admin (sans sortie réseau).

## À faire (classé)

1. Contrôle de page avant `page_publish` (couleurs en dur, `alt`, boutons sans nom, contraste) (S).
2. Règle « partir d'un modèle, relire, remplacer les valeurs en dur » dans `pages-soignees` (S).
3. Outil « il me manque une capacité » pour les bots, visible par l'admin (S).
4. Modèles statiques supplémentaires (tableau de bord, tableau filtrable, assistant, kanban) dans `modeles-de-pages` (M).
5. Lecture progressive des longues compétences (index puis section, texte dense) (S).
6. Banc d'évaluation des compétences de design (mêmes demandes, avec/sans compétence) (M).
7. Compétence « appli React avec Astryx + export HTML » si les utilisateurs demandent des outils internes (M).

## Non vérifié

- Je n'ai pas exécuté la CLI ; l'export HTML unique est « expérimental » et non testé avec la CSP des pages Sklubot.
- Le nombre exact de composants publiés (152 dossiers dans `packages/core/src`) inclut des fichiers utilitaires.
