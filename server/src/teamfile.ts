import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { emit } from "./bus.js";
import { describeCron, isValidTimezone } from "./cron.js";
import { CREDENTIAL_KEY, freeName, GrokImportError, scrub, teamFullAt, validCron, type Cleaner } from "./grokimport.js";
import { planLimitError, planRoom } from "./hosted.js";
import { tr } from "./i18n.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { routines } from "./routines.js";
import {
  ACCESSORIES, AVATAR_COLORS, AVATAR_SHAPES, CHARACTER_TYPES, DEFAULT_CHARACTER, EYE_STYLES, IDLE_MOTIONS, maskSecrets,
  TEAM_FILE_FORMAT, TEAM_FILE_VERSION, TEMPLATE_CATEGORIES, TEMPLATE_ICONS,
  type AvatarColor, type AvatarShape, type Character, type GrokImportRoutine, type GrokImportSkill,
  type GrokImportStripped, type GrokImportWarning, type Locale, type TeamFileBot, type TeamFileChoice, type TeamFileExport,
  type TeamFileLook, type TeamFileMeta, type TeamFilePreview, type TeamFileRemoved, type TeamFileReport, type TeamFileSource,
  type TemplateCategory, type TemplateIcon, type TemplateSummary,
} from "./shared.js";
import { withScan } from "./skillscan.js";
import { audit, bots, cleanCharacter, clip, now, rows, sections, settings, skills, type BotRecord, type UserRecord } from "./store.js";
import { q } from "./db.js";

/**
 * "Modèles d'équipe": a team as one portable Markdown file (format: docs/MODELES-EQUIPE.md).
 *
 * The file is a strict allowlist. It may carry, per bot: a name, a role, a personality, instructions, skills (imported as
 * drafts), routines (imported paused), suggested apps (a to-do, nothing is connected) and a look. It never carries a
 * model, an autonomy or approval level, computer settings, connectors, keys or the vault, memories or workspace settings:
 * any such field or section is dropped by the parser and listed in the preview ("removed"), and anything that looks like
 * a secret inside an allowed text is replaced by a marker ("masked", shared with the Grok import).
 *
 * Three ways in, one review screen: a built-in template (server/templates/*.md), a file the user picks, or an https
 * address (a raw GitHub link…) fetched through guardedFetch with a size limit. Preview (nothing is created) → commit
 * (one transaction: careful autonomy, the account's default model, draft skills, paused routines; MAX_BOTS and the hosted
 * plan's limits are checked before anything is written).
 */

export const TEAM_FILE_MAX_CHARS = 200_000;
const MAX_BOTS = 20, MAX_SKILLS = 30, MAX_ROUTINES = 20, MAX_APPS = 30, MAX_TAGS = 8;

// ── Vocabulary (English canonical names, French aliases) ───────────────────────────────────────────────────────────

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, "");
const aliases = (map: Record<string, string[]>) => {
  const out = new Map<string, string>();
  for (const [canon, list] of Object.entries(map)) for (const a of [canon, ...list]) out.set(norm(a), canon);
  return out;
};
const META_KEYS = aliases({
  format: [], version: [], title: ["titre", "nom", "name"], description: ["resume"], icon: ["icone"], category: ["categorie"],
  tags: ["etiquettes", "motscles", "keywords"], language: ["langue", "lang"], author: ["auteur", "auteurs"],
});
const BOT_FIELDS = aliases({ role: ["job", "metier", "poste"], look: ["apparence", "allure"], apps: ["applications", "applis", "app"] });
const SKILL_FIELDS = aliases({ when: ["quand", "declencheur", "trigger"] });
const ROUTINE_FIELDS = aliases({ cron: [], timezone: ["fuseau", "fuseauhoraire", "tz"], schedule: ["horaire", "frequence", "quand", "when"] });
const LOOK_KEYS = aliases({
  shape: ["forme"], color: ["couleur"], type: [], eyes: ["yeux"], accessory: ["accessoire"], idle: ["mouvement", "repos"],
  mouth: ["bouche"], cheeks: ["joues"], intensity: ["intensite", "energie"], tint: ["teinte", "customcolor"],
});
/** Fields and sections that are refused on purpose (not just unknown): the preview says they were "not allowed". */
const FORBIDDEN = /model|modele|autonom|approv|validation|confiance|trust|effort|memor|souvenir|computer|ordinateur|machine|desktop|connect|integration|mcp|vault|coffre|key|cle|token|jeton|password|motdepasse|secret|cookie|credential|identifiant|workspace|espacedetravail|permission|tool|outil|telegram|webhook|voice|voix|email|mail|telephone|phone|budget|plafond|cap$|spend|section|partage|share|primary|disabled/;
const forbidden = (k: string) => FORBIDDEN.test(norm(k));

const HEAD_BOT = /^(?:bot|robot|assistant|assistante)\s*:\s*(.+)$/i;
const SUB_KINDS: { kind: "personality" | "instructions" | "skill" | "routine"; re: RegExp }[] = [
  { kind: "personality", re: /^(?:personality|personnalit[ée]|ton|tone)$/i },
  { kind: "instructions", re: /^(?:instructions|consignes)$/i },
  { kind: "skill", re: /^(?:skill|comp[ée]tence|savoir-faire)\s*:\s*(.+)$/i },
  { kind: "routine", re: /^(?:routine)\s*:\s*(.+)$/i },
];
/** A field line under a heading: "- key: value" with a one-word key. */
const FIELD_LINE = /^\s*[-*]\s+([\p{L}][\p{L}\p{N}_-]{0,23})\s*:\s?(.*)$/u;

