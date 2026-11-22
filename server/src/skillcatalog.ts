import { emit } from "./bus.js";
import { q } from "./db.js";
import { libraryEntries, libraryVersion } from "./skillslibrary.js";
import { setUpdateCheck, skillMeta } from "./skillhealth.js";
import type { CatalogSkill } from "./skillhealthtypes.js";
import type { Locale, Skill } from "./shared.js";
import { audit, bots, newId, now, skills, users, type BotRecord } from "./store.js";

/**
 * L135 — « Catalogue de l'équipe »: the account's own private catalogue of vetted skills (Spec Kit audit: "catalogue privé
 * d'une organisation"). The owner publishes a skill of one bot to it; every publish under the same name is a new version.
 * Adding it to a bot makes an ordinary skill that remembers where it came from and at which version. Account-only: no
 * other account ever sees it (every query is by user_id).
 *
 * Versioned skills with an « Mettre à jour » chip (idea from the Nightly Labs OpenBot audit — that repository is
 * non-commercial, so this is our own code): a copy installed from the bundled library or from the catalogue keeps the
 * version it was installed at; when the source has a newer text the skill shows the chip, and updating keeps the old
 * text as a version (skillhealth.ts), so it can be put back. Copies installed before this existed are seeded at the
 * library's current version on first sight (no false chip).
 */
