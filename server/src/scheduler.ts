import { emit } from "./bus.js";
import { sweepIdleDesktops } from "./computer.js";
import { config } from "./config.js";
import { isValidTimezone, localParts, nextRun } from "./cron.js";
import { q } from "./db.js";
import { enqueue } from "./agent/loop.js";
import { consolidationSweep } from "./agent/memory.js";
import { routines, type RoutineRecord } from "./routines.js";
import { tr } from "./i18n.js";
import { approvals, bots, clip, now, rows, settings, tasks, users } from "./store.js";

/** Next due time per routine. One timer walks this map; nothing is scheduled twice. */
const due = new Map<string, number>();

export function schedule(routineId: string) {
  const r = routines.byId(routineId);
  due.delete(routineId);
  if (!r || !r.enabled || config.schedulerOff) return;
  if (r.trigger === "cron") {
    const next = nextRun(r.schedule, r.timezone, now());
    if (next) due.set(r.id, next);
  } else if (r.trigger === "once" && r.runAt && !r.lastRunAt) due.set(r.id, r.runAt);
}

export const unschedule = (routineId: string) => { due.delete(routineId); };

/** Runs a routine now: notes it in the chat and queues the work behind whatever the bot is doing. */
export function fireRoutine(r: RoutineRecord, payload?: unknown) {
  const bot = bots.byId(r.botId);
  if (!bot) return;
  routines.markRun(r.id, now());
  rows.append(bot, { kind: "event", event: "routine", text: tr(users.localeOf(bot.userId), "Running routine: {name}", { name: r.name }) });
  const extra = payload === undefined ? "" : `\n\n[Data received with this call]\n${clip(JSON.stringify(payload, null, 2), 8000)}`;
  enqueue(bot.id, { kind: "routine", name: r.name, text: r.prompt + extra });
  emit(bot.userId, { type: "routines", botId: bot.id });
}

function tickRoutines() {
  const t = now();
  for (const [id, at] of due) {
    if (at > t) continue;
    const r = routines.byId(id);
    due.delete(id);
    if (!r || !r.enabled) continue;
    fireRoutine(r);
    if (r.trigger === "cron") schedule(id);
  }
}

// ── Proactive check-ins ──────────────────────────────────────────────────────
export function fireCheckin(userId: string, quietStreak: number) {
  const primary = bots.primary(userId);
  if (!primary) return;
  const all = bots.list(userId);
  const name = (id: string) => all.find((b) => b.id === id)?.name ?? "a bot";
  const waiting = tasks.forUser(userId).filter((t) => t.state === "needs_input").slice(0, 10);
  const pending = approvals.pendingForUser(userId);
  const ran = routines.ranSince(userId, now() - 12 * 3600_000);
  const others = all.filter((b) => b.kind === "agent" && b.id !== primary.id);
  enqueue(primary.id, {
    kind: "system",
    text: [
      "This is a scheduled check-in: the user did not ask for anything. Look at what is going on — connected apps such as calendar and mail if you have them, what you remember, what the other bots are doing.",
      "If there is something genuinely useful to raise (a decision the user owes, something that changed, today's schedule, a result that came in), send ONE short message. If not, call stay_quiet.",
      quietStreak >= 3 ? "Staying quiet several times in a row is completely fine." : "",
      `Tasks waiting on the user: ${waiting.length ? waiting.map((t) => `${t.title} (${name(t.botId)})`).join("; ") : "none"}`,
      `Approvals waiting: ${pending.length ? pending.map((a) => `${name(a.botId)} — ${a.tool}`).join("; ") : "none"}`,
      `Routines that ran in the last 12 hours: ${ran.length ? ran.map((r) => `${r.name} (${name(r.botId)})`).join("; ") : "none"}`,
      `Other bots: ${others.length ? others.map((b) => `${b.name}${b.label ? ` (${b.label})` : ""}`).join("; ") : "none"}`,
    ].filter(Boolean).join("\n"),
  });
}

function tickCheckins() {
  const t = now();
  for (const user of users.all()) {
    const s = settings.checkins(user.id);
    if (!s.enabled || !isValidTimezone(s.timezone)) continue;
    const p = localParts(t, s.timezone);
    const minutes = p.hour * 60 + p.minute;
    for (const time of s.times) {
      const [h, m] = time.split(":").map(Number);
      const late = minutes - (h * 60 + m);
      const slot = `${p.year}-${p.month}-${p.day} ${time}`;
      if (late < 0 || late > 4 || s.lastSlot === slot) continue;
      settings.saveCheckins(user.id, { ...s, lastSlot: slot });
      // No point interrupting someone who is already talking to their bots.
      const lastTyped = q.get<{ at: number | null }>(
        `SELECT MAX(r.created_at) AS at FROM rows r JOIN bots b ON b.id = r.bot_id
         WHERE b.user_id = ? AND r.kind = 'message' AND json_extract(r.body, '$.role') = 'user' AND json_extract(r.body, '$.origin') IS NULL`, user.id)?.at ?? 0;
      if (t - lastTyped >= 20 * 60_000) fireCheckin(user.id, s.quietStreak);
      break;
    }
  }
}

export function startScheduler() {
  if (config.schedulerOff) return;
  for (const r of routines.allEnabled()) schedule(r.id);
  const guard = (fn: () => unknown) => () => { try { void Promise.resolve(fn()).catch((e) => console.error("[scheduler]", e)); } catch (e) { console.error("[scheduler]", e); } };
  setInterval(guard(tickRoutines), 15_000).unref();
  setInterval(guard(tickCheckins), 60_000).unref();
  setInterval(guard(consolidationSweep), 60_000).unref();
  setInterval(guard(sweepIdleDesktops), 60_000).unref();
}
