import { config } from "./config.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { computerReady, containerName, docker, holdMachine, onComputerStopping } from "./linux.js";
import type { BotJob } from "./shared.js";
import { bots, clip, newId, now, paused, users } from "./store.js";

/**
 * Long commands as background jobs, on a bot's own Linux computer (shell_run). Every command of shell_run starts there
 * as a detached process in its own session (setsid), its output going to ~/.sklubot/jobs/<id>.log; the call waits for
 * it up to its time limit. A command still running then is not killed: it becomes a background job (unless the bot
 * already runs JOBS_PER_BOT of them), and shell_run with background: true makes one at once. Same idea as
 * deepseek-harness packages/shell/tool-bash (promoteOnTimeout, run_in_background; MIT, Copyright (c) 2026 DeepSeek),
 * rewritten here for a command inside a container.
 *
 * While a job runs its computer is held busy (never put to sleep, linux.ts holdMachine), a job is stopped past
 * JOB_MAX_HOURS, and all of a bot's jobs end when its computer is put to sleep or reset. When a job ends, the bot gets
 * one message about it (a durable system notice in its queue) — never while it waits on the user's approval or on a
 * spend checkpoint (it is sent once that is settled), and not at all when the bot already read the end with job_output
 * or stopped the job itself.
 */

export const JOBS_DIR = "/root/.sklubot/jobs";
const OUT_DIR = "/root/.sklubot/outputs";

/**
 * Starts a command as a job: `sh -c JOB_SCRIPT sh <id> <command>` under setsid, so the shell is the leader of its own
 * process group (kill -- -PID stops the whole job). Its exit code lands in <id>.exit only when it ends by itself.
 */
export const JOB_SCRIPT = [
  `d=${JOBS_DIR}; mkdir -p "$d"`,
  'echo $$ > "$d/$1.pid"',
  'bash -lc "$2" > "$d/$1.log" 2>&1 < /dev/null',
  'echo $? > "$d/$1.exit.tmp" && mv "$d/$1.exit.tmp" "$d/$1.exit"',
].join("\n");

/** Waits (up to $2 seconds) for job $1 to end; prints "done" or "running". */
export const WAIT_SCRIPT = `d=${JOBS_DIR}; n=0; lim=$(($2 * 4)); while [ ! -f "$d/$1.exit" ] && [ $n -lt $lim ]; do sleep 0.25; n=$((n+1)); done; [ -f "$d/$1.exit" ] && echo done || echo running`;

/** Prints the exit code (or "-"), the size of the log, a line "---", then the last $2 bytes of the log of job $1. */
export const READ_SCRIPT = `d=${JOBS_DIR}; if [ -f "$d/$1.exit" ]; then cat "$d/$1.exit"; else echo -; fi; wc -c < "$d/$1.log" 2>/dev/null || echo 0; echo ---; tail -c "$2" "$d/$1.log" 2>/dev/null`;

/** Stops job $1: its whole process group, gently then for good. */
// dash (the computer's sh) takes "kill -TERM -PGID"; it refuses "kill -TERM -- -PGID" ("Illegal number: -").
export const KILL_SCRIPT = `d=${JOBS_DIR}; p=$(cat "$d/$1.pid" 2>/dev/null) || exit 0; kill -TERM -"$p" 2>/dev/null; sleep 2; kill -KILL -"$p" 2>/dev/null; true`;

/** For each id given: "<id> exit <code>", "<id> run" (its process is alive) or "<id> gone". */
export const STATUS_SCRIPT = `d=${JOBS_DIR}; for id in "$@"; do if [ -f "$d/$id.exit" ]; then echo "$id exit $(cat "$d/$id.exit")"; elif [ -f "$d/$id.pid" ] && kill -0 "$(cat "$d/$id.pid")" 2>/dev/null; then echo "$id run"; else echo "$id gone"; fi; done`;

