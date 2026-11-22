# Audit complet : anatomy (wheresryan22) comparé à Sklubot

Date : 22/11/2026. Lecture seule. Dépôt `wheresryan22/anatomy`, commit `1482e84` (18/10/2026), 173 fichiers, 40 Mo. Rien n'a été exécuté.

Type : **une compétence + une bibliothèque de dessin + des outils de vérification**. La compétence `SKILL.md` (≈ 175 lignes denses + 10 références) fait expliquer une idée technique par **un objet physique inventé** (une serrure à goupilles pour un cache, un traceur à portique pour un contexte GPU partagé…), dessiné en **isométrique** avec des dizaines de petites pièces ombrées, dans une carte avec titre, aide et **lecture en direct**, animé calmement, puis **vérifié** (captures, zoom 4×, audit de géométrie, contrôle des fins de traits). Trois sortes de figures : SVG, SVG + WebGL (feu, eau, lumière), 3D (bêta). Sorties : page HTML autonome, SVG seul, composants React, et **fiches A4 en PDF** (affiche, dessin technique, explication détaillée). Zéro dépendance (Node ≥ 20.10, Chrome sans interface pour les vérifications).

## Comptes

| Statut | Nombre |
|---|---|
| FAIT | 6 |
| PARTIEL | 10 |
| MANQUANT | 19 |
| DIFFÉRENT | 3 |
| NON REPRIS | 5 |
| **Total** | **43** |

Compétences (paquet) : 1 compétence → **ADAPTER** (en mode « outil à la demande » sur l'ordinateur du bot, comme « OpenDesign (outil complet) »).

Lecture rapide : rien de comparable dans Sklubot. Sklubot a des pages interactives (`page_publish`), des affiches (`canvas-design`), un studio vidéo et des ateliers d'explication vidéo, mais **aucune méthode pour une figure explicative interactive** et surtout **aucune boucle de vérification visuelle automatique** des pages qu'un bot produit. La partie la plus réutilisable pour tout Sklubot n'est pas l'isométrie : c'est la **discipline de vérification** (capture bureau + téléphone 390 px, états de survol, plusieurs instants de l'animation, zoom 4× sur chaque jonction, lire chaque PNG, contrôles automatiques à zéro).

---

## 1. Licence

| Élément | Licence exacte | Ce qu'elle permet |
|---|---|---|
| Dépôt | **MIT License**, © 2026 Ryan (`LICENSE`) | Copier, modifier, revendre ; garder copyright + texte MIT. |
| Exemples (`examples/`) | MIT (dépôt) ; certains représentent des objets réels (moteur Raptor 2) | Le code est MIT ; ne pas présenter un exemple comme un produit d'une marque. |
| Galerie communautaire (`wheresryan22/anatomy-community`, hors dépôt) | MIT ou CC BY 4.0 au choix de chaque auteur | Non lue. |

---

## 2. Tableau des fonctions

Preuves Sklubot : `page_publish` / `page_edit` (`server/src/agent/pagetools.ts` l.12-29 : HTML + 20 fichiers, 5 Mo, JS en bac à sable, CDN autorisés), compétences `canvas-design`, `pages-soignees`, `metier-du-design`, `presentations`, `video-github`, `studio-animation` (`server/skills-library/catalog.json`), `browser_open` (`server/src/agent/tools.ts` l.150), `design_reference_layout` (l.154), conversion bureautique (`server/src/office.ts`), Chromium sur le bureau (`docker/desktop/Dockerfile` l.12), guide intégré « artefact » (`server/src/agent/guides.ts` l.14).

