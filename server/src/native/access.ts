import { tr } from "../i18n.js";
import type { Locale } from "../shared.js";
import { accounts, callApi, type AccountRecord } from "./accounts.js";
import { vendorUrl } from "./vendors.js";

/**
 * Emails that grant access to an account (spec 07 A11) — one-time codes, magic sign-in links, password resets,
 * temporary passwords, backup codes, API keys — are kept from the model: in normal mail reads their subject stays but
 * their body is replaced by a short notice. A plain receipt or an alert without a code stays visible. The check is
 * deterministic (keywords and a code-like token), so there is no "check failed" case to handle.
 *
 * When a site sends a sign-in code by email, the bot asks for it with email_code_type: the server finds the mail in the
 * connected mailbox (sender, time, a code in it) and types the code on the bot's screen. The model never sees it.
 */

const ACCESS_WORDS = [
  // French
  "code de verification", "code de vérification", "code de confirmation", "code de connexion", "code d'acces", "code d'accès", "code de securite", "code de sécurité", "code a usage unique", "code à usage unique",
  "mot de passe temporaire", "mot de passe provisoire", "reinitialiser votre mot de passe", "réinitialiser votre mot de passe", "reinitialisation du mot de passe", "réinitialisation du mot de passe", "réinitialisation de mot de passe",
  "lien de connexion", "lien magique", "connectez-vous en cliquant", "codes de secours", "codes de récupération", "cle api", "clé api", "clé d'api", "double authentification",
  // English
  "verification code", "confirmation code", "security code", "login code", "sign-in code", "sign in code", "one-time code", "one time code", "one-time password", "otp", "passcode", "2fa", "two-factor",
  "reset your password", "password reset", "temporary password", "magic link", "sign in link", "sign-in link", "login link", "log in to your account", "backup codes", "recovery codes", "api key", "access token",
];
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const WORDS = [...new Set(ACCESS_WORDS.map(norm))];

/** A token that looks like a one-time code: 4 to 8 digits (possibly split by a space or dash), or a short upper-case code with digits. */
const CODE = /(?<![\w/])(\d{3}[ -]?\d{3}|\d{4,8}|[A-Z]{1,3}-\d{4,8}|(?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})(?![\w/])/;

export function isAccessEmail(subject: string, body: string): boolean {
  const text = norm(`${subject}\n${body}`);
  return WORDS.some((w) => (w.length <= 4 ? new RegExp(`\\b${w}\\b`).test(text) : text.includes(w)));
}

export const maskedBody = (loc: Locale) => tr(loc, "[content hidden: account access]");

/** The body as the model may see it: masked when the email grants account access. */
export const maskIfAccess = (subject: string, body: string, loc: Locale) => (isAccessEmail(subject, body) ? maskedBody(loc) : body);

/** The code in an access email: the code-like token closest after a "code" keyword, else the first one. Null: none. */
export function extractCode(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;
  const lower = norm(text);
  const at = Math.max(0, ...["code", "otp", "passcode", "mot de passe"].map((k) => lower.indexOf(k)).filter((i) => i >= 0).map((i) => i));
  const after = text.slice(at);
  const m = CODE.exec(after) ?? CODE.exec(text);
  return m ? m[1].replace(/[ -](?=\d)/g, "") : null;
}

