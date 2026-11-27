---
name: Measured accessibility
description: Audit a page the bot published (or the owner's site) for accessibility and fix it - an automatic audit when Lighthouse or axe is available on the bot's computer, then headings and landmarks, names of buttons, fields and images, keyboard and focus, tap targets, contrast, zoom and motion - with a short report of what fails, where, and the fix.
---

> Adapted from chrome-devtools-mcp "a11y-debugging" (© 2025-2026 Google LLC, Apache License 2.0) and agent-skills "accessibility-engineering" with its accessibility checklist (© 2025 Addy Osmani, MIT). Modified for Sklubot (2026-11-22): the DevTools server tools replaced by Sklubot's browser tools (browser_open, element_snapshot, screen_key, screen_view) and an optional command-line audit on the bot's computer; installer script removed; translated into French. Updated 2026-11-25 (L115): the tools now come with the computer image (page_audit, sklubot-axe, mmdc).

# Measured accessibility

Accessible pages work for people who use a keyboard, a screen reader, a zoomed screen or a phone in the sun, and they are better for everyone. Measure, do not guess.

## 1. Automatic audit

For a page you published, or any http(s) address (the owner's site, a dev server on your computer), call **page_audit** (`name` or `url`): Lighthouse and axe run on your computer at phone size and you get the scores and the main failures; the full reports are saved in your library (`audits/…`). Do not paste them; open a part only for a detail.
From the shell, the same tools are on your computer (pinned versions, telemetry off, the computer's own Chromium):
- Lighthouse: `lighthouse <address> --only-categories=accessibility --output=json --output-path=/root/files/audits/a11y.json --chrome-flags="--headless=new" --quiet --no-enable-error-reporting`, then list only the failures (a short `node -e` or `jq` filter on audits with a score below 1: id, title, selector). Do not read the whole report.
- axe: `sklubot-axe <address> --json /root/files/audits/axe.json` prints one line per failed rule.
On a computer made from an older image these tools are missing (page_audit says so): do not install them yourself; the manual checks below still find most problems.

An automatic audit finds about a third of the problems. Always do the manual part.

## 2. Structure

Open the page (browser_open) and list its elements (element_snapshot).
- One `h1`, then headings in order (no jump from h2 to h4); headings describe their section.
- Landmarks: `header`, `nav`, `main`, `footer`; a "Skip to content" link when the menu is long.
- `<html lang="…">` matches the language; the page has a meaningful `<title>`.
- The reading order in the snapshot matches what you see on screen (screen_view).

## 3. Names

- Every button and link has a name a person understands out of context ("Book a table", not "Click here"; an icon-only button gets an `aria-label`).
- Every field has a visible label linked to it; errors are in text, linked to the field.
- Every informative image has a text alternative saying what it shows; decorative ones `alt=""`.
- Use native elements; ARIA only to fill a real gap, never `role="button"` on a `div` when a `<button>` would do.

## 4. Keyboard and focus

Press Tab from the top (screen_key "Tab"), several times, and look (screen_view):
- every control is reached, in a logical order, with a **clearly visible** focus;
- nothing traps the focus, except an open dialog, which keeps it inside and gives it back on close (Escape works);
- menus, tabs and accordions work with Enter, Space, the arrows and Escape;
- nothing important appears only on hover.

## 5. Visual checks

- **Contrast**: text at least 4.5:1 against its background (3:1 for large text and for icons and field borders). Compute it from the colour values in the styles; over a photo, look at the screenshot and add a backing if in doubt.
- **Not colour alone**: errors, required fields, the selected tab also have a word or a shape.
- **Tap targets** at least 44 × 44 px, with space between them.
- **Zoom**: at 200 % text and at 320 px wide, nothing is cut or overlaps, no sideways scrolling for text.
- **Motion**: animations stop with reduced motion; nothing flashes more than three times a second; videos have captions.

## 6. Report and fix

Write a short table: problem · where (element or selector) · who it blocks · fix · status. Fix what you can on pages you published (page_edit), then check again with the same steps. For the owner's own site, give the list in plain words with priorities: blocks someone first, then makes it hard, then polish.
