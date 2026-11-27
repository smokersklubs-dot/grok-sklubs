---
name: Brand-free themes
description: Pick a ready theme for a page when the owner has no brand sheet - ten complete materials kept as files (tokens in OKLCH, fonts, surfaces, controls, motion, voice, what to avoid), chosen by the subject's keywords, two or three proposed with a reason, then applied through the page's tokens only.
---

> Adapted from Hallmark (github.com/Nutlope/hallmark, commit 04977e1; © 2026 Hallmark contributors, MIT): ten of its theme files and its rule "a theme is a material, never content". Modified for Sklubot (2026-11-22): ten themes kept as files of this skill (picture lines and references to the original scripts removed), the choice and the checks written for a Sklubot bot, translated into French.

# Brand-free themes

A theme here is a **material**: paper, ink, fonts, rules, radius, depth, controls, motion and voice. It never decides what the page contains or in what order (that is the page's job, and « Règles de mise en page »). No theme carries a brand name, and none imitates a real company: use them when the owner has no brand sheet yet, or to propose a direction.

## The ten themes (files kept with this skill)

| File | Name | Paper | Fits words like |
|---|---|---|---|
| `atelier.md` | Atelier | light | fashion, atelier, couture, fragrance, gallery, exhibition |
| `bloom.md` | Bloom | light | generative, ai creative, music, song, video, image |
| `cobalt.md` | Cobalt | light | api, sdk, cli, dev tool, developer platform, docs |
| `coral.md` | Coral | light | saas, platform, billing, payments, invoicing, dashboard |
| `dose.md` | Dose | light | health, medication, pharmacy, care, carer, family |
| `dusk.md` | Dusk | dark | treasury, banking, fintech, payments, reconciliation, ledger |
| `furrow.md` | Furrow | light | farm, agriculture, land, field, livestock, sheep |
| `kiln.md` | Kiln | dark | kiln, ceramics, pottery, firing, glaze, heat |
| `newsprint.md` | Newsprint | light | newspaper, broadsheet, journalism, publication, magazine, newsletter |
| `terrazzo.md` | Terrazzo | light | materials, library, architects, samples, catalogue, surfaces |

## How to choose

1. If the owner has a brand sheet (`~/team/charte.md`), it wins: use « Design de marque » instead.
2. Otherwise read the subject and match its words with the column "fits words like". Keep the two or three closest themes.
3. Propose them to the owner in one line each (the material line of the file and why it fits), and let them choose. Without an answer, take the first and say why.
4. Read the chosen file with skill_read (file: its name).

## How to apply

- Copy its `:root` block as the page's tokens, then use only those tokens in the CSS: no raw colour or font after it.
- Load its fonts with the one link line of the file (or keep the system fallbacks it names if the page cannot load fonts).
- Follow its Type, Surfaces, Controls and Motion sections; respect its Do-nots.
- Add a dark version when the theme is light (or the reverse) by changing the paper and ink tokens only, and check text contrast (4.5:1 at least) in both.
- Then check the page as « Règles de mise en page » says (390 px and desktop, keyboard, reduced motion).

## Never

- Never name or imitate a real brand's look; never mix two themes on one page.
- Never let a theme add content, a section or an object the page does not need.
