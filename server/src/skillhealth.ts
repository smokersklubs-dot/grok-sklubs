import { q } from "./db.js";
import { routines } from "./routines.js";
import type { CuratorSuggestion, SkillHealth, SkillHealthReport, SkillMaker, SkillScope, SkillState, SkillVersion } from "./skillhealthtypes.js";
import { bots, newId, now, setSkillHooks, skills, skillText, type BotRecord } from "./store.js";
import type { Skill } from "./shared.js";

/**
 * « Santé des compétences » — L131 (health: reads, failures, never used, near duplicates, pin, lock, versions, revision
 * guard), L133 (scopes of a shared skill, « seulement quand je le demande »), L132 (long skills read by index then
 * section, « toujours en entier »), and the Hermes skills curator (AUDIT-HERMES.md lines 115-118).
 *
 * Portions adapted from NousResearch/hermes-agent (https://github.com/NousResearch/hermes-agent, commit
 * 05348a3094a2356b9a271a2f22cdd6711c9952b8), Copyright (c) 2025 Nous Research, MIT licence: agent/curator.py
 * `apply_automatic_transitions` (active → stale → archived from the last real activity, 14 / 30 days; pinned skills and
 * skills a scheduled job uses are never touched; a never-used skill younger than the stale delay is never retired;
 * archive, never delete) and tools/skill_usage.py (usage counter, states, pin). Modified for Sklubot: ported from Python
 * to TypeScript on SQLite tables instead of a JSON sidecar; "curator-managed" means made by the bot itself (skill_save,
 * skill_propose), never the owner's, the library's or the catalogue's skills; locked skills and skills given in full in
 * the prompt (reads cannot be counted there) are protected too; no model pass (the duplicate merge is a suggestion card
 * the owner acts on, not an automatic rewrite).
 *
 * Additive tables created here (house pattern, no numbered migration). They follow the skill (ON DELETE CASCADE).
 */
q.run(`CREATE TABLE IF NOT EXISTS skill_meta (
  skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  uses INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER, last_failure TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'active', archived_by TEXT, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
  made_by TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', only_on_request INTEGER NOT NULL DEFAULT 0, always_full INTEGER NOT NULL DEFAULT 0,
  origin_kind TEXT, origin_id TEXT, origin_version TEXT, first_seen_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL,
  body TEXT NOT NULL, extras TEXT NOT NULL DEFAULT '{}', saved_at INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '')`);
q.run("CREATE INDEX IF NOT EXISTS skill_versions_skill ON skill_versions (skill_id, saved_at)");

export const STALE_AFTER_DAYS = 14;
export const ARCHIVE_AFTER_DAYS = 30;
export const MAX_VERSIONS = 10;
/** A skill longer than this is read by its index, then one section at a time (L132). */
export const LONG_SKILL_CHARS = 6000;
/** The bot may not shrink a skill by more than a quarter in one save (Hermes revision guard). */
export const MAX_LOSS = 0.25;
const DAY = 86_400_000;

