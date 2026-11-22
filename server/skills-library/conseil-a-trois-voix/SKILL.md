---
name: Council of three voices
description: For a hard decision with several credible paths (hire or not, launch now or wait, raise prices, choose a supplier), gather three independent opinions with fixed roles - sceptic, pragmatist, critic - that do not see each other, then give one decision with its risks and the strongest dissent.
---

> Adapted from ECC "council" (© 2026 Affaan Mustafa and ECC contributors, MIT). Modified for Sklubot (2026-11-22): the three voices run as Sklubot helpers (helper_start) with only the question, the result is a short decision card for a business owner, code examples removed, translated into French.

# Council of three voices

A help to decide under doubt, not a check of facts and not a plan. When the person hesitates between real options, one voice (yours) tends to follow the conversation. Three voices that never saw it break that pull.

## When to use it

- Several credible paths and no obvious winner; the person asks for "other opinions", "the devil's advocate", "what could go wrong".
- A go / no-go call with money or reputation at stake.

**Not** for a question of fact (just answer), checking a deliverable (use "Check before delivering") or an obvious task (do it).

## Steps

1. **The real question.** Reduce it to one line: what are we deciding, what limits matter, what counts as success. If it is vague, ask one question first (ask_user).
2. **Only the useful context.** A few figures, the options, the constraints. Nothing else from the conversation: that is what keeps the voices independent.
3. **Your position first.** Before reading the others, write your position, your three best reasons and the main risk of your choice.
4. **Three voices, in parallel.** Start three helpers (helper_start), each with the question, the short context and one role:
   - **Sceptic**: questions the premise, looks for the simplest credible alternative.
   - **Pragmatist**: speed, simplicity, what really happens on the ground, the customer's view.
   - **Critic**: what could fail, edge cases, the cost of being wrong.
   Ask each for: a position in one or two sentences, three short reasons, the biggest risk, one thing the others may miss. Under 300 words. If helpers are not available, write the three voices yourself one after the other, each starting from the question only, and say so.
5. **Weigh honestly.**
   - Never drop a voice without saying why.
   - If a voice changed your mind, say it.
   - Always keep the strongest disagreement, even if you reject it.
   - Two voices against your first position is a real signal.

## The answer

```
Council: <decision in a few words>
Sceptic: <position, one line on why>
Pragmatist: <position, one line on why>
Critic: <position, one line on why>
My first view: <position>

Decision: <the recommendation, in one or two sentences>
Main risks: <two or three>
Strongest disagreement: <the one to keep in mind>
What would make us change our mind: <a signal to watch>
```

The decision stays the person's. If the choice commits money or sends something to others, the usual approval cards still apply.
