---
name: Modèles de pages
description: Des structures éprouvées pour les pages les plus demandées - tableau de bord, rapport financier ou d'activité, cahier des charges produit, compte rendu de réunion, suivi d'objectifs (OKR), procédure d'exploitation, tableau de tâches, page de documentation, page de tarifs, page d'accueil, facture, page tenue à jour - chacune avec ses parties, ses graphiques et sa vérification, à construire avec page_publish.
---

> modeles-de-pages — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot (modifié pour Sklubot) : les structures de treize modèles de design d'OpenDesign ont été condensées en une liste de recettes pour les pages Sklubot ; les « chiffres inventés crédibles » ont été remplacés par de vraies données ou « à compléter » ; les balises d'artefact, identifiants de commentaires et la visionneuse d'OpenDesign ont été retirés ; traduit en français.

# Modèles de pages

Un modèle est le squelette d'une page qui marche ; tu apportes le vrai contenu et l'allure (la marque du compte, ou un des « Styles de base »). Construis la page selon « Pages soignées » (bac à sable, fichiers, clair/sombre, publier en privé, vérifier, partager) et vérifie-la avec « Règles de métier du design ». Pour des diapositives, utilise « Présentations (diapositives) ».

**Règles pour tous les modèles**
- Un seul fichier HTML autonome (CSS dans la page, ou un `style.css` à côté) ; des zones sémantiques (`header`, `nav`, `aside`, `main`, `section`, `footer`) ; CSS Grid pour la mise en page, Flexbox dans les blocs.
- **Uniquement de vraies données** : les chiffres de l'utilisateur, ses fichiers, ses outils connectés ou des sources citées. Une valeur manquante s'affiche « à compléter », jamais inventée. Mets les données dans la page ou dans un fichier `.json` à côté (`fetch('donnees.json')`), jamais appelées depuis une API extérieure.
- Couleur d'accent deux fois au plus par écran. Graphiques : SVG dans la page ou bibliothèque épinglée depuis un CDN autorisé ; chaque série a un libellé et une légende ; l'infobulle montre la valeur exacte.
- Doit marcher de 360 px à 1440 px : les colonnes latérales deviennent un menu en haut, les tableaux défilent dans leur propre cadre.

## Tableau de bord (administration, statistiques, ventes, exploitation)
- Colonne de gauche 220–260 px (nom, 6 à 8 liens, l'entrée active en accent) — ou une barre en haut pour les petites pages ; barre du haut avec titre, période et heure de dernière mise à jour.
- Ligne 1 : 3 à 4 cartes de chiffres clés (libellé, grand nombre, évolution par rapport à la période précédente avec le sens et le %). Ligne 2 : un graphique principal (courbe ou barres, 2/3 ou pleine largeur). Ligne 3 : un second graphique ou un tableau (derniers événements, meilleurs éléments).
- Vérifier : colonne et barre restent en place, la zone principale défile ; la densité suit le style (aéré ou serré) ; la date des données est écrite.

## Rapport financier ou d'activité
- En-tête : entité, période, mention « Confidentiel » si c'est le cas. 4 chiffres clés (par ex. chiffre d'affaires, nouveau net, marge, trésorerie en mois). Graphique d'évolution, répartition des coûts avec une légende de 2 à 3 lignes, tableau de synthèse (période en cours / précédente), principaux clients ou projets, paragraphe de perspectives, auteur et date.
- Vérifier : chaque chiffre apparaît dans un graphique ou un tableau légendé ; chaque évolution montre son sens et son % ; sources en bas.

## Point hebdomadaire
- En-tête (équipe, semaine, auteur). Le titre : une phrase + le seul chiffre qui compte cette semaine. Livré (3 à 5), en cours (3 à 5 avec responsables), bloqué (1 à 3 avec une demande claire), 1 à 2 graphiques d'indicateurs, demandes pour la semaine prochaine avec des noms. En présentation, un bloc par diapositive.

