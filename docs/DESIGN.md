# Règles d'interface de Sklubot

*Ce que l'application web fait déjà, écrit pour qu'on continue pareil. Les personnages ont leur propre document : [DIRECTION-ARTISTIQUE.md](DIRECTION-ARTISTIQUE.md).*

## Principes

1. **Simple par défaut.** Une page montre ce qui sert maintenant ; le reste est replié (« Voir que faire », « Afficher plus », réglages avancés).
2. **Une action principale par carte.** Un seul bouton plein (`btn-accent` ou `btn-primary`), à droite. Les autres choix sont discrets (`btn-ghost`) ou normaux (`btn`), à gauche ou avant lui. Refuser est toujours possible.
3. **Jamais d'impasse.** Chaque arrêt dit pourquoi et propose une suite : « Continuer », « Attendre », « Changer d'IA », « Ouvrir les réglages ». Une erreur dit quoi faire, pas seulement ce qui a raté. Le travail déjà fait n'est jamais jeté.
4. **Expliquer l'irréversible.** Une action qu'on ne peut pas défaire (envoi, paiement, suppression, publication) porte le bandeau rouge « Action irréversible » avec la raison, n'offre jamais « Toujours autoriser », et une suppression se confirme en deux temps (`ConfirmButton`).
5. **Téléphone d'abord, 390 px.** Tout doit tenir sur un écran de 390 px de large sans défilement horizontal : textes qui passent à la ligne (`overflow-wrap: anywhere`), boutons de carte qui s'étirent sous 420 px, barre latérale en tiroir sous 720 px.
6. **Clair et sombre à égalité.** Chaque couleur existe dans les deux thèmes ; on ne livre pas un écran vérifié dans un seul. Le thème suit le système par défaut (`data-theme` sur `<html>`).

## Jetons (`web/src/styles/tokens.css`)

N'écris jamais une couleur en dur dans un composant : prends un jeton. Un nouveau jeton se déclare dans les deux thèmes.

