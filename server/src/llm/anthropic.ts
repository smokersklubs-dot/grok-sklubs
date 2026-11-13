import Anthropic from "@anthropic-ai/sdk";
import type { Block, ChatMessage, LlmProvider, StopReason, TurnRequest, TurnResult } from "./types.js";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaContentParam = Anthropic.Beta.Messages.BetaContentBlockParam;

const PROVIDER_ID = "anthropic";
/** Models for which a refused request can be re-run server-side on another model. */
const FALLBACK_CAPABLE = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/;

function toApiContent(blocks: Block[], keepOpaque: boolean): BetaContentParam[] {
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
      case "tool_result":
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
function toApiMessages(messages: ChatMessage[]): Anthropic.Beta.Messages.BetaMessageParam[] {
  let turnStart = 0;
  messages.forEach((m, i) => {
    if (m.role === "user" && !m.content.some((b) => b.type === "tool_result")) turnStart = i;
  });
  const out: Anthropic.Beta.Messages.BetaMessageParam[] = [];
  messages.forEach((m, i) => {
    const content = toApiContent(m.content, i >= turnStart);
    if (content.length) out.push({ role: m.role, content });
  });
  return out;
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
    this.client ??= new Anthropic();
    return this.client;
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const params: BetaParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? 64000,
      stream: true,
      // Stable prefix (tools + system) is cached; per-turn context lives in messages.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: toApiMessages(req.messages),
      tools: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        eager_input_streaming: true,
      })),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: req.effort },
    };
    if (FALLBACK_CAPABLE.test(req.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const stream = this.sdk().beta.messages.stream(params, { signal: req.signal });
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          req.onToolStart?.(event.content_block.id, event.content_block.name);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") req.onText?.(event.delta.text);
          else if (event.delta.type === "thinking_delta") req.onReasoning?.(event.delta.thinking);
        }
      }
      const msg = await stream.finalMessage();
      const content: Block[] = [];
      for (const block of msg.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use")
          content.push({ type: "tool_use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
        else content.push({ type: "opaque", provider: PROVIDER_ID, raw: block });
      }
      const stop: StopReason =
        msg.stop_reason === "tool_use" ? "tool_use"
        : msg.stop_reason === "max_tokens" ? "max_tokens"
        : msg.stop_reason === "refusal" ? "refusal"
        : "end";
      return {
        content,
        stopReason: stop,
        model: msg.model,
        detail: stop === "refusal" ? (msg.stop_details?.explanation ?? "The model declined this request.") : undefined,
        usage: {
          inputTokens: msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0),
          outputTokens: msg.usage.output_tokens,
          cachedTokens: msg.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw err;
      if (err instanceof Anthropic.AuthenticationError)
        throw new Error("Anthropic rejected the credentials. Check ANTHROPIC_API_KEY.");
      if (err instanceof Anthropic.RateLimitError)
        throw new Error("Anthropic rate limit reached. Try again in a moment.");
      if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
      throw err;
    }
  }
}
