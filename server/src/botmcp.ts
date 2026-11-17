import type { Context } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BotApiError, botInfo, createTask, readMessages, sendMessage, waitReply, type Caller } from "./botapi.js";
import type { BotApiScope } from "./shared.js";

/**
 * The MCP control server of the Bot API (docs/API-BOT.md): /api/v1/mcp, authenticated by a bot's API key (botapi.ts).
 * It lets an MCP client (Claude Code, Claude Desktop, Cursor…) talk to ONE bot with exactly five tools — list_bots,
 * send_message, wait_reply, read_messages, create_task — and nothing else: no approvals, no deletion, no settings, no
 * vault or connectors, no other bot. Each tool needs its scope (list_bots: any key); a key only sees the tools it may use.
 *
 * This is NOT agent/mcp.ts (the per-turn tool endpoint a bot's own subscription engine calls on its computer): that one
 * is untouched and stays on the bots' private channel.
 *
 * Built on the official MCP TypeScript SDK (@modelcontextprotocol/sdk 1.32.2, as installed):
 *  - `Server` with `setRequestHandler(ListToolsRequestSchema | CallToolRequestSchema, …)` — dist/esm/server/index.d.ts
 *    (the low-level server, so the tool list and its JSON Schemas are exactly ours, without a schema library);
 *  - `WebStandardStreamableHTTPServerTransport` — dist/esm/server/webStandardStreamableHttp.d.ts: "Stateless mode -
 *    explicitly set session ID to undefined", and its Hono example `transport.handleRequest(c.req.raw)`, which returns a
 *    Web Response. Stateless: a new server and transport per request (the key is checked on every request), as the SDK's
 *    stateless examples do. GET (a server-initiated stream) is answered 405, which the Streamable HTTP specification
 *    allows for a server that offers no such stream (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#listening-for-messages-from-the-server).
 */

/** Longest wait_reply over MCP: under the SDK client's default request timeout of 60 s (DEFAULT_REQUEST_TIMEOUT_MSEC). */
export const MCP_WAIT_MAX_S = 55;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const STARTS_WORK = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const BOT_ID = { type: "string", description: "Optional: the bot's id from list_bots. A key reaches only its own bot." };
const THREAD = { type: "integer", minimum: 0, description: "Optional: the seq of a main-chat message to work in its thread (0 or absent: the main chat)." };

interface ToolDef { name: string; scope: BotApiScope | null; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, boolean> }

/** The five tools, in the order they are listed. Nothing else is ever exposed. */
export const MCP_TOOLS: ToolDef[] = [
  {
    name: "list_bots", scope: null, annotations: READ_ONLY,
    description: "List the Sklubot bots this key can reach (one: the bot the key belongs to), with whether it is paused or busy, and what the key may do.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "send_message", scope: "write", annotations: STARTS_WORK,
    description: "Send the bot a message, as an outside program (never as its owner: anything irreversible waits for the owner's approval in the app). Returns the message's seq; call wait_reply with it to get the answer.",
    inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 20000, description: "The message." }, thread: THREAD, bot_id: BOT_ID }, required: ["text"], additionalProperties: false },
  },
  {
    name: "wait_reply", scope: "read", annotations: READ_ONLY,
    description: "Wait for the bot's reply to a message (its seq, from send_message). Returns status working, done, no_reply, needs_approval (only the owner can answer, in the app) or paused, and the reply text.",
    inputSchema: { type: "object", properties: { seq: { type: "integer", minimum: 1 }, timeout_seconds: { type: "integer", minimum: 0, maximum: MCP_WAIT_MAX_S, description: `How long to wait (default 30, at most ${MCP_WAIT_MAX_S}).` }, bot_id: BOT_ID }, required: ["seq"], additionalProperties: false },
  },
  {
    name: "read_messages", scope: "read", annotations: READ_ONLY,
    description: "Read the bot's conversation: messages and replies only (no tool details), oldest first, after a seq.",
    inputSchema: { type: "object", properties: { after: { type: "integer", minimum: 0, description: "Only messages after this seq (default 0)." }, thread: THREAD, limit: { type: "integer", minimum: 1, maximum: 200 }, bot_id: BOT_ID }, additionalProperties: false },
  },
  {
    name: "create_task", scope: "tasks", annotations: STARTS_WORK,
    description: "Give the bot a goal it works on across several rounds (goal mode). The owner sees it and can pause or stop it; approvals still apply.",
    inputSchema: { type: "object", properties: { objective: { type: "string", minLength: 1, maxLength: 20000 }, max_rounds: { type: "integer", minimum: 1, maximum: 50 }, thread: THREAD, bot_id: BOT_ID }, required: ["objective"], additionalProperties: false },
  },
];

/** The tools this key may use (list_bots for every key). */
export const toolsFor = (scopes: BotApiScope[]) => MCP_TOOLS.filter((t) => !t.scope || scopes.includes(t.scope));

const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const refusal = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

async function callTool(caller: Caller, name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const tool = toolsFor(caller.key.scopes).find((t) => t.name === name);
  if (!tool) return refusal(MCP_TOOLS.some((t) => t.name === name) ? `This key does not have the "${MCP_TOOLS.find((t) => t.name === name)!.scope}" permission.` : `Unknown tool: ${name}.`);
  if (args.bot_id !== undefined && args.bot_id !== caller.bot.id) return refusal("This key only reaches its own bot (see list_bots).");
  try {
    switch (name) {
      case "list_bots": { const info = botInfo(caller); return result({ bots: [{ ...info.bot, scopes: info.key.scopes }] }); }
      case "send_message": return result(sendMessage(caller, { text: args.text, thread: args.thread }));
      case "wait_reply": return result(await waitReply(caller, Number(args.seq), args.timeout_seconds ?? 30, signal, MCP_WAIT_MAX_S));
      case "read_messages": return result(readMessages(caller, { after: args.after, thread: args.thread, limit: args.limit }));
      case "create_task": return result(createTask(caller, { objective: args.objective, thread: args.thread, maxRounds: args.max_rounds }));
    }
  } catch (err) {
    if (err instanceof BotApiError) return refusal(`${err.message} (${err.code})`);
    throw err;
  }
  return refusal(`Unknown tool: ${name}.`);
}

/** Answers one Streamable HTTP request (POST) for this caller. */
export async function handleBotMcp(c: Context, caller: Caller): Promise<Response> {
  const server = new Server({ name: "sklubot-bot-api", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsFor(caller.key.scopes).map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema: inputSchema as { type: "object" }, annotations })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => callTool(caller, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>, extra.signal));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: 256 * 1024 });
  await server.connect(transport);
  const res = await transport.handleRequest(c.req.raw);
  // The answer may still be streaming (SSE): the server and transport are closed once the client has it or goes away.
  c.req.raw.signal.addEventListener("abort", () => { void transport.close(); void server.close(); }, { once: true });
  return res;
}
