---
name: SEO method and audit
description: Audit the search visibility of a small business site or one page - detect the kind of business, check crawling, indexing, security, addresses, phone display, speed, structured data and content, then give a prioritised plan where every fix says what it rests on and how to check it worked. No score without data.
---

> Adapted from claude-seo "seo", "seo-audit", "seo-page" and "seo-technical" with their quality gates and Core Web Vitals reference (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): the plugin's scripts, paid data services and PDF reports removed; checks done with web_fetch, the bot's browser and curl on the bot's computer; third-party statistics left out; a "no score without data" rule added; condensed and translated into French.

# SEO method and audit

## Rules first

- **No score without data.** Give a number only when it comes from a measurement you made (a status code, a size, a speed test). Otherwise describe the finding and its priority. Never invent search volumes, rankings or traffic.
- Search engines change: before quoting a rule or a threshold, check the official documentation (developers.google.com/search, Bing Webmaster guidelines) and cite it.
- Every recommendation carries: **what it rests on** (the observation), **what it depends on** (other fixes first?), **how we would know it failed**, and **a sign to watch** without redoing the audit.

## 1. Understand the site

Open the home page (browser_open, page_read). Identify the kind of business: **local** (address, phone, area served, map), **shop** (products, cart), **publisher** (articles, authors), **services / agency** (case studies), **software**. A local business gets "Local SEO" too; a shop gets "SEO for shops and comparisons".

## 2. Technical checks (9 families)

Use your computer for what the readable text hides: `curl -sIL <address>` (status, redirects, headers), `curl -sL <address>` then search the HTML for `<title>`, `name="description"`, `rel="canonical"`, `name="robots"`, `application/ld+json`, `hreflang`, `viewport`.

1. **Crawling**: /robots.txt exists and blocks nothing important; a sitemap exists and is declared; important pages within 3 clicks of the home page; no accidental "noindex".
2. **Indexing**: each page has a canonical pointing to itself (or the right page); no duplicates (www and non-www, http and https, parameters); one language per address.
3. **Security**: HTTPS everywhere with a valid certificate, http redirects to https in one hop; no mixed content.
4. **Addresses**: short, readable, hyphenated; no redirect chains (one hop at most, 301 for permanent moves).
5. **Phone**: viewport tag, readable without zoom, no sideways scroll, tap targets large enough, the same main content as on a computer, no pop-up covering the page on arrival.
6. **Speed (Core Web Vitals)**: largest content shown within 2.5 s, reaction to a tap within 200 ms, layout shift under 0.1 (for 75 % of real visits). Measure only with a real tool (Lighthouse on your computer if installed, or PageSpeed Insights opened in the browser); otherwise list visible causes (huge images, no image sizes, heavy scripts).
7. **Structured data**: JSON-LD present and valid for the right type (see "Structured data and sitemap").
8. **JavaScript**: the main text and links are in the HTML received, not only after scripts run (compare `curl` with what the browser shows).
9. **Other engines**: the site is also fine for Bing (Bing Webmaster Tools; IndexNow if the owner wants faster indexing there).

## 3. One page in depth

Title (unique, about 50-60 characters, the main words first, the town for a local business) · description (about 150 characters, a reason to click) · one H1 that says what the page is · headings in order · text that answers the visitor's question with first-hand detail · images with text alternatives, sizes and modern formats · internal links with clear words · contact or action visible · structured data matching what is on the page.

## 4. Content quality gates

- Each page answers **who** wrote it, **how** (first-hand experience, real photos, real figures), **why** (to help the visitor, not to catch clicks).
- No thin pages and no near-copies: many "town" pages that only change the town name are a risk; above about thirty such pages, each needs truly local content, and above fifty, ask the owner to justify each one.
- No hidden text, no keyword stuffing.

## 5. The plan

Group findings: **critical** (blocks indexing or breaks a page: fix now) · **high** (clearly hurts: this week) · **medium** (opportunity: this month) · **low** (backlog). For each: the finding, the evidence (status, extract, screenshot), the fix in plain words, who does it (you on Sklubot pages with page_edit; the owner or their web provider otherwise), the check. Deliver it as a private page or a file, with quick wins first. Offer "SEO monitoring" to keep a reference and catch regressions.