### 2.1 Méthode (la compétence)

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| A1 | « L'objet est l'explication » : inventer une machine dont le fonctionnement **est** le concept ; table d'exemples concept → objet ; deux échecs nommés (trop abstrait, trop plat). | MANQUANT | — | Aucune compétence d'illustration explicative. | S |
| A2 | **Taille annoncée avant de commencer** : Figure (40-80 pièces, < 1 h, sans demander), Hero (80-150, 2-4 h, annoncer), Epic (6 h+, **ne pas commencer** : proposer une version Hero et dire ce que la grande version ajouterait). | PARTIEL | « Méthode de travail » (comprendre le but) ; plafonds de temps des tours (`agent/reliability.ts`) | Pas de règle « estimer et proposer plus petit avant un travail long ». Très utile pour tous les gros travaux des bots. | S |
| A3 | Page qui s'ouvre **dans la première heure**, puis on approfondit ; `date` à chaque étape ; prévenir l'utilisateur quand une étape dépasse 2× sa part. | PARTIEL | Notice « semble bloqué » après 5 min (`agent/watch.ts` en-tête) | Le bot ne donne pas lui-même d'état d'avancement par rapport à une estimation. | S |
| A4 | **Vérité d'abord** : vrais chiffres (tailles, seuils, courbes), un petit modèle pur qui pilote tout ; lecture en direct et légende vraies. | MANQUANT | — | — | S |
| A5 | **Liste des pièces** écrite avant toute géométrie (≥ 40, groupées : base, structure, mécanisme, commandes…). | MANQUANT | — | — | S |
| A6 | Planifier le monde (unités, caméra azimut 45°, élévation 30°), construire la géométrie **une fois**, peindre de l'arrière vers l'avant. | MANQUANT | — | — | M |
| A7 | **Cadre** : « Fig n » en haut à gauche, titre, aide d'interaction, lecture en direct ; légende vraie sous la carte ; pas de mots dans le dessin. | MANQUANT | — | — | S |
| A8 | **Mouvement calme** : suivi exponentiel ou ressorts, visite automatique au repos, réagit souris **et clavier**, s'arrête hors écran, **immobile en mouvement réduit**. | PARTIEL | `metier-du-design` (mouvement, accessibilité) | Règles « hors écran = arrêt » et « clavier » non explicites pour les pages des bots. | S |
| A9 | Règles d'artisanat : solides et non fils de fer, 4 tons par face, une seule pièce « éclairée », petits détails purposés (vis, biseaux, graduations), **chaque trait finit sur quelque chose**, aucun tuyau ne traverse rien, profondeur prouvée, surfaces courbes sans marches, textures qui finissent sur un bord ou s'estompent, texte qui tient dans sa fenêtre, volume, composition à 55-65 % de la carte, lisible à 390 px. | MANQUANT | `metier-du-design` (règles générales de design) | Spécifique à l'isométrie ; seules « lisible à 390 px » et « une seule chose à regarder » sont générales. | S |
| A10 | WebGL **dans** le dessin : 3 couches (SVG arrière, canevas, SVG avant), même caméra, rien ne « saute » (enveloppes attaque/déclin), pas de coupure nette, thème clair conçu pour le papier, densité de pixels plafonnée à 1,5, rendu seulement si visible, figure lisible **sans WebGL**. | MANQUANT | Bac à sable des pages (WebGL non vérifié) | Repli sans WebGL et économie (rendu seulement visible) sont de bonnes règles générales. | M |
| A11 | Mode 3D (bêta) : pièces re-projetées chaque image, ordre par plans séparateurs, matériaux (or, chrome, acier, caoutchouc…), pièces qui se détachent. | NON REPRIS | — | Bêta, coûteux (audit 15-20 min pour 30 pièces). | — |
| A12 | **Fiches A4 / Letter en PDF** depuis la figure finie : affiche (1 page), dessin technique (nomenclature, spécification, encart), explication détaillée (2-4 pages, étapes illuminées) ; bouton PDF sur la carte. | PARTIEL | Conversion bureautique (`server/src/office.ts`) ; `presentations` imprime une diapo par page | Pas de « fiche » imprimable générée depuis une page publiée. | M |
| A13 | Proposer les 3 formats quand l'utilisateur n'a pas choisi. | MANQUANT | — | Règle d'interface générale : proposer des choix concrets. | S |
| A14 | « Dire où ça vivra » (page HTML, SVG seul, composant React ; clair/sombre) : la construction diffère. | PARTIEL | `page_publish` = page ; `file_save` = fichier | Pas de sortie « SVG seul » ni composant React. | S |
| A15 | Thème clair d'abord, sombre ensuite, les deux livrés. | PARTIEL | `styles-de-base` : clair + sombre | — | — |
| A16 | Ne jamais copier une image de référence : prendre la finition, pas l'objet. | FAIT | `design_reference_layout` = mesures « salle blanche » (`tools.ts` l.154), `guides.ts` l.16 | — | — |

