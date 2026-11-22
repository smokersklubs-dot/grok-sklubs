import { randomBytes } from "node:crypto";
import { mimeOf, readLibraryFile } from "../computer.js";
import type { ToolSpec } from "../llm/types.js";
import type { Locale, NativeAppId } from "../shared.js";
import { bots, clip, users } from "../store.js";
import { maskIfAccess } from "./access.js";
import { fetchProblem } from "../net.js";
import { accounts, apiProblem, callApi, labelKey, type AccountRecord, type ApiAnswer } from "./accounts.js";
import { vendorUrl } from "./vendors.js"; import { SEARCH_CONSOLE } from "./searchconsole.js"; import { mailFingerprint, proveGmailSent, proveOutlookSent, readRaw, reportProof } from "./mailproof.js";

/**
 * What bots can do with a built-in app account. Each account gets its own set of tools, named
 * `<app>_<label>__<action>` (e.g. gmail_perso__mail_send), so with several accounts of one app the bot always picks one
 * explicitly, and permissions ("always allow") are kept per account.
 *
 * risk: "read" runs freely (its result is outside content: the turn becomes careful); "safe" changes nothing anyone else
 * sees right away (a draft, a reaction) and asks only a careful bot; "write" (send, label, archive, create, move, delete,
 * upload, post) asks like a connector write, and always asks once the turn has read outside content.
 */

export type Risk = "read" | "safe" | "write";
/** `locale`: the user's language, for the notice that replaces the body of an email that grants account access. */
interface Ctx { botId: string; locale?: Locale }
export interface NativeToolDef {
  action: string; risk: Risk; label: string; description: string; schema: ToolSpec["inputSchema"];
  run(acc: AccountRecord, args: Record<string, any>, ctx: Ctx): Promise<{ text: string; summary: string }>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });

const MAX = 14_000;
const out = (text: string, summary: string) => ({ text: clip(text, MAX), summary });
const check = (a: ApiAnswer) => { if (a.status >= 400) throw new Error(apiProblem(a)); return a; };
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const limit = (v: unknown, def: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v) || def)));
const noLines = (s: unknown, field: string) => { const v = String(s ?? ""); if (/[\r\n]/.test(v)) throw new Error(`${field} must be on one line`); return v.trim(); };
function addresses(v: unknown, field: string, required: boolean): string[] {
  const list = (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,;]/)).map((s) => s.trim()).filter(Boolean);
  if (required && !list.length) throw new Error(`${field} needs at least one address`);
  for (const a of list) if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(a)) throw new Error(`"${clip(a, 60)}" is not an email address`);
  return list.slice(0, 50);
}
function when(v: unknown, field: string): Date {
  const d = new Date(String(v ?? ""));
  if (!v || Number.isNaN(d.getTime())) throw new Error(`${field} must be an ISO 8601 date and time, e.g. 2030-01-31T09:00:00+01:00`);
  return d;
}
const html2text = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

