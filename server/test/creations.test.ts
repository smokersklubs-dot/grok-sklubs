import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L158 « Créations » (agent/creations.ts, creationroutes.ts): creation_render records each render of a long creative work
// under a named stage; ONE trajectory card per creation is kept up to date in the chat; a render identical to the one
// before is flagged « aucun changement », two in a row « aucun progrès » (the bot is told); each render keeps its own copy
// (an overwrite never changes an earlier step); previews: images inline, other files as downloads, pages through their
// owner-only version address; another account sees nothing; paths outside the library are refused.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-creations-"));
process.env.SESSION_SECRET = "test-secret-test-secret-creations-1";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { slugOf, renderReply } = await import("../src/agent/creations.js");
const { resolveInWorkspace, saveFile } = await import("../src/computer.js");
const { pages, bots } = await import("../src/store.js");
const { pageVersions } = await import("../src/pagefiles.js");
const { config } = await import("../src/config.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";
import type { TrajectoryCard } from "../src/creationtypes.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (blocks: Block[]) => blocks.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n");
const seen: string[] = [];
const results: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = textOf(last.content);
    seen.push(said);
    if (last.content.some((b) => b.type === "tool_result")) { results.push(said); return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage }; }
    const m = /RENDER (\S+) (\S+)(?: (.+))?/.exec(said);
    if (m) return { content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name: "creation_render", input: { title: m[3] ?? "Affiche du Concert !", stage: m[1], path: m[2], note: "essai" } }], stopReason: "tool_use", model: "script-1", usage };
    return { content: [{ type: "text", text: "hello" }], stopReason: "end", model: "script-1", usage };
  },
});

const jars: Record<string, string> = {};
async function raw(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, redirect: "manual", headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return res;
}
const call = async (who: string, method: string, url: string, body?: unknown) => { const r = await raw(who, method, url, body); return { status: r.status, json: (await r.json().catch(() => null)) as any }; };
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("a", "GET", `/bots/${id}/rows?limit=500`)).json.rows;
const idle = (id: string) => until(async () => !(await call("a", "GET", "/bots")).json.live[id]?.running, "idle");
const say = async (id: string, text: string) => { const before = results.length; await call("a", "POST", `/bots/${id}/messages`, { text }); await until(() => results.length > before, `turn ${text}`); await idle(id); };
const cards = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "card" && r.body.card.type === "trajectory") as (Row & { body: { kind: "card"; card: TrajectoryCard } })[];
const put = (botId: string, rel: string, data: Buffer | string) => { const full = resolveInWorkspace(botId, rel); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, data); };
const PNG1 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("first render")]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("second render, brighter")]);

test("slug: accents folded, punctuation dropped", () => {
  assert.equal(slugOf("Affiche du Concert !"), "affiche-du-concert");
  assert.equal(slugOf("Écran d'accueil — v2"), "ecran-d-accueil-v2");
  assert.equal(slugOf("   !!! "), "");
});