## Cahier des charges produit
- Bandeau : titre, statut (Brouillon / En relecture / Validé), date, responsable. Résumé en trois lignes : quoi, pour qui, pourquoi maintenant. Problème (un paragraphe + une vraie citation s'il y en a une). Objectifs et hors-objectifs sur deux colonnes. Tableau des indicateurs de réussite (indicateur, cible, mesure). Récits d'utilisateurs (« en tant que… je veux… pour… »). Jalons (3 à 4 phases). Questions ouvertes avec qui répond. Journal des décisions.

## Compte rendu de réunion
- Titre, date, heure, lieu ou lien d'appel, participants. Ordre du jour (4 à 6 points, cochés une fois traités). **Décisions** dans un bloc bien visible. Tableau des actions : action, responsable, échéance, état. Questions ouvertes et prochaine réunion.
- N'écris que ce qui a été dit ou décidé ; marque « à confirmer » ce qui est incertain.

## Suivi d'objectifs (OKR)
- Bandeau : trimestre, dates, avancement global. 3 cartes d'objectif : titre, responsable, état (En bonne voie / À risque / En retard — avec un mot, pas seulement une couleur), 3 résultats clés chacune (indicateur, actuel → cible, barre de progression). Colonne latérale : chiffres clés, plus fortes évolutions, blocages.

## Procédure d'exploitation (runbook)
- En-tête : service, équipe responsable, niveau de gravité, version. Résumé + dépendances. Tableau des alertes (nom, gravité, signification, premier geste). Tableaux de bord et liens. 3 à 4 procédures avec blocs de code (déployer, revenir en arrière, changer une clé — jamais un vrai secret). Tableau d'astreinte. Liste d'incident en 5 étapes numérotées.

## Tableau de tâches (kanban)
- Barre du haut : projet, sprint, filtres, recherche. 4 colonnes (À faire, En cours, En relecture, Fait) avec leur nombre ; cartes avec étiquette, titre, responsable, estimation. Panneau latéral : avancement du sprint, éléments bloqués. Une page ne peut pas enregistrer : elle montre le tableau ; les changements passent par toi ou par le vrai outil.

## Page de documentation
- Trois colonnes : navigation (240–280 px, groupes de liens, page en cours marquée), article (environ 720 px max : titre, chapeau, parties H2, blocs de code, notes et avertissements, tableaux), sommaire « Sur cette page » (200–240 px) avec une ancre sur chaque H2/H3.
- Sous 900 px le sommaire disparaît et la navigation passe en haut. Utilise le CSS logique (`margin-inline-start`, `text-align: start`) pour qu'une langue écrite de droite à gauche s'inverse correctement.

## Page de tarifs
- Ouverture (titre, une ligne, bascule mensuel/annuel facultative), une carte par offre (nom, prix dans la police des titres, une ligne de positionnement, 4 à 6 points, un bouton ; l'offre conseillée signalée une seule fois), un tableau comparatif en 2 ou 3 groupes avec en-tête fixe, une FAQ en `<details>`, un appel à l'action final.
- 3 offres par défaut (2 pour particulier/pro, 4 pour « entreprise plus »). De vrais prix et de vraies fonctions donnés par l'utilisateur, jamais « X € / mois ».

## Page d'accueil (landing)
- Ouverture (nom, titre, sous-titre de 1 à 2 phrases, bouton principal et secondaire), 3 à 6 fonctions (icône au trait, titre, 1 à 2 phrases), preuves (seulement de vrais clients ou de vraies citations, sinon pas de partie), tarifs si demandés, appel à l'action final, petit pied de page.
- Varie au moins une partie pour éviter l'air de gabarit ; vérifie en 1440, 768 et 375 px.

## Facture ou devis
- Bandeau : émetteur, « Facture » + numéro + date + échéance. De / À. Référence et conditions de paiement. Lignes (désignation, quantité, prix unitaire, montant), totaux alignés à droite (sous-total, TVA, total dû), instructions de paiement, mention. Un style d'impression (`@media print`) sans fonds. Les chiffres et mentions légales viennent de l'utilisateur ; tu ne l'envoies jamais toi-même sans son accord.

## Page tenue à jour (rapport vivant)
- Quand l'utilisateur veut une page tenue à jour : mets les données dans un `donnees.json` à côté du HTML et construis la page à partir de lui, avec l'heure de la dernière mise à jour et la source visibles.
- Pour rafraîchir : récupère les nouvelles données (outils connectés, web, fichiers), puis change seulement `donnees.json` avec `page_edit` (`file`), pour garder la mise en page et les modifications faites à la main. Dis ce qui a changé depuis la dernière fois. Si un rythme régulier est voulu, mets-le en place avec l'accord de l'utilisateur.