// ── Finding a code in the mailbox ───────────────────────────────────────────
const header = (m: any, name: string) => String((m?.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "");
function gmailText(part: any): string {
  const decode = (d: string) => Buffer.from(d, "base64url").toString("utf8");
  const walk = (p: any, type: string): string | null => {
    if (!p) return null;
    if (p.mimeType === type && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) { const t = walk(c, type); if (t) return t; }
    return null;
  };
  return walk(part, "text/plain") ?? (walk(part, "text/html") ?? (part?.body?.data ? decode(part.body.data) : "")).replace(/<[^>]+>/g, " ");
}

export interface FoundCode { code: string; from: string; subject: string; at: number; account: string }

/** Recent messages (newest first) of a mailbox, with their full text, received after `since`. */
async function recentMail(acc: AccountRecord, since: number): Promise<{ from: string; subject: string; body: string; at: number }[]> {
  if (acc.app === "gmail") {
    // users.messages.list with Gmail search (newer_than) then users.messages.get format=full
    // (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list, .../get).
    const list = await callApi(acc, "GET", vendorUrl("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent("newer_than:1d")}`));
    if (list.status >= 400) throw new Error(`the mailbox answered ${list.status}`);
    const out = [];
    for (const { id } of (list.json?.messages ?? []).slice(0, 10)) {
      const m = await callApi(acc, "GET", vendorUrl("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`));
      if (m.status >= 400) continue;
      const at = Number(m.json?.internalDate) || Date.parse(header(m.json, "Date")) || 0;
      if (at < since) continue;
      out.push({ from: header(m.json, "From"), subject: header(m.json, "Subject"), body: gmailText(m.json?.payload), at });
    }
    return out.sort((a, b) => b.at - a.at);
  }
  // Microsoft Graph: inbox messages newest first, bodies as text (https://learn.microsoft.com/en-us/graph/api/user-list-messages).
  const url = vendorUrl("microsoft", `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime%20desc&$select=subject,from,receivedDateTime,body`);
  const r = await callApi(acc, "GET", url, { headers: { prefer: 'outlook.body-content-type="text"' } });
  if (r.status >= 400) throw new Error(`the mailbox answered ${r.status}`);
  return (r.json?.value ?? []).map((m: any) => ({ from: `${m.from?.emailAddress?.name ?? ""} <${m.from?.emailAddress?.address ?? ""}>`, subject: String(m.subject ?? ""), body: String(m.body?.content ?? ""), at: Date.parse(m.receivedDateTime) || 0 }))
    .filter((m: { at: number }) => m.at >= since);
}

/** The mailboxes a code can be fetched from: ready Gmail and Outlook accounts, the named one first. */
export function mailAccounts(userId: string, name = ""): AccountRecord[] {
  const all = accounts.ready(userId).filter((a) => a.app === "gmail" || a.app === "outlook");
  const want = name.trim().toLowerCase();
  return want ? all.filter((a) => a.name.toLowerCase().includes(want) || a.label.toLowerCase() === want) : all;
}

/** Whether a sender matches the site or the hint ("noreply@accounts.example.com" matches "example.com"). */
export function senderMatches(from: string, site: string, hint: string): boolean {
  const f = from.toLowerCase();
  if (hint.trim() && f.includes(hint.trim().toLowerCase())) return true;
  const host = site.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!host) return !hint.trim();
  const domain = /@([^>\s]+)/.exec(f)?.[1] ?? "";
  const base = host.split(".").slice(-2).join(".");
  return domain === host || domain.endsWith(`.${base}`) || domain === base;
}

/**
 * Waits (polling every `everyMs`, up to `waitMs`) for an access email from the site that arrived after `since`, and
 * returns its code. Null: none came.
 */
export async function findCode(userId: string, f: { site: string; from?: string; account?: string; since: number; waitMs: number; everyMs: number; signal?: AbortSignal }): Promise<FoundCode | null> {
  const boxes = mailAccounts(userId, f.account ?? "");
  if (!boxes.length) throw new Error(f.account ? `No connected mailbox matches "${f.account}".` : "No Gmail or Outlook mailbox is connected (Settings → Apps).");
  const until = Date.now() + f.waitMs;
  for (;;) {
    for (const acc of boxes) {
      for (const m of await recentMail(acc, f.since)) {
        if (!senderMatches(m.from, f.site, f.from ?? "") || !isAccessEmail(m.subject, m.body)) continue;
        const code = extractCode(m.subject, m.body);
        if (code) return { code, from: m.from, subject: m.subject, at: m.at, account: acc.name };
      }
    }
    if (Date.now() + f.everyMs > until || f.signal?.aborted) return null;
    await new Promise((r) => setTimeout(r, f.everyMs));
  }
}

/**
 * Bodies of the user's latest sent emails (for the writing-style profile, opt-in): Gmail "in:sent", Outlook's sentitems
 * folder. Emails that grant account access are left out.
 */
export async function sentMail(userId: string, max = 15): Promise<string[]> {
  const out: string[] = [];
  for (const acc of mailAccounts(userId)) {
    if (acc.app === "gmail") {
      // users.messages.list q=in:sent, then users.messages.get format=full.
      const list = await callApi(acc, "GET", vendorUrl("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent("in:sent")}`));
      if (list.status >= 400) continue;
      for (const { id } of (list.json?.messages ?? []).slice(0, max)) {
        const m = await callApi(acc, "GET", vendorUrl("google", `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`));
        if (m.status < 400 && !isAccessEmail(header(m.json, "Subject"), gmailText(m.json?.payload))) out.push(gmailText(m.json?.payload));
      }
    } else {
      // The well-known "sentitems" folder (https://learn.microsoft.com/en-us/graph/api/resources/mailfolder).
      const r = await callApi(acc, "GET", vendorUrl("microsoft", `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=${max}&$select=subject,body`), { headers: { prefer: 'outlook.body-content-type="text"' } });
      if (r.status >= 400) continue;
      for (const m of r.json?.value ?? []) if (!isAccessEmail(String(m.subject ?? ""), String(m.body?.content ?? ""))) out.push(String(m.body?.content ?? ""));
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