/** Moves a finished job's log to ~/.sklubot/outputs/<id>.txt (kept: the full output) and removes its other files. */
const KEEP_SCRIPT = `d=${JOBS_DIR}; mkdir -p ${OUT_DIR} && mv "$d/$1.log" "${OUT_DIR}/$1.txt"; rm -f "$d/$1.pid" "$d/$1.exit"`;
const CLEAN_SCRIPT = `d=${JOBS_DIR}; rm -f "$d/$1.pid" "$d/$1.exit" "$d/$1.log"`;

interface JobRow { id: string; bot_id: string; user_id: string; command: string; status: BotJob["status"]; exit_code: number | null; started_at: number; ended_at: number | null; thread: number; origin: string; tainted: number; notified: number; note: string }
const toJob = (r: JobRow): BotJob => ({ id: r.id, botId: r.bot_id, command: r.command, status: r.status, exitCode: r.exit_code, startedAt: r.started_at, endedAt: r.ended_at, log: `~/.sklubot/jobs/${r.id}.log`, note: r.note });

export const jobs = {
  row: (id: string) => q.get<JobRow>("SELECT * FROM bot_jobs WHERE id = ?", id) ?? null,
  byId: (id: string) => { const r = jobs.row(id); return r ? toJob(r) : null; },
  forBot: (botId: string, limit = 20) => q.all<JobRow>("SELECT * FROM bot_jobs WHERE bot_id = ? ORDER BY started_at DESC LIMIT ?", botId, limit).map(toJob),
  running: (botId?: string) => (botId ? q.all<JobRow>("SELECT * FROM bot_jobs WHERE bot_id = ? AND status = 'running'", botId) : q.all<JobRow>("SELECT * FROM bot_jobs WHERE status = 'running'")),
  countRunning: (botId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_jobs WHERE bot_id = ? AND status = 'running'", botId)!.n,
  end(id: string, status: Exclude<BotJob["status"], "running">, exitCode: number | null, note = "", notified = false) {
    q.run("UPDATE bot_jobs SET status = ?, exit_code = ?, ended_at = ?, note = ?, notified = MAX(notified, ?) WHERE id = ? AND status = 'running'", status, exitCode, now(), note, notified ? 1 : 0, id);
    release(jobs.row(id)?.bot_id ?? "");
  },
  markNotified: (id: string) => q.run("UPDATE bot_jobs SET notified = 1 WHERE id = ?", id),
  /** A wake that could not run yet (the bot waits on the user): it is sent again later. */
  unnotify: (ids: string[]) => { for (const id of ids) q.run("UPDATE bot_jobs SET notified = 0 WHERE id = ?", id); if (ids.length) ensurePoller(); },
};

// ── Holding a computer awake while jobs run ──
const holds = new Map<string, () => void>();
function hold(botId: string) {
  if (holds.has(botId)) return;
  holds.set(botId, holdMachine(botId));
}
function release(botId: string) {
  if (!botId || jobs.countRunning(botId) > 0) return;
  holds.get(botId)?.();
  holds.delete(botId);
}

/** A job id short enough to type: "j" and 10 hex digits. */
const jobId = () => `j${newId("x").slice(2, 12)}`;

export interface RunResult { code: number | null; output: string; timedOut: boolean; size: number; job: BotJob | null; spilled: string | null }

/**
 * Runs a command of shell_run on the bot's Linux computer. `background`: start it as a job and return at once. Otherwise
 * wait up to `timeoutSec`; a command still running then becomes a background job (when the bot may run one more), or is
 * stopped. Output: the last OUTPUT_TAIL bytes; a longer one stays whole in ~/.sklubot/outputs/<id>.txt (`spilled`).
 */
export async function runCommand(bot: { id: string; userId: string }, workspace: string, command: string, timeoutSec: number, o: { background?: boolean; signal?: AbortSignal; thread?: number; origin?: string; tainted?: boolean } = {}): Promise<RunResult> {
  const name = await computerReady(bot.id, bot.userId, workspace);
  const busy = holdMachine(bot.id);
  try {
    if (o.background && jobs.countRunning(bot.id) >= config.jobsPerBot) throw new JobLimitError(config.jobsPerBot);
    const id = jobId();
    const start = await docker(["exec", "-d", "-w", "/root", name, "setsid", "sh", "-c", JOB_SCRIPT, "sh", id, command], { timeoutMs: 20_000 });
    if (start.code !== 0) throw new Error(`could not start the command: ${start.stderr.trim().slice(0, 200) || `exit ${start.code}`}`);
    if (o.background) return { code: null, output: "", timedOut: false, size: 0, job: register(bot, id, command, o), spilled: null };
    const kill = () => { void docker(["exec", name, "sh", "-c", KILL_SCRIPT, "sh", id], { timeoutMs: 10_000 }); };
    o.signal?.addEventListener("abort", kill, { once: true });
    let state: string;
    try {
      const w = await docker(["exec", name, "sh", "-c", WAIT_SCRIPT, "sh", id, String(timeoutSec)], { timeoutMs: (timeoutSec + 20) * 1000, signal: o.signal });
      state = w.stdout.toString("utf8").trim();
    } finally { o.signal?.removeEventListener("abort", kill); }
    const read = await readJob(name, id, OUTPUT_TAIL);
    if (o.signal?.aborted) { await docker(["exec", name, "sh", "-c", CLEAN_SCRIPT, "sh", id], { timeoutMs: 10_000 }); return { code: null, output: read.tail, timedOut: false, size: read.size, job: null, spilled: null }; }
    if (state === "done" && read.exit !== null) {
      // Finished in time: the full output is kept on the computer only when it is long.
      const long = read.size > config.spillChars;
      await docker(["exec", name, "sh", "-c", long ? KEEP_SCRIPT : CLEAN_SCRIPT, "sh", id], { timeoutMs: 10_000 });
      return { code: read.exit, output: read.tail, timedOut: false, size: read.size, job: null, spilled: long ? `${OUT_DIR}/${id}.txt` : null };
    }
    // Still running at the time limit: it goes on as a background job, unless the bot already runs as many as it may.
    if (jobs.countRunning(bot.id) < config.jobsPerBot) return { code: null, output: read.tail, timedOut: true, size: read.size, job: register(bot, id, command, o), spilled: null };
    await docker(["exec", name, "sh", "-c", KILL_SCRIPT, "sh", id], { timeoutMs: 15_000 });
    const after = await readJob(name, id, OUTPUT_TAIL);
    await docker(["exec", name, "sh", "-c", CLEAN_SCRIPT, "sh", id], { timeoutMs: 10_000 });
    return { code: null, output: after.tail, timedOut: true, size: after.size, job: null, spilled: null };
  } finally { busy(); }
}

const OUTPUT_TAIL = 20_000;

export class JobLimitError extends Error {
  constructor(readonly max: number) { super(`This computer already runs ${max} background jobs, the most it may. Wait for one to end (job_output) or stop one (job_stop).`); this.name = "JobLimitError"; }
}

function register(bot: { id: string; userId: string }, id: string, command: string, o: { thread?: number; origin?: string; tainted?: boolean }): BotJob {
  q.run("INSERT INTO bot_jobs (id, bot_id, user_id, command, started_at, thread, origin, tainted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, bot.id, bot.userId, clip(command, 2000), now(), o.thread ?? 0, o.origin ?? "", o.tainted ? 1 : 0);
  hold(bot.id);
  ensurePoller();
  return jobs.byId(id)!;
}

/** Parses READ_SCRIPT's answer. */
export function parseRead(raw: string): { exit: number | null; size: number; tail: string } {
  const lines = raw.split("\n");
  const sep = lines.indexOf("---");
  const head = sep >= 0 ? lines.slice(0, sep) : lines.slice(0, 2);
  const exitRaw = (head[0] ?? "-").trim();
  const exit = /^-?\d+$/.test(exitRaw) ? Number(exitRaw) : null;
  return { exit, size: Number((head[1] ?? "0").trim()) || 0, tail: sep >= 0 ? lines.slice(sep + 1).join("\n") : "" };
}
async function readJob(name: string, id: string, bytes: number) {
  const r = await docker(["exec", name, "sh", "-c", READ_SCRIPT, "sh", id, String(bytes)], { timeoutMs: 15_000, maxBytes: bytes + 4096 });
  return parseRead(r.stdout.toString("utf8"));
}

/** What a job looks like to the model: status, exit code, run time and the end of its output. */
export async function jobOutput(bot: { id: string; userId: string }, workspace: string, id: string, waitSec = 0, signal?: AbortSignal): Promise<{ job: BotJob; tail: string; size: number }> {
  let job = jobs.byId(id);
  if (!job || job.botId !== bot.id) throw new Error(`No job of yours has the id ${id}.`);
  const name = await computerReady(bot.id, bot.userId, workspace);
  if (job.status === "running" && waitSec > 0) {
    await docker(["exec", name, "sh", "-c", WAIT_SCRIPT, "sh", id, String(Math.min(290, Math.max(1, Math.round(waitSec))))], { timeoutMs: (waitSec + 20) * 1000, signal });
  }
  const read = await readJob(name, id, 8000);
  if (job.status === "running" && read.exit !== null) {
    // Seen ending here: the bot knows, so no separate message about it.
    jobs.end(id, read.exit === 0 ? "done" : "failed", read.exit, "", true);
    job = jobs.byId(id)!;
  }
  return { job, tail: read.tail, size: read.size };
}

/** Stops a running job (job_stop, or the Stop button in the computer panel). The bot gets no message about it. */
export async function stopJob(bot: { id: string; userId: string }, workspace: string, id: string, note = "stopped"): Promise<BotJob> {
  const job = jobs.byId(id);
  if (!job || job.botId !== bot.id) throw new Error(`No job of yours has the id ${id}.`);
  if (job.status !== "running") return job;
  const name = await computerReady(bot.id, bot.userId, workspace);
  await docker(["exec", name, "sh", "-c", KILL_SCRIPT, "sh", id], { timeoutMs: 15_000 });
  jobs.end(id, "stopped", null, note, true);
  return jobs.byId(id)!;
}

// ── Watching running jobs ────────────────────────────────────────────────────
type Waker = (botId: string, trigger: { kind: "system"; text: string; thread?: number; tainted?: boolean; origin?: string; jobIds: string[] }) => void;
let waker: Waker = () => {};
/** loop.ts tells this module how to queue a message to a bot (this module cannot import loop.ts). */
export const setJobWaker = (fn: Waker) => { waker = fn; };
let blockedCheck: (botId: string) => boolean = (botId) => !!paused.get(botId);
/** Whether a bot waits on the user (an approval, a spend checkpoint): no message about a job then. Set by loop.ts. */
export const setJobBlocked = (fn: (botId: string) => boolean) => { blockedCheck = fn; };

let poller: NodeJS.Timeout | null = null;
function ensurePoller() {
  if (poller) return;
  poller = setInterval(() => { void pollJobs().catch((err) => console.error("[jobs]", err)); }, config.jobPollMs);
  poller.unref?.();
}
/** At start-up: jobs left running by the previous server process are watched again (their computers kept running). */
export function startJobWatch() {
  if (jobs.running().length || q.get("SELECT 1 FROM bot_jobs WHERE notified = 0 AND status <> 'running' LIMIT 1")) ensurePoller();
}

let polling = false;
/** One look at every running job: ended ones are recorded, too-long ones stopped, and bots told about what ended. */
export async function pollJobs() {
  if (polling) return;
  polling = true;
  try {
    const byBot = new Map<string, JobRow[]>();
    for (const r of jobs.running()) byBot.set(r.bot_id, [...(byBot.get(r.bot_id) ?? []), r]);
    for (const [botId, list] of byBot) {
      const r = await docker(["exec", containerName(botId), "sh", "-c", STATUS_SCRIPT, "sh", ...list.map((j) => j.id)], { timeoutMs: 15_000 });
      if (r.code !== 0) {
        // The computer is not running any more: its jobs went with it.
        for (const j of list) jobs.end(j.id, "lost", null, "the computer stopped");
        continue;
      }
      hold(botId);
      const states = new Map(r.stdout.toString("utf8").split("\n").map((l) => l.trim().split(" ")).filter((p) => p[0]).map((p) => [p[0], p.slice(1)]));
      for (const j of list) {
        const st = states.get(j.id) ?? ["gone"];
        if (st[0] === "exit") { const code = Number(st[1]); jobs.end(j.id, code === 0 ? "done" : "failed", Number.isFinite(code) ? code : null); }
        else if (st[0] === "gone") jobs.end(j.id, "lost", null, "its process ended without an exit code");
        else if (now() - j.started_at > config.jobMaxMs) {
          await docker(["exec", containerName(botId), "sh", "-c", KILL_SCRIPT, "sh", j.id], { timeoutMs: 15_000 });
          jobs.end(j.id, "stopped", null, `time limit (${Math.round(config.jobMaxMs / 3_600_000 * 10) / 10} h)`);
        }
      }
    }
    await notifyEnded();
    if (!jobs.running().length && !q.get("SELECT 1 FROM bot_jobs WHERE notified = 0 AND status <> 'running' LIMIT 1") && poller) { clearInterval(poller); poller = null; }
  } finally { polling = false; }
}

/** One message per bot and conversation for the jobs that ended since it was last told (never one per job). */
async function notifyEnded() {
  const ended = q.all<JobRow>("SELECT * FROM bot_jobs WHERE notified = 0 AND status <> 'running' ORDER BY ended_at");
  const groups = new Map<string, JobRow[]>();
  for (const j of ended) {
    const bot = bots.byId(j.bot_id);
    if (!bot) { jobs.markNotified(j.id); continue; }
    if (blockedCheck(j.bot_id)) continue;
    const key = `${j.bot_id}:${j.thread}`;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  for (const list of groups.values()) {
    const bot = bots.byId(list[0].bot_id)!;
    const parts: string[] = [];
    for (const j of list) {
      let tail = "";
      try { tail = (await readJob(containerName(j.bot_id), j.id, 2000)).tail; } catch { /* computer gone */ }
      parts.push(jobLine(j, tail));
      jobs.markNotified(j.id);
    }
    waker(bot.id, {
      kind: "system", thread: list[0].thread || undefined, origin: list[0].origin || undefined, tainted: list.some((j) => !!j.tainted) || undefined, jobIds: list.map((j) => j.id),
      text: `${parts.join("\n\n")}\n\nCarry on with the work this was part of: check the result (job_output gives more of the output), then go on or tell the user where things stand. If there is nothing worth doing or saying, call stay_quiet.`,
    });
  }
}

export function jobLine(j: { id: string; command: string; status: string; exit_code: number | null; started_at: number; ended_at: number | null; note: string }, tail: string): string {
  const mins = Math.max(0, Math.round(((j.ended_at ?? now()) - j.started_at) / 60_000));
  const how = j.status === "done" || j.status === "failed" ? `finished with exit code ${j.exit_code}` : j.status === "stopped" ? `was stopped (${j.note || "stopped"})` : `ended without an exit code (${j.note || "lost"})`;
  return `[Background job ${j.id} — \`${clip(j.command, 200)}\` — ${how} after ${mins} min. Full output: ~/.sklubot/jobs/${j.id}.log]${tail.trim() ? `\nLast lines:\n${tail.trim().split("\n").slice(-25).join("\n")}` : ""}`;
}

// A computer put to sleep or wiped: whatever ran on it stopped. The bot is not woken for that.
onComputerStopping((botId) => {
  for (const j of jobs.running(botId)) jobs.end(j.id, "stopped", null, "the computer was put to sleep or reset", true);
  holds.get(botId)?.();
  holds.delete(botId);
});

/** The panel's view of a bot's jobs, with the user's language for the note. */
export const publicJobs = (botId: string) => {
  const loc = users.localeOf(bots.byId(botId)?.userId ?? "");
  return jobs.forBot(botId).map((j) => ({ ...j, note: j.note ? tr(loc, j.note) : "" }));
};
