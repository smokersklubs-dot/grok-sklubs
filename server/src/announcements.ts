import { mailConfigured, sendSystemMail } from "./accountmail.js"; import { byLocale, colon, localize, type LocaleTexts } from "./lang/index.js"; import { tr } from "./i18n.js";
import {
  ANNOUNCE_KINDS, ANNOUNCE_LIMITS, safeHttpsUrl,
  type AnnounceAudience, type AnnounceKind, type AnnouncementAdminItem, type AnnouncementsAdmin, type AnnouncementsState, type AnnouncementView, type AnnounceStatus,
} from "./announcetext.js";
import { emit } from "./bus.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { RateWindow } from "./hardening.js";
import { adminLog, hostedMode, isOperator, ownerAccountId, planName, plans, subscriptions } from "./hosted.js";
import { inQuietHours, pushSettings, sendPush } from "./push.js";
import type { Locale } from "./shared.js";
import { audit, clip, newId, now, users } from "./store.js";

/**
 * « Annonces » — what the server's owner (and, in hosted mode, its operators) tells the people who use it: testers,
 * customers, the team. Written on the page « Annonces », read on « Aujourd'hui » (a card), in the sidebar's bell (an
 * unread count) and, for a maintenance, in a band on top of every page.
 *
 * Owner-written only, stored in this server's database. Unlike OpenMausBot's announcements (docs/announcements.md there,
 * Apache-2.0; ideas only, our own code), nothing is fetched from GitHub or anywhere else: a remote feed would add an
 * outgoing request, a cache, a second author (whoever can merge to a repository) and a way for content nobody on this
 * server wrote to reach its users. Here the only authors are the people who already administer the server, and every
 * change is in the log. What we kept from it: strict limits, plain text, https links only, everything validated.
 *
 * Safety: the title, the body and the button label are plain text — HTML tags are refused, control and bidirectional
 * override characters removed — and the app draws them with text nodes only; the body keeps its line breaks and its
 * https addresses become links (announcetext.ts linkify). The button link must be an https address (URL constructor).
 * The app's Content-Security-Policy is unchanged: nothing here loads or runs anything.
 *
 * Audience: everyone, the accounts on one plan (hosted mode), the members of one workspace, or named accounts. A reader
 * sees an announcement from its start to its end (or until it is archived), can close it ("dismissed", per reader), and
 * an "important" one stays counted in the bell until they say they read it. Push and e-mail (optional, per
 * announcement) go once per reader and channel (announcement_sends), respect the reader's switch "Annonces" and quiet
 * hours (Réglages → Notifications: what is due waits for the end of the quiet hours), their choice of e-mails, and only
 * when the server has an SMTP account. Editing an announcement that was already sent does not send it again.
 */

// ── Who may write ───────────────────────────────────────────────────────────────────────────────────────────────
export const canAuthor = (userId: string): boolean => (hostedMode() ? isOperator(userId) : userId === ownerAccountId());

/** Everyone who may write announcements (the owner first). */
function authors(): string[] {
  const owner = ownerAccountId();
  if (!owner) return [];
  if (!hostedMode()) return [owner];
  return [owner, ...q.all<{ id: string }>("SELECT id FROM users WHERE server_role = 'operator' AND id != ?", owner).map((r) => r.id)];
}

