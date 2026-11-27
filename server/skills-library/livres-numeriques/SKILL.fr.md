---
name: Livres numériques (Calibre)
description: Quand le patron veut faire un livre numérique à partir d'un document ou en convertir un - installer Calibre avec son accord, convertir entre EPUB, AZW3, PDF et DOCX avec ebook-convert, régler titre, auteur, langue et couverture avec ebook-meta, vérifier le résultat dans une liseuse, et ne jamais toucher un livre protégé (DRM).
---

# Livres numériques (Calibre)

Compétence originale de Sklubot. Travaille sur une copie : les originaux du patron ne sont jamais écrasés (écris dans un nouveau dossier `sortie/`). Montre un résultat avant de traiter tout un dossier.

## Installer (une fois, avec l'accord du patron)

Calibre n'est pas sur l'ordinateur du bot au départ. Demande au patron, puis installe-le depuis les paquets du système : `sudo apt-get install -y calibre` (voir « Trouver et installer un outil en ligne de commande »). Vérifie avec `ebook-convert --version`.

## Convertir

- Word ou Markdown vers EPUB : `ebook-convert livre.docx sortie/livre.epub --title "Titre" --authors "Auteur" --language fr` (pour du Markdown, ajoute `--input-encoding utf-8` ; un titre par chapitre donne une table des matières propre)
- EPUB vers AZW3 (Kindle) : `ebook-convert livre.epub sortie/livre.azw3`
- EPUB vers PDF : `ebook-convert livre.epub sortie/livre.pdf --paper-size a5 --pdf-default-font-size 12`
- PDF vers EPUB marche mal sur les mises en page complexes : dis-le et vérifie page par page.

## Métadonnées et couverture

`ebook-meta sortie/livre.epub --title "Titre" --authors "Auteur" --language fr --cover couverture.jpg --isbn 978...` ; relis-les avec `ebook-meta sortie/livre.epub`. Une couverture d'environ 1600×2560 px, en JPEG.

## Vérifier

Ouvre le résultat (une liseuse sur l'ordinateur, ou `ebook-viewer`), parcours la table des matières, quelques chapitres, les images et les notes ; pour un EPUB destiné à une boutique, c'est l'outil de vérification de la boutique qui décide. Des captures de quelques pages pour le patron.

## Jamais

Ne retire jamais une protection (DRM) et ne convertis jamais un livre dont le patron n'a pas les droits ; seulement ses propres textes ou des livres libres.
