---
name: Web component guides
description: How to build the common parts of a page so they are light, accessible and work on Safari too - dialog, menu, tabs, accordion, tooltip, toast, carousel, navigation drawer, switch, forms and validation, autofill, tables on phones, dark mode and its toggle, image priority - native HTML first, then the fallback when a recent feature is not supported everywhere.
---

> Adapted from the guides of GoogleChrome/modern-web-guidance-src (© 2026 Google LLC; guide texts under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/; code under Apache License 2.0). Modified for Sklubot (2026-11-22): about twenty guides condensed into short rules for Sklubot pages, a support-check step added, examples shortened, translated into French. Changes were made; this is not an official text of the guides' authors.

# Web component guides

**Native HTML first.** A built-in element brings keyboard, focus, screen-reader names and Escape handling for free; a hand-made `div` has to rebuild all of it and usually forgets something.

**Check support before using a recent feature.** Features marked *(recent)* below may not work in every browser yet (often Safari). Before relying on one, check its status (web_fetch on its MDN page or the browser-support tables) and add the fallback given. When in doubt, use the fallback alone.

## Overlays

- **Dialog (blocks the page)**: `<dialog>` opened with `showModal()` (or *(recent)* `<button command="show-modal" commandfor="id">`). No `role="dialog"`, no `aria-modal`, no hand-made focus trap or Escape handler: the browser does it. Label it (`aria-labelledby` on its title). Stop the page scrolling behind it with `dialog:modal{overscroll-behavior:contain}` and `dialog::backdrop{overflow:hidden;overscroll-behavior:contain}`, never `overflow:hidden` on `body`. Close buttons in `<form method="dialog">`.
- **Panel you keep working beside** (find bar, filters): `<dialog popover="manual">` with a visible Close button.
- **Popup menu** (actions): a button that opens a popover (`popovertarget`), items as buttons, arrow keys between items, Escape closes and returns focus to the button; position it with CSS anchor positioning *(recent; fallback: position under the button with plain CSS)*. Navigation links are a list of links, not a "menu".
- **Tooltip**: only short extra text, never the only place information lives; *(recent)* `popover="hint"` opened on hover and focus; it must also appear on keyboard focus, and never contain links or buttons.
- **Toast (notification)**: `popover="manual"` in one named region (`role="region" aria-label="Notifications"`), always the same place; a real Close button reachable with the keyboard without stealing focus; the information must also exist elsewhere; never in or behind an open modal dialog; a reduced-motion version; still readable with text at 200 %.
- **Navigation drawer** (phone menu): a modal `<dialog>` sliding from the edge, closed by its button, by Escape and by tapping the backdrop; focus returns to the menu button.

## Content

- **Accordion / FAQ**: adjacent `<details><summary>` elements; *(recent)* the same `name` on each makes them exclusive (one open at a time). Never a heading inside `summary`; if each item needs its own heading, use buttons with `aria-expanded` under real headings.
- **Tabs**: `role="tablist"` with `role="tab"` buttons and `role="tabpanel"` panels; the first state written in the HTML (`hidden` on every other panel, `aria-selected="true"` on the selected tab), arrow keys move between tabs, the selected tab shown by a shape (underline), not by colour alone. Too many tabs on a phone: let the list scroll, or put the extra ones in a "More" menu outside the tab list.
- **Carousel**: a scrolling track with `scroll-snap-type`, real Previous and Next buttons, slides as a list with "slide 2 of 5" names, no auto-play (or a visible pause); content still reachable by plain scrolling.
- **Table on a phone**: keep a real `<table>`; let it scroll sideways inside its own box with a visible hint, or stack each row as a card with each cell's column name shown before it. A sortable table: buttons in the column headers and `aria-sort` on the sorted column.
- **Copy button**: a real `<button>` that copies, then says "Copied" in text (not only an icon) for a moment.

## Forms

- A visible `<label>` for every field; the right `type` (`email`, `tel`, `number`, `date`) and `autocomplete` values (`name`, `email`, `tel`, `street-address`, `postal-code`, `cc-number`, `one-time-code`) so phones fill them in.
- **Validation after interaction**: use `required`, `type`, `pattern`, `minlength`; show the error only after the person has left the field or tried to send (`:user-invalid`), never while they are still typing the first letters. Hints and rules **above** the field (keyboards and autofill cover what is below); the error in text next to the field, linked with `aria-describedby`; never colour alone.
- **Required fields**: say which ones in text ("required"), not only with a star.
- **Switch** (on/off): a checkbox with its label, styled as a switch; *(recent)* `<input type="checkbox" switch>`. It must still submit with the form and work with Space.
- **Choosing from a long list**: a `<select>` or a text field with `<datalist>`; a custom combobox only if needed, with the full keyboard pattern.
- **Enter key and Asian input methods**: do not send the form on Enter while a composition is in progress (`event.isComposing`).

## Theme and performance

- **Dark mode**: `<meta name="color-scheme" content="light dark">` in the head, `:root{color-scheme:light dark}`, colours as variables (or `light-dark()` *(recent; fallback: a `prefers-color-scheme` block)*). Check contrast in both.
- **Dark-mode toggle**: three choices (light, dark, like the system) is clearest; when the system is followed, keep `color-scheme: light dark`; apply the saved choice before the page is painted to avoid a flash. Sklubot pages cannot store anything: follow the system there.
- **Images**: `fetchpriority="high"` on the one main image of the first screen (one or two at most), never together with `loading="lazy"`; `loading="lazy"` on images further down; always `width` and `height` so the page does not jump; modern formats (WebP, AVIF) with a text alternative.
- **Fonts**: a fallback font with similar metrics so text does not jump when the web font arrives.

## Before handing over

Tab through every control, press Escape on every overlay, try the page at 390 px and at 200 % text, in light and dark, and with reduced motion. Say which recent features you used and which fallback covers the browsers that lack them.
