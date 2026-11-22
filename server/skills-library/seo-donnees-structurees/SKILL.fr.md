---
name: Données structurées et sitemap
description: Les couches techniques que lisent les moteurs sur le site d'une petite entreprise - des données structurées JSON-LD du bon type (commerce, produit, article, événement, recette…), vérifiées et n'affirmant jamais ce que la page ne montre pas ; un sitemap XML et le robots.txt ; les versions linguistiques avec hreflang ; et des images optimisées (texte de remplacement, poids, format, chargement différé).
---

> Adaptée de claude-seo « seo-schema », « seo-sitemap », « seo-hreflang » et « seo-images » avec leurs fiches sur les types de données (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : les scripts de l'extension remplacés par curl et Pillow sur l'ordinateur du bot et par les validateurs officiels ouverts dans le navigateur ; condensée ; traduite en français.

# Données structurées et sitemap

Les règles des moteurs sur ces points changent : avant de compter sur un type ou un résultat enrichi, vérifie sa page dans la documentation de recherche de Google (developers.google.com/search/docs/appearance/structured-data) et cite-la.

## 1. Données structurées (JSON-LD)

- **Repérer** : dans le HTML de la page (`curl -sL <adresse>`), trouve les blocs `<script type="application/ld+json">` ; note leurs types.
- **Choisir le bon type** selon ce qu'est vraiment la page : `LocalBusiness` ou un sous-type (`Restaurant`, `Bakery`, `HairSalon`, `Dentist`…), `Organization` sur l'accueil, `Product` avec `Offer` (prix, devise, disponibilité) sur une fiche produit, `Article` ou `BlogPosting` avec auteur et dates, `Event` avec dates et lieu, `Recipe`, `BreadcrumbList`, `VideoObject`, `JobPosting`.
- **Règles** : un bloc JSON-LD par entité, reliés par `@id` ; des valeurs identiques à ce qu'affiche la page (nom, prix, horaires, adresse) ; de vraies adresses absolues pour les images ; des dates au format ISO. Ne balise jamais des avis ou des notes qui ne sont pas affichés sur la page ou qui ont été copiés d'ailleurs.
- **Résultats enrichis retirés ou limités** (vérifie la liste actuelle avant de conseiller) : les résultats enrichis FAQ ne s'affichent plus dans les résultats Google (le balisage FAQPage peut rester mais n'apporte plus rien de visible) ; plusieurs anciens types ont été retirés (par exemple SpecialAnnouncement, CourseInfo, EstimatedSalary, VehicleListing). Ne recommande jamais un type retiré comme s'il allait s'afficher.
- **Vérifier** : ouvre dans ton navigateur le test des résultats enrichis de Google et le validateur de schema.org avec l'adresse ou le code ; corrige chaque erreur ; les avertissements sont listés pour le patron.
- Sur les pages Sklubot, ajoute ou corrige le bloc toi-même (page_edit) ; sur le site du patron, donne le code prêt à coller et l'endroit où le mettre.

## 2. Sitemap et robots.txt

- **Sitemap existant** : déclaré dans robots.txt (`Sitemap: https://…/sitemap.xml`) ; seulement des adresses canoniques, indexables, finales et qui répondent 200 (pas de redirections, pas de « noindex », https seulement) ; `<lastmod>` seulement quand le contenu a vraiment changé ; `<priority>` et `<changefreq>` sont ignorés par Google (sans danger, inutiles) ; un index de sitemaps au-delà de 50 000 adresses. Vérifie un échantillon d'adresses avec `curl -sI`.
- **Nouveau sitemap** : une entrée par vraie page ; des entrées d'images seulement pour les images importantes.
- **robots.txt** : ne bloque jamais les CSS, scripts ou images dont la page a besoin ; ne t'en sers pas pour cacher des pages privées (utilise une connexion ou « noindex »). Bloquer les robots qui entraînent des IA est un choix à part du patron, chaque robot nommé sur sa ligne ; cela ne retire pas le site de la recherche normale.

## 3. Versions linguistiques (hreflang)

Pour un site en français et en anglais (ou pour plusieurs pays) :
- chaque version cite **elle-même et toutes les autres** (liens de retour obligatoires), avec des codes ISO : `fr`, `en`, `fr-BE`, `en-GB` (pas `en-uk`, pas `eng`) ;
- un `x-default` pour la page de choix de langue ou la version principale ;
- hreflang seulement sur les adresses canoniques, toutes en https, identiques à la canonique (même barre finale) ;
- une seule méthode (balises dans l'en-tête, ou dans le sitemap pour les grands sites) ;
- des versions au même contenu, vraiment traduites (pas de traduction automatique sans relecture), avec prix, unités et coordonnées locaux.

## 4. Images

- **Texte de remplacement** sur chaque image qui informe, décrivant ce qu'elle montre (10 à 125 caractères), avec les mots utiles quand c'est naturel ; `alt=""` pour les images décoratives.
- **Poids et format** : juge le format réellement servi (`curl -sI` montre le type de contenu), pas l'extension du fichier ; WebP ou AVIF avec un repli JPEG par `<picture>` ; sur ton ordinateur, Pillow peut convertir et redimensionner (par exemple une photo de 2 000 px de large en WebP qualité 80).
- **Dimensions** : `width` et `height` sur chaque image (pas de saut de mise en page) ; `srcset` et `sizes` pour les images adaptatives.
- **Chargement** : `loading="lazy"` sous le premier écran, jamais sur l'image principale du premier écran (qui peut recevoir `fetchpriority="high"`).
- Des noms de fichiers parlants (`boulangerie-pain-au-levain.webp`, pas `IMG_2041.jpg`).
Ne propose jamais une nouvelle adresse d'image sans vérifier qu'elle répond 200.