// ── Gmail (https://developers.google.com/workspace/gmail/api/reference/rest) ────────────────────────────────────
const gmail = (path: string) => vendorUrl("google", `https://gmail.googleapis.com/gmail/v1/users/me${path}`);
const header = (m: any, name: string) => String((m?.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "");
function gmailBody(part: any): string {
  // users.messages.get with format=full: the payload is a MIME tree whose bodies are base64url (Message resource).
  const decode = (d: string) => Buffer.from(d, "base64url").toString("utf8");
  const walk = (p: any, type: string): string | null => {
    if (!p) return null;
    if (p.mimeType === type && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) { const t = walk(c, type); if (t) return t; }
    return null;
  };
  const plain = walk(part, "text/plain");
  if (plain) return plain.trim();
  const html = walk(part, "text/html");
  return html ? html2text(html) : part?.body?.data ? decode(part.body.data) : "";
}
/** Emails that grant account access (codes, magic links, password resets) keep their subject; their text is masked (access.ts). */
const gmailLine = (m: any, loc: Locale = "en") => `- id ${m.id} · thread ${m.threadId} · ${header(m, "Date")}\n  From: ${header(m, "From")}\n  Subject: ${header(m, "Subject")}\n  ${maskIfAccess(header(m, "Subject"), clip(String(m.snippet ?? "").replace(/\s+/g, " "), 240), loc)}`;
async function gmailMeta(acc: AccountRecord, id: string) {
  // format=metadata with only the headers we show (users.messages.get).
  return check(await callApi(acc, "GET", gmail(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=To`))).json;
}
export async function gmailList(acc: AccountRecord, query: string, max: number): Promise<any[]> {
  // users.messages.list: q takes Gmail's search syntax; maxResults caps the page.
  const r = check(await callApi(acc, "GET", gmail(`/messages?maxResults=${max}&q=${encodeURIComponent(query)}`))).json;
  const ids: { id: string }[] = r?.messages ?? [];
  return Promise.all(ids.slice(0, max).map((m) => gmailMeta(acc, m.id)));
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** An RFC 5322 message, UTF-8, for users.drafts.create / users.messages.send (`raw`, base64url). */
function rfc822(f: { to: string[]; cc: string[]; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const lines = [
    `To: ${f.to.join(", ")}`, ...(f.cc.length ? [`Cc: ${f.cc.join(", ")}`] : []),
    `Subject: =?UTF-8?B?${b64(f.subject)}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64",
    ...(f.inReplyTo ? [`In-Reply-To: ${f.inReplyTo}`, `References: ${[f.references, f.inReplyTo].filter(Boolean).join(" ")}`] : []),
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n${b64(f.body).replace(/.{76}/g, "$&\r\n")}`, "utf8").toString("base64url");
}
async function gmailCompose(acc: AccountRecord, a: Record<string, any>) {
  const to = addresses(a.to, "to", !a.reply_to_id);
  const cc = addresses(a.cc, "cc", false);
  let subject = noLines(a.subject, "subject");
  let threadId: string | undefined; let inReplyTo: string | undefined; let references: string | undefined;
  if (a.reply_to_id) {
    const m = await gmailMeta(acc, String(a.reply_to_id));
    threadId = m.threadId; inReplyTo = header(m, "Message-ID") || undefined; references = header(m, "References") || undefined;
    if (!subject) subject = /^re:/i.test(header(m, "Subject")) ? header(m, "Subject") : `Re: ${header(m, "Subject")}`;
    if (!to.length) to.push(...addresses(header(m, "From").match(/<([^>]+)>/)?.[1] ?? header(m, "From"), "to", true));
  }
  return { raw: rfc822({ to, cc, subject, body: String(a.body ?? ""), inReplyTo, references }), threadId, to, subject };
}

// ── Microsoft Graph (https://learn.microsoft.com/en-us/graph/api/overview) ─────────────────────────────────────
const graph = (path: string) => vendorUrl("microsoft", `https://graph.microsoft.com/v1.0/me${path}`);
const SELECT = "id,conversationId,subject,from,receivedDateTime,bodyPreview";
const who = (r: any) => (r?.emailAddress ? `${r.emailAddress.name ?? ""} <${r.emailAddress.address ?? ""}>`.trim() : "");
const outlookLine = (m: any, loc: Locale = "en") => `- id ${m.id} · thread ${m.conversationId} · ${m.receivedDateTime ?? ""}\n  From: ${who(m.from)}\n  Subject: ${m.subject ?? ""}\n  ${maskIfAccess(String(m.subject ?? ""), clip(String(m.bodyPreview ?? "").replace(/\s+/g, " "), 240), loc)}`;
const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
// Prefer: outlook.body-content-type="text" returns bodies as text (https://learn.microsoft.com/en-us/graph/api/message-get).
const TEXT_BODY = { prefer: 'outlook.body-content-type="text"' };
/** Graph wants a date-time without offset plus a time zone; we always speak UTC. */
const graphTime = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
const graphWhen = (t: any) => (t?.dateTime ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? t.dateTime : `${t.dateTime}Z`) : null);

// ── Google Calendar (https://developers.google.com/workspace/calendar/api/v3/reference) ─────────────────────────
const gcal = (path: string) => vendorUrl("google", `https://www.googleapis.com/calendar/v3${path}`);
const gcalWhen = (t: any) => (t?.dateTime ? new Date(t.dateTime) : t?.date ? new Date(`${t.date}T00:00:00Z`) : null);
export async function gcalEvents(acc: AccountRecord, from: Date, to: Date, max: number, query = ""): Promise<any[]> {
  // events.list on the primary calendar, recurring events expanded (singleEvents) and sorted by start.
  const qs = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: String(max) });
  if (query) qs.set("q", query);
  return check(await callApi(acc, "GET", gcal(`/calendars/primary/events?${qs}`))).json?.items ?? [];
}
export async function outlookEvents(acc: AccountRecord, from: Date, to: Date, max: number): Promise<any[]> {
  // calendarView: occurrences between two times (https://learn.microsoft.com/en-us/graph/api/user-list-calendarview).
  const qs = new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: String(max), $orderby: "start/dateTime", $select: "id,subject,start,end,location,attendees,organizer,bodyPreview,isAllDay" });
  return check(await callApi(acc, "GET", graph(`/calendarView?${qs}`))).json?.value ?? [];
}
export const eventStart = (acc: AccountRecord, e: any): Date | null => (acc.app === "outlook" ? graphWhen(e.start) : gcalWhen(e.start));
export const isAllDay = (acc: AccountRecord, e: any) => (acc.app === "outlook" ? !!e.isAllDay : !e.start?.dateTime);
export function eventLine(acc: AccountRecord, e: any): string {
  const start = eventStart(acc, e); const end = acc.app === "outlook" ? graphWhen(e.end) : gcalWhen(e.end);
  const title = acc.app === "outlook" ? e.subject : e.summary;
  const place = acc.app === "outlook" ? e.location?.displayName : e.location;
  const people = acc.app === "outlook" ? (e.attendees ?? []).map((x: any) => x.emailAddress?.address) : (e.attendees ?? []).map((x: any) => x.email);
  return `- id ${e.id} · ${start?.toISOString() ?? "?"} → ${end?.toISOString() ?? "?"}${isAllDay(acc, e) ? " (all day)" : ""}\n  ${title ?? "(no title)"}${place ? ` · ${place}` : ""}${people.length ? `\n  With: ${people.filter(Boolean).slice(0, 12).join(", ")}` : ""}`;
}

