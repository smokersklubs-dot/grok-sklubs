---
name: Handover note and weekly review
description: Keep a team of bots working smoothly - write a handover note when passing work to another bot or before a reset (goal, state, what failed and why, next steps), write the team's weekly review from what really happened, and, when the owner asks, propose their goals and rules quoting their own words.
---

> Adapted from claude-mem "handoff", "weekly-digests" and "owner-goals" (© 2026 Alex Newman, Apache License 2.0). Modified for Sklubot (2026-11-22): rewritten for Sklubot bots (bot_message, room_handoff, conversation_search, rule_propose, goal_propose) instead of the original memory server, transcripts and scripts; the three methods condensed into one skill; translated into French.

# Handover note and weekly review

## 1. Handover note

Write one when you pass work to another bot (bot_message, room_handoff), when the owner wants to start fresh, or when you notice you keep trying the same thing. Write it **for a reader who saw nothing** of this conversation. Save it (file_save, e.g. handovers/<subject>-<date>.md) and give its name in the message.

```
# Handover: <subject>
Date: <date> · From: <you> · To: <the next bot or "later">

## Goal
<the end result the owner wants, not the current small step>

## Where things stand
Working: <confirmed, with proof>
Not working: <exact symptom, exact error message>

## What was tried and why it failed
1. <what> — failed because <the real cause, not just "it did not work">

## Best current idea
<what you believe is the way forward, and why>

## Next steps
1. <concrete action: which page, file, tool, person>

## Things to respect
<owner's preferences, what they said NOT to do, deadlines, approvals still pending>

## Where to look
<files, pages, earlier conversations (conversation_search terms), tasks>
```

Rules: be precise ("the order form on /contact sends nothing since Tuesday; the mailbox shows no message"), quote errors word for word, no padding. The "what failed" part matters most: without it the next bot repeats your mistakes.

## 2. Weekly review of the team

When the owner asks (or in a routine they approved), write a short review of the week:
1. Gather facts: conversation_search over the week, tasks and their state, pages and files produced, approvals given or refused. Use only what really happened; never fill a gap with a guess.
2. Write it like a short chapter, linked to last week: start from what was open last week and say what became of it.
3. Sections: **done** (with links), **in progress**, **stuck and why**, **decisions the owner took**, **to decide next week**. One screen.
4. End with three lines carried to next week (open items, promises, dates), so next week's review can start from them.

## 3. Goals and rules in the owner's words (on request only)

When the owner asks "what do I want from you?" or "turn my habits into rules":
1. Read only what the **owner** wrote (conversation_search), not texts written by bots.
2. Sort each statement with three questions, in this order: is it about **how** work is done? A rule. Is it one request that can be finished? A task. Can you ask for things inside it? An area of work.
3. Keep their exact words with the date for each point ("« jamais de tutoiement avec les clients » — 12/11").
4. Where they changed their mind, show the change and keep the latest.
5. Propose each rule with rule_propose and a lasting objective with goal_propose: the card the owner sees is their decision. Never save a rule they did not confirm.
