---
name: Questionnaire to send
description: When the person cannot decide alone because someone else holds the answer (an accountant, a supplier, a partner, a customer), ask them only who it goes to and what they need back, then write a clear questionnaire for that person - context, how to answer, questions by theme, the most important first, one idea per question.
---

> Adapted from mattpocock/skills "to-questionnaire" (© 2026 Matt Pocock, MIT). Modified for Sklubot (2026-11-22): written as a Sklubot file the person can send or print, questions asked with ask_user, translated into French.

# Questionnaire to send

The person lacks knowledge that someone else has. The questionnaire pulls it out of that person, in one go if needed.

**Question the sending, not the subject.** Ask the person only what they can always answer: who it is for, and what they need back. The questions in the document then aim at the gap between what the recipient knows and what the person needs.

## Steps

1. **Who is it for?** In one exchange (ask_user): the recipient's role, what they know, their relationship to the person (customer, supplier, adviser, colleague). This sets the tone and how much context to give.
2. **What do you need back?** In one exchange: the decisions or facts the person cannot settle alone. Stop when you have a concrete list of what they must be able to decide afterwards.
3. **Write the questionnaire** (file_save, e.g. questionnaires/<subject>.md) following the plan below, and check that every item from step 2 is covered by a question. Show it (file_send). Sending it to the recipient is a separate step that the person approves.

## The document

```
# <Title>

Why this questionnaire: <the decision that depends on it>
From: <the person> · To: <the recipient> · What your answers are for: <where they go>
Please answer by: <date> — about <N> minutes.

## Context
<one paragraph, enough to answer well, not a page>

## How to answer
Partial answers and "I don't know" help: say when you are unsure rather than skipping.

## <Theme>
### <One clear question?>
_Why it matters: <only when the question could be misread>_
>

## Anything else?
Is there something we did not ask that we should know?
```

Rules: the most important questions first (there may be only one pass); group by theme once there are more than five; one idea per question, never two in one; plain words and the recipient's vocabulary; no question whose answer you could find yourself.
