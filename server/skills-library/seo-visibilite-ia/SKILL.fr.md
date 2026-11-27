---
name: Visibilité dans les réponses des IA
description: Aider une petite entreprise à apparaître et à être citée dans les réponses des moteurs à IA et à être utilisable par des agents IA - d'abord les fondamentaux (c'est toujours du référencement), des blocs de réponse citables, une identité claire et des informations cohérentes, quels robots peuvent lire le site, un contenu rendu côté serveur, une structure de page accessible aux agents - et un rapport honnête sans note inventée.
---

> Adaptée de claude-seo « seo-geo » et « seo-agentic » (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : services de données payants, outils d'analyse tiers et statistiques retirés ; contrôles faits avec curl, web_fetch et le navigateur du bot ; affirmations gardées seulement quand l'original cite une source primaire ; condensée ; traduite en français.

# Visibilité dans les réponses des IA

## Partir de la source primaire

La position de Google (documentation Search Central sur les fonctions d'IA) : optimiser pour la recherche par IA, c'est optimiser pour la recherche, donc **c'est toujours du référencement**. Beaucoup d'astuces à la mode (fichiers spéciaux pour les IA, découper le texte en morceaux, réécrire pour les IA, acheter des mentions) ne sont pas des leviers documentés. Quand un blog contredit la documentation des moteurs eux-mêmes, suis la documentation et dis-le. Vérifie les pages actuelles avant de les citer.

Ne donne jamais de « note de visibilité » pour une plateforme d'IA que tu n'as pas mesurée avec un vrai outil. Décris plutôt les constats et les priorités.

## 1. Un contenu qu'on peut citer

- Chaque question importante a un intertitre formulé comme la question et, juste dessous, une **réponse autonome** de quelques phrases avec un fait précis (un prix, un délai, un lieu, un chiffre donné par le patron).
- Des définitions sous forme simple (« Un pain au levain est… »).
- Des affirmations attribuées à une source nommée ; des détails vécus que seule l'entreprise possède (ses données, ses photos, ses cas).
- Des titres dans l'ordre, des paragraphes courts, des tableaux pour comparer, des listes pour les étapes.
- Du texte avec de vraies images et, si possible, une vidéo avec sa transcription.

## 2. Une identité claire et cohérente

- L'entreprise décrite de la même façon partout : nom, activité, lieu, depuis quand, qui la dirige (site, fiche d'établissement, pages des réseaux, annuaires, presse).
- Une page « À propos » avec de vraies personnes, un bloc de données structurées `Organization` ou `LocalBusiness` avec des liens `sameAs` vers les profils officiels.
- Les mentions dans des lieux de confiance (presse locale, organisations du métier, forums sérieux) comptent ; ne les fabrique jamais.

## 3. Qui peut lire le site

Lis `/robots.txt` (`curl -s https://<site>/robots.txt`) et dis, robot par robot, ce qui est permis. Explique la différence, que le patron tranche :
- les robots de **recherche et de citation** (ils font apparaître le site dans les réponses avec un lien) ;
- les robots d'**entraînement** (ils utilisent les textes pour entraîner des modèles ; les bloquer ne retire pas le site de la recherche).
Un robots.txt qui répond par une erreur serveur peut être lu comme « tout est bloqué » : vérifie son code de réponse. `llms.txt` peut être signalé présent ou absent, mais ce n'est pas un levier de citation connu : n'en promets aucun résultat.

## 4. Utilisable par des agents

Les agents IA lisent de plus en plus les pages et cliquent pour les gens (réserver, comparer, commander) :
- le contenu principal et les liens sont dans le HTML reçu (compare `curl -sL` et le navigateur), pas seulement dessinés par des scripts ;
- les boutons et les champs ont de vrais noms et de vraies étiquettes (vérifie avec element_snapshot : un agent voit ce que voit un lecteur d'écran) ;
- les formulaires marchent au clavier, sans piège caché ; prix et disponibilités sont en texte, pas seulement dans des images ;
- aucun mur ne bloque les visiteurs normaux (ne teste le blocage des robots que si le patron contrôle le site et l'accepte).

## 5. Le rapport

Parties : ce que dit la documentation des moteurs · contenu citable trouvé et manquant · cohérence de l'identité (différences à corriger) · accès des robots (chacun, son état, le choix du patron) · utilisabilité par des agents · recommandations, chacune avec sa preuve et sa vérification. Les gains rapides d'abord ; changements du robots.txt ou choix de blocage seulement sur décision du patron.
