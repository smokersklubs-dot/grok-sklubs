---
name: SEO for shops and comparison pages
description: Search for online shops and decision pages - product pages that rank (title, description, images, specs, unique text, Product structured data), category pages, the gap between what searchers expect and what the page is, and careful "X vs Y" or "alternatives" pages that never state anything unverified about a competitor.
---

> Adapted from claude-seo "seo-ecommerce", "seo-sxo" and "seo-competitor-pages" (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): paid marketplace and shopping data services removed; a legal safeguard on competitor claims made mandatory; checks with curl and the bot's browser; condensed; translated into French.

# SEO for shops and comparison pages

## 1. Product pages

- **Title**: product name, a key feature, the brand; under about 60 characters ("Linen apron, cross-back, natural | Atelier Mila").
- **Description**: the product and a benefit, the price or "from …" when stable, an action (free delivery, order); under about 155 characters.
- **Headings**: one H1 with the product name (not repeated on variants); then features, specifications, reviews, related products.
- **Images**: at least three (main, detail, in use), real photos, descriptive text alternatives and file names, WebP with a JPEG fallback, lazy loading below the first screen only.
- **Text**: a unique description written for the customer (never the manufacturer's copy-paste), a specifications table, delivery and returns in plain facts, real customer reviews if there are any.
- **Links**: breadcrumb (Home > Category > Product), back to the category, related products.
- **Structured data**: `Product` with `Offer` (price, currency, availability, condition), `brand`, `sku` or `gtin` when known, `image`; `aggregateRating` and `review` only for reviews shown on the page; `BreadcrumbList`. Check with the Rich Results Test.
- **Variants and stock**: one canonical address per product, variants as options or with a canonical; out-of-stock pages kept with availability and alternatives, not deleted.
- **Category pages**: a short unique introduction, filters that do not create endless indexable addresses (canonical or noindex on combinations), pagination with real links.

## 2. Does the page match what searchers expect?

For the main search of a page, look at the first results (search_web or the browser): what **type** of page dominates (product pages, comparisons, guides, local results, tools)?
- A guide where people expect product pages → make a product or category page.
- A product page where people expect information → add a short educational part (how to choose, sizes, care).
- A service page where results are local → add the town, the map, local structured data.
Then compare with the top results: depth, clear action above the fold, phone layout, structured data, images and video, proof (reviews, guarantees, credentials), freshness. Picture two or three real customers (the hurried buyer, the careful comparer, the gift buyer) and check the page answers each one's first question. Describe the gaps and the fixes; give no score unless you measured something.

## 3. Comparison and "alternatives" pages (with care)

Pages like "our cake vs supermarket cake", "X or Y: which to choose", "alternatives to X".
- **Every statement about a competitor must be true, current and verifiable from a public source** (their website, their published prices, documentation), cited with a link and the date checked. No guesses, no "probably", no disparaging adjectives. When unsure, leave it out.
- Compare on criteria the customer cares about, in a clear table; say honestly where the competitor is better; date the page and review it when prices change.
- Never use a competitor's logo or imply a partnership. Trade-mark names may appear only to identify the product compared.
- Title patterns: "X vs Y: [main difference] ([year])", "Alternatives to X for [use]".
- Structured data: `ItemList` for a list; `Product` only for your own products.
- Before publishing, show the owner the list of claims about competitors with their sources: comparative advertising rules apply, and it is their decision. This is not legal advice; for a sensitive comparison, suggest checking with a professional.
