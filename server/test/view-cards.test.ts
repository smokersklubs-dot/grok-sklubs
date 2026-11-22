import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// DS-Bot item 8 (agent/viewcard.ts, viewroutes.ts): show_view — charts, key figures, tables, progress and a small form in
// the chat. The schema is checked (no HTML / script / outside address, sizes, finite numbers, one form, simple ids); a
// card carries a plain-text fallback; a form ends the turn and its answer, checked against its fields, comes back as the
// owner's next message, once; another account cannot answer it.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-viewcards-"));
process.env.SESSION_SECRET = "test-secret-test-secret-view-cards-1";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { checkView, fallbackText, formAnswer } = await import("../src/agent/viewcard.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";
import type { ViewCard } from "../src/viewtypes.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (blocks: Block[]) => blocks.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n");
const seen: string[] = [];
const results: string[] = [];
const FORM = { title: "Réservation", blocks: [{ kind: "text", text: "Choisis ta table." }, { kind: "form", submit: "Réserver", fields: [{ id: "people", label: "Personnes", type: "number", required: true }, { id: "room", label: "Salle", type: "choice", options: ["Terrasse", "Intérieur"] }, { id: "note", label: "Note", type: "text" }, { id: "vegan", label: "Végétarien", type: "checkbox" }] }] };
const SALES = { title: "Ventes de la semaine", blocks: [
  { kind: "stats", items: [{ label: "Chiffre", value: "4 210 €", hint: "+12 %" }, { label: "Commandes", value: "87" }] },
  { kind: "chart", chart: "bar", labels: ["Lun", "Mar", "Mer"], series: [{ name: "Ventes", values: [1200, 1500.5, 1510] }], unit: "€" },
  { kind: "table", columns: ["Produit", "Ventes"], rows: [["Pain", "320"], ["<script>alert(1)</script>", "12"]] },
  { kind: "progress", label: "Objectif du mois", value: 4210, max: 10000 },
] };
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = textOf(last.content);
    seen.push(said);
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    if (last.content.some((b) => b.type === "tool_result")) { results.push(said); return { content: [{ type: "text", text: "noted" }], stopReason: "end", model: "script-1", usage }; }
    if (/SHOWSALES/.test(said)) return use("show_view", SALES);
    if (/SHOWFORM/.test(said)) return use("show_view", FORM);
    if (/SHOWHTML/.test(said)) return use("show_view", { title: "x", blocks: [{ kind: "html", html: "<img src=x onerror=alert(1)>" }] });
    return { content: [{ type: "text", text: `reply to: ${said.slice(-60)}` }], stopReason: "end", model: "script-1", usage };
  },
});

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("a", "GET", `/bots/${id}/rows?limit=500`)).json.rows;
const idle = (id: string) => until(async () => !(await call("a", "GET", "/bots")).json.live[id]?.running, "idle");
const say = async (id: string, text: string) => { const before = seen.length; await call("a", "POST", `/bots/${id}/messages`, { text }); await until(() => seen.length > before, `turn ${text}`); await idle(id); };
const views = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "card" && r.body.card.type === "view");

test("the schema: kinds, sizes, finite numbers, one form, simple ids; anything else refused with a reason", () => {
  const ok = checkView(SALES);
  assert.ok(!("error" in ok));
  if ("error" in ok) return;
  assert.equal(ok.blocks.length, 4);
  assert.equal(ok.interactive, false);
  assert.match((checkView({ title: "x", blocks: [{ kind: "html", html: "<b>" }] }) as any).error, /no HTML or script/);
  assert.match((checkView({ title: "x", blocks: [{ kind: "chart", labels: ["a", "b"], series: [{ name: "s", values: [1, "NaN"] }] }] }) as any).error, /finite number per label/);
  assert.match((checkView({ title: "x", blocks: [{ kind: "chart", labels: ["a"], series: [{ values: [Infinity] }] }] }) as any).error, /finite/);
  assert.match((checkView({ title: "x", blocks: [{ kind: "form", fields: [] }, { kind: "form", fields: [] }] }) as any).error, /at most one form/);
  assert.match((checkView({ title: "x", blocks: [{ kind: "form", fields: [{ id: "Bad Id" }] }] }) as any).error, /own id/);
  assert.match((checkView({ title: "x", blocks: [{ kind: "form", fields: [{ id: "a", type: "choice", options: ["one"] }] }] }) as any).error, /2 to 12 options/);
  assert.match((checkView({ title: "", blocks: [{ kind: "text", text: "a" }] }) as any).error, /title/);
  assert.match((checkView({ title: "x", blocks: Array.from({ length: 9 }, () => ({ kind: "text", text: "a" })) }) as any).error, /1 to 8 blocks/);
  const big = checkView({ title: "x", blocks: [{ kind: "table", columns: Array.from({ length: 12 }, (_, i) => `c${i}`), rows: Array.from({ length: 80 }, () => ["v"]) }] });
  assert.ok(!("error" in big) && big.blocks[0].kind === "table" && big.blocks[0].columns.length === 8 && big.blocks[0].rows.length === 50 && big.blocks[0].rows[0].length === 8, "clipped to 8 columns × 50 rows, short rows padded");
  const p = checkView({ title: "x", blocks: [{ kind: "progress", value: 150, max: 100 }] });
  assert.ok(!("error" in p) && p.blocks[0].kind === "progress" && p.blocks[0].value === 100, "progress clamped");
});

