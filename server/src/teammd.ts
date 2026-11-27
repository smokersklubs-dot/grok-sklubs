import { catalogFor } from "./catalog.js"; import { localize } from "./lang/index.js";
import { describeCron, isValidTimezone } from "./cron.js";
import { CREDENTIAL_KEY, GrokImportError, scrub, validCron, type Cleaner } from "./grokimport.js";
import { mentionsKey } from "./projectimport.js";
import { scanSkill } from "./skillscan.js";
import { DEFAULT_CHARACTER, type Character, type GrokImportStripped, type Locale, type RoomRule } from "./shared.js";
import { libraryEntries } from "./skillslibrary.js";
import { clip } from "./store.js";
import { lookLine, parseLook } from "./teamfile.js";
import {
  TEAM_MD_FORMAT, TEAM_MD_MAX_BYTES, TEAM_MD_RULES,
  type TeamMdBot, type TeamMdConnector, type TeamMdGroup, type TeamMdMeta, type TeamMdRemoved, type TeamMdSkill, type TeamMdWarning,
} from "./teammdtypes.js";
import { yamlIsMap, YamlError, yamlRead, yamlWrite, type YamlMap, type YamlValue } from "./teammdyaml.js";

/**
 * « Équipe Sklubot (.md) » (docs/FORMAT-EQUIPE.md), format `sklubot-team/1`: reading and writing the file.
 *
 * The YAML header is the machine part, a strict allowlist: the team (id, name, description, version, language, author,
 * chief), its bots (name, role, look, personality, instructions, a suggested brain, skills of the Bibliothèque by id or
 * inline SKILL.md texts, routines), its groups (members by name and « qui répond »), and the apps to connect, by name
 * only. The Markdown after it is the playbook, for people (shown at import, never executed or turned into settings).
 *
 * A package never carries a key, a chat, a memory, a permission, an autonomy level or computer access: such fields are
 * dropped and listed ("removed": forbidden / secret / unknown, never their value), and anything that looks like a secret
 * inside an allowed text is replaced by a marker ("masked").
 */

export const TEAM_MD_LIMITS = { bots: 20, skills: 30, routines: 20, groups: 20, connectors: 40 } as const;

