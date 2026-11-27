import type { Context, Hono } from "hono"; import { pickLocale } from "./i18n.js";
import { BotApiError, handleApiRequest, requireScope, sendMessage, waitReply, authenticate, apiClientIp, type Caller } from "./botapi.js";
import { maskSecrets } from "./shared.js";
import { memories } from "./store.js";
import { deprecationHeaders, openApiDocument, PUBLIC_ROUTES } from "./openapi.js";

/**
 * L170 « API ouverte » — what the Bot API (botapi.ts) adds so other tools can plug into a bot:
 *
 *  - POST /api/v1/chat/completions — the OpenAI chat-completions shape, so any OpenAI client (SDK, n8n, a chat front-end)
 *    can talk to ONE bot with its bot key as the "API key" and /api/v1 as the "base URL". Request and answer follow the
 *    official reference (https://platform.openai.com/docs/api-reference/chat/create and …/chat/streaming): `messages`
 *    (role + content as a string or a list of `{type:"text", text}` parts), `stream`; answer `chat.completion` with
 *    `choices[0].message`, `finish_reason` "stop", `usage`; with `stream: true`, `chat.completion.chunk` events as
 *    server-sent events ending with `data: [DONE]`. Differences, on purpose: the bot keeps its own conversation, so only
 *    the LAST user message is sent to it (earlier messages and "system" are ignored: a program cannot rewrite the bot's
 *    instructions); `model` is echoed, never used to pick a model; the stream sends the reply in one chunk once it is
 *    complete; token counts are 0 (the owner's usage page has the real cost). Needs the "write" and "read" permissions.
 *    The message is outside content like any API message (approvals, caps, Pause, plan: botapi.ts rules unchanged).
 *  - GET /api/v1/models — the one "model": this bot (OpenAI's list shape, https://platform.openai.com/docs/api-reference/models/list).
 *  - GET /api/v1/bot/memories — the bot's memory notes, "memory" permission: active and contested notes only (never
 *    archived, binned or sensitive ones — health, religion… — which stay in the app), each text through the secret mask.
 *  - GET /api/v1/openapi.json — the OpenAPI 3.1 description of the public API (openapi.ts), no key needed.
 */
const callerOf = (c: Context): Caller => authenticate(c.req.header("authorization"), apiClientIp(c), pickLocale(undefined, c.req.header("accept-language")));

/** OpenAI's error shape: { error: { message, type, code } } with the same HTTP statuses as the Bot API. */
const openAiHandle = (fn: (c: Context) => Promise<Response> | Response) => async (c: Context) => {
  c.header("cache-control", "no-store");
  try { return await fn(c); } catch (err) {
    if (err instanceof BotApiError) {
      if (err.status === 429) c.header("retry-after", "60");
      const type = err.status === 401 ? "invalid_request_error" : err.status === 429 ? "rate_limit_error" : err.status === 403 ? "permission_error" : "invalid_request_error";
      return c.json({ error: { message: err.message, type, code: err.code, ...err.extra } }, err.status);
    }
    throw err;
  }
};

/** The text of the last user message of an OpenAI `messages` list. */
export function lastUserText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).filter(Boolean).join("\n");
    return "";
  }
  return "";
}

/** How long a chat completion waits for the bot's reply (seconds). */
export const COMPLETION_WAIT_S = 300;

export function registerOpenApiRoutes(api: Hono<any>) {
  // Deprecation and Sunset headers on deprecated routes (RFC 9745, RFC 8594), from the route table of openapi.ts.
  api.use("/v1/*", async (c, next) => {
    await next();
    const route = PUBLIC_ROUTES.find((r) => r.method === c.req.method && new RegExp(`^/api${r.path.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(new URL(c.req.url).pathname.replace(/^(?!\/api)/, "/api")));
    if (route?.deprecated) for (const [k, v] of Object.entries(deprecationHeaders(route.deprecated))) c.res.headers.set(k, v);
  });
  api.get("/v1/openapi.json", (c) => c.json(openApiDocument()));
  api.get("/v1/models", openAiHandle((c) => {
    const caller = callerOf(c);
    return c.json({ object: "list", data: [{ id: modelId(caller), object: "model", created: Math.floor(caller.bot.createdAt / 1000), owned_by: "sklubot" }] });
  }));
  api.post("/v1/chat/completions", openAiHandle(async (c) => {
    const caller = callerOf(c);
    requireScope(caller, "read");
    const raw = await c.req.text();
    if (raw.length > 256 * 1024) throw new BotApiError(413, "too_large", "Request too large.");
    let b: Record<string, unknown>;
    try { const v = JSON.parse(raw || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(); b = v; } catch { throw new BotApiError(400, "bad_json", "The body must be a JSON object."); }
    const text = lastUserText(b.messages);
    if (!text.trim()) throw new BotApiError(400, "messages", "Send at least one message with role \"user\" and some text.");
    const sent = sendMessage(caller, { text });
    const state = await waitReply(caller, sent.seq, COMPLETION_WAIT_S, c.req.raw.signal, COMPLETION_WAIT_S);
    if (state.status === "working") throw new BotApiError(409, "still_working", "The bot is still working on it. Read the reply later with GET /api/v1/bot/messages/{seq}/wait.", { seq: sent.seq });
    if (state.status === "needs_approval") throw new BotApiError(409, "needs_approval", "The bot waits for its owner's approval in the app. Read the reply later with GET /api/v1/bot/messages/{seq}/wait.", { seq: sent.seq });
    if (state.status === "paused") throw new BotApiError(409, "paused", "The bot was paused by its owner.", { seq: sent.seq });
    const model = typeof b.model === "string" && b.model.trim() ? b.model.slice(0, 100) : modelId(caller);
    const id = `chatcmpl-${caller.bot.id}-${sent.seq}`;
    const created = Math.floor(Date.now() / 1000);
    const content = state.reply;
    if (b.stream === true) {
      const chunk = (delta: Record<string, unknown>, finish: string | null) => `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const body = chunk({ role: "assistant", content }, null) + chunk({}, "stop") + "data: [DONE]\n\n";
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-sklubot-seq": String(sent.seq) } });
    }
    c.header("x-sklubot-seq", String(sent.seq));
    return c.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  }));
  api.get("/v1/bot/memories", handleApiRequest((c) => {
    const caller = callerOf(c);
    requireScope(caller, "memory");
    const limit = Math.min(500, Math.max(1, Math.floor(Number(c.req.query("limit")) || 200)));
    const list = memories.usable(caller.bot.id, limit).filter((m) => !m.category);
    return c.json({ memories: list.map((m) => ({ id: m.id, text: maskSecrets(m.text, "[secret]").text, status: m.status, confidence: m.confidence, createdAt: m.createdAt })) });
  }));
}
export const modelId = (c: Caller) => `sklubot-${c.bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bot"}`;
