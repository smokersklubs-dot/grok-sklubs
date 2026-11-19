---
name: studio-animation
description: Créer ou réviser un film animé dans le Studio vidéo de Sklubot en choisissant la technique de chaque plan.
---

Pour une demande de création, utilise `video_studio_create`. Pour une explication ou un avis sur une vidéo, réponds dans la discussion. Dans un projet existant, lis `studio.json` avec `page_source` puis envoie à `video_studio_update` le nom et la version lus. Si tu modifies les plans, envoie la liste ordonnée complète et conserve les médias, les prises de voix et les repères des plans que la personne veut garder.

Chaque plan conserve son champ `style`. Ajoute `technique` au plan à animer. Choisis le mouvement qui sert le sujet.

| Effet recherché | Valeur de technique |
| --- | --- |
| Papier découpé et mouvement par à-coups | `retro-collage` |
| Illustration qui se construit trait par trait | `drawn-stroke` |
| Construction géométrique animée | `math-geometry` |
| Motifs illustrés composés par le dessin | `procedural-illustration` |
| Entrées et mouvements rythmés | `motion-timing` |
| Scène dessinée et animée sur le canevas | `canvas-animation` |
| Personnage dont l’expression change | `expressive-character` |
| Tableau animé par couches | `moving-paint` |
| Croquis qui apparaît en accéléré | `doodle-timelapse` |

Pour animer une photo du client, utilise son fichier déjà présent dans `uploads/` comme `media`. Pour une démonstration scientifique, vérifie que les formes visibles illustrent réellement l’argument. Une construction spécifique peut nécessiter un schéma fourni par l’utilisateur. Place le commentaire dans `text` et laisse les pistes de voix et de musique au minutage prévu. Si la personne demande un MP4, utilise `video_studio_render` sur la version enregistrée. Vérifie que le fichier livré s’ouvre et que le mouvement et le son correspondent au montage.
