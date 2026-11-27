---
name: Sous-titres
description: Ajouter des sous-titres à une vidéo pour les réseaux - obtenir une transcription (les sous-titres de la vidéo, un service de reconnaissance vocale choisi par le patron, ou un texte validé), la corriger et la caler en fichier SRT, traduire si demandé, l'incruster dans l'image ou la garder en fichier séparé avec ffmpeg, et vérifier une image d'aperçu avant le rendu final.
---

> Adaptée de CLI-Anything « cli-anything-videocaptioner » (© 2026 HKUDS CLI-Anything Team, Apache License 2.0) : sa méthode transcrire, corriger, traduire, incruster et relire avant d'incruster. Modifiée pour Sklubot (22/11/2026) : l'outil Python et ses services tiers gratuits de reconnaissance vocale et de traduction retirés ; les transcriptions viennent des outils transcribe et de réunion de Sklubot ou d'un texte validé ; sous-titres incrustés avec ffmpeg sur l'ordinateur du bot ; traduite en français.

# Sous-titres

La plupart des vidéos courtes sont regardées sans le son : les sous-titres les rendent compréhensibles. Ils doivent être exacts, lisibles sur téléphone et calés sur la voix.

## 1. Obtenir le texte

Dans cet ordre :
- **un texte validé** par le patron (les mots qu'il voulait dire) : le plus fiable ;
- **les sous-titres de la vidéo** ou une transcription : transcribe pour une vidéo d'un site vidéo ; pour un fichier qu'on t'a envoyé, meeting_transcribe donne des morceaux horodatés ;
- le service de reconnaissance vocale du patron par ces outils ; un service payant seulement avec son oui (les outils le demandent).
N'envoie jamais la vidéo à un service en ligne gratuit inconnu.

## 2. Corriger et caler

Fais un fichier SRT (file_save, par exemple sous-titres/<video>.srt) :

```
1
00:00:00,400 --> 00:00:02,600
Notre levain repose 48 heures.

2
00:00:02,700 --> 00:00:05,100
C'est pour ça qu'il se garde toute la semaine.
```

- Corrige noms, marques, chiffres, mots techniques, ponctuation ; s'il y a un texte validé, suis ses mots exactement.
- 2 lignes au plus, d'environ 32 à 42 caractères ; coupe aux pauses naturelles ; chaque sous-titre reste au moins environ 1 seconde et assez longtemps pour être lu (environ 15 à 17 caractères par seconde au plus).
- Les temps suivent la voix ; pas de sous-titre à cheval sur un changement de plan quand on peut l'éviter.

## 3. Traduire (si demandé)

Traduis sous-titre par sous-titre en gardant les temps ; adapte plutôt que traduire mot à mot ; fais relire une traduction par une personne de langue maternelle ou par le patron avant publication.

## 4. Incruster ou joindre

Sur ton ordinateur (shell_run, ffmpeg) :
- **Fichier séparé** (activable, le mieux pour YouTube) : garde le SRT à côté du MP4, ou ajoute-le en piste : `ffmpeg -i in.mp4 -i subs.srt -c copy -c:s mov_text out.mp4`.
- **Incrustés dans l'image** (nécessaire pour la plupart des applis de vidéos courtes) : `ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=16,Outline=2,MarginV=60'" -c:a copy out.mp4`.
Pour une vidéo verticale, garde le texte dans la zone sûre : au-dessus des 20 % du bas (boutons et légendes des applis) et sous les 10 % du haut.

## 5. Vérifier avant le rendu final

- Produis une image d'aperçu à un moment avec du texte (`ffmpeg -ss 5 -i out.mp4 -frames:v 1 apercu.png`) et regarde-la : taille, contraste, position, accents bien affichés.
- Compare les sous-titres au texte validé ligne par ligne ; liste chaque différence.
- Vérifie tout le fichier avec ffprobe (durée, taille) et regarde des images au début, au milieu et à la fin (video_frames).
Livre la vidéo et le SRT (file_send). La publication suit « Contenus par réseau », avec le oui du patron.