interface Meta {
  uses: number; failures: number; lastUsedAt: number | null; lastFailure: string; state: SkillState; archivedBy: "curator" | "owner" | null;
  pinned: boolean; locked: boolean; madeBy: SkillMaker; scope: SkillScope; onlyOnRequest: boolean; alwaysFull: boolean;
  originKind: "library" | "catalog" | null; originId: string | null; originVersion: string | null; firstSeenAt: number;
}
const EMPTY_SCOPE: SkillScope = { sections: [], bots: [], exclude: [] };
function parseScope(raw: string): SkillScope {
  try {
    const v = JSON.parse(raw || "{}");
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 100) : []);
    return { sections: ids(v.sections), bots: ids(v.bots), exclude: ids(v.exclude) };
  } catch { return { ...EMPTY_SCOPE }; }
}
const toMeta = (r: any): Meta => ({
  uses: r.uses, failures: r.failures, lastUsedAt: r.last_used_at ?? null, lastFailure: r.last_failure ?? "",
  state: r.state === "stale" || r.state === "archived" ? r.state : "active", archivedBy: r.archived_by === "curator" || r.archived_by === "owner" ? r.archived_by : null,
  pinned: !!r.pinned, locked: !!r.locked, madeBy: (["bot", "owner", "library", "catalog", "import"].includes(r.made_by) ? r.made_by : "") as SkillMaker,
  scope: parseScope(r.scope), onlyOnRequest: !!r.only_on_request, alwaysFull: !!r.always_full,
  originKind: r.origin_kind === "library" || r.origin_kind === "catalog" ? r.origin_kind : null, originId: r.origin_id ?? null, originVersion: r.origin_version ?? null, firstSeenAt: r.first_seen_at,
});
const ensure = (id: string) => q.run("INSERT OR IGNORE INTO skill_meta (skill_id, first_seen_at) VALUES (?, ?)", id, now());
export function metaOf(id: string): Meta {
  const r = q.get("SELECT * FROM skill_meta WHERE skill_id = ?", id);
  if (r) return toMeta(r);
  // First sight (Hermes "seed on first sight"): the inactivity clock starts now, so an old skill does not retire at once.
  if (q.get("SELECT 1 FROM skills WHERE id = ?", id)) ensure(id);
  return toMeta(q.get("SELECT * FROM skill_meta WHERE skill_id = ?", id) ?? { uses: 0, failures: 0, state: "active", made_by: "", scope: "", first_seen_at: now() });
}
const COLS = { pinned: "pinned", locked: "locked", onlyOnRequest: "only_on_request", alwaysFull: "always_full" } as const;
export const skillMeta = {
  get: metaOf,
  setFlag(id: string, flag: keyof typeof COLS, on: boolean) { ensure(id); q.run(`UPDATE skill_meta SET ${COLS[flag]} = ? WHERE skill_id = ?`, on ? 1 : 0, id); },
  setMadeBy(id: string, by: SkillMaker) { ensure(id); q.run("UPDATE skill_meta SET made_by = ? WHERE skill_id = ? AND made_by = ''", by, id); },
  setOrigin(id: string, kind: "library" | "catalog", originId: string, version: string) { ensure(id); q.run("UPDATE skill_meta SET origin_kind = ?, origin_id = ?, origin_version = ? WHERE skill_id = ?", kind, originId, version, id); },
  setScope(id: string, scope: SkillScope) { ensure(id); q.run("UPDATE skill_meta SET scope = ? WHERE skill_id = ?", JSON.stringify(parseScope(JSON.stringify(scope))), id); },
  /** The owner bringing a skill back restarts its inactivity clock, so the curator does not retire it again at once. */
  setState(id: string, state: SkillState, by: "curator" | "owner" | null = null) {
    ensure(id);
    q.run("UPDATE skill_meta SET state = ?, archived_by = ? WHERE skill_id = ?", state, state === "archived" ? by : null, id);
    if (by === "owner" && state === "active") q.run("UPDATE skill_meta SET first_seen_at = ? WHERE skill_id = ?", now(), id);
  },
  /** skill_read: the bot really opened it (Hermes `bump_use`): a used skill that had gone stale is active again. */
  used(id: string) { ensure(id); q.run("UPDATE skill_meta SET uses = uses + 1, last_used_at = ?, state = CASE WHEN state = 'stale' THEN 'active' ELSE state END WHERE skill_id = ?", now(), id); },
  failed(id: string, note: string) { ensure(id); q.run("UPDATE skill_meta SET failures = failures + 1, last_failure = ? WHERE skill_id = ?", note.trim().slice(0, 300), id); },
};

