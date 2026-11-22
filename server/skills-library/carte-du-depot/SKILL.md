---
name: Map of a code repository
description: Before changing code in a repository the bot does not know - read its README and configuration, find how to install, run and test it, list the main folders and entry points, note its rules (contributing guide, style, checks), and write a one-page map in the repository's notes that the next task reuses.
---

# Map of a code repository

Original Sklubot skill. A few minutes of reading saves hours of wrong changes.

## Read, in this order

1. `README`, then `CONTRIBUTING`, `AGENTS.md` or similar instructions, and the licence.
2. The manifest: `package.json` (scripts), `pyproject.toml`, `Cargo.toml`, `go.mod`, `Makefile`, `Dockerfile` — they say how it is built, run and tested.
3. The continuous-integration files (`.github/workflows/`): the checks a change must pass.
4. The tree, two levels deep (`git ls-files | cut -d/ -f1-2 | sort -u | head -100`), and the size of the biggest files.
5. The entry points: the main file, the server's routes, the command-line commands.
6. Recent history: `git log --oneline -20` (what moves), and open issues if the task names one.

## Write the map (one page)

- **What it is**, in one sentence.
- **How to**: install, run, test, check (the exact commands from the manifest).
- **Folders**: one line each for the important ones.
- **Entry points** and where the feature of the task probably lives.
- **Rules**: style, checks, files not to touch, how commits and pull requests are written.
- **Questions**: what is unclear, to ask the owner.

Save it as `NOTES-CARTE.md` in your own work folder (not in the repository unless the owner asks), with the commit it describes (`git rev-parse HEAD`). Next time, reread it and update only what changed since that commit.

Running the install or tests may download packages: follow the repository's own commands; anything else needs the owner's approval.
