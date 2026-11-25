import { randomBytes } from "node:crypto";
import { emit } from "./bus.js";
import { catalogFor } from "./catalog.js";
import { q } from "./db.js";
import { freeName, teamFullAt } from "./grokimport.js";
import { planLimitError, planRoom } from "./hosted.js";
import { tr } from "./i18n.js";
import { isUserProviderRef, modelAvailable } from "./llm/index.js";
import { BlockedAddressError, fetchProblem, guardedFetch } from "./net.js";
import { routines } from "./routines.js";
import { maskSecrets, type Locale, type RoomRule } from "./shared.js";
import { libraryEntries } from "./skillslibrary.js";
import { audit, bots, clip, now, rows, sections, settings, skills, type BotRecord, type UserRecord } from "./store.js";
import { createRoom } from "./agent/team.js";
import { parseTeamMd, TEAM_MD_LIMITS, TeamMdError, writeTeamMd, type ParsedTeamMd, type TeamMdInput } from "./teammd.js";
import {
  TEAM_MD_MAX_BYTES,
  type TeamMdChoice, type TeamMdCommitInput, type TeamMdExport, type TeamMdMode, type TeamMdPreview, type TeamMdReport, type TeamMdSource,
} from "./teammdtypes.js";

/**
 * « Équipe Sklubot (.md) »: the import (an uploaded file, a pasted text or a public https address) and the share.
 *
 * Import is always two steps. Preview reads the file and creates NOTHING: bots, skills (key-like texts flagged), paused
 * routines, groups, apps to connect later (never connected), name conflicts with a free name, the plan's room. Commit
 * creates what the owner kept, in one transaction, after checking this installation's and the hosted plan's limits:
 * careful bots on the account's default model (or the file's suggested brain when the owner ticked it and the account
 * can use it), Bibliothèque skills active and the file's own skills as drafts, routines paused, groups with their
 * « qui répond » rule, an optional section. A team imported before (same id) can be updated in place (« Mettre à jour »:
 * texts and look replaced, new skills and routines added, nothing removed) or created again (« Créer une copie »).
 *
 * Share writes the caller's own bots (a section, chosen bots, or the whole team) with their groups and the NAMES of the
 * account's apps that are in Sklubot's catalog. Never: keys, the vault, chats, memories, permissions, autonomy,
 * computers, addresses or the account's own providers; every text goes through the secret mask.
 */

// Which team file a section, its bots and its groups came from (« Mettre à jour » on a re-import). Additive table.
q.run(`CREATE TABLE IF NOT EXISTS team_md_links (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, team_id TEXT NOT NULL, name TEXT NOT NULL,
  section_id TEXT, bots TEXT NOT NULL DEFAULT '{}', rooms TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, team_id))`);
interface Link { name: string; sectionId: string | null; bots: Record<string, string>; rooms: Record<string, string>; updatedAt: number }
const lower = (s: string) => s.trim().toLowerCase();
function linkOf(userId: string, teamId: string): Link | null {
  if (!teamId) return null;
  const r = q.get<{ name: string; section_id: string | null; bots: string; rooms: string; updated_at: number }>("SELECT * FROM team_md_links WHERE user_id = ? AND team_id = ?", userId, teamId);
  if (!r) return null;
  const parse = (s: string) => { try { const v = JSON.parse(s); return v && typeof v === "object" ? v as Record<string, string> : {}; } catch { return {}; } };
  return { name: r.name, sectionId: r.section_id, bots: parse(r.bots), rooms: parse(r.rooms), updatedAt: r.updated_at };
}
const saveLink = (userId: string, teamId: string, l: Omit<Link, "updatedAt">) =>
  q.run("INSERT INTO team_md_links (user_id, team_id, name, section_id, bots, rooms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, team_id) DO UPDATE SET name = excluded.name, section_id = excluded.section_id, bots = excluded.bots, rooms = excluded.rooms, updated_at = excluded.updated_at",
    userId, teamId, clip(l.name, 80), l.sectionId, JSON.stringify(l.bots), JSON.stringify(l.rooms), now());
/** The bots a link still points at (deleted ones and other accounts' are ignored). */
const linkedBot = (userId: string, l: Link | null, name: string, kind: "agent" | "room") => {
  const id = l ? (kind === "agent" ? l.bots : l.rooms)[lower(name)] : undefined;
  const b = id ? bots.owned(userId, id) : null;
  return b && b.kind === kind && !b.hidden ? b : null;
};

