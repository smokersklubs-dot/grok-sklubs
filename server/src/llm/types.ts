/** Provider-neutral conversation model. Blocks follow the shape most chat APIs converge on. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface TextBlock { type: "text"; text: string }
export interface ImageBlock { type: "image"; mediaType: string; data: string }
export interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: Array<TextBlock | ImageBlock>;
  isError?: boolean;
}
/** Provider-private payload (e.g. reasoning blocks) that must be echoed back verbatim within a turn. */
export interface OpaqueBlock { type: "opaque"; provider: string; raw: unknown }

export type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | OpaqueBlock;

export interface ChatMessage { role: "user" | "assistant"; content: Block[] }

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

/** "pause" means the provider stopped mid-turn (e.g. a long hosted search) and expects the same turn to be continued. */
export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "pause";

/**
 * `via`: the id of the provider that served the call. Set only in hosted mode (hosted.ts tags the providers it hands out),
 * so the usage line can say who pays: the operator's keys or the customer's own.
 */
export interface TurnUsage { inputTokens: number; outputTokens: number; cachedTokens: number; via?: string }

export interface TurnResult {
  content: Block[];
  stopReason: StopReason;
  usage: TurnUsage;
  model: string;
  /** Human-readable detail when stopReason is refusal. */
  detail?: string;
  /** Web pages the answer drew on, when the provider reports them. */
  sources?: { url: string; title?: string }[];
}

export interface TurnRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  effort: Effort;
  maxTokens?: number;
  /** Let the provider search the web itself, where it can. */
  webSearch?: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  /** Fired as soon as the model starts emitting a tool call (before arguments are complete). */
  onToolStart?: (id: string, name: string) => void;
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  /** Models offered in the UI for this provider. First entry is the default. */
  readonly models: string[];
  available(): boolean;
  runTurn(req: TurnRequest): Promise<TurnResult>;
}

/** Minimal structural check of a tool input against its declared schema. Returns an error string or null. */
export function validateToolInput(spec: ToolSpec, input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be a JSON object";
  const obj = input as Record<string, unknown>;
  for (const key of spec.inputSchema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null) return `missing required field "${key}"`;
  }
  for (const [key, value] of Object.entries(obj)) {
    const decl = spec.inputSchema.properties[key] as { type?: string } | undefined;
    if (!decl?.type) continue;
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    const ok =
      decl.type === actual ||
      (decl.type === "integer" && actual === "number" && Number.isInteger(value)) ||
      (decl.type === "number" && actual === "number");
    if (!ok) return `field "${key}" should be ${decl.type}, got ${actual}`;
  }
  return null;
}

/** Merges neighbouring messages of the same role so every provider sees strictly alternating turns. */
export function alternate(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) out[out.length - 1] = { role: m.role, content: [...last.content, ...m.content] };
    else if (m.content.length) out.push(m);
  }
  return out;
}

/**
 * A failed model call, with what the turn needs to decide what to do next. `transient`: worth another try of the same
 * model (rate limit 429, overload 529/503, other 5xx, a network failure). `retryAfterMs`: the provider's own Retry-After
 * header, when it sent one. Anything else (bad credentials, unknown model, a rejected request) moves on to the next model.
 */
export class ProviderError extends Error {
  /** `code` "context_length": the request is longer than the model's context window (the turn compacts and tries once more). */
  constructor(message: string, readonly opts: { status?: number; transient: boolean; retryAfterMs?: number | null; code?: "context_length" } = { transient: false }) {
    super(message);
    this.name = "ProviderError";
  }
  get status() { return this.opts.status; }
  get transient() { return this.opts.transient; }
  get retryAfterMs() { return this.opts.retryAfterMs ?? null; }
  get code() { return this.opts.code ?? null; }
}

/**
 * Error text that means "the request is longer than the context window". Anthropic: HTTP 400 invalid_request_error
 * "prompt is too long: N tokens > M maximum" (as reported by its users; the official error page lists the 400 type but
 * not this text) and HTTP 413 request_too_large "Request exceeds the maximum allowed number of bytes"
 * (platform.claude.com/docs/en/api/errors). OpenAI-compatible endpoints: error code "context_length_exceeded" and
 * "This model's maximum context length is N tokens…" (OpenAI; DeepSeek answers with the same wording).
 */
export const CONTEXT_TOO_LONG = /prompt is too long|context[_ ]length[_ ]exceeded|maximum context length|exceeds? (?:the )?(?:model'?s? )?context (?:window|limit|length)|input length and [`']?max_tokens[`']? exceed|request_too_large|request exceeds the maximum allowed number of bytes|too many (?:input )?tokens/i;
/** Whether a failed request's status and text say it was too long for the model. */
export const isContextTooLong = (status: number | undefined, text: string) => (status === 400 || status === 413 || status === undefined) && CONTEXT_TOO_LONG.test(text);

/** HTTP statuses that mean "try again shortly": too many requests, overloaded, and server-side failures. */
export const isTransientStatus = (status: number | undefined) => status === 408 || status === 409 || status === 429 || (!!status && status >= 500);

/**
 * Retry-After as milliseconds (RFC 9110 §10.2.3: either a number of seconds or an HTTP date). Null when absent or
 * unreadable. Also understands the `retry-after-ms` header some providers send.
 */
export function retryAfterOf(headers: { get(name: string): string | null } | null | undefined, now = Date.now()): number | null {
  if (!headers) return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.get("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
