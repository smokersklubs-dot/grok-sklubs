import { q } from "./db.js";
import { tr } from "./i18n.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "./store.js";
import { THEME_TOKENS, type BotThemeView, type BotThemesView, type ThemeColors, type ThemeToken, type ThemeWorst } from "./botthemetypes.js";

/**
 * L161 « thèmes créés par le bot » (OpenMausBot audit n° 38; ideas only, our own code). A bot proposes a colour theme for
 * the app (tool theme_propose): new values for some of the design tokens (web/src/styles/tokens.css) in light and in
 * dark. Nothing changes until the owner applies it (Réglages → Général → Thèmes proposés), and only a theme where EVERY
 * text/background pair of the app still passes the WCAG contrast thresholds, in both modes, can be saved or applied: the
 * same pairs and thresholds as `npm run check:contrast -w web` (web/scripts/check-contrast.mjs; a test keeps the two
 * lists and the app's own colours identical). Status colours (red, orange, green, blue) are not themeable: they keep
 * their meaning. The last MAX_THEMES themes are kept, so any earlier one can be applied again; "Couleurs d'origine"
 * goes back at once, and opening the app with ?theme=origine shows it without the theme (the rescue shortcut).
 */
export const MAX_THEMES = 30;
export const THRESHOLDS = { text: 4.5, large: 3, ui: 3 } as const;
type Level = keyof typeof THRESHOLDS;

/** The app's own colours (web/src/styles/tokens.css), the hex ones; `--accent` follows `--ink`. */
export const BASE: Record<"light" | "dark", Record<string, string>> = {
  light: {
    "--bg": "#f4f2ee", "--surface": "#ffffff", "--surface-2": "#f3f1ed", "--surface-3": "#e9e6e0", "--border": "#e4e0d8", "--border-strong": "#cdc8bd",
    "--text": "#1e2024", "--text-2": "#5a5f67", "--text-3": "#696d73", "--ink": "#23262b", "--ink-fg": "#ffffff", "--danger": "#c43c3c", "--danger-soft": "#fbecec",
    "--warn": "#9e5e10", "--warn-soft": "#fbf1df", "--ok": "#277a4d", "--ok-soft": "#e6f4ec", "--info-soft": "#eaf1fa", "--info": "#2a6fb8", "--brand": "#b23f1b",
    "--brand-soft": "#fae7de", "--on-strong": "#ffffff", "--focus": "#3b76e1", "--accent": "var(--ink)", "--accent-fg": "var(--ink-fg)",
  },
  dark: {
    "--bg": "#131416", "--surface": "#1a1c1f", "--surface-2": "#222528", "--surface-3": "#2c2f33", "--border": "#2b2e32", "--border-strong": "#3d4146",
    "--text": "#eceef1", "--text-2": "#a7adb5", "--text-3": "#888d95", "--ink": "#e8eaee", "--ink-fg": "#17181b", "--danger": "#ee6b6b", "--danger-soft": "#3a2022",
    "--warn": "#e0a34a", "--warn-soft": "#35290f", "--ok": "#5cc28a", "--ok-soft": "#17301f", "--info-soft": "#1a2a3d", "--info": "#79b0ee", "--brand": "#ff8d66",
    "--brand-soft": "#3a2119", "--on-strong": "#17181b", "--focus": "#7aa7f5", "--accent": "var(--ink)", "--accent-fg": "var(--ink-fg)",
  },
};

/** The pairs of web/scripts/check-contrast.mjs PAIRS (foreground, background, level), in the same order. */
export const PAIRS: [string, string, Level][] = [
  ["--brand", "--bg", "large"], ["--brand", "--surface", "text"], ["--brand", "--brand-soft", "text"], ["--brand", "--bg", "text"], ["--text", "--brand-soft", "text"],
  ["--text", "--ok-soft", "text"], ["--text", "--bg", "text"], ["--text", "--surface", "text"], ["--text", "--surface-2", "text"], ["--text", "--surface-3", "text"],
  ["--text-2", "--bg", "text"], ["--text-2", "--surface", "text"], ["--text-2", "--surface-2", "text"], ["--text-2", "--surface-3", "text"], ["--text-3", "--bg", "text"],
  ["--text-3", "--surface", "text"], ["--text-3", "--surface-2", "text"], ["--ink-fg", "--ink", "text"], ["--accent-fg", "--accent", "text"], ["--on-strong", "--danger", "text"],
  ["--on-strong", "--info", "text"], ["--on-strong", "--warn", "text"], ["--danger", "--surface", "text"], ["--danger", "--bg", "text"], ["--danger", "--danger-soft", "text"],
  ["--warn", "--warn-soft", "text"], ["--warn", "--surface", "text"], ["--ok", "--ok-soft", "text"], ["--ok", "--surface", "text"], ["--info", "--info-soft", "text"],
  ["--info", "--surface", "text"], ["--text", "--warn-soft", "text"], ["--text", "--danger-soft", "text"], ["--text", "--info-soft", "text"], ["--text-2", "--warn-soft", "text"],
  ["--focus", "--bg", "ui"], ["--focus", "--surface", "ui"], ["--accent", "--surface", "ui"], ["--danger", "--surface", "ui"], ["--warn", "--surface", "ui"],
  ["--ok", "--surface", "ui"], ["--info", "--surface", "ui"], ["--info", "--bg", "ui"], ["--warn", "--bg", "ui"], ["--text-3", "--bg", "ui"],
  ["--ok", "--surface-2", "ui"], ["--warn", "--surface-2", "ui"], ["--danger", "--surface-2", "ui"], ["--info", "--surface-2", "ui"], ["--on-strong", "--danger", "text"],
];

