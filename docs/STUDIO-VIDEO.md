# Studio vidéo de Sklubot

Le studio est un produit de Sklubot disponible dans chaque compte. Une demande de création dans le chat peut appeler `video_studio_create`. Le menu **+ → Créer une vidéo** lance aussi le montage directement, y compris avec le modèle démo. Chaque projet est un artefact privé dans le bureau du bot choisi. Le panneau de droite peut conserver plusieurs créations ouvertes.

## Montage et rendu

Le montage conserve un titre, un format, des plans ordonnés, un style et une durée par plan, les références aux médias du bot ainsi qu’une bande-son avec décalage et sourdine. Le texte au format LRC sert à caler les changements de plan. Les pistes Image et Titres suivent les plans ; la musique a son propre départ. La version active peut être modifiée et enregistrée. Les autres versions restent consultables. Le lecteur et l’exporteur dessinent les mêmes images. Le navigateur encode la vidéo et la bande-son. Le fichier multimédia et l’archive des sources sont deux téléchargements distincts. Pour un nouveau moteur de rendu, partir du même format de montage et tester les images, les horodatages et le son.

## Points d’entrée pour la suite

- `server/src/videostudio.ts` valide la propriété des médias, les scènes et la version, puis écrit un artefact. Le point d’entrée du bot et celui de l’interface utilisent le même enregistrement.
- `web/src/lib/studioStory.ts` décrit les scènes, les repères LRC, les styles et le dessin des images. `StudioEditor.tsx` gère les pistes et les révisions. `StudioPlayback.tsx` synchronise l’image et la musique et encode le fichier.
- `WorkspaceDock.tsx` conserve les panneaux montés pendant le changement d’onglet. La lecture de pages publiques passe par `webreading.ts`. La connexion interactive à un site reprend le navigateur isolé du bot.
- `server/src/videoworkflows.ts` référence les sept sources avec leur révision. Le produit commun utilise une chronologie et un moteur de rendu écrits pour Sklubot. Les sept projets amont restent disponibles dans les bureaux Linux pour les traitements spécialisés.
- Pour étendre le montage à plusieurs couches vidéo superposées, commencer par des identifiants de piste et de clip, des points d’entrée et de sortie indépendants et une migration des projets existants. Ensuite seulement brancher les gestes de déplacement sur cette représentation.
- Avant de livrer une modification, essayer deux comptes neufs, l’ouverture depuis le chat, deux onglets avec une modification en cours, la sauvegarde et la relecture d’une ancienne version. Exporter un montage avec audio et vérifier les flux et leur durée avec ffprobe.
