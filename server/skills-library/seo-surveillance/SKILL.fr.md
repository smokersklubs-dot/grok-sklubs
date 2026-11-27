---
name: Surveillance SEO
description: Garder une photo de référence des éléments SEO des pages clés d'un site (titre, description, canonique, robots, titres, données structurées, balises sociales, code de réponse, empreinte du contenu) et la comparer après chaque changement ou chaque semaine dans une routine, en signalant les reculs par gravité - critique, alerte, information - avec la correction.
---

> Adaptée de claude-seo « seo-drift » et de ses règles de comparaison (© 2026 agricidaniel, MIT). Modifiée pour Sklubot (22/11/2026) : la base de données et les scripts de l'extension remplacés par une photo JSON dans la bibliothèque de fichiers du bot et curl sur l'ordinateur du bot ; les 17 règles condensées ; fonctionne dans une routine Sklubot acceptée par le patron ; traduite en français.

# Surveillance SEO

Un site perd souvent de la visibilité à cause d'un changement passé inaperçu : un « noindex » oublié après une refonte, un titre supprimé, des données structurées disparues. Une photo de référence l'attrape dans la semaine.

## 1. La photo de référence

Avec le patron, liste les pages clés (accueil, principaux services ou produits, contact ; 5 à 20 adresses). Pour chacune, sur ton ordinateur :
- `curl -sIL <adresse>` : code de réponse final et redirections ;
- `curl -sL <adresse>` : dans le HTML, le `<title>`, la méta description, `rel="canonical"`, la méta robots, chaque H1, les H2, les blocs JSON-LD, les balises `og:` ;
- une empreinte du texte principal (`sha256sum` du texte visible) et des données structurées.
Enregistre le tout dans surveillance/<site>/reference-<date>.json (file_save), avec la date. Si une mesure de vitesse est disponible (Lighthouse installé), ajoute-la ; sinon laisse-la de côté, ne l'estime jamais.

## 2. Comparer

Refais la même photo et compare page par page.

**Critique** (agir maintenant) :
- des données structurées qui existaient ont disparu ;
- la canonique a changé ou a été retirée ;
- un « noindex » a été ajouté ;
- le H1 ou le titre a été supprimé ;
- le code est maintenant une erreur (4xx, 5xx) ou une redirection qui n'existait pas.

**Alerte** (regarder cette semaine) :
- le titre ou la méta description a changé ; le premier H1 a beaucoup changé (plus de la moitié) ;
- le contenu des données structurées a été modifié ; les balises sociales (`og:`) ont disparu ;
- la structure des H2 a changé ; la vitesse est nettement moins bonne (quand elle est mesurée : plus de 20 %).

**Information** : de nouvelles données structurées ajoutées ; le texte principal a changé (normal après une mise à jour, bon à savoir).

Pour chaque différence : la page, avant et après (texte exact), la gravité, la cause probable (refonte, mise à jour d'un module, nouveau constructeur de pages) et la correction. Un changement voulu par le patron devient la nouvelle référence une fois qu'il l'a confirmé.

## 3. En routine

Propose une routine hebdomadaire (routine_create ; le patron voit une carte et accepte) : refaire la photo, comparer avec la référence, ne rien écrire dans le chat quand rien n'a changé (stay_quiet), et ne signaler que les différences, les critiques d'abord. Lance aussi une comparaison juste après toute refonte ou mise à jour du site.

Garde l'historique (un fichier par comparaison) pour pouvoir répondre « depuis quand ? » quand le trafic baisse.
