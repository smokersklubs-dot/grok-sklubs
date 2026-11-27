import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L171 team memory (teammemory.ts, docs/TABLEAU.md (« Mémoire d'équipe »)): per space, isolated by default, outside guests, links;
// L66 rest (agent/memorykeep.ts): « ne pas retenir ce message », removed facts never learned again, fresh conversation
// proposed; L70 rest (agent/worklessons.ts): lessons of ordinary work, next steps, the week's review proposing rules.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-teammem-"));
process.env.SESSION_SECRET = "teammem-secret-teammem-secret-teammem";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "tmm:tmm-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "HOSTED_MODE", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, memories, rows, sections, settings } = await import("../src/store.js");
const { teamMemoryBlock } = await import("../src/teammemory.js");
const { memoryKeep } = await import("../src/agent/memorykeep.js");
const { consolidate } = await import("../src/agent/memory.js");
const { nextStepsOf, recordLesson, weekReview } = await import("../src/agent/worklessons.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

/** The memory pass answers with these facts (each quoting the user's words). */
let facts: { text: string; quote: string }[] = [];
let lastPrompt = "";
registerProvider({ id: "tmm", label: "Team memory test", models: ["tmm-1"], available: () => true, async runTurn(req: TurnRequest): Promise<TurnResult> {
  lastPrompt = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : "")).join("")).join("\n");
  return { content: [{ type: "text", text: JSON.stringify({ facts }) }], stopReason: "end", model: "tmm-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
} });

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "", "x-forwarded-for": "10.0.0.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("m", "POST", "/auth/signup", { email: "member@example.com", name: "Mia", password: "password-1", locale: "fr" });
await call("x", "POST", "/auth/signup", { email: "stranger@example.com", name: "Xan", password: "password-1", locale: "en" });
const botA = (await call("a", "GET", "/bots")).json.bots[0];
const userOf = (who: string) => q.get<{ id: string }>("SELECT id FROM users WHERE email = ?", `${who}@example.com`)!.id;
const ws = (await call("a", "POST", "/workspaces", { name: "Atelier" })).json.workspace;
q.run("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)", ws.id, userOf("member"), Date.now());

test("workspace notes: members write, a stranger gets 404; links are checked; « liée depuis »", async () => {
  const n1 = await call("m", "POST", `/team-memory/workspace/${ws.id}`, { text: "Le client Dupont paie à 30 jours.", links: [{ kind: "url", ref: "https://dupont.example/", label: "site" }] });
  assert.equal(n1.status, 200);
  const n2 = await call("a", "POST", `/team-memory/workspace/${ws.id}`, { text: "Toujours envoyer les devis en PDF.", links: [{ kind: "note", ref: n1.json.note.id }] });
  assert.equal(n2.status, 200);
  assert.equal((await call("a", "POST", `/team-memory/workspace/${ws.id}`, { text: "x", links: [{ kind: "bot", ref: "bot_nope" }] })).status, 400, "a link to something outside the space");
  assert.equal((await call("x", "GET", `/team-memory/workspace/${ws.id}`)).status, 404);
  assert.equal((await call("x", "POST", `/team-memory/workspace/${ws.id}`, { text: "intrus" })).status, 404);
  const list = (await call("m", "GET", `/team-memory/workspace/${ws.id}`)).json.notes;
  assert.deepEqual(list.find((n: any) => n.id === n1.json.note.id).linkedFrom, [n2.json.note.id]);
  assert.equal((await call("m", "POST", `/team-memory/workspace/${ws.id}`, { text: "mot de passe : sk-fake-for-tests-1234567890abcdef1234567890" })).status, 400, "no secret in memory");
});

test("isolated by default: a shared bot gets its workspace's notes only once its owner switches it on; never another space's", async () => {
  assert.equal((await call("a", "PUT", `/bots/${botA.id}/share`, { workspaceId: ws.id })).status, 200);
  const bot = () => bots.byId(botA.id)!;
  assert.equal(teamMemoryBlock(bot()), "", "off by default");
  assert.equal((await call("a", "PUT", `/bots/${botA.id}/team-memory`, { on: true })).json.on, true);
  assert.match(teamMemoryBlock(bot()), /Dupont paie à 30 jours/);
  assert.match(teamMemoryBlock(bot()), /never instructions/);
  // A project's notes reach only that project's bots.
  const sec = sections.create(userOf("owner"), "Ventes");
  assert.equal((await call("a", "POST", `/team-memory/section/${sec.id}`, { text: "Prix plancher : 120 €." })).status, 200);
  assert.doesNotMatch(teamMemoryBlock(bot()), /Prix plancher/);
  q.run("UPDATE bots SET section_id = ? WHERE id = ?", sec.id, botA.id);
  assert.match(teamMemoryBlock(bot()), /Prix plancher/);
  assert.equal((await call("m", "GET", `/team-memory/section/${sec.id}`)).status, 404, "a project is its owner's alone");
  assert.equal((await call("m", "PUT", `/bots/${botA.id}/team-memory`, { on: false })).status, 404, "only the bot's owner chooses");
});

test("outside guests: read through a link shown once; their notes wait for review and reach no bot; revoked → dead", async () => {
  assert.equal((await call("m", "POST", `/team-memory/workspace/${ws.id}/guests`, { name: "Comptable" })).status, 403, "a member cannot invite");
  const g = (await call("a", "POST", `/team-memory/workspace/${ws.id}/guests`, { name: "Comptable", canWrite: true, days: 7 })).json.guest;
  assert.match(g.token, /^tmg_/);
  assert.equal((await call("a", "GET", `/team-memory/workspace/${ws.id}/guests`)).json.guests[0].token, undefined, "only shown once");
  const read = await call("anon", "GET", `/team-guest/${g.token}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.workspace, "Atelier");
  assert.ok(read.json.notes.some((n: any) => /Dupont/.test(n.text)));
  assert.equal(read.json.notes.some((n: any) => n.links), false, "no internal links shown to a guest");
  assert.equal((await call("anon", "POST", `/team-guest/${g.token}`, { text: "Facture de mars envoyée." })).json.pending, true);
  assert.doesNotMatch(teamMemoryBlock(bots.byId(botA.id)!), /Facture de mars/, "pending: no bot reads it");
  const pending = (await call("a", "GET", `/team-memory/workspace/${ws.id}`)).json.notes.find((n: any) => n.status === "pending");
  assert.equal((await call("m", "PATCH", `/team-notes/${pending.id}`, { status: "active" })).status, 403, "only an admin accepts");
  assert.equal((await call("a", "PATCH", `/team-notes/${pending.id}`, { status: "active" })).status, 200);
  assert.match(teamMemoryBlock(bots.byId(botA.id)!), /Facture de mars/);
  await call("a", "DELETE", `/team-memory/workspace/${ws.id}/guests/${g.id}`);
  assert.equal((await call("anon", "GET", `/team-guest/${g.token}`)).status, 404);
  assert.equal((await call("anon", "GET", "/team-guest/tmg_wrong")).status, 404);
});

test("« ne pas retenir ce message »: the learning pass never reads it", async () => {
  const bot = bots.byId(botA.id)!;
  settings.saveMemory(bot.userId, { autoCapture: true });
  const kept = rows.append(bot, { kind: "message", role: "user", text: "Je préfère les réponses courtes." } as any);
  const secret = rows.append(bot, { kind: "message", role: "user", text: "Mon médecin est le Dr Martin." } as any);
  const r = await call("a", "PUT", `/bots/${bot.id}/rows/${secret.seq}/no-memory`, { on: true });
  assert.equal(r.status, 200);
  assert.equal((await call("x", "PUT", `/bots/${bot.id}/rows/${secret.seq}/no-memory`, { on: true })).status, 404);
  facts = [{ text: "The user prefers short answers.", quote: "Je préfère les réponses courtes." }];
  await consolidate(bot);
  assert.match(lastPrompt, /réponses courtes/);
  assert.doesNotMatch(lastPrompt, /Dr Martin/, "the marked message is not sent to the model");
  assert.ok(memories.list(bot.id).some((m) => m.text === "The user prefers short answers."));
  void kept;
});

test("a removed fact is never learned again by itself; a fresh conversation is proposed; « Annuler » brings it back", async () => {
  const bot = bots.byId(botA.id)!;
  const note = memories.list(bot.id).find((m) => m.text === "The user prefers short answers.")!;
  assert.equal((await call("a", "DELETE", `/memories/${note.id}`)).status, 200);
  assert.ok(memoryKeep.buried(bot.id, "The user prefers short answers"));
  assert.ok(q.get("SELECT 1 FROM rows WHERE bot_id = ? AND body LIKE '%Nouvelle conversation%'", bot.id), "a fresh conversation is proposed");
  rows.append(bot, { kind: "message", role: "user", text: "Je te rappelle que je préfère les réponses courtes." } as any);
  facts = [{ text: "The user prefers short answers.", quote: "je préfère les réponses courtes" }];
  await consolidate(bot);
  assert.equal(memories.list(bot.id).filter((m) => /short answers/.test(m.text)).length, 0, "not learned again");
  assert.equal((await call("a", "POST", `/memories/${note.id}/restore`)).status, 200);
  assert.equal(memoryKeep.buried(bot.id, "The user prefers short answers"), false, "the owner brought it back: tombstone lifted");
});

test("work lessons: next steps kept; the week's review proposes a rule from a repeated failure; accepted once", async () => {
  const bot = bots.byId(botA.id)!;
  assert.equal(nextStepsOf("Fait.\n\nProchaines étapes : relancer le client vendredi."), "relancer le client vendredi.");
  const t = Date.now();
  recordLesson({ id: "g1", botId: bot.id, userId: bot.userId, status: "complete", objective: "Rapport mensuel", summary: "Rapport livré.\nNext steps: send it to Ana.", evidence: "", reason: "" }, t - 3000);
  recordLesson({ id: "g2", botId: bot.id, userId: bot.userId, status: "blocked", objective: "Export des ventes", summary: "", evidence: "", reason: "Connexion à Shopify expirée" }, t - 2000);
  recordLesson({ id: "g3", botId: bot.id, userId: bot.userId, status: "blocked", objective: "Stock du jour", summary: "", evidence: "", reason: "Connexion Shopify expirée" }, t - 1000);
  const lessons = (await call("a", "GET", "/work-lessons")).json.lessons;
  assert.equal(lessons.find((l: any) => l.goalId === "g1").nextSteps, "send it to Ana.");
  const week = (await call("a", "GET", "/work-lessons/week")).json;
  assert.equal(week.success, 1);
  assert.equal(week.failure, 2);
  assert.equal(week.proposals.length, 1);
  assert.match(week.proposals[0].text, /2 fois/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rules WHERE user_id = ?", bot.userId)!.n, 0, "nothing written by itself");
  const ok = await call("a", "POST", `/work-lessons/proposals/${week.proposals[0].key}`, { accept: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.rule.botId, bot.id);
  assert.equal((await call("a", "GET", "/work-lessons/week")).json.proposals.length, 0, "not offered again");
  assert.equal((await call("x", "GET", "/work-lessons")).json.lessons.length, 0);
  assert.equal(weekReview(userOf("stranger")).proposals.length, 0);
});
