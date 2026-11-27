---
name: Sharpen a page request
description: Turn a vague request for a page, a screen or a visual ("a nice page for my restaurant") into a precise brief - purpose and mood in one line, the device, numbered sections, mood words that mean something, colours by role from the brand sheet - before building it with page_publish, artifact_create or image_generate.
---

> Adapted from google-labs-code/stitch-skills "enhance-prompt" (© 2026 Google LLC, Apache License 2.0). Modified for Sklubot (2026-11-22): rewritten as a brief for Sklubot pages, artifacts and images instead of prompts for the original design tool; the brand sheet replaces the original design file; translated into French.

# Sharpen a page request

A vague request gives a generic page. Five minutes of precision gives a page that looks like the owner's business.

## 1. What is missing?

| Point | Check | If missing |
|---|---|---|
| Device | phone first, computer, both | phone first for a shop or restaurant |
| Kind of page | home, menu, booking, product, event, form | deduce it from the request |
| Sections | the blocks in order | propose them (below) |
| Mood | words that describe a look | translate (below) |
| Colours and fonts | from the brand sheet | read ~/team/charte.md or apply "Brand design" |
| Real content | prices, hours, address, photos, texts | ask in one grouped question; never invent |

If one point really changes everything (for example who the page is for), ask one question with your recommended answer (ask_user); otherwise choose and say it in one line.

## 2. Precise words

| Vague | Precise |
|---|---|
| "menu at the top" | top bar with the logo, 3 to 5 links and a "Book" button |
| "a button" | main action button ("Order", "Call") |
| "a list" | grid of cards with photo, name, price — or a list with small photos |
| "a picture area" | first screen with a large photo, title, one sentence and the main button |
| "modern" | clean, lots of space, one accent colour, simple shapes |
| "professional" | sober, reassuring, strong contrast, discreet details |
| "fun" | bright colours, rounded shapes, lively titles |
| "dark mode" | dark background, light text, accents with strong contrast |

## 3. The brief

```
<One line: the purpose of the page and its mood>

LOOK (from the brand sheet):
- Device: <phone first / computer>
- Theme: <light or dark>, <3 mood words>
- Background: <name> (#hex) · Accent: <name> (#hex) for <role> · Text: <name> (#hex)
- Type: <titles> / <body> · Shapes: <corners, shadows>

SECTIONS:
1. <First screen>: <title, sentence, main action>
2. <…>
n. <Footer>: address, hours, phone, legal notice

CONTENT TO PROVIDE: <photos, prices, texts still missing>
```

Show the brief, apply the owner's corrections, then build. For a site of several pages, save it as the brief of the next page (see "Site in several passes").
