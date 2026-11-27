import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L137 (agent/turnknow.ts): « ce que le bot savait quand il a décidé » (a snapshot of the instructions' parts and of the
// notes shown, kept for each real turn, not for the preview, not twice when identical) and « Pourquoi ? » on a journal line.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l137-"));
process.env.SESSION_SECRET = "l137-secret-l137-secret-l137-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { promptView } = await import("../src/agent/promptview.js");
const { digestPrompt, knowledgeAt, KEEP_PER_BOT, noteKnowledge } = await import("../src/agent/turnknow.js");
const { addJournal } = await import("../src/journal.js");
const { bots, users, memories, rows } = await import("../src/store.js");
const { q } = await import("../src/db.js");

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("a", "POST", "/auth/signup", { email: "l137-a@example.com", name: "Léa", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "l137-b@example.com", name: "Bob", password: "password-1", locale: "fr" });
const owner = users.byEmail("l137-a@example.com")!;
const bot = bots.byId((await call("a", "POST", "/bots", { name: "Raison" })).json.bot.id)!;
const extras = { connectorNames: [], browser: false, shell: false };
const count = () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM turn_knowledge WHERE bot_id = ?", bot.id)!.n;

test("L137 digest: parts in order with their size, and the note lines of « What you remember »", () => {
  const d = digestPrompt("Tu es X.\n\n## Rules\n- a\n\n## What you remember\n(dates)\n- Léa préfère le thé (2026-11-01)\n- Le client Dupont paie à 30 jours");
  assert.deepEqual(d.parts.map((p) => p.title), ["Who the bot is", "Rules", "What you remember"]);
  assert.equal(d.parts[1].chars, "## Rules\n- a".length);
  assert.deepEqual(d.notes, ["Léa préfère le thé (2026-11-01)", "Le client Dupont paie à 30 jours"]);
});

test("L137 snapshot: written for a real turn, not again when identical, never for the preview", () => {
  memories.add(bot.id, "Léa veut les devis en PDF.", "chat");
  const before = count();
  buildSystemPrompt(bots.byId(bot.id)!, owner, extras);
  assert.equal(count(), before + 1);
  buildSystemPrompt(bots.byId(bot.id)!, owner, extras);
  assert.equal(count(), before + 1, "identical: not written twice");
  promptView(bots.byId(bot.id)!, owner);
  assert.equal(count(), before + 1, "the read-only preview keeps nothing");
  const snap = knowledgeAt(bot.id, Date.now())!;
  assert.ok(snap.notes.some((n) => /devis en PDF/.test(n)));
  assert.ok(snap.parts.some((p) => p.title === "What you remember"));
  assert.equal(knowledgeAt(bot.id, 1), null, "nothing before the first turn");
});

test("L137 snapshots are capped per bot", () => {
  for (let i = 0; i < KEEP_PER_BOT + 5; i++) noteKnowledge(bot.id, owner.id, `prompt ${i}`, Date.now() + i);
  assert.equal(count(), KEEP_PER_BOT);
});

test("L137 « Pourquoi ? »: the decision, the user's last words, what the bot knew then; another account gets 404", async () => {
  q.run("DELETE FROM turn_knowledge WHERE bot_id = ?", bot.id);
  memories.add(bot.id, "Le fournisseur Acme livre le jeudi.", "chat");
  rows.append(bot, { kind: "message", role: "user", text: "Envoie le devis à Acme, s'il te plaît." }, 0);
  buildSystemPrompt(bots.byId(bot.id)!, owner, extras);
  await new Promise((r) => setTimeout(r, 5));
  addJournal({ userId: owner.id, botId: bot.id, tool: "email_send", label: "Envoyer un e-mail", decision: "words", quote: "Envoie le devis à Acme", status: "done", origin: "user" });
  const id = q.get<{ id: number }>("SELECT MAX(id) AS id FROM action_journal WHERE user_id = ?", owner.id)!.id;
  const why = await call("a", "GET", `/journal/${id}/why`);
  assert.equal(why.status, 200);
  assert.equal(why.json.entry.decision, "words");
  assert.equal(why.json.entry.quote, "Envoie le devis à Acme");
  assert.equal(why.json.userWords.text, "Envoie le devis à Acme, s'il te plaît.");
  assert.ok(why.json.knew.notes.some((n: string) => /Acme livre le jeudi/.test(n)));
  assert.equal((await call("b", "GET", `/journal/${id}/why`)).status, 404, "account isolation");
  assert.equal((await call("a", "GET", `/journal/999999/why`)).status, 404);
});
