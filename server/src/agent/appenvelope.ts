/**
 * L93 — calls to the user's apps (connected apps, built-in accounts, local tool servers):
 *
 * - Before the call, arguments are converted to the types the app's own schema asks for when the model wrote them as
 *   text: "5" → 5 for a number or integer, "true"/"false" → a boolean, a JSON text → an array or an object, a number →
 *   text for a string. Nothing else changes, and a value that does not convert cleanly is left as it is (the app answers).
 * - After the call, every result starts with one standard line: it ran, it partly ran, or it failed — with what to try.
 *
 * Idea from CopilotKit (MIT): our own code.
 */
import type { ToolSpec, ToolUseBlock } from "../llm/index.js";
import type { ToolOutput } from "./tools.js";

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema };

const typeOf = (s: Schema | undefined): string | undefined => (Array.isArray(s?.type) ? s!.type.find((t) => t !== "null") : s?.type);

/** One value converted to the schema's type when it was written as text (or a number for a string). */
export function coerceValue(v: unknown, s: Schema | undefined): unknown {
  const t = typeOf(s);
  if (!t) return v;
  if (typeof v === "string") {
    const x = v.trim();
    if ((t === "number" || t === "integer") && x !== "" && Number.isFinite(Number(x)) && (t === "number" || Number.isInteger(Number(x)))) return Number(x);
    if (t === "boolean" && /^(true|false)$/i.test(x)) return x.toLowerCase() === "true";
    if ((t === "array" && x.startsWith("[")) || (t === "object" && x.startsWith("{"))) {
      try { const parsed = JSON.parse(x); if (t === "array" ? Array.isArray(parsed) : parsed && typeof parsed === "object" && !Array.isArray(parsed)) return coerceValue(parsed, s); } catch { /* left as it is */ }
    }
    return v;
  }
  if (typeof v === "number" && t === "string") return String(v);
  if (Array.isArray(v) && t === "array" && s?.items) return v.map((i) => coerceValue(i, s.items));
  if (v && typeof v === "object" && !Array.isArray(v) && t === "object" && s?.properties) return coerceArgs(s, v as Record<string, unknown>);
  return v;
}

/** The arguments of a call converted to its schema's types (a new object; unknown keys kept). */
export function coerceArgs(schema: Schema | undefined, input: Record<string, unknown>): Record<string, unknown> {
  const props = schema?.properties;
  if (!props || !input || typeof input !== "object") return input;
  const out: Record<string, unknown> = { ...input };
  for (const [k, v] of Object.entries(input)) if (props[k]) out[k] = coerceValue(v, props[k]);
  return out;
}

/** For a call to an app: its arguments converted with the app's own schema (from the turn's tool list). */
export function coerceForApp(tools: ToolSpec[], call: ToolUseBlock): Record<string, unknown> {
  const spec = tools.find((t) => t.name === call.name);
  return spec ? coerceArgs(spec.inputSchema as Schema, call.input) : call.input;
}

const PARTLY = /\b(partial(ly)?|some (of the )?\w+ (failed|were skipped)|skipped \d+|warnings?:|partiellement|certains? .* (ont )?échoué)|"errors"\s*:\s*\[\s*[{"]|"failed"\s*:\s*[1-9]/i;
export const APP_RAN = "[App result: it ran.]";
export const APP_PARTLY = "[App result: it partly ran — read the details below, say what did not go through, and do not redo the parts that did.]";
export const APP_FAILED = "[App result: it failed. What to try: check the arguments against the tool's description, check the account is signed in and allowed, or try once later; never repeat the same call unchanged.]";

/** The standard first line of an app's result. */
export function appEnvelope(out: ToolOutput): ToolOutput {
  const body = typeof out.content === "string" ? out.content : out.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const line = out.isError ? APP_FAILED : PARTLY.test(body) ? APP_PARTLY : APP_RAN;
  return { ...out, content: typeof out.content === "string" ? `${line}\n${out.content}` : [{ type: "text", text: line }, ...out.content] };
}
