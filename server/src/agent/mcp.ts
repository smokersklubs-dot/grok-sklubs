import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { bots } from "../store.js";
import type { ToolUseBlock } from "../llm/types.js";
import { claimStep, engineTokenValid, engineTurnOf, markStep, ownToolName, randomCallId } from "./engine.js";
import { clip } from "../store.js";
import { tr } from "../i18n.js";
import { DECLINED, runReserved, waitForApproval, type Turn } from "./loop.js";
import { authorize } from "./authorize.js";
import { forgetCall, PARKED, parkedGrant } from "./approval-wait.js";
import { approvals } from "../store.js";
import { bindCall } from "./bind.js";
import { actionHash } from "./executions.js";
import type { Grant } from "../shared.js";
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

/** What the engine is told when an approval lapsed (the turn was stopped, or the request could not be kept open). */
export const EXPIRED = "This was not approved: the request was cancelled or could not be kept open. Do not retry it unless the user asks.";

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
    // Our own tool, whatever case the engine wrote it in; then the row the stream announced for it (B-3).
    const name = ownToolName(turn, request.params.name);
    const call: ToolUseBlock = { type: "tool_use", id: randomCallId(), name, input: (request.params.arguments ?? {}) as Record<string, unknown> };
    const step = await claimStep(botId, name);
    const loc = turn.user.locale;
    // What the server itself sees is bound into the action before it is judged, exactly as in the built-in loop: the
    // user's words a rule change cites (checked in their messages), a click's target, a payment's page. Whatever the
    // engine put in those fields is replaced — without this, a subscription bot's rule change never carried the user's
    // words, and the engine could have named a click's target or a payment's page itself.
    await bindCall(turn, call);
    const verdict = await authorize(turn, call);
    if (verdict.kind === "block") { markStep(botId, step, "denied", verdict.reason ? clip(verdict.reason, 200) : tr(loc, "not allowed")); return { content: [{ type: "text", text: verdict.reason ? `${DECLINED} Why: ${verdict.reason}` : DECLINED }], isError: true }; }
    let grant: Grant | undefined = verdict.kind === "allow" ? verdict.grant : undefined;
    const asked: { approvalId?: string } = {};
    // A request the owner answered "yes" to after its call had stopped waiting (approval-wait.ts): this exact action
    // — same tool, same arguments — runs on that approval, once. Anything else is asked again, as always.
    const hash = actionHash(call.name, call.input);
    const earlier = verdict.kind === "ask" ? parkedGrant(botId, hash) : null;
    if (earlier && approvals.consume(earlier, hash)) { forgetCall(earlier); asked.approvalId = earlier; grant = { by: "approval" }; }
    else if (verdict.kind === "ask") {
      markStep(botId, step, "waiting");
      const status = await waitForApproval(turn, call, verdict, asked);
      if (status !== "allowed" && status !== "always") {
        markStep(botId, step, "denied", tr(loc, status === "parked" ? "waiting for your answer" : status === "expired" ? "skipped" : "not allowed"));
        return { content: [{ type: "text", text: status === "parked" ? PARKED : status === "expired" ? EXPIRED : DECLINED }], isError: true };
      }
      grant = { by: "approval" };
    }
    // Reserved, executed once, logged with what allowed it; an unknown outcome becomes an "uncertain" card (runReserved).
    const out = await runReserved(turn, call, grant, asked.approvalId ?? "", hash, (status, summary) => {
      if (status === "running") markStep(botId, step, "running");
      else markStep(botId, step, status, summary ?? (status === "error" ? tr(loc, "failed") : undefined));
    });
    // Going round in circles: the subscription tool runs its own loop, so it is told plainly to stop and report.
    const why = (turn.guard ??= new LoopGuard()).check(call, out);
    if (why) { markStep(botId, step, "error", loopStopText(why)); return { content: [{ type: "text", text: `Stop now: ${loopStopText(why)}. Doing it again will not help. Tell the user where you are stuck and ask how to go on.` }], isError: true }; }
    const parts = typeof out.content === "string" ? [{ type: "text" as const, text: out.content }] : out.content.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, data: p.data, mimeType: p.mediaType }));
    return { content: parts, isError: !!out.isError };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
