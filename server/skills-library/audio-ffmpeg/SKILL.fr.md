---
name: Traiter du son (ffmpeg)
description: Le travail courant sur le son, sur l'ordinateur du bot, avec ffmpeg (installé) - lire les informations d'un fichier, couper, convertir (MP3, WAV, M4A, Opus), normaliser le volume pour le web ou les podcasts, retirer les silences, mettre une musique sous une voix, extraire le son d'une vidéo - sur des copies, vérifié en mesurant.
---

# Traiter du son (ffmpeg)

Compétence originale de Sklubot. Travaille sur une copie : les originaux du patron ne sont jamais écrasés (écris dans un nouveau dossier `sortie/`). Montre un résultat avant de traiter tout un dossier.

## Lire d'abord

`ffprobe -hide_banner in.wav` → format, durée, fréquence, canaux.

## Recettes

- Couper de 0:12 à 1:05 : `ffmpeg -i in.mp3 -ss 00:00:12 -to 00:01:05 -c copy sortie/extrait.mp3` (réencode si la coupe n'est pas nette : enlève `-c copy`)
- Convertir : MP3 `ffmpeg -i in.wav -codec:a libmp3lame -q:a 2 out.mp3` ; M4A `-c:a aac -b:a 160k out.m4a` ; Opus `-c:a libopus -b:a 96k out.opus` ; WAV pour le montage `-c:a pcm_s16le -ar 48000 out.wav`
- Volume (une passe, suffisant) : `ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 out.wav` (−16 LUFS pour le web et les podcasts ; −14 pour certains services d'écoute). Pour un résultat exact, fais deux passes : mesure avec `print_format=json`, puis donne les valeurs mesurées.
- Retirer les longs silences : `ffmpeg -i in.wav -af "silenceremove=stop_periods=-1:stop_duration=0.8:stop_threshold=-40dB" out.wav`
- Musique sous une voix (la musique baisse quand la voix parle) : `ffmpeg -i voix.wav -i musique.mp3 -filter_complex "[1:a]volume=0.25[m];[m][0:a]sidechaincompress=threshold=0.05:ratio=8[d];[0:a][d]amix=inputs=2:duration=first" out.wav`
- Son d'une vidéo : `ffmpeg -i video.mp4 -vn -c:a copy son.m4a`
- Mono pour un message vocal : `-ac 1`

## Vérifier

Mesure le résultat : `ffmpeg -i out.wav -af loudnorm=print_format=summary -f null -` (volume et crête réelle), `-af silencedetect=noise=-40dB:d=0.6` (silences inattendus), puis écoute le début, un passage du milieu et la fin. Musique : seulement des morceaux que le patron a le droit d'utiliser.