// ── Errors (English is the key; French for French accounts) ──────────────────────────────────────────────────────
export class AnnounceError extends Error { constructor(public status: 400 | 404 | 409 | 429, message: string, public vars: Record<string, string | number> = {}) { super(message); } }
const FR: Record<string, string> = {
  "No such endpoint.": "Cette adresse n'existe pas.",
  "Invalid value.": "Valeur invalide.",
  "That announcement does not exist.": "Cette annonce n'existe pas.",
  "Choose a kind: info, new, maintenance or important.": "Choisis un type : info, nouveauté, maintenance ou important.",
  "Give the announcement a title.": "Donne un titre à l'annonce.",
  "The title is at most {n} characters.": "Le titre fait au plus {n} caractères.",
  "The text is at most {n} characters.": "Le texte fait au plus {n} caractères.",
  "The text is at most {n} lines.": "Le texte fait au plus {n} lignes.",
  "Write plain text: HTML tags are not allowed.": "Écris du texte simple : les balises HTML ne sont pas acceptées.",
  "The link must be a full https:// address.": "Le lien doit être une adresse complète en https://.",
  "The button's text is at most {n} characters.": "Le texte du bouton fait au plus {n} caractères.",
  "Choose who reads it.": "Choisis qui la lit.",
  "Plans only exist on a hosted server.": "Les formules n'existent que sur un serveur hébergé.",
  "That plan does not exist.": "Cette formule n'existe pas.",
  "That workspace does not exist.": "Cet espace n'existe pas.",
  "Name at least one account.": "Indique au moins un compte.",
  "At most {n} accounts.": "Au plus {n} comptes.",
  "No account uses {email}.": "Aucun compte n'utilise {email}.",
  "The dates are not valid.": "Les dates ne sont pas valides.",
  "The start is already past.": "Le début est déjà passé.",
  "The start is more than a year away.": "Le début est à plus d'un an.",
  "The end must come after the start.": "La fin doit venir après le début.",
  "An announcement stays up at most a year.": "Une annonce reste au plus un an.",
  "This server cannot send e-mails yet (no SMTP account).": "Ce serveur ne peut pas encore envoyer d'e-mails (aucun compte SMTP).",
  "Too many changes in an hour. Wait a little and try again.": "Trop de changements en une heure. Attends un peu puis réessaie.",
  "At most {n} announcements with a notification in 24 hours. Publish this one without push or e-mail, or wait.": "Au plus {n} annonces avec notification en 24 heures. Publie celle-ci sans notification ni e-mail, ou attends.",
  "Too many announcements are up: archive old ones first.": "Trop d'annonces en ligne : archive d'abord les anciennes.",
  "An archived announcement cannot be changed: duplicate it.": "Une annonce archivée ne se modifie plus : duplique-la.",
  "Too many requests. Wait a minute and try again.": "Trop de requêtes. Attends une minute puis réessaie.",
};
export const announceText = (loc: Locale, en: string, vars: Record<string, string | number> = {}) =>
  localize(loc, en, FR).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AnnRow {
  id: string; kind: AnnounceKind; title: string; body: string; link_url: string; link_label: string; audience: string;
  starts_at: number; ends_at: number | null; site_banner: number; push: number; email: number;
  created_by: string; created_at: number; updated_by: string; updated_at: number; archived_at: number | null; live_at: number | null;
}
const rowById = (id: string) => q.get<AnnRow>("SELECT * FROM announcements WHERE id = ?", id) ?? null;
const liveRows = (t: number) => q.all<AnnRow>("SELECT * FROM announcements WHERE archived_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) ORDER BY starts_at DESC LIMIT ?", t, t, ANNOUNCE_LIMITS.open);
export function audienceOf(r: Pick<AnnRow, "audience">): AnnounceAudience {
  try {
    const a = JSON.parse(r.audience);
    if (a?.type === "plan" && typeof a.planId === "string") return { type: "plan", planId: a.planId };
    if (a?.type === "workspace" && typeof a.workspaceId === "string") return { type: "workspace", workspaceId: a.workspaceId };
    if (a?.type === "accounts" && Array.isArray(a.userIds)) return { type: "accounts", userIds: a.userIds.filter((x: unknown) => typeof x === "string") };
    if (a?.type === "everyone") return { type: "everyone" };
  } catch { /* nobody below */ }
  return { type: "accounts", userIds: [] };
}
const statusOf = (r: AnnRow, t: number): AnnounceStatus => (r.archived_at ? "archived" : r.starts_at > t ? "scheduled" : r.ends_at !== null && r.ends_at <= t ? "ended" : "live");

// ── Audience ─────────────────────────────────────────────────────────────────────────────────────────────────────
const workspaceMembers = (wid: string) => q.all<{ id: string }>(
  "SELECT user_id AS id FROM workspace_members WHERE workspace_id = ? UNION SELECT owner_id AS id FROM workspaces WHERE id = ?", wid, wid).map((r) => r.id);
