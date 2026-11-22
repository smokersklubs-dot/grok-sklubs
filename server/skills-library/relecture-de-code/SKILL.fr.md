---
name: Relecture de code
description: Relire un changement de code comme celui qu'on appelle quand ça casse - lire le diff et le code autour, couvrir chaque fichier modifié, chercher dans l'ordre bogues, risques, montée en charge, tests manquants, lenteurs et code en trop, ne garder que les constats avec un cas concret, expliquer chacun en mots simples, et signaler les changements de comportement.
---

> Adaptée de DietrichGebert/ponytail « ponytail-review » (© 2026 DietrichGebert, MIT) et alibaba/open-code-review « open-code-review-delegate » (© 2026 alibaba/open-code-review Contributors, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : réunies ; l'outil de relecture en ligne de commande et son service de règles retirés, commandes git simples gardées ; écrite pour les bots Sklubot qui relisent sur leur ordinateur ou le travail d'un coéquipier ; les noms des produits d'origine ne servent pas de titres ; traduite en français.

# Relecture de code

Ordre d'importance : **juste, sûr, tient la charge, testé, rapide, sobre**. C'est un rapport demandé par le patron : donne-le en entier, et ne change aucun code sauf si on te demande de corriger.

## 1. Quoi relire

Ce que le patron désigne : changements non validés, une branche, un commit, une demande de fusion, des fichiers. Rien de désigné : les changements non validés, ou le dernier commit.

Obtiens des diffs simples (sans couleur, sans outil de diff externe) :
- commit : `git --no-pager show --no-ext-diff --no-textconv --no-color <commit> -- "<chemin>"`
- branche : `git --no-pager diff --no-ext-diff --no-textconv --no-color <base-commune>..<branche> -- "<chemin>"` (base commune avec `git merge-base main <branche>`)
- non validé : `git --no-pager diff --no-ext-diff --no-textconv --no-color HEAD -- "<chemin>"`, et lis en entier les nouveaux fichiers non suivis.
Pour un gros diff, écris-le dans un fichier hors du dépôt et lis-le par morceaux.

Fais une **liste de chaque fichier modifié** et marque chacun « relu » ou « sauté » avec une raison. Ne t'arrête pas au premier constat grave.

## 2. Comprendre d'abord

Lis le diff, puis le code qu'il touche : les appelants de chaque fonction modifiée, ce qu'elle appelle, les tests, le README. Suis le vrai trajet : d'où viennent les données, ce qui est enregistré, ce qui sort. Quand une signature, une valeur de retour ou un comportement change, cherche chaque appelant. Trouve la charge attendue (une personne qui lance un script, ou beaucoup d'utilisateurs en même temps) et dis laquelle tu as supposée.

## 3. Chercher, dans cet ordre

1. **Bogue** : mauvais résultat, plantage, cas limite oublié (vide, zéro, dernier élément, arrondi, fuseaux horaires), un appelant cassé par le changement, une correction faite chez un appelant alors que la fonction commune reste fausse.
2. **Risque** : failles de sécurité (injection, hasard faible, secrets dans le code, données non vérifiées), perte de données (erreurs avalées, écritures dans le mauvais ordre, pas de transaction).
3. **Charge** : bien pour un, faux pour beaucoup : vérifier-puis-écrire en concurrence, listes ou mémoire qui ne font que grossir, une requête par élément, un travail quadratique sur de grandes données.
4. **Test manquant** : une logique nouvelle risquée ou une correction de bogue sans test qui échoue quand ça casse. Un bon test, pas de la couverture.
5. **Vitesse** : les gros ralentissements sont des problèmes ; les petits gains sont des suggestions.
6. **Sobriété** : code mort, options inutilisées, une fonction que le projet a déjà (nomme-la), la bibliothèque standard le fait déjà, une abstraction utilisée une fois, des quasi-copies qui doivent changer ensemble.

## 4. Vérifier avant de rapporter

Chaque constat a besoin d'un **cas concret** : « cette entrée donne ce mauvais résultat ». Pas de cas, pas de constat. Relis les lignes pour confirmer (l'appelant existe, la valeur peut être vide). Un commentaire `shortcut:` qui nomme sa limite est une décision, pas un constat, sauf si la charge la dépasse déjà. Propose la plus petite correction ; préfère celles qui suppriment du code. Pas de goûts personnels, pas de « on pourrait envisager » flou.

## 5. Le rapport

Des mots très simples, chaque terme technique expliqué la première fois.
- **Ce que fait ce changement** : deux ou trois phrases.
- **Changements de comportement**, même voulus : quel usage, avant, après, où.
- Constats numérotés à travers les groupes (pour que le patron puisse dire « corrige 2 et 5 ») : **à corriger** (bogue, sécurité, perte de données, casse à la charge attendue) · **à améliorer** (code risqué sans test, vraie lenteur, doublons) · **en bonus**. Chacun avec : ce qu'est ce code, le problème, la correction, ce qui arrive si on ne fait rien, et l'emplacement (fichier et lignes).
- **Couverture** : fichiers modifiés, relus, sautés (avec raisons).
- `Verdict : on peut livrer.` ou `Verdict : corriger 1 et 3 d'abord.` et `Pas vérifié :` une ligne si quelque chose comptait.

Si on te demande de corriger : applique les points « à corriger », décris les autres, puis lance les tests du projet et donne le résultat.