const LABELS: Record<string, { fr: string; en: string }> = {
  file: { fr: "en-tête", en: "header" }, skill: { fr: "compétence", en: "skill" }, routine: { fr: "routine", en: "routine" },
  section: { fr: "section", en: "section" }, look: { fr: "apparence", en: "look" }, role: { fr: "rôle", en: "role" },
  personality: { fr: "personnalité", en: "personality" }, instructions: { fr: "consignes", en: "instructions" }, app: { fr: "appli", en: "app" },
  name: { fr: "nom", en: "name" },
};
const label = (k: string, l: Locale) => (l === "fr" ? LABELS[k]?.fr : LABELS[k]?.en) ?? k;
const tidy = (s: string, n: number) => clip(s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim(), n);
const oneLine = (s: string, n: number) => tidy(s.replace(/\s*\n\s*/g, " "), n);

// ── Front matter (a small, safe YAML subset) ───────────────────────────────────────────────────────────────────────

/**
 * The scalars and lists of a front matter block: `key: value`, `key: "quoted"`, `key: 'quoted'`, `key: [a, b]` and
 * `key:` followed by `  - item` lines. Nested maps, anchors and tags are not read (their key is still reported).
 */
export function parseFrontMatter(block: string): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  let listKey: string | null = null;
  for (const line of block.split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) { (out.get(listKey) as string[]).push(yamlScalar(item[1])); continue; }
    const m = /^([^\s:#][^:]*?)\s*:\s*(.*)$/.exec(line);
    if (!m || /^\s/.test(line)) { listKey = null; continue; }
    const key = m[1].trim(), raw = m[2].trim();
    listKey = null;
    if (!raw) { out.set(key, []); listKey = key; continue; }
    if (raw.startsWith("[") && raw.endsWith("]")) { out.set(key, splitFlow(raw.slice(1, -1)).map(yamlScalar).filter(Boolean)); continue; }
    out.set(key, yamlScalar(raw));
  }
  return out;
}
function splitFlow(s: string): string[] {
  const parts: string[] = [];
  let cur = "", quote = "";
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ",") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}
function yamlScalar(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"')) { try { return String(JSON.parse(s)); } catch { return s.replace(/^"|"$/g, ""); } }
  if (s.startsWith("'")) return s.replace(/^'|'$/g, "").replace(/''/g, "'");
  // A plain scalar ends at a comment.
  return s.replace(/\s+#.*$/, "");
}
/** A string as a YAML double-quoted scalar (JSON's escaping is valid YAML). */
const yq = (s: string) => JSON.stringify(s);

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ParsedTeamFile {
  meta: TeamFileMeta; bots: Omit<TeamFileBot, "nameTaken">[];
  masked: GrokImportStripped[]; removed: TeamFileRemoved[]; warnings: GrokImportWarning[];
}
interface RawBot { name: string; fields: [string, string][]; parts: { kind: string; title: string; fields: [string, string][]; text: string[] }[] }

/** Leading "- key: value" lines of a section (after blank lines), then the rest. */
function splitFields(lines: string[]): { fields: [string, string][]; rest: string[] } {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const fields: [string, string][] = [];
  for (; i < lines.length; i++) {
    const m = FIELD_LINE.exec(lines[i]);
    if (!m) break;
    fields.push([m[1], m[2]]);
  }
  // Fields must be followed by a blank line (or nothing): otherwise they were the first items of a list of steps.
  if (fields.length && i < lines.length && lines[i].trim()) return { fields: [], rest: lines };
  return { fields, rest: lines.slice(i) };
}
const unescape = (lines: string[]) => lines.map((l) => l.replace(/^\\(\\*#)/, "$1")).join("\n");

/** A refusal (as GrokImportError: English text, i18n.ts key); a `detail` var is translated too. */
export class TeamFileError extends GrokImportError {
  override text(locale: Locale | undefined) {
    const vars = typeof this.vars.detail === "string" ? { ...this.vars, detail: tr(locale, this.vars.detail) } : this.vars;
    return tr(locale, this.english, vars);
  }
}

/** Reads a team file into bots, cleaned of what the format does not allow and of secrets. Throws when nothing is usable. */
export function parseTeamFile(raw: string, opts: { locale?: Locale; timezone?: string } = {}): ParsedTeamFile {
  const locale: Locale = opts.locale ?? "en";
  const fallbackTz = opts.timezone && isValidTimezone(opts.timezone) ? opts.timezone : "UTC";
  const text = (typeof raw === "string" ? raw : "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new TeamFileError("empty", "This file is empty.");
  if (text.length > TEAM_FILE_MAX_CHARS) throw new TeamFileError("too_large", "This file is too large ({kb} KB; 200 KB at most).", { kb: Math.ceil(text.length / 1000) }, 413);
  if (/^\s*(?:\{|\[\s*\{)/.test(text)) throw new TeamFileError("not_team_file", "This is not a Sklubot team file: it should start with a “---” header and have a “## Bot: name” section per bot.");
  if (/^\s*<(!doctype|html)/i.test(text)) throw new TeamFileError("html", "This address gives a web page, not a team file. Use the file's raw address.");

  const removed: TeamFileRemoved[] = [];
  const warnings: GrokImportWarning[] = [];
  const cx: Cleaner = { stripped: [], placeholder: locale === "fr" ? "[secret retiré]" : "[secret removed]" };
  const drop = (where: string, field: string) => removed.push({ where, field: clip(field, 60), reason: CREDENTIAL_KEY.test(norm(field)) ? "secret" : forbidden(field) ? "forbidden" : "unknown" });

  // Front matter.
  let body = text;
  const fmMatch = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  const fm = fmMatch ? parseFrontMatter(fmMatch[1]) : new Map<string, string | string[]>();
  if (fmMatch) body = text.slice(fmMatch[0].length);
  const metaRaw: Record<string, string | string[]> = {};
  for (const [k, v] of fm) {
    const canon = META_KEYS.get(norm(k));
    if (canon) metaRaw[canon] = v;
    else drop(label("file", locale), k);
  }
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v ?? "");
  const format = str(metaRaw.format).trim();
  if (format && format !== TEAM_FILE_FORMAT) throw new TeamFileError("not_team_file", "This is not a Sklubot team file (its format is “{format}”).", { format: clip(format, 40) });
  const version = Number(str(metaRaw.version));
  if (!format || !str(metaRaw.version).trim() || !Number.isFinite(version)) warnings.push({ code: "no_version" });
  else if (version > TEAM_FILE_VERSION) warnings.push({ code: "newer_version", n: version });

  // Body: "## Bot: name" sections, each with "### …" parts. Code fences are content, never structure.
  const lines = body.split("\n");
  const raws: RawBot[] = [];
  let firstTitle = "";
  let cur: RawBot | null = null;
  let part: RawBot["parts"][number] | null = null;
  let botLines: string[] = [];
  let skipping = false;
  let fence: string | null = null;
  const closePart = () => {
    if (!cur) return;
    if (part) { const f = splitFields(part.text); if (part.kind === "skill" || part.kind === "routine") { part.fields = f.fields; part.text = f.rest; } cur.parts.push(part); part = null; }
  };
  const closeBot = () => {
    closePart();
    if (cur) { cur.fields = splitFields(botLines).fields; raws.push(cur); }
    cur = null; botLines = [];
  };
  for (const line of lines) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; }
    else if (f) fence = f[1];
    const h = !fence && !f ? /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h && h[1].length === 1) { if (!firstTitle && !cur) firstTitle = h[2]; else if (part) part.text.push(line); continue; }
    if (h && h[1].length === 2) {
      closeBot();
      skipping = false;
      const b = HEAD_BOT.exec(h[2]);
      if (b) cur = { name: b[1].trim(), fields: [], parts: [] };
      else { skipping = true; drop(label("section", locale), h[2]); }
      continue;
    }
    if (h && h[1].length === 3 && cur) {
      closePart();
      const title = h[2].trim();
      const kind = SUB_KINDS.find((k) => k.re.test(title));
      if (kind) part = { kind: kind.kind, title: kind.re.exec(title)![1]?.trim() ?? "", fields: [], text: [] };
      else { part = { kind: "dropped", title, fields: [], text: [] }; drop(`${cur.name} › ${label("section", locale)}`, title); }
      continue;
    }
    if (skipping) continue;
    if (part) part.text.push(line);
    else if (cur) botLines.push(line);
  }
  closeBot();

  if (!raws.length) throw new TeamFileError("no_bots", "This file has no bot: each bot starts with a line “## Bot: its name”.");
  if (raws.length > MAX_BOTS) warnings.push({ code: "too_many_bots", n: MAX_BOTS });
  let cut = false;

  const outBots = raws.slice(0, MAX_BOTS).map((rb, bi): Omit<TeamFileBot, "nameTaken"> => {
    const name = oneLine(scrub(rb.name, `#${bi + 1} › ${label("name", locale)}`, cx).text, 60) || `Bot ${bi + 1}`;
    let role = "", lookRaw = "", appsRaw = "";
    for (const [k, v] of rb.fields) {
      const canon = BOT_FIELDS.get(norm(k));
      if (canon === "role") role = v; else if (canon === "look") lookRaw = v; else if (canon === "apps") appsRaw = v;
      else drop(name, k);
    }
    const look = parseLook(lookRaw, (k) => drop(`${name} › ${label("look", locale)}`, k));
    const textOf = (kind: string) => unescape(rb.parts.filter((p) => p.kind === kind).flatMap((p) => p.text));
    const field = (kind: "personality" | "instructions", n: number) => tidy(scrub(textOf(kind), `${name} › ${label(kind, locale)}`, cx).text, n);

    const skillParts = rb.parts.filter((p) => p.kind === "skill");
    if (skillParts.length > MAX_SKILLS) cut = true;
    const sks: GrokImportSkill[] = [];
    for (const [i, p] of skillParts.slice(0, MAX_SKILLS).entries()) {
      const sName = oneLine(p.title, 80) || `${label("skill", locale)} ${i + 1}`;
      const where = `${name} › ${label("skill", locale)} “${sName}”`;
      let when = "";
      for (const [k, v] of p.fields) { if (SKILL_FIELDS.get(norm(k)) === "when") when = v; else drop(where, k); }
      const steps = unescape(p.text);
      if (!steps.trim() && !when.trim()) continue;
      sks.push({ name: oneLine(scrub(sName, where, cx).text, 80), when: oneLine(scrub(when, where, cx).text, 300), steps: tidy(scrub(steps || when, where, cx).text, 20_000) });
    }

    const rtParts = rb.parts.filter((p) => p.kind === "routine");
    if (rtParts.length > MAX_ROUTINES) cut = true;
    const rts: GrokImportRoutine[] = [];
    for (const [i, p] of rtParts.slice(0, MAX_ROUTINES).entries()) {
      const rName = oneLine(p.title, 80) || `${label("routine", locale)} ${i + 1}`;
      const where = `${name} › ${label("routine", locale)} “${rName}”`;
      let cronRaw = "", tzRaw = "", schedule = "";
      for (const [k, v] of p.fields) {
        const canon = ROUTINE_FIELDS.get(norm(k));
        if (canon === "cron") cronRaw = v.replace(/`/g, ""); else if (canon === "timezone") tzRaw = v.trim(); else if (canon === "schedule") schedule = v;
        else drop(where, k);
      }
      const task = tidy(scrub(unescape(p.text), where, cx).text, 4000);
      schedule = oneLine(scrub(schedule, where, cx).text, 200);
      if (!task && !schedule && !cronRaw) continue;
      const cron = validCron(cronRaw);
      const timezone = tzRaw && isValidTimezone(tzRaw) ? tzRaw : fallbackTz;
      rts.push({ name: oneLine(scrub(rName, where, cx).text, 80), schedule, cron, timezone, task: task || rName, describe: cron ? describeCron(cron, locale) : schedule });
    }

    const apps: string[] = [];
    for (const a of appsRaw.split(/[,;]+/)) {
      // By name only: addresses and links are dropped.
      const n = oneLine(a.replace(/https?:\/\/\S+/g, "").replace(/[^\s()]+@[^\s()]+/g, "").replace(/[`*_[\]()]/g, ""), 60);
      if (n && !apps.some((x) => x.toLowerCase() === n.toLowerCase()) && !scrub(n, `${name} › ${label("app", locale)}`, cx).found) apps.push(n);
      if (apps.length >= MAX_APPS) { cut = true; break; }
    }
    return { name, role: oneLine(scrub(role, `${name} › ${label("role", locale)}`, cx).text, 500), personality: field("personality", 2000), instructions: field("instructions", 6000), look, skills: sks, routines: rts, apps };
  });
  if (cut) warnings.push({ code: "too_many_items" });
  const noCron = outBots.reduce((n, b) => n + b.routines.filter((r) => !r.cron).length, 0);
  if (noCron) warnings.push({ code: "routine_no_cron", n: noCron });

  const iconRaw = str(metaRaw.icon).trim();
  const catRaw = norm(str(metaRaw.category));
  const tags = (Array.isArray(metaRaw.tags) ? metaRaw.tags : str(metaRaw.tags).split(",")).map((t) => oneLine(t, 30)).filter(Boolean).slice(0, MAX_TAGS);
  const meta: TeamFileMeta = {
    title: oneLine(scrub(str(metaRaw.title) || firstTitle, label("file", locale), cx).text, 80) || (outBots.length === 1 ? outBots[0].name : ""),
    description: oneLine(scrub(str(metaRaw.description), label("file", locale), cx).text, 400),
    icon: (TEMPLATE_ICONS as readonly string[]).includes(iconRaw) ? (iconRaw as TemplateIcon) : "users",
    category: (TEMPLATE_CATEGORIES as readonly string[]).find((c) => c === catRaw) as TemplateCategory | undefined ?? null,
    tags, language: oneLine(str(metaRaw.language), 10), author: oneLine(scrub(str(metaRaw.author), label("file", locale), cx).text, 80),
  };
  return { meta, bots: outBots, masked: cx.stripped, removed, warnings };
}

/** "shape=pebble color=teal type=mascot eyes=round": known keys and values only; anything else is reported. */
export function parseLook(raw: string, unknown: (k: string) => void): TeamFileLook {
  const c: Record<string, unknown> = {};
  let shape: AvatarShape | null = null, color: AvatarColor | null = null;
  for (const tok of raw.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^([^=:]+)[=:](.*)$/.exec(tok);
    if (!m) continue;
    const key = LOOK_KEYS.get(norm(m[1])), v = m[2].trim();
    if (!key) { unknown(m[1]); continue; }
    const yes = /^(yes|oui|true|1|on)$/i.test(v), no = /^(no|non|false|0|off)$/i.test(v);
    if (key === "shape") shape = (AVATAR_SHAPES as readonly string[]).includes(v) ? (v as AvatarShape) : null;
    else if (key === "color") color = (AVATAR_COLORS as readonly string[]).includes(v) ? (v as AvatarColor) : null;
    else if (key === "tint") c.customColor = /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;
    else if (key === "mouth" || key === "cheeks") c[key] = yes ? true : no ? false : undefined;
    else if (key === "intensity") c.intensity = Number(v);
    else c[key] = v;
  }
  // Only the look: the character's behaviour settings (cursor, euphoria, shouting) keep their defaults.
  const ch = cleanCharacter({ type: c.type, eyes: c.eyes, accessory: c.accessory, idle: c.idle, mouth: c.mouth, cheeks: c.cheeks, intensity: c.intensity, customColor: c.customColor ?? null });
  return { shape, color, character: { ...DEFAULT_CHARACTER, type: ch.type, eyes: ch.eyes, accessory: ch.accessory, idle: ch.idle, mouth: ch.mouth, cheeks: ch.cheeks, intensity: ch.intensity, customColor: ch.customColor } };
}

// ── Writing (export) ─────────────────────────────────────────────────────────────────────────────────────────────

const PERSONALITY_PREFIX = /^(?:Personality and tone|Personnalité et ton)\s*:\s*/;
/** Lines that would read as structure ("## …", "### …") are escaped with a backslash; the parser takes it off. */
const escapeText = (s: string) => s.split("\n").map((l) => (/^#{1,6}\s/.test(l) || /^\\#/.test(l) ? `\\${l}` : l)).join("\n");
const fieldSafe = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function lookLine(look: { shape: AvatarShape | null; color: AvatarColor | null; character: Character }): string {
  const c = look.character, d = DEFAULT_CHARACTER;
  const parts: string[] = [];
  if (look.shape) parts.push(`shape=${look.shape}`);
  if (look.color) parts.push(`color=${look.color}`);
  parts.push(`type=${c.type}`);
  if (c.eyes !== d.eyes) parts.push(`eyes=${c.eyes}`);
  if (c.accessory !== d.accessory) parts.push(`accessory=${c.accessory}`);
  if (c.idle !== d.idle) parts.push(`idle=${c.idle}`);
  if (c.mouth !== d.mouth) parts.push(`mouth=${c.mouth ? "yes" : "no"}`);
  if (c.cheeks !== d.cheeks) parts.push(`cheeks=${c.cheeks ? "yes" : "no"}`);
  if (c.intensity !== d.intensity) parts.push(`intensity=${c.intensity}`);
  if (c.customColor) parts.push(`tint=${c.customColor}`);
  return parts.join(" ");
}

export interface TeamFileInput {
  meta: Partial<TeamFileMeta>;
  bots: { name: string; role: string; personality: string; instructions: string; look: { shape: AvatarShape | null; color: AvatarColor | null; character: Character }; skills: { name: string; when: string; steps: string }[]; routines: { name: string; cron: string; timezone: string; schedule: string; task: string }[]; apps: string[] }[];
}

/** The Markdown of a team file (no secret check here: exportTeam masks before calling it). */
export function writeTeamFile(input: TeamFileInput, locale: Locale = "fr"): string {
  const fr = locale === "fr";
  const m = input.meta;
  const fm = [
    "---", `format: ${TEAM_FILE_FORMAT}`, `version: ${TEAM_FILE_VERSION}`, `title: ${yq(m.title ?? "")}`, `description: ${yq(m.description ?? "")}`,
    `icon: ${m.icon ?? "users"}`, ...(m.category ? [`category: ${m.category}`] : []),
    ...(m.tags?.length ? [`tags: [${m.tags.map(yq).join(", ")}]`] : []), `language: ${m.language || locale}`,
    ...(m.author ? [`author: ${yq(m.author)}`] : []), "---", "",
  ];
  const out = [...fm, `# ${fieldSafe(m.title || (fr ? "Équipe" : "Team"))}`, ""];
  if (m.description) out.push(fieldSafe(m.description), "");
  for (const b of input.bots) {
    out.push(`## Bot: ${fieldSafe(b.name)}`, "");
    if (b.role) out.push(`- role: ${fieldSafe(b.role)}`);
    out.push(`- look: ${lookLine(b.look)}`);
    if (b.apps.length) out.push(`- apps: ${b.apps.map((a) => fieldSafe(a).replace(/[,;]/g, " ")).join(", ")}`);
    out.push("");
    if (b.personality.trim()) out.push(`### ${fr ? "Personnalité" : "Personality"}`, "", escapeText(b.personality.trim()), "");
    if (b.instructions.trim()) out.push(`### ${fr ? "Consignes" : "Instructions"}`, "", escapeText(b.instructions.trim()), "");
    for (const s of b.skills) {
      out.push(`### ${fr ? "Compétence" : "Skill"}: ${fieldSafe(s.name)}`, "", `- when: ${fieldSafe(s.when || s.name)}`, "", escapeText(s.steps.trim()), "");
    }
    for (const r of b.routines) {
      out.push(`### Routine: ${fieldSafe(r.name)}`, "", `- cron: ${r.cron}`, `- timezone: ${r.timezone}`);
      if (r.schedule) out.push(`- schedule: ${fieldSafe(r.schedule)}`);
      out.push("", escapeText(r.task.trim()), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "equipe";

/**
 * "Exporter en modèle": the caller's own bots (a section, chosen bots, or the whole team) as a team file. Memories,
 * models, autonomy, tools, connectors and keys are never read; every text goes through the secret mask.
 */
export function exportTeam(user: UserRecord, opts: { botIds?: unknown; sectionId?: unknown; title?: unknown; description?: unknown; icon?: unknown; category?: unknown }): TeamFileExport {
  const locale = user.locale;
  let list: BotRecord[];
  let sectionName = "";
  const mine = bots.list(user.id).filter((b) => b.kind === "agent");
  if (typeof opts.sectionId === "string" && opts.sectionId) {
    const sec = sections.owned(user.id, opts.sectionId);
    if (!sec) throw new TeamFileError("not_found", "That section does not exist.", {}, 404);
    sectionName = sec.name;
    list = mine.filter((b) => b.sectionId === sec.id);
  } else if (Array.isArray(opts.botIds) && opts.botIds.length) {
    list = [];
    for (const id of opts.botIds.slice(0, MAX_BOTS * 2)) {
      const b = typeof id === "string" ? bots.owned(user.id, id) : null;
      if (!b || b.kind !== "agent" || b.hidden) throw new TeamFileError("not_found", "That bot does not exist.", {}, 404);
      if (!list.some((x) => x.id === b.id)) list.push(b);
    }
  } else list = mine;
  if (!list.length) throw new TeamFileError("no_bots", "There is no bot to export here.");
  list = list.slice(0, MAX_BOTS);

  let masked = 0;
  const mask = (s: string) => { const r = maskSecrets(s, locale === "fr" ? "[secret retiré]" : "[secret removed]"); masked += r.secrets.length; return r.text; };
  const str = (v: unknown, n: number) => (typeof v === "string" ? oneLine(v, n) : "");
  const title = mask(str(opts.title, 80) || sectionName || (list.length === 1 ? list[0].name : tr(locale, "My team")));
  const input: TeamFileInput = {
    meta: {
      title, description: mask(str(opts.description, 400)),
      icon: (TEMPLATE_ICONS as readonly string[]).includes(String(opts.icon)) ? (opts.icon as TemplateIcon) : "users",
      category: (TEMPLATE_CATEGORIES as readonly string[]).includes(String(opts.category)) ? (opts.category as TemplateCategory) : null,
      language: locale,
    },
    bots: list.map((b) => {
      // The personality that an import appended to the instructions goes back to its own section.
      const paras = b.instructions.split(/\n{2,}/);
      const pi = paras.findIndex((p) => PERSONALITY_PREFIX.test(p));
      const personality = pi >= 0 ? paras[pi].replace(PERSONALITY_PREFIX, "") : "";
      const instructions = pi >= 0 ? paras.filter((_, i) => i !== pi).join("\n\n") : b.instructions;
      return {
        name: mask(b.name), role: mask(b.description), personality: mask(personality), instructions: mask(instructions),
        look: { shape: b.shape, color: b.color, character: b.character },
        skills: skills.list(b.id).filter((s) => s.botId === b.id).slice(0, MAX_SKILLS).map((s) => ({ name: mask(s.name), when: mask(s.description), steps: mask(s.body) })),
        routines: routines.forBot(b.id).filter((r) => r.trigger === "cron" && validCron(r.schedule)).slice(0, MAX_ROUTINES)
          .map((r) => ({ name: mask(r.name), cron: r.schedule, timezone: r.timezone, schedule: describeCron(r.schedule, locale), task: mask(r.prompt) })),
        apps: [],
      };
    }),
  };
  const text = writeTeamFile(input, locale);
  audit(user.id, "account", `Team file exported: ${list.map((b) => b.name).join(", ")}${masked ? ` (${masked} secret(s) masked)` : ""}`);
  return { filename: `${slug(title)}.md`, text, bots: list.length, masked };
}

// ── Built-in templates (server/templates/*.md) ───────────────────────────────────────────────────────────────────

const TEMPLATE_DIR = new URL("../templates/", import.meta.url);
let gallery: { id: string; text: string; parsed: ParsedTeamFile }[] | null = null;
export function builtinTemplates(): { id: string; text: string; parsed: ParsedTeamFile }[] {
  if (gallery) return gallery;
  const out: { id: string; text: string; parsed: ParsedTeamFile }[] = [];
  let files: string[] = [];
  try { files = readdirSync(TEMPLATE_DIR).filter((f) => /^[a-z0-9-]+\.md$/.test(f)).sort(); } catch { /* no gallery */ }
  for (const f of files) {
    const text = readFileSync(new URL(f, TEMPLATE_DIR), "utf8");
    try { out.push({ id: f.replace(/\.md$/, ""), text, parsed: parseTeamFile(text, { locale: "fr", timezone: "Europe/Paris" }) }); }
    catch (err) { console.warn(`[templates] ${f}: ${(err as Error).message}`); }
  }
  return (gallery = out);
}
export function templateList(): TemplateSummary[] {
  return builtinTemplates().map(({ id, parsed: p }) => ({
    id, ...p.meta, bots: p.bots.map((b) => ({ name: b.name, role: b.role, look: b.look })),
    skills: p.bots.reduce((n, b) => n + b.skills.length, 0), routines: p.bots.reduce((n, b) => n + b.routines.length, 0),
    apps: [...new Set(p.bots.flatMap((b) => b.apps))],
  }));
}

// ── Fetching a file from an address ──────────────────────────────────────────────────────────────────────────────

const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
/** A GitHub page of a file ("…/blob/…") becomes its raw address; anything else is fetched as given. */
export function rawAddress(u: URL): URL {
  const gh = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
  if (u.hostname === "github.com" && gh) return new URL(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`);
  return u;
}
/** The file at an https address, through guardedFetch (no private network), 200 KB at most, read as it arrives. */
export async function fetchTeamFile(address: string, signal?: AbortSignal): Promise<{ text: string; source: TeamFileSource }> {
  let u: URL;
  try { u = new URL(address.trim()); } catch { throw new TeamFileError("bad_url", "That is not a full address (it should start with https://)."); }
  if (u.protocol !== "https:" && !(allowHttp() && u.protocol === "http:")) throw new TeamFileError("bad_url", "Team files are fetched over https only.");
  if (u.username || u.password) throw new TeamFileError("bad_url", "That address holds a sign-in: remove it.");
  u = rawAddress(u);
  let res: Response;
  try {
    res = await guardedFetch(u.toString(), { signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]), redirect: "follow", headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" } });
  } catch (err) {
    throw new TeamFileError("fetch", "Could not fetch it: {detail}", { detail: fetchProblem(err) ?? clip((err as Error).message, 120) });
  }
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new TeamFileError("fetch", "Could not fetch it (status {status}).", { status: res.status }); }
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !/text\/|markdown|octet-stream|yaml/.test(type)) { await res.body?.cancel().catch(() => {}); throw new TeamFileError("fetch", "That is not a text file ({type}).", { type: clip(type, 60) }); }
  const tooLarge = () => new TeamFileError("too_large", "That file is too large (200 KB at most).", {}, 413);
  if (Number(res.headers.get("content-length") ?? 0) > TEAM_FILE_MAX_CHARS * 2) { await res.body?.cancel().catch(() => {}); throw tooLarge(); }
  // Read as it arrives and stop past the limit (a missing or false content-length changes nothing).
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TEAM_FILE_MAX_CHARS * 2) { await reader.cancel().catch(() => {}); throw tooLarge(); }
      chunks.push(value);
    }
  }
  const text = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  if (text.length > TEAM_FILE_MAX_CHARS) throw tooLarge();
  return { text, source: { kind: "url", label: clip(`${u.hostname}${u.pathname}`, 160), url: u.toString() } };
}

// ── Preview and commit ───────────────────────────────────────────────────────────────────────────────────────────

interface Pending { userId: string; parsed: ParsedTeamFile; source: TeamFileSource; until: number }
const pending = new Map<string, Pending>();
const PREVIEW_MS = 15 * 60_000;
const sweep = () => { for (const [k, v] of pending) if (v.until < now()) pending.delete(k); };

export async function previewTeamFile(user: UserRecord, input: { template?: unknown; text?: unknown; url?: unknown; filename?: unknown }): Promise<TeamFilePreview> {
  sweep();
  const opts = { locale: user.locale, timezone: settings.profile(user.id).timezone };
  let parsed: ParsedTeamFile, source: TeamFileSource;
  if (typeof input.template === "string" && input.template) {
    const t = builtinTemplates().find((x) => x.id === input.template);
    if (!t) throw new TeamFileError("not_found", "That template does not exist.", {}, 404);
    parsed = parseTeamFile(t.text, opts);
    source = { kind: "template", label: parsed.meta.title };
  } else if (typeof input.url === "string" && input.url.trim()) {
    const got = await fetchTeamFile(input.url);
    parsed = parseTeamFile(got.text, opts);
    source = got.source;
  } else {
    parsed = parseTeamFile(typeof input.text === "string" ? input.text : "", opts);
    source = { kind: "file", label: typeof input.filename === "string" && input.filename.trim() ? oneLine(input.filename, 120) : tr(user.locale, "Your file") };
  }
  const previewId = randomBytes(18).toString("base64url");
  const mine = [...pending.entries()].filter(([, p]) => p.userId === user.id);
  for (const [k] of mine.slice(0, Math.max(0, mine.length - 4))) pending.delete(k);
  pending.set(previewId, { userId: user.id, parsed, source, until: now() + PREVIEW_MS });

  const room = planRoom(user.id);
  const warnings = [...parsed.warnings];
  if (room.bots !== null && parsed.bots.length > room.bots) warnings.push({ code: "bots_limit", n: room.bots });
  const full = teamFullAt(parsed.bots.length);
  if (full !== null) warnings.push({ code: "team_full", n: full });
  const routineCount = parsed.bots.reduce((n, b) => n + b.routines.length, 0);
  if (room.activeRoutines !== null && routineCount > room.activeRoutines) warnings.push({ code: "routines_limit", n: room.activeRoutines });
  const apps: string[] = [];
  for (const b of parsed.bots) for (const a of b.apps) if (!apps.some((x) => x.toLowerCase() === a.toLowerCase())) apps.push(a);
  return {
    previewId, source, meta: parsed.meta, bots: parsed.bots.map((b) => ({ ...b, skills: b.skills.map(withScan), nameTaken: !!bots.byName(user.id, b.name) })), apps,
    masked: parsed.masked, removed: parsed.removed, warnings, room: { bots: room.bots, activeRoutines: room.activeRoutines },
  };
}

export function commitTeamFile(user: UserRecord, previewId: string, choices: TeamFileChoice[], opts: { section?: unknown } = {}): TeamFileReport {
  const p = pending.get(previewId);
  if (!p || p.userId !== user.id || p.until < now()) throw new TeamFileError("expired", "This preview has expired. Open the template or the file again.");
  const src = p.parsed;
  const seen = new Set<number>();
  const picked = choices.filter((c) => c && c.include && Number.isInteger(c.index) && src.bots[c.index] && !seen.has(c.index) && (seen.add(c.index), true));
  if (!picked.length) throw new TeamFileError("nothing", "Nothing is ticked: choose at least one bot.");
  // Limits first, so a refusal creates nothing: this installation (MAX_BOTS), then the account's plan (hosted mode).
  bots.assertRoom(picked.length);
  const room = planRoom(user.id);
  if (room.bots !== null && picked.length > room.bots) throw planLimitError("bots", room.maxBots!);

  const locale = user.locale;
  const sectionName = typeof opts.section === "string" ? oneLine(opts.section, 40) : "";
  const usedNames = new Set<string>();
  const report: TeamFileReport = { bots: [], skills: 0, routines: 0, unscheduled: [], apps: [], section: null };
  const todo: { botId: string; apps: string[]; drafts: number; paused: number; unscheduled: string[] }[] = [];
  q.tx(() => {
    if (sectionName) { const sec = sections.create(user.id, sectionName); report.section = { id: sec.id, name: sec.name }; }
    for (const c of picked) {
      const b = src.bots[c.index];
      const wanted = oneLine(typeof c.name === "string" && c.name.trim() ? c.name : b.name, 60) || b.name;
      const name = freeName(wanted, (n) => usedNames.has(n.toLowerCase()) || !!bots.byName(user.id, n));
      usedNames.add(name.toLowerCase());
      const instructions = [b.instructions, b.personality ? tr(locale, "Personality and tone: {text}", { text: b.personality }) : ""].filter(Boolean).join("\n\n");
      // Careful autonomy, the account's default model (""), the default tools: nothing in a file hands out trust,
      // a model or a permission. The look is only a look.
      const bot = bots.create(user.id, {
        name, description: b.role, instructions, autonomy: "careful", model: "", mode: "teammate",
        ...(b.look.shape ? { shape: b.look.shape } : {}), ...(b.look.color ? { color: b.look.color } : {}), character: b.look.character,
      });
      if (report.section) bots.patch(bot.id, { sectionId: report.section.id });
      report.bots.push({ id: bot.id, name: bot.name });

      const skillNames = new Set<string>();
      let drafts = 0;
      for (const sc of Array.isArray(c.skills) ? c.skills : b.skills.map((_, index) => ({ index, include: true }) as { index: number; include: boolean; name?: string })) {
        const s = sc?.include && Number.isInteger(sc.index) ? b.skills[sc.index] : undefined;
        if (!s) continue;
        const sName = freeName(oneLine(typeof sc.name === "string" && sc.name.trim() ? sc.name : s.name, 80) || s.name, (n) => skillNames.has(n.toLowerCase()), 80);
        skillNames.add(sName.toLowerCase());
        skills.create(bot.id, sName, s.when, s.steps, false, { draft: true });
        drafts++;
      }
      let paused = 0;
      const unscheduled: string[] = [];
      for (const rc of Array.isArray(c.routines) ? c.routines : b.routines.map((_, index) => ({ index, include: true }) as { index: number; include: boolean; name?: string; cron?: string })) {
        const r = rc?.include && Number.isInteger(rc.index) ? b.routines[rc.index] : undefined;
        if (!r) continue;
        const rName = oneLine(typeof rc.name === "string" && rc.name.trim() ? rc.name : r.name, 80) || r.name;
        const cron = typeof rc.cron === "string" && rc.cron.trim() ? validCron(rc.cron) : r.cron;
        if (!cron) { unscheduled.push(r.schedule ? `${rName} (${r.schedule})` : rName); continue; }
        routines.create(bot.id, { name: rName, prompt: r.task, trigger: "cron", schedule: cron, timezone: r.timezone, paused: true });
        paused++;
      }
      const appPick = Array.isArray(c.apps) ? new Set(c.apps.filter((i) => Number.isInteger(i))) : null;
      const apps = b.apps.filter((_, i) => !appPick || appPick.has(i));
      report.skills += drafts; report.routines += paused;
      report.unscheduled.push(...unscheduled);
      for (const a of apps) if (!report.apps.some((x) => x.toLowerCase() === a.toLowerCase())) report.apps.push(a);
      todo.push({ botId: bot.id, apps, drafts, paused, unscheduled });
    }
  });
  pending.delete(previewId);

  const from = p.source.kind === "template" ? tr(locale, "Created from the template “{name}”.", { name: p.source.label }) : tr(locale, "Created from a team file ({name}).", { name: p.source.label });
  for (const t of todo) {
    const items = [
      t.apps.length ? tr(locale, "connect {apps} (Settings → Apps); no key or sign-in was imported", { apps: t.apps.join(", ") }) : "",
      t.drafts ? tr(locale, "read its {n} draft skill(s) and activate the ones you keep (its settings → Skills)", { n: t.drafts }) : "",
      t.paused ? tr(locale, "check its {n} paused routine(s), then turn them on", { n: t.paused }) : "",
      t.unscheduled.length ? tr(locale, "say when these should run, then create them: {list}", { list: t.unscheduled.join("; ") }) : "",
    ].filter(Boolean);
    const text = `${from} ${tr(locale, "It starts careful: it asks before acting.")}${items.length ? ` ${tr(locale, "To do:")} ${items.map((x) => `• ${x}`).join(" ")}` : ""}`;
    rows.append({ id: t.botId, userId: user.id }, { kind: "notice", tone: "info", text, ...(t.apps.length ? { action: { kind: "settings" as const, section: "connectors" } } : {}) });
  }
  emit(user.id, { type: "roster" });
  if (report.section) emit(user.id, { type: "sections" });
  audit(user.id, "account", `Bots created from ${p.source.kind === "template" ? "the template" : p.source.kind === "url" ? `a team file at ${p.source.label}` : "a team file"} “${src.meta.title}”: ${report.bots.map((b) => b.name).join(", ")} (${report.skills} draft skills, ${report.routines} paused routines)`);
  return report;
}

/** Tests: the previews kept in memory, and the gallery cache. */
export const _teamPending = pending;
export const _resetGallery = () => { gallery = null; };