/** Every account an audience reaches now. A plan reaches nobody outside hosted mode. */
export function recipients(a: AnnounceAudience): string[] {
  if (a.type === "everyone") return q.all<{ id: string }>("SELECT id FROM users ORDER BY created_at").map((r) => r.id);
  if (a.type === "plan") return hostedMode() ? q.all<{ user_id: string }>("SELECT user_id FROM subscriptions WHERE plan_id = ?", a.planId).map((r) => r.user_id) : [];
  if (a.type === "workspace") return workspaceMembers(a.workspaceId);
  if (!a.userIds.length) return [];
  return q.all<{ id: string }>(`SELECT id FROM users WHERE id IN (${a.userIds.map(() => "?").join(",")})`, ...a.userIds).map((r) => r.id);
}
/** Whether one reader is in an audience (memberships read once per call of `forReader`). */
function readerTest(userId: string): (a: AnnounceAudience) => boolean {
  let plan: string | null | undefined;
  let spaces: Set<string> | undefined;
  return (a) => {
    if (a.type === "everyone") return true;
    if (a.type === "accounts") return a.userIds.includes(userId);
    if (a.type === "plan") {
      if (!hostedMode()) return false;
      if (plan === undefined) plan = subscriptions.get(userId)?.planId ?? null;
      return plan === a.planId;
    }
    spaces ??= new Set(q.all<{ id: string }>("SELECT workspace_id AS id FROM workspace_members WHERE user_id = ? UNION SELECT id FROM workspaces WHERE owner_id = ?", userId, userId).map((r) => r.id));
    return spaces.has(a.workspaceId);
  };
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const HTML_TAG = /<\s*\/?\s*[a-z!?][^>]*>/i;
// Control characters (but the line break), and the bidirectional overrides that can make a text read backwards.
const INVISIBLE = /[\u0000-\u0009\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;
const plainLine = (v: unknown) => String(v ?? "").replace(/\r\n?|\n/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
const noTags = (s: string) => { if (HTML_TAG.test(s)) throw new AnnounceError(400, "Write plain text: HTML tags are not allowed."); return s; };

export interface CleanAnnouncement {
  kind: AnnounceKind; title: string; body: string; linkUrl: string; linkLabel: string; audience: AnnounceAudience;
  startsAt: number; endsAt: number | null; siteBanner: boolean; push: boolean; email: boolean;
}

/** Checks and cleans what the editor sent. `cur`: the announcement being edited (its start may be in the past). */
export function cleanAnnouncement(raw: unknown, t: number, cur: AnnRow | null = null): CleanAnnouncement {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const L = ANNOUNCE_LIMITS;
  if (!(ANNOUNCE_KINDS as readonly string[]).includes(b.kind)) throw new AnnounceError(400, "Choose a kind: info, new, maintenance or important.");
  const kind = b.kind as AnnounceKind;
  const title = noTags(plainLine(b.title));
  if (!title) throw new AnnounceError(400, "Give the announcement a title.");
  if (title.length > L.title) throw new AnnounceError(400, "The title is at most {n} characters.", { n: L.title });
  const body = noTags(String(b.body ?? "").replace(/\r\n?/g, "\n").replace(INVISIBLE, "").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim());
  if (body.length > L.body) throw new AnnounceError(400, "The text is at most {n} characters.", { n: L.body });
  if (body.split("\n").length > L.bodyLines) throw new AnnounceError(400, "The text is at most {n} lines.", { n: L.bodyLines });
  const rawUrl = String(b.linkUrl ?? "").trim();
  const linkUrl = rawUrl ? safeHttpsUrl(rawUrl) : "";
  if (linkUrl === null) throw new AnnounceError(400, "The link must be a full https:// address.");
  const linkLabel = linkUrl ? noTags(plainLine(b.linkLabel)) : "";
  if (linkLabel.length > L.linkLabel) throw new AnnounceError(400, "The button's text is at most {n} characters.", { n: L.linkLabel });
  const audience = cleanAudience(b.audience);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);
  const s = num(b.startsAt), e = num(b.endsAt);
  if (Number.isNaN(s) || Number.isNaN(e)) throw new AnnounceError(400, "The dates are not valid.");
  const startsAt = s ?? (cur && cur.starts_at <= t ? cur.starts_at : t);
  if (startsAt < Math.min(cur?.starts_at ?? Infinity, t - DAY)) throw new AnnounceError(400, "The start is already past.");
  if (startsAt > t + L.maxDays * DAY) throw new AnnounceError(400, "The start is more than a year away.");
  const endsAt = e;
  if (endsAt !== null) {
    if (endsAt <= startsAt) throw new AnnounceError(400, "The end must come after the start.");
    if (endsAt - startsAt > L.maxDays * DAY) throw new AnnounceError(400, "An announcement stays up at most a year.");
  }
  const email = b.email === true;
  if (email && !mailConfigured()) throw new AnnounceError(400, "This server cannot send e-mails yet (no SMTP account).");
  return { kind, title, body, linkUrl, linkLabel, audience, startsAt, endsAt, siteBanner: kind === "maintenance" && b.siteBanner === true, push: b.push === true, email };
}

function cleanAudience(raw: unknown): AnnounceAudience {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  if (a.type === "everyone") return { type: "everyone" };
  if (a.type === "plan") {
    if (!hostedMode()) throw new AnnounceError(400, "Plans only exist on a hosted server.");
    const plan = typeof a.planId === "string" ? plans.get(a.planId) : null;
    if (!plan) throw new AnnounceError(400, "That plan does not exist.");
    return { type: "plan", planId: plan.id };
  }
  if (a.type === "workspace") {
    const ws = typeof a.workspaceId === "string" ? q.get<{ id: string }>("SELECT id FROM workspaces WHERE id = ?", a.workspaceId) : undefined;
    if (!ws) throw new AnnounceError(400, "That workspace does not exist.");
    return { type: "workspace", workspaceId: ws.id };
  }
  if (a.type === "accounts") {
    const list: unknown[] = Array.isArray(a.emails) ? a.emails : typeof a.emails === "string" ? a.emails.split(/[\s,;]+/) : [];
    const emails = [...new Set(list.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) throw new AnnounceError(400, "Name at least one account.");
    if (emails.length > ANNOUNCE_LIMITS.accounts) throw new AnnounceError(400, "At most {n} accounts.", { n: ANNOUNCE_LIMITS.accounts });
    const userIds: string[] = [];
    for (const em of emails) {
      const id = q.get<{ id: string }>("SELECT id FROM users WHERE email = ? COLLATE NOCASE", em)?.id;
      if (!id) throw new AnnounceError(400, "No account uses {email}.", { email: clip(em, 80) });
      userIds.push(id);
    }
    return { type: "accounts", userIds };
  }
  throw new AnnounceError(400, "Choose who reads it.");
}

// ── Readers ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface ReadRow { announcement_id: string; seen_at: number | null; dismissed_at: number | null }
const RANK: Record<AnnounceKind, number> = { important: 0, maintenance: 1, new: 2, info: 3 };

function toView(r: AnnRow, read: ReadRow | undefined): AnnouncementView {
  const dismissed = !!read?.dismissed_at;
  return {
    id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link_url ? { url: r.link_url, label: r.link_label } : null,
    startsAt: r.starts_at, endsAt: r.ends_at, siteBanner: !!r.site_banner,
    unread: !dismissed && (r.kind === "important" || !read?.seen_at),
  };
}

/** The live announcements one reader is in the audience of (closed ones included), with their read state. */
function forReader(userId: string, t: number): { row: AnnRow; read: ReadRow | undefined }[] {
  const test = readerTest(userId);
  const rows = liveRows(t).filter((r) => test(audienceOf(r)));
  if (!rows.length) return [];
  const reads = new Map(q.all<ReadRow>(`SELECT announcement_id, seen_at, dismissed_at FROM announcement_reads WHERE user_id = ? AND announcement_id IN (${rows.map(() => "?").join(",")})`, userId, ...rows.map((r) => r.id)).map((x) => [x.announcement_id, x]));
  return rows.map((row) => ({ row, read: reads.get(row.id) }));
}

export const emailOptIn = (userId: string) => (q.get<{ email: number }>("SELECT email FROM announcement_prefs WHERE user_id = ?", userId)?.email ?? 1) === 1;
export function setEmailOptIn(userId: string, on: boolean) {
  q.run("INSERT INTO announcement_prefs (user_id, email, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at", userId, on ? 1 : 0, now());
}

/** GET /announcements: what is up for this reader now — the ones not closed, the important first. */
export function readerState(userId: string, t = now()): AnnouncementsState {
  const open = forReader(userId, t).filter((x) => !x.read?.dismissed_at)
    .sort((a, b) => RANK[a.row.kind] - RANK[b.row.kind] || b.row.starts_at - a.row.starts_at)
    .map((x) => toView(x.row, x.read));
  const site = open.find((v) => v.kind === "maintenance" && v.siteBanner) ?? null;
  return { items: open, unread: open.filter((v) => v.unread).length, site, canAuthor: canAuthor(userId), emailOptIn: emailOptIn(userId) };
}

/** The bell was opened: these announcements were seen (an important one still counts until it is closed). */
export function markSeen(userId: string, ids: unknown, t = now()) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).slice(0, 50).filter((x): x is string => typeof x === "string"));
  for (const { row } of forReader(userId, t)) {
    if (!wanted.has(row.id)) continue;
    q.run("INSERT INTO announcement_reads (announcement_id, user_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(announcement_id, user_id) DO UPDATE SET seen_at = COALESCE(seen_at, excluded.seen_at)", row.id, userId, t);
  }
}
/** "Fermer" / "J'ai lu": closed for this reader only. Not theirs (or not up): 404, the same as an id that does not exist. */
export function dismiss(userId: string, id: string, t = now()) {
  if (!forReader(userId, t).some((x) => x.row.id === id)) throw new AnnounceError(404, "That announcement does not exist.");
  q.run("INSERT INTO announcement_reads (announcement_id, user_id, seen_at, dismissed_at) VALUES (?, ?, ?, ?) ON CONFLICT(announcement_id, user_id) DO UPDATE SET seen_at = COALESCE(seen_at, excluded.seen_at), dismissed_at = excluded.dismissed_at", id, userId, t, t);
}

