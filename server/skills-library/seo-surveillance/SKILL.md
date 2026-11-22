---
name: SEO monitoring
description: Keep a reference snapshot of the SEO elements of a site's key pages (title, description, canonical, robots, headings, structured data, social tags, status, a content fingerprint) and compare it after every change or every week in a routine, flagging regressions by severity - critical, warning, information - with the fix.
---

> Adapted from claude-seo "seo-drift" and its comparison rules (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): the plugin's database and scripts replaced by a JSON snapshot in the bot's file library and curl on the bot's computer; the 17 rules condensed; runs in a Sklubot routine the owner accepts; translated into French.

# SEO monitoring

A site often loses visibility because of an unnoticed change: a "noindex" left after a redesign, a deleted title, structured data gone. A reference snapshot catches it the same week.

## 1. The reference snapshot

With the owner, list the key pages (home, main services or products, contact; 5 to 20 addresses). For each, on your computer:
- `curl -sIL <address>`: final status code and redirects;
- `curl -sL <address>`: in the HTML, the `<title>`, the meta description, `rel="canonical"`, the meta robots, every H1, the H2s, the JSON-LD blocks, the `og:` tags;
- a fingerprint of the main text (`sha256sum` of the visible text) and of the structured data.
Save everything as monitoring/<site>/reference-<date>.json (file_save), with the date. If a speed measurement is available (Lighthouse installed), add it; otherwise leave it out, never estimate it.

## 2. Comparing

Take the same snapshot again and compare page by page.

**Critical** (act now):
- structured data that existed is gone;
- canonical changed or removed;
- "noindex" added;
- H1 or title removed;
- status now an error (4xx, 5xx) or a redirect that was not there.

**Warning** (look this week):
- title or meta description changed; first H1 changed a lot (more than half different);
- structured data content modified; social (`og:`) tags removed;
- H2 structure changed; speed clearly worse (when measured: more than 20 %).

**Information**: new structured data added; main text changed (normal after an update, worth knowing).

For each difference: the page, before and after (exact text), the severity, the likely cause (redesign, plugin update, new page builder) and the fix. A change the owner made on purpose becomes the new reference once they confirm it.

## 3. As a routine

Offer a weekly routine (routine_create; the owner sees a card and accepts): take the snapshot, compare with the reference, write nothing in the chat when nothing changed (stay_quiet), and report only differences, critical ones first. Also run a comparison right after any redesign or update of the site.

Keep the history (one file per comparison) so you can answer "since when?" when traffic drops.
