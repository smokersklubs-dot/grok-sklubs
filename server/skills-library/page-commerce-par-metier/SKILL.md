---
name: Business page by trade
description: Build the page of a small business so it works like the good sites of its trade - name the visitor's job (book, visit, buy, attend, hire…), follow that trade's anatomy, pick one of a few page structures, put the hero first, ask once for the real material (photos, figures, quotes), never invent a fact, and review it cold before handing it over.
---

> Adapted from Hallmark (© 2026 Hallmark contributors, MIT): its "Floor", the anatomy by visitor job, the page structures and the hero-first and cold-review steps. Modified for Sklubot (2026-11-22): condensed for small-business pages published with page_publish, its scripts, theme dealer and linter replaced by a short base stylesheet and checks in the bot's browser, sponsor line and product name removed from the method, translated into French.

# Business page by trade

A page made with no idea of the trade looks generated. Real sites of a trade share a shape: where the action sits, which sections they have, how they end.

## 1. Ask once, in one message

"Before I build, four things: 1. **Material**, the one that matters most: your photos, real figures (prices, opening hours, years, customers), a customer quote with its author's name, logos you may use. 2. **Who** the page is for. 3. **What visitors should do** (book, come, order, call). 4. **The tone**." What is not answered: infer it and say so in one line. **Facts are never inferred**: a price, a date, a quote or a figure not given stays a visible blank to fill ("Hours to come"), two at most on the page, listed in your hand-over.

## 2. The visitor's job and the trade's anatomy

- **Book** (restaurant, class, clinic, salon): the booking action in the menu bar and the first screen, again next to the menu or the timetable; sections: the room or the food in a photo, the menu with prices, the timetable, how to find it, hours and address. Ends with hours, address and booking.
- **Visit** (shop, gallery, venue): today's hours and the address at the top; what is on now; what is coming as dated rows; for a shop, the shelves with the owner's products; getting there.
- **Buy** (a product, a small shop): the product with price and options, often as the first screen; the range with prices; the product in use, close; how it is made; delivery and guarantee as plain facts; reviews only if given.
- **Attend** (event, fair, race): date and place are the headline; tickets from the first screen; the programme by day; prices; venue and travel; questions.
- **Hire** (craftsman, studio, freelancer): a plain contact (phone, email) at the top and after the work; the work as the page: projects with photos, one opened as a case; what they do in a short list; where.
- **Join** (club, association, membership): "your first visit" at the top; what a session is like, shown; when and where; prices; first-visit guidance.
- **Subscribe** (newsletter, waiting list) and **Listen** (band, podcast): the latest issue or release with its buttons side by side; dates as rows; earlier work.
- **Try** (an app): store buttons under the title; screens of the real product.

Pages end, in the order real sites use: the main action again in a short band; practical details (hours, address, contact); more of the catalogue; a short trust line (guarantee, press) if given; a mailing list only for things that recur.

## 3. Pick a structure (one)

Photographic (a huge photo per screen, little text) · Catalogue (a regular grid of the products) · Long document (reads like a letter or a menu) · Bento grid (blocks of different sizes, each a real thing) · Split studio (text on one side, proof on the other) · Letter (first person, from the owner) · Questions and answers · Marquee (one strong statement fills the first screen) · Index (a list of links). Typical picks: restaurant or café → Photographic, Long document or Catalogue; shop → Catalogue, Photographic or Bento; craftsman or studio → Split studio or Index; event → Marquee or Photographic.

## 4. Build: the first screen first

- First screen: a title of seven words or fewer, one sentence of twelve words or fewer, one or two actions, all visible on a 1280 × 800 screen and on a phone without scrolling.
- Six to nine sections in all, about 80 words per screen, one idea per screen.
- Show, do not describe: the owner's photos; otherwise a clearly marked image slot, never a stock photo passed off as theirs.
- One main button style, one container width, one corner radius per level, two font families at most, body text 16 px or more.

Start from this base stylesheet (adapt the values to the brand sheet):

```css
:root{--bg:#fbfaf7;--text:#1d1c1a;--muted:#6b675f;--accent:#9a3b1f;--font-head:"Fraunces",Georgia,serif;--font-body:"Source Sans 3",system-ui,sans-serif;--radius:10px;--max:72rem}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--text:#f1eee8;--muted:#a7a196;--accent:#e08a66}}
html,body{overflow-x:clip;margin:0;background:var(--bg);color:var(--text);font:1rem/1.6 var(--font-body)}
.wrap{max-width:var(--max);margin-inline:auto;padding-inline:clamp(16px,4vw,40px)}
h1,h2,h3{font-family:var(--font-head);overflow-wrap:break-word;min-width:0;line-height:1.15}
.grid{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))}
img{max-width:100%;height:auto;display:block}
a,button{min-height:44px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;transition:none}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.fill{color:var(--muted);outline:1px dashed var(--muted);padding:0 4px}
```

## 5. Hard rules (never)

Invented figures, reviews, logo walls or client counts · `transition: all`, or animating width, height, top, left · `overflow-x: hidden` or `100vw` widths · an animation without a reduced-motion fallback · content invisible without scripts · a purple-to-blue gradient, a card inside a card, emojis as icons · small labels in spaced capitals above titles · colours or fonts written outside the variables.

## 6. Review it cold

Open the published page (browser_open; screen_view at phone and computer width, light and dark) as a first-time visitor: can I see what it is, where, when, how much, and what to do, in five seconds? Fix, then run "Check before delivering". End your message with the material still missing (each blank and what belongs there) and the one photo or fact that would most improve the page.
