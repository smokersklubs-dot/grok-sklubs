---
name: Retoucher des images (Pillow, ImageMagick)
description: Le travail courant sur les images, sur l'ordinateur du bot, avec ImageMagick et Pillow pour Python (tous deux installés) - redimensionner, recadrer à un format, compresser pour le web, convertir (WebP, JPEG, PNG), retirer la position GPS, ajouter un filigrane, faire une planche contact - sur des copies, vérifié en regardant le résultat.
---

# Retoucher des images (Pillow, ImageMagick)

Compétence originale de Sklubot. Travaille sur une copie : les originaux du patron ne sont jamais écrasés (écris dans un nouveau dossier `sortie/`). Montre un résultat avant de traiter tout un dossier.

## ImageMagick (en ligne de commande : `magick`, ou `convert` sur les anciennes versions)

- Redimensionner à 1600 px de large au plus, en gardant les proportions : `magick in.jpg -resize '1600x>' out.jpg`
- Recadrer en carré depuis le centre : `magick in.jpg -gravity center -crop 1:1 +repage out.jpg` (ImageMagick 7 ; sinon calcule la taille avec `identify`)
- Formats des réseaux : 1080×1080 (carré), 1080×1350 (portrait), 1080×1920 (story) : `magick in.jpg -resize 1080x1350^ -gravity center -extent 1080x1350 out.jpg`
- Compresser pour le web : `magick in.jpg -strip -quality 82 -sampling-factor 4:2:0 out.jpg` ; WebP : `magick in.jpg -quality 80 out.webp`
- Retirer la position et les données de l'appareil : `-strip` (toujours pour une image qui sera publiée)
- Filigrane en bas à droite : `magick in.jpg \( logo.png -resize 15% \) -gravity southeast -geometry +24+24 -composite out.jpg`
- Tout un dossier : `mkdir -p sortie && for f in *.jpg; do magick "$f" -resize '1600x>' -strip -quality 82 "sortie/$f"; done`
- Planche contact : `magick montage *.jpg -tile 4x -geometry 300x300+8+8 planche.jpg`

## Pillow (Python), quand il y a une logique (un modèle de nom, une règle par image)

```python
from PIL import Image, ImageOps
from pathlib import Path
out = Path("sortie"); out.mkdir(exist_ok=True)
for p in Path(".").glob("*.jpg"):
    im = ImageOps.exif_transpose(Image.open(p))   # dans le bon sens
    im.thumbnail((1600, 1600))                     # garde les proportions
    im.save(out / p.name, quality=82, optimize=True)  # sans données EXIF
```

## Vérifier

Regarde un résultat (screen_view ou ouvre-le), compare les tailles avant et après (`du -h`), et vérifie qu'un recadrage ne coupe ni visage ni texte. Photos de personnes : seulement avec leur accord pour une publication.
