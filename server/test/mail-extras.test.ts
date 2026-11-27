import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L83 (second part): drafts and sends with files of the bot's library, blind copies and the owner's signature, for
// Gmail and Outlook; the proof that the wire message is the approved text still holds with files.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-mailx-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";

const seen: { method: string; path: string; body: any }[] = [];
const server = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const p = (req.url ?? "").split("?")[0];
    const body = data ? JSON.parse(data) : null;
    seen.push({ method: req.method ?? "", path: p, body });
    const json = (v: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (p === "/gmail/v1/users/me/drafts") return json({ id: "draft_1" });
    if (p === "/gmail/v1/users/me/messages/send") return json({ id: "sent_1", threadId: "t1" });
    if (p.startsWith("/gmail/v1/users/me/messages/sent_1")) return json({ id: "sent_1", labelIds: ["SENT"], payload: { headers: [], mimeType: "text/plain", body: { data: "" } } });
    if (p === "/v1.0/me/sendMail" || p === "/v1.0/me/messages") { res.writeHead(p.endsWith("sendMail") ? 202 : 201, { "content-type": "application/json" }); return res.end(p.endsWith("sendMail") ? "" : JSON.stringify({ id: "o_draft" })); }
    json({ value: [] });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.GOOGLE_API_URL = base;
process.env.MICROSOFT_API_URL = base;
after(() => server.close());

const { q } = await import("../src/db.js");
const { seal } = await import("../src/auth.js");
const { bots, users } = await import("../src/store.js");
const { workspaceOf } = await import("../src/computer.js");
const { accounts } = await import("../src/native/accounts.js");
const { toolsOfApp } = await import("../src/native/tools.js");
const mx = await import("../src/native/mailextras.js");
const { readRaw, mailFingerprint } = await import("../src/native/mailproof.js");

const user = users.create("mailx@example.com", "Léa", "x", "fr");
const bot = bots.create(user.id, { name: "Postier", autonomy: "balanced" });
const ready = (app: "gmail" | "outlook") => {
  const acc = accounts.create(user.id, app, app === "gmail" ? "perso" : "pro");
  q.run("UPDATE native_accounts SET status = 'ready', identity = ?, tokens_enc = ? WHERE id = ?", "lea@example.com", seal(JSON.stringify({ access: "fake-access-token", expiresAt: Date.now() + 3600_000 })), acc.id);
  return accounts.owned(user.id, acc.id)!;
};
const gmail = ready("gmail"), outlook = ready("outlook");
const run = (app: "gmail" | "outlook", action: string, args: Record<string, unknown>) => toolsOfApp(app).find((t) => t.action === action)!.run(app === "gmail" ? gmail : outlook, args, { botId: bot.id, locale: "fr" });
mkdirSync(path.join(workspaceOf(bot.id), "reports"), { recursive: true });
writeFileSync(path.join(workspaceOf(bot.id), "reports", "juin.pdf"), Buffer.from("%PDF-1.4 fake pdf for tests"));
writeFileSync(path.join(workspaceOf(bot.id), "big.bin"), Buffer.alloc(3 * 1024 * 1024 + 10));
const last = (p: string) => [...seen].reverse().find((s) => s.path === p)!;

test("L83: a message with a file is multipart; its text, recipients and subject read back the same (proof holds)", () => {
  const files = mx.attachmentsOf(bot.id, ["reports/juin.pdf"]);
  assert.deepEqual(files.map((f) => [f.name, f.mime]), [["juin.pdf", "application/pdf"]]);
  const raw = mx.mimeMessage({ to: ["marc@example.com"], cc: [], bcc: ["boss@example.com"], subject: "Rapport été", body: "Bonjour Marc,\nci-joint.", attachments: files });
  const src = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(src, /^Bcc: boss@example\.com\r$/m);
  assert.match(src, /Content-Type: multipart\/mixed; boundary="sklubot-[0-9a-f]+"/);
  assert.match(src, /Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
  const back = readRaw(raw)!;
  assert.equal(back.body, "Bonjour Marc,\nci-joint.");
  assert.equal(back.subject, "Rapport été");
  assert.equal(mailFingerprint(back), mailFingerprint({ to: ["marc@example.com"], subject: "Rapport été", body: "Bonjour Marc,\nci-joint." }));
});

test("L83: files outside the library, missing, too many or too big are refused in plain words", () => {
  assert.throws(() => mx.attachmentsOf(bot.id, ["../secret.txt"]), /not a file of your library/);
  assert.throws(() => mx.attachmentsOf(bot.id, ["nope.pdf"]), /no file "nope\.pdf" in your library/);
  assert.throws(() => mx.attachmentsOf(bot.id, Array(11).fill("reports/juin.pdf")), /10 files at most/);
  assert.throws(() => mx.attachmentsOf(bot.id, ["big.bin"]), /3 MB in all/);
  assert.deepEqual(mx.attachmentsOf(bot.id, "~/files/reports/juin.pdf").map((f) => f.name), ["juin.pdf"], "a ~/files path works");
});

test("L83: the owner's signature is added once at the end (unless signature: false), and only by its owner", () => {
  assert.equal(mx.setSignature(user.id, gmail.id, "Léa Martin\r\nSklubs"), "Léa Martin\nSklubs");
  assert.equal(mx.withSignature("Bonjour.", gmail.id, undefined), "Bonjour.\n\n-- \nLéa Martin\nSklubs");
  assert.equal(mx.withSignature("Bonjour.\n\n-- \nLéa Martin\nSklubs", gmail.id, true), "Bonjour.\n\n-- \nLéa Martin\nSklubs", "not twice");
  assert.equal(mx.withSignature("Bonjour.", gmail.id, false), "Bonjour.");
  assert.throws(() => mx.setSignature(user.id, gmail.id, "x".repeat(2001)), /2000 characters/);
  const other = users.create("other@example.com", "Other", "x", "en");
  mx.setSignature(other.id, gmail.id, "Pirate");
  assert.equal(mx.signatureOf(gmail.id), "Léa Martin\nSklubs", "another account cannot overwrite it");
});

test("L83: Gmail — send with a file, a Bcc and the signature; the wire text is the approved text with the signature", async () => {
  const r = await run("gmail", "mail_send", { to: "marc@example.com", subject: "Rapport", body: "Bonjour Marc.", bcc: "boss@example.com", attachments: ["reports/juin.pdf"] });
  assert.match(r.text, /^Sent \(id sent_1\) to marc@example\.com: Rapport \(attached: juin\.pdf · Bcc: boss@example\.com · signature added\)\./);
  const wire = Buffer.from(last("/gmail/v1/users/me/messages/send").body.raw, "base64url").toString("utf8");
  assert.match(wire, /^Bcc: boss@example\.com\r$/m);
  assert.equal(readRaw(last("/gmail/v1/users/me/messages/send").body.raw)!.body, "Bonjour Marc.\n\n-- \nLéa Martin\nSklubs");
  const d = await run("gmail", "mail_draft", { to: "marc@example.com", subject: "Brouillon", body: "Texte.", signature: false });
  assert.match(d.text, /^Draft saved \(id draft_1\) to marc@example\.com: Brouillon$/, "no extras: nothing added");
  await assert.rejects(run("gmail", "mail_send", { to: "marc@example.com", subject: "x", body: "y", bcc: "not an address" }), /is not an email address/);
});

test("L83: Outlook — files and blind copies go in the message (fileAttachment, bccRecipients); a reply with files is refused clearly", async () => {
  mx.setSignature(user.id, outlook.id, "L. M.");
  const r = await run("outlook", "mail_send", { to: "marc@example.com", subject: "Rapport", body: "Bonjour.", bcc: ["boss@example.com"], attachments: "reports/juin.pdf" });
  assert.match(r.text, /^Sent to marc@example\.com \(attached: juin\.pdf · Bcc: boss@example\.com · signature added\)\./);
  const m = last("/v1.0/me/sendMail").body.message;
  assert.deepEqual(m.bccRecipients, [{ emailAddress: { address: "boss@example.com" } }]);
  assert.equal(m.attachments[0]["@odata.type"], "#microsoft.graph.fileAttachment");
  assert.equal(m.attachments[0].name, "juin.pdf");
  assert.equal(Buffer.from(m.attachments[0].contentBytes, "base64").toString(), "%PDF-1.4 fake pdf for tests");
  assert.equal(m.body.content, "Bonjour.\n\n-- \nL. M.");
  await assert.rejects(run("outlook", "mail_send", { reply_to_id: "m1", body: "ok", attachments: ["reports/juin.pdf"] }), /attachments and Bcc work on a new email/);
});
