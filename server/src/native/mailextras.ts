import { randomBytes } from "node:crypto";
import { mimeOf, readLibraryFile } from "../computer.js";
import { q } from "../db.js";
import { clip } from "../store.js";

/**
 * L83 (second part) — email drafts and sends with attachments, Bcc and a signature (Rakazo and Hermes audits; our own
 * code). For Gmail and Outlook (native/tools.ts mail_draft, mail_draft_update, mail_send):
 *  - attachments: files of the bot's library (paths like reports/june.pdf), 10 at most, 3 MB in all (Outlook's limit for
 *    attachments sent inside the message: https://learn.microsoft.com/en-us/graph/api/resources/fileattachment — larger
 *    ones need an upload session, not done here; the bot is told to share a link instead). Read through the library's
 *    own checks (readLibraryFile: no "..", no link out of the folder). The approval card lists their names: the owner
 *    sees what leaves.
 *  - bcc: blind copies. Gmail: a "Bcc:" header in the raw message, which Gmail delivers to and removes from what the
 *    other recipients get (https://developers.google.com/workspace/gmail/api/guides/sending). Outlook: bccRecipients
 *    (https://learn.microsoft.com/en-us/graph/api/resources/message).
 *  - signature: the owner's own text for each mail account (Settings → Apps, under the account), added at the end of
 *    the body as "-- " then the signature (the usual separator, RFC 3676 §4.3) unless the bot passes signature: false.
 *    The proof that what was sent is what was approved (mailproof.ts) compares the text WITH the signature: the owner's
 *    saved words are part of the approved message.
 */
q.run(`CREATE TABLE IF NOT EXISTS mail_signatures (account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL)`);

export const MAX_SIGNATURE = 2000;
export const MAX_ATTACH_FILES = 10;
export const MAX_ATTACH_BYTES = 3 * 1024 * 1024;

export const signatureOf = (accountId: string): string => q.get<{ text: string }>("SELECT text FROM mail_signatures WHERE account_id = ?", accountId)?.text ?? "";
/** Saves (or clears with "") the owner's signature of one of their mail accounts. */
export function setSignature(userId: string, accountId: string, text: unknown): string {
  const v = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (v.length > MAX_SIGNATURE) throw new Error(`A signature has ${MAX_SIGNATURE} characters at most.`);
  if (!v) q.run("DELETE FROM mail_signatures WHERE account_id = ? AND user_id = ?", accountId, userId);
  else q.run("INSERT INTO mail_signatures (account_id, user_id, text) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET text = excluded.text WHERE user_id = excluded.user_id", accountId, userId, v);
  return signatureOf(accountId);
}
/** The body as sent: with the account's signature at the end (once), unless `use` is false. */
export function withSignature(body: string, accountId: string, use: unknown): string {
  const sig = use === false ? "" : signatureOf(accountId);
  if (!sig || body.trimEnd().endsWith(sig)) return body;
  return `${body.trimEnd()}\n\n-- \n${sig}`;
}

export interface Attachment { name: string; mime: string; data: Buffer }
/** The files of the bot's library to attach; throws a plain sentence the bot can act on. */
export function attachmentsOf(botId: string, v: unknown): Attachment[] {
  const list = (Array.isArray(v) ? v.map(String) : v ? String(v).split(",") : []).map((s) => s.trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "")).filter(Boolean);
  if (list.length > MAX_ATTACH_FILES) throw new Error(`attach ${MAX_ATTACH_FILES} files at most`);
  let total = 0;
  return list.map((rel) => {
    if (rel.split("/").includes("..")) throw new Error(`"${clip(rel, 60)}" is not a file of your library`);
    let data: Buffer;
    try { data = readLibraryFile(botId, rel); } catch { throw new Error(`no file "${clip(rel, 80)}" in your library (attachments come from your files folder)`); }
    total += data.length;
    if (total > MAX_ATTACH_BYTES) throw new Error("attachments are limited to 3 MB in all: put bigger files on a shared link instead");
    return { name: rel.split("/").pop() || "file", mime: mimeOf(rel), data };
  });
}

const b64 = (s: string | Buffer) => (typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64");
const wrap = (s: string) => s.replace(/.{76}/g, "$&\r\n");
/** A header value with only safe characters (a file name: RFC 2047 encoded-word). */
const word = (s: string) => `=?UTF-8?B?${b64(s.replace(/[\r\n"]/g, " "))}?=`;

/** An RFC 5322 message, UTF-8, for users.drafts.create / users.messages.send (`raw`, base64url); multipart with files. */
export function mimeMessage(f: { to: string[]; cc: string[]; bcc?: string[]; subject: string; body: string; inReplyTo?: string; references?: string; attachments?: Attachment[] }): string {
  const head = [
    `To: ${f.to.join(", ")}`, ...(f.cc.length ? [`Cc: ${f.cc.join(", ")}`] : []), ...(f.bcc?.length ? [`Bcc: ${f.bcc.join(", ")}`] : []),
    `Subject: =?UTF-8?B?${b64(f.subject)}?=`, "MIME-Version: 1.0",
    ...(f.inReplyTo ? [`In-Reply-To: ${f.inReplyTo}`, `References: ${[f.references, f.inReplyTo].filter(Boolean).join(" ")}`] : []),
  ];
  const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  if (!f.attachments?.length) return Buffer.from(`${[...head, ...text].join("\r\n")}\r\n\r\n${wrap(b64(f.body))}`, "utf8").toString("base64url");
  const boundary = `sklubot-${randomBytes(12).toString("hex")}`;
  const parts = [
    `${text.join("\r\n")}\r\n\r\n${wrap(b64(f.body))}`,
    ...f.attachments.map((a) => `Content-Type: ${a.mime}; name="${word(a.name)}"\r\nContent-Disposition: attachment; filename="${word(a.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(a.data))}`),
  ];
  return Buffer.from(`${[...head, `Content-Type: multipart/mixed; boundary="${boundary}"`].join("\r\n")}\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--\r\n`, "utf8").toString("base64url");
}

/** Outlook message fields for files and blind copies (fileAttachment: name, contentType, contentBytes in base64). */
export const outlookExtras = (attachments: Attachment[], bcc: string[]) => ({
  ...(attachments.length ? { attachments: attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.mime, contentBytes: b64(a.data) })) } : {}),
  ...(bcc.length ? { bccRecipients: bcc.map((address) => ({ emailAddress: { address } })) } : {}),
});

/** One line for the tool's answer: what went with the message. */
export const extrasLine = (attachments: Attachment[], bcc: string[], signed: boolean) =>
  [attachments.length ? `attached: ${attachments.map((a) => a.name).join(", ")}` : "", bcc.length ? `Bcc: ${bcc.join(", ")}` : "", signed ? "signature added" : ""].filter(Boolean).join(" · ");
