import Anthropic from "@anthropic-ai/sdk";
import { cacheLayout, messageBreakpoints } from "./cachelayout.js";
import { isDeferred, namesIn, TOOL_SEARCH, toolSearchActive, withCatalog } from "./toolsearch.js";
import { alternate, isContextTooLong, isTransientStatus, ProviderError, retryAfterOf, type Block, type ChatMessage, type LlmProvider, type StopReason, type TurnRequest, type TurnResult } from "./types.js";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaContentParam = Anthropic.Beta.Messages.BetaContentBlockParam;

const PROVIDER_ID = "anthropic";
/** Models for which a refused request can be re-run server-side on another model. */
const FALLBACK_CAPABLE = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/;

function toApiContent(blocks: Block[], keepOpaque: boolean, refsFor?: Map<string, Set<string>>): BetaContentParam[] {
  const out: BetaContentParam[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "text":
        if (b.text) out.push({ type: "text", text: b.text });
        break;
      case "image":
        out.push({ type: "image", source: { type: "base64", media_type: b.mediaType as "image/png", data: b.data } });
        break;
      case "tool_use":
        out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
        break;
      case "tool_result": {
        // A tool_search result (llm/toolsearch.ts): the deferred tools it found go back as tool_reference blocks, which the
        // API expands into their full definitions (platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool,
        // "Custom tool search implementation").
        const refs = refsFor?.has(b.toolUseId) ? namesIn(b.content).filter((n) => refsFor.get(b.toolUseId)!.has(n)) : [];
        if (refs.length && !b.isError) {
          out.push({ type: "tool_result", tool_use_id: b.toolUseId, content: refs.map((n) => ({ type: "tool_reference" as const, tool_name: n })) });
          break;
        }
        out.push({
          type: "tool_result",
          tool_use_id: b.toolUseId,
          is_error: b.isError || undefined,
          content: b.content.map((c) =>
            c.type === "text"
              ? { type: "text" as const, text: c.text }
              : { type: "image" as const, source: { type: "base64" as const, media_type: c.mediaType as "image/png", data: c.data } },
          ),
        });
        break;
      }
      case "opaque":
        // Reasoning blocks are only valid in the exchange that produced them; callers decide when to keep them.
        if (keepOpaque && b.provider === PROVIDER_ID) out.push(b.raw as BetaContentParam);
        break;
    }
  }
  return out;
}

/**
 * Reasoning blocks may be dropped as a leading run but never from the middle, so we keep them only
 * from the last plain user message onward (i.e. the tool loop of the turn in progress).
 */
function toApiMessages(input: ChatMessage[], keepReasoning = true, deferred?: Set<string>): Anthropic.Beta.Messages.BetaMessageParam[] {
  const messages = alternate(input);
  // tool_search calls whose results may become tool_reference blocks, with the deferred tools that exist in this request.
  const refsFor = deferred ? new Map<string, Set<string>>() : undefined;
  if (refsFor) for (const m of messages) for (const b of m.content) if (b.type === "tool_use" && b.name === TOOL_SEARCH) refsFor.set(b.id, deferred!);
  let turnStart = keepReasoning ? 0 : messages.length;
  if (keepReasoning)
    messages.forEach((m, i) => {
      if (m.role === "user" && !m.content.some((b) => b.type === "tool_result")) turnStart = i;
    });
  const out: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  messages.forEach((m, i) => {
    const content = toApiContent(m.content, i >= turnStart, refsFor);
    if (content.length) out.push({ role: m.role, content });
  });
  return out;
}

