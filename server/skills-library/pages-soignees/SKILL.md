---
name: Polished pages
description: When a result reads better as a page than as a message (report, dashboard, tool, slides, mini-game), build a polished web page, publish it privately with page_publish, check it, then share it with the user's approval.
---

# Polished pages (like artifacts)

An original Sklubot skill.

## 1. Page or message?

Make a page when the result:
- will be re-read, kept, shown to others or opened on a phone (report, comparison, plan, minutes);
- is a tool people use (calculator, simulator, dashboard with charts, checklist, quiz, mini-game, slides);
- needs layout: long tables, charts, sections, pictures.

Answer in the chat when it is short (an answer, a few lines, a quick list), when the user only wants an opinion, or when they are working on another file. When unsure, answer in one line and offer the page.

## 2. What a page can do (the server's exact rules)

A Sklubot page is served apart, in a sandbox: its JavaScript runs, but as a stranger to the site, with no cookie and no access to the account or to Sklubot's API. In practice:
- **Files**: one main HTML file, plus up to 20 text files next to it (`files` of page_publish: .css, .js, .mjs, .json, .csv, .svg, .txt, .md). Refer to them by a relative path (`style.css`, `data/sales.json`). Size: 2 MB for the HTML, 1 MB per file, 5 MB in all (less on a free plan: the server tells you).
- **Scripts and styles**: inline in the HTML, in your files, or from these CDNs only: `https://cdnjs.cloudflare.com`, `https://cdn.jsdelivr.net`, `https://unpkg.com`. Always pin an exact version (e.g. `chart.js@4.4.1`), never "latest".
- **Fonts**: Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`), the CDNs above, or system fonts.
- **Pictures, sound, video**: https, `data:` or `blob:` addresses. Only use pictures you have the right to (your own, image_generate, or a licence you checked).
- **Data**: `fetch()` only reaches the page's own files. A page cannot call an outside API: get the data beforehand (search_web, web_fetch, your computer) and put it in the page or in a `.json` file of the page.
- **Blocked by the sandbox**: cookies, localStorage/sessionStorage (they throw: wrap them in try/catch or keep state in memory), forms posted to a server, `alert()`/`confirm()`/`prompt()`, frames (iframe) of other sites. Links that open a new tab (`target="_blank"`) work.
- The page is not indexed by search engines.

## 3. Building it well

- **Real content only**: never invented figures, reviews, testimonials, logos or names. When a piece of data is missing, write "to be completed" or ask for it. Cite your sources at the bottom.
- **Title and description**: a short, meaningful `<title>` (2 to 6 words), a one-sentence description at the top; `<html lang="en">` (or the user's language), `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width,initial-scale=1">`.
- **Structure**: the result first (the answer, the key figure, the action), then the detail. Headings `h1` → `h2` → `h3` in order, short sections, tables to compare.
- **Typography**: one or two families, a clear scale (e.g. 16 px base, line height 1.5), lines of 60 to 80 characters at most.
- **Responsive from 360 to 1440 px**: fluid layout (grid/flex, `max-width`, `clamp()`), no fixed widths, no sideways scrolling; wide tables scroll inside their own box. Tap targets of at least 44 px on phones.
- **Light and dark**: define colours as CSS variables on `:root` and redefine them in `@media (prefers-color-scheme: dark)`; always give `body` an explicit background.
- **Accessibility**: contrast of at least 4.5:1 for text (3:1 for large headings and icons), visible keyboard focus, `alt` on pictures, real `<button>`s (not clickable `div`s), labels on fields, `prefers-reduced-motion` respected.
- **Charts**: a library from an allowed CDN, pinned, or hand-made SVG; axes and legends readable in both themes.
- **Style**: a real direction chosen for the subject rather than a generic template (see the "Frontend design" skill if you have it, and "Brand design" for the account's colours).

## 4. Publish, check, share

1. **Private first**: `page_publish` with `visibility: "private"` (only the user, signed in, can open it). `name` is the page's file name: publishing again under the same name updates the page at the same address and keeps the previous version in its history.
2. **Check before saying it is ready**: re-read the HTML (closed tags, file paths, CDN versions), then look at the page if you have a computer: save a copy there and open it in your browser (browser_open then screen_view), at phone and desktop widths, light and dark. A private page does not open in your own browser (it needs the user's sign-in): check a local copy instead.
3. **Fix with page_edit**: small exact replacements (`find` → `replace`; each text to find must appear exactly once; all or nothing). Add `file` to change a file next to the HTML. Publish everything again only when the page changes a lot.
4. **Share**: a "link" page (`visibility: "link"`) can be opened by anyone with the address. Publishing that way asks the user's approval (an approval card appears): say in one sentence what will be visible. The user can later make it private again, change its link (the old one stops working), go back to an earlier version or delete it in Settings → Pages.
5. **Hand back**: the link, what the page does in one sentence, what remains to be completed.

## 5. Never

- Put a key, a password or private data in a page or its files (a page's code can be read in full).
- Publish as "link" without the user's approval, or a page that imitates a real site, brand or person.
- Copy another site's text, code, logo or pictures without a licence that allows it.