// ── Google Drive (https://developers.google.com/workspace/drive/api/reference/rest/v3) ───────────────────────────
const drive = (path: string) => vendorUrl("google", `https://www.googleapis.com/drive/v3${path}`);
const EXPORT: Record<string, string> = {
  // files.export targets (https://developers.google.com/workspace/drive/api/guides/ref-export-formats).
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const textLike = (m: string) => /^text\//.test(m) || /(json|xml|csv|javascript|yaml|markdown)/.test(m);

// ── Slack Web API (https://docs.slack.dev/reference/methods) ──────────────────────────────────────────────────────
export async function slack(acc: AccountRecord, method: string, params: Record<string, unknown>, post = false): Promise<any> {
  const url = vendorUrl("slack", `https://slack.com/api/${method}`);
  const a = post
    ? await callApi(acc, "POST", url, { json: params })
    : await callApi(acc, "GET", `${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`);
  if (a.status >= 400) throw new Error(apiProblem(a));
  if (!a.json?.ok) { const code = /^[a-z_]{1,60}$/.test(String(a.json?.error)) ? a.json.error : "unknown_error"; throw new Error(`Slack answered “${code}”${code === "not_in_channel" ? ": invite the app into that channel first (/invite @app)" : ""}`); }
  return a.json;
}
/** conversations.list, every kind the bot token can see (https://docs.slack.dev/reference/methods/conversations.list/). */
export async function slackChannels(acc: AccountRecord, types = "public_channel,private_channel,im,mpim"): Promise<any[]> {
  const all: any[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const j = await slack(acc, "conversations.list", { types, exclude_archived: "true", limit: 200, ...(cursor ? { cursor } : {}) });
    all.push(...(j.channels ?? []));
    cursor = j.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return all;
}
export async function slackChannelId(acc: AccountRecord, ref: string): Promise<string> {
  const s = String(ref ?? "").trim();
  if (/^[CGD][A-Z0-9]{6,}$/.test(s)) return s;
  const name = s.replace(/^#/, "").toLowerCase();
  const hit = (await slackChannels(acc, "public_channel,private_channel")).find((c) => String(c.name).toLowerCase() === name);
  if (!hit) throw new Error(`No channel called #${name} is visible to the app. Use slack channels to list them, and invite the app into private channels.`);
  return hit.id;
}
async function slackNames(acc: AccountRecord, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  // users.info, for at most 12 distinct authors (https://docs.slack.dev/reference/methods/users.info/).
  for (const id of [...new Set(ids)].slice(0, 12)) {
    try { const j = await slack(acc, "users.info", { user: id }); names.set(id, j.user?.real_name || j.user?.name || id); } catch { names.set(id, id); }
  }
  return names;
}
export const slackLine = (m: any, names?: Map<string, string>) => `- ts ${m.ts}${m.thread_ts && m.thread_ts !== m.ts ? ` (in thread ${m.thread_ts})` : ""}${m.reply_count ? ` · ${m.reply_count} replies` : ""} · ${names?.get(m.user) ?? m.user ?? m.bot_id ?? "?"}: ${clip(String(m.text ?? "").replace(/\s+/g, " "), 600)}`;

// ── The tools ──────────────────────────────────────────────────────────────
const isGoogle = (acc: AccountRecord) => acc.vendor === "google";

const MAIL: NativeToolDef[] = [
  {
    action: "mail_search", risk: "read", label: "Searching mail",
    description: "Search this mailbox and list matching messages (id, thread, from, subject, date, snippet). Gmail: Gmail search syntax (from:, subject:, is:unread, newer_than:2d…). Outlook: words, or from:/subject: keywords. Empty query: the latest messages in the inbox.",
    schema: obj({ query: str("What to look for"), max: int("At most this many messages (1-20, default 10)") }),
    async run(acc, a, ctx) {
      const max = limit(a.max, 10, 20);
      const query = String(a.query ?? "").trim();
      if (isGoogle(acc)) {
        const list = await gmailList(acc, query || "in:inbox", max);
        return out(list.length ? list.map((m) => gmailLine(m, ctx.locale)).join("\n") : "No messages match.", count(list.length, "message", "messages"));
      }
      // $search on messages (https://learn.microsoft.com/en-us/graph/search-query-parameter); without a query, the inbox newest first.
      const url = query ? graph(`/messages?$search=${encodeURIComponent(`"${query.replace(/"/g, "")}"`)}&$top=${max}&$select=${SELECT}`) : graph(`/mailFolders/inbox/messages?$top=${max}&$orderby=receivedDateTime%20desc&$select=${SELECT}`);
      const list = check(await callApi(acc, "GET", url)).json?.value ?? [];
      return out(list.length ? list.map((m: any) => outlookLine(m, ctx.locale)).join("\n") : "No messages match.", count(list.length, "message", "messages"));
    },
  },
  {
    action: "mail_read", risk: "read", label: "Reading an email",
    description: "Read one message in full (headers and text body).",
    schema: obj({ id: str("Message id from mail_search") }, ["id"]),
    async run(acc, a, ctx) {
      if (isGoogle(acc)) {
        const m = check(await callApi(acc, "GET", gmail(`/messages/${encodeURIComponent(String(a.id))}?format=full`))).json;
        return out(`From: ${header(m, "From")}\nTo: ${header(m, "To")}\nDate: ${header(m, "Date")}\nSubject: ${header(m, "Subject")}\nLabels: ${(m.labelIds ?? []).join(", ")}\nThread: ${m.threadId}\n\n${maskIfAccess(header(m, "Subject"), gmailBody(m.payload), ctx.locale ?? "en")}`, clip(header(m, "Subject") || "(no subject)", 80));
      }
      const m = check(await callApi(acc, "GET", graph(`/messages/${encodeURIComponent(String(a.id))}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,categories`), { headers: TEXT_BODY })).json;
      return out(`From: ${who(m.from)}\nTo: ${(m.toRecipients ?? []).map(who).join(", ")}\nDate: ${m.receivedDateTime}\nSubject: ${m.subject ?? ""}\nCategories: ${(m.categories ?? []).join(", ")}\nThread: ${m.conversationId}\n\n${maskIfAccess(String(m.subject ?? ""), m.body?.contentType === "html" ? html2text(m.body?.content ?? "") : m.body?.content ?? "", ctx.locale ?? "en")}`, clip(m.subject || "(no subject)", 80));
    },
  },
  {
    action: "mail_thread", risk: "read", label: "Reading a conversation",
    description: "Read a whole conversation (every message of a thread), oldest first.",
    schema: obj({ thread_id: str("Thread id from mail_search") }, ["thread_id"]),
    async run(acc, a, ctx) {
      if (isGoogle(acc)) {
        // users.threads.get
        const t = check(await callApi(acc, "GET", gmail(`/threads/${encodeURIComponent(String(a.thread_id))}?format=full`))).json;
        const msgs = t.messages ?? [];
        return out(msgs.map((m: any) => `── id ${m.id} · ${header(m, "Date")}\nFrom: ${header(m, "From")}\nSubject: ${header(m, "Subject")}\n${maskIfAccess(header(m, "Subject"), clip(gmailBody(m.payload), 3000), ctx.locale ?? "en")}`).join("\n\n") || "Empty thread.", count(msgs.length, "message", "messages"));
      }
      const id = String(a.thread_id).replace(/'/g, "''");
      const list = check(await callApi(acc, "GET", graph(`/messages?$filter=${encodeURIComponent(`conversationId eq '${id}'`)}&$top=25&$select=id,subject,from,receivedDateTime,body`), { headers: TEXT_BODY })).json?.value ?? [];
      list.sort((x: any, y: any) => String(x.receivedDateTime).localeCompare(String(y.receivedDateTime)));
      return out(list.map((m: any) => `── id ${m.id} · ${m.receivedDateTime}\nFrom: ${who(m.from)}\nSubject: ${m.subject ?? ""}\n${maskIfAccess(String(m.subject ?? ""), clip(m.body?.content ?? "", 3000), ctx.locale ?? "en")}`).join("\n\n") || "Empty thread.", count(list.length, "message", "messages"));
    },
  },
  {
    action: "mail_draft", risk: "safe", label: "Writing a draft",
    description: "Save a draft in this mailbox (nothing is sent). To reply, give reply_to_id: the draft joins that conversation and goes to its sender unless you set to.",
    schema: obj({ to: str("Recipients, comma-separated"), cc: str("Cc, comma-separated"), subject: str("Subject"), body: str("Plain-text body"), reply_to_id: str("Message id this replies to") }, ["body"]),
    async run(acc, a) {
      if (isGoogle(acc)) {
        const m = await gmailCompose(acc, a);
        // users.drafts.create
        const d = check(await callApi(acc, "POST", gmail("/drafts"), { json: { message: { raw: m.raw, ...(m.threadId ? { threadId: m.threadId } : {}) } } })).json;
        return out(`Draft saved (id ${d.id}) to ${m.to.join(", ")}: ${m.subject}`, "draft saved");
      }
      if (a.reply_to_id) {
        // createReply makes a reply draft in the conversation (https://learn.microsoft.com/en-us/graph/api/message-createreply).
        const d = check(await callApi(acc, "POST", graph(`/messages/${encodeURIComponent(String(a.reply_to_id))}/createReply`), { json: { comment: String(a.body ?? "") } })).json;
        return out(`Reply draft saved (id ${d.id}).`, "draft saved");
      }
      const to = addresses(a.to, "to", true); const cc = addresses(a.cc, "cc", false);
      // POST /me/messages creates a draft (https://learn.microsoft.com/en-us/graph/api/user-post-messages).
      const d = check(await callApi(acc, "POST", graph("/messages"), { json: { subject: noLines(a.subject, "subject"), body: { contentType: "Text", content: String(a.body ?? "") }, toRecipients: recipients(to), ccRecipients: recipients(cc) } })).json;
      return out(`Draft saved (id ${d.id}) to ${to.join(", ")}.`, "draft saved");
    },
  },
  {
    // L83: the brouillon-email skill asks to revise an existing draft instead of making another copy; this is that tool.
    action: "mail_draft_update", risk: "safe", label: "Updating a draft",
    description: "Replace the content of a draft you saved earlier in this mailbox (nothing is sent): give its draft id (the id mail_draft returned) and the full new recipients, subject and body. Use it for revisions instead of saving another draft.",
    schema: obj({ id: str("Draft id (as returned by mail_draft)"), to: str("Recipients, comma-separated"), cc: str("Cc, comma-separated"), subject: str("Subject"), body: str("Plain-text body"), reply_to_id: str("Message id this replies to, if the draft is a reply") }, ["id", "body"]),
    async run(acc, a) {
      const id = encodeURIComponent(String(a.id ?? "").trim());
      if (!id) throw new Error("give the draft id");
      if (isGoogle(acc)) {
        const m = await gmailCompose(acc, a);
        // users.drafts.update replaces the draft's message (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update).
        const d = check(await callApi(acc, "PUT", gmail(`/drafts/${id}`), { json: { id: String(a.id), message: { raw: m.raw, ...(m.threadId ? { threadId: m.threadId } : {}) } } })).json;
        return out(`Draft updated (id ${d.id ?? a.id}) to ${m.to.join(", ")}: ${m.subject}`, "draft updated");
      }
      // A draft is a message in Outlook: PATCH changes its fields (https://learn.microsoft.com/en-us/graph/api/message-update).
      const to = addresses(a.to, "to", !a.reply_to_id); const cc = addresses(a.cc, "cc", false);
      check(await callApi(acc, "PATCH", graph(`/messages/${id}`), { json: { ...(a.subject !== undefined ? { subject: noLines(a.subject, "subject") } : {}), body: { contentType: "Text", content: String(a.body ?? "") }, ...(to.length ? { toRecipients: recipients(to) } : {}), ...(a.cc !== undefined ? { ccRecipients: recipients(cc) } : {}) } }));
      return out(`Draft updated (id ${a.id}).`, "draft updated");
    },
  },
  {
    action: "mail_send", risk: "write", label: "Sending an email",
    description: "Send an email from this mailbox. To reply, give reply_to_id (the reply stays in that conversation). Needs the user's approval.",
    schema: obj({ to: str("Recipients, comma-separated"), cc: str("Cc, comma-separated"), subject: str("Subject"), body: str("Plain-text body"), reply_to_id: str("Message id this replies to") }, ["body"]),
    async run(acc, a, ctx) {
      if (isGoogle(acc)) {
        const m = await gmailCompose(acc, a);
        // L29 (mailproof.ts): the message as built for the wire is read back and must be the approved text, else nothing is sent.
        const approved = { to: m.to, subject: m.subject, body: String(a.body ?? "") }, wire = readRaw(m.raw);
        if (!wire || mailFingerprint({ ...approved, body: wire.body }) !== mailFingerprint(approved) || wire.subject !== m.subject) throw new Error("the message built for sending differs from the approved text: nothing was sent");
        // users.messages.send
        const s = check(await callApi(acc, "POST", gmail("/messages/send"), { json: { raw: m.raw, ...(m.threadId ? { threadId: m.threadId } : {}) } })).json;
        const proof = await proveGmailSent((u, h) => callApi(acc, "GET", u, { headers: h }), gmail, String(s.id ?? ""), approved);
        return out(`Sent (id ${s.id}) to ${m.to.join(", ")}: ${m.subject}.${reportProof(ctx.botId, acc.name, proof)}`, proof.state === "verified" ? "sent · checked" : "sent");
      }
      if (a.reply_to_id) {
        // https://learn.microsoft.com/en-us/graph/api/message-reply
        check(await callApi(acc, "POST", graph(`/messages/${encodeURIComponent(String(a.reply_to_id))}/reply`), { json: { comment: String(a.body ?? "") } }));
        return out("Reply sent.", "sent");
      }
      const to = addresses(a.to, "to", true); const cc = addresses(a.cc, "cc", false);
      // https://learn.microsoft.com/en-us/graph/api/user-sendmail
      check(await callApi(acc, "POST", graph("/sendMail"), { json: { message: { subject: noLines(a.subject, "subject"), body: { contentType: "Text", content: String(a.body ?? "") }, toRecipients: recipients(to), ccRecipients: recipients(cc) }, saveToSentItems: true } }));
      const proof = await proveOutlookSent((u, h) => callApi(acc, "GET", u, { headers: h }), graph, { to, subject: noLines(a.subject, "subject"), body: String(a.body ?? "") }); // L29
      return out(`Sent to ${to.join(", ")}.${reportProof(ctx.botId, acc.name, proof)}`, proof.state === "verified" ? "sent · checked" : "sent");
    },
  },
  {
    action: "mail_label", risk: "write", label: "Organizing an email",
    description: "Archive a message and/or add or remove labels (Gmail labels; Outlook categories). Needs the user's approval.",
    schema: obj({ id: str("Message id"), archive: { type: "boolean", description: "Take it out of the inbox" }, add: strs("Label names to add"), remove: strs("Label names to remove") }, ["id"]),
    async run(acc, a) {
      const add: string[] = Array.isArray(a.add) ? a.add.map(String).slice(0, 10) : [];
      const remove: string[] = Array.isArray(a.remove) ? a.remove.map(String).slice(0, 10) : [];
      const id = encodeURIComponent(String(a.id));
      if (isGoogle(acc)) {
        // users.labels.list maps names to ids; users.messages.modify; archiving = removing INBOX.
        const labels: any[] = check(await callApi(acc, "GET", gmail("/labels"))).json?.labels ?? [];
        const idOf = (n: string) => { const l = labels.find((x) => String(x.name).toLowerCase() === n.toLowerCase() || x.id === n); if (!l) throw new Error(`No label called "${clip(n, 40)}" (existing: ${labels.filter((x) => x.type === "user").map((x) => x.name).slice(0, 20).join(", ") || "none"})`); return l.id; };
        const body = { addLabelIds: add.map(idOf), removeLabelIds: [...remove.map(idOf), ...(a.archive ? ["INBOX"] : [])] };
        check(await callApi(acc, "POST", gmail(`/messages/${id}/modify`), { json: body }));
        return out(`Done${a.archive ? ": archived" : ""}${add.length ? `, labelled ${add.join(", ")}` : ""}${remove.length ? `, unlabelled ${remove.join(", ")}` : ""}.`, a.archive ? "archived" : "labelled");
      }
      if (add.length || remove.length) {
        const cur = check(await callApi(acc, "GET", graph(`/messages/${id}?$select=categories`))).json?.categories ?? [];
        const next = [...new Set([...cur.filter((c: string) => !remove.some((r) => r.toLowerCase() === c.toLowerCase())), ...add])];
        // PATCH a message's categories (https://learn.microsoft.com/en-us/graph/api/message-update).
        check(await callApi(acc, "PATCH", graph(`/messages/${id}`), { json: { categories: next } }));
      }
      // move to the well-known "archive" folder (https://learn.microsoft.com/en-us/graph/api/message-move).
      if (a.archive) check(await callApi(acc, "POST", graph(`/messages/${id}/move`), { json: { destinationId: "archive" } }));
      return out(`Done${a.archive ? ": archived" : ""}${add.length ? `, categories added: ${add.join(", ")}` : ""}${remove.length ? `, removed: ${remove.join(", ")}` : ""}.`, a.archive ? "archived" : "labelled");
    },
  },
];

const eventFields = { title: str("Title"), start: str("Start, ISO 8601 with offset"), end: str("End, ISO 8601 with offset"), description: str("Description"), location: str("Place or link"), attendees: strs("Guests' email addresses (they get an invitation)") };
const CALENDAR: NativeToolDef[] = [
  {
    action: "calendar_events", risk: "read", label: "Checking the calendar",
    description: "List events between two times (default: the next 7 days), with ids, times (UTC), title, place and guests.",
    schema: obj({ from: str("Start, ISO 8601 (default now)"), to: str("End, ISO 8601 (default in 7 days)"), query: str("Only events containing these words"), max: int("At most this many (1-50, default 20)") }),
    async run(acc, a) {
      const from = a.from ? when(a.from, "from") : new Date(); const to = a.to ? when(a.to, "to") : new Date(from.getTime() + 7 * 86400_000);
      const max = limit(a.max, 20, 50);
      let list = acc.app === "outlook" ? await outlookEvents(acc, from, to, max) : await gcalEvents(acc, from, to, max, String(a.query ?? ""));
      if (acc.app === "outlook" && a.query) { const w = String(a.query).toLowerCase(); list = list.filter((e) => `${e.subject} ${e.bodyPreview} ${e.location?.displayName}`.toLowerCase().includes(w)); }
      return out(list.length ? list.map((e) => eventLine(acc, e)).join("\n") : "No events in that period.", count(list.length, "event", "events"));
    },
  },
  {
    action: "calendar_freebusy", risk: "read", label: "Checking availability",
    description: "Busy periods between two times, for this calendar and optionally other people's addresses (when their calendars allow it).",
    schema: obj({ from: str("Start, ISO 8601"), to: str("End, ISO 8601"), emails: strs("Other people's addresses") }, ["from", "to"]),
    async run(acc, a) {
      const from = when(a.from, "from"); const to = when(a.to, "to");
      const emails = addresses(a.emails, "emails", false);
      if (acc.app !== "outlook") {
        // freeBusy.query
        const j = check(await callApi(acc, "POST", gcal("/freeBusy"), { json: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }, ...emails.map((id) => ({ id }))] } })).json;
        const lines = Object.entries(j.calendars ?? {}).map(([id, c]: [string, any]) => `${id}: ${(c.busy ?? []).map((b: any) => `${b.start} → ${b.end}`).join(", ") || "free"}${c.errors?.length ? " (not visible)" : ""}`);
        return out(lines.join("\n") || "Nothing returned.", "availability");
      }
      // getSchedule needs addresses; "me" is the account itself (https://learn.microsoft.com/en-us/graph/api/calendar-getschedule).
      const self = acc.identity && acc.identity.includes("@") ? acc.identity : null;
      const schedules = [...(self ? [self] : []), ...emails];
      if (!schedules.length) {
        const list = await outlookEvents(acc, from, to, 50);
        return out(list.map((e) => `${graphWhen(e.start)?.toISOString()} → ${graphWhen(e.end)?.toISOString()} busy`).join("\n") || "Free the whole time.", "availability");
      }
      const j = check(await callApi(acc, "POST", graph("/calendar/getSchedule"), { json: { schedules, startTime: graphTime(from), endTime: graphTime(to), availabilityViewInterval: 30 } })).json;
      const lines = (j.value ?? []).map((s: any) => `${s.scheduleId}: ${(s.scheduleItems ?? []).map((i: any) => `${graphWhen(i.start)?.toISOString()} → ${graphWhen(i.end)?.toISOString()} ${i.status}`).join(", ") || "free"}`);
      return out(lines.join("\n") || "Nothing returned.", "availability");
    },
  },
  {
    action: "calendar_create", risk: "write", label: "Creating an event",
    description: "Create an event in this calendar. Guests get an invitation. Needs the user's approval.",
    schema: obj(eventFields, ["title", "start", "end"]),
    async run(acc, a) {
      const start = when(a.start, "start"); const end = when(a.end, "end");
      if (end <= start) throw new Error("end must be after start");
      const guests = addresses(a.attendees, "attendees", false);
      if (acc.app === "outlook") {
        // https://learn.microsoft.com/en-us/graph/api/user-post-events
        const e = check(await callApi(acc, "POST", graph("/events"), { json: { subject: noLines(a.title, "title"), body: { contentType: "Text", content: String(a.description ?? "") }, start: graphTime(start), end: graphTime(end), ...(a.location ? { location: { displayName: String(a.location) } } : {}), attendees: guests.map((address) => ({ emailAddress: { address }, type: "required" })) } })).json;
        return out(`Event created (id ${e.id}): ${a.title}, ${start.toISOString()} → ${end.toISOString()}.`, "event created");
      }
      // events.insert; sendUpdates=all only when there are guests to invite.
      const e = check(await callApi(acc, "POST", gcal(`/calendars/primary/events${guests.length ? "?sendUpdates=all" : ""}`), { json: { summary: noLines(a.title, "title"), description: String(a.description ?? ""), ...(a.location ? { location: String(a.location) } : {}), start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, attendees: guests.map((email) => ({ email })) } })).json;
      return out(`Event created (id ${e.id}): ${a.title}, ${start.toISOString()} → ${end.toISOString()}.`, "event created");
    },
  },
  {
    action: "calendar_update", risk: "write", label: "Changing an event",
    description: "Change an event: only the fields given change (moving it: give start and end). Needs the user's approval.",
    schema: obj({ id: str("Event id"), ...eventFields }, ["id"]),
    async run(acc, a) {
      const id = encodeURIComponent(String(a.id));
      const start = a.start ? when(a.start, "start") : null; const end = a.end ? when(a.end, "end") : null;
      const guests = a.attendees ? addresses(a.attendees, "attendees", false) : null;
      if (acc.app === "outlook") {
        // https://learn.microsoft.com/en-us/graph/api/event-update
        const body: Record<string, unknown> = {};
        if (a.title) body.subject = noLines(a.title, "title");
        if (a.description !== undefined) body.body = { contentType: "Text", content: String(a.description) };
        if (start) body.start = graphTime(start); if (end) body.end = graphTime(end);
        if (a.location !== undefined) body.location = { displayName: String(a.location) };
        if (guests) body.attendees = guests.map((address) => ({ emailAddress: { address }, type: "required" }));
        check(await callApi(acc, "PATCH", graph(`/events/${id}`), { json: body }));
        return out("Event updated.", "event updated");
      }
      // events.patch
      const body: Record<string, unknown> = {};
      if (a.title) body.summary = noLines(a.title, "title");
      if (a.description !== undefined) body.description = String(a.description);
      if (a.location !== undefined) body.location = String(a.location);
      if (start) body.start = { dateTime: start.toISOString() }; if (end) body.end = { dateTime: end.toISOString() };
      if (guests) body.attendees = guests.map((email) => ({ email }));
      check(await callApi(acc, "PATCH", gcal(`/calendars/primary/events/${id}?sendUpdates=all`), { json: body }));
      return out("Event updated.", "event updated");
    },
  },
  {
    action: "calendar_delete", risk: "write", label: "Cancelling an event",
    description: "Delete (cancel) an event. Needs the user's approval.",
    schema: obj({ id: str("Event id") }, ["id"]),
    async run(acc, a) {
      const id = encodeURIComponent(String(a.id));
      // events.delete / https://learn.microsoft.com/en-us/graph/api/event-delete
      check(await callApi(acc, "DELETE", acc.app === "outlook" ? graph(`/events/${id}`) : gcal(`/calendars/primary/events/${id}?sendUpdates=all`)));
      return out("Event deleted.", "event deleted");
    },
  },
];

