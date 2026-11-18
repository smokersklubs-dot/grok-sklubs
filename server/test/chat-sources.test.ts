import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { mentionAt, replaceMention, repositoryName } from "../src/clientshared/chatmentions.js";
import { githubRead } from "../src/githubsearch.js";
import type { ToolContext } from "../src/agent/tools.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-chat-sources-"));
process.env.SESSION_SECRET = "test-chat-connector-secret-123456789";
process.env.NO_SCHEDULER = "1";
const { connectors } = await import("../src/connectors.js");
const { registerConnectorCatalog } = await import("../src/connectorcatalogroutes.js");

test("a mention replaces just the token at the caret and preserves the message", () => {
  const draft = "Lis @GitHub pour moi";
  const range = mentionAt(draft, 7)!;
  assert.deepEqual(range, { start: 4, end: 11, query: "gi" });
  assert.equal(replaceMention(draft, range, "@GitHub https://github.com/ai-timon/timon").text, "Lis @GitHub https://github.com/ai-timon/timon pour moi");
  assert.equal(mentionAt("nom@example.org", 7), null);
  assert.equal(mentionAt("https://site/@abc", 17), null);
  assert.equal(repositoryName("https://github.com/ai-timon/timon.git"), "ai-timon/timon");
  for (const bad of ["https://other.test/a/b", "https://github.com/a/b?secret=x", "a/..", "https://u:p@github.com/a/b"]) assert.equal(repositoryName(bad), null);
});

test("README reads use raw bytes, bound the excerpt, and identify unavailable repositories", async t => {
  const ctx = { signal: new AbortController().signal } as ToolContext;
  let status = 200;
  const read = t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    assert.equal(String(url), "https://api.github.com/repos/ai-timon/timon/readme");
    assert.equal(new Headers(options.headers).get("authorization"), null);
    assert.equal(new Headers(options.headers).get("accept"), "application/vnd.github.raw+json");
    return new Response("README " + "a".repeat(24_000), { status });
  });
  assert.equal(githubRead.outside, true);
  assert.equal((await githubRead.run({ repository: "https://other.test/repo" }, ctx)).isError, true);
  assert.equal(read.mock.callCount(), 0);
  const result = await githubRead.run({ repository: "ai-timon/timon" }, ctx);
  assert.match(String(result.content), /README excerpt truncated/);
  assert.ok(result.content.length < 17000);
  status = 404;
  assert.equal((await githubRead.run({ repository: "ai-timon/timon" }, ctx)).isError, true);
});

test("account search only calls the signed-in owner's official GitHub search tool", async t => {
  const fixture = { id: "own", name: "GitHub", url: "https://api.githubcopilot.com/mcp/readonly", hasToken: false, auth: "oauth" as const, status: "ready" as const, error: null, tools: [{ name: "search_repositories", readOnly: true, description: "" }] };
  t.mock.method(connectors, "list", (owner: string) => owner === "owner" ? [{ ...fixture, id: "custom", url: "https://other.example/mcp" }, fixture] : []);
  const remote = t.mock.method(connectors, "call", async (id: string, name: string, args: Record<string, unknown>) => {
    assert.equal(id, "own"); assert.equal(name, "search_repositories"); assert.equal(args.query, "my-project");
    return { text: JSON.stringify({ items: [{ full_name: "owner/my-project" }] }), isError: false };
  });
  const route = async (user: string) => {
    const api = new Hono<any>();
    api.use("*", async (c, next) => { c.set("user", { id: user, locale: "fr" }); await next(); });
    registerConnectorCatalog(api);
    return api.request("/connectors/github/account-search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "my-project" }) });
  };
  assert.equal((await route("other")).status, 409);
  assert.equal(remote.mock.callCount(), 0);
  const ok = await route("owner");
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await ok.json(), { repositories: [{ name: "owner/my-project", description: "", license: null }] });
  assert.equal(remote.mock.callCount(), 1);
});

test("VoiceStudio turns a WAV response into a private file without filling the chat with base64", async () => {
  const { saveVoiceResult } = await import("../src/voiceconnector.js");
  const { resolveInWorkspace, attachmentAt } = await import("../src/computer.js");
  const bytes = Buffer.alloc(16044);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const result = saveVoiceResult("bot_voice_fixture", JSON.stringify({ wav_base64: bytes.toString("base64") }));
  assert.equal(result?.isError, false);
  const file = JSON.parse(result!.text);
  assert.equal(file.mime, "audio/wav");
  assert.deepEqual(readFileSync(resolveInWorkspace("bot_voice_fixture", file.path)), bytes);
  assert.equal(attachmentAt("bot_other_fixture", file.path), null);
  assert.equal(saveVoiceResult("bot_voice_fixture", '{"wav_base64":"aGVsbG8="}')?.isError, true);
  assert.equal(saveVoiceResult("bot_voice_fixture", '{"audio_url":"https://source.example/audio/test.wav"}'), null);
});
