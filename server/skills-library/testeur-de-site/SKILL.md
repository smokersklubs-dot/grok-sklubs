---
name: Site tester
description: Test a site or a page the way a customer would before (and after) it goes live - visit every section, click, fill forms, try empty and wrong inputs, at phone and computer width - and write a report where every problem comes with its steps and a screenshot, so it can be reproduced and fixed.
---

> Adapted from vercel-labs/agent-browser "dogfood" with its report template and issue list (© 2025 Vercel Inc., Apache License 2.0). Modified for Sklubot (2026-11-22): the command-line browser and its video recording replaced by Sklubot's browser tools (browser_open, element_snapshot, element_click, element_type, screen_view, browser_tabs) and screenshots; sign-in through the vault and the owner's takeover; report saved as a Sklubot file; translated into French.

# Site tester

Test like a customer who is in a hurry, on a phone, and makes mistakes. Every problem you report must be reproducible.

## Setup

Only the address is needed. Defaults: the whole site, phone width first, then computer width; report in your library (tests/<site>-<date>.md). If a part needs signing in, use a login saved in the vault (vault_type) or ask the owner to take over the screen for a code (ask_takeover). Never test payments with real money and never send a real order, message or booking without the owner's approval: stop at the last step and note it.

## The pass

1. **Orient**: open the home page (browser_open), list its elements (element_snapshot), note the main menu and the main path (find, choose, contact or buy).
2. **Explore section by section**, spending most time on what earns money or contacts:
   - click every button and link of the section (element_click), open menus and windows, check each opens the right thing (browser_tabs for new tabs);
   - fill the forms (element_type): a normal case, then empty fields, a wrong email, a very long text, accents and an apostrophe ("Zoé O'Neil");
   - look at empty and error states, the 404 page, what happens on the back button;
   - check the practical facts: phone clickable, address and map right, hours and prices identical everywhere, legal notice present;
   - look at each page (screen_view) at phone width and computer width, in light and dark if the site supports both.
3. **Document at once**: when something is wrong, stop and record it before moving on.

## Each problem

- **Title** in plain words ("The booking form accepts an empty date").
- **Severity**: blocking (a customer cannot finish) · major (confusing, wrong information) · minor (looks) · suggestion.
- **Where**: page address and element.
- **Steps**: numbered, from the home page, at human pace, with a screenshot of the steps that matter and of the broken result.
- **Expected** versus **what happens**.
Do not report what you cannot reproduce twice; note it apart as "seen once".

## What to look for

Broken links and buttons · forms that send nothing or lose what was typed · error messages missing or unclear · wrong or contradictory facts (prices, hours, address) · text cut or overlapping at phone width · sideways scrolling · images missing, blurry or very slow · controls too small to tap · nothing visible when focused with the keyboard · leftover placeholder text · pages very slow to show something · spelling mistakes in titles and buttons.

## The report

Start with a summary: how many problems by severity, the three to fix first, what was **not** tested (signed-in areas, payment). Then the problems, blocking first. Save it (file_save) and show it (file_send). For pages you published, offer to fix them (page_edit) and test again; when the owner wants this regularly, offer a routine (routine_create shows them a card to accept).
