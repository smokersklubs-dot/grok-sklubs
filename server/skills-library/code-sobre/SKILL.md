---
name: Lean code
description: For bots that write code (a small tool, a page script, an automation, a fix in a repository) - the smallest complete change: reuse what exists, no unasked features or layers, never cut safety, a small test for risky logic, a marked shortcut when a limit is known, and a closing line on what was skipped or not checked.
---

> Adapted from DietrichGebert/ponytail, main skill (© 2026 DietrichGebert, MIT). Modified for Sklubot (2026-11-22): the persona, session levels and slash commands removed; written as a working rule for Sklubot bots that code on their computer or in a repository; the original product name is not used; translated into French.

# Lean code

The best code is the code you did not have to write. Solve the whole problem with the least new code, and end with what you skipped.

## Before writing

Read the task and the code it touches. List every place the change must reach: callers, tests, fixtures, configuration, exports. Check what it could break: data destroyed or exposed, callers that stop working. That is the scope; extra features are not.

## The smallest complete change

Take the first option that fully works:
1. **Does it need to exist?** Skip options and flexibility nobody asked for, and name them in one line. A vague request gets the smallest version that does the core job.
2. **Already in the project** (a helper, a component, a pattern)? Use it the way the surrounding code does.
3. **Standard library or platform feature?** Use it, unless the project has its own.
4. **An installed dependency?** Use it. Never add a dependency for a few lines.
5. **One line a reader understands at a glance?** One line.
6. Otherwise, the minimum code that works.

- Be lazy about the solution, never about finishing: update every caller, test and fixture your change affects.
- No abstraction, wrapper, option, configuration or "for later" code nobody asked for. Deleting beats adding. Keep the project's structure and conventions.
- Comment only the why the code cannot show, in one line.
- Bug fix: find every caller of the function first, then fix the root cause once in the shared code.
- Code you move keeps its error handling and validation.
- Between two options of the same size, take the one correct on edge cases.
- New non-trivial logic (a branch, a loop, a parser, money, security, a new script) leaves **one small test** or a self-check. Trivial changes need none.
- A known limit gets a comment: `shortcut: <the limit>, <when to upgrade>`.

**Never cut**: validation of outside input, error handling that prevents data loss, security, accessibility, anything the owner asked for.

## When to push back

If the owner prefers it, name the smaller option in one line and let them choose; when a part of the request is not justified by the need, say so before building.

## End of every reply

One or two lines: what you skipped or did not check, and any risk the owner must know. Then run the project's checks (tests, type check) and give the result honestly.
