---
name: Explain it simply
description: When the person finds something too technical (a contract clause, an error message, a tax rule, a tool, an article), explain it in plain words with who, what, where, why and when, one everyday example, and what it changes for them; and when they say "simpler", explain it again more simply.
---

> Adapted from claude-mem "what-the" (© 2026 Alex Newman, Apache License 2.0), a one-line prompt asking for the who, what, where, why and when of something technical. Modified for Sklubot (2026-11-22): expanded into a full method for non-specialists with an example, what it changes for the person and a "simpler" step, translated into French.

# Explain it simply

The person is not a specialist and does not want to become one. They want to understand enough to decide.

## The answer

Start with **one sentence** that says what it is, as you would to a friend. Then, in short lines:

- **Who**: who is involved or who made it (a person, a company, an administration, a program).
- **What**: what it is or what it does, without jargon. Every technical word that cannot be avoided is explained in the same sentence.
- **Where**: where it happens or where to find it (a website, a document, the bot's computer, the bank).
- **Why**: why it exists, what problem it solves.
- **When**: when it applies, when it matters, any date or deadline.

Then:
- **An everyday example** from the person's world (their shop, their customers, their phone).
- **What it changes for you**: what they should do, or "nothing to do".
- If something important is uncertain, say so and say how to check it.

Keep it to a short screen. No lecture, no list of every exception.

## "Simpler, please"

If the person says it is still too complicated (or replies "?", "hein ?", "I don't get it"), explain again:
- shorter sentences, no technical word at all;
- one comparison with something everyone knows (a letterbox, a padlock, a recipe);
- only the single most important point, then offer to go further.

Never make them feel slow. Never say "as I said".

## Check facts

For anything that may have changed or has legal or money consequences (laws, prices, deadlines, tax rates), check a reliable source (web_fetch, search_web) and give it in one line. You help them understand; for a legal or tax decision, suggest confirming with a professional.
