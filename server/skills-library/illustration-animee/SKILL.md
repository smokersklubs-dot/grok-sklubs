---
name: Animated page illustration
description: Make a small hand-drawn animated scene for a page - a stick figure working a machine or a prop that shows what the business or product does (pull a lever, stamp a parcel, pin a note) - from two or three proposed ideas, with an open-source drawing library fetched at a pinned version, checked frame by frame before it goes on the page.
---

> Adapted from stick-scene (© 2026 Kamran Ahmed, MIT): its workflow, element options and style rules. Modified for Sklubot (2026-11-22): the runtime is fetched on demand on the bot's computer at one pinned commit instead of being bundled; the scene is published with page_publish; the frame check uses the bot's browser; the Playwright scripts and the original author's personal style name removed; translated into French.

# Animated page illustration

One small scene, one idea: a stick figure does one job that shows what the business does. It idles (breathes, glances) and plays one 5 to 8 second action when it comes into view or on click, then settles. It is a drawing on a canvas, light, with no other dependency.

## 1. Understand and pitch

1. In one line each: what the customer does, what they get.
2. **Pitch 2 or 3 metaphors** and let the owner pick (ask_user, your recommendation first): one line each with the prop, the action, the payoff. Good ones are physical and readable in one second: a lever, a stamp, a conveyor, a pinboard, a crate stack, a till. If it needs a caption, the metaphor is wrong.

## 2. Get the drawing library (pinned)

The runtime is an open-source file (MIT). Fetch it on your computer at the pinned commit, never from a moving branch:

```sh
mkdir -p ~/tools && cd ~/tools && rm -rf stick-scene
git clone --filter=blob:none https://github.com/nilbuild/stick-scene.git && cd stick-scene
git checkout ca84311177a020c2dff7dfd9cb2e7b786288c1ab && git rev-parse HEAD
```

The printed commit must be ca84311177a020c2dff7dfd9cb2e7b786288c1ab. Read `references/craft.md` (poses, timing, props, mistakes) and start from `templates/scene.js`; `examples/` holds real scenes. Keep `LICENSE` with the file: its copyright line must stay at the top of stick.js when you publish it. Do not run its scripts or install anything.

## 3. Write the scene

From the template: lay out the props in fixed positions first (ground at y = 0, everything above y = -185 and inside ± width/2), then the idle loop, then the action as a timeline over its duration. Give `label` a plain sentence for screen readers ("A baker stamps a box and it slides to the delivery van").

Style: ink lines (#141414), white fills, **one** highlight colour (the brand's accent), lots of empty space, only a few words on props. The figure is the hero: never hide its head or the active hand behind a prop; draw props, then figures, then what is held or flying. Show the result, not the work: end on something that changed and stays a beat. No other company's logo.

## 4. Put it on the page

Publish the page with page_publish and give `stick.js` and the scene file as files of the page, then:

```html
<stick-scene scene="<id>" play="view" no-font style="height:230px;max-width:560px" label="<what it shows>"></stick-scene>
<script src="stick.js" defer></script>
<script src="<id>.js" defer></script>
```

`stick.js` comes before every scene script. `play`: `view` (plays once when half visible, then on click; the best default), `click`, `hover`, `loop` (sparingly), `idle`. Use `no-font` (Sklubot pages load fonts from Google Fonts only through a stylesheet link you add yourself, if you want the hand-written face). Reduced motion shows one still frame, which is right.

## 5. Check it frame by frame

Before calling it done, open the published page (browser_open) and look (screen_view) at rest, then click the scene and take screenshots at several moments of the action (about every second). Check on each: the head and the active hand are visible, no arm passes through the face, nothing jumps between two moments, the final state is readable, nothing is cut at phone width. Also check with reduced motion that the still frame makes sense. Fix and look again; show the owner the frames with the page link.
