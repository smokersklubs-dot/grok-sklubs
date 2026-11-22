---
name: Project brief
description: For a project the owner hands over (a website, a shop, a campaign, a big document), write a short brief - what, for whom, scenarios by priority, success criteria, what is out of scope, open questions - have it approved, check the plan against it before starting, and at the end tick each success criterion with its proof.
---

> Adapted from Spec Kit "specify", "analyze" and "converge" with its specification template (© GitHub, Inc., MIT). Modified for Sklubot (2026-11-22): rewritten for non-technical projects run by a Sklubot bot, files and git steps replaced by a Sklubot file and goal mode, translated into French.

# Project brief

A brief is a promise written down before the work: it says **what** and **why**, never **how**. It lets the owner check that you understood, and lets you prove at the end that it is done.

## 1. Write the brief

Save it as a file (file_save, e.g. projects/<name>/brief.md). Keep it to one or two screens:

```
# Brief: <project name>
Date: <date> · Asked by: <owner>

## In one sentence
<the result, for whom, why now>

## Scenarios (by priority)
1. [Must] <who> can <do what> — we check it by <how>
2. [Should] …
3. [Nice to have] …

## Rules and content
- <what it must show, say or do: prices, hours, products, tone>
- <constraints: budget, date, brand, languages, legal notices>

## Success criteria (measurable)
- <e.g. a visitor finds the phone number in under 5 seconds on a phone>
- <e.g. the order form reaches the owner's mailbox>

## Out of scope
- <what we explicitly do not do this time>

## Open questions
- [TO CLARIFY: …] (3 at most; for everything else, make a reasonable choice and write it under "Choices made")

## Choices made
- <a reasonable default you took, so the owner can change it>
```

Rules: plain words, no technical jargon; every scenario can be checked by looking; adjectives like "modern" or "fast" get a number or an example.

## 2. Have it approved

Show the brief (file_send, or a private page). Ask the open questions one at a time with your recommended answer (ask_user), update the brief, and wait for a clear yes before starting. For long work, offer goal mode (goal_propose) with the success criteria as the finish line.

## 3. Check the plan against the brief (before starting)

Read your plan or task list next to the brief, without changing anything, and look for:
- a scenario with no step that delivers it;
- a step that serves nothing in the brief (extra work);
- two parts that contradict each other (price, date, wording);
- a vague word still without a number.
Fix the plan, then start.

## 4. At the end: tick each criterion with its proof

For every scenario and success criterion, write DONE with the proof (a link, a screenshot, a test message received) or MISSING with what remains. Do the missing parts, or tell the owner plainly what is left and why. Never call the project finished while a "Must" line is missing.
