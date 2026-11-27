---
name: Modèles statiques de pages
description: Construire un tableau de bord, un tableau filtrable, un formulaire en étapes ou un kanban à partir d'un fichier HTML prêt et vérifié, gardé avec cette compétence - partir du modèle, jamais d'une page blanche, relire chaque ligne et remplacer chaque valeur d'exemple, puis vérifier sur téléphone et ordinateur. Et comment faire la même chose en petite appli React.
---

> Adaptée d'Astryx (github.com/meta/astryx, commit fa22c93 ; © Meta Platforms, Inc., MIT) : ses modèles de pages « dashboard-scorecard », « table-filter », « form-wizard » et « kanban-board » et sa règle « toujours partir d'un modèle ». Modifiée pour Sklubot (22/11/2026) : réécrits en quatre fichiers HTML sans bibliothèque (gardés avec cette compétence), méthode écrite pour un bot Sklubot (skill_read avec file, page_publish, screen_view), traduite en français.

# Modèles statiques de pages

Quatre pages prêtes sont gardées avec cette compétence, en fichiers. Chacune marche déjà sur téléphone et ordinateur, en clair et en sombre, au clavier, avec le mouvement réduit, et a un vrai état vide. Tu pars de l'une d'elles : la mise en page reste stable d'une fois à l'autre.

| Fichier | Pour |
|---|---|
| `tableau-de-bord.html` | un tableau de bord : 3 à 5 chiffres clés avec leur évolution, des barres vers les objectifs, une colonne « ce qu'il faut retenir » |
| `tableau-filtrable.html` | une liste à chercher, filtrer et trier (clients, produits, commandes), avec un compteur et un message « rien ne correspond » |
| `assistant-etapes.html` | un formulaire en étapes (devis, inscription) : un groupe de questions par étape, des vérifications avant de continuer, un récapitulatif avant l'envoi |
| `kanban.html` | un tableau où chaque colonne est un état ; les cartes se déplacent à la souris ou avec des boutons (clavier et téléphone) |

## La règle : partir d'un modèle, relire, remplacer

1. **Choisis** le modèle le plus proche dans le tableau. Aucun ne va ? Dis-le, et pars du plus proche plutôt que d'une page blanche.
2. **Lis-le** avec skill_read (le nom de cette compétence, file : le nom du fichier) et copie-le dans ton travail.
3. **Garde la charpente** : les jetons en haut (`:root`), les espacements, les largeurs, le contour de focus, `min-height: 100dvh`, la règle du mouvement réduit, l'état vide. Change le contenu, pas le squelette.
4. **Remplace chaque valeur d'exemple** : chaque endroit marqué `REPLACE`, chaque nom, chiffre, date et texte. Prends les vraies données du patron (son fichier, ses chiffres) ; un chiffre que tu n'as pas est retiré, jamais inventé.
5. **Relis tout le fichier** avant de le montrer : aucune valeur de l'exemple oubliée, aucune couleur en dur hors de `:root` (utilise un jeton), aucun texte dans une autre langue que celle de la page.
6. **Vérifie** : publie-la (page_publish), puis regarde-la avec screen_view à 390 px et en largeur ordinateur, en clair et en sombre ; parcours-la une fois avec Tab seulement. Corrige avant de la montrer.

## La marque

Pour suivre la marque du patron, change seulement les jetons du haut (couleurs, police, arrondis), d'après sa charte (`~/team/charte.md` si elle existe) ou un thème de « Thèmes sans marque ». Vérifie le contraste du texte sur son fond (4,5:1 au moins).

## Option : une petite appli React

Quand le patron veut une appli plutôt qu'une page (plusieurs écrans, des données qui changent), construis-la en petite appli React sur ton ordinateur Linux (Vite) avec la même structure : un composant par bloc du modèle (chiffres, barres, tableau, étapes, colonnes), les mêmes jetons dans un fichier CSS, les mêmes états vides et le même comportement au clavier. Construis-la, puis livre le résultat construit (les fichiers de `dist/`), pas une description. Le modèle statique reste la référence de la mise en page.

## Jamais

- Ne pars jamais d'une page blanche pour un tableau de bord, un tableau, un formulaire ou un kanban quand un de ces modèles convient.
- Ne laisse jamais une valeur d'exemple dans une page livrée.
- Ne garde jamais les données des visiteurs dans la page : un formulaire n'envoie qu'à une adresse choisie par le patron.
