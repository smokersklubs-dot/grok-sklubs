# Studio vidéo de Sklubot

Le studio est un produit de Sklubot disponible dans chaque compte. Une demande de création dans le chat peut appeler `video_studio_create`. Le menu **+ → Créer une vidéo** lance aussi le montage directement, y compris avec le modèle démo. Chaque projet est un artefact privé dans le bureau du bot choisi. Le panneau de droite peut conserver plusieurs créations ouvertes.

## Montage et rendu

Chaque image, clip et bande-son importés peut peser jusqu’à 1 Go. Les aperçus envoyés au modèle sont indépendants des médias utilisés pour le rendu.

Le montage conserve un titre, un format, des plans ordonnés, un style et une durée par plan, les références aux médias du bot ainsi qu’une bande-son avec décalage et sourdine. Le texte au format LRC sert à caler les changements de plan. Les pistes Image et Titres suivent les plans ; la musique a son propre départ. La version active peut être modifiée et enregistrée. Les autres versions restent consultables. Le lecteur et l’exporteur dessinent les mêmes images. Le navigateur encode la vidéo et la bande-son. Le fichier multimédia et l’archive des sources sont deux téléchargements distincts. Pour un nouveau moteur de rendu, partir du même format de montage et tester les images, les horodatages et le son.

Dans **Réplique de ce plan**, indique l’intervenant et son texte. Tu peux produire une prise avec une voix Piper disponible, importer un enregistrement ou le choisir dans le dossier audio de ce bot. Le montage regroupe les prises par intervenant. **Solo** isole sa piste à l’écoute. L’export mixe toutes les prises avec la bande-son. Une prise commence au début du plan et se termine au plus tard à sa fin. Pour corriger une phrase, refais sa prise et enregistre la version.

Dans **Pistes libres**, importe un clip ou réutilise un média du projet. Le début du clip règle sa position sur le montage. L’entrée et la sortie choisissent le passage du fichier source. Place plusieurs voix au même instant pour les mixer. Les couches visuelles ont chacune une position, une échelle, une opacité et un ordre de superposition. **Scinder à la tête de lecture** coupe une piste en deux segments modifiables. Si une piste dépasse le dernier plan, son image reste à l’écran jusqu’à la fin du montage.

Un montage accepte 60 plans, 48 clips indépendants et 5 minutes. Chaque import et chaque MP4 serveur peut atteindre 1 Go sous réserve du stockage disponible. Les exports MP4 demandés au bureau Linux entrent dans une file persistante. Tu peux fermer le panneau et retrouver le rendu en rouvrant la même version. Après un redémarrage du serveur, un travail interrompu recommence depuis le début avec cette version. Le fichier terminé arrive dans la conversation d’origine. Un export en échec peut être relancé depuis le Studio.

## Créer un Reel depuis la conversation

« Fais-moi un Reel de quinze secondes sur la germination avec une voix off en français » demande au bot d’écrire le script, de créer les plans verticaux dans le studio, puis de livrer le film dans le chat. Pour modifier le film, corriger le montage et exporter sa nouvelle version. Depuis le studio, **Créer le MP4** exporte la version enregistrée et **Lire les titres en voix off** ajoute une narration.

Sur les bureaux Linux, le rendu utilise le moteur local de MoneyPrinterTurbo. Chromium dessine les images avec le même code que l’aperçu. Le moteur assemble les plans en H.264 avec une piste AAC. Il reprend les fichiers du bot, les légendes, la durée, le décalage et la sourdine de la bande-son. La voix française ou anglaise est synthétisée par le service Piper local quand il est disponible. Le film est livré dans la bibliothèque du bot et dans sa conversation. La publication sur les réseaux sociaux est une action distincte. [Source du moteur et licence MIT](https://github.com/harry0703/MoneyPrinterTurbo/tree/92e0f9a55b91e353565015aab74b7c50cc28f148)

## Naviguer pendant le montage

Dans le chat, **+ → Naviguer sur le web** ouvre un onglet indépendant du bureau. Saisir des mots lance une recherche avec les fournisseurs déjà disponibles pour le bot. Une adresse ouvre directement le lecteur. Un clic sur une source citée dans le chat ouvre cette source dans un nouvel onglet du panneau. Les flèches permettent de retrouver les résultats ou une page lue.

**Applis connectées** ouvre les connecteurs du compte. **Se connecter à un site** reprend l’adresse en cours et ouvre le navigateur interactif du bot pour que le propriétaire s’identifie. Les onglets Web et les versions du montage restent accessibles au retour.

## Points d’entrée pour la suite

- `server/src/videostudio.ts` valide la propriété des médias, les scènes et la version, puis écrit un artefact. Le point d’entrée du bot et celui de l’interface utilisent le même enregistrement.
- `web/src/lib/studioStory.ts` décrit les scènes, les repères LRC, les styles et le dessin des images. `StudioEditor.tsx` gère les pistes et les révisions. `StudioPlayback.tsx` synchronise l’image et la musique et encode le fichier.
- `WorkspaceDock.tsx` conserve les panneaux montés pendant le changement d’onglet. La lecture de pages publiques passe par `webreading.ts`. La connexion interactive à un site reprend le navigateur isolé du bot.
- `server/src/videoworkflows.ts` référence les huit sources avec leur révision. Le produit commun utilise une chronologie et un moteur de rendu écrits pour Sklubot. Les huit projets amont restent disponibles dans les bureaux Linux pour les traitements spécialisés.
- `scripts/test-studio-export.py` vérifie le résultat du rendu sur des pixels et des fréquences connus. Il s’exécute depuis la racine dans un conteneur jetable de l’image `sklubot-desktop`.
- Avant de livrer une modification, essayer deux comptes neufs, l’ouverture depuis le chat, deux onglets avec une modification en cours, la sauvegarde et la relecture d’une ancienne version. Exporter un montage avec audio et vérifier les flux et leur durée avec ffprobe.
