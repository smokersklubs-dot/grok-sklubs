import { AnthropicProvider } from "./anthropic.js";
import { OpenAiCompatProvider } from "./openai-compat.js";
import type { LlmProvider } from "./types.js";

export * from "./types.js";

const list = (env: string | undefined, fallback: string[]) =>
  env ? env.split(",").map((s) => s.trim()).filter(Boolean) : fallback;

const providers: LlmProvider[] = [
  new AnthropicProvider(),
  new OpenAiCompatProvider({
    id: "xai", label: "xAI", baseUrl: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY",
    models: list(process.env.XAI_MODELS, ["grok-4.7"]), sendsEffort: false,
  }),
  new OpenAiCompatProvider({
    id: "openai", label: "OpenAI-compatible", baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY",
    models: list(process.env.OPENAI_MODELS, ["gpt-5"]), sendsEffort: false,
  }),
];

/** Adds a provider at the front of the list (used by tests and by embedders with their own model). */
export function registerProvider(p: LlmProvider) {
  providers.unshift(p);
}

export function listProviders(): LlmProvider[] {
  return providers;
}

/** Model references are "provider:model". A bare model name resolves to whichever provider lists it. */
export function resolveModel(ref: string | null | undefined): { provider: LlmProvider; model: string } {
  const usable = providers.filter((p) => p.available());
  if (ref) {
    const sep = ref.indexOf(":");
    if (sep > 0) {
      const p = providers.find((x) => x.id === ref.slice(0, sep));
      if (p?.available()) return { provider: p, model: ref.slice(sep + 1) };
    }
    const owner = usable.find((p) => p.models.includes(ref));
    if (owner) return { provider: owner, model: ref };
  }
  const first = usable[0];
  if (!first) throw new Error("No model provider is configured. Add ANTHROPIC_API_KEY (or XAI_API_KEY / OPENAI_API_KEY) to .env.");
  return { provider: first, model: first.models[0] };
}

export function defaultModelRef(): string {
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  const first = providers.find((p) => p.available()) ?? providers[0];
  return `${first.id}:${first.models[0]}`;
}
