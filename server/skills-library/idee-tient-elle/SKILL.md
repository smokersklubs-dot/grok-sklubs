---
name: Does my idea hold up?
description: Help a business owner sharpen a raw idea (a product, a service, a shop, a campaign) and test it before investing - restate it, open five to eight variations, keep two or three directions, stress-test them, and give a reasoned verdict go / needs work / stop, on a one-page summary.
---

> Adapted from agent-skills "idea-refine" (© 2025 Addy Osmani, MIT), ECC "product-lens" (© 2026 Affaan Mustafa and ECC contributors, MIT) and Spec Kit "assess" (© GitHub, Inc., MIT). Modified for Sklubot (2026-11-22): merged into one method for small-business owners, code and repository steps removed, verdict grid kept, output as a Sklubot page or file, translated into French.

# Does my idea hold up?

You are a sharp, kind thinking partner, not a yes-machine. Push towards the simplest version that still solves a real problem, and say plainly when an idea is weak.

## 1. Understand and open up

1. Restate the idea in one sentence: "How could we help [whom] to [do what] so that [result]?"
2. Ask **3 to 5** sharpening questions, one at a time (ask_user, with your recommended answer), only on what you cannot find yourself:
   - Who exactly is it for (a person, not "everyone")?
   - What hurts today: how often, how much, what do they do instead?
   - Why now: what changed?
   - How will we know it works (a number, not a feeling)?
   - What is the limit: budget, time, people?
3. Offer **5 to 8 variations**, each with one line on why it exists. Useful angles: do the opposite; remove the budget limit; another audience; combine with a neighbouring idea; the version ten times simpler; what an expert of the trade finds obvious.

## 2. Narrow down and stress-test

After the person reacts, keep **2 or 3 distinct directions**. For each:
- **Value**: who gains and how much? A painkiller or a vitamin?
- **Feasibility**: cost, the hardest part, what the person can really do.
- **Difference**: why would someone switch from what they use today?
- **Hidden bets**: what must be true but is not proven yet, what could kill it, what we choose to ignore for now.

Check facts with your tools (search_web, web_fetch, deep_research_start for a larger question): competitors, prices, demand. Cite the sources; never invent a figure or a market size.

## 3. The verdict

Rate each line strong / fair / weak / unknown, with one line of evidence:

| Criterion | Rating | Why |
|---|---|---|
| The problem is real | | |
| Evidence (not just belief) | | |
| Better than doing nothing | | |
| Doable with the means at hand | | |
| Risks understood | | |

- **Go**: the problem is at least fair **and** the evidence at least fair (never weak or unknown), with a chosen direction.
- **Needs work**: promising, but list exactly what must be found out and how (a call to five customers, a test page, a price check).
- **Stop for now**: say the decisive reason plainly (weak problem, better option exists, costs more than it brings).

When the evidence is thin, the honest verdict is "needs work", not "go".

## 4. The one-page summary

Deliver it as a page (page_publish, private by default) or a file (file_save, e.g. ideas/<name>.md), after asking which one the person prefers:

- The problem, in one sentence
- The chosen direction and why (two short paragraphs)
- Bets to check, each with how to check it
- The smallest first version: what is in, what is out
- **What we are not doing, and why** (often the most useful part)
- Open questions
- The verdict and its scorecard

Then stop and let the person decide the next step. Starting the work is their call.
