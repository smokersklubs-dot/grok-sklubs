---
name: Layout rules against the generic look
description: Rules to add on top of any page or visual so it does not look generated - propose two or three ideas before a visual, set density and boldness on purpose, one accent colour, real states (empty, loading, error), banned layout clichés, phone first with 100dvh and 44 px targets, keyboard and reduced motion, a fallback when 3D or WebGL is missing, nothing hidden off-screen.
---

> Adapted from google-labs-code/stitch-skills "taste-design" (© 2026 Google LLC, Apache License 2.0) and stick-scene's "propose two or three ideas first" step (© 2026 Kamran Ahmed, MIT). Modified for Sklubot (2026-11-22): the original design-file generator and its tool removed, font and brand bans softened to follow the owner's brand sheet first, rules rewritten as a checklist for Sklubot pages and visuals, translated into French.

# Layout rules against the generic look

These rules sit on top of "Design craft rules" and the owner's brand sheet. The brand sheet always wins on colours and fonts.

## Before a visual: two or three ideas

For a hero, an illustration, a poster or an animation, first propose **two or three different ideas** in one line each (a metaphor, a composition, what the eye sees first) and let the owner pick (ask_user, your recommended idea first). Then build only the chosen one.

## Set the dials on purpose

Say in one line where the page sits on three scales, and keep to it:
- **Density**: airy (gallery) · balanced (everyday app) · dense (dashboard).
- **Boldness**: symmetric and calm · offset · daring.
- **Motion**: still · light transitions · choreographed.
A restaurant page is often airy, offset, light; a stock table is dense, symmetric, still.

## Colour and type

- **One** accent colour, not too saturated; neutrals from a single family (all warm or all cool).
- No pure black (#000): a very dark grey reads better. No neon glows, no purple-blue gradients, no big gradient text.
- Body text at least 16 px, lines of at most about 65 characters; titles get hierarchy from weight and colour, not only from size.
- Fonts: the brand's. Without a brand, avoid the most overused default faces and pick a family with character, with a free fallback.

## States that must exist

- **Loading**: a skeleton the shape of the content, not a spinning wheel.
- **Empty**: a composed message that says how to fill it ("No booking yet: share this link").
- **Error**: a clear message in place, next to what failed, with what to do.
- Forms: label above the field, help text optional, error text below.

## Layout clichés to avoid

- A centred hero by reflex on a page meant to be bold: prefer split screen, left-aligned or offset.
- The row of three identical cards: prefer two columns in zigzag, an uneven grid, or a list.
- Text over images or over other text; content stacked in absolute positions.
- Filler: "Scroll to explore", bouncing arrows, "Learn more" next to the main button (one main action).
- Made-up figures and fake "key numbers" blocks, "LABEL // 2026" decorations, placeholder names ("John Doe", "Acme"), round fake numbers (99.9 %).
- Emojis as icons; custom mouse cursors.

## Phone first and robust

- Below 768 px everything collapses to one column; **no horizontal scroll** at 390 px.
- Full-height sections use `min-height: 100dvh`, never `100vh` alone (it jumps on phones).
- Titles scale with `clamp()`; tap targets at least 44 × 44 px; the menu becomes a simple mobile menu.
- Animate only `transform` and `opacity`; every animation has a `prefers-reduced-motion` version; content is readable without scripts.
- **Keyboard**: every control reachable with Tab in a logical order, with a visible focus; menus and dialogs close with Escape.
- **Nothing important off-screen**: no text pushed outside the visible area, no content only on hover.
- **3D, WebGL or video backgrounds**: always a still fallback (an image or a plain background) when it is not supported or motion is reduced; the text never depends on it.

## Check

Look at the page (screen_view at 390 px and at computer width, light and dark), tab through it once, and turn on reduced motion if you used animation. Fix what breaks a rule before showing it.
