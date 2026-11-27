---
name: Work on sound (ffmpeg)
description: Everyday sound work on the bot's computer with ffmpeg (installed) - read a file's details, cut, convert (MP3, WAV, M4A, Opus), normalise loudness for the web or podcasts, trim silences, put music under a voice, extract the sound of a video - on copies, checked by measuring.
---

# Work on sound (ffmpeg)

Original Sklubot skill. Work on a copy: the owner's originals are never overwritten (write to a new folder `sortie/`). Show one result before doing a whole folder.

## Read first

`ffprobe -hide_banner in.wav` → format, duration, sample rate, channels.

## Recipes

- Cut from 0:12 to 1:05: `ffmpeg -i in.mp3 -ss 00:00:12 -to 00:01:05 -c copy sortie/extrait.mp3` (re-encode if the cut is not clean: drop `-c copy`)
- Convert: MP3 `ffmpeg -i in.wav -codec:a libmp3lame -q:a 2 out.mp3`; M4A `-c:a aac -b:a 160k out.m4a`; Opus `-c:a libopus -b:a 96k out.opus`; WAV for editing `-c:a pcm_s16le -ar 48000 out.wav`
- Loudness (one pass, good enough): `ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 out.wav` (−16 LUFS web and podcasts; −14 for some streaming services). For exact results run it twice: measure with `print_format=json`, then pass the measured values.
- Remove long silences: `ffmpeg -i in.wav -af "silenceremove=stop_periods=-1:stop_duration=0.8:stop_threshold=-40dB" out.wav`
- Music under a voice (music lowered when the voice speaks): `ffmpeg -i voix.wav -i musique.mp3 -filter_complex "[1:a]volume=0.25[m];[m][0:a]sidechaincompress=threshold=0.05:ratio=8[d];[0:a][d]amix=inputs=2:duration=first" out.wav`
- Sound of a video: `ffmpeg -i video.mp4 -vn -c:a copy son.m4a`
- Mono for a voice message: `-ac 1`

## Check

Measure the result: `ffmpeg -i out.wav -af loudnorm=print_format=summary -f null -` (loudness and true peak), `-af silencedetect=noise=-40dB:d=0.6` (unexpected silences), then listen to the start, a middle part and the end. Music: only tracks the owner has the rights to use.
