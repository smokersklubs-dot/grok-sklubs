import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L31: « Signaler cette réponse » (reports.ts). The owner of a bot reports one of its replies with a reason and a note;
// the report keeps a masked copy of the reply and of the messages before it; the server's owner sees it on the
// Surveillance side (GET /reports) and marks it handled; nobody else sees it; only a finished bot reply can be reported.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-reports-"));
process.env.SESSION_SECRET = "reports-secret-reports-secret-reports-0";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { rows, bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { maskForReport } = await import("../src/reports.js");

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "owner" | "member" = "owner") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "member@example.com", name: "Member", password: "password-1", locale: "en" }, "member");
const ownerBot = bots.byId((await call("GET", "/bots")).json.bots[0].id)!;
const memberBot = bots.byId((await call("GET", "/bots", undefined, "member")).json.bots[0].id)!;

test("the masked copy hides secrets, e-mails, phones, card numbers and address paths", () => {
  const out = maskForReport("Écris à jean.dupont@example.com ou au 06 12 34 56 78, carte 4111 1111 1111 1111, clé sk-ant-api03-fakefakefakefakefakefakefakefake, lien https://shop.example.com/order/12345?token=abc");
  assert.ok(!out.includes("jean.dupont"));
  assert.ok(!out.includes("06 12 34 56 78"));
  assert.ok(!out.includes("4111 1111"));
  assert.ok(!out.includes("sk-ant-api03"));
  assert.ok(!out.includes("token=abc"));
  assert.match(out, /https:\/\/shop\.example\.com\/…/);
  assert.match(out, /\[e-mail\]/);
});

test("a member reports a reply of their bot; the server owner sees it masked, with context, and marks it handled", async () => {
  const u = rows.append(memberBot, { kind: "message", role: "user", text: "Mon mail est marie@example.org, aide-moi" });
  const reply = rows.append(memberBot, { kind: "message", role: "assistant", text: "Voici une réponse fausse pour marie@example.org." });
  assert.ok(u.seq < reply.seq);

  // Only a finished bot reply; a reason from the list; the bot must be the caller's own.
  assert.equal((await call("POST", `/bots/${memberBot.id}/rows/${u.seq}/report`, { reason: "wrong" }, "member")).status, 400);
  assert.equal((await call("POST", `/bots/${memberBot.id}/rows/${reply.seq}/report`, { reason: "nope" }, "member")).status, 400);
  assert.equal((await call("POST", `/bots/${memberBot.id}/rows/${reply.seq}/report`, { reason: "wrong" }, "owner")).status, 404);
  const filed = await call("POST", `/bots/${memberBot.id}/rows/${reply.seq}/report`, { reason: "wrong", note: "Elle invente. Rappelle-moi au 0612345678" }, "member");
  assert.equal(filed.status, 200);
  assert.ok(filed.json.reportId);

  // Only the server's owner (and hosted operators) can read reports; a member gets 404.
  assert.equal((await call("GET", "/reports", undefined, "member")).status, 404);
  assert.equal((await call("POST", `/reports/${filed.json.reportId}/done`, { done: true }, "member")).status, 404);
  const list = (await call("GET", "/reports")).json;
  assert.equal(list.open, 1);
  const r = list.reports[0];
  assert.equal(r.reason, "wrong");
  assert.equal(r.status, "open");
  assert.match(r.account, /member@example\.com/);
  assert.ok(!JSON.stringify(r).includes("marie@example.org"), "the reply and its context are masked");
  assert.ok(!r.note.includes("0612345678"), "the note is masked too");
  assert.equal(r.context.length, 1);
  assert.equal(r.context[0].who, "user");
  assert.match(r.text, /Voici une réponse fausse/);

  // Reporting the same reply again updates the one report.
  await call("POST", `/bots/${memberBot.id}/rows/${reply.seq}/report`, { reason: "harmful" }, "member");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM message_reports")!.n, 1);
  const done = await call("POST", `/reports/${filed.json.reportId}/done`, { done: true });
  assert.equal(done.json.open, 0);
  assert.equal(done.json.reports[0].status, "done");
  assert.equal(done.json.reports[0].reason, "harmful");
  assert.equal((await call("POST", "/reports/not-a-report/done", { done: true })).status, 404);
  // The owner may report their own bot's replies too.
  const own = rows.append(ownerBot, { kind: "message", role: "assistant", text: "Réponse du bot du propriétaire." });
  assert.equal((await call("POST", `/bots/${ownerBot.id}/rows/${own.seq}/report`, { reason: "other" })).status, 200);
  assert.equal((await call("GET", "/reports")).json.open, 1);
});
