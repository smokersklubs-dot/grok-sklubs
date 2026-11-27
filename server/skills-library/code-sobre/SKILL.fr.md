---
name: Code sobre
description: Pour les bots qui écrivent du code (un petit outil, un script de page, une automatisation, une correction dans un dépôt) - le plus petit changement complet : réutiliser l'existant, pas de fonctions ni de couches non demandées, ne jamais rogner la sécurité, un petit test pour la logique risquée, un raccourci signalé quand une limite est connue, et une ligne finale sur ce qui a été laissé de côté ou pas vérifié.
---

> Adaptée de DietrichGebert/ponytail, compétence principale (© 2026 DietrichGebert, MIT). Modifiée pour Sklubot (22/11/2026) : le personnage, les niveaux de session et les commandes retirés ; écrite comme une règle de travail pour les bots Sklubot qui codent sur leur ordinateur ou dans un dépôt ; le nom du produit d'origine n'est pas utilisé ; traduite en français.

# Code sobre

Le meilleur code est celui qu'on n'a pas eu à écrire. Règle tout le problème avec le moins de code nouveau possible, et termine par ce que tu as laissé de côté.

## Avant d'écrire

Lis la tâche et le code qu'elle touche. Liste chaque endroit que le changement doit atteindre : appelants, tests, données de test, configuration, exports. Vérifie ce qu'il pourrait casser : des données détruites ou exposées, des appelants qui ne marchent plus. C'est ça le périmètre ; les fonctions en plus n'en font pas partie.

## Le plus petit changement complet

Prends la première option qui marche entièrement :
1. **Faut-il que ça existe ?** Laisse de côté les options et la souplesse que personne n'a demandées, et nomme-les en une ligne. Une demande vague reçoit la plus petite version qui fait l'essentiel.
2. **Déjà dans le projet** (une fonction utilitaire, un composant, une façon de faire) ? Utilise-le comme le fait le code voisin.
3. **Bibliothèque standard ou fonction de la plateforme ?** Utilise-la, sauf si le projet a la sienne.
4. **Une dépendance déjà installée ?** Utilise-la. N'ajoute jamais une dépendance pour quelques lignes.
5. **Une ligne qu'un lecteur comprend d'un coup d'œil ?** Une ligne.
6. Sinon, le minimum de code qui marche.

- Sois paresseux sur la solution, jamais sur la finition : mets à jour chaque appelant, test et donnée de test que ton changement touche.
- Pas d'abstraction, d'enveloppe, d'option, de configuration ni de code « pour plus tard » que personne n'a demandé. Supprimer vaut mieux qu'ajouter. Garde la structure et les conventions du projet.
- Ne commente que le pourquoi que le code ne peut pas montrer, en une ligne.
- Correction de bogue : trouve d'abord chaque appelant de la fonction, puis corrige la cause une seule fois dans le code commun.
- Le code que tu déplaces garde sa gestion d'erreurs et ses validations.
- Entre deux options de même taille, prends celle qui est juste dans les cas limites.
- Une nouvelle logique non triviale (une condition, une boucle, un analyseur, de l'argent, de la sécurité, un nouveau script) laisse **un petit test** ou une auto-vérification. Les changements triviaux n'en demandent pas.
- Une limite connue reçoit un commentaire : `shortcut: <la limite>, <quand faire mieux>`.

**Ne jamais rogner** : la validation des données venues de l'extérieur, la gestion d'erreurs qui évite une perte de données, la sécurité, l'accessibilité, tout ce que le patron a demandé.

## Quand discuter

Si le patron le préfère, nomme l'option plus petite en une ligne et laisse-le choisir ; quand une partie de la demande n'est pas justifiée par le besoin, dis-le avant de construire.

## À la fin de chaque réponse

Une ou deux lignes : ce que tu as laissé de côté ou pas vérifié, et tout risque que le patron doit connaître. Lance ensuite les contrôles du projet (tests, vérification des types) et donne le résultat honnêtement.
