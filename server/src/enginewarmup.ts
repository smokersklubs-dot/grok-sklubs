/**
 * L145 « tour de chauffe des moteurs après redémarrage » (idea: Nightly, Noah, OMB — our own code).
 *
 * After Sklubot restarts, the first message to a bot that runs on its owner's subscription (Claude Code, Codex: agent/
 * engine.ts) is slow: its Linux computer has to wake up and be dressed, and the engine's program is read from disk for
 * the first time. So, a little after start-up, the bots that were used in the last 3 days are primed one by one, at most
 * 8, a few seconds apart: their computer is woken (linux.ts computerReady, the same path a real turn takes) and the
 * engine's program is started once with `--version` (Claude Code CLI reference, code.claude.com/docs/en/cli-reference:
 * "claude -v / --version — output the version number"; Codex: `codex --version`, the clap-generated flag listed by
 * `codex --help`, developers.openai.com/codex/cli/reference). That call asks the model nothing: it spends no tokens and
 * no subscription usage, and it never signs in or out.
 * The API models are already primed at start-up by modelhealth.ts checkAtStartup (one tiny request each).
 *
 * State per bot, shown above the composer (web EngineWarmup.tsx): "cold" (not primed since start-up), "warming",
 * "ready" (with how long it took), "failed" (with the reason, and « Réessayer »), "off" (not a subscription engine).
 *   GET  /bots/:id/engine-warmup   { warmup }
 *   POST /bots/:id/engine-warmup   primes it now (the owner's « Préchauffer » / « Réessayer ») → { warmup } (warming)
 * Owner only (bots.owned): another account's bot reads as missing (404). Kept in memory only (a restart starts cold).
 */
import type { Hono } from "hono";
import { computerKind, workspaceOf } from "./computer.js";
import { q } from "./db.js";
import { engineOf, isEngineRef } from "./agent/engine.js";
import { gt } from "./guidei18n.js";
import type { EngineWarmup } from "./guidetypes.js";
import { computerReady, docker } from "./linux.js";
import { bots, clip, users, type BotRecord, type UserRecord } from "./store.js";

const RECENT_MS = 3 * 86_400_000;
export const WARM_AT_START_MAX = 8;
const state = new Map<string, EngineWarmup>();
const flying = new Map<string, Promise<EngineWarmup>>();

/** What priming does, swapped in tests (no Docker there). Resolves on success; throws with a short reason otherwise. */
export type WarmRunner = (bot: BotRecord) => Promise<void>;
const dockerRunner: WarmRunner = async (bot) => {
  const fr = users.localeOf(bot.userId);
  if (computerKind() !== "linux") throw new Error(gt(fr, "This installation has no bot computers."));
  let name: string;
  try { name = await computerReady(bot.id, bot.userId, workspaceOf(bot.id)); }
  catch (e) { throw new Error(gt(fr, "The bot's computer could not start: {reason}", { reason: clip(String((e as Error).message ?? e), 160) })); }
  const program = engineOf(bot.model) === "codex" ? "codex" : "claude";
  const r = await docker(["exec", name, program, "--version"], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(gt(fr, "The engine is not installed on this bot's computer."));
};
let runner: WarmRunner = dockerRunner;
export const setWarmRunner = (fn: WarmRunner | null) => { runner = fn ?? dockerRunner; };
export const resetWarmups = () => { state.clear(); flying.clear(); };

const engineBot = (bot: Pick<BotRecord, "kind" | "model">) => bot.kind === "agent" && isEngineRef(bot.model);

/** The bot's warm-up state now. */
export function warmupOf(botId: string): EngineWarmup {
  const bot = bots.byId(botId);
  if (!bot || !engineBot(bot)) return { botId, engine: null, state: "off", ms: null, at: null, reason: null };
  const s = state.get(botId);
  const engine = engineOf(bot.model);
  // A model changed since (another engine): what was primed no longer counts.
  return s && s.engine === engine ? s : { botId, engine, state: "cold", ms: null, at: null, reason: null };
}

/** Primes one bot now (one at a time per bot). A bot that is not on a subscription engine stays "off". */
export function warmBot(bot: BotRecord): Promise<EngineWarmup> {
  if (!engineBot(bot)) return Promise.resolve(warmupOf(bot.id));
  const running = flying.get(bot.id);
  if (running) return running;
  const engine = engineOf(bot.model);
  const started = Date.now();
  state.set(bot.id, { botId: bot.id, engine, state: "warming", ms: null, at: started, reason: null });
  const job = runner(bot)
    .then((): EngineWarmup => ({ botId: bot.id, engine, state: "ready", ms: Date.now() - started, at: Date.now(), reason: null }))
    .catch((e): EngineWarmup => ({ botId: bot.id, engine, state: "failed", ms: null, at: Date.now(), reason: clip(String((e as Error)?.message ?? e), 200) }))
    .then((w) => { state.set(bot.id, w); return w; })
    .finally(() => flying.delete(bot.id));
  flying.set(bot.id, job);
  return job;
}

/** The bots to prime after a restart: subscription-engine bots used in the last 3 days, most recent first, at most `max`. */
export function warmCandidates(max = WARM_AT_START_MAX, now = Date.now()): BotRecord[] {
  const out: { bot: BotRecord; last: number }[] = [];
  for (const u of users.all()) for (const b of bots.list(u.id)) {
    if (!engineBot(b) || b.pause) continue;
    const last = q.get<{ t: number | null }>("SELECT MAX(created_at) AS t FROM rows WHERE bot_id = ?", b.id)?.t ?? 0;
    if (last && now - last < RECENT_MS) out.push({ bot: b, last });
  }
  return out.sort((a, b) => b.last - a.last).slice(0, max).map((x) => x.bot);
}

/** At start-up, in the background: the candidates one by one, `gapMs` apart. Returns how many were primed. */
export async function warmAtStartup(max = WARM_AT_START_MAX, gapMs = 3000): Promise<number> {
  const list = warmCandidates(max);
  for (const b of list) {
    await warmBot(b);
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs).unref?.());
  }
  return list.length;
}

export function registerEngineWarmupRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  const owned = (user: UserRecord, id: string) => { const b = bots.owned(user.id, id); return b && b.kind === "agent" ? b : null; };
  api.get("/bots/:id/engine-warmup", (c) => {
    const bot = owned(c.get("user"), c.req.param("id") ?? "");
    if (!bot) return c.json({ error: "That bot does not exist." }, 404);
    return c.json({ warmup: warmupOf(bot.id) }, 200, { "cache-control": "no-store" });
  });
  api.post("/bots/:id/engine-warmup", (c) => {
    const user = c.get("user");
    const bot = owned(user, c.req.param("id") ?? "");
    if (!bot) return c.json({ error: "That bot does not exist." }, 404);
    if (!engineBot(bot)) return c.json({ error: gt(user.locale, "This bot does not run on a subscription engine.") }, 400);
    void warmBot(bot);
    return c.json({ warmup: warmupOf(bot.id) });
  });
  // After a restart, in the background (never in tests or with ENGINE_WARMUP_AT_START=0).
  if (!process.env.NO_SCHEDULER && process.env.ENGINE_WARMUP_AT_START !== "0") setTimeout(() => { void warmAtStartup().catch(() => undefined); }, 20_000).unref?.();
}
