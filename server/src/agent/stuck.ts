import { liveEntries } from "../bus.js";
import { config } from "../config.js";
import { tr } from "../i18n.js";
import { pushLater } from "../push.js";
import { approvals, audit, bots, rows, stuckReminders, users } from "../store.js";

/**
 * Work left waiting too long (4 hours by default): an approval nobody answered, a turn still running, a bot still
 * waiting for the user on its screen. Each gets one reminder — a line in the bot's chat and a push — never more.
 * Called every minute by the scheduler (and directly by tests, with their own clock).
 */
export function remindStuck(now = Date.now()): number {
  const before = now - config.stuckReminderMs;
  const hours = Math.round(config.stuckReminderMs / 3_600_000);
  let sent = 0;
  for (const a of approvals.pendingBefore(before)) {
    const bot = bots.byId(a.botId);
    if (!bot || bot.generation !== a.generation || !stuckReminders.claim(bot.id, `approval:${a.id}`)) continue;
    const loc = users.localeOf(bot.userId);
    const card = rows.get(bot.id, a.generation, a.seq);
    const title = card?.body.kind === "card" && card.body.card.type === "approval" ? card.body.card.title : a.tool;
    const text = tr(loc, "Still waiting for your answer, for more than {h} hours: {title}", { h: hours, title });
    rows.append(bot, { kind: "notice", tone: "warn", text }, card?.thread ?? 0);
    pushLater(bot.userId, { kind: "needs", title: bot.name, body: text, botId: bot.id });
    audit(bot.userId, "system", `${bot.name}: reminder sent for an approval left waiting`, bot.id);
    sent++;
  }
  for (const [botId, live] of liveEntries()) {
    const since = live.awaiting?.since ?? (live.running ? live.startedAt : null);
    if (!since || since > before) continue;
    const bot = bots.byId(botId);
    // An open approval is reminded above, under its own key.
    if (!bot || (live.awaiting && approvals.pendingForUser(bot.userId).some((x) => x.botId === bot.id))) continue;
    if (!stuckReminders.claim(bot.id, `${live.awaiting ? "await" : "run"}:${since}`)) continue;
    const loc = users.localeOf(bot.userId);
    const text = live.awaiting
      ? tr(loc, "I have been waiting for you for more than {h} hours: {reason}.", { h: hours, reason: live.awaiting.reason })
      : tr(loc, "I have been working on this for more than {h} hours. Have a look, or stop me if it is no longer needed.", { h: hours });
    rows.append(bot, { kind: "notice", tone: "warn", text }, live.thread ?? 0);
    pushLater(bot.userId, { kind: "needs", title: bot.name, body: text, botId: bot.id });
    audit(bot.userId, "system", `${bot.name}: reminder sent for work left ${live.awaiting ? "waiting" : "running"}`, bot.id);
    sent++;
  }
  return sent;
}
