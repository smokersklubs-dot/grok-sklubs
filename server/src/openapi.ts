/**
 * L170 — the OpenAPI 3.1 description of Sklubot's public API (https://spec.openapis.org/oas/v3.1.0), served at
 * GET /api/v1/openapi.json and printed by the headless command (`node scripts/sklubot.mjs openapi`).
 *
 * It is generated from PUBLIC_ROUTES below, and test/open-api.test.ts checks that this table and the routes actually
 * registered under /api/v1 (Hono's `routes` list) are the same set: a route added without its description fails the tests.
 *
 * Deprecation: a route that will go away keeps working and gets `deprecated: true` in the file plus the response headers
 * `Deprecation: @<unix time>` (RFC 9745, https://www.rfc-editor.org/rfc/rfc9745) and `Sunset: <HTTP date>` (RFC 8594,
 * https://www.rfc-editor.org/rfc/rfc8594), with `Link: <replacement>; rel="successor-version"` when there is one. Rule
 * (docs/API.md): at least 6 months between the Deprecation date and the Sunset date. No route is deprecated today.
 */
export interface Deprecation { since: string; sunset: string; replacement?: string }
export interface PublicRoute { method: "GET" | "POST" | "DELETE"; path: string; summary: string; scopes: string[]; deprecated?: Deprecation; body?: Record<string, unknown>; query?: string[] }

const msg = { type: "object", properties: { text: { type: "string", maxLength: 20000 }, thread: { type: "integer" } }, required: ["text"] };
export const PUBLIC_ROUTES: PublicRoute[] = [
  { method: "GET", path: "/v1/openapi.json", summary: "This file", scopes: [] },
  { method: "GET", path: "/v1/bot", summary: "The bot and the key", scopes: [] },
  { method: "GET", path: "/v1/bot/messages", summary: "Messages after a seq (main chat or a thread)", scopes: ["read"], query: ["after", "thread", "limit"] },
  { method: "POST", path: "/v1/bot/messages", summary: "Send the bot a message (outside content)", scopes: ["write"], body: msg },
  { method: "GET", path: "/v1/bot/messages/{seq}/wait", summary: "Wait for the reply to a message (long polling, 120 s at most)", scopes: ["read"], query: ["timeout"] },
  { method: "POST", path: "/v1/bot/tasks", summary: "Give the bot a goal", scopes: ["tasks"], body: { type: "object", properties: { objective: { type: "string" }, thread: { type: "integer" }, maxRounds: { type: "integer" } }, required: ["objective"] } },
  { method: "GET", path: "/v1/bot/tasks/{taskId}", summary: "Where a goal stands", scopes: ["tasks"] },
  { method: "GET", path: "/v1/bot/memories", summary: "The bot's memory notes (no sensitive, archived or binned note)", scopes: ["memory"], query: ["limit"] },
  { method: "POST", path: "/v1/mcp", summary: "MCP control server (Streamable HTTP, stateless)", scopes: ["read"] },
  { method: "GET", path: "/v1/mcp", summary: "Not allowed (405): POST only", scopes: [] },
  { method: "DELETE", path: "/v1/mcp", summary: "Not allowed (405): POST only", scopes: [] },
  { method: "POST", path: "/v1/team/mcp", summary: "Team MCP server (a team key sk-team-…, teammcp.ts)", scopes: ["team"] },
  { method: "GET", path: "/v1/team/mcp", summary: "Not allowed (405): POST only", scopes: [] },
  { method: "DELETE", path: "/v1/team/mcp", summary: "Not allowed (405): POST only", scopes: [] },
  { method: "GET", path: "/v1/models", summary: "OpenAI-compatible: the one model, this bot", scopes: [] },
  { method: "POST", path: "/v1/chat/completions", summary: "OpenAI-compatible chat completion (last user message only)", scopes: ["read", "write"], body: { type: "object", properties: { model: { type: "string" }, messages: { type: "array" }, stream: { type: "boolean" } }, required: ["messages"] } },
];

/** The response headers of a deprecated route. */
export function deprecationHeaders(d: Deprecation): Record<string, string> {
  const h: Record<string, string> = { deprecation: `@${Math.floor(Date.parse(d.since) / 1000)}`, sunset: new Date(d.sunset).toUTCString() };
  if (d.replacement) h.link = `<${d.replacement}>; rel="successor-version"`;
  return h;
}

export function openApiDocument(routes: PublicRoute[] = PUBLIC_ROUTES) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }))
      .concat((r.query ?? []).map((name) => ({ name, in: "query", required: false, schema: { type: "string" } })));
    const op: Record<string, unknown> = {
      summary: r.summary,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/\{(\w+)\}/g, "By_$1").replace(/[^A-Za-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ? ch.toUpperCase() : ""))}`,
      ...(r.scopes.length ? { description: `Permissions of the key: ${r.scopes.join(", ")}.` } : {}),
      security: r.path === "/v1/openapi.json" ? [] : r.path.startsWith("/v1/team/") ? [{ teamKey: [] }] : [{ botKey: [] }],
      ...(params.length ? { parameters: params } : {}),
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: r.body } } } } : {}),
      responses: { "200": { description: "OK" }, "401": { description: "Missing, wrong or revoked key" }, "403": { description: "Permission missing" }, "429": { description: "Too many requests" } },
      ...(r.deprecated ? { deprecated: true, "x-sunset": r.deprecated.sunset } : {}),
    };
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: "Sklubot Bot API", version: "1", description: "One bot per key. Guide: docs/API-BOT.md and docs/API.md. Deprecated routes carry Deprecation and Sunset headers." },
    servers: [{ url: "/api" }],
    components: { securitySchemes: { botKey: { type: "http", scheme: "bearer", description: "A bot API key (sk_bot_…), made in the bot's settings → Accès API." }, teamKey: { type: "http", scheme: "bearer", description: "A team MCP key (sk-team-…), docs/API-BOT.md." } } },
    paths,
  };
}
