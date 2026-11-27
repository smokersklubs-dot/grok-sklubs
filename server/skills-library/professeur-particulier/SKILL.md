---
name: Private tutor
description: Teach the person a subject over several sessions (accounting basics, a software, a language, a trade skill) - start from why they want it, find trustworthy sources, make short interactive lessons as private pages with a quiz, keep a record of what they learned, and come back to it at spaced intervals.
---

> Adapted from mattpocock/skills "teach" and its formats (© 2026 Matt Pocock, MIT). Modified for Sklubot (2026-11-22): the learning folder lives in the bot's file library, lessons are private Sklubot pages or artifacts, reminders use routines with the person's approval, condensed and translated into French.

# Private tutor

Teaching is a long job over several sessions. Keep its state in your file library under learn/<topic>/:

- **mission.md**: why the person wants this, in their words (the goal, the deadline, how they will use it). Every lesson ties back to it.
- **resources.md**: trustworthy sources you found (official docs, recognised books, courses, serious sites), one line each on why it is good.
- **record.md**: what they have learned, dated, with the non-obvious points and their mistakes.
- **glossary.md**: the words of the subject, defined simply; once written, every lesson uses the same words.
- **notes.md**: how they like to learn (short sessions, examples from their shop, by voice…).

## Start with the mission

If mission.md is empty, first ask why they want to learn this (ask_user, one question at a time, with your recommended answer). Without the "why", lessons stay abstract and you cannot choose what comes next. If the mission changes later, confirm it with them and note it in record.md.

## Knowledge from sources, not from memory

Before the first lessons, fill resources.md with search_web, web_fetch or deep_research_start. Do not trust what you remember for facts that matter: cite a source for each claim in a lesson.

## A lesson

- **One small thing**, finished in a few minutes, tied to the mission, giving one concrete win.
- Just "a bit too hard": read record.md to pick the next step.
- Explain the minimum needed, then **practise at once** with immediate feedback: a quiz, a short exercise, a real step to do ("open your till and find…").
- Quiz answers all about the same length, the right one in a different place each time, no hint in the layout.
- End with one recommended source and a reminder that they can ask you anything.
- Make it a **private page** (page_publish with private visibility) or an artifact (artifact_create), clean and readable, with links to earlier lessons and the glossary. Number them: lesson-01-<name>, lesson-02-…

## Make it stick

Feeling fluent today is not remembering next month. Use:
- **recall**: start each session with two or three questions on earlier lessons, from memory;
- **spacing**: come back to a point after a few days, then a few weeks; offer a routine for short review sessions (routine_create shows the person a card to accept);
- **mixing** related topics in practice once the basics are there.

After each session, update record.md (what was learned, what was hard).

## Reference sheets

Alongside lessons, keep short reference sheets (glossary, steps of a procedure, a cheat sheet). Lessons are rarely re-read; sheets are.

## Real practice

For know-how that only comes from doing, point the person to a good community or a real class (forum, local association, trade group), if they want it.
