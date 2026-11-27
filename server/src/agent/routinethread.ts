import { q } from "../db.js";
import { bots, clip, rows, users, type BotRecord } from "../store.js";
import { gt } from "./guardtext.js";
import type { Trigger } from "./turn-request.js";
import { saysNothingNew } from "./routineframe.js";
import { announceOfRun } from "../routineoptions.js";

/**
 * Owner decision (22/11/2026): a routine runs in its OWN thread. When a routine run starts, one message is put in the
 * main chat — "Routine « X » : en cours…" — and the run works in the thread that hangs on it (its steps, its words, its
 * approvals); the main chat only shows that message, rewritten with the result when the run ends ("Routine « X » : …").
 * The thread can be opened like any other. Its continuations (step limit, a resumed approval, a stall) stay in the same
 * thread and update the same message.
 *
 * The thread is chosen when the run starts and written into its queue row, so a restart recovers the run in the same
 * thread. Nothing stored in an existing conversation is read differently: earlier routine runs stay where they are.
 */

/**
 * Right before a routine run starts: the message it hangs on goes into the main chat and the trigger gets that thread
 * (also in its queue row, so a restart keeps it). A trigger that already has a thread, or any other trigger, is returned
 * as it is.
 */
export function openRoutineThread(botId: string, trigger: Trigger, queueId?: number): Trigger {
  if (trigger.kind !== "routine" || trigger.thread || trigger.continuation) return trigger;
  const bot = bots.byId(botId);
  if (!bot || bot.kind !== "agent") return trigger;
  // L54: the owner chose « dans la discussion » for this routine: the run works in the main chat, as before (routineoptions.ts).
  if (trigger.runId && announceOfRun(trigger.runId) === "chat") return trigger;
  const loc = users.localeOf(bot.userId);
  const parent = rows.append(bot, { kind: "message", role: "assistant", text: gt(loc, "Routine “{name}”: running…", { name: trigger.name }), origin: { kind: "routine", id: trigger.runId ?? "", name: trigger.name } }, 0);
  trigger.thread = parent.seq;
  if (queueId !== undefined) q.run("UPDATE bot_queue SET trigger = ? WHERE id = ?", JSON.stringify(trigger), queueId);
  return trigger;
}

/** The routine message a thread hangs on, when this thread is a routine's own. */
function routineParent(bot: BotRecord, thread: number) {
  if (!thread) return null;
  const p = rows.get(bot.id, bot.generation, thread);
  if (!p) return null;
  if (p.body.kind === "message" && p.body.role === "assistant" && p.body.origin?.kind === "routine") return p;
  return null;
}

/**
 * Whether the routine's thread holds something the owner must see — a notice (a cap, a limit, an error, an automatic
 * continuation on its way) or a card. Then the run is never "nothing new", whatever its last words.
 */
function threadNeedsOwner(bot: BotRecord, generation: number, thread: number): boolean {
  const list = q.all<{ kind: string; body: string }>(
    "SELECT kind, body FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind IN ('notice', 'card') ORDER BY seq DESC LIMIT 50",
    bot.id, generation, thread);
  return list.some((r) => {
    if (r.kind === "card") return true;
    // Any notice counts: a cap, a limit, an error, or "the work moves on, I carry on by myself" (L72) — a quiet run has none.
    return true;
  });
}

/**
 * A turn in a routine's thread ended: its message in the main chat now says the result (or that it stopped, or that
 * there was nothing to report); a turn that stopped to wait for the owner's approval says so there.
 */
export function closeRoutineThread(bot: BotRecord | null | undefined, thread: number, o: { said: string; failed: string; waiting: boolean }) {
  if (!bot) return;
  const p = routineParent(bot, thread);
  if (!p || p.body.kind !== "message" || p.body.origin?.kind !== "routine") return;
  const loc = users.localeOf(bot.userId);
  const name = p.body.origin.name;
  // L54: nothing new (stay_quiet, no words, or only "nothing new"): nothing is posted — the placeholder becomes a quiet
  // event line (no unread count, no push), and the thread with the run's steps stays reachable from the run log.
  if (!o.waiting && !o.failed && (!o.said || saysNothingNew(o.said)) && !threadNeedsOwner(bot, p.generation, thread)) {
    q.run("UPDATE rows SET kind = 'event' WHERE bot_id = ? AND generation = ? AND seq = ?", bot.id, p.generation, p.seq);
    rows.rewrite(bot, p.generation, p.seq, { kind: "event", event: "routine", text: gt(loc, "Routine “{name}”: nothing new.", { name }) });
    return;
  }
  // Waiting for the owner (an approval card in the thread): the main chat says so, so the card is never missed.
  const text = o.waiting ? gt(loc, "Routine “{name}”: waiting for your approval — open the thread.", { name })
    : o.failed ? gt(loc, "Routine “{name}”: stopped ({why}). Open the thread to see the steps.", { name, why: clip(o.failed, 160) })
    : o.said ? gt(loc, "Routine “{name}”: {result}", { name, result: clip(o.said, 6000) })
    : gt(loc, "Routine “{name}”: done, nothing to report.", { name });
  rows.rewrite(bot, p.generation, p.seq, { ...p.body, text });
  bots.bumpUnread(bot.id);
}
