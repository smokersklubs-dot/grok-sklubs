import type { Context } from "hono";
import { engineTokenValid } from "./agent/engine.js";
import { bots } from "./store.js";
import { personalAccess, personalActive, personalModels, resource } from "./personalplan.js";
import { MAX_VISION_INPUT, readVisionRequest, visionPayload } from "./visionpayload.js";

let preparing = 0;

function desktopTool(t: any): boolean {
  if (t?.type === "namespace") return Array.isArray(t.tools) && t.tools.every((nested: any) => nested?.type === "function" || nested?.type === "custom");
  return ["function", "custom", "web_search", "web_search_preview"].includes(t?.type);
}

function desktopInput(item: any): boolean {
  if (!item || item.type === "item_reference") return false;
  if (item.type === "additional_tools" && (!Array.isArray(item.tools) || !item.tools.every(desktopTool))) return false;
  if (Array.isArray(item.content) && item.content.some((part: any) => part?.file_id)) return false;
  return true;
}

/** Only registered on a bot's private Unix socket. The grant stays in the owner's
 * Sklubot process. The desktop presents the same revocable, per-turn proof as MCP. */
export async function personalResponses(c: Context) {
  const id = c.req.param("botId");
  const proof = c.req.header("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!id || !proof || !engineTokenValid(id, proof)) return c.json({ error: "Unauthorized" }, 401);
  const bot = bots.byId(id);
  if (!bot || !bot.model.startsWith("codex:") || !personalActive(bot.userId)) return c.json({ error: "Not found" }, 404);
  const models = personalModels(bot.userId);
  const choice = bot.model.slice(6);
  const model = choice === "default" ? models[0] : choice;
  if (!model || !models.includes(model)) return c.json({ error: { message: "Choose a model available on this ChatGPT plan." } }, 400);
  if (preparing >= 2) { c.header("retry-after", "2"); return c.json({ error: { message: "Preparing other model requests. Try again shortly." } }, 429); }
  let payload: string | null;
  preparing++;
  try {
    const input = await readVisionRequest(c.req.raw) as any;
    if (!input || !Array.isArray(input.input) || input.previous_response_id || input.conversation || input.background ||
        !input.input.every(desktopInput) ||
        (input.tools !== undefined && (!Array.isArray(input.tools) || !input.tools.every(desktopTool))))
      return c.json({ error: { message: "Unsupported subscription request." } }, 400);
    // Forward only stateless model input. Previous Responses, remote MCP connections
    // and other account resources cannot be opened with a desktop's turn proof.
    const body: Record<string, unknown> = { model, stream: true, store: false };
    for (const field of ["input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "text", "include"]) {
      if (input[field] !== undefined) body[field] = input[field];
    }
    payload = await visionPayload(body);
    if (!payload) return c.json({ error: { message: "Model request too large. Send the images in smaller groups." } }, 413);
  } catch (err) {
    if (err instanceof RangeError) return c.json({ error: { message: `Image batch exceeds ${MAX_VISION_INPUT / (1024 * 1024)} MiB. Send fewer images at once.` } }, 413);
    return c.json({ error: { message: "Could not read the model request or one of its images." } }, 400);
  } finally { preparing--; }
  let access: string;
  try { access = await personalAccess(bot.userId); }
  catch { return c.json({ error: { message: "ChatGPT login required." } }, 401); }
  try {
    const upstream = await fetch(resource + "/responses", { method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: "Bearer " + access, accept: "text/event-stream",
        originator: "Sklubot", "user-agent": "Sklubot/0.1.0" },
      body: payload, signal: c.req.raw.signal });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const message = upstream.status === 401 || upstream.status === 403 ? "ChatGPT authorization required" :
        upstream.status === 429 ? "ChatGPT usage limit or rate limit reached" : "ChatGPT rejected this model request";
      return new Response(JSON.stringify({ error: { message } }), { status: upstream.status, headers: { "content-type": "application/json",
        ...(upstream.headers.has("retry-after") ? { "retry-after": upstream.headers.get("retry-after")! } : {}) } });
    }
    return new Response(upstream.body, { status: upstream.status, headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store",
      ...(upstream.headers.has("retry-after") ? { "retry-after": upstream.headers.get("retry-after")! } : {}),
    } });
  } catch { return c.json({ error: { message: "ChatGPT could not be reached." } }, 502); }
}
