---
name: Page recipes
description: Proven structures for the pages people ask for most - dashboard, finance or activity report, product spec, meeting minutes, OKR tracker, runbook, task board, documentation page, pricing page, landing page, invoice, keep-updated page - each with its sections, charts and self-check, to build with page_publish.
---

> modeles-de-pages — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot: the structures of thirteen OpenDesign design templates were condensed into one list of recipes for Sklubot pages; "believable invented numbers" were replaced by real data or "to be completed"; OpenDesign's artifact tags, comment ids and viewer were removed; translated into French.

# Page recipes

A recipe is the skeleton of a page that works; you bring the real content and the look (the account's brand, or a "Starter design systems" style). Build the page following "Polished pages" (sandbox, files, light/dark, publish privately, check, share) and check it with "Design craft rules". For a slide deck, use "Slide decks".

**Rules for every recipe**
- One self-contained HTML file (CSS inline, or a `style.css` next to it); semantic regions (`header`, `nav`, `aside`, `main`, `section`, `footer`); CSS Grid for the layout, Flexbox inside blocks.
- **Real data only**: the user's figures, files, connected tools or cited sources. A missing value is shown as "to be completed", never invented. Put the data in the page or in a `.json` file next to it (`fetch('data.json')`), never fetched from an outside API.
- Accent at most twice per screen. Charts: inline SVG or a pinned library from an allowed CDN; every series has a label and a legend; tooltips show the exact value.
- Must work from 360 px to 1440 px: sidebars become a top menu, tables scroll inside their box.

## Dashboard (admin, analytics, sales, operations)
- Left sidebar 220–260 px (name, 6–8 links, active item in accent) — or a top bar on small pages; top bar with title, period and last update time.
- Row 1: 3–4 key-figure cards (label, big number, change vs. the previous period with direction and %). Row 2: one main chart (line or bars, 2/3 or full width). Row 3: a second chart or a table (recent events, top items).
- Check: sidebar and top bar stay in place, the main area scrolls; density follows the style (airy or tight); the date of the data is written.

## Finance or activity report
- Header: entity, period, "Confidential" badge if it is. 4 key figures (e.g. revenue, net new, margin, cash runway). Trend chart, cost breakdown with a 2–3 line caption, summary table (current vs. previous period), main accounts or projects, outlook paragraph, author and date.
- Check: every figure appears in a labelled chart or table; every change shows direction and %; sources at the bottom.

## Weekly update
- Header (team, week, author). The headline: one sentence + the one number that matters this week. Shipped (3–5), in progress (3–5 with owners), blocked (1–3 with a clear ask), 1–2 metrics charts, asks for next week with names. As a deck, one block per slide.

## Product spec (PRD)
- Header strip: title, status (Draft / Review / Approved), date, owner. Three-line summary: what, for whom, why now. Problem (one paragraph + a real quote if there is one). Goals and non-goals in two columns. Success metrics table (metric, target, how measured). User stories ("as a… I want… so that…"). Milestones (3–4 phases). Open questions with who answers. Decision log.

## Meeting minutes
- Title, date, time, place or call link, attendees. Agenda (4–6 items, ticked when covered). **Decisions** in a strong block. Action table: action, owner, due date, status. Open questions and next meeting.
- Write only what was said or decided; mark "to be confirmed" what is unsure.

## OKR tracker
- Banner: quarter, dates, overall progress. 3 objective cards: title, owner, status (On track / At risk / Off track — with a word, not colour only), 3 key results each (metric, current → target, progress bar). Side column: key figures, biggest moves, blockers.

## Runbook (procedure for a service)
- Header: service, owning team, severity level, version. Summary + dependencies. Alerts table (name, severity, meaning, first response). Dashboards and links. 3–4 procedures with code blocks (deploy, roll back, rotate a key — never a real secret). On-call rota. Incident checklist in 5 numbered steps.

## Task board (kanban)
- Top bar: project, sprint, filters, search. 4 columns (To do, In progress, In review, Done) with counts; cards with tag, title, owner, estimate. Side panel: sprint progress, blocked items. Remember a page cannot save: it shows the board; changes go through you or the real tool.

## Documentation page
- Three columns: navigation (240–280 px, groups of links, current page marked), article (max ~720 px: title, lead, H2 sections, code blocks, notes and warnings, tables), "On this page" table of contents (200–240 px) with anchors on every H2/H3.
- Below 900 px the table of contents disappears and the navigation goes on top. Use logical CSS (`margin-inline-start`, `text-align: start`) so a right-to-left language flips correctly.

## Pricing page
- Opening (title, one line, optional monthly/yearly switch), one card per plan (name, price in the display font, one positioning line, 4–6 features, a button; the recommended plan marked once), a comparison table grouped in 2–3 sections with a sticky header, a FAQ with `<details>`, a closing call to action.
- 3 plans is the default (2 for personal/pro, 4 for "enterprise plus"). Real prices and features from the user, never "$X / month".

## Landing page
- Opening (name, headline, 1–2 sentence subhead, main and secondary button), 3–6 features (simple line icon, title, 1–2 sentences), proof (real customers or quotes only, else skip the section), pricing if wanted, closing call to action, a small footer.
- Vary at least one section so it does not read as a template; check at 1440, 768 and 375 px.

## Invoice or quote
- Top band: sender, "Invoice" + number + date + due date. From / Bill to. Reference and payment terms. Lines (description, quantity, unit price, amount), totals aligned right (subtotal, tax, total due), payment instructions, note. A print style (`@media print`) without backgrounds. The figures and legal mentions come from the user; you never send it yourself without their approval.

## Keep-updated page (live report)
- When the user wants a page kept up to date: put the data in a `data.json` next to the HTML and render the page from it, with the time of the last update and the source visible.
- To refresh: get the new data (connected tools, web, files), then change only `data.json` with `page_edit` (`file`), so the layout and any human edits stay. Say what changed since the last update. If a schedule is wanted, set it up with the user's approval.
