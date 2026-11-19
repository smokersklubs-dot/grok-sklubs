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

## Techniques d’animation et guides des auteurs

Demande par exemple « Crée une vidéo de 15 secondes, ouvre sur un collage rétro et termine par un dessin au trait ». Le bot peut choisir une technique par plan. Dans le Studio, la technique est enregistrée avec le montage. Les effets utilisent le moteur de Sklubot et se règlent dans le même projet que les médias et les pistes audio.

Pour consulter la méthode d’un auteur, demande par exemple « Lis le guide LottieFiles sur le rythme et donne-moi sa source ». Le bot peut lire le fichier original par pages avec `video_workflow({id:"motion-timing",source_page:1})`. Chaque page indique la révision via son lien, la licence et le numéro de page suivant lorsqu’il existe. La lecture fonctionne également sur les bureaux sans Linux. Le serveur contrôle l’empreinte Git du fichier à la première lecture et conserve le résultat en mémoire pour les demandes suivantes.

| Technique | Identifiant du plan | Guide amont à la révision vérifiée | Licence du dépôt |
| --- | --- | --- | --- |
| Collage rétro | `retro-collage` | [LunaAI519/motion-skill](https://github.com/LunaAI519/motion-skill/blob/947825034fd38cd3e607ffdd981e86c760152966/SKILL.md) | [MIT](https://github.com/LunaAI519/motion-skill/blob/947825034fd38cd3e607ffdd981e86c760152966/LICENSE) |
| Tracé dessiné | `drawn-stroke` | [ToBeWin/HandDraw-Skill](https://github.com/ToBeWin/HandDraw-Skill/blob/d9f137b6072afdb3e3480ca6e47cb1a0362504bb/SKILL.md) | [MIT](https://github.com/ToBeWin/HandDraw-Skill/blob/d9f137b6072afdb3e3480ca6e47cb1a0362504bb/LICENSE) |
| Géométrie mathématique | `math-geometry` | [awesome-skills/manim-skill](https://github.com/awesome-skills/manim-skill/blob/f8479fa475aace157f12a161519e4bb497a35fbf/SKILL.md) | [MIT](https://github.com/awesome-skills/manim-skill/blob/f8479fa475aace157f12a161519e4bb497a35fbf/LICENSE) |
| Illustration procédurale | `procedural-illustration` | [cloveric/claude-drawing-skill](https://github.com/cloveric/claude-drawing-skill/blob/6af36dc717b63d6ddafb54d2eaa120cacd99ab4d/SKILL.md) | [MIT](https://github.com/cloveric/claude-drawing-skill/blob/6af36dc717b63d6ddafb54d2eaa120cacd99ab4d/LICENSE) |
| Typographie cinétique | `motion-timing` | [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill/blob/d77a9fc8cb371cab1ba5420df5bfd232cd14c9bb/skills/motion-design/SKILL.md) | [MIT](https://github.com/LottieFiles/motion-design-skill/blob/d77a9fc8cb371cab1ba5420df5bfd232cd14c9bb/LICENSE) |
| Flux de particules | `canvas-animation` | [iart-ai/javascript-animation-skills](https://github.com/iart-ai/javascript-animation-skills/blob/060f7467a6e5ae5b57c90c9cb1b3508c13b88e49/skills/javascript-animation/SKILL.md) | [MIT](https://github.com/iart-ai/javascript-animation-skills/blob/060f7467a6e5ae5b57c90c9cb1b3508c13b88e49/LICENSE) |
| Personnage expressif | `expressive-character` | [JohnHeibel/ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase/blob/0ac8bf2b31942376cb6b8c4074715595d512acd2/ANIMATION_GUIDE.md) | [MIT](https://github.com/JohnHeibel/ClaudeAnimationBase/blob/0ac8bf2b31942376cb6b8c4074715595d512acd2/LICENSE) |
| Peinture en mouvement | `moving-paint` | [alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion/blob/a97c45018d46e950d56d61981138e08f4e092909/SKILL.md) | [MIT](https://github.com/alchaincyf/huashu-art-motion/blob/a97c45018d46e950d56d61981138e08f4e092909/LICENSE) |
| Doodle accéléré | `doodle-timelapse` | [alexgreensh/anidoodle](https://github.com/alexgreensh/anidoodle/blob/4ae27d2c281fcfd01bce87ab13dc5ad4df81a795/skills/anidoodle/SKILL.md) | [Apache-2.0](https://github.com/alexgreensh/anidoodle/blob/4ae27d2c281fcfd01bce87ab13dc5ad4df81a795/LICENSE) |

Les neuf entrées et leurs fichiers de licence ont été vérifiés sur GitHub le 19 novembre 2026. Le dépôt Manim contient un guide principal. Celui de JohnHeibel s’appelle `ANIMATION_GUIDE.md`. iart propose également un guide de bande-son. Anidoodle fournit un fichier de mentions d’attribution. [Guide de bande-son iart](https://github.com/iart-ai/javascript-animation-skills/blob/060f7467a6e5ae5b57c90c9cb1b3508c13b88e49/skills/soundtrack/SKILL.md) · [Mentions Anidoodle](https://github.com/alexgreensh/anidoodle/blob/4ae27d2c281fcfd01bce87ab13dc5ad4df81a795/NOTICE)

Le guide de LunaAI décrit des services tiers de génération d’images et de vidéos. Consulter le guide ouvre exclusivement son texte. Créer un collage dans le Studio utilise le moteur local de Sklubot.

## Naviguer pendant le montage

Dans le chat, **+ → Naviguer sur le web** ouvre un onglet indépendant du bureau. Saisir des mots lance une recherche avec les fournisseurs déjà disponibles pour le bot. Une adresse ouvre directement le lecteur. Un clic sur une source citée dans le chat ouvre cette source dans un nouvel onglet du panneau. Les flèches permettent de retrouver les résultats ou une page lue.

**Applis connectées** ouvre les connecteurs du compte. **Se connecter à un site** reprend l’adresse en cours et ouvre le navigateur interactif du bot pour que le propriétaire s’identifie. Les onglets Web et les versions du montage restent accessibles au retour.

## Points d’entrée pour la suite

- `server/src/videostudio.ts` valide la propriété des médias, les scènes et la version, puis écrit un artefact. Le point d’entrée du bot et celui de l’interface utilisent le même enregistrement.
- `web/src/lib/studioStory.ts` décrit les scènes, les repères LRC, les styles et le dessin des images. `StudioEditor.tsx` gère les pistes et les révisions. `StudioPlayback.tsx` synchronise l’image et la musique et encode le fichier.
- `WorkspaceDock.tsx` conserve les panneaux montés pendant le changement d’onglet. La lecture de pages publiques passe par `webreading.ts`. La connexion interactive à un site reprend le navigateur isolé du bot.
- `server/src/videoworkflows.ts` propose neuf techniques natives et conserve les huit ateliers spécialisés historiques pour les bureaux Linux. `server/src/animationreferences.ts` associe chaque technique à la révision, au guide et à la licence de son auteur.
- `scripts/test-studio-export.py` vérifie le résultat du rendu sur des pixels et des fréquences connus. Il s’exécute depuis la racine dans un conteneur jetable de l’image `sklubot-desktop`.
- Avant de livrer une modification, essayer deux comptes neufs, l’ouverture depuis le chat, deux onglets avec une modification en cours, la sauvegarde et la relecture d’une ancienne version. Exporter un montage avec audio et vérifier les flux et leur durée avec ffprobe.
