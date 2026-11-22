---
name: Site in several passes
description: Build a real multi-page site ("a 4-page site for my shop") instead of isolated pages - a site file with identity, look, a ticked site map and a prioritised to-do list; then one page per pass, each reading the site file and the brand sheet, sharing the same menu and footer, ticking its line and writing the brief of the next page.
---

> Adapted from google-labs-code/stitch-skills "site-md" and "stitch-loop" (© 2026 Google LLC, Apache License 2.0). Modified for Sklubot (2026-11-22): the relay method kept, the original design tool's generation, project files and local server replaced by Sklubot pages (page_publish, page_edit), the bot's browser for checks and the brand sheet; translated into French.

# Site in several passes

Four pages made one by one without a plan give four strangers. A site has one identity, one menu, one footer, and a list of what is done and what is left.

## 1. The site file (once)

Save sites/<name>/site.md (file_save):

```
# Site: <name>
## Identity
Name · Mission (1-2 sentences) · Audience · Tone (3 words)
## Look
Mood words, and "see ~/team/charte.md" (or the "Look" section of the brand sheet)
## Shared parts
Menu: <links in order> · Footer: address, hours, phone, legal notice, privacy
Page names: site-<name>-home, site-<name>-menu… (one page_publish name per page)
## Site map
- [ ] Home — <address once published>
- [ ] <Page 2>
## To do (by priority)
High: main pages and the customer's main path (find, choose, contact or order)
Medium: forms, secondary pages
Low: extras, illustrations, optional states
## Free ideas
Pages or touches that would fit if the list is empty
```

Have the owner approve it (ask_user with your recommended answer when a choice is open).

## 2. One page per pass

Each pass:
1. **Read** site.md, the brand sheet and the brief of this page (next-page.md; see "Sharpen a page request" for its format). Never rebuild a page already ticked.
2. **Build** the page with the shared menu and footer, the same styles (one shared stylesheet file given with each page) and real content only.
3. **Publish** it (page_publish, private until the owner says otherwise) under its planned name.
4. **Link** it: put its address in the menu of the pages already published (page_edit on each), and replace any "#" link that pointed to it.
5. **Check** it in your browser (browser_open, screen_view) at phone and computer width, and click through the menu from another page.
6. **Update** site.md: tick the page with its address, remove the used idea, update the to-do list.
7. **Write the next brief** in next-page.md: the next page from the to-do list (or a free idea), with its look block and its numbered sections.

Say at each pass which page is done and which one comes next. For a long site, offer goal mode (goal_propose) with "every line of the site map ticked" as the finish line.

## 3. Finishing

When the map is fully ticked, run "Check before delivering" on the whole site (every link, phone, address, legal notice, phone width, light and dark). Making it public (visibility "link") is the owner's decision, through the approval card.