// ── Authors ──────────────────────────────────────────────────────────────────────────────────────────────────────
const writes = new RateWindow(ANNOUNCE_LIMITS.writesPerHour, 3_600_000);

function log(actorId: string, id: string, action: "create" | "edit" | "archive", title: string) {
  q.run("INSERT INTO announcement_log (at, actor_id, announcement_id, action, title) VALUES (?, ?, ?, ?, ?)", now(), actorId, id, action, title);
  audit(actorId, "account", `Announcement ${action === "create" ? "published" : action === "edit" ? "changed" : "archived"}: ${clip(title, 120)}`);
  if (hostedMode()) adminLog({ id: actorId, label: users.byId(actorId)?.email ?? actorId }, null, `announcement.${action}`, title);
}
/** Tells the readers' apps to reload (only when it is up: a scheduled one is told when it starts, by the dispatch pass). */
function tell(r: AnnRow | null, other: AnnounceAudience | null, t: number) {
  const who = new Set<string>(authors());
  if (r && r.starts_at <= t) for (const u of recipients(audienceOf(r))) who.add(u);
  if (other) for (const u of recipients(other)) who.add(u);
  for (const u of who) emit(u, { type: "announcements" });
}
function notifiedLastDay(t: number, except = ""): number {
  return q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements WHERE (push = 1 OR email = 1) AND created_at > ? AND id != ?", t - DAY, except)?.n ?? 0;
}