// ── Fetching a file from an address ──────────────────────────────────────────────────────────────────────────────

const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
/** A GitHub file page ("…/blob/…") or a gist page becomes its raw address; anything else is fetched as given. */
export function teamMdRawAddress(u: URL): URL {
  const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
  if (u.hostname === "github.com" && blob) return new URL(`https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`);
  const gist = /^\/([^/]+)\/([0-9a-f]{8,64})\/?$/i.exec(u.pathname);
  if (u.hostname === "gist.github.com" && gist) return new URL(`https://gist.githubusercontent.com/${gist[1]}/${gist[2]}/raw`);
  return u;
}

/**
 * The file at an https address: through guardedFetch (no private or local network, every hop checked), redirections
 * followed by hand so each one must stay https, 512 KB at most, read as it arrives (a false content-length changes nothing).
 */
export async function fetchTeamMd(address: string, signal?: AbortSignal): Promise<{ text: string; source: TeamMdSource }> {
  let u: URL;
  try { u = new URL(String(address).trim()); } catch { throw new TeamMdError("bad_url", "That is not a full address (it should start with https://)."); }
  const httpsOk = (x: URL) => x.protocol === "https:" || (allowHttp() && x.protocol === "http:");
  if (!httpsOk(u)) throw new TeamMdError("bad_url", "Team files are fetched over https only.");
  if (u.username || u.password) throw new TeamMdError("bad_url", "That address holds a sign-in: remove it.");
  u = teamMdRawAddress(u);
  const tooLarge = () => new TeamMdError("too_large", "That file is too large (512 KB at most).", {}, 413);
  const timeout = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  let res: Response | null = null;
  for (let hop = 0; hop < 6; hop++) {
    try {
      res = await guardedFetch(u.toString(), { signal: timeout, redirect: "manual", headers: { accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" } });
    } catch (err) {
      throw new TeamMdError("fetch", "Could not fetch it: {detail}", { detail: err instanceof BlockedAddressError ? "That address is on a private or local network, which this server does not reach." : fetchProblem(err) ?? clip((err as Error).message, 120) });
    }
    const location = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location) break;
    await res.body?.cancel().catch(() => {});
    const next = new URL(location, u);
    if (!httpsOk(next) || next.username || next.password) throw new TeamMdError("fetch", "The address sent the download to an address that is not https: it was refused.");
    u = next;
    res = null;
  }
  if (!res) throw new TeamMdError("fetch", "Too many redirections.");
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new TeamMdError("fetch", "Could not fetch it (status {status}).", { status: res.status }); }
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type && !/text\/|markdown|octet-stream|yaml/.test(type)) { await res.body?.cancel().catch(() => {}); throw new TeamMdError("fetch", "That is not a text file ({type}).", { type: clip(type, 60) }); }
  if (Number(res.headers.get("content-length") ?? 0) > TEAM_MD_MAX_BYTES) { await res.body?.cancel().catch(() => {}); throw tooLarge(); }
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TEAM_MD_MAX_BYTES) { await reader.cancel().catch(() => {}); throw tooLarge(); }
      chunks.push(value);
    }
  }
  return { text: new TextDecoder("utf-8").decode(Buffer.concat(chunks)), source: { kind: "url", label: clip(`${u.hostname}${u.pathname}`, 160), url: u.toString() } };
}

// ── Preview ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Pending { userId: string; parsed: ParsedTeamMd; source: TeamMdSource; until: number }
const pending = new Map<string, Pending>();
const PREVIEW_MS = 15 * 60_000;
const sweep = () => { for (const [k, v] of pending) if (v.until < now()) pending.delete(k); };

