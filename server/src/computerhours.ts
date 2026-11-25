import { q } from "./db.js"; import { localize } from "./lang/index.js";
import { emit } from "./bus.js";
import { hostedMode, isOperator } from "./hosted.js";
import type { Locale } from "./shared.js";
import { allMachines, containerOfKey, docker, linuxScreen, setWakeGate } from "./linux.js";
import { sharedOwners } from "./sharedcomputers.js";
import { audit, bots, rows, users } from "./store.js";

/**
 * L95 — a separate cap on COMPUTER HOURS (Superbot / AI-Teammates / Hermes audits: "you control what the computers
 * cost"), and computers whose bot no longer exists are stopped.
 *
 * Hours: every minute, each computer that is awake adds the time since the last count to its account's month (UTC
 * months, like the monthly budget). An account has two possible caps, in hours per month, and the lower one counts:
 *   - its owner's own cap (Settings → Usage, « Heures d'ordinateur »), 0 or empty: none;
 *   - in hosted mode, the operator's cap for every customer account (COMPUTER_HOURS_MONTH, hours; empty or 0: none).
 *     Operators themselves are never capped by it.
 * Once reached: a computer that is asleep is not woken (the bot gets a plain error with the way forward: raise the cap,
 * or wait for the 1st of next month), and the account's awake computers that are idle are put to sleep at the next
 * count. A busy one (a command, a click under way) is never stopped: it finishes, and the next wake is refused. One
 * notice and one activity line per account and month, never one per refusal.
 *
 * Orphans: a computer (container labelled sklubot=desktop) that is running although no bot, shared computer or free
 * computer of this server owns it any more (its bot was deleted while the computer was on, an older install's
 * leftovers) is STOPPED, never removed: its home volume and container stay, so nothing is lost if it was a mistake.
 * Done once at start-up and every hour.
 */
q.run(`CREATE TABLE IF NOT EXISTS computer_hours (user_id TEXT NOT NULL, month TEXT NOT NULL, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))`);
q.run(`CREATE TABLE IF NOT EXISTS computer_hours_cap (user_id TEXT PRIMARY KEY, hours REAL, warned TEXT NOT NULL DEFAULT '')`);

const FR: Record<string, string> = {
  "The computer hours of this month are used up ({used} h of {cap} h). Raise the cap (Settings → Usage → Computer hours) or wait for the 1st of next month; your bots keep their web and server tools meanwhile.":
    "Les heures d'ordinateur du mois sont épuisées ({used} h sur {cap} h). Relève le plafond (Réglages → Usage → Heures d'ordinateur) ou attends le 1er du mois prochain ; tes bots gardent en attendant leurs outils web et serveur.",
  "Computer hours used up for this month: computers will not be woken until the 1st.": "Heures d'ordinateur épuisées pour ce mois : les ordinateurs ne seront plus allumés avant le 1er.",
};
const t = (locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}) =>
  localize(locale, en, FR).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export const monthOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

/** The operator's cap for customer accounts in hosted mode (hours per month), or null. */
export function operatorCap(): number | null {
  const n = Number((process.env.COMPUTER_HOURS_MONTH ?? "").trim());
  return hostedMode() && Number.isFinite(n) && n > 0 ? n : null;
}
/** The account's own cap (hours per month), or null. */
export const ownCap = (userId: string): number | null => q.get<{ hours: number | null }>("SELECT hours FROM computer_hours_cap WHERE user_id = ?", userId)?.hours ?? null;
/** The cap that counts: the lower of the owner's and the operator's (operators: their own only). */
export function capOf(userId: string): number | null {
  const own = ownCap(userId), op = isOperator(userId) ? null : operatorCap();
  const both = [own, op].filter((n): n is number => n !== null && n > 0);
  return both.length ? Math.min(...both) : null;
}
export const usedMs = (userId: string, month = monthOf()) => q.get<{ ms: number }>("SELECT ms FROM computer_hours WHERE user_id = ? AND month = ?", userId, month)?.ms ?? 0;

