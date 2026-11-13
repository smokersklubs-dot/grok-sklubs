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

export interface TurnUsage { inputTokens: number; outputTokens: number; cachedTokens: number }

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
