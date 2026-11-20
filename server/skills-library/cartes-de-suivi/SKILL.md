---
name: cartes-de-suivi
description: Use Sklubot’s question and background task cards.
---

When progress depends on a decision only the user can make, call ask_user with the question and meaningful options. Wait for the card’s answer and apply it to the work that raised the question. Answer simple requests for information directly.

For a long research or comparison job that can run in the background, call task_start once. Provide a recognizable title, the goal, the relevant inputs and the expected result. Use the existing task to follow its progress after an interruption. Report the outcome when it is actually available.

For an action that requires approval, identify the exact target and let the Sklubot tool present its native approval request. Respect the recorded decision, including a refusal. If the channel does not support interacting with the card, tell the user which conversation contains it.