export function createAnnouncement(authorId: string, raw: unknown, t = now()): AnnRow {
  if (writes.over(authorId, t)) throw new AnnounceError(429, "Too many changes in an hour. Wait a little and try again.");
  const c = cleanAnnouncement(raw, t);
  if ((q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements WHERE archived_at IS NULL")?.n ?? 0) >= ANNOUNCE_LIMITS.open) throw new AnnounceError(409, "Too many announcements are up: archive old ones first.");
  if ((c.push || c.email) && notifiedLastDay(t) >= ANNOUNCE_LIMITS.notifiedPerDay) throw new AnnounceError(429, "At most {n} announcements with a notification in 24 hours. Publish this one without push or e-mail, or wait.", { n: ANNOUNCE_LIMITS.notifiedPerDay });
  const id = newId("ann");
  q.run(`INSERT INTO announcements (id, kind, title, body, link_url, link_label, audience, starts_at, ends_at, site_banner, push, email, created_by, created_at, updated_by, updated_at, live_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, c.kind, c.title, c.body, c.linkUrl, c.linkLabel, JSON.stringify(c.audience), c.startsAt, c.endsAt,
    c.siteBanner ? 1 : 0, c.push ? 1 : 0, c.email ? 1 : 0, authorId, t, authorId, t, c.startsAt <= t ? t : null);
  const row = rowById(id)!;
  log(authorId, id, "create", c.title);
  tell(row, null, t);
  return row;
}

export function updateAnnouncement(authorId: string, id: string, raw: unknown, t = now()): AnnRow {
  const cur = rowById(id);
  if (!cur) throw new AnnounceError(404, "That announcement does not exist.");
  if (cur.archived_at) throw new AnnounceError(409, "An archived announcement cannot be changed: duplicate it.");
  if (writes.over(authorId, t)) throw new AnnounceError(429, "Too many changes in an hour. Wait a little and try again.");
  const c = cleanAnnouncement(raw, t, cur);
  const newlyNotified = (c.push && !cur.push) || (c.email && !cur.email);
  if (newlyNotified && !(cur.push || cur.email) && notifiedLastDay(t, id) >= ANNOUNCE_LIMITS.notifiedPerDay) throw new AnnounceError(429, "At most {n} announcements with a notification in 24 hours. Publish this one without push or e-mail, or wait.", { n: ANNOUNCE_LIMITS.notifiedPerDay });
  q.run(`UPDATE announcements SET kind = ?, title = ?, body = ?, link_url = ?, link_label = ?, audience = ?, starts_at = ?, ends_at = ?, site_banner = ?, push = ?, email = ?,
    updated_by = ?, updated_at = ?, live_at = CASE WHEN ? <= ? THEN COALESCE(live_at, ?) ELSE NULL END WHERE id = ?`,
    c.kind, c.title, c.body, c.linkUrl, c.linkLabel, JSON.stringify(c.audience), c.startsAt, c.endsAt, c.siteBanner ? 1 : 0, c.push ? 1 : 0, c.email ? 1 : 0,
    authorId, t, c.startsAt, t, t, id);
  const row = rowById(id)!;
  log(authorId, id, "edit", c.title);
  tell(row, cur.starts_at <= t ? audienceOf(cur) : null, t);
  return row;
}

export function archiveAnnouncement(authorId: string, id: string, t = now()) {
  const cur = rowById(id);
  if (!cur) throw new AnnounceError(404, "That announcement does not exist.");
  if (cur.archived_at) return;
  if (writes.over(authorId, t)) throw new AnnounceError(429, "Too many changes in an hour. Wait a little and try again.");
  q.run("UPDATE announcements SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?", t, authorId, t, id);
  log(authorId, id, "archive", cur.title);
  tell(null, cur.starts_at <= t ? audienceOf(cur) : null, t);
}

/** "Aperçu": the cleaned announcement as a reader will see it, and how many accounts it reaches. Nothing is saved. */
export function previewAnnouncement(raw: unknown, t = now(), id?: string): { recipients: number; view: AnnouncementView } {
  const cur = id ? rowById(id) : null;
  const c = cleanAnnouncement(raw, t, cur);
  const view: AnnouncementView = { id: "preview", kind: c.kind, title: c.title, body: c.body, link: c.linkUrl ? { url: c.linkUrl, label: c.linkLabel } : null, startsAt: c.startsAt, endsAt: c.endsAt, siteBanner: c.siteBanner, unread: true };
  return { recipients: recipients(c.audience).length, view };
}

function adminItem(r: AnnRow, t: number, loc: Locale): AnnouncementAdminItem {
  const a = audienceOf(r);
  let audienceLabel = "";
  let emails: string[] = [];
  if (a.type === "plan") audienceLabel = planName(plans.get(a.planId), loc);
  if (a.type === "workspace") audienceLabel = q.get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", a.workspaceId)?.name ?? "—";
  if (a.type === "accounts") { emails = a.userIds.map((u) => users.byId(u)?.email).filter((x): x is string => !!x); audienceLabel = emails.join(", "); }
  const sent = { push: 0, email: 0, skipped: 0 };
  for (const s of q.all<{ channel: string; status: string; n: number }>("SELECT channel, status, COUNT(*) AS n FROM announcement_sends WHERE announcement_id = ? GROUP BY channel, status", r.id)) {
    if (s.status === "skipped") sent.skipped += s.n;
    else if (s.status === "sent" && (s.channel === "push" || s.channel === "email")) sent[s.channel] += s.n;
  }
  return {
    id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link_url ? { url: r.link_url, label: r.link_label } : null, audience: a, audienceLabel, emails,
    startsAt: r.starts_at, endsAt: r.ends_at, siteBanner: !!r.site_banner, push: !!r.push, email: !!r.email, status: statusOf(r, t),
    createdAt: r.created_at, updatedAt: r.updated_at, authorName: users.byId(r.created_by)?.name ?? "—", recipients: recipients(a).length,
    dismissed: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcement_reads WHERE announcement_id = ? AND dismissed_at IS NOT NULL", r.id)?.n ?? 0, sent,
  };
}

/** GET /announcements-admin: every announcement (archived last), what audiences can name, the log. */
export function adminState(userId: string, t = now()): AnnouncementsAdmin {
  const loc = users.localeOf(userId);
  const rows = q.all<AnnRow>("SELECT * FROM announcements ORDER BY archived_at IS NOT NULL, starts_at DESC LIMIT 300");
  return {
    items: rows.map((r) => adminItem(r, t, loc)),
    plans: hostedMode() ? plans.list(false).map((p) => ({ id: p.id, name: planName(p, loc) })) : null,
    workspaces: q.all<{ id: string; name: string; members: number }>("SELECT w.id, w.name, (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS members FROM workspaces w ORDER BY w.name COLLATE NOCASE LIMIT 500"),
    mailConfigured: mailConfigured(),
    log: q.all<{ at: number; actor_id: string; action: string; title: string }>("SELECT at, actor_id, action, title FROM announcement_log ORDER BY id DESC LIMIT 30")
      .map((l) => ({ at: l.at, actorName: users.byId(l.actor_id)?.name ?? "—", action: l.action, title: l.title })),
  };
}

// ── Push and e-mail ──────────────────────────────────────────────────────────────────────────────────────────────
export interface AnnounceSender {
  push(userId: string, title: string, body: string, id: string): Promise<number>;
  mail(to: string, subject: string, text: string): Promise<void>;
  mailReady(): boolean;
}
export interface AnnounceSend { id: string; userId: string; channel: "push" | "email"; status: "sent" | "skipped" | "failed" }

const KIND_WORD: LocaleTexts<Record<AnnounceKind, string>> = {
  fr: { info: "Info", new: "Nouveauté", maintenance: "Maintenance", important: "Important" },
  en: { info: "Info", new: "New", maintenance: "Maintenance", important: "Important" },
  es: { info: "Info", new: "Novedad", maintenance: "Mantenimiento", important: "Importante" },
  de: { info: "Info", new: "Neu", maintenance: "Wartung", important: "Wichtig" },
  it: { info: "Info", new: "Novità", maintenance: "Manutenzione", important: "Importante" },
  pt: { info: "Info", new: "Novidade", maintenance: "Manutenção", important: "Importante" },
  zh: { info: "信息", new: "新功能", maintenance: "维护", important: "重要" },
};
export function mailFor(r: AnnRow, loc: Locale, base: string): { subject: string; text: string } {
  const open = `${base.replace(/\/$/, "")}/?view=today`;
  const link = r.link_url ? `\n\n${r.link_label || tr(loc, "Link")}${colon(loc)}${r.link_url}` : "";
  const foot = tr(loc, "Open Sklubot: {open}\n\n— Sklubot\nYou get this announcement because you have an account on this server. To stop getting announcements by e-mail: Settings → Notifications.", { open });
  return { subject: `[Sklubot] ${byLocale(loc, KIND_WORD)[r.kind]} · ${r.title}`, text: `${r.title}\n\n${r.body}${link}\n\n${foot}\n` };
}

/** One send per announcement, reader and channel: the row is written first, so a crash or a second pass never resends. */
const claim = (id: string, userId: string, channel: string, status: string, t: number) =>
  q.run("INSERT OR IGNORE INTO announcement_sends (announcement_id, user_id, channel, status, at) VALUES (?, ?, ?, ?, ?)", id, userId, channel, status, t).changes > 0;
const settle = (id: string, userId: string, channel: string, status: string) =>
  q.run("UPDATE announcement_sends SET status = ? WHERE announcement_id = ? AND user_id = ? AND channel = ?", status, id, userId, channel);

/**
 * One dispatch pass (every minute, and right after a publication): the apps of the readers of an announcement that just
 * started are told, then what is due by push and e-mail goes — each reader once per channel, unless they switched it
 * off, have no device or confirmed address (skipped, for good), or are in their quiet hours (waits for a later pass).
 */
export async function dispatchAnnouncements(t: number, send: AnnounceSender, base = config.publicUrl): Promise<AnnounceSend[]> {
  const out: AnnounceSend[] = [];
  let pushLeft: number = ANNOUNCE_LIMITS.pushPerPass;
  let mailLeft: number = ANNOUNCE_LIMITS.mailPerPass;
  for (const r of liveRows(t)) {
    const readers = recipients(audienceOf(r));
    if (r.live_at === null) {
      q.run("UPDATE announcements SET live_at = ? WHERE id = ?", t, r.id);
      for (const u of new Set([...readers, ...authors()])) emit(u, { type: "announcements" });
    }
    if ((!r.push && !r.email) || t - r.starts_at > ANNOUNCE_LIMITS.sendWindowDays * DAY) continue;
    const done = new Set(q.all<{ user_id: string; channel: string }>("SELECT user_id, channel FROM announcement_sends WHERE announcement_id = ?", r.id).map((s) => `${s.user_id}|${s.channel}`));
    const mailOk = !!r.email && send.mailReady();
    for (const userId of readers) {
      const wantsPush = !!r.push && !done.has(`${userId}|push`) && pushLeft > 0;
      const wantsMail = mailOk && !done.has(`${userId}|email`) && mailLeft > 0;
      if (!wantsPush && !wantsMail) continue;
      if (q.get<{ n: number }>("SELECT 1 AS n FROM announcement_reads WHERE announcement_id = ? AND user_id = ? AND dismissed_at IS NOT NULL", r.id, userId)) continue;
      const ps = pushSettings(userId);
      if (inQuietHours(ps, new Date(t))) continue;
      const loc = users.localeOf(userId);
      if (wantsPush) {
        pushLeft--;
        const devices = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND enabled = 1", userId)?.n ?? 0;
        if (!ps.kinds.announce || !devices) { if (claim(r.id, userId, "push", "skipped", t)) out.push({ id: r.id, userId, channel: "push", status: "skipped" }); }
        else if (claim(r.id, userId, "push", "sending", t)) {
          const n = await send.push(userId, `${byLocale(loc, KIND_WORD)[r.kind]} · ${r.title}`, r.body || r.title, r.id).catch(() => 0);
          settle(r.id, userId, "push", n > 0 ? "sent" : "failed");
          out.push({ id: r.id, userId, channel: "push", status: n > 0 ? "sent" : "failed" });
        }
      }
      if (wantsMail) {
        mailLeft--;
        const u = q.get<{ email: string; email_verify_pending: number }>("SELECT email, email_verify_pending FROM users WHERE id = ?", userId);
        if (!u?.email || u.email_verify_pending === 1 || !emailOptIn(userId)) { if (claim(r.id, userId, "email", "skipped", t)) out.push({ id: r.id, userId, channel: "email", status: "skipped" }); }
        else if (claim(r.id, userId, "email", "sending", t)) {
          const m = mailFor(r, loc, base);
          const ok = await send.mail(u.email, m.subject, m.text).then(() => true, (err) => { console.error("[announcements] mail:", (err as Error)?.message ?? err); return false; });
          settle(r.id, userId, "email", ok ? "sent" : "failed");
          out.push({ id: r.id, userId, channel: "email", status: ok ? "sent" : "failed" });
        }
      }
    }
  }
  return out;
}

export const announceSender: AnnounceSender = {
  push: (userId, title, body, id) => sendPush(userId, { kind: "announce", title, body, tag: `announce-${id}` }),
  mail: (to, subject, text) => sendSystemMail(to, subject, text),
  mailReady: () => mailConfigured(),
};

let running: Promise<unknown> | null = null;
/** A pass now, unless one is already running (that one will see the change, or the next minute's will). */
export function dispatchSoon() {
  if (running || config.schedulerOff) return;
  running = dispatchAnnouncements(now(), announceSender).catch((err) => console.error("[announcements]", err)).finally(() => { running = null; });
}
let started = false;
/** Started once with the server (index.ts): a dispatch pass every minute. */
export function startAnnouncements() {
  if (started || config.schedulerOff) return;
  started = true;
  setInterval(dispatchSoon, 60_000).unref();
}
