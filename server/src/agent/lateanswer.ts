import { q } from "../db.js";
import { tr } from "../i18n.js";
import { clip, now, rows, users, type BotRecord } from "../store.js";
import { bgTasks } from "./bgtasks.js";

/**
 * L161 « réponse tardive livrée seulement si utile » (10-timon T40; behaviour only, our own code).
 *
 * The answer to a question card (ask_user) used to start a turn whenever it came. Now, when it comes late:
 *  - "closed": the question was a helper's whose task is finished or stopped (bgtasks.ts): the answer is only recorded
 *    (the card says answered, the chat shows it, a short notice says nothing starts again). No turn.
 *  - "moved on": the owner wrote in that conversation after the question (or the bot asked another question since, or
 *    it is older than LATE_AFTER_MS): no turn now. The answer is kept (late_answers) and handed to the bot at the top of
 *    the owner's next message in that conversation (turnnotes.ts), marked as late, so it uses it only if it still matters.
 *  - otherwise it is delivered at once, as before.
 */
export const LATE_AFTER_MS = 24 * 3600_000;
export type AnswerFate = "deliver" | "moved_on" | "closed";

q.run("CREATE TABLE IF NOT EXISTS late_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, thread INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL)");

interface CardRow { seq: number; generation: number; thread?: number; createdAt: number }

/** What to do with an answer to the question card `row` of `bot`, now. `answerSeq`: the row that shows the answer itself. */
export function answerFate(bot: BotRecord, row: CardRow, t = now(), answerSeq = -1): AnswerFate {
  if (bot.parentId) {
    const task = bgTasks.byHelper(bot.id);
    if (task && (task.state === "done" || task.state === "stopped")) return "closed";
  }
  const thread = row.thread ?? 0;
  const later = q.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND seq > ? AND seq != ? AND (
       (kind = 'message' AND json_extract(body, '$.role') = 'user') OR (kind = 'card' AND json_extract(body, '$.card.type') = 'question'))`,
    bot.id, row.generation, thread, row.seq, answerSeq)!.n;
  if (later > 0 || t - row.createdAt > LATE_AFTER_MS) return "moved_on";
  return "deliver";
}

/**
 * routes.ts POST /bots/:id/cards/:seq/answer, after the card is marked answered and the answer shown in the chat:
 * `deliver` (submitUserMessage) runs only for a timely answer. Returns the fate.
 */
export function routeAnswer(bot: BotRecord, row: CardRow, answerSeq: number, question: string, answer: string, deliver: () => void, t = now()): AnswerFate {
  const fate = answerFate(bot, row, t, answerSeq);
  if (fate === "deliver") { deliver(); return fate; }
  const thread = row.thread ?? 0;
  const locale = users.localeOf(bot.userId);
  if (fate === "moved_on") q.run("INSERT INTO late_answers (bot_id, thread, question, answer, created_at) VALUES (?, ?, ?, ?, ?)", bot.id, thread, clip(question, 400), clip(answer, 4000), t);
  rows.append(bot, { kind: "notice", tone: "info", text: tr(locale, fate === "closed"
    ? "Answer noted. The work this question was for is closed, so it is only kept, nothing starts again."
    : "Answer noted. The conversation has moved on since this question, so I keep it for my next message instead of starting the old work again.") }, thread);
  return fate;
}

/** turnnotes.ts: the late answers kept for this conversation, as one note for the model; taken once. */
export function takeLateAnswers(botId: string, thread: number): string {
  const list = q.all<{ id: number; question: string; answer: string }>("SELECT id, question, answer FROM late_answers WHERE bot_id = ? AND thread = ? ORDER BY id LIMIT 5", botId, thread);
  if (!list.length) return "";
  q.run(`DELETE FROM late_answers WHERE id IN (${list.map(() => "?").join(", ")})`, ...list.map((l) => l.id));
  return list.map((l) => `(A late answer: earlier, the user also answered your older question "${l.question}": ${l.answer}\nThe conversation moved on since. Use it only if it still matters to what they ask now; do not restart the old work on your own.)`).join("\n");
}