const HEX = /^#[0-9a-f]{6}$/;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => { const [r, g, b] = rgb(hex).map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** WCAG 2.x contrast ratio of two "#rrggbb" colours, 1–21. */
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const follow = (tokens: Record<string, string>, v: string): string => { let cur = v; for (let i = 0; i < 5; i++) { const m = /^var\((--[\w-]+)\)$/.exec(cur); if (!m) return cur; cur = tokens[m[1]] ?? ""; } return cur; };

/** "#ABC", "#aabbcc" → "#aabbcc"; null for anything else (no names, no rgb(), no transparency). */
export function cleanColor(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`;
  return HEX.test(s) ? s : null;
}

/** Every pair measured for one mode; `failures` in words. */
export function measureMode(mode: "light" | "dark", colors: ThemeColors): { worst: ThemeWorst; failures: string[] } {
  const tokens: Record<string, string> = { ...BASE[mode], ...(colors as Record<string, string>) };
  const failures: string[] = [];
  let worst: ThemeWorst = { fg: "", bg: "", ratio: 21, min: 0 };
  for (const [fg, bg, level] of PAIRS) {
    const a = follow(tokens, tokens[fg]), b = follow(tokens, tokens[bg]);
    const ratio = HEX.test(a) && HEX.test(b) ? contrast(a, b) : 0;
    const min = THRESHOLDS[level];
    if (ratio / min < worst.ratio / (worst.min || 1)) worst = { fg, bg, ratio: Math.round(ratio * 100) / 100, min };
    if (ratio < min) failures.push(`${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
  return { worst, failures };
}

export interface ThemeInput { name: string; note: string; light: ThemeColors; dark: ThemeColors }
/** A theme as proposed (any shape) → the clean theme, or what is wrong with it, in words a bot can act on. */
export function checkTheme(raw: Record<string, unknown>): { theme: ThemeInput; check: BotThemeView["check"] } | { errors: string[] } {
  const errors: string[] = [];
  const name = clip(String(raw.name ?? "").replace(/\s+/g, " ").trim(), 40);
  if (!name) errors.push("Give the theme a short name.");
  const part = (mode: "light" | "dark"): ThemeColors => {
    const src = raw[mode];
    const out: ThemeColors = {};
    if (src === undefined || src === null) return out;
    if (typeof src !== "object" || Array.isArray(src)) { errors.push(`${mode} must be an object of tokens, e.g. {"--bg": "#f6f1e7"}.`); return out; }
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      const key = k.startsWith("--") ? k : `--${k}`;
      if (!(THEME_TOKENS as readonly string[]).includes(key)) { errors.push(`${mode}: ${k} cannot be themed (allowed: ${THEME_TOKENS.join(", ")}).`); continue; }
      const c = cleanColor(v);
      if (!c) { errors.push(`${mode}: ${key} must be a colour written #rrggbb (got ${clip(String(v), 30)}).`); continue; }
      out[key as ThemeToken] = c;
    }
    return out;
  };
  const light = part("light"), dark = part("dark");
  if (!errors.length && !Object.keys(light).length && !Object.keys(dark).length) errors.push("Change at least one colour, in light or dark.");
  if (errors.length) return { errors };
  const l = measureMode("light", light), d = measureMode("dark", dark);
  const failures = [...l.failures, ...d.failures];
  if (failures.length) return { errors: [`${failures.length} text/background pair(s) are too faint to read:`, ...failures.slice(0, 12)] };
  return { theme: { name, note: clip(String(raw.note ?? "").trim(), 300), light, dark }, check: { ok: true, light: l.worst, dark: d.worst, failures: [] } };
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────────────────────────
q.run(`CREATE TABLE IF NOT EXISTS bot_themes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT, bot_name TEXT NOT NULL, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  light TEXT NOT NULL, dark TEXT NOT NULL, applied_at INTEGER, created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS bot_themes_user ON bot_themes(user_id, created_at)");

const parse = (s: string): ThemeColors => { try { const o = JSON.parse(s); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
function toView(r: any): BotThemeView {
  const light = parse(r.light), dark = parse(r.dark);
  const l = measureMode("light", light), d = measureMode("dark", dark);
  const bot = r.bot_id ? bots.byId(r.bot_id) : null;
  return {
    id: r.id, name: r.name, note: r.note, botId: bot ? bot.id : null, botName: bot?.name ?? r.bot_name, light, dark,
    applied: r.applied_at !== null && r.applied_at !== undefined && r.id === appliedId(r.user_id), createdAt: r.created_at, appliedAt: r.applied_at ?? null,
    check: { ok: !l.failures.length && !d.failures.length, light: l.worst, dark: d.worst, failures: [...l.failures, ...d.failures] },
  };
}
q.run("CREATE TABLE IF NOT EXISTS bot_theme_applied (user_id TEXT PRIMARY KEY, theme_id TEXT)");
const appliedId = (userId: string) => q.get<{ theme_id: string | null }>("SELECT theme_id FROM bot_theme_applied WHERE user_id = ?", userId)?.theme_id ?? null;

export class ThemeError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

export function themesView(userId: string): BotThemesView {
  const themes = q.all("SELECT * FROM bot_themes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC", userId).map(toView);
  return { themes, applied: themes.find((t) => t.applied) ?? null, tokens: THEME_TOKENS, max: MAX_THEMES };
}

/** A bot proposes a theme: saved as a proposal (never applied by the bot), and the owner is told in the bot's chat. */
export function proposeTheme(bot: BotRecord, raw: Record<string, unknown>): { theme: BotThemeView } | { errors: string[] } {
  const r = checkTheme(raw);
  if ("errors" in r) return r;
  const id = newId("thm");
  q.run("INSERT INTO bot_themes (id, user_id, bot_id, bot_name, name, note, light, dark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, bot.userId, bot.id, bot.name, r.theme.name, r.theme.note, JSON.stringify(r.theme.light), JSON.stringify(r.theme.dark), now());
  // Keep the last MAX_THEMES (never the applied one).
  const keep = appliedId(bot.userId);
  for (const old of q.all<{ id: string }>("SELECT id FROM bot_themes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?", bot.userId, MAX_THEMES)) if (old.id !== keep) q.run("DELETE FROM bot_themes WHERE id = ?", old.id);
  const locale = users.localeOf(bot.userId);
  rows.append(bot, { kind: "notice", tone: "info", text: tr(locale, "{bot} proposes a colour theme for the app: {name}", { bot: bot.name, name: r.theme.name }), action: { kind: "settings", section: "general" } });
  return { theme: toView(q.get("SELECT * FROM bot_themes WHERE id = ?", id)) };
}

export function applyTheme(userId: string, id: string | null): BotThemesView {
  if (id !== null) {
    const r = q.get("SELECT * FROM bot_themes WHERE id = ? AND user_id = ?", id, userId);
    if (!r) throw new ThemeError(404, "That theme does not exist.");
    const v = toView(r);
    if (!v.check.ok) throw new ThemeError(409, `This theme does not pass the contrast check: ${v.check.failures[0]}.`);
    q.run("UPDATE bot_themes SET applied_at = ? WHERE id = ?", now(), id);
    audit(userId, "account", tr(users.localeOf(userId), "Theme applied: {name}", { name: v.name }));
  } else if (appliedId(userId)) audit(userId, "account", tr(users.localeOf(userId), "Back to the app's own colours"));
  q.run("INSERT INTO bot_theme_applied (user_id, theme_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme_id = excluded.theme_id", userId, id);
  return themesView(userId);
}

export function removeTheme(userId: string, id: string): BotThemesView {
  if (q.run("DELETE FROM bot_themes WHERE id = ? AND user_id = ?", id, userId).changes === 0) throw new ThemeError(404, "That theme does not exist.");
  if (appliedId(userId) === id) q.run("UPDATE bot_theme_applied SET theme_id = NULL WHERE user_id = ?", userId);
  return themesView(userId);
}
