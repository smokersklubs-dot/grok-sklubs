---
name: Local SEO
description: Make a local business (shop, restaurant, craftsman, practice) easy to find nearby - its Google Business Profile, identical name, address and phone everywhere, reviews and honest replies, local pages and structured data, local links - with a prioritised list of quick wins, medium efforts and big moves.
---

> Adapted from claude-seo "seo-local" and its local schema and Business Profile references (© 2026 agricidaniel, MIT). Modified for Sklubot (2026-11-22): paid data services, maps APIs and third-party statistics removed; profile changes left to the owner or done only with their approval; review rules kept; condensed and translated into French.

# Local SEO

## 1. What kind of local business

- **Shop with a counter** (customers come): the address is shown everywhere.
- **Service area** (you go to customers: plumber, cleaner): the address may be hidden on the profile; list the towns served.
- **Both**.
Note the trade (restaurant, health, legal, home services, property, garage…): some have their own rules (health: never confirm in a reply that the reviewer is a patient).

## 2. Business Profile (Google, and Apple and Bing too)

Check with the owner, or in the browser when they give you access (never ask for their password; use a login saved in the vault or ask them to take over):
- the exact **primary category** and a few relevant secondary ones;
- name exactly as on the shop front (no keywords added: forbidden);
- hours (and holiday hours) right; phone; website address pointing to the right page;
- description written for customers; services or products listed with words customers use;
- recent real photos (front, inside, team, work); regular posts for news and offers;
- common questions answered on the website and in the description.
Every change to the profile is published in the owner's name: prepare it and ask for approval.

## 3. Name, address, phone: identical everywhere

Compare the name, address and phone on the website (visible in the HTML, in the footer and the contact page), the profile, social pages, directories (Pages Jaunes, Yelp, TripAdvisor, trade directories, the chamber of commerce). One spelling, one phone, one address format. List each difference with where to fix it.

## 4. Reviews

- How many, how recent, the average, on which sites; replies from the owner.
- Help the owner ask **every** customer for a review (a short link, a card at the counter). **Never** filter first ("happy? leave a review; not happy? write to us"): that is forbidden by the platforms and by consumer law. Never write or buy reviews.
- Draft replies for the owner: thank by name, answer the point, offer a solution offline for complaints, no private details. The owner approves before anything is posted.

## 5. The website

- Title and H1 with the service and the town; name, address and clickable phone (`tel:` link) visible; hours; a map (loaded lazily); a contact or booking action high on the page.
- One page per main service; for several shops, one page per shop with truly local content (team, access, parking, neighbourhood, photos), never copies with only the town changed.
- **Structured data**: `LocalBusiness` or the right subtype (`Restaurant`, `Bakery`, `Dentist`, `Plumber`…) with name, address, phone, hours, geo coordinates, site address, image, price range; `@id` unique per shop; `aggregateRating` only for reviews collected on the site itself, never copied from Google.

## 6. Local links and mentions

Local press, associations and clubs sponsored, suppliers and partners, local events, trade federations, the town hall's business directory. Quality and relevance over number.

## 7. The result

Three lists: **quick wins** (an afternoon: fix the phone on the site, add hours, categories), **medium efforts** (a few weeks: service pages, review routine), **big moves** (months: local content, links). Each item with the evidence and how to check it. Offer a monthly routine to watch reviews and the profile (routine_create shows the owner a card).
