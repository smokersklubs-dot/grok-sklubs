import { AnthropicProvider } from "./anthropic.js";
import { DemoProvider } from "./demo.js";
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
  new DemoProvider(),
];

/** Adds a provider at the front of the list (used by tests and by embedders with their own model). */
export function registerProvider(p: LlmProvider) {
  providers.unshift(p);
}

export function listProviders(): LlmProvider[] {
  return providers;
}

/**
 * Providers a user set up themselves (Settings → Models → API providers; apimodels.ts). They are only ever looked up with
 * that user's id: one account never resolves, lists or pays for another's. Their ids start with "up-".
 */
let userProviderSource: (userId: string) => LlmProvider[] = () => [];
export const setUserProviderSource = (fn: (userId: string) => LlmProvider[]) => { userProviderSource = fn; };
export const userProvidersOf = (userId: string | null | undefined): LlmProvider[] => (userId ? userProviderSource(userId) : []);
export const isUserProviderRef = (ref: string | null | undefined) => !!ref && ref.startsWith("up-");
/** A user's own provider named by a reference ("up-…:model"), when it belongs to that user and is usable. */
function userProviderFor(ref: string, userId: string | null | undefined): LlmProvider | null {
  const sep = ref.indexOf(":");
  if (sep <= 0 || !isUserProviderRef(ref)) return null;
  const p = userProvidersOf(userId).find((x) => x.id === ref.slice(0, sep));
  return p?.available() ? p : null;
}

/** Model references are "provider:model". A bare model name resolves to whichever provider lists it. */
export function resolveModel(ref: string | null | undefined, userId?: string | null): { provider: LlmProvider; model: string } {
  const usable = providers.filter((p) => p.available());
  if (ref) {
    const own = userProviderFor(ref, userId);
    if (own) return { provider: own, model: ref.slice(ref.indexOf(":") + 1) };
    const sep = ref.indexOf(":");
    if (sep > 0) {
      const p = providers.find((x) => x.id === ref.slice(0, sep));
      if (p?.available()) return { provider: p, model: ref.slice(sep + 1) };
    }
    const owner = usable.find((p) => p.models.includes(ref));
    if (owner) return { provider: owner, model: ref };
  }
  // No model on the server itself: a model the user set up is better than nothing.
  const first = usable[0] ?? userProvidersOf(userId).find((p) => p.available() && p.models.length);
  if (!first) throw new Error("No model provider is configured. Add ANTHROPIC_API_KEY (or XAI_API_KEY / OPENAI_API_KEY) to .env.");
  return { provider: first, model: first.models[0] };
}

/** How a model reference reads in the chat: a user's own provider by its name ("DeepSeek deepseek-flash"), else as is. */
export function modelLabel(ref: string, userId?: string | null): string {
  const p = isUserProviderRef(ref) ? userProvidersOf(userId).find((x) => x.id === ref.slice(0, ref.indexOf(":"))) : null;
  return p ? `${p.label} ${ref.slice(ref.indexOf(":") + 1)}` : ref;
}

export function defaultModelRef(): string {
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  const first = providers.find((p) => p.available()) ?? providers[0];
  return `${first.id}:${first.models[0]}`;
}

/** Whether a reference names a model of a provider that is set up here (unlike resolveModel, never falls back). */
export function modelAvailable(ref: string, userId?: string | null): boolean {
  if (isUserProviderRef(ref)) return !!userProviderFor(ref, userId);
  const sep = ref.indexOf(":");
  if (sep > 0) {
    const p = providers.find((x) => x.id === ref.slice(0, sep));
    return !!p && p.available();
  }
  return providers.some((p) => p.available() && p.models.includes(ref));
}
