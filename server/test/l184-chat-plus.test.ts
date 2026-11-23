import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L184 (non-paid parts): polls in a chat and a group (polls.ts), pinned dashboard from the chat's views
// (dashboardpins.ts), link preview through the guarded fetch (linkpreview.ts), apps' own notices (appevents.ts),
// metrics (metrics.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l184-"));
process.env.SESSION_SECRET = "l184-secret-l184-secret-l184-secret-l";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "ALLOW_PRIVATE_FETCH", "METRICS_TOKEN"]) delete process.env[k];

const page = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<html><head><title>Local</title></head></html>"); });
await new Promise<void>((r) => page.listen(0, "127.0.0.1", () => r()));
const LOCAL = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
after(() => { page.closeAllConnections(); page.close(); });

const { api } = await import("../src/routes.js");
const { rows, bots } = await import("../src/store.js");
const { applyVote, cleanPoll, tally, pollTools } = await import("../src/polls.js");
const { parsePreview, linkPreview, previewable } = await import("../src/linkpreview.js");
const { recordAppEvent, watchAppEvents } = await import("../src/appevents.js");
const { metricsAllowed, prometheusText, usageMetrics } = await import("../src/metrics.js");

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a", headers: Record<string, string> = {}) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json, text };
}
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
const me = (await call("GET", "/me")).json.user;
const first = (await call("GET", "/bots")).json.bots[0];
const scout = (await call("POST", "/bots", { name: "Scout" })).json.bot;

test("polls: checked, one vote per voter (changeable), one answer unless several allowed, closed means closed", async () => {
  assert.throws(() => cleanPoll({ question: "", options: ["a", "b"] }), /question/);
  assert.throws(() => cleanPoll({ question: "Q", options: ["Oui", "oui"] }), /2 different/);
  assert.throws(() => cleanPoll({ question: "Q", options: Array.from({ length: 11 }, (_, i) => `o${i}`) }), /at most 10/);
  const r = await call("POST", `/bots/${first.id}/polls`, { question: "Où déjeuner ?", options: ["Pizza", "Sushi", "Salade"] });
  assert.equal(r.status, 200);
  const poll = r.json.poll;
  assert.equal(poll.status, "open");
  const v1 = await call("POST", `/polls/${poll.pollId}/vote`, { choices: [0, 1] });
  assert.equal(v1.status, 400, "one answer only");
  await call("POST", `/polls/${poll.pollId}/vote`, { choices: [0] });
  const v2 = await call("POST", `/polls/${poll.pollId}/vote`, { choices: [2] });
  assert.deepEqual(tally(v2.json.poll), [0, 0, 1], "the owner's vote was replaced");
  assert.equal((await call("POST", `/polls/${poll.pollId}/vote`, { choices: [0] }, "b")).status, 404, "another account");
  // The bot votes with its tool; a bot outside the chat cannot.
  const ctx = (id: string) => ({ bot: bots.byId(id)!, user: { id: me.id, locale: "fr" }, depth: 0, signal: new AbortController().signal }) as any;
  const voted = await pollTools[0].run({ poll: poll.pollId, choices: [1], reason: "rapide" }, ctx(first.id));
  assert.match(voted.content as string, /Pizza — 1 vote/);
  assert.equal((await pollTools[0].run({ poll: poll.pollId, choices: [1] }, ctx(scout.id))).isError, true);
  const row = rows.list(first.id, bots.byId(first.id)!.generation, 50).find((x) => x.body.kind === "card" && x.body.card.type === "poll")!;
  assert.equal((row.body as any).card.votes.length, 2);
  await call("POST", `/polls/${poll.pollId}/close`);
  assert.equal((await call("POST", `/polls/${poll.pollId}/vote`, { choices: [1] })).status, 400);
  const multi = applyVote({ type: "poll", pollId: "p", question: "q", options: ["a", "b"], multi: true, status: "open", votes: [], createdBy: "" }, { by: "x", name: "X", choices: [1, 0, 1, 9] });
  assert.deepEqual("error" in multi ? null : multi.votes[0].choices, [0, 1]);
});

test("polls in a group: each member may vote, others not", async () => {
  const nova = (await call("POST", "/bots", { name: "Nova" })).json.bot;
  const room = (await call("POST", "/rooms", { name: "Équipe", botIds: [scout.id, nova.id] })).json;
  const roomId = room.bot?.id ?? room.room?.id ?? room.id;
  assert.ok(roomId, JSON.stringify(room));
  const poll = (await call("POST", `/bots/${roomId}/polls`, { question: "Réunion ?", options: ["Lundi", "Mardi"] })).json.poll;
  const ctx = (id: string) => ({ bot: bots.byId(id)!, user: { id: me.id }, depth: 0, signal: new AbortController().signal }) as any;
  assert.equal((await pollTools[0].run({ poll: poll.pollId, choices: [2] }, ctx(scout.id))).isError, undefined);
  assert.equal((await pollTools[0].run({ poll: poll.pollId, choices: [1] }, ctx(first.id))).isError, true, "not a member");
});

