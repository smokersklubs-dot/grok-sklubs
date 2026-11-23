import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L158 (RESTE 23/11): a budget per creation (spend shown, the bot told at 80 % and to stop at 100 %), open questions shown
// on the card and ticked off by the owner, and the alert when a newer Craft Anything release exists (never installed).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-creaplus-"));
process.env.SESSION_SECRET = "creations-plus-secret-creations-plus-01";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "MAX_BOTS"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { recordRender, renderReply, showTrajectory } = await import("../src/agent/creations.js");
const { compareVersions, craftUpdate, noteCraftUpdate, pinnedCraftVersion, resetCraftCache, OPEN_QUESTIONS_MAX } = await import("../src/agent/creationplus.js");
const { saveFile } = await import("../src/computer.js");
const { bots, rows } = await import("../src/store.js");

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("a", "POST", "/auth/signup", { email: "crea@example.com", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "other@example.com", password: "password-1", locale: "en" });
const botId = (await call("a", "GET", "/bots")).json.bots[0].id as string;
const bot = () => bots.byId(botId)!;
const spend = (usd: number) => q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, 'x', 1, 1, 0, ?)", bot().userId, botId, Date.now(), usd);

let creationId = "";
test("L158: open questions from the bot are shown on the card (deduplicated), settled by number or text", () => {
  saveFile(botId, "renders/a.txt", "v1");
  const r = recordRender(bot(), { title: "Affiche", stage: "study", path: "renders/a.txt", questions: ["Quelle couleur ?", "quelle  couleur ?", "Format A3 ou A4 ?"] });
  assert.ok(!("error" in r));
  if ("error" in r) return;
  creationId = r.creation.id;
  showTrajectory(bot(), r.creation, r.card);
  assert.deepEqual(r.card.questions!.map((x) => x.text), ["Quelle couleur ?", "Format A3 ou A4 ?"]);
  assert.match(renderReply(r), /Open questions on the card: #\d+ Quelle couleur/);
  saveFile(botId, "renders/a.txt", "v2");
  const r2 = recordRender(bot(), { title: "Affiche", stage: "build", path: "renders/a.txt", resolved: [String(r.card.questions![0].id)] });
  if ("error" in r2) throw new Error(r2.error);
  assert.deepEqual(r2.card.questions!.map((x) => x.text), ["Format A3 ou A4 ?"]);
  assert.equal(r2.card.budget, "none");
  assert.equal(OPEN_QUESTIONS_MAX, 20);
});

test("L158: the owner ticks a question off from the card; the bot hears it once; another account cannot", async () => {
  const cards = (await call("a", "GET", `/bots/${botId}/creations`)).json.creations;
  const qid = cards[0].questions[0].id;
  assert.equal((await call("b", "POST", `/bots/${botId}/creations/${creationId}/questions/${qid}/resolve`)).status, 404);
  const ok = await call("a", "POST", `/bots/${botId}/creations/${creationId}/questions/${qid}/resolve`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.questions, []);
  assert.equal((await call("a", "POST", `/bots/${botId}/creations/${creationId}/questions/${qid}/resolve`)).status, 404, "already closed");
  const inChat = rows.list(botId, bot().generation, 50).find((r) => r.body.kind === "card" && r.body.card.type === "trajectory");
  assert.ok(inChat && inChat.body.kind === "card" && inChat.body.card.type === "trajectory" && inChat.body.card.questions!.length === 0, "the card in the chat is updated");
  saveFile(botId, "renders/a.txt", "v3");
  const r = recordRender(bot(), { title: "Affiche", stage: "build", path: "renders/a.txt" });
  if ("error" in r) throw new Error(r.error);
  assert.match(renderReply(r), /The owner ticked off: “Format A3 ou A4 \?”/);
  saveFile(botId, "renders/a.txt", "v4");
  const again = recordRender(bot(), { title: "Affiche", stage: "build", path: "renders/a.txt" });
  if ("error" in again) throw new Error(again.error);
  assert.doesNotMatch(renderReply(again), /ticked off/, "told once");
});

test("L158: a budget per creation — spend shown, warned at 80 %, told to stop at 100 %; bad amounts refused", async () => {
  assert.equal((await call("a", "PUT", `/bots/${botId}/creations/${creationId}/budget`, { usd: -3 })).status, 400);
  assert.equal((await call("a", "PUT", `/bots/${botId}/creations/${creationId}/budget`, { usd: 20000 })).status, 400);
  assert.equal((await call("b", "PUT", `/bots/${botId}/creations/${creationId}/budget`, { usd: 5 })).status, 404);
  const set = await call("a", "PUT", `/bots/${botId}/creations/${creationId}/budget`, { usd: 2 });
  assert.equal(set.status, 200);
  assert.equal(set.json.budgetUsd, 2);
  assert.equal(set.json.budget, "ok");
  spend(1.7);
  saveFile(botId, "renders/a.txt", "v5");
  let r = recordRender(bot(), { title: "Affiche", stage: "check", path: "renders/a.txt" });
  if ("error" in r) throw new Error(r.error);
  assert.equal(r.card.budget, "warn");
  assert.match(renderReply(r), /Budget: \$1\.70 spent of \$2\.00 \(over 80 %\)/);
  spend(0.5);
  saveFile(botId, "renders/a.txt", "v6");
  r = recordRender(bot(), { title: "Affiche", stage: "check", path: "renders/a.txt" });
  if ("error" in r) throw new Error(r.error);
  assert.equal(r.card.budget, "over");
  assert.match(renderReply(r), /BUDGET REACHED: \$2\.20 spent of the \$2\.00/);
  const cleared = await call("a", "PUT", `/bots/${botId}/creations/${creationId}/budget`, { usd: null });
  assert.equal(cleared.json.budgetUsd, null);
  assert.equal(cleared.json.budget, "none");
});

test("L158: a newer Craft Anything release is announced once per version, never installed; same or older: nothing", async () => {
  assert.equal(pinnedCraftVersion(), "0.6.1");
  assert.equal(compareVersions("v0.6.10", "0.6.9"), 1);
  assert.equal(compareVersions("0.6.1", "v0.6.1"), 0);
  assert.equal(compareVersions("0.5.9", "0.6.1"), -1);
  const asked: string[] = [];
  const fake = (tag: string | null, status = 200) => (async (url: string | URL | Request) => { asked.push(String(url)); return new Response(JSON.stringify(tag ? { tag_name: tag } : {}), { status }); }) as never;
  resetCraftCache();
  assert.deepEqual(await craftUpdate(fake("v0.6.1")), { current: "0.6.1", latest: "0.6.1", newer: false });
  assert.equal(asked[0], "https://api.github.com/repos/storytold/craft-anything/releases/latest");
  await craftUpdate(fake("v9.9.9"));
  assert.equal(asked.length, 1, "cached for a day");
  resetCraftCache();
  const notices = () => rows.list(botId, bot().generation, 200).filter((r) => r.body.kind === "notice" && /Craft Anything/.test(r.body.text)).length;
  const u = await noteCraftUpdate(bot(), 0, fake("v0.7.0"));
  assert.equal(u?.newer, true);
  assert.equal(notices(), 1);
  const last = rows.list(botId, bot().generation, 200).filter((r) => r.body.kind === "notice").at(-1)!;
  assert.match(last.body.kind === "notice" ? last.body.text : "", /0\.7\.0.*0\.6\.1.*rien n'est installé tout seul/);
  resetCraftCache();
  await noteCraftUpdate(bot(), 0, fake("v0.7.0"));
  assert.equal(notices(), 1, "once per version");
  resetCraftCache();
  assert.equal(await craftUpdate(fake(null, 404)), null, "no release or an error: no alert");
  resetCraftCache();
  assert.equal(await craftUpdate(fake("<script>")), null, "an odd tag is ignored");
});
