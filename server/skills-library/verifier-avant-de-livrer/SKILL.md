---
name: Check before delivering
description: Before something leaves for customers or the public (a page, a mass email, a quote, a post, a launch), check it against a checklist made for that deliverable, have it read by two independent reviewers who must both agree, score your own work on five points, and prove that a sent message really went out. Also how to repair a deliverable that does not work.
---

> Adapted from ECC "santa-method", "agent-self-evaluation" and "email-ops" (© 2026 Affaan Mustafa and ECC contributors, MIT), Spec Kit "checklist" (© GitHub, Inc., MIT) and agent-skills "shipping-and-launch" (© 2025 Addy Osmani, MIT). Modified for Sklubot (2026-11-22): merged and rewritten for non-technical deliverables, reviewers run as Sklubot helpers, code checks replaced by page, email and shop checks, translated into French.

# Check before delivering

One reviewer who made the work shares its blind spots. Two independent readers with the same grid catch what one misses. Use this before anything goes to customers or the public; not for internal drafts.

## 1. A checklist made for this deliverable

Write 8 to 15 yes/no lines that test the **deliverable against the request**, not your effort. Each line is checkable by looking. Examples:

- **Page or site**: every link opens; phone number and address are right and clickable; prices and hours match what the owner gave; legal notice and privacy page present; readable at phone width and on a computer, light and dark; images have a text alternative; the form really sends; no "lorem", no placeholder, no leftover note.
- **Mass email or newsletter**: right list; subject and first line say the point; every link works; unsubscribe link present; name and sender right; a test sent to the owner first.
- **Quote or invoice**: client name, amounts, VAT and totals recalculated; dates; payment terms; no other client's data.
- **Launch (shop, campaign, offer)**: what we watch the first day; who answers customers; plan B if something breaks (take the page down, pause the ad); the date and time the owner agreed.

## 2. Two independent reviewers

Start two helpers (helper_start). Give each **the same thing**: the original request, the deliverable (or its address) and the checklist, and nothing of each other's answer. Ask each to mark every line PASS or FAIL with the exact problem, and list blocking issues apart from suggestions.

- Both PASS: ready.
- Otherwise: fix **every** blocking issue, then run both reviews again on the new version.
- After three rounds without agreement, stop and show the owner the remaining points: they decide.

If helpers are not available, review twice yourself, the second time starting from the checklist only, and say so.

## 3. Score your own work

Give yourself 1 to 5 on each point, with one line of evidence for any score under 5 ("show the gap"):
- **Accurate**: facts, figures, names, prices right.
- **Complete**: everything asked is there.
- **Clear**: a non-specialist understands.
- **Usable**: the person can act on it now.
- **Short**: no filler.

Flag where you were more confident than your evidence allows.

## 4. Prove it went out

After an approved send, check the real result: the message is in the **Sent** folder of the right mailbox, the page answers at its address (web_fetch or browser_open), the post appears. Never say "sent" or "published" without that proof; if you cannot check, say so.

## 5. Repairing a deliverable that does not work

1. Reproduce the problem yourself and note exactly what happens (message, screenshot).
2. Find the smallest change that fixes it; change one thing at a time.
3. Run the checklist again on the whole deliverable, not only the fixed line.
4. Tell the owner what was wrong, what you changed and how you checked.

Sending, publishing and paying keep their approval cards: this skill adds checks, it never replaces an approval.