test("trajectory: stages, one card kept up to date, copies per render, no change / no progress, compare data, isolation", async () => {
  await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
  const botId = (await call("a", "GET", "/bots")).json.bots[0].id as string;

  put(botId, "renders/poster.png", PNG1);
  await say(botId, "RENDER study renders/poster.png");
  assert.match(results.at(-1)!, /Render 1 of “Affiche du Concert !” recorded \(stage: study\)/);
  let list = await cards(botId);
  assert.equal(list.length, 1);
  let card = list[0].body.card;
  assert.equal(card.stage, "study");
  assert.equal(card.total, 1);
  assert.deepEqual(card.renders.map((r) => [r.n, r.kind, r.unchanged, r.preview]), [[1, "image", false, true]]);
  const firstId = card.renders[0].id;

  put(botId, "renders/poster.png", PNG2);
  await say(botId, "RENDER build renders/poster.png");
  list = await cards(botId);
  assert.equal(list.length, 1, "the same card is updated, not a second one");
  card = list[0].body.card;
  assert.equal(card.stage, "build");
  assert.deepEqual(card.renders.map((r) => [r.n, r.stage, r.unchanged]), [[1, "study", false], [2, "build", false]]);
  assert.equal(card.stalled, false);

  // Each render keeps its own copy: render 1 still shows the first bytes after the overwrite.
  const r1 = await raw("a", "GET", `/bots/${botId}/creations/${card.creationId}/renders/${firstId}`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("content-type"), "image/png");
  assert.match(r1.headers.get("content-disposition")!, /^inline/);
  assert.match(r1.headers.get("content-security-policy")!, /sandbox/);
  assert.deepEqual(Buffer.from(await r1.arrayBuffer()), PNG1);

  await say(botId, "RENDER check renders/poster.png");
  assert.match(results.at(-1)!, /Nothing changed: this render is byte for byte the same as render 2/);
  card = (await cards(botId))[0].body.card;
  assert.equal(card.renders.at(-1)!.unchanged, true);
  assert.equal(card.stalled, false, "one unchanged render is not yet « no progress »");

  await say(botId, "RENDER check renders/poster.png");
  assert.match(results.at(-1)!, /NO PROGRESS: the last 2 renders are identical/);
  card = (await cards(botId))[0].body.card;
  assert.equal(card.stalled, true);
  assert.equal(card.total, 4);

  // A new change ends the stall.
  put(botId, "renders/poster.png", Buffer.concat([PNG2, Buffer.from("!")]));
  await say(botId, "RENDER ready renders/poster.png");
  card = (await cards(botId))[0].body.card;
  assert.equal(card.stalled, false);
  assert.equal(card.stage, "ready");

  // The full list for the compare (every render, not only the shown ones).
  const full = await call("a", "GET", `/bots/${botId}/creations/${card.creationId}`);
  assert.equal(full.status, 200);
  assert.equal(full.json.all.length, 5);
  assert.deepEqual(full.json.all.map((r: { stage: string }) => r.stage), ["study", "build", "check", "check", "ready"]);
  assert.equal((await call("a", "GET", `/bots/${botId}/creations`)).json.creations.length, 1);

  // Refusals: unknown stage, outside the library, a missing file — nothing recorded.
  await say(botId, "RENDER finished renders/poster.png");
  assert.match(results.at(-1)!, /Give the stage: one of study, build, check, ready\. Nothing was recorded/);
  await say(botId, "RENDER build ../../etc/passwd");
  assert.match(results.at(-1)!, /cannot be read in your library .*Nothing was recorded/);
  await say(botId, "RENDER build renders/missing.png");
  assert.match(results.at(-1)!, /cannot be read in your library/);
  assert.equal((await cards(botId))[0].body.card.total, 5);

  // A file that is not a picture or a video is never served inline.
  put(botId, "renders/script.txt", "<script>alert(1)</script>");
  await say(botId, "RENDER build renders/script.txt Scénario");
  const scen = (await cards(botId)).find((r) => r.body.card.title === "Scénario")!.body.card;
  assert.equal(scen.renders[0].kind, "file");
  const dl = await raw("a", "GET", `/bots/${botId}/creations/${scen.creationId}/renders/${scen.renders[0].id}`);
  assert.equal(dl.headers.get("content-type"), "application/octet-stream");
  assert.match(dl.headers.get("content-disposition")!, /^attachment/);

  // A published page: its render points at the owner-only version address; its fingerprint is the page's version.
  const bot = bots.byId(botId)!;
  saveFile(botId, "site/index.html", "<h1>Bonjour</h1>");
  const page = pages.create(bot, "Site", "site/index.html", config.publicUrl);
  pageVersions.record(bot.userId, botId, "site/index.html", "<h1>Bonjour</h1>", "published");
  await say(botId, "RENDER build site/index.html Site vitrine");
  const site = (await cards(botId)).find((r) => r.body.card.title === "Site vitrine")!.body.card;
  assert.equal(site.renders[0].kind, "page");
  const pv = await raw("a", "GET", `/bots/${botId}/creations/${site.creationId}/renders/${site.renders[0].id}`);
  assert.equal(pv.status, 302);
  assert.match(pv.headers.get("location")!, new RegExp(`^/api/pages/${page.token}/versions/\\d+/view$`));

  // Another account sees nothing.
  await call("b", "POST", "/auth/signup", { email: "other@example.com", name: "Other", password: "password-2" });
  assert.equal((await call("b", "GET", `/bots/${botId}/creations`)).status, 404);
  assert.equal((await raw("b", "GET", `/bots/${botId}/creations/${card.creationId}/renders/${firstId}`)).status, 404);
});

test("the reply to the bot: plain, no change, no progress", () => {
  const base = { creation: { id: "c", bot_id: "b", slug: "x", title: "X", stage: "build", generation: 1, seq: 1 }, render: { id: 1, n: 3, stage: "build" as const, kind: "image" as const, name: "x.png", note: "", at: 0, bytes: 1, unchanged: false, preview: true } };
  assert.doesNotMatch(renderReply({ ...base, card: { type: "trajectory", creationId: "c", title: "X", stage: "build", renders: [], total: 3, stalled: false }, previous: null }), /Nothing changed|NO PROGRESS/);
  assert.match(renderReply({ ...base, card: { type: "trajectory", creationId: "c", title: "X", stage: "build", renders: [], total: 3, stalled: false }, previous: 2 }), /same as render 2/);
  assert.match(renderReply({ ...base, card: { type: "trajectory", creationId: "c", title: "X", stage: "build", renders: [], total: 3, stalled: true }, previous: 2 }), /NO PROGRESS/);
});