q.run(`CREATE TABLE IF NOT EXISTS skill_catalog (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL, extras TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, from_bot TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
q.run("CREATE UNIQUE INDEX IF NOT EXISTS skill_catalog_name ON skill_catalog (user_id, name COLLATE NOCASE)");

export const MAX_CATALOG = 200;
export class CatalogError extends Error { constructor(public status: 400 | 404, message: string) { super(message); } }

const extrasOf = (s: Skill) => ({ needs: s.needs, check: s.check, output: s.output, approvals: s.approvals });
const agentsOf = (userId: string) => bots.list(userId).filter((b) => b.kind === "agent" && !b.hidden);

interface Row { id: string; user_id: string; name: string; description: string; body: string; extras: string; version: number; from_bot: string; updated_at: number }
const extrasFrom = (r: Row): Record<string, string> => { try { return JSON.parse(r.extras) ?? {}; } catch { return {}; } };
const installed = (userId: string, catalogId: string) =>
  q.all<{ skill_id: string; bot_id: string }>("SELECT m.skill_id, s.bot_id FROM skill_meta m JOIN skills s ON s.id = m.skill_id JOIN bots b ON b.id = s.bot_id WHERE b.user_id = ? AND m.origin_kind = 'catalog' AND m.origin_id = ?", userId, catalogId);

export const teamCatalog = {
  list(userId: string): CatalogSkill[] {
    const total = agentsOf(userId).length;
    return q.all<Row>("SELECT * FROM skill_catalog WHERE user_id = ? ORDER BY name COLLATE NOCASE", userId).map((r) => ({
      id: r.id, name: r.name, description: r.description, body: r.body, version: r.version, fromBot: r.from_bot, updatedAt: r.updated_at,
      addedTo: new Set(installed(userId, r.id).map((x) => x.bot_id)).size, botCount: total,
    }));
  },
  /** Publishes (or publishes a new version of) one of the account's skills. The source skill itself becomes a copy of it. */
  publish(userId: string, skillId: string): CatalogSkill {
    const s = skills.owned(userId, skillId);
    if (!s) throw new CatalogError(404, "That skill does not exist.");
    if (s.draft) throw new CatalogError(400, "Activate this skill before putting it in the catalogue.");
    const bot = bots.byId(s.botId);
    const cur = q.get<Row>("SELECT * FROM skill_catalog WHERE user_id = ? AND name = ? COLLATE NOCASE", userId, s.name);
    const t = now();
    let id: string;
    if (cur) {
      id = cur.id;
      q.run("UPDATE skill_catalog SET name = ?, description = ?, body = ?, extras = ?, version = version + 1, from_bot = ?, updated_at = ? WHERE id = ?", s.name, s.description, s.body, JSON.stringify(extrasOf(s)), bot?.name ?? "", t, id);
    } else {
      if ((q.get<{ n: number }>("SELECT COUNT(*) AS n FROM skill_catalog WHERE user_id = ?", userId)?.n ?? 0) >= MAX_CATALOG) throw new CatalogError(400, "The catalogue is full (200 skills). Remove one first.");
      id = newId("skc");
      q.run("INSERT INTO skill_catalog (id, user_id, name, description, body, extras, version, from_bot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)", id, userId, s.name, s.description, s.body, JSON.stringify(extrasOf(s)), bot?.name ?? "", t, t);
    }
    const row = q.get<Row>("SELECT * FROM skill_catalog WHERE id = ?", id)!;
    skillMeta.setOrigin(s.id, "catalog", id, String(row.version));
    audit(userId, "account", `Skill put in the team catalogue: ${s.name} (version ${row.version})`, s.botId);
    return teamCatalog.list(userId).find((x) => x.id === id)!;
  },
  /** Adds a catalogue skill to every assistant bot ("all") or to one; a bot that already has it (same name) is skipped. */
  add(userId: string, catalogId: string, target: string): { added: string[]; already: string[] } {
    const r = q.get<Row>("SELECT * FROM skill_catalog WHERE id = ? AND user_id = ?", catalogId, userId);
    if (!r) throw new CatalogError(404, "That skill is not in the catalogue.");
    let targets: BotRecord[];
    if (target === "all") targets = agentsOf(userId);
    else { const b = bots.owned(userId, target); if (!b || b.kind !== "agent" || b.hidden) throw new CatalogError(404, "That bot does not exist."); targets = [b]; }
    const out = { added: [] as string[], already: [] as string[] };
    for (const b of targets) {
      if (skills.list(b.id).some((k) => k.name.toLowerCase() === r.name.toLowerCase())) { out.already.push(b.name); continue; }
      // The safety check runs on create (store.ts → skillscan.ts), as for any skill.
      const made = skills.create(b.id, r.name, r.description, r.body, false, {}, extrasFrom(r));
      skillMeta.setMadeBy(made.id, "catalog");
      skillMeta.setOrigin(made.id, "catalog", r.id, String(r.version));
      out.added.push(b.name);
      emit(userId, { type: "memories", botId: b.id });
    }
    if (out.added.length) audit(userId, "account", `Skill added from the team catalogue: ${r.name} → ${out.added.join(", ")}`);
    return out;
  },
  remove(userId: string, catalogId: string) {
    if (!q.get("SELECT 1 FROM skill_catalog WHERE id = ? AND user_id = ?", catalogId, userId)) throw new CatalogError(404, "That skill is not in the catalogue.");
    q.run("DELETE FROM skill_catalog WHERE id = ? AND user_id = ?", catalogId, userId);
  },
};

/** The newer text of a skill's source, if any (null: up to date, or no source). */
function newerSource(s: Skill, locale: Locale): { name: string; description: string; body: string; extras: Record<string, string>; version: string; kind: "library" | "catalog"; title: string } | null {
  const m = skillMeta.get(s.id);
  const userId = bots.byId(s.botId)?.userId;
  if (!userId) return null;
  if (m.originKind === "catalog" && m.originId) {
    const r = q.get<Row>("SELECT * FROM skill_catalog WHERE id = ? AND user_id = ?", m.originId, userId);
    if (!r || String(r.version) === m.originVersion) return null;
    return { name: r.name, description: r.description, body: r.body, extras: extrasFrom(r), version: String(r.version), kind: "catalog", title: r.name };
  }
  const lib = m.originKind === "library" && m.originId ? libraryEntries().find((e) => e.id === m.originId)
    : !m.originKind ? libraryEntries().find((e) => [e.title.fr, e.title.en].some((n) => n.toLowerCase() === s.name.toLowerCase())) : undefined;
  if (!lib) return null;
  const version = libraryVersion(lib.id)!;
  // A copy made before versions existed: seeded at today's version on first sight.
  if (!m.originKind) { skillMeta.setOrigin(s.id, "library", lib.id, version); return null; }
  if (m.originVersion === version) return null;
  const t = lib.text[locale] ?? lib.text.en!;
  return { name: s.name, description: t.description || lib.summary[locale], body: t.body, extras: {}, version, kind: "library", title: lib.title[locale] };
}
setUpdateCheck((s) => {
  const owner = bots.byId(s.botId)?.userId;
  const n = newerSource(s, owner ? users.localeOf(owner) : "en");
  return n ? { kind: n.kind, title: n.title } : null;
});

/** « Mettre à jour »: puts the source's newer text in; the current text is kept as a version (it can be put back). */
export function updateFromSource(userId: string, skillId: string, locale: Locale): Skill {
  const s = skills.owned(userId, skillId);
  if (!s) throw new CatalogError(404, "That skill does not exist.");
  const n = newerSource(s, locale);
  if (!n) throw new CatalogError(400, "This skill is already up to date.");
  const updated = skills.update(s.id, { name: n.name, description: n.description, body: n.body, ...n.extras });
  skillMeta.setOrigin(s.id, n.kind, skillMeta.get(s.id).originId!, n.version);
  audit(userId, "account", `Skill updated from its source: ${s.name}`, s.botId);
  emit(userId, { type: "memories", botId: s.botId });
  return updated;
}