const FR: Record<string, string> = {
  "This file is empty.": "Ce fichier est vide.",
  "This file is too large ({kb} KB; 512 KB at most).": "Ce fichier est trop gros ({kb} Ko ; 512 Ko au plus).",
  "This address gives a web page, not a team file. Use the file's raw address.": "Cette adresse donne une page web, pas un fichier d'équipe. Utilise l'adresse brute du fichier.",
  "This file has no header: a team file starts with a line “---”, then “format: sklubot-team/1”.": "Ce fichier n'a pas d'en-tête : un fichier d'équipe commence par une ligne « --- », puis « format: sklubot-team/1 ».",
  "The header is not closed: add a line “---” after it.": "L'en-tête n'est pas fermé : ajoute une ligne « --- » après lui.",
  "This is an older Sklubot team file: open it with « Partir d'un modèle » → Fichier.": "C'est un ancien fichier d'équipe Sklubot : ouvre-le avec « Partir d'un modèle » → Fichier.",
  "This is not a Sklubot team file (its format is “{format}”; expected “sklubot-team/1”).": "Ce n'est pas un fichier d'équipe Sklubot (son format est « {format} » ; attendu : « sklubot-team/1 »).",
  "This file does not say its format: add “format: sklubot-team/1” to its header.": "Ce fichier ne dit pas son format : ajoute « format: sklubot-team/1 » à son en-tête.",
  "This file has no bot: add a “bots:” list with at least one “- name: …”.": "Ce fichier n'a aucun bot : ajoute une liste « bots: » avec au moins un « - name: … ».",
  "The header cannot be read, line {line}: {detail}": "L'en-tête ne se lit pas, ligne {line} : {detail}",
  // teammdyaml.ts reasons.
  "The header is too long.": "L'en-tête est trop long.", "The header has too many values.": "L'en-tête a trop de valeurs.",
  "Use spaces, not tabs, at the start of a line.": "Mets des espaces, pas des tabulations, en début de ligne.",
  "Anchors (&) are not allowed: write the value itself.": "Les ancres (&) ne sont pas permises : écris la valeur elle-même.",
  "Aliases (*) are not allowed: write the value itself.": "Les alias (*) ne sont pas permis : écris la valeur elle-même.",
  "Tags (!) are not allowed.": "Les étiquettes (!) ne sont pas permises.",
  "A value cannot start with this character: put it between quotes.": "Une valeur ne peut pas commencer par ce caractère : mets-la entre guillemets.",
  "A quoted text is not closed (or something follows it).": "Un texte entre guillemets n'est pas fermé (ou quelque chose le suit).",
  "This quoted text uses an escape that is not allowed.": "Ce texte entre guillemets utilise un échappement non permis.",
  "This quoted key uses an escape that is not allowed.": "Cette clé entre guillemets utilise un échappement non permis.",
  "A list in [ ] must open and close on the same line.": "Une liste entre [ ] doit s'ouvrir et se fermer sur la même ligne.",
  "Lists inside lists are not allowed: write one item per line.": "Pas de liste dans une liste : écris un élément par ligne.",
  "Use one key per line instead of { … }.": "Écris une clé par ligne au lieu de { … }.",
  "Only one header is allowed.": "Un seul en-tête est permis.",
  "After | or >, put the text on the next lines (indentation numbers are not allowed).": "Après | ou >, mets le texte sur les lignes suivantes (sans chiffre d'indentation).",
  "The header is nested too deeply.": "L'en-tête est trop imbriqué.",
  "This line is indented more than the one before it.": "Cette ligne est plus en retrait que la précédente.",
  "Complex keys (?) are not allowed.": "Les clés complexes (?) ne sont pas permises.",
  "This line is not “key: value”.": "Cette ligne n'est pas de la forme « clé: valeur ».",
  "This line is not “key: value” (a “:” is missing).": "Cette ligne n'est pas de la forme « clé: valeur » (il manque « : »).",
  "Merge keys (<<) are not allowed.": "Les clés de fusion (<<) ne sont pas permises.",
  "This key name is not allowed.": "Ce nom de clé n'est pas permis.",
  "The key “{key}” is given twice.": "La clé « {key} » est donnée deux fois.",
  "The header's first key must start at the beginning of the line.": "La première clé de l'en-tête doit commencer en début de ligne.",
  "The header must be a list of “key: value” lines, not a list.": "L'en-tête doit être une suite de lignes « clé: valeur », pas une liste.",
  // Fetching, preview, commit, export (teammdimport.ts).
  "That is not a full address (it should start with https://).": "Ce n'est pas une adresse complète (elle doit commencer par https://).",
  "Team files are fetched over https only.": "Les fichiers d'équipe ne se récupèrent qu'en https.",
  "That address holds a sign-in: remove it.": "Cette adresse contient un identifiant : retire-le.",
  "Could not fetch it: {detail}": "Impossible de le récupérer : {detail}",
  "Could not fetch it (status {status}).": "Impossible de le récupérer (code {status}).",
  "That is not a text file ({type}).": "Ce n'est pas un fichier texte ({type}).",
  "That file is too large (512 KB at most).": "Ce fichier est trop gros (512 Ko au plus).",
  "The address sent the download to an address that is not https: it was refused.": "L'adresse a renvoyé le téléchargement vers une adresse qui n'est pas en https : refusé.",
  "Too many redirections.": "Trop de redirections.",
  "That address is on a private or local network, which this server does not reach.": "Cette adresse est sur un réseau privé ou local, que ce serveur ne joint pas.",
  "The request took too long.": "La demande a pris trop de temps.", "That address could not be found.": "Cette adresse est introuvable.",
  "That server could not be reached.": "Ce serveur ne répond pas.",
  "This preview has expired. Open the file again.": "Cet aperçu a expiré. Ouvre le fichier à nouveau.",
  "Nothing is ticked: choose at least one bot.": "Rien n'est coché : choisis au moins un bot.",
  "This team was not imported before: create it instead.": "Cette équipe n'a jamais été importée : crée-la plutôt.",
  "That section does not exist.": "Cette section n'existe pas.", "That bot does not exist.": "Ce bot n'existe pas.",
  "There is no bot to share here.": "Il n'y a aucun bot à partager ici.",
  "Too many tries. Wait a little and try again.": "Trop d'essais. Attends un peu et réessaie.",
};
const say = (loc: Locale | undefined, en: string, vars: Record<string, string | number> = {}) =>
  localize(loc, en, FR).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

