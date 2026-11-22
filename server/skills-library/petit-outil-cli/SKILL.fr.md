---
name: Écrire un petit outil en ligne de commande
description: Quand une tâche répétée mérite un petit outil sur l'ordinateur du bot (renommer des fichiers, convertir un dossier, vérifier une liste) - une seule tâche, une aide, des options lisibles, un essai à blanc par défaut pour tout ce qui change des fichiers, des erreurs et des codes de sortie clairs, une sortie JSON pour les autres outils, et un test, rangé dans le dossier du bot.
---

# Écrire un petit outil en ligne de commande

Compétence originale de Sklubot. Pour une tâche que le patron redemande souvent, un petit outil est plus sûr que de retaper des commandes.

## La forme

- **Une seule tâche**, dite dans son nom (`renomme-photos`, `verifie-liens`). Python 3 (déjà sur l'ordinateur, bibliothèque standard d'abord) ou un script shell pour les choses très simples.
- **Une aide** : `--help` dit ce qu'il fait, chaque option et un exemple.
- **Des options lisibles** : des noms longs (`--dossier`, `--dry-run`), des valeurs par défaut sensées, aucun comportement caché.
- **L'essai à blanc d'abord** : tout ce qui change, déplace ou supprime des fichiers montre ce qu'il *ferait* tant que `--apply` n'est pas donné. N'écrase jamais sans le dire ; garde une copie ou déplace dans un dossier `corbeille/` au lieu de supprimer.
- **Des erreurs claires** : un message qui dit ce qui ne va pas et comment le corriger ; code de sortie 0 quand ça a marché, 1 pour une erreur de l'utilisateur, 2 pour le reste.
- **La sortie** : des lignes simples pour une personne ; `--json` pour un autre outil.
- **Aucun secret dans le code** : une clé vient d'une variable d'environnement réglée par le patron, jamais écrite dans le fichier ni affichée.

## Étapes

1. Écris la tâche, un exemple d'entrée et le résultat attendu.
2. Écris d'abord un test (un petit dossier d'exemples et la sortie attendue), puis l'outil ; vois le test échouer, puis passer (voir « Tests d'abord et débogage »).
3. Lance-le avec `--dry-run` sur le vrai dossier du patron et montre le résultat. Lance avec `--apply` seulement quand le patron est d'accord, s'il change ses fichiers.
4. Range l'outil dans `~/outils/` avec un README de deux lignes, et enregistre comment l'utiliser en compétence (skill_save) pour t'en servir pareil la prochaine fois.
