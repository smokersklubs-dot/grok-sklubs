import type { Block, ChatMessage, LlmProvider, StopReason, TurnRequest, TurnResult } from "./types.js";

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

function toWire(system: string, messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = m.content.filter((b) => b.type === "tool_use") as Extract<Block, { type: "tool_use" }>[];
      const msg: WireMessage = { role: "assistant", content: text || null };
      if (calls.length)
        msg.tool_calls = calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } }));
      out.push(msg);
      continue;
    }
    const parts: unknown[] = [];
    const followUpImages: unknown[] = [];
    for (const b of m.content) {
      if (b.type === "tool_result") {
        const text = b.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
        out.push({ role: "tool", tool_call_id: b.toolUseId, content: (b.isError ? "ERROR: " : "") + (text || "(no text output)") });
        // Tool messages are text-only on this wire format; images follow as a user message.
        for (const c of b.content)
          if (c.type === "image") followUpImages.push({ type: "image_url", image_url: { url: `data:${c.mediaType};base64,${c.data}` } });
      } else if (b.type === "text") parts.push({ type: "text", text: b.text });
      else if (b.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } });
    }
    if (followUpImages.length) out.push({ role: "user", content: [{ type: "text", text: "Image output of the previous tool call:" }, ...followUpImages] });
    if (parts.length) out.push({ role: "user", content: parts });
  }
  return out;
}

export interface OpenAiCompatOptions {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  models: string[];
  /** Whether the endpoint understands a reasoning-effort hint. */
  sendsEffort?: boolean;
}

/** Any endpoint speaking the widely adopted chat-completions wire format (xAI, OpenAI, local servers…). */
export class OpenAiCompatProvider implements LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly models: string[];
  constructor(private opts: OpenAiCompatOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.models = opts.models;
  }

  available(): boolean {
    return Boolean(process.env[this.opts.apiKeyEnv]);
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toWire(req.system, req.messages),
    };
    if (req.tools.length)
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    if (this.opts.sendsEffort) body.reasoning_effort = req.effort === "low" ? "low" : req.effort === "medium" ? "medium" : "high";

    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env[this.opts.apiKeyEnv]}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      throw new Error(`${this.label} API error ${res.status}: ${detail}`);
    }

    let text = "";
    let finish = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt: any;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.usage) {
          usage.inputTokens = evt.usage.prompt_tokens ?? 0;
          usage.outputTokens = evt.usage.completion_tokens ?? 0;
          usage.cachedTokens = evt.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
        const choice = evt.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) req.onReasoning?.(delta.reasoning_content);
        if (typeof delta.content === "string" && delta.content) {
          text += delta.content;
          req.onText?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          let cur = calls.get(idx);
          if (!cur) {
            cur = { id: tc.id ?? `call_${idx}_${Date.now()}`, name: "", args: "" };
            calls.set(idx, cur);
          }
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) {
            const first = !cur.name;
            cur.name += tc.function.name;
            if (first) req.onToolStart?.(cur.id, cur.name);
          }
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
    }

    const content: Block[] = [];
    if (text) content.push({ type: "text", text });
    for (const c of calls.values()) {
      let input: Record<string, unknown>;
      try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = { INVALID_JSON: c.args }; }
      content.push({ type: "tool_use", id: c.id, name: c.name, input });
    }
    const stopReason: StopReason = calls.size ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end";
    return { content, stopReason, usage, model: req.model, detail: stopReason === "refusal" ? "The model declined this request." : undefined };
  }
}
