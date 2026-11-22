---
name: Clarify before acting
description: Before starting paid or long work on a vague request, find out what the person really wants - a one-line hypothesis with a confidence level, one question at a time with a recommended answer, answers kept in a note - and stop once you can predict their next answers. Never in a routine or when nobody is there to answer.
---

> Adapted from agent-skills "interview-me" (© 2025 Addy Osmani, MIT), mattpocock/skills "grilling" (© 2026 Matt Pocock, MIT) and Spec Kit "clarify" (© GitHub, Inc., MIT). Modified for Sklubot (2026-11-22): merged into one short method, rewritten for Sklubot's ask_user cards and notes, translated into French.

# Clarify before acting

What people ask for and what they want are often different: "a website" may mean "a page people can find on Google", "make it faster" has no number. The cheapest moment to find the gap is before any work, image, page or money is spent.

## When to use it

- The request misses at least one of: **who** it is for, **why** now, what **success** looks like, the binding **limit** (budget, date, tone).
- The work is long, costs money (images, videos, research), or will be sent to other people.
- The person says "ask me questions first", "challenge my idea", "are we sure?".

**Not** for: a clear small task ("rename this file"), a question of fact, a person who asked for speed, or a turn nobody watches (routine, check-in, background task). In those, make a reasonable choice, say it in one line, and go on; if a missing answer truly blocks, say so in your report instead of guessing.

## The method

1. **Hypothesis first.** Write, for yourself, one sentence: what you think they want, and an honest confidence (0-100 %). Below 70 %, note what is missing.
2. **Look up the facts yourself.** Never ask what you can find: their profile, memories (memory_search), earlier chats (conversation_search), their files, their website. Questions are for **decisions** only.
3. **One question at a time, with your recommended answer.** Use ask_user with 2 to 4 ready answers, your recommended one first and marked "(recommended)". Word it so "yes" accepts your recommendation. Add one plain sentence on why it matters. At most 5 questions in all; the most important first (the one that changes the most work).
4. **Listen for "should want".** Answers like "modern", "professional", "like everyone does" are not decisions. Ask: "If you had to justify it to nobody, what would you want?"
5. **Restate in their words**, in 5-6 short lines: result, for whom, why now, how we will know it worked, the limit, and **what we will not do**. Ask for a clear yes.
6. **A real yes.** "Whatever you think" or "sounds good" is not yes: offer two concrete options and let them pick.
7. **Keep the answers.** Save the agreed restatement in a note (file_save, e.g. notes/brief-<subject>.md) or as one memory sentence if it is a lasting preference, so you never ask twice.

## When to stop

Stop asking when you can predict their answer to your next three questions. If after 5 questions you still cannot, say so: "Something basic is still unclear: can we take two minutes on the goal?"

## Signs it is going wrong

- Several questions in one message, or a question without your recommended answer.
- Asking for a fact you could have looked up.
- Starting the work before the yes on the restatement.
- No "what we will not do" line.
