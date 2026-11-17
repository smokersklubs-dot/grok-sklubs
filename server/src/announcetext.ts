/**
 * « Annonces » — the wire types and the pure text helpers shared by the server (announcements.ts) and the web app
 * (AnnouncementCard.tsx). No Node or DOM import here: the web app imports this file as it is.
 *
 * An announcement is plain text written by the server's owner or a hosted operator. Nothing in it is ever read as HTML
 * or Markdown: the app draws it with text nodes only, keeps its line breaks, and turns the https addresses it contains
 * into links (`linkify`). The optional button link is https only too, checked with the URL constructor on both sides.
 */

export const ANNOUNCE_KINDS = ["info", "new", "maintenance", "important"] as const;
export type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];

/** Size and rate limits (announcements.ts enforces them; the editor shows the counters). */
export const ANNOUNCE_LIMITS = {
  title: 80,
  body: 1000,
  bodyLines: 30,
  linkUrl: 500,
  linkLabel: 30,
  /** Accounts named in one "specific accounts" audience. */
  accounts: 200,
  /** Longest time an announcement may stay up (start → end), in days; also how far ahead it may start. */
  maxDays: 366,
  /** Announcements not archived, server-wide. */
  open: 200,
  /** Creations, edits and archivings per author per hour. */
  writesPerHour: 30,
  /** Announcements that send a push or an e-mail, server-wide, per 24 hours. */
  notifiedPerDay: 10,
  /** Push and e-mail sends per dispatch pass (one a minute): the rest goes at the next pass. */
  pushPerPass: 500,
  mailPerPass: 60,
  /** A notification not sent within this time after the start (quiet hours, server off) is dropped. */
  sendWindowDays: 3,
} as const;

/** Who reads it. `accounts` is stored as ids; the editor sends e-mail addresses (`emails`), resolved by the server. */
export type AnnounceAudience =
  | { type: "everyone" }
  | { type: "plan"; planId: string }
  | { type: "workspace"; workspaceId: string }
  | { type: "accounts"; userIds: string[] };
export type AnnounceAudienceInput =
  | { type: "everyone" }
  | { type: "plan"; planId: string }
  | { type: "workspace"; workspaceId: string }
  | { type: "accounts"; emails: string[] };

export interface AnnounceLink { url: string; label: string }

/** What a reader gets. */
export interface AnnouncementView {
  id: string;
  kind: AnnounceKind;
  title: string;
  body: string;
  link: AnnounceLink | null;
  startsAt: number;
  endsAt: number | null;
  /** Maintenance only: also shown as a band on top of every page. */
  siteBanner: boolean;
  /** Counted in the bell (an "important" one stays unread until "J'ai lu"). */
  unread: boolean;
}
export interface AnnouncementsState {
  items: AnnouncementView[];
  unread: number;
  /** The maintenance band to show on every page (the newest one not dismissed), if any. */
  site: AnnouncementView | null;
  /** The owner or a hosted operator: the « Annonces » page is theirs. */
  canAuthor: boolean;
  /** The reader's own choice: announcements by e-mail too (when the author asks for it). */
  emailOptIn: boolean;
}

/** What the editor sends (create, edit, preview). Dates in milliseconds. */
export interface AnnouncementDraft {
  kind: AnnounceKind;
  title: string;
  body: string;
  linkUrl: string;
  linkLabel: string;
  audience: AnnounceAudienceInput;
  startsAt: number | null;
  endsAt: number | null;
  siteBanner: boolean;
  push: boolean;
  email: boolean;
}

export type AnnounceStatus = "scheduled" | "live" | "ended" | "archived";
export interface AnnouncementAdminItem {
  id: string;
  kind: AnnounceKind;
  title: string;
  body: string;
  link: AnnounceLink | null;
  audience: AnnounceAudience;
  /** The audience in words for the list (plan name, workspace name, the accounts' e-mails). */
  audienceLabel: string;
  emails: string[];
  startsAt: number;
  endsAt: number | null;
  siteBanner: boolean;
  push: boolean;
  email: boolean;
  status: AnnounceStatus;
  createdAt: number;
  updatedAt: number;
  authorName: string;
  recipients: number;
  dismissed: number;
  sent: { push: number; email: number; skipped: number };
}
export interface AnnouncementLogEntry { at: number; actorName: string; action: string; title: string }
export interface AnnouncementsAdmin {
  items: AnnouncementAdminItem[];
  /** Hosted mode: the plans an audience can name (null: not a hosted server, no plans). */
  plans: { id: string; name: string }[] | null;
  workspaces: { id: string; name: string; members: number }[];
  mailConfigured: boolean;
  log: AnnouncementLogEntry[];
}
export interface AnnouncementPreview { ok: true; recipients: number; view: AnnouncementView }

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A piece of an announcement's body: plain text, or an https address shown as a link. */
export type TextPiece = { text: string; url?: undefined } | { text: string; url: string };

/**
 * The https address it is, normalised by the URL constructor, or null: anything but https (javascript:, data:, http:,
 * mailto:…), an address with a user name or password, one without a host, or one longer than the limit.
 */
export function safeHttpsUrl(raw: string, max: number = ANNOUNCE_LIMITS.linkUrl): string | null {
  const s = raw.trim();
  if (!s || s.length > max || /[\s<>"'`\\]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
  return u.href;
}

const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/gi;
/**
 * Splits a body into text and links: only `https://` addresses become links, each checked by `safeHttpsUrl`; the
 * punctuation that usually ends a sentence after an address (. , ; : ! ? ) ») stays text.
 */
export function linkify(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    let raw = m[0];
    while (raw.length && /[.,;:!?)\]»”’]/.test(raw[raw.length - 1])) raw = raw.slice(0, -1);
    const start = m.index ?? 0;
    const url = safeHttpsUrl(raw, 2000);
    if (!url) continue;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: raw, url });
    at = start + raw.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
