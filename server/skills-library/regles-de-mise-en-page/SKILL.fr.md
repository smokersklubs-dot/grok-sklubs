---
name: Règles de mise en page contre l'air générique
description: Des règles à ajouter à toute page ou tout visuel pour qu'il n'ait pas l'air généré - proposer deux ou trois idées avant un visuel, régler densité et audace exprès, une seule couleur d'accent, de vrais états (vide, chargement, erreur), clichés de mise en page interdits, téléphone d'abord avec 100dvh et cibles de 44 px, clavier et mouvement réduit, une solution de repli sans 3D ni WebGL, rien de caché hors écran.
---

> Adaptée de google-labs-code/stitch-skills « taste-design » (© 2026 Google LLC, Apache License 2.0) et de l'étape « proposer d'abord deux ou trois idées » de stick-scene (© 2026 Kamran Ahmed, MIT). Modifiée pour Sklubot (22/11/2026) : le générateur de fichier de design d'origine et son outil retirés, interdits de polices et de marques assouplis pour suivre d'abord la charte du patron, règles réécrites en liste de contrôle pour les pages et visuels Sklubot, traduite en français.

# Règles de mise en page contre l'air générique

Ces règles s'ajoutent aux « Règles de métier du design » et à la charte du patron. Pour les couleurs et les polices, la charte gagne toujours.

## Avant un visuel : deux ou trois idées

Pour un premier écran, une illustration, une affiche ou une animation, propose d'abord **deux ou trois idées différentes** en une ligne chacune (une métaphore, une composition, ce que l'œil voit d'abord) et laisse le patron choisir (ask_user, ton idée conseillée en premier). Puis construis seulement celle qu'il a choisie.

## Régler les curseurs exprès

Dis en une ligne où se place la page sur trois échelles, et tiens-t'y :
- **Densité** : aérée (galerie) · équilibrée (appli de tous les jours) · dense (tableau de bord).
- **Audace** : symétrique et calme · décalée · osée.
- **Mouvement** : immobile · transitions légères · chorégraphié.
Une page de restaurant est souvent aérée, décalée, légère ; un tableau de stock est dense, symétrique, immobile.

## Couleur et typographie

- **Une seule** couleur d'accent, pas trop saturée ; des neutres d'une seule famille (tous chauds ou tous froids).
- Pas de noir pur (#000) : un gris très sombre se lit mieux. Pas de halos fluo, pas de dégradés violet-bleu, pas de grand texte en dégradé.
- Texte courant de 16 px au moins, lignes d'environ 65 caractères au plus ; la hiérarchie des titres vient de la graisse et de la couleur, pas seulement de la taille.
- Polices : celles de la marque. Sans marque, évite les polices par défaut les plus usées et choisis une famille qui a du caractère, avec une solution gratuite de repli.

## Les états qui doivent exister

- **Chargement** : un squelette qui a la forme du contenu, pas une roue qui tourne.
- **Vide** : un message composé qui dit comment le remplir (« Pas encore de réservation : partage ce lien »).
- **Erreur** : un message clair sur place, à côté de ce qui a échoué, avec quoi faire.
- Formulaires : l'étiquette au-dessus du champ, une aide facultative, le message d'erreur en dessous.

## Clichés de mise en page à éviter

- Un premier écran centré par réflexe sur une page qui se veut audacieuse : préfère l'écran partagé, l'alignement à gauche ou le décalé.
- La rangée de trois cartes identiques : préfère deux colonnes en zigzag, une grille irrégulière ou une liste.
- Du texte sur des images ou sur un autre texte ; du contenu empilé en positions absolues.
- Le remplissage : « Faites défiler », flèches qui rebondissent, « En savoir plus » à côté du bouton principal (une seule action principale).
- Des chiffres inventés et de faux blocs « chiffres clés », des décorations « LIBELLÉ // 2026 », des noms bidon (« Jean Dupont », « Acme »), de faux chiffres ronds (99,9 %).
- Des émojis en guise d'icônes ; des curseurs de souris personnalisés.

## Téléphone d'abord, et solide

- Sous 768 px tout passe sur une colonne ; **aucun défilement horizontal** à 390 px.
- Les sections plein écran utilisent `min-height: 100dvh`, jamais `100vh` seul (ça saute sur téléphone).
- Les titres s'adaptent avec `clamp()` ; zones à toucher d'au moins 44 × 44 px ; le menu devient un menu mobile simple.
- N'anime que `transform` et `opacity` ; chaque animation a sa version `prefers-reduced-motion` ; le contenu se lit sans scripts.
- **Clavier** : chaque commande atteignable avec Tab dans un ordre logique, avec un focus visible ; menus et fenêtres se ferment avec Échap.
- **Rien d'important hors écran** : pas de texte poussé hors de la zone visible, pas de contenu seulement au survol.
- **3D, WebGL ou vidéo en fond** : toujours une solution fixe (une image ou un fond uni) quand ce n'est pas pris en charge ou que le mouvement est réduit ; le texte n'en dépend jamais.

## Vérifier

Regarde la page (screen_view à 390 px et en largeur ordinateur, clair et sombre), parcours-la une fois au clavier, et active le mouvement réduit si tu as animé quelque chose. Corrige ce qui enfreint une règle avant de la montrer.
