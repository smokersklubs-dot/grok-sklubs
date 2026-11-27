import type { Context, Hono } from "hono";
import { enqueue, runningThreads, submitUserMessage } from "./agent/loop.js";
import { branchAt, checkRegenerate, editedText, editMessage, EditError, REGENERATE_TEXT } from "./agent/editmessage.js";
import { settleUndoRow, undoChange } from "./agent/undoable.js";
import { fail } from "./routeinput.js";
import { rows, type BotRecord, type UserRecord } from "./store.js";

/** Message actions in the chat (backlog A-FAIRE L136 rest, L98): edit, write again, branch, and « Annuler » on a change. */
export function registerMessageActions<E extends { Variables: { user: UserRecord } }>(api: Hono<E>, ownAgent: (c: Context<E>) => BotRecord) {
  const busy = (bot: BotRecord) => (thread: number) => runningThreads(bot.id).includes(thread);
  const guard = <T>(run: () => T): T => { try { return run(); } catch (err) { if (err instanceof EditError) return fail(err.status, err.message); throw err; } };
  const json = async (c: Context<E>) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  /** Edit one of your messages: a new version below it, the old one kept and marked; the bot answers the new version. */
  api.post("/bots/:id/rows/:seq/edit", async (c) => {
    const bot = ownAgent(c);
    const text = String((await json(c)).text ?? "");
    const done = guard(() => editMessage(bot, Number(c.req.param("seq")), text, busy(bot)));
    submitUserMessage(bot, editedText(done.old, done.row.body.kind === "message" ? done.row.body.text : text), false, [], undefined, done.thread);
    return c.json({ row: done.row });
  });
  /** Write the latest reply again: a new version below the old one. */
  api.post("/bots/:id/rows/:seq/regenerate", (c) => {
    const bot = ownAgent(c);
    const thread = guard(() => checkRegenerate(bot, Number(c.req.param("seq")), busy(bot)));
    enqueue(bot.id, { kind: "system", text: REGENERATE_TEXT, thread: thread || undefined, origin: "user", resumeOf: "steps" });
    return c.json({ ok: true });
  });
  /** Branch from a message of the main chat: a thread on it that knows the conversation up to there. */
  api.post("/bots/:id/rows/:seq/branch", (c) => {
    const bot = ownAgent(c);
    return c.json({ thread: guard(() => branchAt(bot, Number(c.req.param("seq")))) });
  });
  /** « Annuler » under a change the bot made at once (L98, agent/undoable.ts). */
  api.post("/bots/:id/undo/:undoId", async (c) => {
    const bot = ownAgent(c);
    const seq = Number((await json(c)).seq);
    const r = undoChange(bot, c.req.param("undoId"));
    if (Number.isInteger(seq) && r !== "gone") settleUndoRow(bot, seq, r);
    if (r === "gone") return fail(409, "This change was already undone, or no longer exists.");
    if (r === "expired") return fail(409, "It is too late to undo this change here: change it back in Settings.");
    return c.json({ ok: true, row: Number.isInteger(seq) ? rows.get(bot.id, bot.generation, seq) : null });
  });
}
