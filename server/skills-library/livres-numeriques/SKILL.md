---
name: E-books (Calibre)
description: When the owner wants to turn a document into an e-book or convert one - install Calibre with approval, convert between EPUB, AZW3, PDF and DOCX with ebook-convert, set the title, author, language and cover with ebook-meta, check the result in a reader, and never touch a protected (DRM) book.
---

# E-books (Calibre)

Original Sklubot skill. Work on a copy: the owner's originals are never overwritten (write to a new folder `sortie/`). Show one result before doing a whole folder.

## Install (once, with the owner's approval)

Calibre is not on the bot's computer by default. Ask the owner, then install it from the system's packages: `sudo apt-get install -y calibre` (see « Trouver et installer un outil en ligne de commande »). Check with `ebook-convert --version`.

## Convert

- Word or Markdown to EPUB: `ebook-convert livre.docx sortie/livre.epub --title "Titre" --authors "Auteur" --language fr` (for Markdown, give `--input-encoding utf-8`; a heading per chapter makes a clean table of contents)
- EPUB to AZW3 (Kindle): `ebook-convert livre.epub sortie/livre.azw3`
- EPUB to PDF: `ebook-convert livre.epub sortie/livre.pdf --paper-size a5 --pdf-default-font-size 12`
- PDF to EPUB works badly on complex layouts: say so and check page by page.

## Metadata and cover

`ebook-meta sortie/livre.epub --title "Titre" --authors "Auteur" --language fr --cover couverture.jpg --isbn 978...` ; read them back with `ebook-meta sortie/livre.epub`. A cover around 1600×2560 px, JPEG.

## Check

Open the result (a reader on the computer, or `ebook-viewer`), go through the table of contents, a few chapters, pictures and footnotes; for EPUB meant for a store, the store's own checker decides. Screenshots of a few pages for the owner.

## Never

Never remove a protection (DRM) or convert a book the owner does not have the rights to; only their own texts or free books.
