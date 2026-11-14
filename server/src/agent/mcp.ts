import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { bots, users } from "../store.js";
import type { ToolUseBlock } from "../llm/types.js";
import { engineToken, engineTurnOf, randomCallId } from "./engine.js";
import { afterTool, DECLINED, execute, judge, newTurn, waitForApproval, type Turn } from "./loop.js";

/**
 * Sklubot's tools for bots that run on a subscription tool (Claude Code, Codex) inside their computer.
 * One endpoint per bot (/mcp/<bot id>), reachable with that bot's own secret only. Every call goes
 * through the same permission rules as the built-in loop: what needs the user's OK waits for it.
 */

function authorised(botId: string, header: string | undefined): boolean {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const wanted = Buffer.from(engineToken(botId));
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function turnFor(botId: string): Promise<Turn | null> {
  const live = engineTurnOf(botId);
  if (live) return live;
  const bot = bots.byId(botId);
  const user = bot ? users.byId(bot.userId) : null;
  return bot && user ? newTurn(bot, user, 0, new AbortController().signal, true) : null;
}

export async function handleMcp(botId: string, req: IncomingMessage, res: ServerResponse, body: unknown) {
  if (!bots.byId(botId) || !authorised(botId, req.headers.authorization)) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorised" }));
    return;
  }
  const server = new Server({ name: "sklubot", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const turn = await turnFor(botId);
    if (!turn) return { tools: [] };
    return {
      tools: turn.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const turn = await turnFor(botId);
    if (!turn) return { content: [{ type: "text", text: "This bot no longer exists." }], isError: true };
    const call: ToolUseBlock = { type: "tool_use", id: randomCallId(), name: request.params.name, input: (request.params.arguments ?? {}) as Record<string, unknown> };
    const verdict = judge(turn, call);
    if (verdict.kind === "block") return { content: [{ type: "text", text: DECLINED }], isError: true };
    if (verdict.kind === "ask") {
      const status = await waitForApproval(turn, call, verdict);
      if (status !== "allowed" && status !== "always") return { content: [{ type: "text", text: status === "expired" ? "The user did not answer in time, so this did not run. Do not retry it now." : DECLINED }], isError: true };
    }
    try {
      const out = afterTool(turn, call, await execute(turn, call));
      const parts = typeof out.content === "string" ? [{ type: "text" as const, text: out.content }] : out.content.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, data: p.data, mimeType: p.mediaType }));
      return { content: parts, isError: !!out.isError };
    } catch (err) {
      return { content: [{ type: "text", text: `Tool error: ${(err as Error).message}` }], isError: true };
    }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
