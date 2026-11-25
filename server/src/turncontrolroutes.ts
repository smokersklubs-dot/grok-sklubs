import type { Context, Hono } from "hono";
import { emit } from "./bus.js";
import { compactCommand, compactDoneText, localeOfBot, noticeIn } from "./agent/compactplus.js";
import { compactIfNeeded } from "./agent/memory.js";
import { threadLane } from "./agent/lanes.js";
import { enqueue, inQueue, interrupt, runningThreads, submitUserMessage } from "./agent/loop.js";
import { answerSide, sideCommand } from "./agent/sidequestion.js";
import { removeNote, takeNote, waitingNotes } from "./agent/steering.js";
import { askMode, setAskMode, setSectionLead } from "./agent/askrules.js";
import { hasWork, isStopEmoji, stopCommand, stopText, stopWork, type StopReport } from "./agent/stopcommand.js"; import { planTyped } from "./turnplusroutes.js";
import { tr } from "./i18n.js";
import { fail } from "./routeinput.js";
import { bots, rows, users, type BotRecord, type UserRecord } from "./store.js";

/**
 * Turn control from the chat (backlog A-FAIRE L63, L78, L94): typed "stop" / "tout arrêter", "/btw", "/apres", the
 * "Stop" and "Tout arrêter" buttons, and « Reprendre ma note ».
 */
const ctl = { interrupt, runningThreads };

/** Stops and writes the report in the chat (the conversation the stop came from). */
export async function stopAndReport(bot: BotRecord, opts: { dropQueue: boolean; thread?: number }): Promise<StopReport> {
  const report = await stopWork(bot, opts, ctl);
  const text = stopText(users.localeOf(bot.userId), report, opts.dropQueue);
  if (text) rows.append(bot, { kind: "notice", tone: "info", text }, opts.thread || undefined);
  emit(bot.userId, { type: "tasks", botId: bot.id });
  return report;
}

/**
 * A message the owner typed that the server handles itself (the user's row is already in the chat): true when handled,
 * false when it goes to the bot as usual. A typed "stop" only means Stop while something runs or waits.
 */
export async function typedControl(bot: BotRecord, _user: UserRecord, text: string, thread: number): Promise<boolean> {
  if (bot.kind !== "agent") return false;
  const stop = isStopEmoji(text) ? "stop" : stopCommand(text);
  if (stop === "all") { await stopAndReport(bot, { dropQueue: true }); return true; }
  if (stop === "stop" && hasWork(bot)) { await stopAndReport(bot, { dropQueue: false, thread }); return true; }
  const compact = compactCommand(text); // L80 `/compact <consigne>`: summarised now, in this conversation's queue (compactplus.ts)
  if (compact) { void inQueue(bot.id, () => compactIfNeeded(bots.byId(bot.id) ?? bot, true, { thread, instruction: compact.instruction }), threadLane(bot.id, thread)).then((r) => noticeIn(bot, thread, compactDoneText(localeOfBot(bot), r)), (e) => noticeIn(bot, thread, compactDoneText(localeOfBot(bot), { changed: false, before: 0, after: 0 }, (e as Error).message))); return true; }
  if (planTyped(bot, text, thread)) return true; // L79 « /plan <demande> », « /plan off » (turnplusroutes.ts)
  const side = sideCommand(text);
  if (side?.kind === "btw") { void answerSide(bot, side.text, thread); return true; }
  // « Traite ça après »: its own turn, after the current work — never a note folded into the running turn.
  if (side?.kind === "later") { enqueue(bot.id, { kind: "user", text: side.text, thread: thread || undefined }); return true; }
  return false;
}

export function registerTurnControl<E extends { Variables: { user: UserRecord } }>(api: Hono<E>, ownBot: (c: Context<E>) => BotRecord) {
  const ownAgent = (c: Context<E>) => { const b = ownBot(c); return b.kind === "agent" ? b : fail(400, "A group chat cannot do that."); };
  /** "Stop" (thread given: that task; none: every task of the bot) — cascades to helpers, tasks and teammates; the queue stays. */
  api.post("/bots/:id/stop", async (c) => {
    const bot = ownBot(c);
    const t = Number((await c.req.json().catch(() => ({})))?.thread);
    if (bot.kind !== "agent") { interrupt(bot.id); return c.json({ ok: true }); }
    return c.json({ ok: true, report: await stopAndReport(bot, { dropQueue: false, thread: Number.isInteger(t) && t >= 0 ? t : undefined }) });
  });
  /** "Tout arrêter": everything, queue and notes included; the answer and the chat say what was stopped and dropped. */
  api.post("/bots/:id/stop-all", async (c) => c.json({ ok: true, report: await stopAndReport(ownAgent(c), { dropQueue: true }) }));
  /** L96 « qui peut demander à qui »: "open" (default) or "hierarchy"; a section's lead (askrules.ts). */
  api.get("/team/ask-policy", (c) => c.json({ mode: askMode(c.get("user").id) }));
  api.put("/team/ask-policy", async (c) => {
    const mode = (await c.req.json().catch(() => ({})))?.mode;
    if (mode !== "open" && mode !== "hierarchy") return c.json({ error: tr(c.get("user").locale, "Unknown choice.") }, 400);
    return c.json({ mode: setAskMode(c.get("user").id, mode) });
  });
  api.put("/sections/:id/lead", async (c) => {
    const user = c.get("user");
    const botId = String((await c.req.json().catch(() => ({})))?.botId ?? "");
    const lead = bots.owned(user.id, botId);
    if (!lead || lead.kind !== "agent" || lead.sectionId !== c.req.param("id")) return c.json({ error: tr(user.locale, "That bot is not in this section.") }, 404);
    setSectionLead(user.id, lead.sectionId, lead.id);
    return c.json({ lead: lead.id });
  });
  /** L58 « file visible »: the notes typed during the work that no turn has read yet; « Retirer » takes one back. */
  api.get("/bots/:id/notes", (c) => c.json({ notes: waitingNotes(ownAgent(c).id) }));
  api.delete("/bots/:id/notes/:noteId", (c) => {
    const bot = ownAgent(c);
    if (!removeNote(bot.id, Number(c.req.param("noteId")))) return c.json({ error: tr(c.get("user").locale, "The bot has already read this message.") }, 404);
    return c.json({ ok: true, notes: waitingNotes(bot.id) });
  });
  /** « Reprendre ma note » (L94): the note a restart kept is sent again as a new message. */
  api.post("/bots/:id/notes/:noteId/send-again", async (c) => {
    const bot = ownAgent(c);
    const seq = Number((await c.req.json().catch(() => ({})))?.seq);
    const note = takeNote(bot.id, Number(c.req.param("noteId")));
    if (!note) return c.json({ error: tr(c.get("user").locale, "This note was already sent again, or is gone.") }, 404);
    const row = rows.get(bot.id, bot.generation, seq);
    if (row?.body.kind === "notice" && row.body.action?.kind === "note") rows.rewrite(bot, bot.generation, seq, { ...row.body, action: { ...row.body.action, status: "done" } });
    const sent = rows.append(bot, { kind: "message", role: "user", text: note.text, attachments: note.attachments.length ? note.attachments : undefined }, note.thread || undefined);
    submitUserMessage(bot, note.text, false, note.attachments, undefined, note.thread);
    return c.json({ row: sent });
  });
}
