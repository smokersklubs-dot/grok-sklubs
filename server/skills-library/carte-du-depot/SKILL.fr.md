---
name: Carte d'un dépôt de code
description: Avant de changer du code dans un dépôt que le bot ne connaît pas - lire son README et sa configuration, trouver comment l'installer, le lancer et le tester, lister ses dossiers principaux et ses points d'entrée, noter ses règles (guide de contribution, style, vérifications), et écrire une carte d'une page dans les notes du dépôt que la tâche suivante réutilise.
---

# Carte d'un dépôt de code

Compétence originale de Sklubot. Quelques minutes de lecture évitent des heures de mauvais changements.

## Lire, dans cet ordre

1. `README`, puis `CONTRIBUTING`, `AGENTS.md` ou des consignes du même genre, et la licence.
2. Le manifeste : `package.json` (scripts), `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `Dockerfile` — ils disent comment on construit, lance et teste.
3. Les fichiers d'intégration continue (`.github/workflows/`) : les vérifications qu'un changement doit passer.
4. L'arborescence sur deux niveaux (`git ls-files | cut -d/ -f1-2 | sort -u | head -100`), et la taille des plus gros fichiers.
5. Les points d'entrée : le fichier principal, les routes du serveur, les commandes en ligne.
6. L'historique récent : `git log --oneline -20` (ce qui bouge), et les tickets ouverts si la tâche en cite un.

## Écrire la carte (une page)

- **Ce que c'est**, en une phrase.
- **Comment** : installer, lancer, tester, vérifier (les commandes exactes du manifeste).
- **Dossiers** : une ligne pour chaque dossier important.
- **Points d'entrée** et où se trouve probablement la fonction de la tâche.
- **Règles** : style, vérifications, fichiers à ne pas toucher, façon d'écrire les commits et les pull requests.
- **Questions** : ce qui n'est pas clair, à demander au patron.

Enregistre-la sous `NOTES-CARTE.md` dans ton propre dossier de travail (pas dans le dépôt sauf si le patron le demande), avec le commit qu'elle décrit (`git rev-parse HEAD`). La fois suivante, relis-la et mets à jour seulement ce qui a changé depuis ce commit.

Lancer l'installation ou les tests peut télécharger des paquets : suis les commandes du dépôt lui-même ; tout le reste demande l'accord du patron.
