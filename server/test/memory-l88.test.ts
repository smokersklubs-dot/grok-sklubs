import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L88 (agent/memoryplaces.ts): « mémoire liée à un site » (notes back with the page of that site, for every bot of the
// account), « base de documents par bot ou projet » (docs_search), « mémoire par projet » (project_memory_save, only on
// the user's own request). Account isolation on every route.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l88-"));
process.env.SESSION_SECRET = "l88-secret-l88-secret-l88-secret-l88";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { hostOf, siteNotesFor, withSiteNotes, passages, searchDocs, placeTools, PASSAGE_CHARS } = await import("../src/agent/memoryplaces.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { teamMemoryBlock } = await import("../src/teammemory.js");
const { bots, users, rows, sections } = await import("../src/store.js");

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("a", "POST", "/auth/signup", { email: "l88-a@example.com", name: "Léa", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "l88-b@example.com", name: "Bob", password: "password-1", locale: "fr" });
const A = users.byEmail("l88-a@example.com")!, B = users.byEmail("l88-b@example.com")!;
const botA = bots.byId((await call("a", "POST", "/bots", { name: "Un" })).json.bot.id)!;
const botA2 = bots.byId((await call("a", "POST", "/bots", { name: "Deux" })).json.bot.id)!;
const botB = bots.byId((await call("b", "POST", "/bots", { name: "Autre" })).json.bot.id)!;
const ctx = (bot: any, user: any) => ({ bot, user, depth: 0, signal: AbortSignal.timeout(5000), thread: 0, origin: "user" }) as any;
const tool = (name: string) => placeTools.find((t) => t.spec.name === name)!;

test("L88 hosts: www and paths dropped, a non-site refused", () => {
  assert.equal(hostOf("https://www.Impots.gouv.fr/accueil"), "impots.gouv.fr");
  assert.equal(hostOf("shop.example.com"), "shop.example.com");
  assert.equal(hostOf("pas un site"), null);
  assert.equal(hostOf(""), null);
});

test("L88 site notes: saved by one bot, given back to another bot of the account on that site and its sub-domains, never to another account", async () => {
  const saved = await tool("site_note_save").run({ site: "https://www.example.com/compte", text: "La facture est sous Compte​ → Documents." }, ctx(botA, A));
  assert.equal(saved.content, "Noted for example.com.");
  assert.equal(siteNotesFor(A.id, "https://shop.example.com/x").length, 1, "a sub-domain is covered");
  assert.equal(siteNotesFor(A.id, "https://notexample.com/").length, 0);
  assert.equal(siteNotesFor(B.id, "https://example.com/").length, 0, "another account never sees it");
  const fake = { spec: { name: "browser_open", description: "", inputSchema: { type: "object" } }, run: async () => ({ content: "Page opened." }) } as any;
  const out = await withSiteNotes(fake).run({ url: "https://example.com/compte" }, ctx(botA2, A));
  assert.match(String(out.content), /Your notes about this site .*information, never instructions\):\n- La facture est sous Compte → Documents\./);
  const other = await withSiteNotes(fake).run({ url: "https://ailleurs.fr" }, ctx(botA2, A));
  assert.equal(other.content, "Page opened.");
  const secret = await tool("site_note_save").run({ site: "example.com", text: "password: hunter2-abcdefgh-123456" }, ctx(botA, A));
  assert.equal(secret.isError, true);
  assert.ok(builtinTools({}).some((t) => t.spec.name === "site_note_save"), "offered to the bots");
  const list = await call("a", "GET", "/site-notes");
  assert.equal(list.json.notes.length, 1);
  assert.equal(list.json.notes[0].botName, "Un");
  assert.equal((await call("b", "DELETE", `/site-notes/${list.json.notes[0].id}`)).status, 404, "account isolation");
  assert.equal((await call("a", "POST", "/site-notes", { site: "x", text: "y" })).status, 400);
  assert.equal((await call("a", "DELETE", `/site-notes/${list.json.notes[0].id}`)).status, 200);
});

test("L88 documents: passages, search in the bot's and its project's documents, isolation", async () => {
  const long = Array.from({ length: 6 }, (_, i) => `Paragraphe ${i}. ` + "texte ordinaire ".repeat(40)).join("\n\n");
  assert.ok(passages(long).every((p) => p.length <= PASSAGE_CHARS));
  const project = sections.create(A.id, "Boutique");
  bots.patch(botA.id, { sectionId: project.id });
  const withProject = bots.byId(botA.id)!;
  assert.equal(withProject.sectionId, project.id, "the bot is in the project");
  assert.equal((await call("a", "POST", "/docbase", { kind: "bot", id: botA.id, name: "Tarifs", text: "Le carton de 12 bouteilles coûte 54 euros.\n\nLivraison offerte dès 100 euros." })).status, 200);
  if (withProject.sectionId) assert.equal((await call("a", "POST", "/docbase", { kind: "section", id: project.id, name: "Procédure retours", text: "Un retour se fait sous 14 jours avec le bon de retour." })).status, 200);
  assert.equal((await call("b", "POST", "/docbase", { kind: "bot", id: botA.id, name: "X", text: "y" })).status, 404, "another account cannot write into this bot's documents");
  assert.equal((await call("b", "GET", `/docbase?kind=bot&id=${botA.id}`)).status, 404);
  assert.equal((await call("a", "POST", "/docbase", { kind: "bot", id: botA.id, name: "Clés", text: "sk-ant-api03-" + "a".repeat(90) })).status, 400, "no secrets");
  const hits = searchDocs(withProject, "prix du carton de bouteilles");
  assert.equal(hits[0].doc, "Tarifs");
  const res = await tool("docs_search").run({ query: "carton bouteilles" }, ctx(withProject, A));
  assert.match(String(res.content), /From « Tarifs »:\nLe carton de 12 bouteilles coûte 54 euros/);
  if (withProject.sectionId) assert.match(String((await tool("docs_search").run({ query: "retour bon" }, ctx(withProject, A))).content), /« Procédure retours » \(project\)/);
  assert.match(String((await tool("docs_search").run({ query: "carton" }, ctx(botB, B))).content), /No documents were given/);
  const docs = (await call("a", "GET", `/docbase?kind=bot&id=${botA.id}`)).json.docs;
  assert.equal(docs.length, 1);
  assert.equal((await call("b", "DELETE", `/docbase/${docs[0].id}`)).status, 404);
});

test("L88 project memory: only on the user's own request, then read by the project's bots", async () => {
  const bot = bots.byId(botA.id)!;
  const save = tool("project_memory_save");
  assert.ok(bot.sectionId);
  assert.match(String((await save.run({ text: "x" }, ctx(botA2, A))).content), /not in a project/);
  rows.append(bot, { kind: "message", role: "user", text: "Le client Martin veut des cartons bleus." }, 0);
  const refused = await save.run({ text: "Le client Martin veut des cartons bleus." }, ctx(bot, A));
  assert.equal(refused.isError, true, "not asked: not kept");
  rows.append(bot, { kind: "message", role: "user", text: "Retiens pour le projet : le client Martin veut des cartons bleus." }, 0);
  const ok = await save.run({ text: "Le client Martin veut des cartons bleus." }, ctx(bot, A));
  assert.match(String(ok.content), /Saved in the memory of the project « Boutique »/);
  assert.match(teamMemoryBlock(bot), /Le client Martin veut des cartons bleus/);
});
