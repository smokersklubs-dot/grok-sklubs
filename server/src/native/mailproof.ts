import { createHash } from "node:crypto";
import { tr } from "../i18n.js";
import { audit, bots, rows, users } from "../store.js";

/**
 * L29 — what leaves is exactly what the owner approved (ECC audit).
 *
 * 1. The fingerprint: sha256 of the recipients (lower case, sorted), the subject and the body (line ends and trailing
 *    spaces evened out), cut to 16 hex characters. The tool's arguments ARE the approved action (the approval is bound to
 *    their hash, executions.ts), so the fingerprint of the approved text is taken from them; it is compared with the
 *    message as really built for the wire (Gmail: the RFC 822 message decoded back; the bot's own address: what is handed
 *    to the SMTP library after its size limits). Different: nothing is sent.
 * 2. Afterwards, the mail is looked for where the mailbox keeps what it sent, and compared again:
 *    - Gmail: users.messages.get on the id that users.messages.send returned, format=full — it must carry the SENT label
 *      and the same text (https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get);
 *    - Outlook: the well-known "sentitems" folder (https://learn.microsoft.com/en-us/graph/api/resources/mailfolder),
 *      latest messages (https://learn.microsoft.com/en-us/graph/api/user-list-messages, $orderby sentDateTime desc), the
 *      one with the same subject and recipients, whose body must contain the approved text (Outlook may add a signature
 *      or, for a reply, the quoted mail). sendMail saves it there with saveToSentItems, a moment later: three looks.
 *    Not found, or different: the owner is told in the bot's chat (and the audit log), the bot's result says so.
 */
export interface MailText { to: string[]; subject: string; body: string }
export type ProofState = "verified" | "differs" | "missing" | "unchecked";
export interface Proof { state: ProofState; fingerprint: string; sentFingerprint?: string; detail?: string }

