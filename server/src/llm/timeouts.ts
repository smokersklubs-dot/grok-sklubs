import { config } from "../config.js";
import { ProviderError, type LlmProvider, type TurnRequest, type TurnResult } from "./types.js";

/**
 * Time limits on every model call made through an API provider, kept on our side (an AbortController and timers: no
 * provider parameter is involved). A provider that accepts the connection and then says nothing used to hold the turn
 * open for ever, and with it the bot's queue (audits Hermes § 3.7, OpenClaw flux 3).
 *
 * - Connection ceiling (MODEL_CONNECT_TIMEOUT_SEC): the first sign of life of the answer must come within this time.
 * - Idle timeout (MODEL_IDLE_TIMEOUT_SEC): once the answer has started, no silence longer than this.
 * - Total ceiling (MODEL_CALL_TIMEOUT_MIN): one call never lasts longer than this, however lively.
 *
 * "Sign of life": anything the provider reports through `onActivity` (headers, any byte or event of the stream), and the
 * words, thinking and tool calls it hands over. A call cut here fails with a ProviderError that is `transient` (code
 * "timeout"): the turn's own path does the rest — new tries with backoff, then the backup model, then the failure card
 * (agent/reliability.ts isTransient, agent/loop.ts modelLoop, agent/failures.ts class "timeout"). The caller's own stop
 * (the user's "Stop", "Switch AI") passes through untouched.
 */
export type ModelTimeoutKind = "connect" | "idle" | "total";
export interface ModelTimeouts { connectMs: number; idleMs: number; totalMs: number }
const fromConfig = (): ModelTimeouts => ({ connectMs: config.modelConnectTimeoutMs, idleMs: config.modelIdleTimeoutMs, totalMs: config.modelCallTimeoutMs });

/** Why a call was cut (the reason of its abort signal). */
export class ModelTimeout extends Error {
  constructor(readonly kind: ModelTimeoutKind, readonly ms: number) { super(`model call ${kind} timeout after ${ms} ms`); this.name = "ModelTimeout"; }
}

const seconds = (ms: number) => (ms >= 1000 ? Math.round(ms / 1000) : Math.round(ms / 100) / 10);
function timeoutError(label: string, t: ModelTimeout): ProviderError {
  const text = t.kind === "connect" ? `${label} did not start answering within ${seconds(t.ms)} s (timeout).`
    : t.kind === "idle" ? `${label} sent nothing for ${seconds(t.ms)} s in the middle of its answer (timeout).`
    : `${label}'s answer took longer than ${Math.round(t.ms / 60_000) || 1} min (timeout).`;
  return new ProviderError(text, { transient: true, code: "timeout" });
}

/** One guarded call. `limits` is read from the configuration unless given (tests). */
export async function runTurnGuarded(provider: LlmProvider, req: TurnRequest, limits: ModelTimeouts = fromConfig()): Promise<TurnResult> {
  if (limits.connectMs <= 0 && limits.idleMs <= 0 && limits.totalMs <= 0) return provider.runTurn(req);
  const cut = new AbortController();
  let started = false;
  let quiet: NodeJS.Timeout | null = null;
  const stop = (kind: ModelTimeoutKind, ms: number) => { if (!cut.signal.aborted) cut.abort(new ModelTimeout(kind, ms)); };
  const arm = () => {
    if (quiet) clearTimeout(quiet);
    const ms = started ? limits.idleMs : limits.connectMs;
    quiet = ms > 0 ? setTimeout(() => stop(started ? "idle" : "connect", ms), ms) : null;
  };
  const alive = () => { started = true; if (!cut.signal.aborted) arm(); };
  const total = limits.totalMs > 0 ? setTimeout(() => stop("total", limits.totalMs), limits.totalMs) : null;
  arm();
  /**
   * A provider that ignores its signal must not hold the turn either: our own cut also ends the wait itself. The caller's
   * stop is left to the provider, as before (a caller may still want a late answer: roomrouting.ts records its cost).
   */
  const cutOff = new Promise<never>((_, reject) => { cut.signal.addEventListener("abort", () => reject(cut.signal.reason), { once: true }); });
  const call = provider.runTurn({
    ...req,
    signal: req.signal ? AbortSignal.any([req.signal, cut.signal]) : cut.signal,
    onActivity: () => { alive(); req.onActivity?.(); },
    onText: (delta) => { alive(); req.onText?.(delta); },
    onReasoning: (delta) => { alive(); req.onReasoning?.(delta); },
    onToolStart: (id, name) => { alive(); req.onToolStart?.(id, name); },
  });
  call.catch(() => {}); // when the cut wins the race, the call's own late failure is not an unhandled rejection
  cutOff.catch(() => {});
  try {
    return await Promise.race([call, cutOff]);
  } catch (err) {
    const why = cut.signal.reason;
    if (why instanceof ModelTimeout && !req.signal?.aborted) throw timeoutError(provider.label, why);
    throw err;
  } finally {
    if (quiet) clearTimeout(quiet);
    if (total) clearTimeout(total);
  }
}

const GUARDED = Symbol("model call timeouts");
/**
 * The same provider — the very same object, so nothing that compares or lists providers sees a difference — with every
 * call guarded from now on. Done once per provider.
 */
export function withTimeouts<P extends LlmProvider>(p: P): P {
  const marked = p as P & { [GUARDED]?: true };
  if (marked[GUARDED]) return p;
  const raw = p.runTurn.bind(p);
  const plain: LlmProvider = { get id() { return p.id; }, get label() { return p.label; }, get models() { return p.models; }, available: () => p.available(), runTurn: raw };
  (p as LlmProvider).runTurn = (req: TurnRequest) => runTurnGuarded(plain, req);
  Object.defineProperty(p, GUARDED, { value: true, enumerable: false });
  return p;
}
