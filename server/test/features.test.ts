import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-feat-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

// A stand-in picture service and a page with a sign-in field, both on this machine.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const imageCalls: any[] = [];
const local = createServer(async (req, res) => {
  if (req.url === "/v1/images/generations") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    imageCalls.push({ auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(`<title>Login</title><input id="p" autofocus oninput="document.getElementById('echo').textContent='You typed: '+this.value"><div id="echo">nothing yet</div>`);
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const port = (local.address() as { port: number }).port;
process.env.IMAGE_API_KEY = "img-key";
process.env.IMAGE_BASE_URL = `http://127.0.0.1:${port}/v1`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { closeAllDesktops, initComputer, browserAvailable } = await import("../src/computer.js");
await initComputer();
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const requests: TurnRequest[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = texts[texts.length - 1] ?? "";
      const m = /call (\w+) (\{.*\})/s.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
};
registerProvider(scripted);
after(async () => { await closeAllDesktops(); local.closeAllConnections(); local.close(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming);
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const replied = (bot: Bot, part: string) => until(async () => { const r = lastAssistant(await rowsOf(bot.id)); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply containing "${part}"`);

let bot: Bot;

test("a French account gets French texts from the server and French-speaking bots", async () => {
  const res = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "motdepasse1", locale: "fr" });
  assert.equal(res.json.user.locale, "fr");
  bot = (await call("GET", "/bots")).json.bots[0];
  assert.equal(bot.label, "Bras droit");
  await say(bot, 'call routine_create {"name":"Point du matin","prompt":"Résume ma journée.","kind":"cron","schedule":"0 9 * * 1-5","timezone":"Europe/Paris"}');
  const routine = await until(async () => (await call("GET", `/bots/${bot.id}/routines`)).json.routines[0], "routine");
  assert.equal(routine.describe, "En semaine à 9 h 00");
  assert.ok((await rowsOf(bot.id)).some((r) => r.body.kind === "event" && r.body.text === "Routine créée : Point du matin — En semaine à 9 h 00"));
  assert.ok((await rowsOf(bot.id)).some((r) => r.body.kind === "step" && r.body.label === "Prépare une routine"));
  assert.match(requests[requests.length - 1].system, /Write to the user in French/);
  assert.equal((await call("PUT", "/prefs", { locale: "en" })).json.user.locale, "en");
  assert.equal((await call("GET", `/bots/${bot.id}/routines`)).json.routines[0].describe, "Weekdays at 9:00 AM");
  await call("PUT", "/prefs", { locale: "fr" });
});

test("an attached picture is seen by the bot; other files land in its library; nothing uploaded can run as a page", async () => {
  const upload = async (name: string, type: string, bytes: Buffer) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    const res = await api.request(`/bots/${bot.id}/uploads`, { method: "POST", headers: { cookie }, body: form });
    return (await res.json()) as any;
  };
  const pic = (await upload("photo.png", "image/png", PNG)).attachment;
  const page = (await upload("evil.html", "text/html", Buffer.from("<script>alert(1)</script>"))).attachment;
  assert.equal(pic.path, "uploads/photo.png");
  assert.equal((await upload("photo.png", "image/png", PNG)).attachment.path, "uploads/photo-2.png", "an upload never overwrites");
  const sent = await call("POST", `/bots/${bot.id}/messages`, { text: "", attachments: [pic.path, page.path, "../../etc/passwd", "notes/secret.md"] });
  assert.deepEqual(sent.json.row.body.attachments.map((a: any) => a.name), ["photo.png", "evil.html"]);
  await replied(bot, "Echo:");
  const lastUser = requests[requests.length - 1].messages.at(-1)!;
  assert.equal(lastUser.content.filter((b) => b.type === "image").length, 1, "the picture reaches the model");
  assert.match(lastUser.content.map((b) => (b.type === "text" ? b.text : "")).join(""), /uploads\/evil\.html \(text\/html/);
  const view = await api.request(`/bots/${bot.id}/files/view?path=${encodeURIComponent(pic.path)}`, { headers: { cookie } });
  assert.equal(view.headers.get("content-type"), "image/png");
  const html = await api.request(`/bots/${bot.id}/files/view?path=${encodeURIComponent(page.path)}`, { headers: { cookie } });
  assert.equal(html.headers.get("content-type"), "application/octet-stream");
  assert.match(html.headers.get("content-disposition")!, /^attachment/);
  assert.equal((await call("POST", `/bots/${bot.id}/messages`, { text: "" })).status, 400);
});

test("a bot can send a file and create a picture", async () => {
  await say(bot, 'call file_save {"filename":"rapport.md","content":"# Rapport"}');
  await replied(bot, "Saved as rapport.md");
  await say(bot, 'call file_send {"path":"rapport.md","caption":"Voici le rapport"}');
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "message" && r.body.text === "Voici le rapport" && r.body.attachments?.[0].name === "rapport.md"), "file in chat");
  await say(bot, 'call image_generate {"prompt":"a red fox in the snow","filename":"renard"}');
  const row = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.attachments?.[0]?.path === "images/renard.png"), "picture in chat");
  assert.equal(row.body.kind === "message" && row.body.attachments![0].mime, "image/png");
  assert.deepEqual(imageCalls[0], { auth: "Bearer img-key", body: { model: "gpt-image-1", prompt: "a red fox in the snow", n: 1 } });
  assert.equal((await call("GET", "/me")).json.imageGeneration, true);
});

test("the vault lets a bot type a password it never sees", { skip: !browserAvailable() && "no browser engine installed" }, async () => {
  const SECRET = "Tr0ub4dor&3-very-secret";
  assert.equal((await call("POST", "/vault", { name: "", password: "x" })).status, 400);
  const made = await call("POST", "/vault", { name: "Banque", site: "banque.example", username: "lea", password: SECRET });
  assert.equal(JSON.stringify(made.json).includes(SECRET), false);
  assert.equal(made.json.item.hasPassword, true);
  assert.equal(JSON.stringify((await call("GET", "/vault")).json).includes(SECRET), false);
  await call("PATCH", `/vault/${made.json.item.id}`, { note: "compte pro" });
  assert.equal((await call("GET", "/vault")).json.items[0].hasPassword, true, "editing without a password keeps it");

  await say(bot, "call vault_list {}");
  const listed = await replied(bot, "Banque");
  assert.equal(listed.body.kind === "message" && listed.body.text.includes(SECRET), false);

  await say(bot, `call browser_open {"url":"http://127.0.0.1:${port}/login"}`);
  await replied(bot, "Opened");
  await say(bot, 'call vault_type {"item":"Banque","field":"password"}');
  const card = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "vault approval");
  const c = card.body.kind === "card" && card.body.card.type === "approval" ? card.body.card : null;
  assert.equal(c!.title, "Autoriser Juno à saisir le mot de passe enregistré pour Banque ?");
  assert.equal(c!.source, "Coffre");
  assert.equal(c!.tool, "vault: Banque");
  await call("POST", `/approvals/${c!.approvalId}`, { decision: "allow" });
  await replied(bot, "Typed the saved password");
  // The page now displays what was typed. Reading it back must not reveal the password to the model.
  await say(bot, "call page_read {}");
  const read = await replied(bot, "You typed:");
  assert.match(read.body.kind === "message" ? read.body.text : "", /You typed: \[hidden\]/);
  assert.equal(JSON.stringify(requests).includes(SECRET), false, "the password never appeared in anything sent to the model");
  assert.equal(JSON.stringify(await rowsOf(bot.id)).includes(SECRET), false, "nor in the chat");
});

test("the catalogue lists one-step apps", async () => {
  const apps = (await call("GET", "/connectors/catalog")).json.apps;
  assert.ok(apps.length >= 5);
  assert.ok(apps.every((a: any) => /^https:\/\//.test(a.url) && (a.auth === "none" || a.tokenHelp)));
});
