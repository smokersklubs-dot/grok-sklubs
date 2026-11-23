import { history, type UserRecord } from "../store.js";
import { resolveModel, type ToolSpec } from "../llm/index.js";
import { imagesIn, readsImages } from "../llm/imagetext.js";
import { cachedHealth } from "../modelhealth.js";

/**
 * L60 — « modèle de secours vérifié (outils, images) » (backlog A-FAIRE L60; nod, OpenClaw and Timon T43/T44 audits; our
 * own code).
 *
 * When a turn's model fails, the loop moves on to the next model of the bot's chain (reliability.ts modelChain). Before,
 * that next model was taken blind: a backup whose key was refused, which had no credit, or which does not take tools at
 * all failed in turn, and a backup that cannot read pictures was picked for a turn about a screenshot. Now:
 * - at the first failure of a turn's model, the backups are checked in the background (warmBackups): one tiny real request
 *   each, WITH a tool offered, so a model that refuses tools is known before it is needed;
 * - when the loop moves on (nextBackupIndex), a backup known to be broken (model health "à reconnecter", no credit, not
 *   set up; or that check failed) is skipped; when the turn carries pictures, a backup that reads them comes first;
 * - when every backup is known broken, the next one is tried anyway (the old behaviour: never a silent dead end).
 * A text-only backup still works with pictures (llm/imagetext.ts reads them for it); it simply comes after one that sees.
 */
interface Verdict { ok: boolean; tools: boolean; at: number }
const TTL_MS = 10 * 60_000;
const CHECK_TIMEOUT = 30_000;
const verdicts = new Map<string, Verdict>();
const flying = new Map<string, Promise<Verdict>>();
const keyOf = (userId: string, ref: string) => `${userId}\n${ref}`;

/** The tool offered by the check: a model that refuses tools fails it. */
const PROBE_TOOL: ToolSpec = { name: "probe_noop", description: "Does nothing. Never call it.", inputSchema: { type: "object", properties: {} } };
/** Error words of a model or server that does not take tools (OpenAI-compatible servers word it this way). */
const NO_TOOLS = /(?:does not|doesn't|do not) support (?:tools|tool[ _]?(?:use|calling|calls)|function[ _]?calling)|tools? (?:are|is) not supported|tool_choice|unsupported parameter:?\s*'?tools/i;

/** Checks one backup now (one in flight per account and model). */
export function verifyBackup(user: Pick<UserRecord, "id">, ref: string): Promise<Verdict> {
  const key = keyOf(user.id, ref);
  const running = flying.get(key);
  if (running) return running;
  const job = (async (): Promise<Verdict> => {
    try {
      const { provider, model } = resolveModel(ref, user.id);
      await provider.runTurn({ model, system: "Health check. Reply with the single word OK. Do not call any tool.", tools: [PROBE_TOOL], effort: "low", maxTokens: 32, messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }], signal: AbortSignal.timeout(CHECK_TIMEOUT) });
      return { ok: true, tools: true, at: Date.now() };
    } catch (err) {
      return { ok: false, tools: !NO_TOOLS.test(String((err as Error)?.message ?? err)), at: Date.now() };
    }
  })().then((v) => { verdicts.set(key, v); return v; }).finally(() => flying.delete(key));
  flying.set(key, job);
  return job;
}

/** The last check of a backup, if still fresh. */
export function backupVerdict(userId: string, ref: string, now = Date.now()): Verdict | null {
  const v = verdicts.get(keyOf(userId, ref));
  return v && now - v.at < TTL_MS ? v : null;
}
/** For tests. */
export const resetBackupChecks = () => { verdicts.clear(); flying.clear(); };

/** At the first failure of a turn's model: the backups not checked lately are checked in the background. */
export function warmBackups(user: Pick<UserRecord, "id">, refs: string[]): void {
  for (const ref of refs) if (!backupVerdict(user.id, ref) && !flying.has(keyOf(user.id, ref))) void verifyBackup(user, ref).catch(() => undefined);
}

const BAD_HEALTH = new Set(["reconnect", "no_credit", "none"]);
/** Whether a backup is known not to work for this account (refused key, no credit, not set up, failed its check). */
export function knownBroken(userId: string, ref: string): boolean {
  const h = cachedHealth(userId, ref);
  if (h && BAD_HEALTH.has(h.status)) return true;
  const v = backupVerdict(userId, ref);
  return !!v && (!v.ok || !v.tools);
}

function seesImages(userId: string, ref: string): boolean {
  try { const { provider, model } = resolveModel(ref, userId); return readsImages(provider, model); } catch { return false; }
}

/**
 * The index in `chain` of the model to move on to after `at`: the first backup not known broken (one that reads pictures
 * first when the turn carries some), else simply the next one. `chain.length` when there is none left.
 */
export function nextBackupIndex(chain: string[], at: number, userId: string, needsImages: boolean): number {
  const rest = chain.map((ref, i) => ({ ref, i })).filter((x) => x.i > at);
  if (!rest.length) return chain.length;
  const good = rest.filter((x) => !knownBroken(userId, x.ref));
  if (!good.length) return rest[0].i;
  if (needsImages) { const seeing = good.find((x) => seesImages(userId, x.ref)); if (seeing) return seeing.i; }
  return good[0].i;
}

/** Whether the conversation the turn works in carries pictures (its model history). */
export function turnHasImages(turn: { bot: { id: string }; generation: number; thread: number }): boolean {
  try { return imagesIn(history.load(turn.bot.id, turn.generation, turn.thread)).length > 0; } catch { return false; }
}