const CACHEABLE = new Set(["text", "image", "tool_use", "tool_result", "document"]);
/** Marks the last cacheable block of each chosen message (llm/cachelayout.ts messageBreakpoints: at most 3 here). */
function withBreakpoints(messages: Anthropic.Beta.Messages.BetaMessageParam[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  const starts = messages.map((m) => m.role === "user" && Array.isArray(m.content) && !m.content.some((b) => b.type === "tool_result"));
  const marks = new Set(messageBreakpoints(starts));
  return messages.map((m, i) => {
    if (!marks.has(i) || !Array.isArray(m.content)) return m;
    let at = -1;
    m.content.forEach((b, j) => { if (CACHEABLE.has(b.type) && !(b.type === "text" && !b.text)) at = j; });
    if (at < 0) return m;
    return { ...m, content: m.content.map((b, j) => (j === at ? ({ ...b, cache_control: { type: "ephemeral" } } as BetaContentParam) : b)) } as Anthropic.Beta.Messages.BetaMessageParam;
  });
}

/**
 * The request for one model call (exported for the tests). Prompt caching (L57): the part of the system prompt that does
 * not change from turn to turn carries one breakpoint (it covers the tools too: "Render order is tools -> system ->
 * messages. A breakpoint on the last system block caches both tools and system together"); what changes per turn rides
 * in front of the turn's own message; up to three more breakpoints sit in the conversation (cachelayout.ts), within the
 * documented maximum of 4 per request (docs.anthropic.com/en/docs/build-with-claude/prompt-caching, now
 * platform.claude.com/docs/en/build-with-claude/prompt-caching). Tool search: see llm/toolsearch.ts.
 */
export function buildParams(req: TurnRequest, keepReasoning = true): BetaParams {
  const laid = cacheLayout(req.system, req.messages);
  const search = toolSearchActive(req.tools);
  const deferred = search ? new Set(req.tools.filter((t) => isDeferred(t.name)).map((t) => t.name)) : undefined;
  const params: BetaParams = {
    model: req.model,
    max_tokens: req.maxTokens ?? 64000,
    stream: true,
    system: [{ type: "text", text: laid.system, cache_control: { type: "ephemeral" } }],
    messages: withBreakpoints(toApiMessages(laid.messages, keepReasoning, deferred)),
    tools: [
      ...req.tools.map((t) => ({
        name: t.name, description: t.name === TOOL_SEARCH && search ? withCatalog(t, req.tools).description : t.description,
        input_schema: t.inputSchema, eager_input_streaming: true, ...(deferred?.has(t.name) ? { defer_loading: true } : {}),
      })),
      ...(req.webSearch ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 }] : []),
    ],
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: req.effort },
  };
  if (FALLBACK_CAPABLE.test(req.model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = PROVIDER_ID;
  readonly label = "Anthropic Claude";
  readonly models = ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
  private client: Anthropic | null = null;

  available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  private sdk(): Anthropic {
    // Retries are done by the turn itself (agent/reliability.ts), which can also move on to a backup model and tells the
    // user; the SDK's own silent retries are switched off so the two do not pile up. `maxRetries` is the client option
    // documented in the SDK (@anthropic-ai/sdk client.d.ts: "The maximum number of times the client will retry a request").
    this.client ??= new Anthropic({ maxRetries: 0 });
    return this.client;
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const params = buildParams(req);

    try {
      return await this.stream(params, req);
    } catch (err) {
      // Reasoning blocks are bound to the exact transcript that produced them. If ours no longer
      // matches (e.g. after a crash mid-turn), send the turn once more without them.
      if (err instanceof Anthropic.BadRequestError && /thinking/i.test(err.message) && /signature|bound to/i.test(err.message)) {
        return await this.stream(buildParams(req, false), req);
      }
      if (err instanceof Anthropic.APIUserAbortError) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic rejected the credentials. Check ANTHROPIC_API_KEY.", { status: 401, transient: false });
      // No status: the connection failed or timed out before an answer (APIConnectionError) — worth another try.
      if (err instanceof Anthropic.APIConnectionError) throw new ProviderError(`Anthropic could not be reached: ${err.message}`, { transient: true });
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError("Anthropic rate limit reached.", { status: 429, transient: true, retryAfterMs: retryAfterOf(err.headers as Headers | undefined) });
      // Longer than the model's window: a distinct code, so the turn compacts and tries again before changing model.
      if (err instanceof Anthropic.APIError && isContextTooLong(err.status, err.message))
        throw new ProviderError(`Anthropic: the request is too long for the model (${err.message})`, { status: err.status, transient: false, code: "context_length" });
      if (err instanceof Anthropic.APIError) {
        // An overloaded_error can also arrive inside the stream, after a 200: it carries no status but says so.
        const status = err.status ?? (/overloaded/i.test(err.message) ? 529 : undefined);
        throw new ProviderError(`Anthropic API error ${status ?? ""}: ${err.message}`, { status, transient: isTransientStatus(status), retryAfterMs: retryAfterOf(err.headers as Headers | undefined) });
      }
      throw err;
    }
  }

  private async stream(params: BetaParams, req: TurnRequest): Promise<TurnResult> {
    const stream = this.sdk().beta.messages.stream(params, { signal: req.signal });
    {
      for await (const event of stream) {
        req.onActivity?.(); // any event, pings included: the stream is alive
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          req.onToolStart?.(event.content_block.id, event.content_block.name);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") req.onText?.(event.delta.text);
          else if (event.delta.type === "thinking_delta") req.onReasoning?.(event.delta.thinking);
        }
      }
      const msg = await stream.finalMessage();
      const content: Block[] = [];
      const sources = new Map<string, { url: string; title?: string }>();
      for (const block of msg.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
          for (const c of block.citations ?? [])
            if (c.type === "web_search_result_location") sources.set(c.url, { url: c.url, title: c.title ?? undefined });
        }
        else if (block.type === "tool_use")
          content.push({ type: "tool_use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
        else content.push({ type: "opaque", provider: PROVIDER_ID, raw: block });
      }
      const stop: StopReason =
        msg.stop_reason === "tool_use" ? "tool_use"
        : msg.stop_reason === "max_tokens" ? "max_tokens"
        : msg.stop_reason === "refusal" ? "refusal"
        : msg.stop_reason === "pause_turn" ? "pause"
        : "end";
      return {
        content,
        stopReason: stop,
        model: msg.model,
        sources: [...sources.values()],
        detail: stop === "refusal" ? (msg.stop_details?.explanation ?? "The model declined this request.") : undefined,
        usage: {
          inputTokens: msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0),
          outputTokens: msg.usage.output_tokens,
          cachedTokens: msg.usage.cache_read_input_tokens ?? 0,
        },
      };
    }
  }
}