/** A refusal in plain words (English text, translated here); a `detail` var is translated too. Shown by routes.ts onError. */
export class TeamMdError extends GrokImportError {
  override text(locale: Locale | undefined) {
    const vars = typeof this.vars.detail === "string" ? { ...this.vars, detail: say(locale, this.vars.detail, this.vars) } : this.vars;
    return say(locale, this.english, vars);
  }
}

// ── Vocabulary ───────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, "");
const aliases = (map: Record<string, string[]>) => {
  const out = new Map<string, string>();
  for (const [canon, list] of Object.entries(map)) for (const a of [canon, ...list]) out.set(norm(a), canon);
  return out;
};
const TOP = aliases({
  format: [], id: [], name: ["title", "titre", "nom"], description: ["resume"], version: [], language: ["langue", "lang"],
  author: ["auteur"], chief: ["chef", "lead", "principal", "mainbot", "botprincipal"], bots: ["equipe", "team"],
  groups: ["groupes", "rooms", "salons", "sections"], connectors: ["applis", "apps", "connecteurs", "integrations"], tags: ["etiquettes"],
});
const BOT = aliases({
  name: ["nom"], role: ["job", "metier", "poste"], look: ["apparence", "mascot", "mascotte", "avatar"], personality: ["personnalite", "tone", "ton"],
  instructions: ["consignes", "prompt"], model: ["modele", "brain", "cerveau", "modelhint"], skills: ["competences"], routines: [],
  connectors: ["applis", "apps", "connecteurs"],
});
const SKILL = aliases({ library: ["bibliotheque", "libraryid"], name: ["nom"], when: ["quand", "description", "trigger"], steps: ["etapes", "body", "texte"], skillmd: ["skill", "skillfile"] });
const ROUTINE = aliases({ name: ["nom"], cron: [], timezone: ["fuseau", "tz"], task: ["tache", "prompt", "texte"], schedule: ["horaire", "quand", "when"], paused: ["enpause", "enabled", "active"] });
const GROUP = aliases({ name: ["nom"], members: ["membres", "bots"], rule: ["whoanswers", "quirepond", "reply", "repond"], lead: ["chef", "meneur"] });
const CONNECTOR = aliases({ name: ["nom", "app"], for: ["bots", "pour"], why: ["pourquoi", "usage"] });
const LOOK = new Set(["shape", "color", "type", "eyes", "accessory", "idle", "mouth", "cheeks", "intensity", "tint"]);
/** Fields refused on purpose (not just unknown): what a package never carries. */
const FORBIDDEN = /memor|souvenir|chat|conversation|histor|message|transcript|permission|autonom|approv|validation|trust|confiance|computer|ordinateur|machine|desktop|shell|vault|coffre|telegram|webhook|workspace|espace|email|mail|phone|telephone|address|adresse|url|endpoint|host|budget|plafond|spend|cost|voice|voix|tool|outil|access|acces|share|partage|primary|effort|owner|user|account|compte|file|fichier/;
const secretKey = (k: string) => CREDENTIAL_KEY.test(k) || /(^|[^a-z])(api)?key$|^cle$|apikey|clef/.test(norm(k));
const tidy = (s: string, n: number) => clip(s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim(), n);
const oneLine = (s: string, n: number) => tidy(s.replace(/\s*\n\s*/g, " "), n);
const MODEL_REF = /^[a-z0-9][a-z0-9_.-]{0,40}:[A-Za-z0-9._/:@+-]{1,120}$/;

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type ParsedBot = Omit<TeamMdBot, "nameTaken" | "suggestedName" | "existingId" | "modelAvailable">;
export interface ParsedTeamMd {
  meta: TeamMdMeta; bots: ParsedBot[]; groups: Omit<TeamMdGroup, "existingId">[]; connectors: TeamMdConnector[]; playbook: string;
  masked: GrokImportStripped[]; removed: TeamMdRemoved[]; warnings: TeamMdWarning[];
}