**Fonds** — `--bg` (la page), `--surface` (cartes, panneaux, fenêtres), `--surface-2` (lignes surélevées, puces, survol doux), `--surface-3` (onglets, tuiles de logo), `--hover`, `--active` (calques transparents de survol et d'appui), `--scrim` (voile derrière une fenêtre).

**Bordures** — `--border` (séparateurs), `--border-strong` (champs, boutons normaux). Une bordure ne porte jamais seule une information.

**Texte** — `--text` (principal), `--text-2` (secondaire : sous-titres, `.muted`), `--text-3` (indices, heures, textes d'attente). `--ink` / `--ink-fg` : le bouton principal et le toast. `--accent` / `--accent-fg` : le bouton d'accent et l'interrupteur allumé (aujourd'hui égal à l'encre). `--on-strong` : texte posé sur une couleur d'état pleine (bouton rouge, pastilles de compte).

**États** — chaque état a une couleur et son fond doux : `--danger` / `--danger-soft`, `--warn` / `--warn-soft`, `--ok` / `--ok-soft`, `--info` / `--info-soft`. Le texte d'état se pose sur son fond doux ou sur `--surface`. `--focus` : l'anneau de focus.

**Rayons** — `--r-sm` 6 px (petits éléments), `--r-md` 10 px (boutons, champs, encadrés), `--r-lg` 14 px (cartes, panneaux), `--r-xl` 20 px (fenêtres). Les puces et badges sont en pilule (`999px`).

**Ombres** — `--shadow-sm` (onglet actif), `--shadow-md` (menus, toast), `--shadow-lg` (fenêtres, tiroir).

**Polices** — `--font` (police du système), `--mono` (code, détails techniques).

**Tailles de texte** (pas encore en jetons, à respecter) — 11,5 px (puces, badges) · 12 / 12,5 px (indices, sous-titres, petits boutons) · 13 / 13,5 px (texte de carte, boutons) · 14 px (corps de page) · 15–16 px (titres de fenêtre) · 18 px (titres de page) · 20 px (chiffres clés). Graisse : 550 (boutons, libellés), 600–650 (titres), 700 (titres de page d'accueil).

**Espacements** (pas encore en jetons) — multiples de 2 : 4, 6, 8, 10, 12, 14, 16, 20, 24 px. 8 px entre boutons, 10 px entre les blocs d'une carte, 14 px de marge intérieure de carte (12 px sous 420 px).

## Composants

- **Cartes** (`.card`, `web/src/components/Cards.tsx`) : en-tête (tuile de logo + titre en 650 + sous-titre `--text-2`), détail éventuel (`.card-detail`, police mono), raison (`.card-reason`), puis `.card-actions` (refus à gauche, action principale à droite). Une fois répondue, la carte garde sa trace en une ligne `.card-outcome` (« Autorisé une fois · fait »), sans boutons. Largeur max 480 px. Chaque type et chaque état sont dans la galerie.
- **Avis** (`.notice`, dans la discussion) : une pilule centrée `info` / `warn` / `error`, avec ses choix dessous (`.notice-actions`, petits boutons). Une fois traité, l'avis ne fait plus que dire (`.notice-done`).
- **Boutons** (`.btn`) : 36 px de haut (30 px en `btn-small`), 44 px sur écran tactile. Variantes : `btn-primary` (encre), `btn-accent`, `btn` (normal), `btn-ghost` (discret), `btn-danger` (rouge plein, rare), `btn-ghost-danger` (retirer). Icône seule : `IconButton` (`.icon-btn`, 32 px) avec toujours un `label` lu par les lecteurs d'écran. Un bouton occupé change de texte (« Enregistrement… ») et se désactive.
- **Badges et puces** : `.chip` (neutre) et ses états `.state-ready`, `.state-working`, `.state-needs_input`, `.state-error` ; `.count-badge` (nombre, `is-attention` en orange) ; pastilles `.dot-*`. La couleur n'est jamais seule : un mot ou une icône l'accompagne.
- **États vides** (`Empty` de `ui.tsx`) : une icône ronde, un titre court, une phrase qui dit quoi faire pour remplir la page. Pas de page blanche, pas de « Aucune donnée ».
- **Bandeaux** : `.pause-banner` (bot en pause, avec « Reprendre »), `.surv-banner` (état de la Surveillance), `.callout` (`is-warn`, `is-ok`), `ErrorNote` (erreur avec croix pour fermer). Un bandeau = une phrase en gras + une phrase d'explication + au plus un bouton.
- **Chargement** : `Loading` (petit cercle + texte), jamais un écran vide.

## Écriture

- **Tutoiement**, phrases courtes, voix active : « Reconnecte Gmail », pas « Il est nécessaire de procéder à la reconnexion ».
- **Pas de jargon** : « clé », « connexion », « ordinateur du bot » plutôt que token, OAuth, conteneur. Un terme technique n'apparaît que dans un détail (`code`).
- **Dire ce qui va se passer** sur le bouton : « Autoriser une fois », « Supprimer 3 fichiers », pas « OK ».
- **Deux langues** : chaque texte existe en français et en anglais (`web/src/i18n/fr.ts`, `en.ts`, mêmes clés ; le français d'abord). Les données des bots (titres de cartes, e-mails) ne se traduisent pas.
- Typographie française : espace insécable avant `: ; ? !`, guillemets « », nombres « 5,00 $ ».

## Accessibilité

- **Contraste** : texte ≥ 4,5:1 ; grand texte, icônes et contrôles ≥ 3:1, dans les deux thèmes. `npm run check:contrast -w web` mesure chaque paire texte/fond déclarée dans `web/scripts/check-contrast.mjs` et échoue en dessous (aussi dans la CI). Une nouvelle paire utilisée pour du texte s'ajoute à sa liste `PAIRS`.
- **Focus visible** : `:focus-visible` dessine un anneau `--focus` de 2 px ; ne le retire jamais sans le remplacer.
- **Cibles tactiles ≥ 44 × 44 px** sur écran tactile : le bloc `@media (pointer: coarse)` de `base.css` agrandit les boutons et champs, et donne aux petits contrôles une zone de toucher invisible de 44 px. `web/scripts/touch-targets.test.mjs` (dans `npm test -w web`) échoue si une nouvelle classe de bouton n'y figure pas.
- **Mouvement réduit** : sous `prefers-reduced-motion: reduce`, animations et transitions s'arrêtent (règle globale de `base.css`) ; une animation qui porte une information garde un équivalent fixe.
- Chaque bouton icône a un `aria-label` ; les mises à jour (toast, bandeaux) sont dans une région `role="status"` ; les fenêtres gardent le focus (`useDialogFocus`) et se ferment avec Échap.

## Vérifier un écran

- **Galerie des états** (développement seulement) : `npm run dev -w web`, puis `http://localhost:5173/?dev=gallery`. Les vrais composants avec des données factices : cartes de chaque type dans chaque état, avis, bandeaux, états vides, pages Aujourd'hui et Surveillance. Réglages dans l'adresse : `theme=dark`, `frame=390` (cadre de téléphone), `lang=en`, `long=1` (textes très longs), `empty=1` (pages vides), `fail=1` (les boutons échouent), `section=cards&type=approval&status=pending`. Elle n'entre jamais dans la version de production (`npm run check:bundle -w web` le vérifie après le build).
- Un rendu ne se déclare pas fini sans avoir été regardé : capture en clair et en sombre, à 390 px et sur grand écran.
- **Taille des fichiers** : `npm run check:size` (dans `npm test`) empêche les gros fichiers de `web/src` et `server/src` de grossir (voir `scripts/file-size-ratchet.test.mjs`). Un nouveau composant va dans un fichier nommé d'après ce qu'il fait. Après avoir découpé un fichier : `npm run check:size:update`, et on commite `scripts/file-size-baseline.json` avec.
