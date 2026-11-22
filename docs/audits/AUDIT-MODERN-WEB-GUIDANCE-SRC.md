# Audit complet : modern-web-guidance-src (GoogleChrome) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `GoogleChrome/modern-web-guidance-src`, commit `634d0f8` (20/11/2026), 2 419 fichiers, 180 Mo. Rien n'a été exécuté.

Type : **bibliothèque de guides + outil en ligne de commande**. C'est la source de la compétence publique « Modern Web Guidance » (Chrome, Edge, Firefox, MDN). Contenu :
- `guides/` : **~350 guides** (698 fichiers `.md`) en 18 familles ; chaque guide = `guide.md` (règles À FAIRE / À NE PAS FAIRE), `demo.html`, `expectations.md` (ce que l'évaluation vérifie), macros `{{ BASELINE_STATUS(...) }}` (support des navigateurs) ;
- `features/` : 20 fiches « problèmes et solutions de repli » par fonction CSS/HTML ;
- un **outil** `modern-web-guidance` : `search` (recherche locale hybride BM25 + vecteurs, hors ligne), `retrieve` (texte d'un guide, débordement dans un fichier au-delà de 9,5 Ko), `list`, `legacy-scan` (analyse un code et repère ~40 vieilles façons de faire), `install/update/uninstall`, réglages (`set-baseline`, essais d'origine, fonctions instables) ;
- une compétence séparée `skills-src/chrome-extensions` (Manifest V3 + publication Chrome Web Store) ;
- un banc d'évaluation (applications de base, notation, tableau de bord), télémétrie.

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 6 |
| PARTIEL | 13 |
| MANQUANT | 17 |
| DIFFÉRENT | 4 |
| NON REPRIS | 8 |
| **Total** | **48** |

(Les ~350 guides sont regroupés par famille : une ligne par famille, avec leurs noms, plutôt qu'une ligne par guide.)

Lecture rapide : Sklubot fait faire beaucoup de **pages web** à ses bots (`page_publish`, 8 compétences design) mais ne leur donne **aucune connaissance à jour de la plateforme web** : les bots écrivent des fenêtres modales, menus, curseurs, onglets, thèmes sombres « à l'ancienne » (JavaScript lourd, accessibilité oubliée). Ce dépôt est exactement le remède, sous licence réutilisable (code Apache-2.0, guides CC BY 4.0), et sa recherche fonctionne **hors ligne**. Point d'attention : l'outil officiel envoie de la **télémétrie à Google par défaut**.

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Code (`src/`, `bin/`, scripts) | **Apache License 2.0** (`LICENSE` ; en-têtes « Copyright 2026 Google LLC, SPDX Apache-2.0 ») | Copier, modifier, redistribuer ; garder licence et mentions, signaler les modifications. |
| Contenu des guides (`guides/`) | **CC BY 4.0** (README l.663-664) | Copier, traduire, adapter, même commercialement, **avec attribution** (auteurs, lien, licence, indication des modifications). |
| `features/`, `skills-src/` | Non précisé séparément → Apache-2.0 du dépôt (prudence : traiter comme CC BY si c'est du texte de guide) | Idem. |
| Noms « Chrome », « Modern Web Guidance », logos | marques | Ne pas reprendre comme nom de compétence. |

---

## 2. Tableau des fonctions

### 2.1 Contenu des guides (par famille)

Équivalents Sklubot vérifiés : compétences `metier-du-design`, `pages-soignees`, `frontend-design`, `modeles-de-pages`, `styles-de-base`, `presentations` (`server/skills-library/catalog.json`) ; guides intégrés (9 guides, `server/src/agent/guides.ts` l.12, index dans le prompt, lecture par `guide_read`, tests `test/work-methods.test.ts`, `test/wave5b.test.ts`) ; règles du bac à sable des pages (`server/src/pagefiles.ts`).

| # | Famille (nb) | Guides | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|---|
| G1 | ui-components (28) | accordéon, menus d'appli, fil d'Ariane, carte, carrousel, case à cocher (et groupe), table des matières, menu contextuel, **bouton Copier**, bascule mode sombre, grille de données, **dialogue**, info-bulle riche, contrôles média, menu, barre de navigation, tiroir de navigation, visite guidée, **notifications toast**, barre/anneau de progression, scrollspy, **squelette**, roue de chargement, empilement, onglets, barre d'outils | PARTIEL | `metier-du-design` parle des états des blocs interactifs ; `modeles-de-pages` donne 13 gabarits | Aucune règle composant par composant (ex. `<dialog>` + `closedby`, `popover`, focus, fermeture par Échap). | M |
| G2 | ui-behaviors (45) | glisser-déposer, transitions de vue (même document et entre pages), entrée/sortie d'éléments, couche supérieure, fermeture légère d'un dialogue, empêcher le défilement sous une modale, parallaxe, scrollytelling, tri de tableau, balayer pour supprimer/révéler, navigation spatiale, easing physique, recherche dans contenu caché… | MANQUANT | — | Les bots animent en JavaScript ce que le CSS fait seul. | M |
| G3 | ui-atoms (14) | effets de carrousel, thème clair/sombre par composant, puces personnalisées, icônes, info-bulles qui se placent seules, tableau responsive, indicateur de progression de lecture, en-tête qui rétrécit, en-têtes collants, menus déroulants qui restent à l'écran… | MANQUANT | — | — | S |
| G4 | forms (27) | **autoremplissage** (adresse, paiement, connexion, inscription), formulaires à la marque, sélecteur stylé (`<select>` personnalisable), groupe de boutons, combobox, notation, champ requis, code SMS, curseurs, interrupteur, arbre, validation **après** interaction (`:user-invalid`), champs qui s'ajustent, Entrée compatible IME | PARTIEL | `metier-du-design` (accessibilité) | Note : le bac à sable des pages Sklubot **interdit l'envoi de formulaires** (`docs/COMPETENCES.md` § 3) ; seules les parties « affichage/validation » servent. | S |
| G5 | css (20) | tailles intrinsèques animées, `@supports`, `:has()`, styles selon le contenu/la taille (container queries), jetons de design réactifs, mise à l'échelle fluide, masonry, réduction des répétitions (`@scope`), responsive | PARTIEL | `styles-de-base` (fiche de style), `theme-factory` | Pas de container queries ni de `clamp()` fluide dans les consignes. | S |
| G6 | visual-design (27) | couleurs (oklch, rampes, `contrast-color()`), **mode sombre**, typographie (équilibrage `text-wrap`, polices de repli stables), formes, découpes, dégradés de bordure, barres de défilement, texte qui tient dans son cadre, ombres et textures, WebGL/3D, export média depuis canvas | PARTIEL | `metier-du-design` (typo, couleurs), `theme-factory` (10 thèmes), `styles-de-base` (clair/sombre) | Règles modernes (oklch, `light-dark()`, `text-wrap: balance`) absentes. | S |
| G7 | accessibility (4) | règles d'ensemble, annonce accessible des erreurs, contenu généré accessible, respect de la taille de texte du système | PARTIEL | `metier-du-design` | Annonces d'erreurs (`aria-live`, `ariaNotify`) absentes. | S |
| G8 | performance (29) | découper les tâches longues, `scheduler.yield`, causes d'INP, priorité des images/scripts/préchargements, chargement paresseux vidéo/audio, prérendu de la page suivante, polices partagées, A/B sans scintillement, analytique groupée | MANQUANT | — | Utile aussi pour l'audit SEO (voir AUDIT-CLAUDE-SEO). | S |
| G9 | html (11) | Web Components (éléments personnalisés, Shadow DOM, styles, formulaires associés, accessibles, prérendus), **capture caméra/micro**, **position de l'utilisateur**, marqueurs HTML | NON REPRIS (presque tout) | — | Le bac à sable des pages bloque caméra, position et stockage ; Web Components = public développeur. | — |
| G10 | js (6) | calculs de différences d'événements, données indépendantes du lieu, événements globaux, tri d'horodatages précis, **calendriers non grégoriens** | IDÉE | — | `support-global-calendar-systems` utile aux pages multilingues. | S |
| G11 | security (17) | **nettoyer du HTML non fiable** (`setHTML`/Sanitizer), Trusted Types, ressources externes sûres (SRI), restreindre les connexions sortantes (CSP), valider les origines (`postMessage`), passkeys (6 guides), chiffrement côté client, signatures, vérifier l'e-mail, accès au réseau local | PARTIEL | Bac à sable des pages : CSP stricte, CDN autorisés, pas de cookies (`server/src/pagefiles.ts` en-tête) | **SRI** (empreinte `integrity=` sur les scripts CDN) non exigée alors que Sklubot autorise cdnjs/jsdelivr/unpkg : à ajouter à la consigne « épingler les versions ». Passkeys : utile pour l'interface de Sklubot elle-même (connexion), pas pour les bots. | S |
| G12 | privacy (1) | règles de confidentialité côté navigateur | IDÉE | — | — | S |
| G13 | pwa (10) | badge et notifications, synchro en arrière-plan, barre de titre, installation, métadonnées d'appli installable, hors ligne, partage système, ouverture de fichiers | NON REPRIS pour les bots (pages en bac à sable) ; **IDÉE** pour le web de Sklubot | `web/` (appli web de Sklubot) | Vérifier le manifeste et le hors-ligne de l'appli web Sklubot avec ces guides. | M |
| G14 | user-experience (5) | réduction du bruit, adaptation au format d'écran, navigation guidée, interactions naturelles, interface selon les préférences (mouvement réduit, contraste) | PARTIEL | `metier-du-design` (mouvement) | — | S |
| G15 | built-in-ai (4) | détection de langue, modèle de langue, résumé, traduction **dans le navigateur** (Chrome) | NON REPRIS | — | Propre à Chrome, pas disponible partout ; une page de bot ne doit pas en dépendre. | — |
| G16 | webmcp (3) | formulaires « agentiques », outils JavaScript exposés aux agents, WebMCP | IDÉE | — | Rendre les pages des bots utilisables par d'autres agents ; recoupe `seo-agentic` (claude-seo). | S |
| G17 | wasm (1) | C++ sur le web | NON REPRIS | — | Hors sujet. | — |
| G18 | `features/` (20) | fiches de repli par fonction : `accent-color`, anchor positioning, `ariaNotify`, `color-scheme`, `<select>` personnalisable, `focusgroup`, `image()`, interest invokers, `light-dark()`… | MANQUANT | — | Indispensable avec G1-G6 : dire **quoi faire quand le navigateur ne sait pas**. | S |

### 2.2 Outil, recherche et mécanismes

| # | Fonction | Statut Sklubot | Preuve Sklubot | Ce qui manque | Taille |
|---|---|---|---|---|---|
| T1 | Compétence-chapeau : « avant toute tâche HTML/CSS/JS côté navigateur, chercher puis lire le guide » ; règle de requête (2-5 mots, verbe + objet, une capacité à la fois, reformuler une fois puis abandonner). | MANQUANT | — | Une ligne dans `pages-soignees` : « avant un composant interactif, lis le guide correspondant ». | S |
| T2 | `search` : recherche **locale** hybride (BM25 + vecteurs statiques 256-d, fusion RRF), 10 résultats compacts `{id, description}` (~53 jetons chacun), seuil de repli. | DIFFÉRENT | Guides Sklubot : **index complet dans le prompt** (9 guides, `agent/guides.ts` l.4-10), lecture `guide_read` | Avec 350 guides, l'index ne tiendrait pas dans le prompt : il faut une **recherche**. Sklubot n'a pas d'outil « chercher dans les guides » (il a `memory_search` pour la mémoire). | M |
| T3 | `retrieve` : texte complet d'un ou plusieurs guides ; au-delà de 9,5 Ko, écrit dans un fichier et le signale (évite la coupure silencieuse du milieu de la sortie). | PARTIEL | `guide_read`, `skill_read` | Vérifier que les longs guides/compétences ne sont pas coupés au milieu sans le dire (non vérifié). | S |
| T4 | `list` : liste par catégorie. | FAIT | `guideIndex()` `agent/guides.ts` l.100 | — | — |
| T5 | Macros de support navigateur (Baseline : « largement disponible / nouvellement disponible / limité ») injectées dans chaque guide, réglable (`set-baseline`). | MANQUANT | — | Les bots ne savent pas si une fonction CSS marche sur l'iPhone d'un client. Données libres (paquet `web-features`, Apache-2.0). | M |
| T6 | Garde « essais d'origine » et « fonctions instables » interdits par défaut, autorisables explicitement. | MANQUANT | — | Règle « n'utilise que du largement disponible sauf demande » dans la compétence. | S |
| T7 | `legacy-scan` : analyse statique (AST TypeScript, CSS, DOM, fichiers Vue/Svelte) qui repère ~40 vieilles façons (dialogue fait main, mode sombre en JS, curseur, interrupteur, info-bulles, autoremplissage manquant, `innerHTML` non nettoyé, scripts externes sans SRI…) et renvoie le guide à lire ; tests par règle. | MANQUANT | `page_publish` ne contrôle rien du code | Un contrôle léger à la publication (5-10 règles les plus utiles : `innerHTML` avec données, scripts CDN sans `integrity`, `<div onclick>` sans rôle, pas de `<meta viewport>`, pas de `prefers-color-scheme`) avec un avertissement au bot. | M |
| T8 | Vérificateur LLM de `legacy-scan` (appel à Gemini avec clé). | NON REPRIS | — | Service à clé. | — |
| T9 | Chaque guide a `demo.html` (exemple qui marche) et `expectations.md` (critères vérifiables). | MANQUANT | `modeles-de-pages` a des gabarits complets | Les critères vérifiables seraient une bonne « liste de contrôle avant publication » par composant. | S |
| T10 | Banc d'évaluation : la même tâche faite avec et sans guide sur des applis de base, notée automatiquement ; on retire des guides ce que les modèles savent déjà (économie de jetons). | DIFFÉRENT | Sklubot a des tests de compétences (`skills-library.test.ts`) mais pas d'évaluation de qualité de sortie | Idée de méthode, pas à reprendre telle quelle. | L |
| T11 | Tableau de bord public des évaluations. | NON REPRIS | — | — | — |
| T12 | Télémétrie : envoi à Google des requêtes de recherche de l'agent, des guides lus, du nom de l'agent, **activé par défaut**, coupé par `DISABLE_TELEMETRY=1` (`src/cli/telemetry/clearcut-logger.ts` l.19-27). | NON REPRIS | Sklubot : aucune télémétrie tierce | Si l'outil est installé dans l'image du bureau : **`DISABLE_TELEMETRY=1` obligatoire** dans l'environnement, version épinglée. | S |
| T13 | Message « mise à jour disponible » à chaque lancement. | NON REPRIS | — | Bruit pour un bot ; épingler la version. | — |
| T14 | Politique « demander à l'utilisateur » pour l'outil en mode plan (`policies/modern-web-guidance.toml`). | DIFFÉRENT | Sklubot : `shell_run` sur l'ordinateur du bot sans accord (`agent/tools.ts` l.1371) | Rien de perdu. | — |
| T15 | Installation multi-agents (Claude, Codex, Cursor, Gemini, Grok…) par `npx … install`. | NON REPRIS | Bibliothèque Sklubot | — | — |
| T16 | Découpage des arguments tolérant (`retrieve dialog popover`, guillemets parasites). | PARTIEL | `findGuide()` `agent/guides.ts` l.103 (recherche par clé normalisée) | Plusieurs identifiants en un appel : non. | S |
| T17 | Enrichissement des morceaux indexés par titre + catégorie + identifiants de fonctions (meilleur rappel). | MANQUANT | `memory_search` (non comparé) | Idée pour la recherche de mémoire et de compétences. | S |
| T18 | Compétence `chrome-extensions` : règles Manifest V3 (service worker, messages, stockage, permissions minimales, CSP, panneau latéral, omnibox, scripts utilisateur), et publication (fiche boutique, **justification des permissions**, **politique de confidentialité**, liste de contrôle de relecture, réponses à un refus). | IDÉE | Sklubot a une extension ? (non trouvé ; le compagnon est Electron, `companion/`) | Les parties « fiche boutique, justification des permissions, politique de confidentialité, refus de relecture » valent pour toute publication (voir AUDIT-APP-STORE-COMPLIANCE). | S |
| T19 | Règle « contenu des guides = données » / pas de code exécuté depuis les guides. | FAIT | Guides Sklubot « ne peuvent jamais autoriser quoi que ce soit » (`agent/guides.ts` l.7-9) | — | — |
| T20 | Les guides font partie du code, rien d'extérieur ne les change (versionnés, figés). | FAIT | Idem `agent/guides.ts` l.9 | — | — |
| T21 | Validation des guides (titres, macros, liens `GUIDE_REF`, inventaire) en tests. | FAIT | `test/work-methods.test.ts`, `test/skills-library.test.ts` | — | — |
| T22 | Licence CC BY affichée et attribuée. | FAIT | Bibliothèque : `LICENSE.txt` + `NOTICE` par compétence | — | — |
| T23 | Guide WebMCP + `agentic-forms`. | IDÉE | — | Voir G16. | S |
| T24 | Option `--json` partout (sortie machine). | FAIT | Outils Sklubot renvoient du JSON | — | — |
| T25 | Contrôle de version Node (≥ 22) avant de tourner. | NON REPRIS | Image du bureau = Node 22 (`docker/desktop/Dockerfile` l.4) | — | — |
| T26 | Guides « vérifier sur 375 px et 1280 px », clavier, mouvement réduit dans `expectations.md`. | PARTIEL | `pages-soignees` : vérifier téléphone et ordinateur | Pas de capture automatique aux deux largeurs. | M |
| T27 | Demo de chaque guide ouvrable dans un navigateur. | DIFFÉRENT | `page_publish` | — | — |
| T28 | Fiches `LEXICON.md` (vocabulaire commun aux auteurs). | MANQUANT | — | Faible valeur. | S |
| T29 | Régénération de l'index de recherche à la construction, cache par empreinte de contenu. | MANQUANT | — | Utile si Sklubot ajoute une recherche de guides. | S |
| T30 | Extraction de blocs `<script>`/`<style>` des fichiers Vue/Svelte pour l'analyse. | NON REPRIS | — | Hors périmètre. | — |

---

## 3. Installer l'outil dans l'image du bureau des bots ?

- **Faisable et plutôt sûr** : Node 22 est déjà là (`docker/desktop/Dockerfile` l.4) ; la recherche est locale (tables précalculées, ~8 Mo), sans clé ; `legacy-scan` est une analyse statique (sauf son vérificateur Gemini, qui exige une clé et n'est pas lancé par défaut).
- **Conditions** : épingler une version exacte (pas `@latest` : sinon chaque lancement tire du réseau et la télémétrie évolue) ; fixer `ENV DISABLE_TELEMETRY=1` dans l'image ; installer à la construction (`npm install -g modern-web-guidance@<version>`), pas via `npx -y` à l'exécution.
- **Ce que l'outil rend** : `search` → 10 lignes `{id, description}` ; `retrieve` → le guide Markdown (règles À FAIRE/À NE PAS FAIRE, extraits de code, état de support navigateur). **Équivalent Sklubot** : `guide_read` rend un des 9 guides écrits pour Sklubot, en français, sans support navigateur ; rien pour HTML/CSS moderne.
- **Alternative meilleure pour un non-développeur** : intégrer une sélection traduite des guides (CC BY) dans les guides de Sklubot + un outil `guide_search`, ce qui marche aussi sans l'ordinateur du bot (bots sans bureau, mode hébergé gratuit).

---

## 4. Écarts de comportement

1. **Un bot fait une page avec une fenêtre modale.** Ici : la compétence force `search "light dismiss dialog"` puis `retrieve` → `<dialog>` natif, `closedby="any"`, focus rendu, défilement bloqué en CSS, repli si non supporté. Sklubot : `pages-soignees` + `metier-du-design` parlent d'états et d'accessibilité en général ; le modèle écrit ce qu'il connaît (souvent une `<div>` positionnée + JavaScript). Résultat plus lourd et moins accessible. **Correctif** : T1 + G1 (S/M).
2. **Scripts CDN dans les pages** : Sklubot autorise cdnjs/jsdelivr/unpkg et demande d'épingler la version (`pagetools.ts` l.29) mais pas l'empreinte `integrity` ; le guide `secure-external-subresources` l'exige. **Correctif** : une phrase dans `pages-soignees` + avertissement à la publication si absent (S).
3. **Support navigateur** : rien n'empêche un bot d'utiliser une fonction CSS récente non supportée par Safari. Ici, chaque guide affiche son statut Baseline et une garde refuse les fonctions instables. **Correctif** : T5/T6 (M).
4. **Index dans le prompt** : la méthode Sklubot (index complet) est la bonne pour 9 guides mais ne passera pas à l'échelle ; la recherche locale de ce dépôt (BM25 seul suffirait au début) est le modèle à suivre (M).

---

## 5. À faire (classé)

1. Ajouter à `pages-soignees` la règle « avant un composant interactif, lis le guide » et intégrer ~30 guides traduits (dialogue, popover, menu, onglets, accordéon, toast, bouton Copier, squelette, tableau responsive, formulaire et validation, mode sombre, typographie, `features/` de repli), attribution CC BY — **M**.
2. Outil `guide_search` (BM25 sur les guides intégrés) pour ne plus dépendre d'un index dans le prompt — **M**.
3. Contrôle léger à `page_publish` (5-10 règles de `legacy-scan` : `innerHTML` de données, CDN sans `integrity`, pas de viewport, `div` cliquable sans rôle) — **M**.
4. Statut de support navigateur (paquet `web-features`) dans les guides + règle « largement disponible seulement » — **M**.
5. Exiger `integrity` sur les scripts CDN des pages (consigne + avertissement) — **S**.
6. Si l'outil est installé sur le bureau : version épinglée, `DISABLE_TELEMETRY=1` — **S**.
7. Passer l'appli web de Sklubot (`web/`) au crible des guides PWA, passkeys et accessibilité (travail développeur, pas bots) — **M**.
8. Reprendre de `chrome-extensions` la liste « justification des permissions + politique de confidentialité + réponse à un refus » pour la publication du compagnon/des applis mobiles — **S**.
9. Vérifier que `guide_read`/`skill_read` signalent une coupure au lieu de couper au milieu — **S**.

## 6. Non vérifié

- Les ~350 guides n'ont pas été lus un par un : familles et noms lus, 2 guides ouverts (`dialog`, fiche `accent-color`).
- Le contenu exact de la télémétrie (`src/cli/modern-web.ts`) n'a été lu qu'en partie ; le README dit que les requêtes de recherche de l'agent sont envoyées.
- La licence de `features/` et `skills-src/` n'est pas précisée à part (supposée Apache-2.0 du dépôt).
- Sklubot : coupure éventuelle des longs résultats de `guide_read` non vérifiée ; aucun test lancé.
