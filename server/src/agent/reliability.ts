import { createHash } from "node:crypto";
import { config } from "../config.js";
import { defaultModelRef, modelAvailable, ProviderError, type ToolUseBlock } from "../llm/index.js";
import { settings, type BotRecord } from "../store.js";
import { isEngineRef } from "./engine.js";
import type { ToolOutput } from "./tools.js";

/**
 * What keeps a turn going when the model misbehaves: new tries with exponential backoff on passing errors, an ordered
 * list of backup models, and a guard against going round in circles with tools.
 */

/**
 * The models a turn may use, in order: the bot's own, then its backups — the bot's own list when it has one, else the
 * account's (Settings → Models), else the server's FALLBACK_MODELS. Subscription engines (Claude Code, Codex) run a
 * different kind of turn and are left out, as are models whose provider is not set up on this server.
 */
export function modelChain(bot: Pick<BotRecord, "model" | "fallbackModels" | "userId">): string[] {
  const own = bot.model || defaultModelRef();
  const account = settings.reliability(bot.userId).fallbackModels;
  const backups = bot.fallbackModels ?? (account.length ? account : config.fallbackModels);
  const out = [own];
  for (const ref of backups) if (!out.includes(ref) && !isEngineRef(ref) && modelAvailable(ref, bot.userId)) out.push(ref);
  return out;
}

/** Errors worth another try of the same model: rate limits, overload, 5xx, network failures. */
export function isTransient(err: unknown): boolean {
  if (err instanceof ProviderError) return err.transient;
  const e = err as { name?: string; cause?: { code?: string }; code?: string } | null;
  const code = e?.cause?.code ?? e?.code;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(code ?? "");
}

/**
 * How long to wait before try number `attempt` (0 = the first new try). Exponential backoff with "equal jitter"
 * (half fixed, half random) so many bots do not retry in step. A Retry-After from the provider is honoured as given
 * (plus a little jitter). Returns null when the wait would exceed `maxMs`: better to move on to the next model.
 */
export function backoffDelay(attempt: number, retryAfterMs: number | null, rand = Math.random(), baseMs = config.retryBaseMs, maxMs = config.retryMaxWaitMs): number | null {
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    if (retryAfterMs > maxMs) return null;
    return Math.round(retryAfterMs + rand * Math.min(baseMs, 1000) * 0.25);
  }
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + (rand * exp) / 2);
}

/** Waits, unless the turn is stopped first. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const done = () => { signal.removeEventListener("abort", stop); resolve(); };
    const stop = () => { clearTimeout(timer); reject(new Error("aborted")); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** A short, readable reason for a failed model call (never a whole error page). */
export function errorDetail(err: unknown): string {
  const status = err instanceof ProviderError ? err.status : undefined;
  const msg = String((err as Error)?.message ?? err).replace(/\s+/g, " ").trim();
  if (status === 429 || /rate.?limit/i.test(msg)) return "rate limit";
  if (status === 529 || /overloaded/i.test(msg)) return "overloaded";
  if (status && status >= 500) return `server error ${status}`;
  return msg.length > 120 ? msg.slice(0, 119) + "…" : msg;
}

const hashOf = (out: ToolOutput) => {
  const h = createHash("sha256");
  if (typeof out.content === "string") h.update(out.content);
  else for (const p of out.content) h.update(p.type === "text" ? p.text : `${p.mediaType}:${p.data}`);
  return h.digest("hex");
};

/**
 * Notices a bot going round in circles inside one turn: the same tool failing again and again (whatever it changes in
 * its arguments), or a tool giving back exactly the same result again and again (a click that changes nothing, a
 * status that never moves). Returns why it should stop, or null. Identical calls are already refused after four
 * repeats in execute(); this catches the loops that vary their arguments.
 */
export interface LoopStop { kind: "fail" | "same"; tool: string; count: number }
/** The reason in English (for the model and the activity log); the chat shows a translated line (see loop.ts). */
export const loopStopText = (w: LoopStop) => (w.kind === "fail" ? `the tool ${w.tool} failed ${w.count} times in a row` : `the tool ${w.tool} returned exactly the same result ${w.count} times in a row`);

export class LoopGuard {
  private failTool = "";
  private failStreak = 0;
  private same = new Map<string, { hash: string; count: number }>();
  constructor(private failLimit = config.loopFailStreak, private sameLimit = config.loopSameResult) {}
  check(call: ToolUseBlock, out: ToolOutput): LoopStop | null {
    if (out.isError) {
      this.failStreak = this.failTool === call.name ? this.failStreak + 1 : 1;
      this.failTool = call.name;
      if (this.failStreak >= this.failLimit) return { kind: "fail", tool: call.name, count: this.failStreak };
    } else if (this.failTool === call.name) { this.failTool = ""; this.failStreak = 0; }
    // Tools that are meant to repeat with the same answer (an acknowledgement, a progress line) do not count.
    if (call.name === "progress_update" || call.name === "message_react" || call.name === "stay_quiet") return null;
    const hash = hashOf(out);
    const prev = this.same.get(call.name);
    const count = prev && prev.hash === hash ? prev.count + 1 : 1;
    this.same.set(call.name, { hash, count });
    if (count >= this.sameLimit) return { kind: "same", tool: call.name, count };
    return null;
  }
}
