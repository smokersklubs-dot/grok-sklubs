---
name: Visite guidée vidéo d'un site
description: Transformer les pages d'un site ou d'une appli en courte vidéo de visite - capturer chaque écran dans le navigateur du bot, les ordonner comme une histoire, une diapo par écran avec des zooms doux, des transitions et des titres courts, produire un MP4 (horizontal ou vertical) sur l'ordinateur du bot, et vérifier images, durée et lisibilité avant de livrer.
---

> Adaptée de google-labs-code/stitch-skills « remotion » avec sa liste de contrôle de composition (© 2026 Google LLC, Apache License 2.0). Modifiée pour Sklubot (22/11/2026) : les écrans viennent du navigateur du bot au lieu de l'outil de design d'origine, le rendu passe par le studio vidéo de Sklubot, ffmpeg ou l'atelier d'animation figé déjà proposé par Sklubot, les modèles de composants React retirés, traduite en français.

# Visite guidée vidéo d'un site

Une vidéo d'une minute qui montre un site ou une appli comme un visiteur le parcourt : utile pour annoncer un lancement, présenter à un client ou faire un court format sur les réseaux.

## 1. Capturer les écrans

1. Mettez-vous d'accord sur le parcours à montrer (accueil, l'offre, commander, contact) et sur le format : **horizontal 16:9** pour une présentation, **vertical 9:16** pour Reels, Shorts et TikTok.
2. Ouvre chaque page dans ton navigateur (browser_open) à la bonne largeur (ordinateur pour le 16:9, téléphone pour le 9:16), attends qu'elle soit entièrement chargée, et fais une capture (screen_view, ou une capture de toute la page quand il faut la faire défiler).
3. Enregistre les images avec des noms clairs dans l'ordre (visite/01-accueil.png, visite/02-carte.png…) et note pour chacune : ce qu'elle montre, le point à mettre en valeur, combien de temps elle reste.

Ne capture que les pages du patron, ou des pages qu'il a le droit de montrer, et jamais un écran qui affiche des données personnelles de clients.

## 2. Écrire l'histoire

Une diapo par écran, 3 à 6 secondes chacune, 30 à 75 secondes en tout :
- un titre court sur chaque diapo (5 mots au plus), assez grand pour se lire sur téléphone ;
- un seul point mis en valeur par écran (un zoom doux vers lui, ou un léger cadre autour) ;
- les deux premières secondes montrent l'écran le plus frappant ou le résultat ;
- la dernière diapo : le nom, l'adresse du site et une action.

## 3. Produire

Choisis le moyen le plus simple qui donne le résultat :
- **Le studio vidéo de Sklubot** (video_studio_create, puis video_studio_render) : les images comme plans, les titres, musique et voix facultatives.
- **ffmpeg sur ton ordinateur** (shell_run) : chaque image avec un zoom lent (`zoompan`), des fondus enchaînés (`xfade`), des titres (`drawtext`), en H.264 + AAC dans un MP4.
- **L'atelier d'animation figé** (video_workflow « remotion ») quand le patron veut un motion design plus riche.

Transitions : fondu, glissement ou zoom, courts et calmes ; pas de coupes brutales.

## 4. Vérifier avant de livrer

- Produis la vidéo, puis vérifie le fichier avec ffprobe : durée, largeur et hauteur (1920 × 1080 ou 1080 × 1920), son s'il y en a.
- Regarde des images au début, au milieu et à la fin (video_frames ou ffmpeg) : texte lisible à chaque instant, contraste suffisant, rien d'étiré ni de coupé, titres dans la zone sûre (pas dans les 10 % du haut ni les 20 % du bas pour une vidéo verticale, où les applis mettent leurs boutons).
- Chaque diapo reste assez longtemps pour lire son titre ; l'ensemble n'est ni précipité ni trop long.
- Le poids du fichier est raisonnable pour l'envoyer.

Livre le MP4 depuis ta bibliothèque (file_send) avec sa durée et son format. Pour le publier sur les réseaux, utilise « Contenus par réseau » : rien n'est publié sans le oui du patron.
