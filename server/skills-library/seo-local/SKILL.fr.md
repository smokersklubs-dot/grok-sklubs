---
name: SEO local
description: Rendre une activité locale (boutique, restaurant, artisan, cabinet) facile à trouver près de chez soi - sa fiche d'établissement Google, le même nom, la même adresse et le même téléphone partout, des avis et des réponses honnêtes, des pages locales et des données structurées, des liens locaux - avec une liste priorisée de gains rapides, d'efforts moyens et de grands chantiers.
---

> Adaptée de claude-seo « seo-local » et de ses fiches sur les données locales et la fiche d'établissement (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : services de données payants, API de cartes et statistiques de tiers retirés ; modifications de la fiche laissées au patron ou faites seulement avec son accord ; règles sur les avis gardées ; condensée et traduite en français.

# SEO local

## 1. Quel type d'activité locale

- **Boutique avec comptoir** (les clients viennent) : l'adresse est affichée partout.
- **Zone d'intervention** (tu vas chez les clients : plombier, ménage) : l'adresse peut être masquée sur la fiche ; liste les communes desservies.
- **Les deux**.
Note le métier (restaurant, santé, juridique, services à domicile, immobilier, garage…) : certains ont leurs règles (santé : ne jamais confirmer dans une réponse que l'auteur de l'avis est un patient).

## 2. La fiche d'établissement (Google, et aussi Apple et Bing)

Vérifie avec le patron, ou dans le navigateur quand il te donne accès (ne demande jamais son mot de passe ; utilise un identifiant du coffre ou demande-lui de prendre la main) :
- la **catégorie principale** exacte et quelques catégories secondaires pertinentes ;
- le nom exactement comme sur la devanture (sans mots-clés ajoutés : interdit) ;
- horaires (et horaires des jours fériés) justes ; téléphone ; adresse du site vers la bonne page ;
- une description écrite pour les clients ; services ou produits listés avec les mots des clients ;
- de vraies photos récentes (devanture, intérieur, équipe, réalisations) ; des posts réguliers pour les nouveautés et les offres ;
- les questions fréquentes traitées sur le site et dans la description.
Chaque modification de la fiche est publiée au nom du patron : prépare-la et demande son accord.

## 3. Nom, adresse, téléphone : identiques partout

Compare nom, adresse et téléphone sur le site (visibles dans le HTML, dans le pied de page et la page contact), la fiche, les pages des réseaux, les annuaires (Pages Jaunes, Yelp, TripAdvisor, annuaires du métier, chambre de commerce). Une seule orthographe, un seul téléphone, un seul format d'adresse. Liste chaque différence avec où la corriger.

## 4. Les avis

- Combien, récents ou non, la moyenne, sur quels sites ; les réponses du patron.
- Aide le patron à demander un avis à **chaque** client (un lien court, une carte au comptoir). **Jamais** de tri avant (« content ? laissez un avis ; pas content ? écrivez-nous ») : c'est interdit par les plateformes et par le droit de la consommation. N'écris jamais et n'achète jamais d'avis.
- Prépare des réponses pour le patron : remercier par le prénom, répondre au point soulevé, proposer une solution en privé pour une réclamation, aucun détail personnel. Le patron valide avant toute publication.

## 5. Le site

- Titre et H1 avec le service et la ville ; nom, adresse et téléphone cliquable (lien `tel:`) visibles ; horaires ; une carte (chargée en différé) ; une action de contact ou de réservation en haut de page.
- Une page par service principal ; pour plusieurs boutiques, une page par boutique avec un vrai contenu local (équipe, accès, stationnement, quartier, photos), jamais des copies où seule la ville change.
- **Données structurées** : `LocalBusiness` ou le bon sous-type (`Restaurant`, `Bakery`, `Dentist`, `Plumber`…) avec nom, adresse, téléphone, horaires, coordonnées géographiques, adresse du site, image, gamme de prix ; un `@id` unique par boutique ; `aggregateRating` seulement pour des avis recueillis sur le site lui-même, jamais recopiés de Google.

## 6. Liens et mentions locaux

Presse locale, associations et clubs soutenus, fournisseurs et partenaires, événements du coin, fédérations du métier, annuaire des entreprises de la mairie. La qualité et la pertinence plutôt que le nombre.

## 7. Le résultat

Trois listes : **gains rapides** (un après-midi : corriger le téléphone sur le site, ajouter les horaires, les catégories), **efforts moyens** (quelques semaines : pages de services, habitude de demander des avis), **grands chantiers** (des mois : contenu local, liens). Chaque point avec sa preuve et comment le vérifier. Propose une routine mensuelle pour suivre les avis et la fiche (routine_create montre une carte au patron).
