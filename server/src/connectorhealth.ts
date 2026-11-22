import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fetchProblem } from "./net.js";

/**
 * L51 — an app (MCP connector) that stops answering is said to be down, visibly, and the bot is told so instead of
 * retrying blindly (cleanroom T64, ECC audit).
 *
 *  - A tool call that gets no answer — the network, an HTTP 5xx, a timeout, a dropped connection — is counted; a call
 *    that answers (even with an error of the app itself) resets the count. Two such failures within 5 minutes: the
 *    connector is marked down (connectors.ts): its status and reason show in Settings → Apps as for a failed connection,
 *    its tools leave the next turns, and it is tried again on its own a minute later (connectors.ts RETRY_AFTER_MS).
 *  - Every later call, and the bot's prompt (prompt.ts, `connectors.down`), say "<app> is down since <time> (<reason>):
 *    do not retry, tell the user or do it another way". A call is never retried on its own (it may have done something).
 *  - The address itself is checked at every connection, on the address really reached: guardedFetch resolves the name
 *    and refuses a private one at connect time, every request, every redirect (net.ts guardedLookup). That is the
 *    "second check on the real address" of T64: there is no cached first answer to go stale.
 */
export const FAIL_WINDOW_MS = 5 * 60_000;
export const FAILS_TO_DOWN = 2;

/** Whether this error means the app did not answer (as opposed to the app answering with an error of its own). */
export function noAnswer(err: unknown): boolean {
  if (fetchProblem(err)) return true;
  if (err instanceof StreamableHTTPError && typeof err.code === "number" && err.code >= 500) return true;
  return /timed? ?out|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|fetch failed|connection closed|not connected/i.test(String((err as Error)?.message ?? err));
}

/** Counts a failed call; true when the connector should now be marked down. */
export function noteCallFailure(entry: { callFailures?: number[] }, err: unknown, at = Date.now()): boolean {
  if (!noAnswer(err)) { entry.callFailures = []; return false; }
  const list = (entry.callFailures ?? []).filter((t) => at - t < FAIL_WINDOW_MS);
  list.push(at);
  entry.callFailures = list;
  return list.length >= FAILS_TO_DOWN;
}

const hhmm = (t: number) => (t ? new Date(t).toISOString().slice(11, 16) + " UTC" : "a moment ago");
/** What the bot reads about a down app (English: the model reads it). */
export const downLine = (name: string, error: string | null, since?: number) =>
  `${name} is down since ${hhmm(since ?? 0)}${error ? ` (${error})` : ""}. Do not retry it now: it is tried again on its own. Tell the user, or do the job another way.`;
