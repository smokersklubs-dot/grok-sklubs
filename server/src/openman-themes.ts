// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Organic Intelligence, Inc.
/**
 * The slide themes. Original designs: each is one stylesheet the server writes to `slides/theme.css`
 * when a deck starts, with a shared set of layout classes the agent composes slides from. System fonts
 * only, so slides render the same in the viewer, in Chrome on the computer (PDF) and in screenshots (PPTX).
 * Client-safe.
 */

export interface SlideTheme {
  id: string;
  name: string;
  /** Background, text, accent: for the picker swatch. */
  swatch: [string, string, string];
  vars: Record<string, string>;
}

const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`;
const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`;
const MONO = `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`;

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: "graphite",
    name: "Graphite",
    swatch: ["#17181b", "#f2efe8", "#e8b04b"],
    vars: { bg: "#17181b", surface: "#222327", text: "#f2efe8", muted: "#a19e96", accent: "#e8b04b", accent2: "#7aa7d9", rule: "#34353a", heading: SERIF, body: SANS },
  },
  {
    id: "paper",
    name: "Paper",
    swatch: ["#f6f2ea", "#1e1c18", "#c2410c"],
    vars: { bg: "#f6f2ea", surface: "#ece6da", text: "#1e1c18", muted: "#6d675c", accent: "#c2410c", accent2: "#1f5f8b", rule: "#d8d0c0", heading: SERIF, body: SERIF },
  },
  {
    id: "tide",
    name: "Tide",
    swatch: ["#0b1d33", "#e8f1f8", "#2dd4bf"],
    vars: { bg: "#0b1d33", surface: "#12294a", text: "#e8f1f8", muted: "#8ea6c0", accent: "#2dd4bf", accent2: "#f59e8b", rule: "#1f3a5f", heading: SANS, body: SANS },
  },
  {
    id: "bloom",
    name: "Bloom",
    swatch: ["#ffffff", "#1b1530", "#ff5a4e"],
    vars: { bg: "#ffffff", surface: "#f5f1fb", text: "#1b1530", muted: "#6e6784", accent: "#ff5a4e", accent2: "#6c4cf1", rule: "#e7e1f2", heading: SANS, body: SANS },
  },
];

export const DEFAULT_THEME = "graphite";

export function themeById(id: string | undefined | null): SlideTheme {
  return SLIDE_THEMES.find((t) => t.id === id) ?? SLIDE_THEMES[0];
}

/** The stylesheet for a theme: variables, the 1280 x 720 slide frame and the layout classes. */
export function themeCss(theme: SlideTheme): string {
  const v = theme.vars;
  return `/* ${theme.name} slide theme. Each slide is one 1280x720 page; compose it from the classes below. */
:root{--bg:${v.bg};--surface:${v.surface};--text:${v.text};--muted:${v.muted};--accent:${v.accent};--accent-2:${v.accent2};--rule:${v.rule};--font-heading:${v.heading};--font-body:${v.body};--font-mono:${MONO}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:720px;overflow:hidden;background:var(--bg)}
body{color:var(--text);font-family:var(--font-body);font-size:24px;line-height:1.45;-webkit-font-smoothing:antialiased}
.slide{position:relative;width:1280px;height:720px;padding:72px 88px;display:flex;flex-direction:column;gap:28px;background:var(--bg);overflow:hidden}
.slide.center{justify-content:center}
.eyebrow{font-family:var(--font-body);font-size:16px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1,.title{font-family:var(--font-heading);font-size:64px;line-height:1.08;font-weight:700;letter-spacing:-.01em}
h2,.heading{font-family:var(--font-heading);font-size:44px;line-height:1.12;font-weight:700;letter-spacing:-.005em}
h3{font-family:var(--font-heading);font-size:28px;line-height:1.2;font-weight:600}
.subtitle,.lead{font-size:28px;line-height:1.4;color:var(--muted)}
p{max-width:60ch}
.muted{color:var(--muted)}
.accent{color:var(--accent)}
.rule{width:96px;height:6px;border-radius:3px;background:var(--accent)}
ul.bullets{list-style:none;display:flex;flex-direction:column;gap:18px}
ul.bullets li{position:relative;padding-left:36px}
ul.bullets li::before{content:"";position:absolute;left:0;top:.55em;width:14px;height:14px;border-radius:4px;background:var(--accent)}
ol.steps{list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:18px}
ol.steps li{counter-increment:s;position:relative;padding-left:56px}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--bg);font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:48px;flex:1;min-height:0}
.cols.three{grid-template-columns:repeat(3,1fr);gap:32px}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:20px;padding:28px 30px;display:flex;flex-direction:column;gap:12px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:32px}
.stat .value{font-family:var(--font-heading);font-size:76px;line-height:1;font-weight:700;color:var(--accent)}
.stat .label{font-size:20px;color:var(--muted);margin-top:10px}
blockquote,.quote{font-family:var(--font-heading);font-size:44px;line-height:1.25;font-style:italic;border-left:6px solid var(--accent);padding-left:36px}
.cite{font-size:20px;color:var(--muted);font-style:normal;margin-top:20px}
figure{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}
figure img,.media{width:100%;height:100%;min-height:0;object-fit:contain;border-radius:16px}
figcaption{font-size:16px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:20px}
th{text-align:left;color:var(--muted);font-weight:600;border-bottom:2px solid var(--rule);padding:10px 12px}
td{border-bottom:1px solid var(--rule);padding:10px 12px}
code{font-family:var(--font-mono);font-size:.85em;background:var(--surface);padding:2px 8px;border-radius:6px}
.footer{position:absolute;left:88px;right:88px;bottom:36px;display:flex;justify-content:space-between;font-size:14px;color:var(--muted)}
.layout-title{justify-content:center;gap:24px}
.layout-title .title{font-size:80px;max-width:16ch}
.layout-section{justify-content:center;background:var(--surface)}
.layout-section .title{font-size:72px}
.layout-quote{justify-content:center}
.band{position:absolute;inset:auto 0 0 0;height:14px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
`;
}
