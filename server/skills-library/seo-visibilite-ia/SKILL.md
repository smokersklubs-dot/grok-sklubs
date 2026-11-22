---
name: Visibility in AI answers
description: Help a small business appear and be cited in AI search answers and be usable by AI agents - the fundamentals first (it is still SEO), quotable answer blocks, clear entities and consistent business facts, which crawlers can read the site, server-rendered content, an accessible page structure agents can use - and an honest report without invented scores.
---

> Adapted from claude-seo "seo-geo" and "seo-agentic" (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): paid data services, third-party scanners and statistics removed; checks done with curl, web_fetch and the bot's browser; claims kept only where the original cites a primary source; condensed; translated into French.

# Visibility in AI answers

## Start from the primary source

Google's position (Search Central documentation on AI features): optimising for AI search is optimising for search, so **it is still SEO**. Many popular tricks (special AI files, cutting text into chunks, rewriting for AI, buying mentions) are not documented levers. When a blog contradicts the search engines' own documentation, follow the documentation and say so. Check the current pages before quoting them.

Never give a "visibility score" for an AI platform you did not measure with a real tool. Describe findings and priorities instead.

## 1. Content that can be quoted

- Each important question gets a heading phrased like the question and, right under it, a **self-contained answer** of a few sentences with a precise fact (a price, a delay, a place, a number the owner gave).
- Definitions in plain form ("A sourdough loaf is…").
- Claims attributed to a named source; first-hand details only the business has (its own data, photos, cases).
- Clean heading order, short paragraphs, tables for comparisons, lists for steps.
- Text plus real images and, if available, video with a transcript.

## 2. A clear, consistent entity

- The business described the same way everywhere: name, what it does, where, since when, who runs it (site, Business Profile, social pages, directories, press).
- An "About" page with real people, an `Organization` or `LocalBusiness` structured data block with `sameAs` links to the official profiles.
- Mentions in places people trust (local press, trade associations, serious forums) matter; never fake them.

## 3. Who can read the site

Read `/robots.txt` (`curl -s https://<site>/robots.txt`) and say, crawler by crawler, what is allowed. Explain the difference, which the owner decides:
- **search and citation** crawlers (they make the site appear in answers with a link);
- **training** crawlers (they use texts to train models; blocking them does not remove the site from search).
A robots.txt that answers with a server error can be read as "everything blocked": check its status code. `llms.txt` can be reported as present or absent, but it is not a known citation lever: do not promise results from it.

## 4. Usable by agents

AI agents increasingly read pages and click for people (booking, comparing, ordering):
- the main content and links are in the HTML received (compare `curl -sL` with the browser), not only drawn by scripts;
- buttons and fields have real names and labels (check with element_snapshot: an agent sees what a screen reader sees);
- forms work with the keyboard, without hidden traps; prices and availability are in text, not only in images;
- no wall blocks normal visitors (only test bot blocking if the owner controls the site and agrees).

## 5. Report

Sections: what the search engines' documentation says · quotable content found and missing · entity consistency (differences to fix) · crawler access (each one, its status, the owner's choice) · agent usability · recommendations, each with its evidence and how to check it. Quick wins first; changes to robots.txt or blocking choices only with the owner's decision.
