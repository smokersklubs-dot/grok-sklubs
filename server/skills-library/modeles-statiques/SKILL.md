---
name: Static page templates
description: Build a dashboard, a filterable table, a multi-step form or a kanban board from a ready, tested HTML file kept with this skill - start from the template, never from scratch, reread every line and replace each example value, then check it at phone and desktop width. Also how to do the same as a small React app.
---

> Adapted from Astryx (github.com/meta/astryx, commit fa22c93; © Meta Platforms, Inc., MIT): its page templates "dashboard-scorecard", "table-filter", "form-wizard" and "kanban-board" and its rule "start every page from a template". Modified for Sklubot (2026-11-22): rewritten as four HTML files without any library (kept with this skill), the workflow written for a Sklubot bot (skill_read with file, page_publish, screen_view), translated into French.

# Static page templates

Four ready pages are kept with this skill, as files. Each one already works on a phone and a computer, in light and dark, with the keyboard, with reduced motion, and has a real empty state. You start from one of them: the layout stays stable from one page to the next.

| File | For |
|---|---|
| `tableau-de-bord.html` | a dashboard: 3 to 5 key figures with their change, progress bars towards goals, a column "what to remember" |
| `tableau-filtrable.html` | a list to search, filter and sort (customers, products, orders), with a counter and a "nothing matches" message |
| `assistant-etapes.html` | a form in steps (quote request, sign-up): one question group per step, checks before going on, a review before sending |
| `kanban.html` | a board where each column is a state; cards move by drag and drop or with buttons (keyboard and phone) |

## The rule: start from a template, reread, replace

1. **Choose** the closest template from the table. None fits? Say so, and build from the closest one rather than from a blank page.
2. **Read it** with skill_read (name of this skill, file: the file name) and copy it into your work.
3. **Keep the frame**: the tokens at the top (`:root`), the spacing, the widths, the focus outline, `min-height: 100dvh`, the reduced-motion rule, the empty state. Change the content, not the skeleton.
4. **Replace every example value**: each place marked `REPLACE`, every name, figure, date and text. Use the owner's real data (their file, their numbers); a figure you do not have is removed, never invented.
5. **Reread the whole file** before showing it: no value left from the example, no raw colour outside `:root` (use a token), no text in another language than the page's.
6. **Check it**: publish it (page_publish), then look at it with screen_view at 390 px and at desktop width, light and dark; go through it once with Tab only. Fix before you show it.

## Branding

To match the owner's brand, change only the tokens at the top (colours, font, radius), from their brand sheet (`~/team/charte.md` if it exists) or a theme of « Thèmes sans marque ». Check the contrast of text on its background (4.5:1 at least).

## Option: a small React app

When the owner wants an app rather than a page (several screens, data that changes), build it as a small React app on your Linux computer (Vite) with the same structure: one component per block of the template (figures, bars, table, steps, columns), the same tokens in a CSS file, the same empty states and keyboard behaviour. Build it, then deliver the build (the files of `dist/`), not a description of it. The static template stays the reference for the layout.

## Never

- Never start a dashboard, table, form or board from a blank page when one of these templates fits.
- Never leave an example value in a delivered page.
- Never store visitors' data in the page: a page sends a form only to an address the owner chose.