### 2.2 Vérification (la partie la plus précieuse)

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| V1 | `capture.mjs` : captures Chrome sans interface, **bureau + téléphone 390 px**, survol, gros plans, **erreurs de la console**. | PARTIEL | `browser_open` (une capture, une taille) | Pas de capture téléphone, pas d'erreurs console rendues au bot, pas de gros plan. Un bot qui publie une page ne voit pas qu'elle plante. | M |
| V2 | `drive.mjs` : scénario (bouger, cliquer, touche, ralenti, attendre que, évaluer), planches de contact qui attrapent les « sauts », mode sans WebGL, préchargement. | PARTIEL | `screen_click`, `screen_type`, `screen_key`, `screen_scroll` + `screen_view` | Pas de séquence scriptée ni de planche ; chaque étape coûte un appel et une image. | M |
| V3 | **« Lis chaque PNG que tu fais »** ; zoom 4× sur chaque jonction dans les deux thèmes ; « le propriétaire trouve les défauts en zoomant, zoome d'abord ». | PARTIEL | `pages-soignees` : vérifier téléphone et ordinateur ; « Méthode de travail » : vérifier avant « fini » | Pas d'obligation de regarder la capture de la page publiée. | S |
| V4 | `kit/audit.mjs` : **preuve géométrique** (aucun chevauchement, chaque extrémité sur un support, ordre de profondeur par lancer de rayons) au repos, démonté et en vol ; doit finir « audit passed » à 0. | MANQUANT | — | Spécifique ; l'idée « contrôle automatique qui doit finir à zéro » est générale. | L |
| V5 | `lines.mjs` : chaque trait de texture finit sur un trait/point/contour ; entoure les fautes ; code de sortie 1. | MANQUANT | — | Spécifique. | M |
| V6 | `fingerprint.mjs`, `turn-check.mjs` (fidélité, ordre, sauts de pixels, perf), `turn-bench.mjs`. | NON REPRIS | — | 3D bêta. | — |
| V7 | Tests du dépôt (≈ 70 fichiers `*.test.mjs` : audit, capture, conduite, lignes, impression, publication, React). | DIFFÉRENT | Sklubot a ses propres tests | — | — |
| V8 | `chrome-port.mjs` / `session.mjs` : démarrage de Chrome avec profil temporaire et port local, robustesse au démarrage (test `chrome-startup`). | FAIT | Chromium du bureau piloté par Sklubot (`computer.ts`, `screen-elements.ts`) | — | — |
| V9 | Contrôle « mouvement réduit = une pose fixe » avant publication. | MANQUANT | — | Règle de vérification générale. | S |
| V10 | Mesurer l'encre par image dans les transitions (thème clair). | NON REPRIS | — | Trop spécifique. | — |

### 2.3 Bibliothèque (`kit/`) et sorties

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| K1 | `iso-kit` (TS/ESM) : caméra isométrique, solides, pièces, rendu SVG en chaîne, carte et page, CSS. | MANQUANT | — | Utilisable sur le bureau du bot (Node 22 présent). | M |
| K2 | `lathe.mjs` (pièces de révolution), `tube.mjs` (tuyaux/câbles triables en profondeur), `gl.mjs` (shaders dans la caméra), `canvas-painter`, `turn*.mjs`. | MANQUANT | — | Idem. | M |
| K3 | `react/draw.tsx` + `react/live.tsx` (composants serveur + crochets client : lecture, boucle, amorti, visibilité, immobilité). | NON REPRIS | — | Les bots ne livrent pas d'appli React. | — |
| K4 | `inline-kit.mjs` : le kit inséré **dans** une page autonome (aucun fichier externe). | FAIT (compatible) | `page_publish` accepte le JS en ligne et jusqu'à 20 fichiers, 5 Mo | Une figure autonome se publie telle quelle (à vérifier : WebGL dans le bac à sable). | — |
| K5 | SVG seul avec styles intégrés. | PARTIEL | `file_save` / `file_send` | Pas d'aperçu d'un SVG dans le fil (non vérifié). | S |
| K6 | Aperçu PNG livré avec la figure. | PARTIEL | `browser_open` capture | Pas de « joindre la capture de la page publiée » automatiquement. | S |
| K7 | Exemples complets (8) : du plus petit (~300 lignes) au moteur de fusée. | MANQUANT | `modeles-de-pages` (gabarits de pages) | Les exemples servent de référence de qualité au modèle. | S |
| K8 | `evals/evals.json` : demandes types pour évaluer la compétence. | MANQUANT | — | Idée pour tester les compétences de la bibliothèque. | M |

### 2.4 Partage, installation, sécurité

| # | Fonction | Statut Sklubot | Preuve | Ce qui manque | Taille |
|---|---|---|---|---|---|
| P1 | Publier dans une galerie communautaire **seulement sur demande**, « jamais sans un oui explicite », vérifier que c'est le travail de l'utilisateur, plan montré avant (`--dry-run`), demande d'auteur/titre/licence. | FAIT (principe) | Partage public = carte d'accord ; actions GitHub soumises à accord | La galerie elle-même : non repris (service tiers). | — |
| P2 | Choix de licence de l'œuvre (MIT / CC BY 4.0) au moment du partage. | MANQUANT | Pages Sklubot sans licence | Idée : licence choisie quand une page est rendue publique. | S |
| P3 | Installation multi-agents (`npx skills add`, git, zip). | DIFFÉRENT | Bibliothèque + import GitHub (`server/src/skillsgithub.ts`) | L'import GitHub ne prendrait que `SKILL.md` : le kit et les scripts (indispensables) resteraient dehors → la compétence importée ne marcherait pas. | — |
| P4 | Conseils pour le bac à sable Codex (Chrome bloqué) : ne pas lever toutes les limites, approuver commande par commande. | DIFFÉRENT | Bureau Linux du bot : Chrome autorisé | Rien de perdu. | — |
| P5 | `SECURITY.md`, CI. | FAIT | — | — | — |
| P6 | Aucune clé, aucune dépendance réseau à l'exécution. | FAIT | — | — | — |

