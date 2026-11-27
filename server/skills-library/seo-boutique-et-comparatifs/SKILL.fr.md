---
name: SEO des boutiques et pages comparatives
description: Le référencement des boutiques en ligne et des pages de décision - des fiches produits qui se positionnent (titre, description, images, caractéristiques, texte unique, données structurées Product), des pages de catégorie, l'écart entre ce qu'attendent les chercheurs et ce qu'est la page, et des pages « X ou Y » ou « alternatives » prudentes qui n'affirment jamais rien d'invérifié sur un concurrent.
---

> Adaptée de claude-seo « seo-ecommerce », « seo-sxo » et « seo-competitor-pages » (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : services payants de données des places de marché et des comparateurs retirés ; garde-fou juridique sur les affirmations concernant les concurrents rendu obligatoire ; contrôles avec curl et le navigateur du bot ; condensée ; traduite en français.

# SEO des boutiques et pages comparatives

## 1. Les fiches produits

- **Titre** : nom du produit, une caractéristique clé, la marque ; moins d'environ 60 caractères (« Tablier en lin, dos croisé, naturel | Atelier Mila »).
- **Description** : le produit et un bénéfice, le prix ou « à partir de … » s'il est stable, une action (livraison offerte, commander) ; moins d'environ 155 caractères.
- **Titres** : un seul H1 avec le nom du produit (pas répété sur les variantes) ; puis caractéristiques, détails techniques, avis, produits liés.
- **Images** : au moins trois (principale, détail, en situation), de vraies photos, textes de remplacement et noms de fichiers parlants, WebP avec repli JPEG, chargement différé seulement sous le premier écran.
- **Texte** : une description unique écrite pour le client (jamais le copier-coller du fabricant), un tableau des caractéristiques, livraison et retours en faits simples, de vrais avis clients s'il y en a.
- **Liens** : fil d'Ariane (Accueil > Catégorie > Produit), retour à la catégorie, produits liés.
- **Données structurées** : `Product` avec `Offer` (prix, devise, disponibilité, état), `brand`, `sku` ou `gtin` s'ils sont connus, `image` ; `aggregateRating` et `review` seulement pour des avis affichés sur la page ; `BreadcrumbList`. Vérifie avec le test des résultats enrichis.
- **Variantes et stock** : une adresse canonique par produit, les variantes en options ou avec une canonique ; les pages en rupture gardées avec la disponibilité et des alternatives, pas supprimées.
- **Pages de catégorie** : une courte introduction unique, des filtres qui ne créent pas d'adresses indexables à l'infini (canonique ou noindex sur les combinaisons), une pagination avec de vrais liens.

## 2. La page correspond-elle à ce qu'attendent les chercheurs ?

Pour la recherche principale d'une page, regarde les premiers résultats (search_web ou le navigateur) : quel **type** de page domine (fiches produits, comparatifs, guides, résultats locaux, outils) ?
- Un guide là où les gens attendent des fiches produits → fais une fiche ou une page de catégorie.
- Une fiche produit là où les gens attendent de l'information → ajoute une courte partie pédagogique (comment choisir, tailles, entretien).
- Une page de service là où les résultats sont locaux → ajoute la ville, la carte, les données structurées locales.
Puis compare avec les premiers résultats : profondeur, action claire visible sans défiler, affichage sur téléphone, données structurées, images et vidéo, preuves (avis, garanties, diplômes), fraîcheur. Imagine deux ou trois vrais clients (l'acheteur pressé, le comparateur prudent, celui qui cherche un cadeau) et vérifie que la page répond à la première question de chacun. Décris les écarts et les corrections ; pas de note sans mesure.

## 3. Pages comparatives et « alternatives » (avec prudence)

Des pages comme « notre gâteau ou le gâteau de supermarché », « X ou Y : lequel choisir », « alternatives à X ».
- **Chaque affirmation sur un concurrent doit être vraie, à jour et vérifiable dans une source publique** (son site, ses prix publiés, sa documentation), citée avec un lien et la date de vérification. Pas de supposition, pas de « sans doute », pas d'adjectifs dénigrants. En cas de doute, laisse de côté.
- Compare sur des critères qui comptent pour le client, dans un tableau clair ; dis honnêtement où le concurrent est meilleur ; date la page et revois-la quand les prix changent.
- N'utilise jamais le logo d'un concurrent et ne laisse pas croire à un partenariat. Un nom de marque ne peut apparaître que pour identifier le produit comparé.
- Formes de titre : « X ou Y : [différence principale] ([année]) », « Alternatives à X pour [usage] ».
- Données structurées : `ItemList` pour une liste ; `Product` seulement pour tes propres produits.
- Avant publication, montre au patron la liste des affirmations sur les concurrents avec leurs sources : les règles de la publicité comparative s'appliquent, et c'est sa décision. Ce n'est pas un conseil juridique ; pour une comparaison sensible, propose de vérifier avec un professionnel.
