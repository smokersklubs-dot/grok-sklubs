---
name: Structured data and sitemap
description: The technical layers search engines read on a small business site - JSON-LD structured data of the right type (business, product, article, event, recipe…), checked and never claiming what the page does not show; an XML sitemap and robots.txt; language versions with hreflang; and images optimised (text alternatives, size, format, lazy loading).
---

> Adapted from claude-seo "seo-schema", "seo-sitemap", "seo-hreflang" and "seo-images" with their schema-type references (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): the plugin's scripts replaced by curl and Pillow on the bot's computer and checks with the official validators opened in the browser; condensed; translated into French.

# Structured data and sitemap

Search engine rules for these change: before relying on a type or a rich result, check its page in Google's search documentation (developers.google.com/search/docs/appearance/structured-data) and cite it.

## 1. Structured data (JSON-LD)

- **Detect**: in the page HTML (`curl -sL <address>`), find the `<script type="application/ld+json">` blocks; note their types.
- **Choose the right type** for what the page really is: `LocalBusiness` or a subtype (`Restaurant`, `Bakery`, `HairSalon`, `Dentist`…), `Organization` on the home page, `Product` with `Offer` (price, currency, availability) on a product page, `Article` or `BlogPosting` with author and dates, `Event` with dates and place, `Recipe`, `BreadcrumbList`, `VideoObject`, `JobPosting`.
- **Rules**: one JSON-LD block per entity, linked with `@id`; values identical to what the page shows (name, price, hours, address); real absolute addresses for images; dates in ISO format. Never mark up reviews or ratings that are not shown on the page or were copied from elsewhere.
- **Retired or restricted rich results** (check the current list before advising): FAQ rich results are no longer shown in Google results (FAQPage markup can stay but brings no visual benefit); several older types were retired (e.g. SpecialAnnouncement, CourseInfo, EstimatedSalary, VehicleListing). Never recommend a retired type as if it would show.
- **Check**: open Google's Rich Results Test and the schema.org validator in your browser with the address or the code; fix every error; warnings are listed for the owner.
- On Sklubot pages, add or fix the block yourself (page_edit); on the owner's site, give the ready-to-paste code and where to put it.

## 2. Sitemap and robots.txt

- **Existing sitemap**: declared in robots.txt (`Sitemap: https://…/sitemap.xml`); only canonical, indexable, final addresses returning 200 (no redirects, no "noindex", https only); `<lastmod>` only when the content really changed; `<priority>` and `<changefreq>` are ignored by Google (harmless, useless); a sitemap index above 50,000 addresses. Check a sample of addresses with `curl -sI`.
- **New sitemap**: one entry per real page; image sitemap entries only for important images.
- **robots.txt**: never block CSS, scripts or images the page needs; do not use it to hide private pages (use authentication or "noindex"). Blocking AI training crawlers is a separate choice of the owner, each crawler named on its own line; it does not remove the site from normal search.

## 3. Language versions (hreflang)

For a site in French and English (or several countries):
- each version lists **itself and every other version** (return links mandatory), with ISO codes: `fr`, `en`, `fr-BE`, `en-GB` (not `en-uk`, not `eng`);
- an `x-default` for the language-choice page or the main version;
- hreflang only on canonical addresses, all in https, matching the canonical exactly (same trailing slash);
- one method only (tags in the head, or in the sitemap for large sites);
- versions with the same content, really translated (not machine-translated without review), with local prices, units and contact details.

## 4. Images

- **Text alternative** on every informative image, describing what it shows (10 to 125 characters), with the useful words when natural; `alt=""` for decorative ones.
- **Weight and format**: judge the format actually served (`curl -sI` shows the content type), not the file extension; WebP or AVIF with a JPEG fallback through `<picture>`; on your computer, Pillow can convert and resize (e.g. a 2,000 px wide photo saved as WebP at quality 80).
- **Sizes**: `width` and `height` on every image (no layout shift); `srcset` and `sizes` for responsive images.
- **Loading**: `loading="lazy"` below the first screen, never on the main image of the first screen (which can get `fetchpriority="high"`).
- Descriptive file names (`bakery-sourdough-loaf.webp`, not `IMG_2041.jpg`).
Never suggest a new image address without checking it answers 200.
