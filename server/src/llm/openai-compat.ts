import { cacheLayout } from "./cachelayout.js";
import { toolsForCall } from "./toolsearch.js";
import { repairJson } from "./jsonrepair.js";
import { isContextTooLong, isTransientStatus, ProviderError, retryAfterOf, type Block, type ChatMessage, type LlmProvider, type StopReason, type TurnRequest, type TurnResult } from "./types.js";

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  reasoning_content?: string;
}

/** How a provider's own reasoning travels in its history (see OpenAiCompatOptions.echoReasoning). */
interface WireOpts { providerId: string; echoReasoning: boolean; images: boolean }

const NO_IMAGE = "[An image was here; this model does not read images.]";

function toWire(system: string, messages: ChatMessage[], o: WireOpts = { providerId: "", echoReasoning: false, images: true }): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = m.content.filter((b) => b.type === "tool_use") as Extract<Block, { type: "tool_use" }>[];
      const msg: WireMessage = { role: "assistant", content: text || null };
      if (o.echoReasoning) {
        // This provider's own reasoning goes back as it came; a reply written by another model gets an empty one.
        const mine = m.content.find((b) => b.type === "opaque" && b.provider === o.providerId) as Extract<Block, { type: "opaque" }> | undefined;
        const raw = mine?.raw as { reasoning_content?: unknown } | undefined;
        msg.reasoning_content = typeof raw?.reasoning_content === "string" ? raw.reasoning_content : "";
      }
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
          if (c.type === "image" && !o.images) out.push({ role: "user", content: NO_IMAGE });
          else if (c.type === "image") followUpImages.push({ type: "image_url", image_url: { url: `data:${c.mediaType};base64,${c.data}` } });
      } else if (b.type === "text") parts.push({ type: "text", text: b.text });
      else if (b.type === "image" && !o.images) parts.push({ type: "text", text: NO_IMAGE });
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
  /** The key, when it does not come from an environment variable (a provider the user set up; apimodels.ts). */
  apiKey?: () => string | null;
  /** How requests go out: a user-chosen address goes through the outbound guard (net.ts guardedFetch). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * The endpoint streams its reasoning as `reasoning_content` and wants it back on every assistant message once tools
   * are in play: DeepSeek — "the reasoning_content must be fully passed back to the API in all subsequent requests",
   * else a 400 (https://api-docs.deepseek.com/guides/thinking_mode). Replies by another model carry an empty one (the
   * same technique as deepseek-harness packages/llm/llm-pi-ai/src/catalog.ts
   * `requiresReasoningContentOnAssistantMessages`, MIT, Copyright (c) 2026 DeepSeek).
   */
  echoReasoning?: boolean;
  /** False for a model that does not read images: pictures are replaced by a short note. */
  images?: boolean;
  /** Per model, when the provider knows which of its models read images (OpenRouter's catalog); else `images`. */
  imagesFor?: (model: string) => boolean | undefined;
  /** Extra request headers (OpenRouter's app attribution: HTTP-Referer, X-OpenRouter-Title). */
  headers?: Record<string, string>;
  /** The endpoint reports each call's cost in `usage.cost` (OpenRouter): it is recorded instead of our price list. */
  reportsCost?: boolean;
  /** A provider's own reading of a failed call (OpenRouter's 402: out of credit); null leaves the generic error. */
  httpError?: (status: number, detail: string, retryAfterMs: number | null) => ProviderError | null;
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
    return Boolean(this.key());
  }

  private key(): string | null {
    return this.opts.apiKey ? this.opts.apiKey() : process.env[this.opts.apiKeyEnv] ?? null;
  }

  /**
   * A POST with this provider's own key, to a path on its own origin only (nativesearch.ts: the provider's documented
   * search features). The key never leaves this class and never goes to another host.
   */
  async postOwn(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const key = this.key();
    if (!key) throw new Error(`${this.label}: no key`);
    const base = new URL(`${this.opts.baseUrl.replace(/\/+$/, "")}/`);
    const url = new URL(path, path.startsWith("/") ? base.origin : base);
    if (url.origin !== base.origin) throw new Error(`${this.label}: refused, not its own address`);
    return (this.opts.fetch ?? fetch)(url.toString(), { method: "POST", headers: { ...this.opts.headers, "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
  }

  /** Whether this model reads images (imagetext.ts reads pictures for one that does not). */
  readsImages(model: string): boolean { return this.opts.imagesFor?.(model) ?? this.opts.images !== false; }

  /** The endpoint's address (L71: which embeddings model it offers is decided from its host, agent/semantic.ts). */
  get baseUrl(): string { return this.opts.baseUrl; }

  /**
   * L71 « Mémoire par le sens »: turns texts into vectors with the endpoint's embeddings API, POST {base}/embeddings with
   * { model, input: [texts] }, answer { data: [{ index, embedding }], usage: { prompt_tokens } } — OpenAI
   * (https://platform.openai.com/docs/api-reference/embeddings/create) and Mistral (https://docs.mistral.ai/api/#tag/embeddings)
   * use this same shape. Only called when the account's owner switched the option on.
   */
  async embed(model: string, input: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; inputTokens: number }> {
    const key = this.key();
    if (!key) throw new Error(`${this.label}: no key`);
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...(this.opts.headers ?? {}) },
      body: JSON.stringify({ model, input }), signal: signal ?? AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${this.label} embeddings: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[]; usage?: { prompt_tokens?: number } };
    const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== input.length || data.some((d) => !Array.isArray(d.embedding))) throw new Error(`${this.label} embeddings: unexpected answer`);
    return { vectors: data.map((d) => d.embedding as number[]), inputTokens: json.usage?.prompt_tokens ?? 0 };
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    // L57: fixed system prompt first, the turn's changing context with the turn's message — OpenAI caches the longest
    // unchanged prefix by itself (platform.openai.com/docs/guides/prompt-caching; no parameter is sent). Tool search:
    // the core tools plus those loaded this turn (llm/toolsearch.ts; no documented deferred loading on this API).
    const laid = cacheLayout(req.system, req.messages);
    const tools = toolsForCall(req.tools, req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toWire(laid.system, laid.messages, { providerId: this.id, echoReasoning: !!this.opts.echoReasoning, images: this.opts.imagesFor?.(req.model) ?? this.opts.images !== false }),
    };
    if (tools.length)
      body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    if (this.opts.sendsEffort) body.reasoning_effort = req.effort === "low" ? "low" : req.effort === "medium" ? "medium" : "high";

    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { ...this.opts.headers, "content-type": "application/json", authorization: `Bearer ${this.key()}` },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      // The request never got an answer (DNS, refused, reset, timeout): worth another try.
      throw new ProviderError(`${this.label} could not be reached: ${(err as Error)?.message ?? err}`, { transient: true });
    }
    req.onActivity?.(); // the answer has started (its headers are in)
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      const own = this.opts.httpError?.(res.status, detail, retryAfterOf(res.headers));
      if (own) throw own;
      if (isContextTooLong(res.status, detail)) throw new ProviderError(`${this.label}: the request is too long for the model (${detail})`, { status: res.status, transient: false, code: "context_length" });
      throw new ProviderError(`${this.label} API error ${res.status}: ${detail}`, { status: res.status, transient: isTransientStatus(res.status), retryAfterMs: retryAfterOf(res.headers) });
    }

    let text = "";
    let reasoning = "";
    let finish = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const usage: TurnResult["usage"] = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      req.onActivity?.();
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
          // DeepSeek also reports it as prompt_cache_hit_tokens (https://api-docs.deepseek.com/api/create-chat-completion).
          usage.cachedTokens = evt.usage.prompt_tokens_details?.cached_tokens ?? evt.usage.prompt_cache_hit_tokens ?? 0;
          // OpenRouter: `usage.cost`, "Cost of the completion" in USD (openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
          if (this.opts.reportsCost && typeof evt.usage.cost === "number" && Number.isFinite(evt.usage.cost) && evt.usage.cost >= 0) usage.costUsd = evt.usage.cost;
        }
        const choice = evt.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta ?? {};
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) { reasoning += delta.reasoning_content; req.onReasoning?.(delta.reasoning_content); }
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
    if (this.opts.echoReasoning) content.push({ type: "opaque", provider: this.id, raw: { reasoning_content: reasoning } });
    if (text) content.push({ type: "text", text });
    for (const c of calls.values()) {
      let input: Record<string, unknown>;
      try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = repairJson(c.args) ?? { INVALID_JSON: c.args }; } // L75 (jsonrepair.ts)
      content.push({ type: "tool_use", id: c.id, name: c.name, input });
    }
    const stopReason: StopReason = calls.size ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end";
    return { content, stopReason, usage, model: req.model, detail: stopReason === "refusal" ? "The model declined this request." : undefined };
  }
}