export async function previewTeamMd(user: UserRecord, input: { text?: unknown; url?: unknown; filename?: unknown }): Promise<TeamMdPreview> {
  sweep();
  const opts = { locale: user.locale, timezone: settings.profile(user.id).timezone };
  let text: string, source: TeamMdSource;
  if (typeof input.url === "string" && input.url.trim()) ({ text, source } = await fetchTeamMd(input.url));
  else {
    text = typeof input.text === "string" ? input.text : "";
    const fname = typeof input.filename === "string" ? input.filename.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    source = fname ? { kind: "file", label: fname } : { kind: "text", label: tr(user.locale, "Pasted text") };
  }
  const parsed = parseTeamMd(text, opts);
  const previewId = randomBytes(18).toString("base64url");
  const mine = [...pending.entries()].filter(([, p]) => p.userId === user.id);
  for (const [k] of mine.slice(0, Math.max(0, mine.length - 4))) pending.delete(k);
  pending.set(previewId, { userId: user.id, parsed, source, until: now() + PREVIEW_MS });

  const link = linkOf(user.id, parsed.meta.id);
  const linkedBots = parsed.bots.map((b) => linkedBot(user.id, link, b.name, "agent"));
  const existing = link && linkedBots.some(Boolean) ? { name: link.name, bots: linkedBots.filter(Boolean).length, updatedAt: link.updatedAt } : null;
  const room = planRoom(user.id);
  const warnings = [...parsed.warnings];
  if (room.bots !== null && parsed.bots.length > room.bots) warnings.push({ code: "bots_limit", n: room.bots });
  const full = teamFullAt(parsed.bots.length);
  if (full !== null) warnings.push({ code: "team_full", n: full });
  const routineCount = parsed.bots.reduce((n, b) => n + b.routines.length, 0);
  if (room.activeRoutines !== null && routineCount > room.activeRoutines) warnings.push({ code: "routines_limit", n: room.activeRoutines });
  const taken = (n: string) => !!bots.byName(user.id, n);
  const used = new Set<string>();
  return {
    previewId, source, meta: parsed.meta, playbook: parsed.playbook, masked: parsed.masked, removed: parsed.removed, warnings,
    bots: parsed.bots.map((b, i) => {
      const nameTaken = taken(b.name);
      const suggestedName = freeName(b.name, (n) => taken(n) || used.has(lower(n)));
      used.add(lower(suggestedName));
      return { ...b, nameTaken, suggestedName, existingId: existing ? linkedBots[i]?.id ?? null : null, modelAvailable: !!b.model && modelAvailable(b.model, user.id) };
    }),
    groups: parsed.groups.map((g) => ({ ...g, existingId: existing ? linkedBot(user.id, link, g.name, "room")?.id ?? null : null })),
    connectors: parsed.connectors, room: { bots: room.bots, activeRoutines: room.activeRoutines }, existing,
    hasPrimary: !!bots.primary(user.id),
  };
}

// ── Commit ───────────────────────────────────────────────────────────────────────────────────────────────────────

