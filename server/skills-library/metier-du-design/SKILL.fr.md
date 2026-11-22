---
name: Règles de métier du design
description: Les règles universelles qu'un designer expérimenté applique par-dessus n'importe quelle marque - échelle typographique, interlettrage, discipline des couleurs et de l'accent, les signes du design « fait par une IA », les cinq états de tout bloc interactif, le minimum d'accessibilité, le mouvement et les lois de l'UX - pour vérifier chaque page, présentation ou visuel avant de le montrer.
---

> metier-du-design — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880) ; les parties typographie, couleur et anti-AI-slop ont été adaptées par OpenDesign de refero_skill (© Refero Design, MIT License). Modified for Sklubot (modifié pour Sklubot) : les règles du dossier craft/ ont été condensées en une seule compétence, réécrites pour les pages et présentations Sklubot, et traduites en français.

# Règles de métier du design

La marque (les couleurs et polices du compte, ou un style de base) dit *quelles* polices et couleurs. Ces règles disent *comment* s'en servir. Applique-les à chaque page, présentation, e-mail ou visuel, puis passe la liste de contrôle de la fin avant de dire que c'est prêt.

## 1. Typographie

- **Échelle** : une seule échelle multiplicative (×1,2 ou ×1,25), 6 à 8 tailles par document au plus. Repères web : grand titre 48–72 px, H1 32–48, H2 24–32, H3 20–24, texte 15–18, petit 13–14, légende 11–12.
- **Interligne** : 1,0–1,2 pour les grands titres et H1, 1,5–1,6 pour le texte, 1,5 pour le petit texte. Le chinois, le japonais et le coréen demandent plus : 1,3–1,4 pour les titres (même un énorme titre de couverture), 1,7–1,8 pour le texte, et aucun interlettrage négatif.
- **Interlettrage** : texte 0 ; petit texte +0,01 à +0,02em ; boutons et étiquettes +0,02em ; **TOUT EN CAPITALES toujours +0,06 à +0,1em** ; titres dès 32 px −0,01 à −0,02em ; grands titres dès 48 px −0,02 à −0,03em (écritures latines seulement).
- **Polices** : deux familles au plus (titres + texte, ou une famille variable). Toujours une liste de repli ; jamais `system-ui` seul sur un titre.
- **Graisses** : trois suffisent — lire (400), souligner (500–550), annoncer (600). Le 700 et plus sert rarement.
- **Longueur de ligne** : 50 à 75 caractères (`max-width: 65ch`). Jamais `text-align: justify` sur le web.
- Trois tailles de texte au plus visibles sans faire défiler.

## 2. Couleur

- **Quatre couches** : neutres 70 à 90 % des pixels (fond, surface, texte, texte atténué, bordure), **un seul** accent 5 à 10 %, couleurs de sens 0 à 5 % (succès, alerte, danger), effets moins de 1 %.
- **Discipline de l'accent** : deux usages visibles au plus par écran (par ex. une étiquette + le bouton principal). Les liens et les anneaux de focus comptent.
- **Contraste** (des seuils, pas des objectifs) : texte courant 4,5:1 ; grand texte (≥ 24 px, ou ≥ 18,5 px en gras) 3:1 ; boutons, champs, icônes et anneaux de focus par rapport à ce qui les entoure 3:1. Une couleur de marque vive trop pâle pour du texte : une nuance plus foncée pour le texte, la vive pour les aplats.
- **Thème sombre** : ni noir ni blanc purs — environ `#0f0f0f` en fond et `#f0f0f0` en texte ; bordures en `rgba(255,255,255,.08)`.
- **Nomme les variables par leur rôle** (`--accent`, `--success`), jamais par leur teinte (`--blue-500`).

## 3. Les signes du « fait par une IA » — à supprimer

À corriger absolument :
1. L'indigo/violet par défaut de Tailwind comme accent (`#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`…), sauf si c'est vraiment la marque.
2. Un dégradé « confiance » à deux couleurs sur le haut de page (violet→bleu, bleu→cyan, indigo→rose).
3. Des emoji comme icônes (✨ 🚀 🎯 ⚡ 🔥 💡) : de simples icônes au trait en SVG avec `currentColor`.
4. Une police sans empattement sur les titres quand le style a choisi une police à empattements.
5. Une carte arrondie avec une bordure gauche colorée (la « tuile de tableau de bord IA »).
6. Des chiffres inventés (« 10× plus rapide », « 99,9 % de disponibilité ») : une vraie source ou un emplacement marqué « à compléter ».
7. Du texte de remplissage (lorem ipsum, « fonction un / deux / trois »).

À corriger si possible : l'enchaînement immuable « haut de page → fonctions → tarifs → FAQ → appel à l'action » (change au moins une partie) ; les sites d'images de remplissage ; plus d'une douzaine de codes couleur bruts hors de `:root` ; l'accent utilisé six fois ou plus. En plus : les taches et vagues décoratives sans raison ; une mise en page si symétrique qu'elle n'a aucune tension.

