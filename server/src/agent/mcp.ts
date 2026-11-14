import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { bots } from "../store.js";
import type { ToolUseBlock } from "../llm/types.js";
import { engineTokenValid, engineTurnOf, randomCallId } from "./engine.js";
import { afterTool, DECLINED, execute, judge, waitForApproval, type Turn } from "./loop.js";
import { LoopGuard, loopStopText } from "./reliability.js";

/**
 * Sklubot's tools for bots that run on a subscription tool (Claude Code, Codex) inside their computer.
 * One endpoint per bot (/mcp/<bot id>), reachable with that bot's own secret only. Every call goes
 * through the same permission rules as the built-in loop: what needs the user's OK waits for it.
 */

function authorised(botId: string, header: string | undefined): boolean {
  return engineTokenValid(botId, (header ?? "").replace(/^Bearer\s+/i, ""));
}

/**
 * Tool calls only make sense inside the bot's running subscription turn: it carries the stop signal, the
 * caution once outside content was read (such a turn starts out careful) and the hop count. Outside a turn
 * there is nothing to attach a call to, so none is accepted.
 */
const turnFor = (botId: string): Turn | null => engineTurnOf(botId);

export async function handleMcp(botId: string, req: IncomingMessage, res: ServerResponse, body: unknown) {
  if (!bots.byId(botId) || !authorised(botId, req.headers.authorization)) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorised" }));
    return;
  }
  const server = new Server({ name: "sklubot", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const turn = turnFor(botId);
    if (!turn) return { tools: [] };
    return {
      tools: turn.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const turn = turnFor(botId);
    if (!turn) return { content: [{ type: "text", text: "Sklubot's tools are only available while one of your turns is running." }], isError: true };
    const call: ToolUseBlock = { type: "tool_use", id: randomCallId(), name: request.params.name, input: (request.params.arguments ?? {}) as Record<string, unknown> };
    const verdict = judge(turn, call);
    if (verdict.kind === "block") return { content: [{ type: "text", text: DECLINED }], isError: true };
    if (verdict.kind === "ask") {
      const status = await waitForApproval(turn, call, verdict);
      if (status !== "allowed" && status !== "always") return { content: [{ type: "text", text: status === "expired" ? "The user did not answer in time, so this did not run. Do not retry it now." : DECLINED }], isError: true };
    }
    try {
      const out = afterTool(turn, call, await execute(turn, call));
      // Going round in circles: the subscription tool runs its own loop, so it is told plainly to stop and report.
      const why = (turn.guard ??= new LoopGuard()).check(call, out);
      if (why) return { content: [{ type: "text", text: `Stop now: ${loopStopText(why)}. Doing it again will not help. Tell the user where you are stuck and ask how to go on.` }], isError: true };
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
