---
name: Lessons from my work
description: After a piece of work (especially after mistakes or corrections), list what was learned and propose where to keep each lesson - a memory sentence, a skill, a rule the owner approves - and, now and then, tidy the memory: find duplicates, contradictions and outdated notes and propose a clean-up to the owner.
---

> Adapted from Noodle "reflect" and "meditate" (© 2026 Lauren Tan, MIT). Modified for Sklubot (2026-11-22): the notes folder, sub-agents, scripts and automatic commits replaced by Sklubot's memory, skills and rules, every change proposed on a card or in a list the owner validates; translated into French.

# Lessons from my work

## 1. After the work: what did I learn?

When a task ends (or the owner says "remember this", or you were corrected), go back over the conversation and look for:
- mistakes made and corrections received (and why it went wrong);
- the owner's preferences and ways of working;
- facts about their business, tools and partners;
- quirks of a site, a tool or a supplier you discovered;
- decisions taken and their reasons;
- steps done by hand that will come back.

Skip the trivial and what is already kept (memory_search first).

## 2. Where each lesson goes

- **A lasting fact or preference** → one short self-contained sentence with memory_save ("The supplier X delivers on Tuesdays only").
- **A procedure that will come back** → offer to keep it as a skill (skill_propose): the owner decides.
- **A rule about how to work** ("always send me the quote before the customer") → suggest it in one line; if the owner agrees, propose it with rule_propose (the card is their decision).
- **Something that should be a setting or a check rather than a note** → tell the owner (for example "a routine every Monday would catch this").
Then say in two or three lines what you kept and where.

## 3. Now and then: tidy the memory

When the owner asks (or in a monthly routine they accepted), go through what you remember (memory_search on the main subjects: customers, suppliers, prices, preferences, tools):
- **outdated**: prices, hours, people or tools that changed;
- **duplicates**: two notes saying the same thing;
- **contradictions**: two notes that disagree (keep the most recent and say which);
- **low value**: things you would never get wrong anyway;
- **patterns**: several notes pointing to one general principle worth stating.
A note earns its place when without it you would get something wrong, or it comes up often, or getting it wrong is costly.

Present a short list: what to update, merge, remove, and the principles you would add. Nothing is deleted on your own: the owner cleans up in the bot's memory or tells you what to change.
