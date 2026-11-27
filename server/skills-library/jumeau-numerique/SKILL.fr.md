---
name: Jumeau numérique (voix ou avatar)
description: Quand le patron veut une copie de sa propre voix ou de son visage (ou de quelqu'un qui a donné son accord écrit) pour des vidéos - l'accord d'abord, un enregistrement propre, un brief écrit, plusieurs essais courts, les ratés gardés dans un bac avec la raison, une comparaison côte à côte, un contrôle qualité du son, et chaque résultat marqué comme fait par IA.
---

# Jumeau numérique (voix ou avatar)

Compétence originale de Sklubot. Elle marche avec un service de voix ou d'avatar que le patron a connecté avec son propre compte (sa clé ou sa connexion) ; elle n'utilise jamais un service que le patron n'a pas choisi.

## 0. L'accord, toujours d'abord

Une copie n'est faite que de la voix ou du visage du patron, ou d'une personne qui a donné son accord **écrit**. Sklubot le demande lui-même : toute action qui copie une voix ou un visage s'arrête sur une carte qui demande au patron « c'est toi, ou la personne a donné son accord écrit ? » — on y répond une fois par copie, jamais « toujours ». Si le patron refuse ou ne sait pas : arrête, rien n'est copié, et n'essaie pas un autre outil.

## 1. L'enregistrement

- Voix : 2 à 5 minutes de la personne qui parle naturellement, dans une pièce calme, près du micro, sans musique, une seule personne, dans un fichier sans perte ou de bonne qualité (WAV ou FLAC, 44,1 ou 48 kHz).
- Visage : une vidéo bien éclairée face à la caméra, fond neutre, visage jamais caché, 1 à 2 minutes.
- Avant de l'utiliser, fais le **contrôle qualité** (partie 5) sur l'enregistrement lui-même. Un mauvais enregistrement donne un mauvais jumeau.

## 2. Le brief

Écris-le dans un fichier avant tout essai : à quoi sert le résultat (une vidéo produit de 30 secondes, un message vocal…), le texte à dire, le ton, la vitesse, la langue et l'accent, la durée, ce qui ne doit jamais être dit. Montre-le au patron.

## 3. Les essais et le bac des ratés

- Fais 3 essais courts (10 à 20 secondes) plutôt qu'un long ; annonce d'abord le prix si le service est payant à l'usage.
- Range tout dans `~/files/jumeau/` : `essais/` pour les essais, `rates/` pour les ratés. Chaque raté a une ligne dans `rates/notes.md` : fichier, ce qui ne va pas (robotique, mauvais accent, bouche décalée, mots coupés), ce qu'il faut changer la prochaine fois. Ne supprime jamais un raté sans le patron : il apprend ce qu'il ne faut pas refaire.
- Change une seule chose à la fois entre deux essais (le texte, un réglage, l'enregistrement).

## 4. La comparaison côte à côte

Mets l'original et l'essai côte à côte pour que le patron juge à l'œil et à l'oreille :
- vidéo : `ffmpeg -i original.mp4 -i essai.mp4 -filter_complex "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2[v]" -map "[v]" -map 1:a? -shortest compare.mp4`
- voix : un seul fichier avec l'original, une seconde de silence, puis l'essai, au même volume (voir 5).
Montre-le (screen_view ou le fichier dans la conversation) et demande quel essai est le plus proche, et pourquoi.

## 5. Le contrôle qualité du son

Sur ton ordinateur Linux, avec ffmpeg :
- volume : `ffmpeg -i fichier.wav -af loudnorm=print_format=summary -f null -` → vise environ −16 LUFS pour le web (−14 pour certains réseaux), crête réelle sous −1 dB ;
- saturation : `ffmpeg -i fichier.wav -af astats=metadata=1:reset=0 -f null -` → niveau de crête sous 0 dB, peu d'échantillons écrêtés ;
- silences et coupures : `ffmpeg -i fichier.wav -af silencedetect=noise=-40dB:d=0.6 -f null -` → pas de silence inattendu au milieu ;
- format : `ffprobe -hide_banner fichier.wav` → fréquence, canaux et durée attendus.
Écris les résultats dans un petit tableau (bon / à corriger) et corrige (normaliser, couper) avant de rendre.

## 6. Marqué comme IA

Chaque image et chaque vidéo que Sklubot génère est marquée « générée par IA » dans ses métadonnées ; pour un montage du Studio, coche « Généré par IA » avant l'export. Quand le résultat est publié, dis aussi dans le texte qu'il est généré par IA, comme le demande le réseau. Ne présente jamais un jumeau comme un vrai enregistrement.

## Ce que tu rends

Le résultat choisi, le fichier de comparaison, le tableau de qualité, les notes du bac des ratés, et ce que ça a coûté.
