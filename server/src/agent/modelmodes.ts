import { q } from "../db.js";
import { listProviders, modelAvailable, userProvidersOf } from "../llm/index.js";
import { priceFor } from "../usage.js";
import type { BotRecord } from "../store.js";
import { isEngineRef } from "./engine.js";
import type { Trigger } from "./turn-request.js";

/**
 * L69 — named modes « Rapide / Équilibré / Le plus fort / Gratuit » and « Auto » (backlog A-FAIRE L69; behaviour from the
 * Hermes, nod, OMB, Noah, Noodle and Timon T10/T11 audits; our own code).
 *
 * A bot (API models only: a subscription bot keeps its tool) can run in a named mode instead of one fixed model:
 * - balanced: the bot's own model (what it did before; the default — nothing stored changes for an existing bot);
 * - fast: the cheapest model of the account with a known price;
 * - strongest: the dearest model of the account with a known price (price as the measure: nothing is guessed);
 * - free: a model that costs nothing — a price of 0 set in Settings → Models, or an OpenRouter-style ":free" model;
 * - auto: per message of a person, by how hard it looks (length, files, words like « analyse », « code », « compare »):
 *   an easy one on fast, a hard one on strongest, the rest on the bot's own model.
 * Only models the account ALREADY has are ever picked (a provider set up on the server or in the account, and allowed for
 * it: llm/index.ts modelAvailable). A model with no known price is never picked as fast, strongest or free, so a paid
 * model the owner did not enable or price can never be chosen behind their back. A mode with no model to offer falls back
 * to the bot's own model. A background task can ask for a lighter or stronger model too (task_start `level`).
 * Why not switch models between the steps of one turn: the provider's reasoning blocks and prompt cache belong to one
 * model, so a turn keeps the model it started on; the smaller model goes to whole turns and tasks instead.
 */
q.run("CREATE TABLE IF NOT EXISTS bot_model_modes (bot_id TEXT PRIMARY KEY, mode TEXT NOT NULL, updated_at INTEGER NOT NULL)");

export const MODEL_MODES = ["balanced", "fast", "strongest", "free", "auto"] as const;
export type ModelMode = (typeof MODEL_MODES)[number];
export const isModelMode = (v: unknown): v is ModelMode => (MODEL_MODES as readonly string[]).includes(String(v));

export const modeOf = (botId: string): ModelMode => {
  const m = q.get<{ mode: string }>("SELECT mode FROM bot_model_modes WHERE bot_id = ?", botId)?.mode;
  return isModelMode(m) ? m : "balanced";
};
export function setMode(botId: string, mode: ModelMode): ModelMode {
  if (mode === "balanced") q.run("DELETE FROM bot_model_modes WHERE bot_id = ?", botId);
  else q.run("INSERT INTO bot_model_modes (bot_id, mode, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at", botId, mode, Date.now());
  return mode;
}

/** The API models this account can use now (never the demo, never a subscription tool). */
export function accountModels(userId: string): string[] {
  const refs: string[] = [];
  for (const p of [...userProvidersOf(userId), ...listProviders()]) if (p.id !== "demo") for (const m of p.models) refs.push(`${p.id}:${m}`);
  return [...new Set(refs)].filter((ref) => !isEngineRef(ref) && modelAvailable(ref, userId));
}

const modelName = (ref: string) => ref.slice(ref.indexOf(":") + 1);
/** A model's known price for ordering (input + output, per million tokens); null when unknown. */
function costIndex(ref: string, userId: string): number | null {
  const p = priceFor(modelName(ref), userId);
  return p ? p[0] + p[1] : null;
}
const isFree = (ref: string, userId: string) => /:free$/i.test(ref) || costIndex(ref, userId) === 0;

/** The model each fixed mode gives for this bot now (null: none to offer, the bot's own model is used). */
export function modeModels(bot: Pick<BotRecord, "userId" | "model">): Record<Exclude<ModelMode, "auto">, string | null> {
  const list = accountModels(bot.userId);
  const priced = list.map((ref) => ({ ref, c: costIndex(ref, bot.userId) })).filter((x): x is { ref: string; c: number } => x.c !== null).sort((a, b) => a.c - b.c || a.ref.localeCompare(b.ref));
  return {
    balanced: bot.model || null,
    fast: priced[0]?.ref ?? null,
    strongest: priced[priced.length - 1]?.ref ?? null,
    free: list.find((ref) => isFree(ref, bot.userId)) ?? null,
  };
}

/** How hard a person's message looks: "easy", "hard" or "normal" (no model call: words, length, files). */
const HARD = /\b(analy[sz]|compar|strat[ée]g|architect|refactor|debug|d[ée]bogue|code|program|rapport|report|research|recherche|plan(?:ifie|ning)?|d[ée]montre|prove|optimi[sz]|audit|contrat|contract|juridique|legal)\w*/i;
export function difficultyOf(text: string, files = 0): "easy" | "normal" | "hard" {
  const t = String(text ?? "").trim();
  const lines = t.split(/\n+/).filter((l) => l.trim()).length;
  if (files > 0 || t.length > 600 || lines > 6 || (HARD.test(t) && t.length > 60)) return "hard";
  if (t.length <= 80 && lines <= 1 && !HARD.test(t)) return "easy";
  return "normal";
}

/**
 * The model a turn of this bot runs on under its mode (workmodel.ts, after a conversation's own model choice): the bot's
 * own model when the mode is balanced, gives nothing, or the bot runs on a subscription.
 */
export function modeModelFor(bot: BotRecord, trigger: Trigger): string {
  if (isEngineRef(bot.model)) return bot.model;
  const mode = modeOf(bot.id);
  if (mode === "balanced") return bot.model;
  const models = modeModels(bot);
  if (mode !== "auto") return models[mode] ?? bot.model;
  if (trigger.kind !== "user") return bot.model;
  const level = difficultyOf(trigger.text, trigger.attachments?.length ?? 0);
  return (level === "easy" ? models.fast : level === "hard" ? models.strongest : null) ?? bot.model;
}

/** task_start `level`: "light" → fast, "hard" → strongest, else the given model. Only models the account has. */
export function taskModel(bot: Pick<BotRecord, "userId" | "model">, level: unknown, fallback: string): string {
  if (isEngineRef(fallback) || (level !== "light" && level !== "hard")) return fallback;
  const m = modeModels(bot);
  return (level === "light" ? m.fast : m.strongest) ?? fallback;
}
