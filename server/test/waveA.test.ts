import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-wa-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
// The fake outside services of these tests listen on this machine; outside tests, such addresses are refused.
process.env.ALLOW_PRIVATE_FETCH = "1";
// No container runtime here: commands would run on the server itself, which always asks first.
process.env.SHELL_ENABLED = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.VIDEO_POLL_MS = "30";
for (const k of ["XAI_API_KEY", "VIDEO_XAI_API_KEY", "GEMINI_API_KEY", "VIDEO_PROVIDER", "OPENAI_API_KEY", "IMAGE_API_KEY"]) delete process.env[k];

// ── Fake outside services: a video API in the xAI style and one in the Gemini style, and a Higgsfield-like app behind OAuth ──
const xai = { created: [] as any[], polls: 0, stuck: false };
const gem = { bodies: [] as any[], keys: [] as string[], filePolls: 0, downloadKeys: [] as (string | undefined)[] };
const hf = { base: "", access: new Set<string>(), codes: new Map<string, string>(), calls: [] as string[] };
const local = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString();
  const json = (v: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
  const video = (name: string) => { res.setHeader("content-type", "video/mp4"); res.end(Buffer.from(`fake-mp4-${name}`)); };
  // xAI: POST /v1/videos/generations → request_id; GET /v1/videos/{id} → pending (progress) then done.
  if (url.pathname === "/v1/videos/generations" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer xai-test-key") return json({ error: "bad key" }, 401);
    xai.created.push(JSON.parse(body)); xai.polls = 0;
    return json({ request_id: `req_${xai.created.length}` });
  }
  if (url.pathname.startsWith("/v1/videos/req_")) {
    xai.polls += 1;
    if (xai.stuck || xai.polls < 3) return json({ status: "pending", progress: xai.polls * 30 });
    return json({ status: "done", progress: 100, model: "grok-imagine-video-1.5", video: { url: `${base}/files/xai.mp4`, duration: 6 }, usage: { cost_in_usd_ticks: 5_000_000_000 } });
  }
  if (url.pathname === "/files/xai.mp4") return video("xai");
  // Gemini: POST /v1beta/interactions → video by uri; GET /v1beta/files/{id} until ACTIVE; then the download.
  if (url.pathname === "/v1beta/interactions" && req.method === "POST") {
    gem.keys.push(String(req.headers["x-goog-api-key"])); gem.bodies.push(JSON.parse(body));
    return json({ id: "v1_1", status: "completed", model: "gemini-omni-1.2-flash", object: "interaction", steps: [{ type: "user_input", content: [] }, { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", uri: `${base}/v1beta/files/abc123:download?alt=media` }] }] });
  }
  if (url.pathname === "/v1beta/files/abc123") { gem.filePolls += 1; return json({ name: "files/abc123", state: gem.filePolls < 2 ? "PROCESSING" : "ACTIVE" }); }
  if (url.pathname === "/v1beta/files/abc123:download") { gem.downloadKeys.push(req.headers["x-goog-api-key"] as string | undefined); return video("gemini"); }
  // Higgsfield-like app: OAuth (discovery, dynamic registration, PKCE) and a tool server with a video tool.
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${hf.base}/mcp`, authorization_servers: [hf.base] });
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return json({ issuer: hf.base, authorization_endpoint: `${hf.base}/authorize`, token_endpoint: `${hf.base}/token`, registration_endpoint: `${hf.base}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  if (url.pathname === "/register") return json({ ...JSON.parse(body), client_id: "hf-client" }, 201);
  if (url.pathname === "/authorize") {
    const code = `code_${hf.codes.size + 1}`;
    hf.codes.set(code, url.searchParams.get("code_challenge")!);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", code); back.searchParams.set("state", url.searchParams.get("state")!);
    res.statusCode = 302; res.setHeader("location", back.toString()); res.end(); return;
  }
  if (url.pathname === "/token") {
    const p = Object.fromEntries(new URLSearchParams(body));
    if (hf.codes.get(p.code) !== createHash("sha256").update(p.code_verifier ?? "").digest("base64url")) return json({ error: "invalid_grant" }, 400);
    hf.access.add("hf-token");
    return json({ access_token: "hf-token", refresh_token: "hf-refresh", token_type: "Bearer", expires_in: 3600 });
  }
  if (url.pathname === "/mcp") {
    if (!hf.access.has(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "")) {
      res.statusCode = 401; res.setHeader("www-authenticate", `Bearer resource_metadata="${hf.base}/.well-known/oauth-protected-resource/mcp"`); res.end(); return;
    }
    const mcp = new McpServer({ name: "higgsfield-fake", version: "1.0.0" });
    mcp.registerTool("generate_video", { description: "Start a video generation", inputSchema: {} }, async () => { hf.calls.push("generate_video"); return { content: [{ type: "text", text: "job_42 started" }] }; });
    mcp.registerTool("job_status", { description: "Status of a generation job", inputSchema: {} }, async () => { hf.calls.push("job_status"); return { content: [{ type: "text", text: `job_42 done: ${hf.base}/hf/clip_42.mp4` }] }; });
    mcp.registerTool("balance", { description: "Credits left", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "120 credits" }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    return;
  }
  if (url.pathname === "/hf/clip_42.mp4") return video("higgsfield");
  if (url.pathname === "/elsewhere.mp4") return video("elsewhere");
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
hf.base = base;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { connectors } = await import("../src/connectors.js");
const { screen } = await import("../src/computer.js");
const { policies } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { RfbClientParser, describeKey } = await import("../src/rfb.js");
const { keyFrames, MAX_RECORDING_MS, recordingDir, SKILL_FROM_DEMO } = await import("../src/teach.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

/** Scripted model, as in the other suites: "call T {json}" → one tool; "chain A {…} >> B {…}" → tools in turn; else echoes. */
const requests: TurnRequest[] = [];
const queue: { name: string; input: any }[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    if (req.system.includes(SKILL_FROM_DEMO)) {
      const words = req.messages[0].content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const clicks = (words.match(/clicked at/g) ?? []).length;
      return { content: [{ type: "text", text: `Here it is:\n{"name": "Export the invoices", "when": "When the user asks for this month's invoices", "steps": ["Open the billing page", "Click Export (${clicks} clicks seen)", "Type the month and press Enter"]}` }], stopReason: "end", model: "script-1", usage };
    }
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const use = (t: { name: string; input: any }): Block[] => [{ type: "tool_use", id: `call_${requests.length}`, name: t.name, input: t.input }];
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = queue.length ? use(queue.shift()!) : [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const parse = (s: string) => { const m = /(\w+) (\{[^\n]*?\})(?=\s*(>>|\n|$))/.exec(s)!; return { name: m[1], input: JSON.parse(m[2]) }; };
      if (said.includes("chain ")) { const steps = said.slice(said.indexOf("chain ") + 6).split(" >> ").map(parse); queue.push(...steps.slice(1)); content = use(steps[0]); }
      else if (/call \w+ \{/.test(said)) content = use(parse(said.slice(said.indexOf("call ") + 5)));
      else content = [{ type: "text", text: `Echo: ${said}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
};
registerProvider(scripted);
after(async () => { await connectors.closeAll(); local.closeAllConnections(); local.close(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const rowsOf = async (botId: string, thread = 0): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows${thread ? `?thread=${thread}` : ""}`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming && r.body.text);
const replied = (bot: Bot, part: string, thread = 0) => until(async () => { const r = lastAssistant(await rowsOf(bot.id, thread)); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply containing "${part}"`);
const say = (bot: Bot, text: string, thread?: number) => call("POST", `/bots/${bot.id}/messages`, { text, thread });
const pendingApproval = (bot: Bot, thread = 0) => until(async () => { const r = (await rowsOf(bot.id, thread)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval");
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running && !r.json.live?.[bot.id]?.awaiting; }, "bot idle");
const userText = (req: TurnRequest) => req.messages.flatMap((m) => m.content).filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");

let bot: Bot;
let userId = "";

test("setup", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  assert.ok(bot);
});

// ── Reactions ────────────────────────────────────────────────────────────────
test("reactions: the user reacts to any message, can take it back, and the bot hears about it in its next turn", async () => {
  await say(bot, "Hello there");
  const reply = await replied(bot, "Echo: Hello there");
  const mine = (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.role === "user")!;

  assert.equal((await call("POST", `/bots/${bot.id}/rows/${reply.seq}/reactions`, { emoji: "💩" })).status, 400, "only the small set");
  const notice = (await rowsOf(bot.id)).find((r) => r.body.kind !== "message");
  if (notice) assert.equal((await call("POST", `/bots/${bot.id}/rows/${notice.seq}/reactions`, { emoji: "👍" })).status, 400, "only messages");

  // On the user's own message: shown, but nobody's feedback.
  const onMine = await call("POST", `/bots/${bot.id}/rows/${mine.seq}/reactions`, { emoji: "👀" });
  assert.deepEqual(onMine.json.reactions, [{ emoji: "👀", by: "user", name: "Léa" }]);

  // On the bot's reply: shown under it, and queued as feedback. Taken back → forgotten; put again → kept.
  await call("POST", `/bots/${bot.id}/rows/${reply.seq}/reactions`, { emoji: "🎉" });
  const off = await call("POST", `/bots/${bot.id}/rows/${reply.seq}/reactions`, { emoji: "🎉" });
  assert.deepEqual(off.json.reactions, []);
  await call("POST", `/bots/${bot.id}/rows/${reply.seq}/reactions`, { emoji: "👍" });
  const shown = (await rowsOf(bot.id)).find((r) => r.seq === reply.seq)!;
  assert.deepEqual(shown.body.kind === "message" && shown.body.reactions, [{ emoji: "👍", by: "user", name: "Léa" }]);

  const before = requests.length;
  await say(bot, "Next one");
  await replied(bot, "Echo: Next one");
  const sent = userText(requests[before]);
  assert.match(sent, /The user reacted 👍 to your message "Echo: Hello there"/);
  assert.doesNotMatch(sent, /🎉/, "a reaction taken back is not reported");
  // Feedback is handed over once.
  await say(bot, "And again");
  await replied(bot, "Echo: And again");
  assert.doesNotMatch(userText({ ...requests[requests.length - 1], messages: requests[requests.length - 1].messages.slice(-1) }), /reacted/);

  // A later reply keeps its reactions when the row is rewritten (e.g. the thread count changes).
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback")!.n, 0);
});

test("reactions: the bot reacts with message_react, cheaply, to the user's message", async () => {
  await say(bot, 'call message_react {"emoji": "🙏"}');
  await replied(bot, "Reaction added");
  const list = await rowsOf(bot.id);
  const target = [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "user")!;
  assert.deepEqual(target.body.kind === "message" && target.body.reactions, [{ emoji: "🙏", by: bot.id, name: bot.name }]);
  // Only the allowed set.
  await say(bot, 'call message_react {"emoji": "🍕"}');
  await idle(bot);
  const step = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "step" && r.body.tool === "message_react")!;
  assert.equal(step.body.kind === "step" && step.body.status, "error");
});

// ── Threads ──────────────────────────────────────────────────────────────────
test("threads: a reply in a thread stays out of the main chat, has its own context, and shows as N replies", async () => {
  await say(bot, "The quarterly plan is ready");
  const parent = await replied(bot, "Echo: The quarterly plan is ready");
  const mainBefore = (await rowsOf(bot.id)).length;

  assert.equal((await say(bot, "nope", 999_999)).status, 400, "no thread on a message that does not exist");
  const before = requests.length;
  const r = await say(bot, "What about Q3?", parent.seq);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.row.thread, parent.seq);
  await replied(bot, "Echo: What about Q3?", parent.seq);

  // Context: the parent message plus the thread, not the rest of the main chat.
  const req = requests[before];
  const seen = userText(req);
  assert.match(seen, /This is a thread/);
  assert.match(seen, /Echo: The quarterly plan is ready/);
  assert.doesNotMatch(seen, /Hello there/, "the main chat is not in the thread's context");

  // The main chat is unchanged except for the "N replies" line under the parent.
  const main = await rowsOf(bot.id);
  assert.equal(main.length, mainBefore);
  assert.ok(main.every((x) => !x.thread));
  const p = main.find((x) => x.seq === parent.seq)!;
  assert.equal(p.body.kind === "message" && p.body.replies?.count, 2);
  const thread = await rowsOf(bot.id, parent.seq);
  assert.deepEqual(thread.filter((x) => x.body.kind === "message").map((x) => x.body.kind === "message" && x.body.text), ["What about Q3?", "Echo: What about Q3?"]);
  assert.ok(thread.every((x) => x.thread === parent.seq));
  assert.equal((await say(bot, "nested?", thread[0].seq)).status, 400, "no thread inside a thread");

  // A second message in the thread continues the thread's own history.
  const before2 = requests.length;
  await say(bot, "And Q4?", parent.seq);
  await replied(bot, "Echo: And Q4?", parent.seq);
  const seen2 = userText(requests[before2]);
  assert.match(seen2, /What about Q3\?/);
  assert.equal((seen2.match(/This is a thread/g) ?? []).length, 1);

  // The main conversation goes on without the thread in it.
  const before3 = requests.length;
  await say(bot, "Back to the main chat");
  await replied(bot, "Echo: Back to the main chat");
  assert.doesNotMatch(userText(requests[before3]), /What about Q3/);
  // A reaction on the parent survives the count being refreshed.
  await call("POST", `/bots/${bot.id}/rows/${parent.seq}/reactions`, { emoji: "❤️" });
  await say(bot, "One more", parent.seq);
  await replied(bot, "Echo: One more", parent.seq);
  const p2 = (await rowsOf(bot.id)).find((x) => x.seq === parent.seq)!;
  assert.equal(p2.body.kind === "message" && p2.body.replies?.count, 6);
  assert.deepEqual(p2.body.kind === "message" && p2.body.reactions?.map((x) => x.emoji), ["❤️"]);
});

test("threads: approvals and tool results stay in the thread; search, history and export include threads; a reset clears them", async () => {
  await say(bot, "Let's check the server");
  const parent = await replied(bot, "Echo: Let's check the server");
  await say(bot, 'call shell_run {"command": "echo thread-ok"}', parent.seq);
  const card = await pendingApproval(bot, parent.seq);
  assert.ok(!(await rowsOf(bot.id)).some((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"), "the card is in the thread");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await replied(bot, "thread-ok", parent.seq);
  assert.ok(!(await rowsOf(bot.id)).some((x) => x.body.kind === "step" && x.body.tool === "shell_run"), "no steps in the main chat");

  const hits = (await call("GET", "/search?q=thread-ok")).json.hits;
  assert.ok(hits.some((h: any) => h.thread === parent.seq));
  const gen = (await call("GET", `/bots/${bot.id}/rows`)).json.generation;
  const hist = (await call("GET", `/bots/${bot.id}/history/${gen}`)).json.rows as Row[];
  assert.ok(hist.some((x) => x.thread === parent.seq));
  const exp = (await call("GET", "/export/data")).json;
  const conv = exp.bots.find((b: any) => b.id === bot.id).conversations.at(-1).rows;
  assert.ok(conv.some((x: any) => x.thread === parent.seq && x.role === "user"));

  await call("POST", `/bots/${bot.id}/reset`);
  assert.deepEqual(await rowsOf(bot.id, parent.seq), [], "a new conversation has no threads");
  assert.equal((await say(bot, "old thread", parent.seq)).status, 400);
  const fresh = await say(bot, "Fresh start");
  assert.equal(fresh.status, 200);
  await replied(bot, "Echo: Fresh start");
});

test("threads in a group chat: mention routing inside the thread, and replies posted into it", async () => {
  const mk = async (name: string) => (await call("POST", "/bots", { name })).json.bot as Bot;
  const ana = await mk("Ana"), ben = await mk("Ben");
  const created = await call("POST", "/rooms", { name: "Crew", botIds: [ana.id, ben.id] });
  assert.equal(created.status, 200, created.text);
  const room = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.id === created.json.id) as Bot;
  // Ana (the lead) answers in the main room chat.
  await say(room, `call room_post {"room": "Crew", "text": "Kickoff notes"}`);
  const kickoff = await until(async () => (await rowsOf(room.id)).find((r) => r.body.kind === "message" && r.body.text === "Kickoff notes"), "kickoff");

  // In the thread, @Ben is brought in; he is told it is a thread and answers inside it.
  const before = requests.length;
  await say(room, `@Ben call room_post {"room": "Crew", "text": "Ben in thread", "thread": ${kickoff.seq}}`, kickoff.seq);
  const inThread = await until(async () => (await rowsOf(room.id, kickoff.seq)).find((r) => r.body.kind === "message" && r.body.text === "Ben in thread"), "thread answer");
  assert.equal(inThread.body.kind === "message" && inThread.body.origin?.name, "Ben");
  const told = requests.slice(before).map(userText).find((t) => t.includes("thread number"))!;
  assert.match(told, new RegExp(`thread number ${kickoff.seq}`));
  assert.match(told, /Kickoff notes/);
  assert.ok(!(await rowsOf(room.id)).some((r) => r.body.kind === "message" && r.body.text === "Ben in thread"), "not in the main room chat");
  const p = (await rowsOf(room.id)).find((r) => r.seq === kickoff.seq)!;
  assert.equal(p.body.kind === "message" && p.body.replies?.count, 2);

  // Without a mention, the bots already in the thread answer (here Ana, who wrote the message, and Ben).
  const b2 = requests.length;
  await say(room, "Any risks?", kickoff.seq);
  await until(() => requests.slice(b2).filter((r) => userText(r).includes("Any risks?")).length >= 2, "both thread members asked");

  // Reacting to a member's message in the room reaches that member as feedback.
  await call("POST", `/bots/${room.id}/rows/${kickoff.seq}/reactions`, { emoji: "👍" });
  assert.match(q.get<{ text: string }>("SELECT text FROM feedback WHERE bot_id = ?", ana.id)!.text, /in the group chat "Crew"/);
});

// ── Video generation ─────────────────────────────────────────────────────────
const toolNames = (req: TurnRequest) => req.tools.map((t) => t.name);

test("video: not offered without a provider; settings report how videos are made", async () => {
  const me = (await call("GET", "/me")).json;
  assert.deepEqual(me.video, { provider: null, higgsfield: false });
  const before = requests.length;
  await say(bot, "Make me a clip");
  await replied(bot, "Echo: Make me a clip");
  assert.ok(!toolNames(requests[before]).includes("video_generate"));
  assert.ok(!toolNames(requests[before]).includes("media_save"));
  assert.doesNotMatch(requests[before].system, /video_generate/);
});

test("video (xAI): asks the first time per bot, polls with progress, saves the file, shows a player, records the cost", async () => {
  process.env.XAI_API_KEY = "xai-test-key";
  process.env.XAI_BASE_URL = `${base}/v1`;
  assert.equal((await call("GET", "/me")).json.video.provider, "xai");
  await say(bot, 'call video_generate {"prompt": "A paper boat on a rainy street", "duration_seconds": 6, "aspect_ratio": "9:16", "filename": "boat"}');
  const card = await pendingApproval(bot);
  assert.equal(card.tool, `video_generate: ${bot.name}`);
  assert.match(card.title, /créer une vidéo/);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "always" });
  const done = await replied(bot, "Created and shown");
  assert.match(done.body.kind === "message" ? done.body.text : "", /\$0\.50/);
  assert.deepEqual(xai.created.at(-1), { model: "grok-imagine-video-1.5", prompt: "A paper boat on a rainy street", duration: 6, aspect_ratio: "9:16" });
  assert.ok(xai.polls >= 3, "polled until done");
  const msg = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.attachments?.length)!;
  const att = msg.body.kind === "message" ? msg.body.attachments![0] : null;
  assert.equal(att?.mime, "video/mp4");
  assert.match(att!.path, /^videos\/boat.*\.mp4$/);
  const view = await call("GET", `/bots/${bot.id}/files/view?path=${encodeURIComponent(att!.path)}`);
  assert.equal(view.headers.get("content-type"), "video/mp4");
  assert.match(view.headers.get("content-disposition") ?? "", /^inline/);
  assert.equal(view.text, "fake-mp4-xai");
  // Seeking: the player asks for a byte range.
  const part = await api.request(`/bots/${bot.id}/files/view?path=${encodeURIComponent(att!.path)}`, { headers: { cookie, range: "bytes=2-5" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-5/12");
  assert.equal(await part.text(), "ke-m");
  const cost = q.get<{ c: number }>("SELECT cost_usd AS c FROM usage WHERE model = 'grok-imagine-video-1.5'")!.c;
  assert.equal(cost, 0.5);
  // "Always" for this bot: the next video goes ahead without a card.
  await say(bot, 'call video_generate {"prompt": "Again"}');
  await replied(bot, "Created and shown");
});

test("video: a stopped turn stops the polling; the video tool family can be switched off", async () => {
  xai.stuck = true;
  await say(bot, 'call video_generate {"prompt": "Never ends"}');
  await until(async () => (await call("GET", "/bots")).json.live?.[bot.id]?.activity?.kind === "filming", "filming activity");
  const live = (await call("GET", "/bots")).json.live[bot.id];
  assert.ok(live.activity.detail === undefined || /^\d+$/.test(live.activity.detail), "progress as a number");
  await call("POST", `/bots/${bot.id}/stop`);
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "notice" && /Arrêté/.test(r.body.text)), "stopped");
  const polls = xai.polls;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(xai.polls, polls, "no more polling after the stop");
  xai.stuck = false;

  await call("PATCH", `/bots/${bot.id}`, { disabledTools: ["video"] });
  const before = requests.length;
  await say(bot, "anything");
  await replied(bot, "Echo: anything");
  assert.ok(!toolNames(requests[before]).includes("video_generate"));
  await call("PATCH", `/bots/${bot.id}`, { disabledTools: [] });
});

test("video (Gemini): the video comes back by address, is polled until ready, and the key only goes to the API", async () => {
  process.env.VIDEO_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "gem-test-key";
  process.env.GEMINI_BASE_URL = base;
  policies.set(userId, `video_generate: ${bot.name}`, "always_allow");
  await say(bot, 'call video_generate {"prompt": "A marble on a track", "duration_seconds": 20, "aspect_ratio": "16:9"}');
  await replied(bot, "Created and shown");
  assert.deepEqual(gem.bodies.at(-1), { model: "gemini-omni-1.2-flash", input: "A marble on a track", response_format: { type: "video", delivery: "uri", aspect_ratio: "16:9", duration: "15s" } });
  assert.equal(gem.keys.at(-1), "gem-test-key");
  assert.ok(gem.filePolls >= 2);
  assert.equal(gem.downloadKeys.at(-1), "gem-test-key", "same host as the API");
  delete process.env.VIDEO_PROVIDER; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL;
});

test("video through Higgsfield (OAuth app): preferred over the API, tools discovered at run time, result saved with media_save", async () => {
  const added = await call("POST", "/connectors", { name: "Higgsfield", url: `${base}/mcp`, auth: "oauth" });
  assert.equal(added.status, 200, added.text);
  const id = added.json.connector.id;
  const start = await call("POST", `/connectors/${id}/oauth/start`, {});
  const back = new URL((await fetch(start.json.authorizeUrl, { redirect: "manual" })).headers.get("location")!);
  assert.equal((await call("GET", `/connectors/oauth/callback${back.search}`)).status, 200);
  assert.equal((await call("GET", "/me")).json.video.higgsfield, true);

  // The router names the app's own tools (discovered, not hard-coded) and says it spends the user's credits.
  const before = requests.length;
  await say(bot, 'call video_generate {"prompt": "A neon city at night"}');
  const routed = await replied(bot, "Higgsfield");
  const text = routed.body.kind === "message" ? routed.body.text : "";
  assert.match(text, /app_higgsfield__generate_video/);
  assert.match(text, /app_higgsfield__job_status/);
  assert.match(text, /credits/);
  assert.match(requests[before].system, /Higgsfield app/);
  assert.ok(!(await rowsOf(bot.id)).some((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "the router itself costs nothing and asks nothing");

  // The bot works with the app's tools, then saves the address the app gave: no extra question for that address.
  policies.set(userId, "Higgsfield: generate_video", "always_allow");
  policies.set(userId, "Higgsfield: job_status", "always_allow");
  // (The addresses are queued for the scripted model, so the user never names them: only the app does.)
  queue.push({ name: "app_higgsfield__job_status", input: {} }, { name: "media_save", input: { url: `${base}/hf/clip_42.mp4`, filename: "neon" } });
  await say(bot, "call app_higgsfield__generate_video {}");
  await replied(bot, "with a player");
  assert.deepEqual(hf.calls.slice(-2), ["generate_video", "job_status"]);
  const msg = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.attachments?.length)!;
  assert.match(msg.body.kind === "message" ? msg.body.attachments![0].path : "", /^videos\/neon.*\.mp4$/);

  // After reading the app's output, saving from another address asks first (it could carry data out).
  queue.push({ name: "media_save", input: { url: `${base}/elsewhere.mp4` } });
  await say(bot, "call app_higgsfield__job_status {}");
  const card = await pendingApproval(bot);
  assert.match(card.tool, /^web: 127\.0\.0\.1$/);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await idle(bot);
  await connectors.remove(userId, id);
});

test("the catalogue offers Higgsfield (sign-in, Creation) and says it spends the subscription's credits", async () => {
  const apps = (await call("GET", "/connectors/catalog")).json.apps;
  const h = apps.find((a: any) => a.id === "higgsfield");
  assert.equal(h.url, "https://mcp.higgsfield.ai/mcp");
  assert.equal(h.auth, "oauth");
  assert.equal(h.oauthClient, "dynamic");
  assert.equal(h.category, "Création");
  assert.match(h.description + h.tokenHelp, /crédits Higgsfield/);
});

// ── Learning a skill from a demonstration ────────────────────────────────────
function rfbBytes(): Buffer[] {
  const key = (down: boolean, sym: number) => { const b = Buffer.alloc(8); b[0] = 4; b[1] = down ? 1 : 0; b.writeUInt32BE(sym, 4); return b; };
  const ptr = (buttons: number, x: number, y: number) => { const b = Buffer.alloc(6); b[0] = 5; b[1] = buttons; b.writeUInt16BE(x, 2); b.writeUInt16BE(y, 4); return b; };
  const setEnc = Buffer.from([2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1]);
  const fbur = Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]);
  // What noVNC really sends after the handshake: an Extended Clipboard capabilities message (negative length).
  const clip = Buffer.from("06000000fffffff81f000001000000000000000000000000".slice(0, 32), "hex");
  const secret = [..."hunter2!"].flatMap((ch) => [key(true, ch.charCodeAt(0)), key(false, ch.charCodeAt(0))]);
  const all = Buffer.concat([
    Buffer.from("RFB 003.008\n"), Buffer.from([1]), Buffer.from([1]), setEnc, clip, fbur,
    ptr(0, 100, 100), ptr(1, 640, 410), ptr(0, 640, 410),
    ...secret,
    key(true, 0xffe3), key(true, 0x6c), key(false, 0x6c), key(false, 0xffe3), // ctrl+l
    key(true, 0xff0d), key(false, 0xff0d), // Enter
    ptr(16, 300, 300), ptr(0, 300, 300),
  ]);
  // Delivered in awkward pieces, as a socket would.
  const parts: Buffer[] = [];
  for (let i = 0; i < all.length; i += 7) parts.push(all.subarray(i, i + 7));
  return parts;
}

test("the screen proxy's RFB reader: handshake, split messages, pointer and keys; unknown messages stop it safely", () => {
  const p = new RfbClientParser();
  const events = rfbBytes().flatMap((b) => p.push(b));
  assert.equal(events.filter((e) => e.type === "pointer").length, 5);
  assert.equal(events.filter((e) => e.type === "key").length, 16 + 4 + 2);
  assert.equal(p.lost, false);
  const q2 = new RfbClientParser();
  q2.push(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1]), Buffer.from([99, 1, 2, 3])]));
  assert.equal(q2.lost, true);
  assert.deepEqual(q2.push(Buffer.from([5, 1, 0, 1, 0, 1])), [], "a lost reader reads nothing more");
  // Printable characters are never kept; shortcuts and special keys are.
  assert.deepEqual(describeKey("a".charCodeAt(0), new Set()), { kind: "typed" });
  assert.deepEqual(describeKey("a".charCodeAt(0), new Set(["ctrl"])), { kind: "named", name: "ctrl+a" });
  assert.deepEqual(describeKey(0xff0d, new Set()), { kind: "named", name: "Enter" });
  assert.deepEqual(keyFrames([{ t: 0 }, { t: 1000 }, { t: 2000 }, { t: 3000 }], [{ t: 1200, text: "clicked at (1, 2)" }]), [0, 2, 3]);
  assert.equal(MAX_RECORDING_MS, 10 * 60_000);
});

test("show me how: record a demonstration, the bot drafts a skill, the user edits and saves it; files are deleted", async () => {
  // A screen that is on, as far as the recorder can tell (no browser engine in this test).
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300, n)]);
  let shot = 0;
  const saved = { isOpen: screen.isOpen, frame: screen.frame, where: screen.where, type: screen.type };
  screen.isOpen = () => true;
  screen.type = async () => ({ data: "", mediaType: "image/jpeg", url: "", title: "" });
  screen.frame = async () => jpeg(++shot);
  screen.where = async () => ({ title: "Billing — Acme", url: "https://billing.example/invoices" });
  try {
    const started = await call("POST", `/bots/${bot.id}/teach/start`);
    assert.equal(started.status, 200, started.text);
    assert.equal(started.json.recording.status, "recording");
    assert.equal(started.json.recording.maxMs, 600_000);
    assert.equal((await call("POST", `/bots/${bot.id}/teach/start`)).status, 409, "one at a time");
    const dir = recordingDir(bot.id)!;
    assert.ok(dir.startsWith(path.join(process.env.DATA_DIR!, "recordings")), "outside the bot's library");

    // Input through the live screen (RFB) and through the screenshot viewer.
    const { noteRfb } = await import("../src/teach.js");
    const p = new RfbClientParser();
    for (const part of rfbBytes()) for (const ev of p.push(part)) noteRfb(bot.id, ev);
    await call("POST", `/bots/${bot.id}/screen/input`, { type: "type", text: "s3cret-pass" });
    await new Promise((r) => setTimeout(r, 900));

    const stopped = await call("POST", `/bots/${bot.id}/teach/stop`, { note: "Monthly invoice export" });
    assert.equal(stopped.status, 200, stopped.text);
    const review = await until(async () => { const r = (await call("GET", `/bots/${bot.id}/teach`)).json.recording; return r?.status === "review" && r; }, "draft");
    assert.equal(review.draft.name, "Export the invoices");
    assert.match(review.draft.steps, /^1\. Open the billing page\n2\. Click Export/);

    // What the model was given: a few downscaled key frames and a timeline without any typed character.
    const req = [...requests].reverse().find((r) => r.system.includes(SKILL_FROM_DEMO))!;
    const images = req.messages[0].content.filter((b) => b.type === "image");
    assert.ok(images.length >= 2 && images.length <= 6, `key frames: ${images.length}`);
    const words = userText(req);
    assert.match(words, /clicked at \(640, 410\)/);
    assert.match(words, /pressed ctrl\+l/);
    assert.match(words, /pressed Enter/);
    assert.match(words, /typed 8 characters/);
    assert.match(words, /typed 11 characters/);
    assert.match(words, /scrolled down/);
    assert.match(words, /page: Billing — Acme — https:\/\/billing\.example\/invoices/);
    assert.match(words, /Monthly invoice export/);
    for (const secret of ["hunter2", "s3cret"]) assert.ok(!JSON.stringify(req).includes(secret), `no typed text (${secret}) reaches the model`);

    // The user edits, then saves: a skill (skill_save semantics), a line in the chat, and the files are gone.
    const save = await call("POST", `/bots/${bot.id}/teach/save`, { name: "Export invoices", when: "Each month", steps: "1. Open billing\n2. Export" });
    assert.equal(save.status, 200, save.text);
    const sk = (await call("GET", `/bots/${bot.id}/bundle`)).json.skills.find((s: any) => s.name === "Export invoices");
    assert.equal(sk.body, "1. Open billing\n2. Export");
    assert.equal(sk.description, "Each month");
    assert.equal(existsSync(dir), false, "recording deleted after saving");
    assert.equal((await call("GET", `/bots/${bot.id}/teach`)).json.recording, null);
    assert.ok((await rowsOf(bot.id)).some((r) => r.body.kind === "event" && /démonstration : Export invoices/.test(r.body.text)));

    // Saving under the same name replaces the skill; discarding deletes the recording too.
    await call("POST", `/bots/${bot.id}/teach/start`);
    const dir2 = recordingDir(bot.id)!;
    await call("POST", `/bots/${bot.id}/teach/stop`, {});
    await until(async () => (await call("GET", `/bots/${bot.id}/teach`)).json.recording?.status === "review", "second draft");
    await call("POST", `/bots/${bot.id}/teach/save`, { name: "export INVOICES", when: "", steps: "1. New way" });
    const again = (await call("GET", `/bots/${bot.id}/bundle`)).json.skills.filter((s: any) => s.name.toLowerCase() === "export invoices");
    assert.equal(again.length, 1);
    assert.equal(again[0].body, "1. New way");
    assert.equal(existsSync(dir2), false);
    await call("POST", `/bots/${bot.id}/teach/start`);
    const dir3 = recordingDir(bot.id)!;
    await call("POST", `/bots/${bot.id}/teach/discard`);
    assert.equal(existsSync(dir3), false, "recording deleted when discarded");
  } finally { Object.assign(screen, saved); }
  // Without a screen that is on, nothing can be recorded.
  assert.equal((await call("POST", `/bots/${bot.id}/teach/start`)).status, 409);
});