const line = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function commitTeamMd(user: UserRecord, input: Partial<TeamMdCommitInput>): TeamMdReport {
  const p = pending.get(String(input.previewId ?? ""));
  if (!p || p.userId !== user.id || p.until < now()) throw new TeamMdError("expired", "This preview has expired. Open the file again.");
  const src = p.parsed;
  const link = linkOf(user.id, src.meta.id);
  const mode: TeamMdMode = input.mode === "update" ? "update" : input.mode === "copy" ? "copy" : "create";
  if (mode === "update" && !link) throw new TeamMdError("no_link", "This team was not imported before: create it instead.");
  const seen = new Set<number>();
  const choices = (Array.isArray(input.bots) ? input.bots : []).slice(0, 50)
    .filter((c): c is TeamMdChoice => !!c && typeof c === "object" && c.include === true && Number.isInteger(c.index) && !!src.bots[c.index] && !seen.has(c.index) && (seen.add(c.index), true));
  if (!choices.length) throw new TeamMdError("nothing", "Nothing is ticked: choose at least one bot.");

  // Which bots are updated in place, which are created: limits count only the new ones, and are checked before anything is written.
  const targets = choices.map((c) => ({ c, b: src.bots[c.index], into: mode === "update" ? linkedBot(user.id, link, src.bots[c.index].name, "agent") : null }));
  const fresh = targets.filter((t) => !t.into).length;
  if (fresh) {
    bots.assertRoom(fresh);
    const room = planRoom(user.id);
    if (room.bots !== null && fresh > room.bots) throw planLimitError("bots", room.maxBots!);
  }

  const locale = user.locale;
  const lib = libraryEntries();
  const report: TeamMdReport = { mode, created: [], updated: [], skills: 0, routines: 0, groups: [], section: null, connectors: src.connectors.map((c) => c.name), unscheduled: [] };
  const sectionName = line(input.section, 40);
  const nameOf = new Map<string, BotRecord>();
  const touched: { bot: BotRecord; isNew: boolean; drafts: number; paused: number; apps: string[]; unscheduled: string[] }[] = [];
  const newLink: Omit<Link, "updatedAt"> = { name: src.meta.name || src.bots[0].name, sectionId: link?.sectionId ?? null, bots: mode === "update" ? { ...link!.bots } : {}, rooms: mode === "update" ? { ...link!.rooms } : {} };

  q.tx(() => {
    let sectionId: string | null = null;
    if (sectionName) {
      const reuse = mode === "update" && link?.sectionId ? sections.owned(user.id, link.sectionId) : null;
      const sec = reuse ?? sections.create(user.id, sectionName);
      sectionId = sec.id;
      report.section = { id: sec.id, name: sec.name };
      newLink.sectionId = sec.id;
    }
    const used = new Set<string>();
    for (const { c, b, into } of targets) {
      const wantModel = c.useModel === true && !!b.model && !isUserProviderRef(b.model) && modelAvailable(b.model, user.id);
      const instructions = [b.instructions, b.personality ? tr(locale, "Personality and tone: {text}", { text: b.personality }) : ""].filter(Boolean).join("\n\n");
      let bot: BotRecord;
      if (into) {
        // « Mettre à jour »: its texts and its look; its name, model (unless the owner ticked the suggestion), autonomy,
        // tools, memories and chats stay as they are.
        bots.patch(into.id, { description: b.role, instructions, ...(b.look.shape ? { shape: b.look.shape } : {}), ...(b.look.color ? { color: b.look.color } : {}), character: b.look.character, ...(wantModel ? { model: b.model } : {}) });
        bot = bots.byId(into.id)!;
        report.updated.push({ id: bot.id, name: bot.name });
      } else {
        const wanted = line(c.name, 60) || b.name;
        const name = freeName(wanted, (n) => used.has(lower(n)) || !!bots.byName(user.id, n));
        // Careful autonomy and the default tools whatever the file says: a file hands out no trust or permission.
        bot = bots.create(user.id, {
          name, description: b.role, instructions, autonomy: "careful", model: wantModel ? b.model : "", mode: "teammate",
          ...(b.look.shape ? { shape: b.look.shape } : {}), ...(b.look.color ? { color: b.look.color } : {}), character: b.look.character,
        });
        report.created.push({ id: bot.id, name: bot.name });
      }
      used.add(lower(bot.name));
      if (sectionId) bots.patch(bot.id, { sectionId });
      nameOf.set(lower(b.name), bot);
      newLink.bots[lower(b.name)] = bot.id;

      const have = new Set(skills.list(bot.id).map((s) => lower(s.name)));
      let drafts = 0;
      for (const [i, s] of b.skills.entries()) {
        if (Array.isArray(c.skills) && c.skills[i] !== true) continue;
        if (s.kind === "library") {
          const e = lib.find((x) => x.id === s.libraryId);
          if (!e || have.has(lower(e.title.fr)) || have.has(lower(e.title.en))) continue;
          const t = e.text[locale] ?? e.text.en!;
          // A skill bundled with Sklubot, which the owner read on the review screen: active, as from the Bibliothèque.
          skills.create(bot.id, (e.title[locale] ?? e.title.en), t.description || (e.summary[locale] ?? e.summary.en), t.body, false);
          have.add(lower((e.title[locale] ?? e.title.en)));
        } else {
          if (have.has(lower(s.name))) continue;
          skills.create(bot.id, s.name, s.when, s.body, false, { draft: true });
          have.add(lower(s.name));
          drafts++;
        }
        report.skills++;
      }
      const haveRoutines = new Set(routines.forBot(bot.id).map((r) => lower(r.name)));
      let paused = 0;
      for (const [i, r] of b.routines.entries()) {
        if (Array.isArray(c.routines) && c.routines[i] !== true) continue;
        if (haveRoutines.has(lower(r.name))) continue;
        routines.create(bot.id, { name: r.name, prompt: r.task, trigger: "cron", schedule: r.cron, timezone: r.timezone, paused: true });
        haveRoutines.add(lower(r.name));
        paused++;
      }
      report.routines += paused;
      report.unscheduled.push(...b.unscheduled);
      touched.push({ bot, isNew: !into, drafts, paused, apps: src.connectors.filter((x) => !x.for.length || x.for.includes(b.name)).map((x) => x.name), unscheduled: b.unscheduled });
    }

    // Groups: members by name among the bots just created or updated; at least two, the lead first.
    for (const [gi, g] of src.groups.entries()) {
      if (Array.isArray(input.groups) && input.groups[gi] !== true) continue;
      const ids = g.members.map((m) => nameOf.get(lower(m))?.id).filter((x): x is string => !!x);
      if (ids.length < 2) continue;
      const into = mode === "update" ? linkedBot(user.id, link, g.name, "room") : null;
      const room = into ?? createRoom(user.id, g.name, ids);
      bots.patch(room.id, { memberIds: ids, roomRule: g.rule satisfies RoomRule, ...(into ? { description: tr(locale, "Group chat with {n} bots.", { n: ids.length }) } : {}), ...(sectionId ? { sectionId } : {}) });
      report.groups.push({ id: room.id, name: room.name });
      newLink.rooms[lower(g.name)] = room.id;
    }

    if (input.chiefPrimary === true && src.meta.chief) { const chief = nameOf.get(lower(src.meta.chief)); if (chief) bots.makePrimary(user.id, chief.id); }
    // A copy is a new team of its own: the link keeps pointing at the first one.
    if (src.meta.id && (mode !== "copy" || !link)) saveLink(user.id, src.meta.id, newLink);
  });
  pending.delete(String(input.previewId));

  const from = tr(locale, mode === "update" ? "Updated from the team file “{name}”." : "Created from the team file “{name}”.", { name: src.meta.name || p.source.label });
  for (const t of touched) {
    const items = [
      t.apps.length ? tr(locale, "connect {apps} (Settings → Apps); no key or sign-in was imported", { apps: t.apps.join(", ") }) : "",
      t.drafts ? tr(locale, "read its {n} draft skill(s) and activate the ones you keep (its settings → Skills)", { n: t.drafts }) : "",
      t.paused ? tr(locale, "check its {n} paused routine(s), then turn them on", { n: t.paused }) : "",
      t.unscheduled.length ? tr(locale, "say when these should run, then create them: {list}", { list: t.unscheduled.join("; ") }) : "",
    ].filter(Boolean);
    const text = `${from}${t.isNew ? ` ${tr(locale, "It starts careful: it asks before acting.")}` : ""}${items.length ? ` ${tr(locale, "To do:")} ${items.map((x) => `• ${x}`).join(" ")}` : ""}`;
    rows.append(t.bot, { kind: "notice", tone: "info", text, ...(t.apps.length ? { action: { kind: "settings" as const, section: "connectors" } } : {}) });
  }
  emit(user.id, { type: "roster" });
  if (report.section) emit(user.id, { type: "sections" });
  audit(user.id, "account", `Team file (${p.source.kind === "url" ? p.source.label : p.source.kind}) “${src.meta.name}” ${mode}: ${[...report.created, ...report.updated].map((b) => b.name).join(", ")} (${report.skills} skills, ${report.routines} paused routines, ${report.groups.length} groups)`);
  return report;
}