**Une âme** : environ 80 % de recettes éprouvées, 20 % d'un choix assumé — une décision typographique forte, un geste de couleur, une proportion inattendue, des textes d'interface dans la voix du produit (« Commencer le suivi » plutôt que « Commencer »), une petite interaction mémorable. Si quelqu'un d'extérieur devine de quel produit il s'agit sur une capture d'écran, c'est réussi.

## 4. Les cinq états de tout ce qui est interactif

Chaque liste, tableau, carte, formulaire ou panneau qui affiche ou reçoit des données doit avoir :
- **Chargement** : rien sous 300 ms ; 0,3–2 s un squelette léger ou un indicateur ; 2–10 s un squelette ayant la forme du résultat ou un indicateur avec un texte (« Chargement des paiements… ») ; 10–60 s une barre de progression avec Annuler ; au-delà, arrêter et proposer de réessayer. Un message « plus long que prévu » à 15 s. Jamais d'indicateur qui tourne sans fin.
- **Vide** : un titre, une explication simple et une action. Premier usage = moment d'accueil ; aucun résultat = rappeler la recherche et proposer autre chose ; une erreur ne s'affiche jamais comme « vide ».
- **Erreur** : ce qui s'est passé, pourquoi si on le sait, quoi faire (réessayer, autre chemin), et la saisie de l'utilisateur conservée.
- **Rempli** : le cas pour lequel le design a été dessiné.
- **Extrêmes** : noms très longs, 10 000 lignes, champs facultatifs absents, texte de droite à gauche : la mise en page ne doit pas casser.

## 5. Minimum d'accessibilité (WCAG 2.2 AA)

- Contrastes du §2. Zones à toucher d'au moins 24×24 px (44×44 sur téléphone et pour les actions principales).
- Focus clavier visible (`:focus-visible`, 2 px, 3:1) ; ne jamais retirer le contour sans le remplacer.
- Chaque champ a son `<label>` ; erreurs reliées par `aria-describedby`, `aria-invalid="true"` et `role="alert"` ; de vrais `<button>` et `<a>`.
- Titres dans l'ordre, texte `alt` sur les images qui portent du sens (`alt=""` sur les décoratives), langue de la page (`<html lang>`).
- Jamais une information portée par la couleur seule (ajoute une icône, un mot ou un motif).

## 6. Mouvement

- N'anime que quand on se déplace dans l'espace, le temps ou un état : navigation, panneau qui s'ouvre, progression, suite d'un geste. Jamais pour enseigner, décorer, faire « haut de gamme » ou combler un vide.
- Durées : 50–100 ms pour un retour immédiat (appui, bascule, survol) ; 150 ms la confirmation par défaut ; 200–300 ms ce qui apparaît (fenêtre, menu) ; 300–500 ms les passages d'un écran à l'autre. Les petites interactions restent sous 500 ms, les fréquentes sous 200 ms ; environ 25 % plus court sur téléphone.
- Des courbes pour l'opacité et la couleur (par ex. `cubic-bezier(0.2, 0, 0, 1)`), un effet ressort pour la position et la taille. Anime `transform` et `opacity` plutôt que la largeur, la hauteur, top ou left.
- Respecte `prefers-reduced-motion` : remplace le mouvement par un fondu ou rien. Pas de boucle décorative sans fin à côté d'un texte à lire.

## 7. Lois de l'UX (quoi composer)

- **Hick / trop de choix** : moins d'options, décision plus rapide — 3 offres plutôt que 6, 5 à 7 entrées de menu, regrouper les longues listes de réglages.
- **Fitts** : l'action principale est grande et proche de là où sont déjà l'œil et la main ; les actions destructrices petites et éloignées.
- **Proximité, similarité, région commune** : ce qui va ensemble est proche, se ressemble ou partage un cadre — avant d'ajouter des traits ou des ombres.
- **Von Restorff** : le seul élément recommandé se distingue ; un seul par écran.
- **Miller / mémoire de travail** : regrouper chiffres et étapes (environ 4 éléments d'un coup d'œil) ; laisser le contexte visible plutôt que de le faire retenir.
- **Gradient d'objectif, Zeigarnik, pic-fin** : montrer la progression, ce qui reste, et finir un parcours sur un moment de réussite clair.
- **Jakob** : on s'attend à ce que font les autres sites ; innover sur le contenu, pas sur la place du menu.
- **Doherty** : répondre en moins de 400 ms, ou montrer que le travail est en cours.
- **Tesler** : la complexité ne disparaît pas ; la déplacer de l'utilisateur vers le produit (bons réglages par défaut, champs pré-remplis).

## 8. Liste de contrôle avant « c'est prêt »

- [ ] Échelle, interlettrage (les capitales !) et longueur de ligne respectés ; ≤ 3 tailles visibles sans défiler.
- [ ] Un seul accent, ≤ 2 usages par écran ; contrastes 4,5:1 / 3:1 vérifiés en clair et en sombre.
- [ ] Aucun des sept signes « fait par une IA » ; aucun chiffre inventé.
- [ ] Chaque bloc interactif a ses états chargement, vide, erreur et extrêmes.
- [ ] Focus visible, libellés présents, zones à toucher assez grandes, mouvement réduit respecté.
- [ ] Regardé (capture d'écran) en largeur téléphone et ordinateur, en clair et en sombre.
