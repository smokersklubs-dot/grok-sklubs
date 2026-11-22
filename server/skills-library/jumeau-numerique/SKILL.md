---
name: Digital twin (voice or avatar)
description: When the owner wants a copy of their own voice or face (or of someone who gave written consent) for videos - consent first, a clean recording, a written brief, several short trials, failed takes kept in a bin with the reason, a side-by-side comparison, a sound quality check, and every result labelled as made by AI.
---

# Digital twin (voice or avatar)

Original Sklubot skill. It works with a voice or avatar service the owner connected with their own account (their own key or sign-in); it never uses a service the owner did not choose.

## 0. Consent, always first

A copy is only of the owner's own voice or face, or of a person who gave **written** consent. Sklubot asks this itself: any action that clones a voice or a face stops on a card asking the owner "is it you, or did the person give written consent?" — it is answered once per copy, never "always". If the owner refuses or does not know: stop, nothing is copied, and do not try another tool.

## 1. The recording

- Voice: 2 to 5 minutes of the person speaking naturally, in a quiet room, close to the microphone, no music, one person only, in a lossless or high-quality file (WAV or FLAC, 44.1 or 48 kHz).
- Face: a well-lit video facing the camera, neutral background, the face never hidden, 1 to 2 minutes.
- Before using it, run the **quality check** (section 5) on the recording itself. A bad recording gives a bad twin.

## 2. The brief

Write it in a file before any trial: what the result is for (a 30-second product video, a voice message…), the text to say, the tone, the speed, the language and accent, the length, what must never be said. Show it to the owner.

## 3. Trials and the bin of failed takes

- Make 3 short trials (10 to 20 seconds) rather than one long one; announce the price first if the service is paid per use.
- Keep everything in `~/files/jumeau/` : `essais/` for trials, `rates/` for failed takes. Each failed take gets a line in `rates/notes.md`: file, what is wrong (robotic, wrong accent, mouth out of sync, cut words), what to change next time. Never delete a failed take without the owner: it teaches what not to repeat.
- Change one thing at a time between trials (the text, a setting, the recording).

## 4. Side-by-side comparison

Put the original and the trial next to each other so the owner judges by eye and ear:
- video: `ffmpeg -i original.mp4 -i essai.mp4 -filter_complex "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2[v]" -map "[v]" -map 1:a? -shortest compare.mp4`
- voice: one file with the original, one second of silence, then the trial, at the same loudness (see 5).
Show it (screen_view or the file in the chat) and ask which trial is closest, and why.

## 5. Sound quality check

On your Linux computer, with ffmpeg:
- loudness: `ffmpeg -i fichier.wav -af loudnorm=print_format=summary -f null -` → aim around −16 LUFS for the web (−14 for some networks), true peak below −1 dB;
- clipping: `ffmpeg -i fichier.wav -af astats=metadata=1:reset=0 -f null -` → peak level under 0 dB, few clipped samples;
- silences and cuts: `ffmpeg -i fichier.wav -af silencedetect=noise=-40dB:d=0.6 -f null -` → no unexpected silence in the middle;
- format: `ffprobe -hide_banner fichier.wav` → sample rate, channels, duration as expected.
Write the results in a short table (passes / to fix) and fix (normalise, cut) before handing over.

## 6. Labelled as AI

Every picture and video Sklubot generates is marked "made by AI" in its metadata; for a Studio montage, tick « Généré par IA » before exporting. When the result is published, say it is AI-generated in the text too, as the network asks. Never present a twin as a real recording.

## What to hand back

The chosen result, the comparison file, the quality table, the bin notes, and what it cost.
