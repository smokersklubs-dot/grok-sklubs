import { rowScope, bots, clip, rows, users } from "../store.js";
import { tr } from "../i18n.js";
import { handleFailure } from "./failures.js";
import type { Trigger } from "./turn-request.js";

/**
 * A turn that crashes must never take its bot down with it.
 *
 * - guardTurn: the last line of defence around one turn. The turn's own code catches what goes wrong while it works
 *   (loop.ts runScopedTurn); an error thrown outside that handling — before it starts, inside its error handling, or
 *   while it tidies up — used to be only logged, and could leave the bot marked "running" for ever: its next messages
 *   joined a turn that no longer existed and nothing answered until the server restarted. Now what the turn held is
 *   released (`release`, loop.ts), the failure goes to the failure coordinator (a card with remedies, an incident), and
 *   the bot's queue moves on to its next work.
 * - crashedTurn: an error nobody caught (`uncaughtException`, index.ts) that was raised from inside a turn — a timer or
 *   an event callback of one of its tools. Node keeps the turn's context for such a callback, so the turn it belongs to
 *   is known: that turn is stopped with TurnCrashed as the reason (the promise it was waiting on may never settle), and
 *   ends through its normal path with a failure card. Other bots' turns and the server itself go on.
 */

/** Why a turn was stopped: an error raised from inside it that nothing caught. */
export class TurnCrashed extends Error {
  constructor(readonly cause: unknown) { super(`Something broke inside this turn: ${clip(String((cause as Error)?.message ?? cause), 300)}`); this.name = "TurnCrashed"; }
}
/** The crash behind a stopped turn's signal, when that is why it stopped. */
export const crashOf = (signal: AbortSignal): TurnCrashed | null => (signal.aborted && signal.reason instanceof TurnCrashed ? signal.reason : null);

/** The scope object (store.ts rowScope) of the turn each bot is running: tells a running turn from an old one's leftovers. */
const runningScopes = new Map<string, object>();

/**
 * The bot whose running turn an uncaught error came from, or null when it came from nowhere in particular (a background
 * timer, a request handler, a turn that is already over). Call it from the process's own handlers, synchronously.
 */
export function crashedTurn(err: unknown): string | null {
  const scope = rowScope.getStore();
  if (!scope || runningScopes.get(scope.botId) !== scope) return null;
  console.error(`[turn crash ${scope.botId}]`, err);
  return scope.botId;
}

/**
 * Runs one turn (inside its rowScope). Whatever escapes it is dealt with here and never thrown further: the queue job
 * that ran the turn ends normally, so the bot's next work starts.
 */
export async function guardTurn(botId: string, trigger: Trigger, thread: number, run: () => Promise<void>, release: (botId: string) => void): Promise<void> {
  const scope = rowScope.getStore();
  if (scope) runningScopes.set(botId, scope);
  const since = Date.now();
  try {
    await run();
  } catch (err) {
    console.error(`[turn crash ${botId}]`, err);
    try { release(botId); } catch (e) { console.error(`[turn crash ${botId}] release`, e); }
    try { report(botId, trigger, thread, since, err); } catch (e) { console.error(`[turn crash ${botId}] report`, e); }
  } finally {
    if (runningScopes.get(botId) === scope) runningScopes.delete(botId);
  }
}

/** The crash is said in the chat: the failure coordinator's card (failures.ts), or a plain line for a bot it does not serve. */
function report(botId: string, trigger: Trigger, thread: number, since: number, err: unknown) {
  const bot = bots.byId(botId);
  if (!bot || bot.kind !== "agent") return;
  const work: Exclude<Trigger, { kind: "resume" }> = trigger.kind === "resume" ? { kind: "system", text: "" } : trigger;
  if (handleFailure({ bot, trigger: work, thread, since, err, origin: trigger.kind === "resume" ? "resume" : undefined })) return;
  rows.append(bot, { kind: "notice", tone: "error", text: tr(users.localeOf(bot.userId), "Something went wrong: {detail}", { detail: clip(String((err as Error)?.message ?? err), 400) }) }, thread || undefined);
}