test("pinned dashboard follows the newest view with the same title; forms stay in the chat; 404 elsewhere", async () => {
  const bot = bots.byId(first.id)!;
  const view = (n: number) => ({ type: "view" as const, title: "Ventes", blocks: [{ kind: "stats" as const, items: [{ label: "Total", value: String(n) }] }, { kind: "form" as const, fields: [{ id: "a", label: "A", type: "text" as const }], submit: "OK" }], fallback: `Total ${n}`, status: "shown" as const });
  const r1 = rows.append(bot, { kind: "card", card: view(10) });
  assert.equal((await call("POST", `/bots/${first.id}/cards/${r1.seq}/pin`)).status, 200);
  assert.equal((await call("POST", `/bots/${first.id}/cards/${r1.seq}/pin`, undefined, "b")).status, 404);
  const notView = rows.append(bot, { kind: "message", role: "assistant", text: "hello" });
  assert.equal((await call("POST", `/bots/${first.id}/cards/${notView.seq}/pin`)).status, 400);
  rows.append(bot, { kind: "card", card: view(42) });
  const pins = (await call("GET", "/dashboard/pins")).json.pins;
  assert.equal(pins.length, 1);
  assert.equal(pins[0].card.blocks[0].items[0].value, "42");
  assert.ok(pins[0].card.blocks.every((b: any) => b.kind !== "form"));
  assert.equal((await call("GET", "/dashboard/pins", undefined, "b")).json.pins.length, 0);
  assert.equal((await call("DELETE", `/dashboard/pins/${pins[0].id}`)).status, 200);
});

test("link preview: title and description only; private addresses refused; not a web address refused", async () => {
  const html = `<html><head><title>Old</title><meta property="og:title" content="Vélo &amp; co"><meta name="description" content="Des vélos &lt;b&gt;électriques&lt;/b&gt;"><meta property="og:site_name" content="Vélos"><meta property="og:image" content="https://x.example/i.png"></head><body>…</body></html>`;
  assert.deepEqual(parsePreview(html, "https://www.velo.example/a"), { url: "https://www.velo.example/a", host: "velo.example", title: "Vélo & co", description: "Des vélos électriques", siteName: "Vélos" });
  assert.equal(parsePreview("<html><body>rien</body></html>", "https://a.example/"), null);
  assert.equal(previewable("javascript:alert(1)"), null);
  assert.equal(previewable("https://user:pw@a.example/"), null);
  const local = await call("GET", `/link-preview?url=${encodeURIComponent(LOCAL)}`);
  assert.equal(local.json.preview, null);
  assert.match(local.json.problem, /private or local network/);
  const fake = async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  assert.equal((await linkPreview("https://shop.example/p", fake as any)).preview?.title, "Vélo & co");
  assert.equal((await call("GET", "/link-preview?url=x", undefined, "b")).json.preview, null);
});

test("apps' own notices reach only the bots that may use the app", async () => {
  const { q } = await import("../src/db.js");
  q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, auth, created_at) VALUES ('con_ev', ?, 'Notes', 'https://notes.example/mcp', NULL, 'none', 1)", me.id);
  const handlers: Function[] = [];
  let reread = 0;
  watchAppEvents({ id: "con_ev", userId: me.id, name: "Notes" }, { setNotificationHandler: (_s: unknown, h: Function) => { handlers.push(h); } } as any, () => { reread++; });
  assert.equal(handlers.length, 5);
  await handlers[0]({ params: { level: "warning", logger: "sync", data: "quota bientôt atteint\u0007" } });
  await handlers[1]({}); await handlers[1]({});
  assert.equal(reread, 1, "one re-read per minute at most");
  recordAppEvent({ id: "con_ev", userId: me.id, name: "Notes" }, "resource", "notes://42");
  let ev = (await call("GET", `/bots/${scout.id}/app-events`)).json.events;
  assert.deepEqual(ev.map((e: any) => e.kind), ["resource", "tools", "tools", "log"]);
  assert.equal(ev[3].text, "sync: quota bientôt atteint");
  await call("PUT", "/connectors/con_ev/bots", { allBots: true, bots: { [scout.id]: false } });
  ev = (await call("GET", `/bots/${scout.id}/app-events`)).json.events;
  assert.equal(ev.length, 0);
  assert.equal((await call("GET", `/bots/${first.id}/app-events`)).json.events.length, 4);
  assert.equal((await call("GET", `/bots/${first.id}/app-events`, undefined, "b")).status, 404);
});

test("metrics: the account's numbers; the Prometheus page is off without a long token", async () => {
  rows.append(bots.byId(first.id)!, { kind: "message", role: "user", text: "bonjour" });
  const m = (await call("GET", "/usage-metrics")).json.metrics;
  assert.ok(m.bots >= 2);
  assert.ok(m.messages.user >= 1);
  assert.equal((await call("GET", "/usage-metrics", undefined, "b")).json.metrics.bots, 1);
  assert.equal((await call("GET", "/metrics")).status, 401);
  assert.equal(metricsAllowed("Bearer short", "short"), false);
  const token = "t".repeat(40);
  assert.equal(metricsAllowed(`Bearer ${token}`, token), true);
  assert.equal(metricsAllowed(`Bearer ${"u".repeat(40)}`, token), false);
  process.env.METRICS_TOKEN = token;
  const res = await api.request("/metrics", { headers: { authorization: `Bearer ${token}` } });
  delete process.env.METRICS_TOKEN;
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /# TYPE sklubot_bots gauge\nsklubot_bots \d+/);
  assert.match(text, /sklubot_messages_total\{role="user"\} \d+/);
  assert.doesNotMatch(text, /owner@example\.com|Owner/);
  assert.match(prometheusText(usageMetrics(null)), /sklubot_routine_runs_total\{result="failed"\} 0/);
});
