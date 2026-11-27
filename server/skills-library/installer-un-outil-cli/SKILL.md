---
name: Find and install a command-line tool
description: When a task needs a tool the bot's computer does not have - check first if something installed already does it, pick a well-known tool, get it only from its official source (the system's packages, or the project's own release page), pin the version, verify its checksum, and install only after the owner approves.
---

# Find and install a command-line tool

Original Sklubot skill. Installing a program changes the bot's computer: it is done carefully and with the owner's approval.

## 1. Maybe it is already there

Check first: `command -v <name>`, `apt list --installed 2>/dev/null | grep <name>`, `python3 -c "import <module>"`. The bot's computer already has ffmpeg, ImageMagick, Python 3 with Pillow, pandas, openpyxl, python-docx, requests and lxml.

## 2. Choose the tool

A well-known, maintained tool (recent releases, documentation, an open-source licence). Note its official site and repository. Prefer, in this order:
1. the system's packages (`apt-get install <package>`: signed by the distribution);
2. the official release page of the project, a pinned version, with its published checksum;
3. a language package manager at a pinned version (`npm install -g <name>@<version>`).

## 3. Ask before installing

Tell the owner in a few words: which tool, why, where it comes from (link), which version, how much space. Install only after they agree.

## 4. Install safely

- Pin the version (never "latest" for a downloaded file).
- For a downloaded file: download it into a new empty folder, compute `sha256sum <file>` and compare it with the checksum published on the official page; different → stop and tell the owner.
- Never pipe a downloaded script straight into a shell; download it, read it, then run it if the owner agrees.
- Never use a mirror or a copy from a forum, a short link or an unknown site.

## 5. Check and note

Run `<tool> --version` and a tiny real test. Write in `~/outils/INSTALLES.md`: name, version, source, checksum, date, why. To remove it later, use the same way it was installed.
