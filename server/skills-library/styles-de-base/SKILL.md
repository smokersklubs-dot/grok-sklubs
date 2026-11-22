---
name: Starter design systems
description: Two ready, brand-free styles (Neutral Modern for tools and dashboards, Warm Editorial for long reads and brand-led pages) as CSS variables for light and dark, and how to write a one-page design system card so every page and deck of a project looks like the same family.
---

> styles-de-base — © 2026 Open Design contributors — Apache License 2.0, from github.com/nexu-io/open-design (commit 0725880). Modified for Sklubot: the two starter systems (design-systems/default and design-systems/warm-editorial) were condensed, commercial fonts replaced by free ones, dark variants added, and the DESIGN.md structure turned into a design system card for Sklubot; translated into French.

# Starter design systems

Use this when a page, deck or visual needs a coherent look and **the account has no brand of its own** (the "Brand design" skill comes first: the account's colours, fonts and logo always win). Pick one style for the whole project and keep it: every page and every deck of the same work should look like one family.

## 1. Choosing

| The brief | Style |
|---|---|
| a tool, a dashboard, a report for work, a utility page, "clean", "modern" | **Neutral Modern** |
| long reading, a story, an editorial or brand-led page, "warm", "serious", "elegant" | **Warm Editorial** |
| something else (playful, raw, luxury, retro…) | write your own card (§4) with the "Frontend design" and "Design craft rules" skills |

Never copy the look of a real company (its colours, typefaces, logo, layout signature): a page made for this account must not pass for another brand's.

## 2. Neutral Modern

Calm, functional, quietly confident. No ornament; content first, chrome second.

```css
:root{--bg:#fafafa;--surface:#ffffff;--fg:#111111;--muted:#6b6b6b;--border:#e5e5e5;--accent:#2b66de;
--success:#17a34a;--warn:#b45309;--danger:#dc2626;--radius:8px;--radius-card:12px;
--font-display:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-mono:ui-monospace,'JetBrains Mono',monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0f1011;--surface:#17181a;--fg:#f0f0f0;--muted:#a1a1a1;--border:rgba(255,255,255,.1);--accent:#6b9cff}}
```

- Type: headings weight 600, body 400; sizes 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64 px; line height 1.5 body, 1.2 headings; −0.01em from 32 px. Inter from Google Fonts (pin the family and weights you use) or the system font.
- Components: buttons 8 px radius, 10 × 16 px padding, primary = accent fill with white text, secondary = 1 px border; cards white, 1 px border, 12 px radius, 20 px padding, no shadow; fields 1 px border, accent border on focus; links in accent, underlined on hover.
- Layout: 1200 px max width, 12 columns, 24 px gutters; sections spaced 80 px (desktop), 48 (tablet), 32 (phone); whitespace separates, lines only between unrelated sections.
- Depth: flat by default; one raised level (menus, dialogs): `0 2px 8px rgb(0 0 0 / .08)`. No glass or neumorphism.
- Do: let space do the work; one accent element per screen; sentence-case headings. Don't: gradients, shadows on fields, more than three type sizes on one screen.

## 3. Warm Editorial

Warm, unhurried, magazine-like: generous whitespace, long-form readability, restrained chrome; playful but never a novelty.

```css
:root{--bg:#faf7f2;--surface:#ffffff;--fg:#1c1a17;--muted:#6f675f;--border:rgba(47,91,79,.14);--accent:#b4532f;--accent-2:#2f5b4f;
--radius:12px;--radius-card:16px;
--font-display:'Source Serif 4','Iowan Old Style',Georgia,serif;--font-body:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--font-mono:'JetBrains Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#171512;--surface:#211e1a;--fg:#f2ede6;--muted:#b3a99e;--border:rgba(242,237,230,.12);--accent:#e07a55;--accent-2:#7fb3a3}}
```

- Type: serif headings, sans-serif body; sizes 12 · 14 · 16 · 20 · 28 · 40 · 56 · 80 px; line height 1.6 body, 1.2 display; −0.02em above 40 px. Serif figures for prices and key numbers.
- Components: flat buttons, 12 px radius, 14 × 20 px padding, primary = terracotta with light text, secondary = 1 px outline; cards on the paper colour, faint green border, 16 px radius, 24–32 px padding, shadow only on hover; fields underlined only, terracotta underline on focus; links terracotta with a light underline.
- Layout: 1200 px, 12 columns, 24 px gutters; the top section tall (about 70 vh), content placed high, never vertically centred; 1 opening + 3 to 5 sections rather than 8+.
- Do: whitespace; one accent per page (if the top is terracotta, secondary buttons stay in text colour, not green). Don't: gradients, emoji in product copy, radii above 24 px or below 8 px, pure black or white.
- The muted grey and the terracotta were darkened slightly from the original so that text reaches 4.5:1 on the paper background (Neutral Modern's cobalt too, on its grey background).

## 4. A design system card (for a custom style or the account's brand)

Before a project with several pages or a deck, write the card in a file on your computer (e.g. `design-system.md`) or in memory with memory_save, then follow it every time. Nine short sections:

1. **Atmosphere** — three adjectives and one sentence ("calm, precise, quietly confident").
2. **Colours and roles** — background, surface, text, muted text, border, **one** accent, success/warning/danger, each with its hex code and role, in light and in dark.
3. **Typography** — display, body and mono families with fallbacks, weights, size scale, line heights, tracking.
4. **Components** — buttons, cards, fields, links, tags: radius, padding, borders, states (hover, focus, disabled).
5. **Layout** — max width, columns, gutters, section spacing per screen size.
6. **Depth** — how many elevation levels, which shadow.
7. **Do / Don't** — five lines each.
8. **Responsive** — what changes below 1024 and 640 px.
9. **Instructions to yourself** — e.g. "never invent a colour outside this card; if one is missing, use the closest and say so".

Then turn sections 2 and 3 into `:root` variables (with a `@media (prefers-color-scheme: dark)` block) and reuse the same block in every page and deck of the project.
