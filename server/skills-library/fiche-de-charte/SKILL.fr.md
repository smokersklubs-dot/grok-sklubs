---
name: Fiche de charte (design)
description: Décrire une allure existante avec des mots et des valeurs exactes - à partir d'une page ou d'une capture montrée par le patron, ou des fichiers sources de son site - ambiance, couleurs avec un nom parlant, un code hexadécimal et un rôle, typographie, formes, profondeur, mise en page - et l'enregistrer comme partie « Allure » de la charte pour que chaque page suivante la respecte.
---

> Adaptée de google-labs-code/stitch-skills « design-md » et « extract-design-md » (© 2026 Google LLC, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : le serveur de l'outil de design d'origine, les recherches de projets et les notes de génération retirés ; l'analyse part d'une page ouverte dans le navigateur du bot, d'une capture ou des fichiers sources d'un site (lus, jamais lancés) ; le résultat va dans la charte Sklubot ; traduite en français.

# Fiche de charte (design)

Une description qu'un graphiste, un imprimeur ou un autre bot peut suivre : des mots pour l'ambiance, des valeurs exactes pour la précision, et le rôle de chaque valeur.

## Les sources (seulement ce que le patron a le droit d'utiliser)

- **Son propre site ou son appli** : ouvre-le (browser_open), regarde (screen_view en largeur téléphone et ordinateur), lis les styles (page_source quand c'est une page que tu as publiée ; sinon la page visible et ce que montre le navigateur).
- **Ses fichiers sources** (un dossier partagé, un dépôt) : lis-les, ne les installe ni ne les lance jamais. Regarde le fichier de thème ou de variables, les styles globaux, puis quelques composants (bouton, carte, menu, formulaire).
- **Une capture ou un document imprimé** qu'il envoie.

Ne décris jamais l'allure d'une autre entreprise pour la copier.

## Ce qu'il faut écrire

1. **Ambiance** : deux ou trois adjectifs précis (« aérée, chaleureuse, calme »), la densité (beaucoup d'espace ou compacte), des neutres chauds ou froids ; puis une ou deux phrases qui résument l'impression.
2. **Couleurs par rôle**, chacune sous la forme *nom parlant (#hex) — rôle* :
   - fond et surfaces ;
   - accent et éléments cliquables (boutons, liens, état actif) ;
   - texte : principal, secondaire, discret ;
   - états : succès, erreur, alerte, information.
   Note le contraste du texte principal et de l'accent sur leur fond (au moins 4,5:1 pour du texte) ; quand l'accent est trop pâle pour du texte, dis qu'il sert seulement aux aplats.
3. **Typographie** : familles de polices (et une solution gratuite de repli), graisses des titres et du texte, tailles du plus grand titre aux petites mentions, espacement des lettres, interligne.
4. **Les formes en mots** : « coins carrés nets », « légèrement arrondis (6 px) », « boutons en forme de pilule » ; bordures fines ou absentes.
5. **Profondeur** : à plat, ombres très douces, ou ombres marquées ; comment les couches se distinguent.
6. **Composants** : boutons (forme, couleurs, survol), cartes, menu, champs de formulaire, une ligne chacun.
7. **Mise en page** : marges, largeur maximale, grille, espace entre les sections, ce qui change en largeur téléphone.
8. **Logo et images** : où sont les fichiers du logo (seulement ceux que le patron a donnés) ; le style des photos (vraies photos, illustrations, lumière, cadrage).

## Où ça va

Écris-la comme partie **Allure** de la charte : ~/team/charte.md (voir « Entretien de marque »), ou marque/allure.md dans ta bibliothèque s'il n'y a pas encore de charte. Montre-la au patron et demande-lui de la corriger ; ensuite « Design de marque » et chaque page utilisent ces valeurs exactes.