test("fallback text: every block in words, in the owner's language", () => {
  const c = checkView(SALES);
  if ("error" in c) throw new Error(c.error);
  const fr = fallbackText(c.title, c.blocks, true);
  assert.match(fr, /^📊 Ventes de la semaine/);
  assert.match(fr, /• Chiffre : 4 210 € \(\+12 %\)/);
  assert.match(fr, /Ventes : Lun 1200€, Mar 1500\.5€, Mer 1510€/);
  assert.match(fr, /Produit \| Ventes\nPain \| 320/);
  assert.match(fr, /Objectif du mois : 4210 \/ 10000 \(42 %\)/);
  const f = checkView(FORM);
  if ("error" in f) throw new Error(f.error);
  assert.match(fallbackText(f.title, f.blocks, false), /📝 Form \(Personnes, Salle, Note, Végétarien\): answer in the app/);
});

test("form answers are checked against the fields", () => {
  const f = checkView(FORM);
  if ("error" in f) throw new Error(f.error);
  const card: ViewCard = { type: "view", title: f.title, blocks: f.blocks, fallback: "", status: "pending" };
  assert.match((formAnswer(card, {}) as any).error, /“Personnes” is needed/);
  assert.match((formAnswer(card, { people: "beaucoup" }) as any).error, /must be a number/);
  assert.match((formAnswer(card, { people: 2, room: "Cave" }) as any).error, /pick one of the options/);
  assert.deepEqual(formAnswer(card, { people: "4", room: "Terrasse", note: "  près de la fenêtre ", vegan: true, extra: "ignored" }), { text: "Personnes: 4\nSalle: Terrasse\nNote: près de la fenêtre\nVégétarien: yes" });
});

test("in a turn: a view shows; HTML is refused to the bot; a form ends the turn and its answer comes back once; other accounts cannot answer", async () => {
  await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
  const botId = (await call("a", "GET", "/bots")).json.bots[0].id;
  await say(botId, "SHOWSALES");
  const shown = (await views(botId)).at(-1)!;
  assert.ok(shown.body.kind === "card" && shown.body.card.type === "view");
  if (shown.body.kind !== "card" || shown.body.card.type !== "view") return;
  assert.equal(shown.body.card.status, "shown");
  assert.equal(shown.body.card.blocks.length, 4);
  assert.match(shown.body.card.fallback, /Ventes de la semaine/);
  assert.match(results.at(-1)!, /The view is on screen/);
  await say(botId, "SHOWHTML");
  assert.match(results.at(-1)!, /no HTML or script\)\. Nothing was shown/);
  assert.equal((await views(botId)).length, 1);
  const before = seen.length;
  await say(botId, "SHOWFORM");
  const form = (await views(botId)).at(-1)!;
  assert.ok(form.body.kind === "card" && form.body.card.type === "view" && form.body.card.status === "pending");
  assert.equal(seen.length, before + 1, "the form ended the turn: no model call after the tool result");
  assert.equal((await call("a", "POST", `/bots/${botId}/cards/${form.seq}/view`, { values: { room: "Terrasse" } })).json.error, "« Personnes » est à remplir.");
  await call("b", "POST", "/auth/signup", { email: "other@example.com", name: "Other", password: "password-2" });
  assert.equal((await call("b", "POST", `/bots/${botId}/cards/${form.seq}/view`, { values: { people: 2 } })).status, 404);
  const n = seen.length;
  const ok = await call("a", "POST", `/bots/${botId}/cards/${form.seq}/view`, { values: { people: 2, room: "Intérieur", vegan: false } });
  assert.equal(ok.status, 200);
  await until(() => seen.slice(n).some((s) => /Answering your view "Réservation"/.test(s) && /Personnes: 2\nSalle: Intérieur/.test(s)), "the answer reached the bot");
  await idle(botId);
  const after = (await rowsOf(botId)).find((r) => r.seq === form.seq)!;
  assert.ok(after.body.kind === "card" && after.body.card.type === "view" && after.body.card.status === "answered" && /Salle: Intérieur/.test(after.body.card.answer ?? ""));
  assert.equal((await call("a", "POST", `/bots/${botId}/cards/${form.seq}/view`, { values: { people: 3 } })).status, 409, "answered once");
  assert.equal((await call("a", "POST", `/bots/${botId}/cards/${shown.seq}/view`, { values: {} })).status, 400, "a view without a form takes no answer");
});
