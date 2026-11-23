import type { Context, Hono } from "hono";
import { emit } from "./bus.js";
import { interrupt, submitUserMessage } from "./agent/loop.js";
import { inheritOn, setInherit } from "./agent/helperinherit.js";
import { isModelMode, modeModels, modeOf, setMode } from "./agent/modelmodes.js";
import { planCommand, planModeOn, reviewPlan, setPlanMode } from "./agent/planmode.js";
import { sendNoteNow } from "./agent/sendnow.js";
import { waitingNotes } from "./agent/steering.js";
import { isEngineRef } from "./agent/engine.js";
import { sectionLead } from "./agent/askrules.js";
import { tr } from "./i18n.js";
import { fail } from "./routeinput.js";
import { rows, sections, users, type BotRecord, type UserRecord } from "./store.js";

/**
 * Turn extras (backlog A-FAIRE L58, L69, L79, L96), kept out of routes.ts and turncontrolroutes.ts (size limits):
 * « Envoyer maintenant » on a waiting note, plan mode (« /plan », the switch) and « Relire mon plan contre la demande »,
 * named model modes per bot, and whether helpers inherit their parent's instructions.
 */

/** « /plan <demande> » turns plan mode on for this conversation (and sends the request), « /plan off » turns it off. */
export function planTyped(bot: BotRecord, text: string, thread: number): boolean {
  const cmd = planCommand(text);
  if (!cmd) return false;
  const loc = users.localeOf(bot.userId);
  setPlanMode(bot.id, thread, cmd.on);
  rows.append(bot, { kind: "notice", tone: "info", text: cmd.on ? tr(loc, "Plan mode is on for this conversation: I will look around and show you a plan before changing anything.") : tr(loc, "Plan mode is off for this conversation.") }, thread || undefined);
  if (cmd.on && cmd.text) submitUserMessage(bot, cmd.text, false, [], undefined, thread);
  return true;
}

const threadOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : 0; };

export function registerTurnPlus<E extends { Variables: { user: UserRecord } }>(api: Hono<E>, ownBot: (c: Context<E>) => BotRecord) {
  const ownAgent = (c: Context<E>) => { const b = ownBot(c); return b.kind === "agent" ? b : fail(400, "A group chat cannot do that."); };

  /** L58 « Envoyer maintenant »: stops the step under way (what is done is kept) so the waiting note is read now. */
  api.post("/bots/:id/notes/:noteId/send-now", (c) => {
    const bot = ownAgent(c);
    const state = sendNoteNow(bot, Number(c.req.param("noteId")), interrupt);
    if (state === "gone") return c.json({ error: c.get("user").locale === "fr" ? "Ce message a déjà été lu par le bot." : "The bot has already read this message." }, 404);
    emit(bot.userId, { type: "tasks", botId: bot.id });
    return c.json({ ok: true, state, notes: waitingNotes(bot.id) });
  });

  /** L79 plan mode of one conversation: read, switch on or off. */
  api.get("/bots/:id/plan-mode", (c) => c.json({ on: planModeOn(ownAgent(c).id, threadOf(c.req.query("thread"))) !== null }));
  api.put("/bots/:id/plan-mode", async (c) => {
    const bot = ownAgent(c);
    const b = await c.req.json().catch(() => ({}));
    const thread = threadOf(b?.thread);
    const on = setPlanMode(bot.id, thread, b?.on === true);
    rows.append(bot, { kind: "notice", tone: "info", text: on ? tr(c.get("user").locale, "Plan mode is on for this conversation: I will look around and show you a plan before changing anything.") : tr(c.get("user").locale, "Plan mode is off for this conversation.") }, thread || undefined);
    return c.json({ on });
  });
  /** L79 « Relire mon plan contre la demande »: a separate model call compares the plan card with the request. */
  api.post("/bots/:id/rows/:seq/plan-review", async (c) => {
    const bot = ownAgent(c);
    try { return c.json({ review: await reviewPlan(bot, Number(c.req.param("seq"))) }); }
    catch (err) { return c.json({ error: (err as Error).message }, 400); }
  });

  /** L69 named model modes: the bot's mode and the model each mode gives now (only models the account has). */
  api.get("/bots/:id/model-mode", (c) => {
    const bot = ownAgent(c);
    return c.json({ mode: modeOf(bot.id), models: modeModels(bot), subscription: isEngineRef(bot.model) });
  });
  api.put("/bots/:id/model-mode", async (c) => {
    const bot = ownAgent(c);
    const mode = (await c.req.json().catch(() => ({})))?.mode;
    if (!isModelMode(mode)) return c.json({ error: c.get("user").locale === "fr" ? "Mode inconnu." : "Unknown mode." }, 400);
    if (isEngineRef(bot.model) && mode !== "balanced") return c.json({ error: c.get("user").locale === "fr" ? "Un bot sur abonnement garde son outil : les modes valent pour les modèles par clé." : "A subscription bot keeps its tool: modes apply to models used with a key." }, 400);
    return c.json({ mode: setMode(bot.id, mode), models: modeModels(bot) });
  });

  /** L96: whether helpers and background tasks inherit their parent bot's instructions (on by default). */
  api.get("/team/helper-inherit", (c) => c.json({ on: inheritOn(c.get("user").id) }));
  /** L96 « qui peut demander à qui » screen: each section's lead (the one picked, else its oldest bot). */
  api.get("/team/section-leads", (c) => {
    const uid = c.get("user").id;
    return c.json({ leads: Object.fromEntries(sections.list(uid).map((s) => [s.id, sectionLead(uid, s.id)?.id ?? null])) });
  });
  api.put("/team/helper-inherit", async (c) => c.json({ on: setInherit(c.get("user").id, (await c.req.json().catch(() => ({})))?.on !== false) }));
}