export const normBody = (s: string) => String(s ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
const normAddr = (a: string) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase();

export function mailFingerprint(m: MailText): string {
  const canon = JSON.stringify([[...new Set(m.to.map(normAddr).filter(Boolean))].sort(), String(m.subject ?? "").trim(), normBody(m.body)]);
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

/** "=?UTF-8?B?…?=" words of a header, decoded. */
const decodeWords = (s: string) => s.replace(/=\?utf-8\?b\?([^?]*)\?=/gi, (_m, b) => Buffer.from(b, "base64").toString("utf8"));

/** The subject, recipients and text of a plain-text RFC 822 message (base64url, as given to users.messages.send). */
export function readRaw(rawB64url: string): MailText | null {
  const src = Buffer.from(rawB64url, "base64url").toString("utf8");
  const cut = src.indexOf("\r\n\r\n");
  if (cut < 0) return null;
  const headers = src.slice(0, cut).split("\r\n");
  const get = (n: string) => headers.find((h) => h.toLowerCase().startsWith(`${n.toLowerCase()}:`))?.slice(n.length + 1).trim() ?? "";
  const encoding = get("Content-Transfer-Encoding").toLowerCase();
  const raw = src.slice(cut + 4);
  const body = encoding === "base64" ? Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8") : raw;
  return { to: get("To").split(",").map((s) => s.trim()).filter(Boolean), subject: decodeWords(get("Subject")), body };
}

/** Text/plain bodies of a Gmail message resource (format=full: a MIME tree with base64url bodies). */
function gmailText(part: any): string {
  if (!part) return "";
  if (String(part.mimeType ?? "").startsWith("text/plain") && part.body?.data) return Buffer.from(String(part.body.data), "base64url").toString("utf8");
  for (const p of part.parts ?? []) { const t = gmailText(p); if (t) return t; }
  return "";
}

type Get = (url: string, headers?: Record<string, string>) => Promise<{ status: number; json: any }>;

/** After users.messages.send: the message `id` must be in the mailbox, labelled SENT, with the approved text. */
export async function proveGmailSent(get: Get, url: (path: string) => string, id: string, approved: MailText): Promise<Proof> {
  const fingerprint = mailFingerprint(approved);
  if (!id) return { state: "unchecked", fingerprint, detail: "no message id" };
  try {
    const r = await get(url(`/messages/${encodeURIComponent(id)}?format=full`));
    if (r.status === 404) return { state: "missing", fingerprint };
    if (r.status >= 400) return { state: "unchecked", fingerprint, detail: `HTTP ${r.status}` };
    const labels: string[] = Array.isArray(r.json?.labelIds) ? r.json.labelIds : [];
    if (!labels.includes("SENT")) return { state: "missing", fingerprint, detail: "not labelled SENT" };
    const body = gmailText(r.json?.payload);
    const same = normBody(body) === normBody(approved.body) || normBody(body).startsWith(normBody(approved.body));
    return same ? { state: "verified", fingerprint } : { state: "differs", fingerprint, sentFingerprint: mailFingerprint({ ...approved, body }) };
  } catch (err) { return { state: "unchecked", fingerprint, detail: (err as Error).message }; }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const proofWaitMs = () => Number(process.env.MAIL_PROOF_WAIT_MS ?? 1500);

/** After sendMail (saveToSentItems): the newest mails of "sentitems" with the same subject and recipients. */
export async function proveOutlookSent(get: Get, url: (path: string) => string, approved: MailText, tries = 3): Promise<Proof> {
  const fingerprint = mailFingerprint(approved);
  const want = [...new Set(approved.to.map(normAddr))];
  const qs = new URLSearchParams({ $top: "10", $orderby: "sentDateTime desc", $select: "subject,toRecipients,body,sentDateTime" });
  for (let i = 0; i < tries; i++) {
    if (i) await wait(proofWaitMs());
    try {
      // Prefer: outlook.body-content-type="text" returns bodies as text (https://learn.microsoft.com/en-us/graph/api/message-get).
      const r = await get(url(`/mailFolders/sentitems/messages?${qs}`), { prefer: 'outlook.body-content-type="text"' });
      if (r.status >= 400) return { state: "unchecked", fingerprint, detail: `HTTP ${r.status}` };
      const list: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
      const hit = list.find((m) => String(m.subject ?? "").trim() === approved.subject.trim() && want.every((w) => (m.toRecipients ?? []).some((x: any) => normAddr(String(x?.emailAddress?.address ?? "")) === w)));
      if (!hit) continue;
      const body = String(hit.body?.content ?? "");
      return normBody(body).includes(normBody(approved.body)) ? { state: "verified", fingerprint } : { state: "differs", fingerprint, sentFingerprint: mailFingerprint({ ...approved, body }) };
    } catch (err) { return { state: "unchecked", fingerprint, detail: (err as Error).message }; }
  }
  return { state: "missing", fingerprint };
}

/** The line for the bot's result, and — when it did not check out — a notice in its chat and an audit line for the owner. */
export function reportProof(botId: string, account: string, proof: Proof): string {
  if (proof.state === "verified") return ` Checked afterwards: it is in the mailbox's sent mail, with exactly the approved text (fingerprint ${proof.fingerprint}).`;
  if (proof.state === "unchecked") return ` It could not be checked in the sent mail afterwards (${proof.detail ?? "no answer"}); fingerprint of the approved text: ${proof.fingerprint}.`;
  const bot = bots.byId(botId);
  if (bot) {
    const loc = users.localeOf(bot.userId);
    const text = proof.state === "missing"
      ? tr(loc, "Email check: the email {bot} sent from {account} is not in its sent mail. Look in the mailbox before sending it again (fingerprint {fp}).", { bot: bot.name, account, fp: proof.fingerprint })
      : tr(loc, "Email check: the email {bot} sent from {account} is not exactly the approved text (approved {fp}, sent {sent}). Look at it in the sent mail.", { bot: bot.name, account, fp: proof.fingerprint, sent: proof.sentFingerprint ?? "?" });
    rows.append(bot, { kind: "notice", tone: "warn", text });
    audit(bot.userId, "apps", `${bot.name}: email check ${proof.state} (${account}, ${proof.fingerprint})`, bot.id);
  }
  return proof.state === "missing"
    ? ` WARNING: it is not in the mailbox's sent mail (fingerprint ${proof.fingerprint}). The owner was told. Do not send it again before they have looked.`
    : ` WARNING: the copy in the sent mail differs from the approved text (approved ${proof.fingerprint}, sent ${proof.sentFingerprint}). The owner was told.`;
}