// ── Share (export) ───────────────────────────────────────────────────────────────────────────────────────────────

const PERSONALITY_PREFIX = /^(?:Personality and tone|Personnalité et ton)\s*:\s*/;
const fileSlug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "equipe";

/** The caller's own bots as a team file: a section (with its groups), chosen bots, or the whole team. */
export function exportTeamMd(user: UserRecord, opts: { sectionId?: unknown; botIds?: unknown; botNames?: unknown; includeApps?: unknown; name?: unknown; description?: unknown }): TeamMdExport {
  const locale: Locale = user.locale;
  const mine = bots.list(user.id).filter((b) => b.kind === "agent");
  let list: BotRecord[];
  let sectionName = "", sectionId: string | null = null;
  if (typeof opts.sectionId === "string" && opts.sectionId) {
    const sec = sections.owned(user.id, opts.sectionId);
    if (!sec) throw new TeamMdError("not_found", "That section does not exist.", {}, 404);
    sectionName = sec.name; sectionId = sec.id;
    list = mine.filter((b) => b.sectionId === sec.id);
  } else if (Array.isArray(opts.botIds) && opts.botIds.length) {
    list = [];
    for (const id of opts.botIds.slice(0, TEAM_MD_LIMITS.bots * 2)) {
      const b = typeof id === "string" ? bots.owned(user.id, id) : null;
      if (!b || b.kind !== "agent" || b.hidden) throw new TeamMdError("not_found", "That bot does not exist.", {}, 404);
      if (!list.some((x) => x.id === b.id)) list.push(b);
    }
  } else if (Array.isArray(opts.botNames) && opts.botNames.length) {
    list = [];
    for (const n of opts.botNames.slice(0, TEAM_MD_LIMITS.bots * 2)) {
      const b = typeof n === "string" ? bots.byName(user.id, n) : null;
      if (!b || b.kind !== "agent") throw new TeamMdError("not_found", "That bot does not exist.", {}, 404);
      if (!list.some((x) => x.id === b.id)) list.push(b);
    }
  } else list = mine;
  if (!list.length) throw new TeamMdError("no_bots", "There is no bot to share here.");
  list = list.slice(0, TEAM_MD_LIMITS.bots);

  let masked = 0;
  const mask = (s: string) => { const r = maskSecrets(s, locale === "fr" ? "[secret retiré]" : "[secret removed]"); masked += r.secrets.length; return r.text; };
  const lib = libraryEntries();
  const ids = new Set(list.map((b) => b.id));
  const primary = list.find((b) => b.primary);
  const name = mask(line(opts.name, 80) || sectionName || (list.length === 1 ? list[0].name : tr(locale, "My team")));
  // A section's id is kept, so re-importing its file on this account offers « Mettre à jour ».
  const existing = q.get<{ team_id: string }>("SELECT team_id FROM team_md_links WHERE user_id = ? AND section_id = ?", user.id, sectionId ?? "")?.team_id;
  const teamId = existing ?? `${fileSlug(name)}-${randomBytes(4).toString("hex")}`;
  // Groups whose members are all shared here (at least two of them).
  const rooms = bots.list(user.id).filter((r) => r.kind === "room" && r.memberIds.length >= 2 && r.memberIds.every((m) => ids.has(m)));
  const catalog = catalogFor(locale);
  const apps = opts.includeApps === false ? [] : [...new Set(q.all<{ name: string }>("SELECT name FROM connectors WHERE user_id = ?", user.id).map((c) => catalog.find((a) => a.name.toLowerCase() === c.name.toLowerCase())?.name).filter((n): n is string => !!n))];

  const input: TeamMdInput = {
    meta: { id: teamId, name, description: mask(line(opts.description, 600)), version: "1", language: locale, author: "", chief: primary ? mask(primary.name) : "" },
    bots: list.map((b) => {
      const paras = b.instructions.split(/\n{2,}/);
      const pi = paras.findIndex((x) => PERSONALITY_PREFIX.test(x));
      const personality = pi >= 0 ? paras[pi].replace(PERSONALITY_PREFIX, "") : "";
      const instructions = pi >= 0 ? paras.filter((_, i) => i !== pi).join("\n\n") : b.instructions;
      return {
        name: mask(b.name), role: mask(b.description), personality: mask(personality), instructions: mask(instructions),
        look: { shape: b.shape, color: b.color, character: b.character },
        // A brain of Sklubot's own providers only: an account's own provider ("up-…") is private to it.
        model: b.model && !isUserProviderRef(b.model) ? b.model : "",
        skills: skills.list(b.id).filter((s) => s.botId === b.id).slice(0, TEAM_MD_LIMITS.skills).map((s) => {
          const e = lib.find((x) => [x.title.fr, x.title.en].some((t) => lower(t) === lower(s.name)) && Object.values(x.text).some((t) => t?.body.trim() === s.body.trim()));
          return e ? { kind: "library" as const, libraryId: e.id } : { kind: "inline" as const, name: mask(s.name), when: mask(s.description), body: mask(s.body) };
        }),
        routines: routines.forBot(b.id).filter((r) => r.trigger === "cron" && /^\S+( \S+){4}$/.test(r.schedule)).slice(0, TEAM_MD_LIMITS.routines)
          .map((r) => ({ name: mask(r.name), cron: r.schedule, timezone: r.timezone, task: mask(r.prompt) })),
      };
    }),
    groups: rooms.slice(0, TEAM_MD_LIMITS.groups).map((r) => {
      const members = r.memberIds.map((m) => list.find((b) => b.id === m)!.name).map(mask);
      return { name: mask(r.name), members, rule: r.roomRule, lead: members[0] };
    }),
    connectors: apps.slice(0, TEAM_MD_LIMITS.connectors).map((n) => ({ name: n, for: [], why: "" })),
  };
  const text = writeTeamMd(input, locale);
  audit(user.id, "account", `Team file shared: ${list.map((b) => b.name).join(", ")}${rooms.length ? ` + ${rooms.length} group(s)` : ""}${masked ? ` (${masked} secret(s) masked)` : ""}`);
  return { filename: `${fileSlug(name)}.md`, text, bots: list.length, groups: input.groups.length, connectors: input.connectors.length, masked };
}

/** Tests: the previews kept in memory. */
export const _teamMdPending = pending;
