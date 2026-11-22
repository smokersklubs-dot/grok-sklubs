import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Audit DS-Bot #146 (À faire n° 2): a DeepSeek / OpenAI / OpenRouter bot on a server without Brave or SearXNG had no web
// search at all. Now search_web first asks the bot's own provider, with its own key, through that provider's documented
// search feature. No scraping, no other route's key.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-dsws-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
delete process.env.BRAVE_API_KEY; delete process.env.SEARXNG_URL; delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { OpenAiCompatProvider } = await import("../src/llm/openai-compat.js");
const { runChain, searchProviders, servedLine, searchChainAvailable } = await import("../src/providers.js");
const { nativeKindOf, nativeRoute, readResponses, resetNativeSkips } = await import("../src/nativesearch.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { users, bots } = await import("../src/store.js");

const calls: { url: string; body: any; auth: string }[] = [];
let answer: (url: string) => Response = () => new Response("{}", { status: 404 });
const fake = (id: string, baseUrl: string) => new OpenAiCompatProvider({ id, label: id === "ds" ? "DeepSeek" : id, baseUrl, apiKeyEnv: "", apiKey: () => `sk-fake-for-tests-${id}`, models: ["m"], images: false,
  fetch: async (url, init) => { calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) }); return answer(url); } });
registerProvider(fake("ds", "https://api.deepseek.com"));
registerProvider(fake("oa", "https://api.openai.com/v1"));
registerProvider(fake("orr", "https://openrouter.ai/api/v1"));
registerProvider(fake("local", "https://llm.example.org/v1"));

const user = users.create("ws@example.com", "Wes", "x", "fr");
const botFor = (model: string) => bots.create(user.id, { name: `B${model.length}${Math.random().toString(36).slice(2, 6)}`, model });

test("before: with no Brave / SearXNG / Agent Reach, the chain had no way to search", () => {
  assert.equal(searchChainAvailable(), false);
  assert.equal(builtinTools({ owner: user.id }).some((t) => t.spec.name === "search_web"), false);
  assert.equal(builtinTools({ owner: user.id, modelSearch: true }).some((t) => t.spec.name === "search_web"), true, "offered when the bot's model can search");
});

test("only documented search features, by host; none for an unknown host", () => {
  assert.equal(nativeKindOf("https://api.deepseek.com"), "deepseek");
  assert.equal(nativeKindOf("https://api.openai.com/v1"), "responses");
  assert.equal(nativeKindOf("https://api.x.ai/v1"), "responses");
  assert.equal(nativeKindOf("https://openrouter.ai/api/v1"), "openrouter");
  assert.equal(nativeKindOf("https://llm.example.org/v1"), null);
  assert.equal(nativeRoute(botFor("local:m")), null);
});

test("a DeepSeek bot searches through the DeepSeek Search API with its own key, and the line says who served", async () => {
  calls.length = 0; resetNativeSkips();
  answer = () => Response.json({ results: [{ title: "Sklubot", url: "https://example.com/a", snippet: "short", summary: "longer summary" }, { title: "dup", url: "https://example.com/a" }] });
  const o = await runChain("web search", searchProviders(), { query: "météo Lyon" }, { bot: botFor("ds:m") });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/tools/search");
  assert.equal(calls[0].auth, "Bearer sk-fake-for-tests-ds", "its own key, never another route's");
  assert.deepEqual(calls[0].body, { query: "météo Lyon", count: 8, need_content: false });
  assert.equal(o.result?.length, 1, "duplicates merged");
  assert.equal(o.result?.[0].snippet, "longer summary");
  assert.match(servedLine("fr", o), /Recherche du modèle du bot/);
});

test("an OpenAI bot uses the Responses web_search tool; sources and citations are read", async () => {
  calls.length = 0;
  answer = () => Response.json({ output: [{ type: "web_search_call", action: { type: "search", sources: [{ url: "https://news.example/1", title: "One" }] } }, { type: "message", content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", url: "https://news.example/2", title: "Two" }] }] }], usage: { input_tokens: 10, output_tokens: 5 } });
  const o = await runChain("web search", searchProviders(), { query: "news" }, { bot: botFor("oa:m") });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.deepEqual(calls[0].body.tools, [{ type: "web_search" }]);
  assert.deepEqual(o.result?.map((r) => r.url), ["https://news.example/1", "https://news.example/2"]);
});

test("an OpenRouter bot uses the web plugin; url_citation annotations are the results", async () => {
  calls.length = 0;
  answer = () => Response.json({ choices: [{ message: { content: "x", annotations: [{ type: "url_citation", url_citation: { url: "https://or.example/p", title: "P", content: "c" } }] } }] });
  const o = await runChain("web search", searchProviders(), { query: "q" }, { bot: botFor("orr:m") });
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(calls[0].body.plugins, [{ id: "web", max_results: 8 }]);
  assert.equal(o.result?.[0].url, "https://or.example/p");
});

test("a refused key is not tried again on every call; the chain says what failed", async () => {
  calls.length = 0; resetNativeSkips();
  answer = () => new Response("no", { status: 403 });
  const bot = botFor("ds:m");
  const o1 = await runChain("web search", searchProviders(), { query: "a" }, { bot });
  const o2 = await runChain("web search", searchProviders(), { query: "b" }, { bot });
  assert.equal(o1.result, null);
  assert.equal(calls.length, 1, "skipped after the refusal");
  assert.match(o2.attempts.map((a) => a.detail).join(" "), /refused recently/);
});

test("readResponses ignores what is not a source", () => {
  assert.deepEqual(readResponses({ output: [{ type: "message", content: [{ annotations: [{ type: "file_citation", url: "https://x" }] }] }] }), []);
});
