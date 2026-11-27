---
name: Retouch pictures (Pillow, ImageMagick)
description: Everyday picture work on the bot's computer with ImageMagick and Python Pillow (both installed) - resize, crop to a format, compress for the web, convert (WebP, JPEG, PNG), strip location data, add a watermark, make a contact sheet - on copies, checked by looking at the result.
---

# Retouch pictures (Pillow, ImageMagick)

Original Sklubot skill. Work on a copy: the owner's originals are never overwritten (write to a new folder `sortie/`). Show one result before doing a whole folder.

## ImageMagick (command line: `magick`, or `convert` on older versions)

- Resize to 1600 px wide max, keep proportions: `magick in.jpg -resize '1600x>' out.jpg`
- Crop to a square from the centre: `magick in.jpg -gravity center -crop 1:1 +repage out.jpg` (ImageMagick 7; else compute the size with `identify`)
- Formats for networks: 1080×1080 (square), 1080×1350 (portrait), 1080×1920 (story): `magick in.jpg -resize 1080x1350^ -gravity center -extent 1080x1350 out.jpg`
- Compress for the web: `magick in.jpg -strip -quality 82 -sampling-factor 4:2:0 out.jpg`; WebP: `magick in.jpg -quality 80 out.webp`
- Remove location and camera data: `-strip` (always for pictures that will be published)
- Watermark at the bottom right: `magick in.jpg \( logo.png -resize 15% \) -gravity southeast -geometry +24+24 -composite out.jpg`
- A whole folder: `mkdir -p sortie && for f in *.jpg; do magick "$f" -resize '1600x>' -strip -quality 82 "sortie/$f"; done`
- Contact sheet: `magick montage *.jpg -tile 4x -geometry 300x300+8+8 planche.jpg`

## Pillow (Python), when there is logic (a name pattern, a rule per picture)

```python
from PIL import Image, ImageOps
from pathlib import Path
out = Path("sortie"); out.mkdir(exist_ok=True)
for p in Path(".").glob("*.jpg"):
    im = ImageOps.exif_transpose(Image.open(p))   # right way up
    im.thumbnail((1600, 1600))                     # keeps proportions
    im.save(out / p.name, quality=82, optimize=True)  # no EXIF kept
```

## Check

Look at one result (screen_view or open it), compare sizes before and after (`du -h`), and check that faces and text are not cut by a crop. Pictures of people: only with their agreement for publication.
