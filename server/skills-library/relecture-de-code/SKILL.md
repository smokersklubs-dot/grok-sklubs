---
name: Code review
description: Review a code change like the person who will be called when it breaks - read the diff and the code around it, cover every changed file, look in order for bugs, risks, scale, missing tests, slowness and code that should not exist, keep only findings with a concrete case, explain each in plain words, and report changes in behaviour.
---

> Adapted from DietrichGebert/ponytail "ponytail-review" (© 2026 DietrichGebert, MIT) and alibaba/open-code-review "open-code-review-delegate" (© 2026 alibaba/open-code-review Contributors, Apache License 2.0). Modified for Sklubot (2026-11-22): merged; the review CLI and its rules service removed, plain git commands kept; written for Sklubot bots reviewing on their computer or a teammate's work; the original product names are not used as titles; translated into French.

# Code review

Order of importance: **correct, safe, holds under load, tested, fast, lean**. This is a report the owner asked for: give it in full, and change no code unless asked to fix.

## 1. What to review

What the owner names: uncommitted changes, a branch, a commit, a pull request, files. Nothing named: the uncommitted changes, or the last commit.

Get plain diffs (no colour, no external diff tools):
- commit: `git --no-pager show --no-ext-diff --no-textconv --no-color <commit> -- "<path>"`
- branch: `git --no-pager diff --no-ext-diff --no-textconv --no-color <merge-base>..<branch> -- "<path>"` (merge-base from `git merge-base main <branch>`)
- uncommitted: `git --no-pager diff --no-ext-diff --no-textconv --no-color HEAD -- "<path>"`, and read new untracked files whole.
For large diffs, write them to a file outside the repository and read it in parts.

Make a **checklist of every changed file** and mark each "reviewed" or "skipped" with a reason. Do not stop at the first serious finding.

## 2. Understand first

Read the diff, then the code it touches: callers of every changed function, what it calls, the tests, the README. Trace the real flow: where data comes in, what is stored, what goes out. When a signature, a return value or a behaviour changes, search every caller. Find the expected load (one person running a script, or many users at once) and say which you assumed.

## 3. Look for, in this order

1. **Bug**: wrong result, crash, missed edge case (empty, zero, last item, rounding, time zones), a caller broken by the change, a fix made in one caller while the shared function stays wrong.
2. **Risk**: security holes (injection, weak randomness, secrets in code, unchecked input), data loss (swallowed errors, writes in the wrong order, no transaction).
3. **Scale**: fine for one, wrong for many: check-then-write races, lists or memory that only grow, a query per item, quadratic work on big input.
4. **Missing test**: risky new logic or a bug fix with no test that fails when it breaks. One good test, not coverage.
5. **Speed**: big slowdowns are problems; small wins are suggestions.
6. **Lean**: dead code, unused options, a helper the project already has (name it), the standard library already does it, an abstraction with one use, near-copies that must change together.

## 4. Check before reporting

Every finding needs a **concrete case**: "this input leads to this wrong result". No case, no finding. Re-read the lines to confirm (the caller exists, the value can be empty). A `shortcut:` comment that names its limit is a decision, not a finding, unless the load already crosses it. Propose the smallest fix; prefer fixes that delete code. No taste, no vague "consider".

## 5. The report

Very plain words, every technical term explained the first time.
- **What this change does**: two or three sentences.
- **Behaviour changes**, even intended: which workflow, before, after, where.
- Findings numbered across groups (so the owner can say "fix 2 and 5"): **must fix** (bug, security, data loss, breaks at the expected load) · **should fix** (risky code without test, real slowness, duplication) · **nice to have**. Each with: what this code is, the problem, the fix, what happens if we skip it, and the location (file and lines).
- **Coverage**: files changed, reviewed, skipped (with reasons).
- `Verdict: ship.` or `Verdict: fix 1 and 3 first.` and `Not checked:` one line if something mattered.

If asked to fix: apply the must-fix items, describe the others, then run the project's tests and report the result.