const L = (l: Locale, fr: string, en: string) => (l === "fr" ? fr : en);
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

/** The header and the body of a file ("---" lines at the start of a line only: indented ones are inside a text). */
export function splitTeamMd(text: string): { header: string; body: string; headerLine: number } {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (!/^---\s*$/.test(lines[i] ?? "")) throw new TeamMdError("no_header", "This file has no header: a team file starts with a line “---”, then “format: sklubot-team/1”.");
  for (let j = i + 1; j < lines.length; j++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[j])) return { header: lines.slice(i + 1, j).join("\n"), body: lines.slice(j + 1).join("\n"), headerLine: i + 2 };
  }
  throw new TeamMdError("no_header", "The header is not closed: add a line “---” after it.");
}

/** Reads a team file. Throws TeamMdError when it cannot be used; everything else is reported, never silently dropped. */
export function parseTeamMd(raw: string, opts: { locale?: Locale; timezone?: string } = {}): ParsedTeamMd {
  const locale: Locale = opts.locale ?? "en";
  const fallbackTz = opts.timezone && isValidTimezone(opts.timezone) ? opts.timezone : "UTC";
  const text = (typeof raw === "string" ? raw : "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new TeamMdError("empty", "This file is empty.");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > TEAM_MD_MAX_BYTES) throw new TeamMdError("too_large", "This file is too large ({kb} KB; 512 KB at most).", { kb: Math.ceil(bytes / 1024) }, 413);
  if (/^\s*<(!doctype|html)/i.test(text)) throw new TeamMdError("html", "This address gives a web page, not a team file. Use the file's raw address.");
  const { header, body, headerLine } = splitTeamMd(text);
  let fm: YamlMap;
  try { fm = yamlRead(header, headerLine); }
  catch (err) { if (err instanceof YamlError) throw new TeamMdError("yaml", "The header cannot be read, line {line}: {detail}", { line: err.line, detail: err.reason, ...err.vars }); throw err; }

  const removed: TeamMdRemoved[] = [];
  const warnings: TeamMdWarning[] = [];
  const cx: Cleaner = { stripped: [], placeholder: L(locale, "[secret retiré]", "[secret removed]") };
  const drop = (where: string, field: string) => removed.push({ where, field: clip(field, 60), reason: secretKey(field) ? "secret" : FORBIDDEN.test(norm(field)) ? "forbidden" : "unknown" });
  /** The allowed fields of a map, by canonical name; the others are reported under `where`. */
  const pick = (v: YamlValue | undefined, vocab: Map<string, string>, where: string): Record<string, YamlValue> => {
    const out: Record<string, YamlValue> = Object.create(null);
    if (!yamlIsMap(v)) return out;
    for (const [k, val] of Object.entries(v)) {
      const canon = vocab.get(norm(k));
      if (canon && !(canon in out)) out[canon] = val; else drop(where, k);
    }
    return out;
  };
  const str = (v: YamlValue | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "");
  const list = (v: YamlValue | undefined): YamlValue[] => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const clean = (s: string, where: string, n: number, single = false) => { const t = scrub(s, where, cx).text; return single ? oneLine(t, n) : tidy(t, n); };

  const top = pick(fm, TOP, L(locale, "en-tête", "header"));
  const format = str(top.format).trim();
  if (format === "sklubot-equipe") throw new TeamMdError("old_format", "This is an older Sklubot team file: open it with « Partir d'un modèle » → Fichier.");
  if (!format) throw new TeamMdError("no_format", "This file does not say its format: add “format: sklubot-team/1” to its header.");
  const fv = /^sklubot-team\/(\d+)$/.exec(format);
  if (!fv) throw new TeamMdError("not_team_file", "This is not a Sklubot team file (its format is “{format}”; expected “sklubot-team/1”).", { format: clip(format, 40) });
  if (Number(fv[1]) > 1) warnings.push({ code: "newer_version", n: Number(fv[1]) });

  const head = L(locale, "en-tête", "header");
  const name = clean(str(top.name), head, 80, true);
  const meta: TeamMdMeta = {
    id: "", name, description: clean(str(top.description), head, 600, true), version: oneLine(str(top.version), 20),
    language: oneLine(str(top.language), 10), author: clean(str(top.author), head, 80, true), chief: clean(str(top.chief), head, 60, true),
  };
  const rawId = str(top.id).trim();
  meta.id = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(rawId) ? rawId : slug(name) || "";

  // Bots.
  const rawBots = list(top.bots);
  if (!rawBots.length) throw new TeamMdError("no_bots", "This file has no bot: add a “bots:” list with at least one “- name: …”.");
  if (rawBots.length > TEAM_MD_LIMITS.bots) warnings.push({ code: "too_many_bots", n: TEAM_MD_LIMITS.bots });
  let cut = false;
  const library = libraryEntries();
  const unknownLibrary: string[] = [];
  const botConnectors: { name: string; bot: string }[] = [];
  const bots: ParsedBot[] = [];
  for (const [bi, rb] of rawBots.slice(0, TEAM_MD_LIMITS.bots).entries()) {
    const f = pick(rb, BOT, `#${bi + 1}`);
    const bName = clean(str(f.name), `#${bi + 1}`, 60, true) || `Bot ${bi + 1}`;
    // Fields reported under "#n" before the name was known are given the name.
    for (const r of removed) if (r.where === `#${bi + 1}`) r.where = bName;
    const lookMap = yamlIsMap(f.look) ? f.look : null;
    const lookParts: string[] = [];
    if (lookMap) for (const [k, v] of Object.entries(lookMap)) { if (LOOK.has(k) && typeof v === "string") lookParts.push(`${k}=${v.replace(/\s+/g, "")}`); else drop(`${bName} › ${L(locale, "apparence", "look")}`, k); }
    else if (typeof f.look === "string") lookParts.push(f.look);
    const look = parseLook(lookParts.join(" "), (k) => drop(`${bName} › ${L(locale, "apparence", "look")}`, k));

    let model = oneLine(str(f.model), 160);
    if (model && (!MODEL_REF.test(model) || model.startsWith("up-") || scrub(model, `${bName} › model`, { stripped: [], placeholder: "" }).found)) { drop(bName, "model"); model = ""; }

    const skills: TeamMdSkill[] = [];
    const rawSkills = list(f.skills);
    if (rawSkills.length > TEAM_MD_LIMITS.skills) cut = true;
    for (const [si, rs] of rawSkills.slice(0, TEAM_MD_LIMITS.skills).entries()) {
      const where = `${bName} › ${L(locale, "compétence", "skill")} ${si + 1}`;
      const sf = typeof rs === "string" ? { library: rs } as Record<string, YamlValue> : pick(rs, SKILL, where);
      if (typeof sf.library === "string" && sf.library.trim()) {
        const id = sf.library.trim().toLowerCase();
        const e = library.find((x) => x.id === id);
        if (!e) unknownLibrary.push(clip(id, 60));
        skills.push({ kind: "library", libraryId: clip(id, 64), name: e ? (e.title[locale] ?? e.title.en) : clip(id, 64), when: e ? (e.summary[locale] ?? e.summary.en) : "", body: "", known: !!e, mentionsKey: false });
        continue;
      }
      let sName = str(sf.name), when = str(sf.when), steps = str(sf.steps);
      if (typeof sf.skillmd === "string" && sf.skillmd.trim()) {
        const md = parseSkillMd(sf.skillmd);
        sName = sName || md.name; when = when || md.description; steps = md.body;
      }
      if (!steps.trim() && !when.trim()) continue;
      const body = clean(steps || when, where, 20_000);
      const label = clean(sName, where, 80, true) || `${L(locale, "Compétence", "Skill")} ${si + 1}`;
      skills.push({ kind: "inline", libraryId: "", name: label, when: clean(when, where, 300, true), body, known: true, mentionsKey: mentionsKey(steps), scan: scanSkill({ name: label, description: when, body }) });
    }

    const routines: ParsedBot["routines"] = [];
    const unscheduled: string[] = [];
    const rawRoutines = list(f.routines);
    if (rawRoutines.length > TEAM_MD_LIMITS.routines) cut = true;
    for (const [ri, rr] of rawRoutines.slice(0, TEAM_MD_LIMITS.routines).entries()) {
      const where = `${bName} › routine ${ri + 1}`;
      const rf = pick(rr, ROUTINE, where);
      const rName = clean(str(rf.name), where, 80, true) || `Routine ${ri + 1}`;
      const task = clean(str(rf.task), where, 4000);
      const schedule = clean(str(rf.schedule), where, 200, true);
      if (!task && !str(rf.cron).trim()) continue;
      const cron = validCron(str(rf.cron).replace(/`/g, ""));
      const tz = str(rf.timezone).trim();
      if (!cron) { unscheduled.push(schedule ? `${rName} (${schedule})` : rName); continue; }
      // "paused"/"enabled" are read and ignored: a routine always arrives paused.
      routines.push({ name: rName, cron, timezone: tz && isValidTimezone(tz) ? tz : fallbackTz, task: task || rName, describe: describeCron(cron, locale) });
    }
    for (const c of list(f.connectors)) if (typeof c === "string") botConnectors.push({ name: c, bot: bName });

    bots.push({
      name: bName, role: clean(str(f.role), bName, 500, true), personality: clean(str(f.personality), bName, 2000),
      instructions: clean(str(f.instructions), bName, 8000), look, model, skills, routines, unscheduled, chief: false,
    });
  }
  // Two bots of the file with the same name: the later ones get a number (members and chief name the first).
  const seen = new Set<string>();
  for (const b of bots) { let n = b.name, i = 2; while (seen.has(n.toLowerCase())) n = `${b.name} (${i++})`; b.name = n; seen.add(n.toLowerCase()); }
  const byName = (n: string) => bots.find((b) => b.name.toLowerCase() === n.trim().toLowerCase());
  if (meta.chief) { const c = byName(meta.chief); if (c) c.chief = true; else { warnings.push({ code: "chief_missing", detail: meta.chief }); meta.chief = ""; } }
  if (unknownLibrary.length) warnings.push({ code: "unknown_library", n: unknownLibrary.length, detail: [...new Set(unknownLibrary)].slice(0, 5).join(", ") });
  const keyLike = bots.reduce((n, b) => n + b.skills.filter((s) => s.mentionsKey).length, 0);
  if (keyLike) warnings.push({ code: "key_like", n: keyLike });
  const noCron = bots.reduce((n, b) => n + b.unscheduled.length, 0);
  if (noCron) warnings.push({ code: "routine_no_cron", n: noCron });

  // Groups.
  const groups: ParsedTeamMd["groups"] = [];
  const rawGroups = list(top.groups);
  if (rawGroups.length > TEAM_MD_LIMITS.groups) cut = true;
  for (const [gi, rg] of rawGroups.slice(0, TEAM_MD_LIMITS.groups).entries()) {
    const where = `${L(locale, "groupe", "group")} ${gi + 1}`;
    const g = pick(rg, GROUP, where);
    const gName = clean(str(g.name), where, 60, true) || `${L(locale, "Groupe", "Group")} ${gi + 1}`;
    const members: string[] = [], missing: string[] = [];
    for (const m of list(g.members)) {
      if (typeof m !== "string") continue;
      const b = byName(m);
      if (b && !members.includes(b.name)) members.push(b.name); else if (!b) missing.push(clip(oneLine(m, 60), 60));
    }
    const ruleRaw = norm(str(g.rule));
    const rule: RoomRule = (TEAM_MD_RULES as readonly string[]).includes(ruleRaw) ? ruleRaw as RoomRule
      : ruleRaw === "tous" || ruleRaw === "all" ? "everyone" : ruleRaw === "mentions" || ruleRaw === "mention" ? "mentions" : ruleRaw === "chef" || ruleRaw === "meneur" ? "lead" : ruleRaw === "automatique" ? "auto" : "lead";
    const leadBot = byName(str(g.lead)) ?? (meta.chief ? byName(meta.chief) : undefined);
    // The lead answers first: it is the room's first member (roomrouting.ts).
    const lead = leadBot && members.includes(leadBot.name) ? leadBot.name : members[0] ?? "";
    if (lead) { members.splice(members.indexOf(lead), 1); members.unshift(lead); }
    if (missing.length) warnings.push({ code: "group_missing", detail: `${gName}: ${missing.slice(0, 5).join(", ")}` });
    if (members.length >= 2) groups.push({ name: gName, members, rule, lead, missing });
    else warnings.push({ code: "group_missing", detail: gName });
  }

  // Apps to connect, by name only: an address, a sign-in or a key is never taken.
  const catalog = [...catalogFor("en"), ...catalogFor("fr")];
  const connectors: TeamMdConnector[] = [];
  const addConnector = (rawName: string, forBots: string[], why: string, where: string) => {
    const n = oneLine(rawName.replace(/https?:\/\/\S+/g, "").replace(/[^\s()]+@[^\s()]+/g, "").replace(/[`*_[\]()<>{}]/g, ""), 60);
    if (!n || scrub(n, where, cx).found) return;
    const known = catalog.find((a) => a.name.toLowerCase() === n.toLowerCase() || a.id === n.toLowerCase());
    const label = known ? known.name : n;
    const cur = connectors.find((c) => c.name.toLowerCase() === label.toLowerCase());
    if (cur) { for (const b of forBots) if (!cur.for.includes(b)) cur.for.push(b); if (!cur.why && why) cur.why = why; return; }
    if (connectors.length >= TEAM_MD_LIMITS.connectors) { cut = true; return; }
    connectors.push({ name: label, inCatalog: !!known, for: forBots, why });
  };
  for (const [ci, rc] of list(top.connectors).entries()) {
    const where = `${L(locale, "appli", "app")} ${ci + 1}`;
    if (typeof rc === "string") { addConnector(rc, [], "", where); continue; }
    const c = pick(rc, CONNECTOR, where);
    const forBots = list(c.for).filter((x): x is string => typeof x === "string").map((x) => byName(x)?.name).filter((x): x is string => !!x);
    addConnector(str(c.name), forBots, clean(str(c.why), where, 200, true), where);
  }
  for (const bc of botConnectors) addConnector(bc.name, [bc.bot], "", bc.bot);
  if (cut) warnings.push({ code: "too_many_items" });

  const playbook = tidy(scrub(body, L(locale, "mode d'emploi", "playbook"), cx).text, 6000);
  return { meta, bots, groups, connectors, playbook, masked: cx.stripped, removed, warnings };
}

/** A SKILL.md text: its own small header (name, description) and its body. */
export function parseSkillMd(md: string): { name: string; description: string; body: string } {
  const text = md.replace(/\r\n?/g, "\n");
  try {
    const s = splitTeamMd(text);
    const h = yamlRead(s.header);
    const v = (k: string) => (typeof h[k] === "string" ? (h[k] as string) : "");
    return { name: v("name"), description: v("description"), body: s.body.trim() };
  } catch { return { name: "", description: "", body: text.trim() }; }
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TeamMdInput {
  meta: TeamMdMeta;
  bots: {
    name: string; role: string; personality: string; instructions: string;
    look: { shape: TeamMdBot["look"]["shape"]; color: TeamMdBot["look"]["color"]; character: Character };
    model: string;
    skills: ({ kind: "library"; libraryId: string } | { kind: "inline"; name: string; when: string; body: string })[];
    routines: { name: string; cron: string; timezone: string; task: string }[];
  }[];
  groups: { name: string; members: string[]; rule: RoomRule; lead: string }[];
  connectors: { name: string; for: string[]; why: string }[];
}

function lookMap(look: TeamMdInput["bots"][number]["look"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of lookLine({ ...look, character: look.character ?? DEFAULT_CHARACTER }).split(" ")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) out[k] = v;
  }
  return out;
}

const skillMd = (s: { name: string; when: string; body: string }) => `---\nname: ${JSON.stringify(s.name)}\ndescription: ${JSON.stringify(s.when)}\n---\n\n${s.body.trim()}`;

/** The whole file: the header (the machine part) and a playbook generated from the same data (the human part). */
export function writeTeamMd(input: TeamMdInput, locale: Locale = "fr"): string {
  const m = input.meta;
  const header = yamlWrite({
    format: TEAM_MD_FORMAT, id: m.id, name: m.name, description: m.description, version: m.version || "1", language: m.language || locale,
    author: m.author, chief: m.chief,
    bots: input.bots.map((b) => ({
      name: b.name, role: b.role, look: lookMap(b.look), model: b.model, personality: b.personality, instructions: b.instructions,
      skills: b.skills.map((s) => (s.kind === "library" ? { library: s.libraryId } : { skill_md: skillMd(s) })),
      routines: b.routines.map((r) => ({ name: r.name, cron: r.cron, timezone: r.timezone, task: r.task })),
    })),
    groups: input.groups.map((g) => ({ name: g.name, members: g.members, rule: g.rule, lead: g.lead })),
    connectors: input.connectors.map((c) => ({ name: c.name, for: c.for, why: c.why })),
  });
  return `---\n${header}\n---\n\n${playbookOf(input, locale)}`;
}

const md = (s: string) => s.replace(/([\\`*_[\]<>|#])/g, "\\$1");
const RULE_TEXT: Record<RoomRule, [string, string]> = {
  lead: ["le meneur répond d'abord", "the lead answers first"], everyone: ["tout le monde répond", "everyone answers"],
  mentions: ["seul le bot mentionné répond", "only the bot that is mentioned answers"], auto: ["Sklubot choisit qui répond", "Sklubot picks who answers"],
};

function playbookOf(input: TeamMdInput, locale: Locale): string {
  const fr = locale === "fr";
  const lib = libraryEntries();
  const out: string[] = [`# ${md(input.meta.name || (fr ? "Équipe" : "Team"))}`, ""];
  if (input.meta.description) out.push(md(input.meta.description), "");
  out.push(fr
    ? "> Fichier d'équipe Sklubot (format `sklubot-team/1`). Pour l'utiliser : Sklubot → **+** → **Importer une équipe (.md)**. Rien n'est créé avant ta relecture : les routines arrivent en pause, les applis restent à connecter, aucun secret n'est dans ce fichier."
    : "> Sklubot team file (format `sklubot-team/1`). To use it: Sklubot → **+** → **Import a team (.md)**. Nothing is created before you review it: routines arrive paused, apps stay to connect, no secret is in this file.", "");
  out.push(fr ? "## L'équipe" : "## The team", "");
  for (const b of input.bots) out.push(`- **${md(b.name)}**${b.name === input.meta.chief ? (fr ? " (chef d'équipe)" : " (team lead)") : ""}${b.role ? ` — ${md(b.role)}` : ""}`);
  out.push("");
  for (const b of input.bots) {
    out.push(`## ${md(b.name)}`, "");
    if (b.role) out.push(md(b.role), "");
    const first = b.instructions.split(/\n{2,}/)[0]?.trim();
    if (first) out.push(...first.split("\n").map((l) => `> ${md(l)}`), "");
    if (b.skills.length) {
      out.push(fr ? "**Compétences**" : "**Skills**", "");
      for (const s of b.skills) {
        if (s.kind === "library") { const e = lib.find((x) => x.id === s.libraryId); out.push(`- ${md(e ? (e.title[locale] ?? e.title.en) : s.libraryId)}${fr ? " (bibliothèque)" : " (library)"}`); }
        else out.push(`- ${md(s.name)}${s.when ? ` — ${md(s.when)}` : ""}`);
      }
      out.push("");
    }
    if (b.routines.length) {
      out.push(fr ? "**Routines** (en pause à l'import)" : "**Routines** (paused when imported)", "");
      for (const r of b.routines) out.push(`- ${md(r.name)} — ${md(describeCron(r.cron, locale))} (${md(r.timezone)})`);
      out.push("");
    }
  }
  if (input.groups.length) {
    out.push(fr ? "## Groupes" : "## Groups", "");
    for (const g of input.groups) out.push(`- **${md(g.name)}** : ${g.members.map(md).join(", ")} — ${RULE_TEXT[g.rule][fr ? 0 : 1]}${g.rule === "lead" && g.lead ? ` (${md(g.lead)})` : ""}`);
    out.push("");
  }
  if (input.connectors.length) {
    out.push(fr ? "## Applis à connecter" : "## Apps to connect", "");
    for (const c of input.connectors) out.push(`- ${md(c.name)}${c.for.length ? ` (${c.for.map(md).join(", ")})` : ""}${c.why ? ` — ${md(c.why)}` : ""}`);
    out.push("", fr ? "Chacun connecte ses propres comptes après l'import : aucun accès n'est partagé par ce fichier." : "Everyone connects their own accounts after importing: this file shares no access.", "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
