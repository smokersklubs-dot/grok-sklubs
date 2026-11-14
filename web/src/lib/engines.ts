import type { Engine, ModelOption } from "../types";

/** The provider tool behind each subscription engine (official names). */
export const ENGINE_TOOL: Record<Engine, string> = { "claude-code": "Claude Code", codex: "Codex" };
/** The brand the user knows their plan by. */
export const ENGINE_BRAND: Record<Engine, string> = { "claude-code": "Claude", codex: "ChatGPT" };

/** The subscription engine a model ref runs on, or null for an API model / the server default. */
export function engineOfRef(ref: string): Engine | null {
  if (ref.startsWith("claude-code:")) return "claude-code";
  if (ref.startsWith("codex:")) return "codex";
  return null;
}

export function isSubscriptionRef(ref: string | null | undefined): boolean {
  return !!ref && engineOfRef(ref) !== null;
}

/** "sonnet" → "Sonnet"; names with digits or dashes ("gpt-5") are left as they are. */
export function prettyModel(name: string): string {
  return /^[a-z]+$/.test(name) ? name[0].toUpperCase() + name.slice(1) : name;
}

/** The engine of an option: its own field, else read from the ref. */
export function engineOf(m: Pick<ModelOption, "ref" | "engine">): Engine | null {
  return m.engine ?? engineOfRef(m.ref);
}
