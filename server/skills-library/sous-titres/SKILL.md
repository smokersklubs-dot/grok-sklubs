---
name: Subtitles
description: Add subtitles to a video for social networks - get a transcript (the video's own subtitles, a speech-to-text service the owner chose, or an approved script), correct and time it into an SRT file, translate if asked, burn it into the picture or keep it as a separate file with ffmpeg, and check a preview frame before the final render.
---

> Adapted from CLI-Anything "cli-anything-videocaptioner" (© 2026 HKUDS CLI-Anything Team, Apache License 2.0): its transcribe, correct, translate, burn and review-before-burning workflow. Modified for Sklubot (2026-11-22): the Python harness and its free third-party speech and translation services removed; transcripts come from Sklubot's transcribe and meeting tools or an approved script; subtitles burned with ffmpeg on the bot's computer; translated into French.

# Subtitles

Most short videos are watched without sound: subtitles make them understood. They must be exact, readable on a phone and in time with the voice.

## 1. Get the text

In this order:
- **an approved script** from the owner (the words they wanted to say): the most reliable;
- **the video's own subtitles** or a transcript: transcribe for a video on a video site; for a file uploaded to you, meeting_transcribe gives time-stamped parts;
- the owner's own speech-to-text service through those tools; a paid service only with their yes (the tools ask).
Never send the video to an unknown free online service.

## 2. Correct and time

Make an SRT file (file_save, e.g. subtitles/<video>.srt):

```
1
00:00:00,400 --> 00:00:02,600
Our sourdough rests 48 hours.

2
00:00:02,700 --> 00:00:05,100
That is why it keeps all week.
```

- Fix names, brands, figures, technical words, punctuation; when there is an approved script, follow its words exactly.
- At most 2 lines of about 32 to 42 characters; cut at natural pauses; each subtitle on screen at least about 1 second and long enough to read (about 15 to 17 characters per second at most).
- Timings follow the voice; no subtitle across a cut in the picture when avoidable.

## 3. Translate (if asked)

Translate subtitle by subtitle, keeping the timing; adapt rather than translate word for word; have a native speaker or the owner check a translation before publishing.

## 4. Burn or attach

On your computer (shell_run, ffmpeg):
- **Separate file** (switchable, best for YouTube): keep the SRT next to the MP4, or add it as a track: `ffmpeg -i in.mp4 -i subs.srt -c copy -c:s mov_text out.mp4`.
- **Burned into the picture** (needed for most short-video apps): `ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=16,Outline=2,MarginV=60'" -c:a copy out.mp4`.
For vertical videos, keep the text inside the safe area: above the bottom 20 % (buttons and captions of the apps) and below the top 10 %.

## 5. Check before the final render

- Render one preview frame at a moment with text (`ffmpeg -ss 5 -i out.mp4 -frames:v 1 preview.png`) and look at it: size, contrast, position, accents shown correctly.
- Compare the subtitles with the approved script line by line; list any difference.
- Check the whole file with ffprobe (duration, size) and look at frames near the start, middle and end (video_frames).
Deliver the video and the SRT (file_send). Publishing follows "Content per network", with the owner's yes.