// ── Versions (Hermes "backup before change", AUDIT-HERMES line 118) ──────────────────────────────────────────────────
function snapshot(id: string, reason = "") {
  const s = q.get<any>("SELECT * FROM skills WHERE id = ?", id);
  if (!s) return;
  const last = q.get<{ body: string; name: string; description: string }>("SELECT body, name, description FROM skill_versions WHERE skill_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1", id);
  if (last && last.body === s.body && last.name === s.name && last.description === s.description) return;
  const extras = JSON.stringify({ needs: s.needs ?? "", check: s.check_how ?? "", output: s.output ?? "", approvals: s.approvals ?? "" });
  q.run("INSERT INTO skill_versions (id, skill_id, name, description, body, extras, saved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", newId("skv"), id, s.name, s.description, s.body, extras, now(), reason);
  q.run("DELETE FROM skill_versions WHERE skill_id = ? AND id NOT IN (SELECT id FROM skill_versions WHERE skill_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT ?)", id, id, MAX_VERSIONS);
}
export const skillVersions = {
  list: (id: string): SkillVersion[] => q.all<any>("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY saved_at DESC, rowid DESC", id)
    .map((r) => ({ id: r.id, name: r.name, description: r.description, body: r.body, savedAt: r.saved_at, reason: r.reason })),
  count: (id: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = ?", id)!.n,
  /** Puts an older text back; the text it replaces is kept as a version in turn, so a restore can itself be undone. */
  restore(skillId: string, versionId: string): Skill | null {
    const v = q.get<any>("SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?", versionId, skillId);
    if (!v) return null;
    let extras: Record<string, string> = {};
    try { extras = JSON.parse(v.extras); } catch { /* older row */ }
    return skills.update(skillId, { name: v.name, description: v.description, body: v.body, ...extras });
  },
};

// ── Visibility (L133 scopes, archive) — installed into store.ts ─────────────────────────────────────────────────────
/** Whether a skill reaches this bot: never when archived; a shared skill of a teammate only within its scope. */
export function reaches(s: Pick<Skill, "id" | "botId">, viewer: Pick<BotRecord, "id" | "sectionId">, m = metaOf(s.id)): boolean {
  if (m.state === "archived") return false;
  if (s.botId === viewer.id) return true;
  const sc = m.scope;
  if (sc.exclude.includes(viewer.id)) return false;
  if (!sc.sections.length && !sc.bots.length) return true;
  return sc.bots.includes(viewer.id) || (!!viewer.sectionId && sc.sections.includes(viewer.sectionId));
}
setSkillHooks({
  visible: (viewerId, list) => {
    if (!list.length) return list;
    const viewer = bots.byId(viewerId);
    return viewer ? list.filter((s: Skill) => reaches(s, viewer)) : list;
  },
  beforeSave: (id) => snapshot(id),
});

// ── Near duplicates (« presque identique », L131) ──────────────────────────────────────────────────────────────────
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function words(s: Pick<Skill, "name" | "description" | "body">): Set<string> {
  return new Set(fold(`${s.name} ${s.description} ${s.body}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}
/** Jaccard similarity of the words of two skills, 0..1; the same name (accents and case folded) counts as 1. */
export function similarity(a: Pick<Skill, "name" | "description" | "body">, b: Pick<Skill, "name" | "description" | "body">): number {
  if (fold(a.name).trim() === fold(b.name).trim()) return 1;
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export const NEAR_DUPLICATE = 0.6;
/** The account's other skills that say almost the same thing as this text (best first). */
export function nearDuplicates(userId: string, text: Pick<Skill, "name" | "description" | "body">, exceptId?: string): { skill: Skill; botName: string; score: number }[] {
  const out: { skill: Skill; botName: string; score: number }[] = [];
  for (const b of bots.list(userId).filter((x) => x.kind === "agent"))
    for (const s of skills.list(b.id)) {
      if (s.id === exceptId) continue;
      const score = similarity(text, s);
      if (score >= NEAR_DUPLICATE) out.push({ skill: s, botName: b.name, score: Math.round(score * 100) / 100 });
    }
  return out.sort((x, y) => y.score - x.score).slice(0, 5);
}

// ── The bot's edits: lock and revision guard (AUDIT-HERMES line 117) ─────────────────────────────────────────────────
/** Why the bot may not replace this skill's text with `body` (English: the model reads it), or null when it may. */
export function botEditRefusal(existing: Skill, body: string): string | null {
  const m = metaOf(existing.id);
  if (m.locked) return `The user locked the skill "${existing.name}": you cannot change it. Tell the user what you would change; they can edit it in its Skills tab.`;
  const before = existing.body.trim().length, after = body.trim().length;
  if (before >= 200 && after < before * (1 - MAX_LOSS))
    return `This would remove ${Math.round((1 - after / before) * 100)}% of the skill "${existing.name}" (more than a quarter). Keep its existing steps and change or add only what is needed (read it with skill_read first), or ask the user to edit it in its Skills tab.`;
  return null;
}

// ── Long skills by index then section (L132) ─────────────────────────────────────────────────────────────────────────
export interface SkillSection { title: string; text: string }
/** The parts of a skill's steps cut at its Markdown headings; the text before the first heading is "Introduction". */
export function sectionsOf(body: string): SkillSection[] {
  const out: SkillSection[] = [];
  let cur: SkillSection = { title: "Introduction", text: "" };
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { if (cur.text.trim()) out.push(cur); cur = { title: h[1].trim(), text: line + "\n" }; }
    else cur.text += line + "\n";
  }
  if (cur.text.trim()) out.push(cur);
  return out.map((s) => ({ title: s.title, text: s.text.trim() }));
}
/**
 * What skill_read gives: the whole skill when it is short or marked « toujours en entier »; otherwise its index (or the
 * section asked for). The parts that keep the bot safe — when to use it, what it needs, the steps that need the user's
 * approval, the check and what to hand back — come with every read, whole or by section.
 */
export function readSkill(s: Skill, section?: string): { text: string; part: string } {
  const m = metaOf(s.id);
  const whole = skillText(s);
  if (m.alwaysFull || whole.length <= LONG_SKILL_CHARS) return { text: whole, part: "all" };
  const parts = sectionsOf(s.body);
  const frame = skillText({ ...s, body: "(see below)" }).replace(/^Steps:\n\(see below\)\n?/m, "").replace(/^\(see below\)\n?/m, "").trim();
  const want = (section ?? "").trim();
  if (!want || parts.length < 2) {
    if (parts.length < 2) return { text: whole, part: "all" };
    return {
      text: `${frame}\n\nThis skill is long (${whole.length} characters, ${parts.length} sections). Read only the section you need with skill_read and section (its number or title):\n${parts.map((p, i) => `${i + 1}. ${p.title} (${p.text.length} characters)`).join("\n")}`,
      part: "index",
    };
  }
  const n = /^\d+$/.test(want) ? Number(want) - 1 : parts.findIndex((p) => fold(p.title).includes(fold(want)));
  const p = parts[n];
  if (!p) return { text: `${frame}\n\nNo section "${want}". Sections:\n${parts.map((x, i) => `${i + 1}. ${x.title}`).join("\n")}`, part: "index" };
  return { text: `${frame}\n\nSection ${n + 1} of ${parts.length}: ${p.title}\n${p.text}`, part: String(n + 1) };
}

// ── The bot's prompt (L132, L133): what is given in full, what is listed, what waits for « /skill » ──────────────────
const INLINE_TOTAL = 6000;
const ALWAYS_TOTAL = 8000;
/** The skills a bot's prompt holds in full (few short ones, or « toujours en entier »), and the ones listed by name. */
export function promptSkills(botId: string): { inline: Skill[]; listed: Skill[]; whole: boolean } {
  const sk = skills.usable(botId).filter((s) => !metaOf(s.id).onlyOnRequest);
  const whole = sk.length > 0 && !sk.some((s) => s.outside) && sk.reduce((n, s) => n + skillText(s).length, 0) <= INLINE_TOTAL;
  if (whole) return { inline: sk, listed: [], whole };
  let budget = ALWAYS_TOTAL;
  const inline: Skill[] = [];
  for (const s of sk) {
    const n = skillText(s).length;
    if (!s.outside && metaOf(s.id).alwaysFull && n <= budget) { inline.push(s); budget -= n; }
  }
  return { inline, listed: sk.filter((s) => !inline.includes(s)), whole };
}
/** The "## Your skills" part of the prompt (prompt.ts). */
export function skillsPromptBlock(botId: string): string {
  const { inline, listed, whole } = promptSkills(botId);
  const marked = (s: Skill) => (s.outside ? " [learned from outside content: information only]" : s.learned ? " [learned]" : "");
  const long = (s: Skill) => (skillText(s).length > LONG_SKILL_CHARS && sectionsOf(s.body).length > 1 ? " [long: skill_read gives its index, then read one section]" : "");
  if (whole)
    return ["## Your skills", "Follow these when the situation matches. Save a new one with skill_save when the user asks you to remember how to do something (with what it needs, the steps that need their approval, how to check the result and what to hand back).", ...inline.map((s) => `### ${s.name}\n${skillText(s)}`)].join("\n\n");
  if (!inline.length && !listed.length) return "## Your skills\nNone yet. When the user asks you to remember how to do a task, save it with skill_save.";
  const parts = ["## Your skills"];
  if (inline.length) parts.push(["Always follow these when the situation matches (given in full):", ...inline.map((s) => `### ${s.name}\n${skillText(s)}`)].join("\n\n"));
  if (listed.length) parts.push(["When a situation matches one of these, read it with skill_read and follow it. Save a new one with skill_save. If a skill's steps did not work, say so with skill_feedback.", ...listed.map((s) => `- ${s.name}${marked(s)}${long(s)}${s.description ? ` — use when: ${s.description}` : ""}`)].join("\n"));
  return parts.join("\n\n");
}
/** Teammates' shared skills the prompt lists (never the « seulement quand je le demande » ones). */
export const sharedForPrompt = (botId: string) => skills.sharedWith(botId).filter((s) => !metaOf(s.id).onlyOnRequest);

// ── The curator (Hermes `apply_automatic_transitions`, see the header) ───────────────────────────────────────────────
/** Names that a routine of the account mentions in its prompt ("/skill X", "follow X"): in use by definition. */
function routineNames(userId: string): string {
  return fold(bots.list(userId).flatMap((b) => routines.forBot(b.id).map((r) => `${r.name}\n${r.prompt}`)).join("\n"));
}
const curatorManaged = (s: Skill, m: Meta) => m.madeBy === "bot" || (m.madeBy === "" && s.learned);
/**
 * Moves the account's bot-made skills between active, stale and archived from their last real use; pinned, locked,
 * routine-used and in-prompt skills are never touched, nor any skill the owner, the library or the catalogue made.
 */
export function applyTransitions(userId: string, at = now()): SkillHealthReport["pass"] {
  const staleCut = at - STALE_AFTER_DAYS * DAY, archiveCut = at - ARCHIVE_AFTER_DAYS * DAY;
  const counts = { checked: 0, markedStale: 0, archived: 0, reactivated: 0 };
  const used = routineNames(userId);
  for (const b of bots.list(userId).filter((x) => x.kind === "agent")) {
    const inPrompt = new Set(promptSkills(b.id).inline.map((s) => s.id));
    for (const s of skills.list(b.id)) {
      if (s.draft) continue;
      const m = metaOf(s.id);
      counts.checked++;
      if (!curatorManaged(s, m) || m.pinned || m.locked || inPrompt.has(s.id) || used.includes(fold(s.name))) continue;
      if (m.state === "archived") continue; // only the owner brings an archived skill back
      const anchor = Math.max(m.lastUsedAt ?? 0, m.firstSeenAt, s.createdAt); // last real activity (an owner's restore counts)
      // use_count == 0 is absence of evidence, not staleness: never retire a never-used skill younger than the delay.
      if (m.uses === 0 && anchor > staleCut) { if (m.state === "stale") { skillMeta.setState(s.id, "active"); counts.reactivated++; } continue; }
      if (anchor <= archiveCut) { skillMeta.setState(s.id, "archived", "curator"); counts.archived++; }
      else if (anchor <= staleCut && m.state === "active") { skillMeta.setState(s.id, "stale"); counts.markedStale++; }
      else if (anchor > staleCut && m.state === "stale") { skillMeta.setState(s.id, "active"); counts.reactivated++; }
    }
  }
  return counts;
}

// ── The owner's view ────────────────────────────────────────────────────────────────────────────────────────────────
type UpdateCheck = (s: Skill, m: Meta) => SkillHealth["update"];
let updateCheck: UpdateCheck = () => null;
/** Set by skillcatalog.ts: whether a newer text exists where a skill came from (library or team catalogue). */
export const setUpdateCheck = (fn: UpdateCheck) => { updateCheck = fn; };

/** Every skill of the account with its health, and the curator's suggestions (one action each, the owner decides). */
export function healthReport(userId: string, at = now()): SkillHealthReport {
  const pass = applyTransitions(userId, at);
  const agents = bots.list(userId).filter((x) => x.kind === "agent");
  const all = agents.flatMap((b) => skills.list(b.id).map((s) => ({ s, b })));
  const out: SkillHealth[] = [];
  const suggestions: CuratorSuggestion[] = [];
  const seenPair = new Set<string>();
  const inPrompt = new Set(agents.flatMap((b) => promptSkills(b.id).inline.map((s) => s.id)));
  for (const { s, b } of all) {
    const m = metaOf(s.id);
    const similar = all.filter((o) => o.s.id !== s.id).map((o) => ({ skillId: o.s.id, name: o.s.name, botName: o.b.name, score: similarity(s, o.s) }))
      .filter((x) => x.score >= NEAR_DUPLICATE).sort((x, y) => y.score - x.score).slice(0, 3).map((x) => ({ ...x, score: Math.round(x.score * 100) / 100 }));
    const text = skillText(s);
    out.push({
      skillId: s.id, botId: b.id, botName: b.name, name: s.name, uses: m.uses, failures: m.failures, lastUsedAt: m.lastUsedAt, lastFailure: m.lastFailure,
      state: m.state, archivedBy: m.archivedBy, pinned: m.pinned, locked: m.locked, madeBy: m.madeBy || (s.learned ? "bot" : ""),
      onlyOnRequest: m.onlyOnRequest, alwaysFull: m.alwaysFull, scope: m.scope, chars: text.length, sections: sectionsOf(s.body).length,
      versions: skillVersions.count(s.id), update: updateCheck(s, m), similar, inline: inPrompt.has(s.id),
    });
    if (s.draft) continue;
    const age = at - Math.max(m.firstSeenAt, s.createdAt);
    if (m.state === "archived" && m.archivedBy === "curator") suggestions.push({ kind: "archived", skillId: s.id, name: s.name, botName: b.name, detail: `${ARCHIVE_AFTER_DAYS}` });
    else if (m.failures >= 2) suggestions.push({ kind: "failing", skillId: s.id, name: s.name, botName: b.name, detail: m.lastFailure });
    else if (m.state === "stale") suggestions.push({ kind: "stale", skillId: s.id, name: s.name, botName: b.name, detail: `${STALE_AFTER_DAYS}` });
    else if (m.state === "active" && m.uses === 0 && !m.pinned && !inPrompt.has(s.id) && age > ARCHIVE_AFTER_DAYS * DAY) suggestions.push({ kind: "never_used", skillId: s.id, name: s.name, botName: b.name, detail: `${ARCHIVE_AFTER_DAYS}` });
    const twin = similar[0];
    if (twin && m.state !== "archived") {
      const key = [s.id, twin.skillId].sort().join(":");
      if (!seenPair.has(key)) { seenPair.add(key); suggestions.push({ kind: "duplicate", skillId: s.id, name: s.name, botName: b.name, detail: String(Math.round(twin.score * 100)), otherId: twin.skillId, otherName: `${twin.name} (${twin.botName})` }); }
    }
  }
  return { skills: out, suggestions: suggestions.slice(0, 20), pass, staleAfterDays: STALE_AFTER_DAYS, archiveAfterDays: ARCHIVE_AFTER_DAYS };
}
