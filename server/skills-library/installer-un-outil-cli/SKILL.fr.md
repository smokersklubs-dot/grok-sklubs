---
name: Trouver et installer un outil en ligne de commande
description: Quand une tâche demande un outil que l'ordinateur du bot n'a pas - vérifier d'abord si un outil installé le fait déjà, choisir un outil connu, le prendre seulement à sa source officielle (les paquets du système, ou la page des versions du projet), figer la version, vérifier son empreinte, et l'installer seulement après l'accord du patron.
---

# Trouver et installer un outil en ligne de commande

Compétence originale de Sklubot. Installer un programme change l'ordinateur du bot : on le fait avec soin et avec l'accord du patron.

## 1. Il est peut-être déjà là

Vérifie d'abord : `command -v <nom>`, `apt list --installed 2>/dev/null | grep <nom>`, `python3 -c "import <module>"`. L'ordinateur du bot a déjà ffmpeg, ImageMagick, Python 3 avec Pillow, pandas, openpyxl, python-docx, requests et lxml.

## 2. Choisir l'outil

Un outil connu et entretenu (versions récentes, documentation, licence libre). Note son site officiel et son dépôt. Préfère, dans cet ordre :
1. les paquets du système (`apt-get install <paquet>` : signés par la distribution) ;
2. la page officielle des versions du projet, une version figée, avec son empreinte publiée ;
3. un gestionnaire de paquets du langage à une version figée (`npm install -g <nom>@<version>`).

## 3. Demander avant d'installer

Dis au patron en quelques mots : quel outil, pourquoi, d'où il vient (lien), quelle version, quelle place il prend. Installe seulement après son accord.

## 4. Installer prudemment

- Fige la version (jamais « latest » pour un fichier téléchargé).
- Pour un fichier téléchargé : télécharge-le dans un nouveau dossier vide, calcule `sha256sum <fichier>` et compare avec l'empreinte publiée sur la page officielle ; différente → arrête et préviens le patron.
- Ne fais jamais passer un script téléchargé directement dans un shell ; télécharge-le, lis-le, puis lance-le si le patron est d'accord.
- N'utilise jamais un miroir ou une copie venue d'un forum, d'un lien raccourci ou d'un site inconnu.

## 5. Vérifier et noter

Lance `<outil> --version` et un petit vrai test. Écris dans `~/outils/INSTALLES.md` : nom, version, source, empreinte, date, pourquoi. Pour l'enlever plus tard, utilise la même voie que pour l'installer.