export interface ComputerHoursView { month: string; usedHours: number; capHours: number | null; ownCapHours: number | null; operatorCapHours: number | null; reached: boolean }
export function hoursView(userId: string): ComputerHoursView {
  const used = usedMs(userId), cap = capOf(userId);
  return { month: monthOf(), usedHours: hours(used), capHours: cap, ownCapHours: ownCap(userId), operatorCapHours: isOperator(userId) ? null : operatorCap(), reached: cap !== null && used >= cap * 3_600_000 };
}
/** Sets (or clears, with null / 0) the account's own cap. Between 0.5 and 744 hours (a month of 31 days). */
export function setOwnCap(userId: string, value: unknown): ComputerHoursView {
  const n = value === null || value === "" || value === undefined ? 0 : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 744) throw new RangeError("hours");
  const v = n === 0 ? null : Math.max(0.5, Math.round(n * 10) / 10);
  q.run("INSERT INTO computer_hours_cap (user_id, hours) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET hours = excluded.hours", userId, v);
  emit(userId, { type: "usage" });
  return hoursView(userId);
}
/** Whether the account may not wake a computer now: the error to give, or null. */
export function wakeRefusal(userId: string, locale?: Locale): Error | null {
  const cap = capOf(userId);
  if (cap === null) return null;
  const used = usedMs(userId);
  return used >= cap * 3_600_000 ? new Error(t(locale, "The computer hours of this month are used up ({used} h of {cap} h). Raise the cap (Settings → Usage → Computer hours) or wait for the 1st of next month; your bots keep their web and server tools meanwhile.", { used: hours(used), cap })) : null;
}

let lastTick = 0;
/** One count: each awake computer's time since the last count goes to its account (at most 2 minutes at once). */
export async function tickComputerHours(at = Date.now(), machines = allMachines(), sleep: (key: string) => Promise<unknown> = (k) => linuxScreen.sleepKey(k)) {
  const step = lastTick ? Math.min(120_000, Math.max(0, at - lastTick)) : 60_000;
  lastTick = at;
  const month = monthOf(at);
  const reached = new Set<string>();
  for (const m of machines) {
    if (m.power !== "running") continue;
    q.run("INSERT INTO computer_hours (user_id, month, ms) VALUES (?, ?, ?) ON CONFLICT(user_id, month) DO UPDATE SET ms = ms + excluded.ms", m.userId, month, step);
    const cap = capOf(m.userId);
    if (cap !== null && usedMs(m.userId, month) >= cap * 3_600_000) reached.add(m.userId);
  }
  for (const userId of reached) {
    for (const m of machines) if (m.userId === userId && m.power === "running" && m.busy === 0) await sleep(m.key).catch(() => undefined);
    const row = q.get<{ warned: string }>("SELECT warned FROM computer_hours_cap WHERE user_id = ?", userId);
    if (row?.warned === month) continue;
    q.run("INSERT INTO computer_hours_cap (user_id, hours, warned) VALUES (?, NULL, ?) ON CONFLICT(user_id) DO UPDATE SET warned = excluded.warned", userId, month);
    const text = t(users.byId(userId)?.locale, "Computer hours used up for this month: computers will not be woken until the 1st.");
    audit(userId, "system", text);
    const chat = machines.map((m) => bots.byId(m.key)).find((b) => b && b.userId === userId);
    if (chat) rows.append(chat, { kind: "notice", tone: "warn", text, action: { kind: "settings", section: "usage" } });
    emit(userId, { type: "usage" });
  }
}

/** Running computers (sklubot=desktop) that nothing of this server owns: their container names. */
export function orphansOf(listing: string, known: Set<string>): string[] {
  return listing.split("\n").map((l) => l.split("\t")).filter(([name, state]) => name && state === "running" && !known.has(name)).map(([name]) => name);
}
/** The container names of every computer this server owns: each bot's own and free one, each shared one, each known one. */
export function knownComputerNames(): Set<string> {
  const keys = [...q.all<{ id: string }>("SELECT id FROM bots").flatMap((b) => [b.id, `fc-${b.id}`]), ...sharedOwners().keys(), ...allMachines().map((m) => m.key)];
  return new Set(keys.map(containerOfKey));
}
/** Stops the orphans (never removes them) running for an hour at least (a computer just made by another tool is left
 * alone). `known`: the container names this server owns. Returns those stopped. */
export async function stopOrphanComputers(known: Set<string> = knownComputerNames(), run: typeof docker = docker, at = Date.now()): Promise<string[]> {
  const r = await run(["ps", "--filter", "label=sklubot=desktop", "--format", "{{.Names}}\t{{.State}}"], { timeoutMs: 10_000 }).catch(() => null);
  if (!r || r.code !== 0) return [];
  const stopped: string[] = [];
  for (const name of orphansOf(r.stdout.toString("utf8"), known)) {
    const started = Date.parse((await run(["inspect", "-f", "{{.State.StartedAt}}", name], { timeoutMs: 8000 }).catch(() => null))?.stdout.toString("utf8").trim() ?? "");
    if (!Number.isFinite(started) || at - started < 3_600_000) continue;
    const s = await run(["stop", "-t", "10", name], { timeoutMs: 30_000 }).catch(() => null);
    if (s?.code === 0) { stopped.push(name); console.log(`[computers] stopped ${name}: no bot of this server owns it (kept, not removed)`); }
  }
  return stopped;
}

setWakeGate((userId) => wakeRefusal(userId, users.byId(userId)?.locale));
