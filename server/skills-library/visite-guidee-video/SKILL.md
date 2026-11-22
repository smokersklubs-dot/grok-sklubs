---
name: Guided video tour of a site
description: Turn the pages of a site or an app into a short walkthrough video - capture each screen in the bot's browser, order them as a story, one slide per screen with gentle zooms, transitions and short titles, render an MP4 (wide or vertical) on the bot's computer, and check frames, timing and readability before delivering.
---

> Adapted from google-labs-code/stitch-skills "remotion" with its composition checklist (© 2026 Google LLC, Apache License 2.0). Modified for Sklubot (2026-11-22): screens come from the bot's browser instead of the original design tool, rendering uses Sklubot's video studio, ffmpeg or the pinned animation workflow already offered by Sklubot, the React component templates removed, translated into French.

# Guided video tour of a site

A one-minute video that shows a site or an app the way a visitor goes through it: useful for a launch post, a client presentation or a short on social networks.

## 1. Capture the screens

1. Agree on the path to show (home, the offer, ordering, contact) and the format: **wide 16:9** for a presentation, **vertical 9:16** for Reels, Shorts and TikTok.
2. Open each page in your browser (browser_open) at the right width (computer width for 16:9, phone width for 9:16), wait until it has fully loaded, and take a screenshot (screen_view, or a full-page capture when you need to scroll through it).
3. Save the images with clear names in order (tour/01-home.png, tour/02-menu.png…) and note for each: what it shows, the one point to highlight, how long it stays.

Only capture the owner's own pages, or pages they have the right to show, and never a screen that shows personal data of customers.

## 2. Write the story

One slide per screen, 3 to 6 seconds each, 30 to 75 seconds in all:
- a short title on each slide (5 words or fewer), large enough to read on a phone;
- one point highlighted per screen (a gentle zoom towards it, or a soft frame around it);
- the first two seconds show the most striking screen or the result;
- the last slide: the name, the address of the site and one action.

## 3. Render

Choose the simplest way that gives the result:
- **Sklubot's video studio** (video_studio_create, then video_studio_render): images as shots, titles, optional music and voice.
- **ffmpeg on your computer** (shell_run): each image with a slow zoom (`zoompan`), crossfades (`xfade`), titles (`drawtext`), H.264 + AAC in MP4.
- **The pinned animation workflow** (video_workflow "remotion") when the owner wants richer motion design.

Transitions: fade, slide or zoom, short and calm; no jarring cuts.

## 4. Check before delivering

- Render, then check the file with ffprobe: duration, width and height (1920 × 1080 or 1080 × 1920), sound if any.
- Look at frames near the start, the middle and the end (video_frames or ffmpeg): text readable at every moment, enough contrast, nothing stretched or cropped, titles inside the safe area (not in the top 10 % or bottom 20 % for vertical videos, where the apps put their buttons).
- Each slide stays long enough to read its title; the whole is neither rushed nor too long.
- The file size is reasonable for sending.

Deliver the MP4 from your library (file_send) with its duration and format. To post it on networks, use "Content per network": nothing is published without the owner's yes.
