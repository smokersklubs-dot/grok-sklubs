---
name: Write a small command-line tool
description: When a repeated task deserves a small tool on the bot's computer (rename files, convert a folder, check a list) - one job, a help text, readable options, a dry-run by default for anything that changes files, clear errors and exit codes, JSON output for other tools, and a test, kept in the bot's own folder.
---

# Write a small command-line tool

Original Sklubot skill. For a task the owner asks again and again, a small tool is safer than retyping commands.

## The shape

- **One job**, said in its name (`renomme-photos`, `verifie-liens`). Python 3 (already on the computer, standard library first) or a shell script for very simple things.
- **A help text**: `--help` says what it does, each option, and one example.
- **Readable options**: long names (`--dossier`, `--dry-run`), sensible defaults, no hidden behaviour.
- **Dry-run first**: anything that changes, moves or deletes files shows what it *would* do unless `--apply` is given. Never overwrite without saying so; keep a copy or move to a `corbeille/` folder instead of deleting.
- **Clear errors**: a message that says what is wrong and how to fix it; exit code 0 when it worked, 1 for a user error, 2 for anything else.
- **Output**: plain lines for a person; `--json` for another tool.
- **No secret in the code**: a key comes from an environment variable the owner set, never written in the file or printed.

## Steps

1. Write down the task, an example input and the expected result.
2. Write a test first (a small folder of samples and the expected output), then the tool; see the test fail, then pass (see « Tests d'abord et débogage »).
3. Run it with `--dry-run` on the owner's real folder and show the result. Run with `--apply` only once the owner agrees, if it changes their files.
4. Keep the tool in `~/outils/` with a two-line README, and save how to use it as a skill (skill_save) so you use it the same way next time.
