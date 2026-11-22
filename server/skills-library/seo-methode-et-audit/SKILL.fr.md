---
name: Référencement : méthode et audit
description: Auditer la visibilité dans les moteurs de recherche du site d'une petite entreprise ou d'une page - reconnaître le type d'activité, vérifier exploration, indexation, sécurité, adresses, affichage sur téléphone, vitesse, données structurées et contenu, puis donner un plan par priorités où chaque correction dit sur quoi elle repose et comment vérifier qu'elle a marché. Pas de note sans données.
---

> Adaptée de claude-seo « seo », « seo-audit », « seo-page » et « seo-technical » avec leurs seuils de qualité et leur fiche Core Web Vitals (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : scripts de l'extension, services de données payants et rapports PDF retirés ; contrôles faits avec web_fetch, le navigateur du bot et curl sur l'ordinateur du bot ; statistiques de tiers écartées ; règle « pas de note sans données » ajoutée ; condensée et traduite en français.

# Référencement : méthode et audit

## D'abord les règles

- **Pas de note sans données.** Ne donne un chiffre que s'il vient d'une mesure que tu as faite (un code de réponse, une taille, un test de vitesse). Sinon décris le constat et sa priorité. N'invente jamais de volumes de recherche, de positions ni de trafic.
- Les moteurs changent : avant de citer une règle ou un seuil, vérifie la documentation officielle (developers.google.com/search, consignes de Bing Webmaster) et cite-la.
- Chaque recommandation porte : **sur quoi elle repose** (le constat), **de quoi elle dépend** (d'autres corrections d'abord ?), **comment on saurait qu'elle a échoué**, et **un signe à surveiller** sans refaire l'audit.

## 1. Comprendre le site

Ouvre l'accueil (browser_open, page_read). Reconnais le type d'activité : **local** (adresse, téléphone, zone desservie, carte), **boutique** (produits, panier), **éditeur** (articles, auteurs), **services / agence** (réalisations), **logiciel**. Une activité locale reçoit aussi « SEO local » ; une boutique, « SEO des boutiques et comparatifs ».

## 2. Contrôles techniques (9 familles)

Utilise ton ordinateur pour ce que le texte lisible cache : `curl -sIL <adresse>` (code, redirections, en-têtes), `curl -sL <adresse>` puis cherche dans le HTML `<title>`, `name="description"`, `rel="canonical"`, `name="robots"`, `application/ld+json`, `hreflang`, `viewport`.

1. **Exploration** : /robots.txt existe et ne bloque rien d'important ; un sitemap existe et est déclaré ; les pages importantes à 3 clics au plus de l'accueil ; pas de « noindex » par erreur.
2. **Indexation** : chaque page a une balise canonique vers elle-même (ou la bonne page) ; pas de doublons (avec et sans www, http et https, paramètres) ; une langue par adresse.
3. **Sécurité** : HTTPS partout avec un certificat valide, http redirige vers https en un saut ; pas de contenu mixte.
4. **Adresses** : courtes, lisibles, avec des tirets ; pas de chaînes de redirections (un saut au plus, 301 pour un déménagement définitif).
5. **Téléphone** : balise viewport, lisible sans zoomer, pas de défilement de côté, zones à toucher assez grandes, le même contenu principal que sur ordinateur, pas de fenêtre qui couvre la page à l'arrivée.
6. **Vitesse (Core Web Vitals)** : le plus grand élément affiché en 2,5 s, réaction à un geste en 200 ms, décalage de mise en page sous 0,1 (pour 75 % des vraies visites). Mesure seulement avec un vrai outil (Lighthouse sur ton ordinateur s'il est installé, ou PageSpeed Insights ouvert dans le navigateur) ; sinon liste les causes visibles (images énormes, images sans dimensions, scripts lourds).
7. **Données structurées** : JSON-LD présent et valide pour le bon type (voir « Données structurées et sitemap »).
8. **JavaScript** : le texte principal et les liens sont dans le HTML reçu, pas seulement après l'exécution des scripts (compare `curl` et ce que montre le navigateur).
9. **Autres moteurs** : le site va bien aussi pour Bing (Bing Webmaster Tools ; IndexNow si le patron veut une indexation plus rapide là-bas).

## 3. Une page en détail

Titre (unique, environ 50 à 60 caractères, les mots principaux d'abord, la ville pour une activité locale) · description (environ 150 caractères, une raison de cliquer) · un seul H1 qui dit ce qu'est la page · titres dans l'ordre · un texte qui répond à la question du visiteur avec des détails vécus · images avec texte de remplacement, dimensions et formats modernes · liens internes aux mots clairs · contact ou action visible · données structurées conformes à ce qui est sur la page.

## 4. Seuils de qualité du contenu

- Chaque page répond à **qui** l'a écrite, **comment** (expérience vécue, vraies photos, vrais chiffres), **pourquoi** (aider le visiteur, pas attraper des clics).
- Pas de pages maigres ni de quasi-copies : beaucoup de pages « ville » qui ne changent que le nom de la ville sont un risque ; au-delà d'une trentaine, chacune doit avoir un vrai contenu local, et au-delà de cinquante, demande au patron de justifier chacune.
- Pas de texte caché, pas de bourrage de mots-clés.

## 5. Le plan

Classe les constats : **critique** (bloque l'indexation ou casse une page : maintenant) · **élevé** (nuit nettement : cette semaine) · **moyen** (occasion : ce mois-ci) · **bas** (plus tard). Pour chacun : le constat, la preuve (code, extrait, capture), la correction en mots simples, qui la fait (toi sur les pages Sklubot avec page_edit ; sinon le patron ou son prestataire web), la vérification. Livre-le en page privée ou en fichier, les gains rapides d'abord. Propose « Surveillance SEO » pour garder une référence et repérer les reculs.
