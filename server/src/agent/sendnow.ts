import { tr } from "../i18n.js";
import { laneKey, rows, users, type BotRecord } from "../store.js";
import { ReportedStop } from "./stopcommand.js";
import { waitingNotes } from "./steering.js";

/**
 * L58 « Envoyer maintenant » (backlog A-FAIRE L58; behaviour from the CopilotKit/OpenBot audit: « Envoyer maintenant »
 * stops the turn, keeping what is done, then sends; our own code).
 *
 * A note typed while the bot works waits for the turn's next step (steering.ts). When that step is long (a slow page, a
 * long reply being written), « Envoyer maintenant » on the waiting note stops the step under way: the turn ends at once,
 * what it did is kept (and its recap is reused, stoprecap.ts), and the notes waiting in that conversation are answered
 * right away by the usual end-of-turn path (loop.ts: "anything typed in the last instant of the turn"). The stop writes
 * its own line instead of « Arrêté. » (ReportedStop).
 */
export class SendNowStop extends ReportedStop { constructor() { super(); this.name = "SendNowStop"; } }

/**
 * Sends the note now. `interrupt` is loop.ts's (passed in). Returns "sent" (the turn of its conversation was stopped),
 * "idle" (no turn runs there any more: the note is answered as the turn ends anyway) or "gone" (already read or removed).
 */
export function sendNoteNow(bot: BotRecord, noteId: number, interrupt: (key: string, reason?: Error) => boolean): "sent" | "idle" | "gone" {
  const note = waitingNotes(bot.id).find((n) => n.id === noteId);
  if (!note) return "gone";
  if (!interrupt(laneKey(bot.id, note.thread), new SendNowStop())) return "idle";
  rows.append(bot, { kind: "notice", tone: "info", text: tr(users.localeOf(bot.userId), "I stopped the step under way to read your message now. What I did so far is kept.") }, note.thread || undefined);
  return "sent";
}
