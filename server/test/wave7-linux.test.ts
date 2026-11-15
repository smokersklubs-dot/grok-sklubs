import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { serve } from "@hono/node-server";

// Wave 7 on a real bot computer (the desktop image): Agent Reach is installed and answers, and a program calls an API
// through the credential relay without the key ever entering the computer.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w7l-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "auto";
process.env.MAX_DESKTOPS = "1";
// The fake API listens on this machine (the relay calls it from the server, never from the computer).
process.env.ALLOW_PRIVATE_FETCH = "1";

const KEY = "linux-relay-key-7654321";
const seen: { auth: string; path: string; token: string }[] = [];
const upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
  seen.push({ auth: String(req.headers.authorization ?? ""), path: req.url ?? "", token: String(req.headers["x-sklubot-relay-token"] ?? "") });
  res.setHeader("content-type", "application/json");
  if (req.headers.authorization !== `Bearer ${KEY}`) { res.statusCode = 401; res.end('{"error":"unauthorized"}'); return; }
  res.end(JSON.stringify({ ok: true, path: req.url, echo: KEY }));
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
const UP = (upstream.address() as { port: number }).port;

// Sklubot's own routes on a real port the computer reaches through the Docker bridge (host.docker.internal).
const { site } = await import("../src/routes.js");
const server = serve({ fetch: site.fetch, port: 0, hostname: "0.0.0.0" });
await new Promise<void>((r) => server.once("listening", () => r()));
const SITE_PORT = (server.address() as { port: number }).port;
process.env.ENGINE_BASE_URL = `http://host.docker.internal:${SITE_PORT}`;
const { config } = await import("../src/config.js");
(config as { engineBaseUrl: string }).engineBaseUrl = process.env.ENGINE_BASE_URL;

const { computerKind, initComputer, runShell, screen } = await import("../src/computer.js");
await initComputer();
const linux = computerKind() === "linux";
const skip = !linux && "no container runtime or desktop image here (npm run computer:build)";
const { users, bots, vault, policies } = await import("../src/store.js");
const { seal } = await import("../src/auth.js");
const { reachState } = await import("../src/reach.js");
const { provisionRelay } = await import("../src/egress.js");
await import("../src/agent/loop.js");

let botId = "";
after(async () => {
  if (linux && botId) await screen.reset(botId);
  server.close(); upstream.closeAllConnections(); upstream.close();
});

function setup() {
  const u = users.create("w7linux@example.com", "Léa", "x".repeat(60), "fr");
  const b = bots.create(u.id, { name: "Ordi", shape: "pebble", color: "teal" } as any);
  bots.patch(b.id, { relayEnabled: true });
  vault.create(u.id, { kind: "secret", name: "Local API", site: "", username: "", passwordEnc: seal(KEY), note: "", hosts: ["127.0.0.1"], header: "Authorization", prefix: "Bearer " });
  // Allowed before (the approval card itself is covered by wave7.test.ts).
  policies.set(u.id, "relay: Local API", "always_allow");
  botId = b.id;
  return bots.byId(b.id)!;
}

test("Agent Reach is installed on the bot's computer, root-owned, and answers in JSON (pinned 1.6.1)", { skip }, async () => {
  const bot = setup();
  const st = await reachState(bot);
  assert.equal(st.available, true, st.reason);
  assert.equal(st.version, "1.6.1");
  assert.ok(st.channels.some((c) => c.channel === "web"));
  assert.deepEqual(st.logins.map((l) => l.channel), ["reddit", "twitter", "instagram", "facebook"]);
  const where = await runShell(bot.id, bot.userId, "command -v agent-reach sklubot-api; stat -c '%U' /opt/agent-reach/tools; echo port=$REACH_BROWSER_PORT; command -v ffmpeg", 60);
  assert.match(where.output, /\/usr\/local\/bin\/agent-reach/);
  assert.match(where.output, /\/usr\/local\/bin\/sklubot-api/);
  assert.match(where.output, /^root$/m);
  assert.match(where.output, /port=9333/, "off the desktop browser's 9222");
});

test("a program on the computer calls an API through the relay; the key never enters the computer", { skip }, async () => {
  const bot = bots.byId(botId)!;
  assert.equal(await provisionRelay(bot), true);
  const r = await runShell(bot.id, bot.userId, `sklubot-api "Local API" GET "http://127.0.0.1:${UP}/v1/things?a=1&a=2"`, 60);
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /"ok":true/);
  assert.match(r.output, /"echo":"\[hidden\]"/, "the key is removed from what comes back");
  assert.equal(seen.at(-1)!.auth, `Bearer ${KEY}`, "the server added it");
  assert.equal(seen.at(-1)!.token, "");
  assert.equal(seen.at(-1)!.path, "/v1/things?a=1&a=2");
  // Nowhere on the computer: not in its files, its environment or its processes.
  // (The key is searched for in two halves, so the search's own command line does not contain it.)
  const [h1, h2] = [KEY.slice(0, 10), KEY.slice(10)];
  const look = await runShell(bot.id, bot.userId, `K="${h1}""${h2}"; grep -rIl -- "$K" /root /etc /tmp /opt 2>/dev/null | head -3; echo env=$(env | grep -c -- "$K"); echo ps=$(ps -eo args | awk -v k="$K" 'index($0, k) && !/awk/' | wc -l)`, 120);
  assert.doesNotMatch(look.output, /^\//m, `found in a file: ${look.output}`);
  assert.match(look.output, /env=0/, "not in the environment");
  assert.match(look.output, /ps=0/, "not in any process (other than this search)");
  // Another host is refused by the relay, with the reason.
  const other = await runShell(bot.id, bot.userId, `sklubot-api "Local API" GET https://example.com/`, 60);
  assert.match(other.output, /may only be sent to 127\.0\.0\.1/);
});