---

## 3. Sur l'ordinateur du bot ?

- **Oui, sans risque notable** : le dépôt n'a aucune dépendance npm, n'appelle aucun service, n'envoie aucune statistique ; il lui faut Node ≥ 20.10 (l'image a Node 22) et Chrome/Chromium pour les vérifications (présent). Recommandation : **ne pas l'intégrer à l'image**, mais faire comme « OpenDesign (outil complet) » : une compétence qui récupère à la demande une copie figée (commit vérifié `1482e84`) dans le dossier du bot.
- **Ce que l'outil rend** : une page HTML autonome animée (et une version claire), des PNG de vérification, « audit passed » / « line ends: 0 », des PDF A4. **Équivalent Sklubot** : `page_publish` rend une adresse de page et une carte d'aperçu ; `browser_open` une capture ; rien ne contrôle la page.
- **Coût** : une figure « Figure » = jusqu'à une heure de travail du bot (beaucoup de jetons). À réserver aux offres payantes ou à une demande explicite ; annoncer la durée (règle A2 du dépôt).

---

## 4. Écarts de comportement

1. **Livrer une page sans l'avoir regardée.** Anatomy impose : capture bureau + téléphone + survol + plusieurs instants, lire chaque PNG, zoom 4×, contrôles automatiques à zéro, puis seulement « fini ». Sklubot : `page_publish` publie et affiche une carte ; la compétence `pages-soignees` demande de vérifier, mais aucun outil ne renvoie au bot la capture téléphone ni les **erreurs JavaScript de la console**. Une page qui plante en silence peut être annoncée « faite ». **Correctif** : après `page_publish`, renvoyer automatiquement au bot une capture 390 px + 1280 px et la liste des erreurs console (M).
2. **Gros travaux sans estimation.** Anatomy classe la demande (Figure / Hero / Epic), annonce la durée, refuse de lancer l'Epic sans accord et propose plus petit. Sklubot lance le travail ; les plafonds de temps l'arrêtent ensuite (`agent/reliability.ts`) et la notice de blocage arrive après 5 min sans progrès. **Correctif** : règle « estimer, annoncer, proposer une version plus petite au-delà d'un seuil » dans « Méthode de travail » (S).
3. **Une page visible tout de suite, puis approfondie.** Anatomy exige une page qui s'ouvre dans la première heure. Les bots Sklubot peuvent travailler longtemps avant la première publication. **Correctif** : même règle dans `pages-soignees` (« publie une première version privée tôt, puis améliore ») (S).

---

## 5. À faire (classé)

1. Après chaque `page_publish`, renvoyer au bot une capture téléphone (390 px) et ordinateur (1280 px) **et les erreurs de console** ; exiger qu'il les regarde avant d'annoncer « fini » — **M**.
2. Règle « estimer la taille, annoncer la durée, proposer une version plus petite » dans « Méthode de travail » — **S**.
3. Règle « première version privée tôt, puis approfondir » dans `pages-soignees` — **S**.
4. Compétence **« Figure explicative interactive »** adaptée d'Anatomy (méthode A1-A9 en français) + récupération à la demande du kit figé sur l'ordinateur du bot (MIT + crédit) — **M**.
5. Ajouter à `metier-du-design` : « s'arrête hors écran », « clavier », « une pose fixe en mouvement réduit », « lisible sans WebGL » — **S**.
6. Fiche imprimable A4 (PDF) depuis une page publiée (affiche / fiche technique), via Chromium `--print-to-pdf` sur le bureau — **M**.
7. Scénario de vérification en un appel (suite d'actions + planche de captures) pour l'ordinateur du bot — **M**.
8. Signaler dans l'import GitHub qu'une compétence dépend de fichiers non importés (kit, scripts) — **S** (même point que claude-seo).
9. Vérifier que WebGL fonctionne dans le bac à sable des pages publiées — **S**.

## 6. Non vérifié

- Les 10 références (`craft.md`, `verify.md`, `webgl.md`, `3d.md`…) et le code du kit n'ont pas été lus en entier (SKILL.md lu presque entièrement, README entier, en-tête de `publish.mjs`).
- WebGL dans le bac à sable des pages Sklubot : non testé.
- Aperçu d'un fichier SVG dans le fil Sklubot : non vérifié.
- Aucun test lancé.
