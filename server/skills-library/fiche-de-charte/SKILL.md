---
name: Brand sheet (design)
description: Describe an existing look in words plus exact values - from a page or screenshot the owner shows, or from the source files of their site - mood, colours with a descriptive name, hex code and role, type, shapes, depth, layout - and save it as the "Look" part of the brand sheet so every later page follows it.
---

> Adapted from google-labs-code/stitch-skills "design-md" and "extract-design-md" (© 2026 Google LLC, Apache License 2.0). Modified for Sklubot (2026-11-22): the original design tool's server, project lookups and generation notes removed; the analysis works from a page opened in the bot's browser, a screenshot or a site's source files (read, never run); the result is written into the Sklubot brand sheet; translated into French.

# Brand sheet (design)

A description that a designer, a printer or another bot can follow: words for the feel, exact values for precision, and the role of each value.

## Sources (only what the owner has the right to use)

- **Their own site or app**: open it (browser_open), look (screen_view at phone and computer width), read the styles (page_source when it is a page you published; otherwise the visible page and what the browser shows).
- **Its source files** (a folder they shared, a repository): read, never install or run. Look at the theme or variables file, the global styles, then a few components (button, card, menu, form).
- **A screenshot or a printed document** they send.

Never describe another company's look so as to copy it.

## What to write

1. **Mood**: two or three precise adjectives ("airy, warm, calm"), the density (lots of space or compact), warm or cool neutrals; then one or two sentences that capture the feel.
2. **Colours by role**, each as *descriptive name (#hex) — role*:
   - background and surfaces;
   - accent and interactive (buttons, links, active state);
   - text: main, secondary, faint;
   - states: success, error, warning, information.
   Note the contrast of the main text and of the accent on its background (at least 4.5:1 for text); when the accent is too pale for text, say it is for fills only.
3. **Type**: font families (and a free fallback), weights for titles and body, sizes from the largest title to small print, letter-spacing, line height.
4. **Shapes in words**: "sharp square corners", "slightly rounded (6 px)", "pill-shaped buttons"; borders thin or none.
5. **Depth**: flat, very soft shadows, or strong shadows; how layers are shown.
6. **Components**: buttons (shape, colours, hover), cards, menu, form fields, in one line each.
7. **Layout**: margins, maximum width, grid, how much space between sections, what changes at phone width.
8. **Logo and images**: where the logo files are (only those the owner gave); the photo style (real photos, illustrations, light, framing).

## Where it goes

Write it as the **Look** section of the brand sheet: ~/team/charte.md (see "Brand interview"), or brand/look.md in your library if there is no sheet yet. Show it to the owner and ask them to correct it; then "Brand design" and every page use these exact values.
