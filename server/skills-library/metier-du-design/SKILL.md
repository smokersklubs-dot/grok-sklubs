---
name: Design craft rules
description: The universal rules a seasoned designer applies on top of any brand - type scale, tracking, colour and accent discipline, the signs of "AI-made" design, the five states of every interactive block, accessibility floor, motion and the laws of UX - to check every page, deck or visual before showing it.
---

> metier-du-design — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880); the typography, colour and anti-AI-slop parts were adapted by OpenDesign from refero_skill (© Refero Design, MIT License). Modified for Sklubot: the craft/ rulebooks were condensed into one skill, rewritten for Sklubot pages and decks, and translated into French.

# Design craft rules

The brand (the account's colours and fonts, or a starter style) says *which* fonts and colours. These rules say *how* to use them. Apply them to every page, deck, e-mail or visual, then run the checklist at the end before saying it is ready.

## 1. Typography

- **Scale**: one multiplicative scale (×1.2 or ×1.25), 6 to 8 sizes per piece at most. Typical web ranges: display 48–72 px, H1 32–48, H2 24–32, H3 20–24, body 15–18, small 13–14, caption 11–12.
- **Line height**: 1.0–1.2 for display and H1, 1.5–1.6 for body, 1.5 for small text. Chinese, Japanese and Korean need more: 1.3–1.4 for headings (even huge cover titles), 1.7–1.8 for body, and no negative tracking.
- **Letter-spacing**: body 0; small text +0.01 to +0.02em; buttons and labels +0.02em; **ALL CAPS always +0.06 to +0.1em**; headings from 32 px −0.01 to −0.02em; display from 48 px −0.02 to −0.03em (Latin scripts only).
- **Fonts**: two families at most (display + body, or one variable family). Always a fallback chain; never `system-ui` alone on a heading.
- **Weights**: three are enough — read (400), emphasise (500–550), announce (600). 700+ is rarely needed.
- **Line length**: 50–75 characters (`max-width: 65ch`). Never `text-align: justify` on the web.
- At most three type sizes visible above the fold.

## 2. Colour

- **Four layers**: neutrals 70–90% of the pixels (background, surface, text, muted text, border), **one** accent 5–10%, semantic colours 0–5% (success, warning, danger), effects under 1%.
- **Accent discipline**: at most two visible uses of the accent per screen (e.g. one label + the main button). Links and focus rings count.
- **Contrast** (gates, not goals): body text 4.5:1; large text (≥ 24 px, or ≥ 18.5 px bold) 3:1; buttons, fields, icons and focus rings against what surrounds them 3:1. A bright brand colour too pale for text: use a darker shade for text, keep the bright one for fills.
- **Dark theme**: no pure black or white — about `#0f0f0f` background and `#f0f0f0` text; borders as `rgba(255,255,255,.08)`.
- **Name tokens by role** (`--accent`, `--success`), never by hue (`--blue-500`).

## 3. Signs of "made by AI" — remove them

Must fix:
1. The default Tailwind indigo/violet as accent (`#6366f1`, `#4f46e5`, `#8b5cf6`, `#7c3aed`…), unless it is really the brand.
2. A two-colour "trust" gradient on the hero (purple→blue, blue→cyan, indigo→pink).
3. Emoji as feature icons (✨ 🚀 🎯 ⚡ 🔥 💡): use simple line icons in SVG with `currentColor`.
4. A sans-serif on headings when the style chose a serif.
5. A rounded card with a coloured left border (the "AI dashboard tile").
6. Invented figures ("10× faster", "99.9% uptime"): a real source or a labelled placeholder.
7. Filler text (lorem ipsum, "feature one / two / three").

Should fix: the unvaried "hero → features → pricing → FAQ → call to action" sequence (change at least one section); placeholder-picture sites; more than about 12 raw colour codes outside `:root`; the accent used six times or more. Nice to fix: meaningless blobs and waves in the background; a layout so symmetric it has no tension.

**Soul**: about 80% proven patterns, 20% one deliberate choice — a bold type decision, one colour move, an unusual proportion, microcopy in the product's own voice ("Start tracking" rather than "Get started"), one small memorable interaction. If someone outside could guess which product it is from a screenshot, it has soul.

## 4. The five states of anything interactive

Every list, table, card, form or panel that shows or receives data must have:
- **Loading**: nothing under 300 ms; 0.3–2 s a light skeleton or spinner; 2–10 s a skeleton shaped like the result or a labelled spinner ("Loading payments…"); 10–60 s a progress bar with Cancel; beyond, stop and offer retry. A note "taking longer than expected" at 15 s. Never an endless spinner.
- **Empty**: a headline, a plain explanation and one action. First use = onboarding moment; no results = repeat the query and suggest something; an error is never shown as "empty".
- **Error**: what happened, why if known, what to do (retry, another path), and the user's input kept.
- **Filled**: the case the design was drawn for.
- **Extremes**: very long names, 10,000 rows, missing optional fields, right-to-left text: the layout must not break.

## 5. Accessibility floor (WCAG 2.2 AA)

- Contrast as in §2. Tap targets at least 24×24 px (44×44 on phones and for main actions).
- Visible keyboard focus (`:focus-visible`, 2 px, 3:1); never remove the outline without replacement.
- Every field has a `<label>`; errors linked with `aria-describedby`, `aria-invalid="true"` and `role="alert"`; real `<button>` and `<a>` elements.
- Headings in order, `alt` text on meaningful images (empty `alt=""` on decorative ones), a page language (`<html lang>`).
- Information never by colour alone (add an icon, a word or a pattern).

## 6. Motion

- Animate only when people move through space, time or state: navigation, a panel opening, progress, the follow-through of a gesture. Never to teach, decorate, look "premium" or fill a silence.
- Durations: 50–100 ms instant feedback (press, toggle, hover); 150 ms the default confirmation; 200–300 ms something entering (dialog, menu); 300–500 ms moves between screens. Small interactions stay under 500 ms; frequent ones under 200 ms; about 25% shorter on phones.
- Curves for opacity and colour (e.g. `cubic-bezier(0.2, 0, 0, 1)`); spring-like motion for position and scale. Animate `transform` and `opacity` rather than width, height, top or left.
- Respect `prefers-reduced-motion`: replace movement by a fade or nothing. No endless decorative loop next to text people must read.

## 7. Laws of UX (what to compose)

- **Hick / choice overload**: fewer options decide faster — 3 plans rather than 6, 5–7 menu items, group long settings lists.
- **Fitts**: the main action is big and close to where the eye and hand already are; destructive actions are small and far.
- **Proximity, similarity, common region**: what belongs together sits together, looks alike, or shares a box — before adding lines or shadows.
- **Von Restorff**: the one recommended item looks different; only one per screen.
- **Miller / working memory**: chunk numbers and steps (about 4 items at a glance); keep context visible instead of making people remember it.
- **Goal gradient, Zeigarnik, peak-end**: show progress, show what is left, end a flow on a clear success moment.
- **Jakob**: people expect what other sites do; innovate on content, not on where the menu is.
- **Doherty**: respond within 400 ms, or show that work is happening.
- **Tesler**: complexity does not disappear; move it from the user to the product (good defaults, pre-filled fields).

## 8. Checklist before "ready"

- [ ] Type scale, tracking (caps!) and line length respected; ≤ 3 sizes above the fold.
- [ ] One accent, ≤ 2 uses per screen; contrast 4.5:1 / 3:1 checked in light and dark.
- [ ] None of the seven "made by AI" signs; no invented figure.
- [ ] Each interactive block has its loading, empty, error and extreme states.
- [ ] Focus visible, labels present, targets large enough, reduced motion respected.
- [ ] Looked at it (screenshot) at phone and desktop widths, in light and dark.