const DRIVE: NativeToolDef[] = [
  {
    action: "drive_search", risk: "read", label: "Searching Drive",
    description: "Search files in Google Drive by their content and name (newest first). Empty query: the latest files.",
    schema: obj({ query: str("Words to look for"), max: int("At most this many (1-30, default 10)") }),
    async run(acc, a) {
      const words = String(a.query ?? "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      // files.list with the Drive query language (https://developers.google.com/workspace/drive/api/guides/search-files).
      const q = words ? `fullText contains '${words}' and trashed = false` : "trashed = false";
      const qs = new URLSearchParams({ q, pageSize: String(limit(a.max, 10, 30)), fields: "files(id,name,mimeType,modifiedTime,webViewLink,size)", ...(words ? {} : { orderBy: "modifiedTime desc" }) });
      const files: any[] = check(await callApi(acc, "GET", drive(`/files?${qs}`))).json?.files ?? [];
      return out(files.length ? files.map((f) => `- id ${f.id} · ${f.name} (${f.mimeType}) · modified ${f.modifiedTime}${f.webViewLink ? ` · ${f.webViewLink}` : ""}`).join("\n") : "No files match.", count(files.length, "file", "files"));
    },
  },
  {
    action: "drive_read", risk: "read", label: "Reading a Drive file",
    description: "Read a Drive file as text: Google Docs and Slides as plain text, Sheets as CSV, and text files (txt, md, csv, json…) as they are.",
    schema: obj({ id: str("File id from drive_search") }, ["id"]),
    async run(acc, a) {
      const id = encodeURIComponent(String(a.id));
      const meta = check(await callApi(acc, "GET", drive(`/files/${id}?fields=id,name,mimeType,size`))).json;
      const type = String(meta.mimeType ?? "");
      let r: ApiAnswer;
      // files.export for Google formats, files.get?alt=media for stored files (https://developers.google.com/workspace/drive/api/guides/manage-downloads).
      if (EXPORT[type]) r = check(await callApi(acc, "GET", drive(`/files/${id}/export?mimeType=${encodeURIComponent(EXPORT[type])}`), { binary: true }));
      else if (textLike(type)) {
        if (Number(meta.size) > 5_000_000) throw new Error("this file is too large to read as text (over 5 MB)");
        r = check(await callApi(acc, "GET", drive(`/files/${id}?alt=media`), { binary: true }));
      } else throw new Error(`${meta.name} is a ${type} file, which cannot be read as text here`);
      return out(`${meta.name} (${type})\n\n${(r.bytes ?? Buffer.from(r.text)).toString("utf8")}`, clip(String(meta.name), 80));
    },
  },
  {
    action: "drive_upload", risk: "write", label: "Uploading to Drive",
    description: "Upload a file from your library to Google Drive. Needs the user's approval.",
    schema: obj({ path: str("Path of the file in your library"), name: str("Name in Drive (default: the file's name)"), folder_id: str("Drive folder id (default: My Drive)") }, ["path"]),
    async run(acc, a, ctx) {
      const rel = String(a.path).trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "");
      const bytes = readLibraryFile(ctx.botId, rel);
      if (bytes.length > 25_000_000) throw new Error("files over 25 MB are not uploaded");
      const name = noLines(a.name, "name") || rel.split("/").pop()!;
      const mime = mimeOf(name);
      const boundary = `sklubot${randomBytes(12).toString("hex")}`;
      const meta = JSON.stringify({ name, ...(a.folder_id ? { parents: [String(a.folder_id)] } : {}) });
      // Multipart upload (https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart).
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${boundary}--`),
      ]);
      const f = check(await callApi(acc, "POST", vendorUrl("google", "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink"), { raw: { body, type: `multipart/related; boundary=${boundary}` } })).json;
      return out(`Uploaded ${f.name} (id ${f.id})${f.webViewLink ? `: ${f.webViewLink}` : ""}.`, "uploaded");
    },
  },
];

const SLACK: NativeToolDef[] = [
  {
    action: "slack_channels", risk: "read", label: "Listing Slack channels",
    description: "List the channels and direct messages the app can see, with their ids and whether the app is a member.",
    schema: obj({}),
    async run(acc) {
      const list = await slackChannels(acc);
      return out(list.map((c) => `- ${c.id} · ${c.is_im ? `direct message with ${c.user}` : c.is_mpim ? `group DM ${c.name}` : `#${c.name}`}${c.is_im || c.is_member ? "" : " (app not a member)"}`).join("\n") || "No channels visible.", count(list.length, "channel", "channels"));
    },
  },
  {
    action: "slack_history", risk: "read", label: "Reading Slack",
    description: "Read the latest messages of a channel or direct message (newest first), or the replies of one thread.",
    schema: obj({ channel: str("Channel id or #name"), thread_ts: str("Read this thread's replies instead"), limit: int("At most this many (1-50, default 20)") }, ["channel"]),
    async run(acc, a) {
      const channel = await slackChannelId(acc, a.channel);
      const n = limit(a.limit, 20, 50);
      // conversations.history / conversations.replies (https://docs.slack.dev/reference/methods/conversations.history/).
      const j = a.thread_ts ? await slack(acc, "conversations.replies", { channel, ts: String(a.thread_ts), limit: n }) : await slack(acc, "conversations.history", { channel, limit: n });
      const msgs: any[] = j.messages ?? [];
      const names = await slackNames(acc, msgs.map((m) => m.user).filter(Boolean));
      return out(msgs.map((m) => slackLine(m, names)).join("\n") || "No messages.", count(msgs.length, "message", "messages"));
    },
  },
  {
    action: "slack_post", risk: "write", label: "Posting in Slack",
    description: "Post a message in a channel or direct message, or as a reply in a thread (thread_ts). Needs the user's approval.",
    schema: obj({ channel: str("Channel id or #name"), text: str("Message (Slack formatting)"), thread_ts: str("Reply in this thread") }, ["channel", "text"]),
    async run(acc, a) {
      const channel = await slackChannelId(acc, a.channel);
      // chat.postMessage (https://docs.slack.dev/reference/methods/chat.postMessage/).
      const j = await slack(acc, "chat.postMessage", { channel, text: clip(String(a.text), 3900), ...(a.thread_ts ? { thread_ts: String(a.thread_ts) } : {}) }, true);
      return out(`Posted (ts ${j.ts}).`, "posted");
    },
  },
  {
    action: "slack_react", risk: "safe", label: "Reacting in Slack",
    description: "Add an emoji reaction to a message.",
    schema: obj({ channel: str("Channel id or #name"), ts: str("The message's ts"), emoji: str("Emoji name, e.g. thumbsup or eyes") }, ["channel", "ts", "emoji"]),
    async run(acc, a) {
      const channel = await slackChannelId(acc, a.channel);
      // reactions.add (https://docs.slack.dev/reference/methods/reactions.add/).
      await slack(acc, "reactions.add", { channel, timestamp: String(a.ts), name: String(a.emoji).replace(/:/g, "").trim() }, true);
      return out("Reaction added.", `:${String(a.emoji).replace(/:/g, "")}:`);
    },
  },
];

const BY_APP: Record<NativeAppId, NativeToolDef[]> = { gmail: MAIL, outlook: [...MAIL, ...CALENDAR], gcalendar: CALENDAR, gdrive: DRIVE, slack: SLACK, searchconsole: SEARCH_CONSOLE };
export const toolsOfApp = (app: NativeAppId) => BY_APP[app] ?? [];

export interface NativeToolEntry { spec: ToolSpec; accountId: string; accountName: string; action: string; risk: Risk; label: string }
export const toolName = (acc: { app: string; label: string }, action: string) => `${acc.app}_${labelKey(acc.label) || "main"}__${action}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** The tools of every signed-in account of this user. */
export function nativeToolsFor(userId: string): NativeToolEntry[] {
  const out: NativeToolEntry[] = [];
  for (const acc of accounts.ready(userId)) {
    for (const t of toolsOfApp(acc.app)) {
      out.push({
        spec: { name: toolName(acc, t.action), description: `[${acc.name}${acc.identity ? ` · ${acc.identity}` : ""}] ${t.description}`, inputSchema: t.schema },
        accountId: acc.id, accountName: acc.name, action: t.action, risk: t.risk, label: t.label,
      });
    }
  }
  return out;
}

export async function runNativeTool(accountId: string, action: string, args: Record<string, any>, ctx: Ctx): Promise<{ text: string; summary: string }> {
  const acc = accounts.byId(accountId);
  if (!acc) throw new Error("this account was disconnected");
  const def = toolsOfApp(acc.app).find((t) => t.action === action);
  if (!def) throw new Error(`there is no ${action} for ${acc.name}`);
  const owner = bots.byId(ctx.botId)?.userId;
  try { return await def.run(acc, args, { ...ctx, locale: ctx.locale ?? (owner ? users.localeOf(owner) : "en") }); }
  // The original error rides along as the cause: whether the request may have reached the vendor matters (executions.ts).
  catch (err) { throw new Error(fetchProblem(err) ?? (err as Error).message, { cause: err }); }
}
