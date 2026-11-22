---
name: Site en plusieurs passes
description: Construire un vrai site de plusieurs pages (« un site de 4 pages pour ma boutique ») plutôt que des pages isolées - un fichier du site avec identité, allure, plan du site coché et liste de tâches par priorité ; puis une page par passe, chacune lisant le fichier du site et la charte, partageant le même menu et le même pied de page, cochant sa ligne et écrivant le cahier de la page suivante.
---

> Adaptée de google-labs-code/stitch-skills « site-md » et « stitch-loop » (© 2026 Google LLC, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : la méthode du relais est gardée ; la génération de l'outil de design d'origine, ses fichiers de projet et son serveur local sont remplacés par les pages Sklubot (page_publish, page_edit), le navigateur du bot pour vérifier et la charte ; traduite en français.

# Site en plusieurs passes

Quatre pages faites une par une sans plan donnent quatre inconnues. Un site a une identité, un menu, un pied de page, et une liste de ce qui est fait et de ce qui reste.

## 1. Le fichier du site (une fois)

Enregistre sites/<nom>/site.md (file_save) :

```
# Site : <nom>
## Identité
Nom · Mission (1 ou 2 phrases) · Public · Ton (3 mots)
## Allure
Mots d'ambiance, et « voir ~/team/charte.md » (ou la partie « Allure » de la charte)
## Parties communes
Menu : <liens dans l'ordre> · Pied de page : adresse, horaires, téléphone, mentions légales, confidentialité
Noms des pages : site-<nom>-accueil, site-<nom>-carte… (un nom page_publish par page)
## Plan du site
- [ ] Accueil — <adresse une fois publiée>
- [ ] <Page 2>
## À faire (par priorité)
Haute : pages principales et parcours principal du client (trouver, choisir, contacter ou commander)
Moyenne : formulaires, pages secondaires
Basse : bonus, illustrations, états facultatifs
## Idées libres
Pages ou touches qui iraient bien si la liste est vide
```

Fais-le valider par le patron (ask_user avec ta réponse conseillée quand un choix reste ouvert).

## 2. Une page par passe

À chaque passe :
1. **Lis** site.md, la charte et le cahier de cette page (page-suivante.md ; voir « Préciser une demande de page » pour son format). Ne refais jamais une page déjà cochée.
2. **Construis** la page avec le menu et le pied de page communs, les mêmes styles (un fichier de styles commun joint à chaque page) et seulement du vrai contenu.
3. **Publie-la** (page_publish, privée tant que le patron ne dit pas autre chose) sous son nom prévu.
4. **Relie-la** : mets son adresse dans le menu des pages déjà publiées (page_edit sur chacune), et remplace tout lien « # » qui devait y mener.
5. **Vérifie-la** dans ton navigateur (browser_open, screen_view) en largeur téléphone et ordinateur, et parcours le menu depuis une autre page.
6. **Mets à jour** site.md : coche la page avec son adresse, retire l'idée utilisée, mets à jour la liste.
7. **Écris le cahier suivant** dans page-suivante.md : la prochaine page de la liste (ou une idée libre), avec son bloc d'allure et ses sections numérotées.

Dis à chaque passe quelle page est faite et laquelle vient ensuite. Pour un grand site, propose le mode objectif (goal_propose) avec « chaque ligne du plan du site cochée » comme ligne d'arrivée.

## 3. Finir

Quand le plan est entièrement coché, applique « Vérifier avant de livrer » à tout le site (chaque lien, téléphone, adresse, mentions légales, largeur téléphone, clair et sombre). Le rendre public (visibilité « link »), c'est la décision du patron, par la carte d'accord.
