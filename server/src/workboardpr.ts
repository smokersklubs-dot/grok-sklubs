/**
 * L175 « Livrer par demande d'intégration (pull request) » — a board task can be delivered as a pull request on GitHub
 * instead of staying local. Clean room: built from docs/cleanroom/10-timon.md T16 only (the studied product is
 * AGPL-3.0: ideas only, none of its code was read). See docs/TABLEAU.md.
 *
 * When such a task's work is done (its goal complete, or the owner's « Accepter »), the task goes to « delivering »:
 *  1. local checks on the project's clone in the bot's files: a real git folder (no link), git settings limited to a
 *     short safe list (nothing that runs a program or redirects the push), origin = the project's repository,
 *     a repository identity (name + e-mail);
 *  2. GitHub checks: the connected account (GET /user), its push right on the repository (GET /repos/{owner}/{repo});
 *  3. the owner's go-ahead before the FIRST push to a repository, and again when the account or the identity changed;
 *  4. a remote branch that moved on its own is never overwritten (refused, the owner is told); never a forced push;
 *  5. every commit sent carries the repository identity and no internal reference (task / idea number, attribution);
 *  6. push of one branch, then the pull request (POST /repos/{owner}/{repo}/pulls) with a title and body cleaned of
 *     internal references;
 *  7. polling of the pull request (GET /repos/{owner}/{repo}/pulls/{n}): merged into the planned base → the task is
 *     done (so a linked idea closes only then); closed, or merged elsewhere (an intermediate merge) → blocked.
 *
 * Official docs (GitHub REST API, version 2022-11-28):
 *  - https://docs.github.com/en/rest/users/users#get-the-authenticated-user          (login of the connected account)
 *  - https://docs.github.com/en/rest/repos/repos#get-a-repository                    (permissions.push, default_branch, archived)
 *  - https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request               (title, head, base, body; 422 = validation)
 *  - https://docs.github.com/en/rest/pulls/pulls#list-pull-requests                  (head=owner:branch, state)
 *  - https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request                  (state, merged, merged_at, base.ref, html_url)
 *  - https://docs.github.com/en/rest/about-the-rest-api/api-versions                 (X-GitHub-Api-Version header)
 *  - Git over HTTPS with a token: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
 *    ("https://x-access-token:TOKEN@github.com/owner/repo.git"); the same user:token pair is sent here as a Basic
 *    header through GIT_CONFIG_COUNT (https://git-scm.com/docs/git-config#Documentation/git-config.txt-GITCONFIGCOUNT),
 *    never in a command line or a URL.
 *  - Webhooks (pull_request "closed" with merged=true) would also work
 *    (https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request); polling is used: no public address needed.
 *
 * Isolation: every entry point takes the owner's id and reads the task with it (another account's task: 404). Tables at load.
 */
import { execFile } from "node:child_process";
import { lstatSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { q } from "./db.js";
import { resolveInWorkspace, botPathOf } from "./computer.js";
import { bots, clip, now, rows, users } from "./store.js";
import { dt } from "./workboardpri18n.js";
import { DELIVERY_PHASES, type BoardDelivery, type DeliveryPhase } from "./workboardtypes.js";

q.run(`CREATE TABLE IF NOT EXISTS board_pr (
  task_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, repo TEXT NOT NULL, folder TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT '', connector TEXT NOT NULL, ident_name TEXT NOT NULL DEFAULT '', ident_email TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL DEFAULT 'idle', pr_number INTEGER, pr_url TEXT NOT NULL DEFAULT '',
  pr_state TEXT NOT NULL DEFAULT '', pushed_sha TEXT NOT NULL DEFAULT '', pending TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS board_pr_repos (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, repo TEXT NOT NULL, login TEXT NOT NULL, ident_name TEXT NOT NULL,
  ident_email TEXT NOT NULL, approved_at INTEGER NOT NULL, PRIMARY KEY (user_id, repo))`);

/** How often an open pull request is read again. */
export const POLL_MS = 2 * 60_000;
export const MAX_COMMITS = 200;

export class DeliveryError extends Error { constructor(public status: 400 | 404 | 409, message: string, public vars: Record<string, string | number> = {}) { super(message); } }

/** Swapped by the tests (a fake GitHub API and a local bare repository); the real values point at github.com. */
export const deps = {
  apiBase: "https://api.github.com",
  remoteUrl: (repo: string) => `https://github.com/${repo}.git`,
  token: async (userId: string, connector: string): Promise<string> => (await import("./connectors.js")).githubWriteToken(userId, connector),
  accounts: async (userId: string): Promise<{ id: string; name: string }[]> => (await import("./connectors.js")).githubWriteAccounts(userId),
};

// ── Records ───────────────────────────────────────────────────────────────────────────────────────────────────
interface PrRow {
  task_id: string; user_id: string; repo: string; folder: string; base: string; connector: string; ident_name: string; ident_email: string;
  branch: string; phase: string; pr_number: number | null; pr_url: string; pr_state: string; pushed_sha: string; pending: string; note: string;
  checked_at: number; updated_at: number;
}
interface TaskLite { id: string; user_id: string; title: string; bot_id: string | null; state: string; summary: string; thread: number }
const prRow = (taskId: string) => q.get<PrRow>("SELECT * FROM board_pr WHERE task_id = ?", taskId);
const taskLite = (taskId: string) => q.get<TaskLite>("SELECT id, user_id, title, bot_id, state, summary, thread FROM board_tasks WHERE id = ?", taskId);
const ownedTask = (userId: string, taskId: string) => { const t = taskLite(taskId); if (!t || t.user_id !== userId) throw new DeliveryError(404, "That card does not exist."); return t; };
const PR_COLS = ["base", "branch", "phase", "pr_number", "pr_url", "pr_state", "pushed_sha", "pending", "note", "checked_at"] as const;
function setPr(taskId: string, patch: Partial<Record<(typeof PR_COLS)[number], string | number | null>>) {
  const keys = Object.keys(patch).filter((k) => (PR_COLS as readonly string[]).includes(k));
  if (keys.length) q.run(`UPDATE board_pr SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE task_id = ?`, ...(keys.map((k) => (patch as any)[k] ?? null) as never[]), now(), taskId);
}

export function deliveryView(taskId: string): BoardDelivery | null {
  const d = prRow(taskId);
  if (!d) return null;
  let pending: BoardDelivery["pending"] = null;
  try { pending = d.pending ? JSON.parse(d.pending) : null; } catch { pending = null; }
  return {
    repo: d.repo, folder: d.folder, base: d.base, connectorId: d.connector, identityName: d.ident_name, identityEmail: d.ident_email, branch: d.branch,
    phase: (DELIVERY_PHASES as readonly string[]).includes(d.phase) ? (d.phase as DeliveryPhase) : "idle", prNumber: d.pr_number, prUrl: d.pr_url,
    prState: (["open", "merged", "closed"].includes(d.pr_state) ? d.pr_state : "") as BoardDelivery["prState"], note: d.note, pending,
  };
}

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────
const REPO_RE = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i;
export const validRepo = (s: string) => REPO_RE.test(s) && !/\/\.\.?$/.test(s) && !s.endsWith(".git");
/** A branch we may write: plain characters, no "..", no leading "-" or "/", no ".lock" (git check-ref-format rules, simplified). */
export const validBranch = (s: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(s) && !s.includes("..") && !s.includes("//") && !s.endsWith("/") && !s.endsWith(".lock") && !s.endsWith(".");
const cleanFolder = (raw: unknown) => {
  const s = String(raw ?? "").trim().replace(/^~\/files\/?/, "").replace(/^\/+|\/+$/g, "");
  if (!s || s.length > 200 || /[\0-\x1f]/.test(s) || s.split("/").some((x) => !x || x === "." || x === "..")) throw new DeliveryError(400, "Give the folder of the project in the bot's files (where it cloned the repository).");
  return s;
};

export interface DeliveryInput { repo?: unknown; folder?: unknown; base?: unknown; connectorId?: unknown; identityName?: unknown; identityEmail?: unknown; branch?: unknown }

/** « Livrer par demande d'intégration »: set (or change) how this task is delivered. The card is looked up first. */
export async function setDelivery(userId: string, taskId: string, o: DeliveryInput): Promise<BoardDelivery> {
  const t = ownedTask(userId, taskId);
  if (t.state === "delivering") throw new DeliveryError(409, "This task is being delivered: wait for the end or stop it first.");
  const repo = String(o.repo ?? "").trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
  if (!validRepo(repo)) throw new DeliveryError(400, "Give the GitHub repository as owner/name.");
  const folder = cleanFolder(o.folder);
  const base = String(o.base ?? "").trim();
  const branch = String(o.branch ?? "").trim();
  if ((base && !validBranch(base)) || (branch && !validBranch(branch))) throw new DeliveryError(400, "That branch name is not valid.");
  const connector = String(o.connectorId ?? "");
  if (!(await deps.accounts(userId)).some((a) => a.id === connector)) throw new DeliveryError(400, "Choose one of your GitHub Code accounts (Apps).");
  const name = clip(String(o.identityName ?? "").trim(), 100), email = clip(String(o.identityEmail ?? "").trim(), 200);
  if (!!name !== !!email || (email && !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) || /[<>\n]/.test(name)) throw new DeliveryError(400, "Give both the name and the e-mail of the identity, or neither.");
  const old = prRow(taskId);
  const keepPr = old && old.repo === repo && old.branch === branch;
  q.run(`INSERT INTO board_pr (task_id, user_id, repo, folder, base, connector, ident_name, ident_email, branch, phase, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?)
    ON CONFLICT(task_id) DO UPDATE SET repo = excluded.repo, folder = excluded.folder, base = excluded.base, connector = excluded.connector, ident_name = excluded.ident_name,
    ident_email = excluded.ident_email, branch = excluded.branch, phase = CASE WHEN board_pr.phase IN ('open', 'merged') THEN board_pr.phase ELSE 'idle' END, pending = '', note = '', updated_at = excluded.updated_at`,
    taskId, userId, repo, folder, base, connector, name, email, branch, now());
  if (!keepPr) setPr(taskId, { pr_number: null, pr_url: "", pr_state: "", pushed_sha: "", phase: "idle" });
  return deliveryView(taskId)!;
}

/** Back to a local delivery. Refused while it is being delivered. */
export function clearDelivery(userId: string, taskId: string) {
  const t = ownedTask(userId, taskId);
  if (t.state === "delivering") throw new DeliveryError(409, "This task is being delivered: wait for the end or stop it first.");
  q.run("DELETE FROM board_pr WHERE task_id = ?", taskId);
}

// ── Hooks to the board (workboard.ts registers them; no import back) ─────────────────────────────────────────────
type EndFn = (taskId: string, outcome: "merged" | "stopped", note: string) => void;
let endHook: EndFn = () => {};
export const onDeliveryEnd = (fn: EndFn) => { endHook = fn; };

/**
 * Called by the board when a task would become done. A task delivered by pull request, not merged yet, goes to
 * « delivering » instead (the caller stops there), and the delivery starts. Returns true when it took over.
 */
export function interceptDone(taskId: string, summary: string): boolean {
  const d = prRow(taskId);
  if (!d || d.phase === "merged") return false;
  q.run("UPDATE board_tasks SET state = 'delivering', summary = ?, note = '', ended_at = NULL, updated_at = ? WHERE id = ?", clip(summary, 2000), now(), taskId);
  if (d.phase !== "open") setPr(taskId, { phase: "idle", note: "" });
  void deliver(taskId);
  return true;
}

/** One line for the bot's first round: where to commit, what not to write. English (the bot's own instructions). */
export function deliveryBrief(taskId: string): string {
  const d = prRow(taskId);
  if (!d) return "";
  const ident = d.ident_name ? ` with the identity “${d.ident_name} <${d.ident_email}>” (git config user.name / user.email in that clone)` : " with that clone's own git identity (user.name / user.email)";
  return `Delivery: this task goes out as a pull request on GitHub (${d.repo}). Work in your folder ${botPathOf(d.folder)} (a clone of ${d.repo}, origin = that repository) and commit your changes there${ident}. Do not push and do not open the pull request yourself: Sklubot pushes one branch and opens it after the owner's go-ahead. Never write task or idea numbers, nor attribution lines (Co-Authored-By, "Generated with…"), in commit messages.`;
}

// ── Internal references (T16): never in commit messages, PR title or body ─────────────────────────────────────────
const INTERNAL: RegExp[] = [
  /\b[a-z]{1,8}_[0-9a-f]{20}\b/i, // Sklubot ids (newId: task, idea, bot…)
  /\b(?:t[âa]che|task|id[ée]e|idea|carte|card)\s*(?:n[°o]\s*\.?|#|no\.|num[ée]ro|number)\s*\d+/iu,
  /^\s*co-authored-by\s*:.*$/gim,
  /^\s*(?:claude-session|signed-off-by-bot)\s*:.*$/gim,
  /generated (?:with|by) [^\n]*/gi,
  /\b(?:with|by|via|par|avec) sklubot\b/gi,
  /claude\.ai\/code[^\s)]*/gi,
  /noreply@anthropic\.com/gi,
  /\u{1F916}/gu,
];
/** The first internal reference found in a text, or "". */
export function internalRef(text: string): string {
  for (const re of INTERNAL) { re.lastIndex = 0; const m = re.exec(text); if (m) return clip(m[0].trim(), 60); }
  return "";
}
/** The text without its internal references (PR title and body, written by Sklubot). */
export function withoutInternalRefs(text: string): string {
  let s = text;
  for (const re of INTERNAL) s = s.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "");
  return s.replace(/\(\s*\)|\[\s*\]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

// ── Git, run by the server on the bot's clone, with nothing of that clone allowed to run a program ──────────────────
/** Repository settings allowed in the clone: anything else (aliases, hooks path, helpers, url rewrites, proxies, filters, includes…) refuses. */
const SAFE_KEYS = [
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|autocrlf|symlinks|eol|quotepath)$/,
  /^remote\.[a-z0-9_-]+\.(url|fetch)$/, /^branch\..+\.(remote|merge|rebase)$/, /^user\.(name|email)$/, /^init\.defaultbranch$/,
  /^pull\.(rebase|ff)$/, /^extensions\.objectformat$/, /^gc\.auto$/, /^push\.(autosetupremote|default)$/, /^advice\.[a-z]+$/, /^safe\.bareRepository$/i,
];
let emptyHome = "";
function gitEnv(token: string, remote: string): NodeJS.ProcessEnv {
  emptyHome ||= mkdtempSync(path.join(tmpdir(), "sklubot-git-home-"));
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: emptyHome, LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false", SSH_ASKPASS: "/bin/false", GIT_SSH_COMMAND: "/bin/false" };
  if (token && /^https:\/\//.test(remote)) {
    // The token goes in a header scoped to that origin, through the environment (never argv, never a URL).
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.${new URL(remote).origin}/.extraHeader`;
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return env;
}
function git(dir: string, args: string[], token = "", remote = ""): Promise<string> {
  const hard = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "protocol.ext.allow=never", "-c", "core.askPass=/bin/false", "-c", `safe.directory=${dir}`, "-c", "core.pager=cat"];
  return new Promise((resolve, reject) => {
    execFile("git", [...hard, ...args], { cwd: dir, env: { ...gitEnv(token, remote), GIT_DIR: path.join(dir, ".git"), GIT_CEILING_DIRECTORIES: path.dirname(dir) }, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(clip(String(stderr || err.message).replace(/Authorization:[^\n]*/gi, "Authorization: ***").trim(), 400)));
      else resolve(String(stdout));
    });
  });
}
const SHA = /^[0-9a-f]{40}$/;

/** The clone in the bot's files: a real folder with a real .git folder (no link, no "gitdir:" pointer elsewhere). */
function projectDir(botId: string, folder: string): string {
  let dir: string;
  try { dir = resolveInWorkspace(botId, folder); } catch { throw new DeliveryError(400, "The project folder “{folder}” is not a git clone in the bot's files: nothing was sent.", { folder }); }
  const st = (p: string) => { try { return lstatSync(p); } catch { return null; } };
  if (!st(dir)?.isDirectory() || !st(path.join(dir, ".git"))?.isDirectory() || !st(path.join(dir, ".git", "config"))?.isFile())
    throw new DeliveryError(400, "The project folder “{folder}” is not a git clone in the bot's files: nothing was sent.", { folder });
  return dir;
}
/** The clone's own settings, read as a file (nothing runs); refused when one is not on the safe list. */
async function localConfig(dir: string): Promise<Record<string, string>> {
  const out = await new Promise<string>((resolve, reject) => execFile("git", ["config", "--file", path.join(dir, ".git", "config"), "--no-includes", "--list", "-z"], { env: gitEnv("", ""), timeout: 20_000 }, (e, so) => (e ? reject(e) : resolve(String(so)))));
  const cfg: Record<string, string> = {};
  for (const item of out.split("\0").filter(Boolean)) {
    const nl = item.indexOf("\n");
    const key = (nl < 0 ? item : item.slice(0, nl)).toLowerCase();
    if (!SAFE_KEYS.some((re) => re.test(key))) throw new DeliveryError(400, "The project folder's git settings contain “{key}”, which Sklubot does not run for safety. Remove it, then retry.", { key: clip(key, 80) });
    cfg[key] = nl < 0 ? "" : item.slice(nl + 1);
  }
  return cfg;
}
/** "owner/name" of a GitHub remote address (https, ssh or scp form), lowercased; "" when it is not one. */
export function remoteRepo(url: string): string {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1].toLowerCase() : "";
}
const sameRemote = (origin: string, repo: string) => {
  const expected = deps.remoteUrl(repo);
  return origin.trim() === expected || (!!remoteRepo(expected) && remoteRepo(origin) === repo.toLowerCase());
};

// ── GitHub REST ──────────────────────────────────────────────────────────────────────────────────────────────
async function gh(token: string, method: "GET" | "POST", p: string, body?: object): Promise<{ status: number; json: any }> {
  const base = new URL(deps.apiBase);
  const url = new URL(base.href.replace(/\/$/, "") + p);
  if (url.origin !== base.origin) throw new Error("bad GitHub address");
  const res = await fetch(url, {
    method, redirect: "error", signal: AbortSignal.timeout(20_000), body: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Sklubot", ...(body ? { "content-type": "application/json" } : {}) },
  });
  const text = await res.text();
  if (text.length > 4_000_000) throw new Error("GitHub answer too large");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json };
}

// ── Delivery ──────────────────────────────────────────────────────────────────────────────────────────────────
const running = new Map<string, Promise<void>>();
/** Runs (once at a time per task) the next step of a task's delivery. Never throws: a refusal stops the task with the reason. */
export function deliver(taskId: string): Promise<void> {
  const cur = running.get(taskId);
  if (cur) return cur;
  const p = step(taskId).catch((e) => {
    const t = taskLite(taskId);
    if (!t) return;
    const loc = users.localeOf(t.user_id);
    const note = e instanceof DeliveryError ? dt(loc, e.message, e.vars) : dt(loc, "GitHub could not be read: {detail}", { detail: clip((e as Error).message, 300) });
    // An open pull request that could not be read this time stays open: it is read again later.
    if (prRow(taskId)?.phase === "open") setPr(taskId, { note, checked_at: now() });
    else stopDelivery(t, note);
  }).finally(() => running.delete(taskId));
  running.set(taskId, p);
  return p;
}

function say(t: TaskLite, text: string) {
  const bot = t.bot_id ? bots.byId(t.bot_id) : null;
  if (bot) rows.append(bot, { kind: "event", event: "routine", text }, t.thread || 0);
}
function stopDelivery(t: TaskLite, note: string) {
  const d = prRow(t.id);
  if (d && d.phase !== "open" && d.phase !== "merged") setPr(t.id, { phase: "refused", note, pending: "" });
  else setPr(t.id, { note });
  if (taskLite(t.id)?.state === "delivering") endHook(t.id, "stopped", note);
}

const slug = (title: string) => (title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "") || "changement");

async function step(taskId: string) {
  const d = prRow(taskId);
  const t = taskLite(taskId);
  if (!d || !t || t.state !== "delivering") return;
  if (d.phase === "open") return poll(t, d);
  if (d.phase === "approval" || d.phase === "merged") return;
  const loc = users.localeOf(t.user_id);
  if (!t.bot_id) throw new DeliveryError(400, "This task has no bot: its project folder cannot be found.");

  // 1. The clone, read without running anything of it.
  const dir = projectDir(t.bot_id, d.folder);
  const cfg = await localConfig(dir);
  const origin = cfg["remote.origin.url"] ?? "";
  if (!origin || !sameRemote(origin, d.repo)) throw new DeliveryError(400, "The project folder does not point at {repo} (its origin is “{origin}”): nothing was sent.", { repo: d.repo, origin: clip(origin.replace(/\/\/[^@/]+@/, "//"), 120) || "—" });
  const ident = { name: d.ident_name || cfg["user.name"] || "", email: d.ident_email || cfg["user.email"] || "" };
  if (!ident.name || !ident.email) throw new DeliveryError(400, "The repository identity (name and e-mail) is not set: set it on the task or in the clone, then retry.");
  let head: string;
  try { head = (await git(dir, ["rev-parse", "--verify", "HEAD^{commit}"])).trim(); } catch { throw new DeliveryError(400, "The project folder has no commit yet."); }
  if (!SHA.test(head)) throw new DeliveryError(400, "The project folder has no commit yet.");

  // 2. The account and its right on the repository.
  const token = await deps.token(t.user_id, d.connector);
  const me = await gh(token, "GET", "/user");
  if (me.status !== 200 || typeof me.json?.login !== "string") throw new DeliveryError(400, "GitHub did not accept this account (HTTP {status}): reconnect it in the apps.", { status: me.status });
  const login = String(me.json.login);
  const info = await gh(token, "GET", `/repos/${d.repo}`);
  if (info.status !== 200 || String(info.json?.full_name).toLowerCase() !== d.repo || info.json?.permissions?.push !== true || info.json?.archived || info.json?.disabled)
    throw new DeliveryError(400, "This GitHub account cannot push to {repo} (or the repository is archived).", { repo: d.repo });
  const base = d.base || String(info.json.default_branch ?? "");
  if (!validBranch(base)) throw new DeliveryError(400, "That branch name is not valid.");
  const remote = deps.remoteUrl(d.repo);

  // Branch: the owner's, or a free one named after the task (never a number of ours).
  let branch = d.branch;
  if (!branch) {
    const root = slug(withoutInternalRefs(t.title));
    for (let i = 1; i <= 20 && !branch; i++) {
      const name = i === 1 ? root : `${root}-${i}`;
      if (!(await lsRemote(dir, remote, name, token))) branch = name;
    }
    if (!branch) throw new DeliveryError(400, "That branch name is not valid.");
  }
  setPr(taskId, { base, branch });

  // 3. The owner's go-ahead: first push to this repository, or another account / identity than the one allowed.
  const ok = q.get<{ login: string; ident_name: string; ident_email: string }>("SELECT login, ident_name, ident_email FROM board_pr_repos WHERE user_id = ? AND repo = ?", t.user_id, d.repo);
  const sameIdent = ok && ok.ident_name === ident.name && ok.ident_email.toLowerCase() === ident.email.toLowerCase();
  if (!ok || ok.login !== login || !sameIdent) {
    const note = !ok ? dt(loc, "First delivery to {repo}: your go-ahead is needed before anything is pushed.", { repo: d.repo })
      : ok.login !== login ? dt(loc, "The connected GitHub account ({login}) is not the one you allowed ({expected}): allow it, or reconnect the right one.", { login, expected: ok.login })
      : dt(loc, "The repository identity changed ({ident}): your go-ahead is needed again.", { ident: `${ident.name} <${ident.email}>` });
    setPr(taskId, { phase: "approval", note, pending: JSON.stringify({ login, name: ident.name, email: ident.email, remote: clip(origin.replace(/\/\/[^@/]+@/, "//"), 200), base, branch, expectedLogin: ok?.login ?? "" }) });
    say(t, dt(loc, "Board task “{title}”: waiting for your go-ahead to push to {repo} (open the board).", { title: t.title, repo: d.repo }));
    return;
  }

  // 4. What GitHub has: the base (to know what is new) and our branch (never overwritten if it moved on its own).
  setPr(taskId, { phase: "pushing", note: "" });
  await git(dir, ["fetch", "--no-tags", "--no-write-fetch-head", remote, `+refs/heads/${base}:refs/sklubot/base`], token, remote);
  const remoteSha = await lsRemote(dir, remote, branch, token);
  // The same commit as ours is not a move (a restart between the push and its record).
  if (remoteSha && remoteSha !== d.pushed_sha && remoteSha !== head) throw new DeliveryError(409, "The branch “{branch}” on GitHub moved without Sklubot (now {sha}): nothing was overwritten. Look at it on GitHub, then retry or choose another branch.", { branch, sha: remoteSha.slice(0, 8) });

  // 5. Every commit sent: the repository identity, no internal reference.
  const excl = ["^refs/sklubot/base", ...(remoteSha ? [`^${remoteSha}`] : [])];
  const log = remoteSha === head ? "" : await git(dir, ["log", "-z", `--max-count=${MAX_COMMITS + 1}`, "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B", head, ...excl]);
  const commits = log.split("\0").filter((x) => x.trim()).map((x) => { const [sha, an, ae, cn, ce, msg] = x.split("\x1f"); return { sha: sha.trim(), an, ae, cn, ce, msg: msg ?? "" }; });
  if (!commits.length && remoteSha !== head) throw new DeliveryError(400, "There is nothing new to deliver: the project folder has no commit that {base} does not already have.", { base });
  if (commits.length > MAX_COMMITS) throw new DeliveryError(400, "More than 200 commits to send: deliver in smaller parts.");
  for (const c of commits) {
    for (const [n, e] of [[c.an, c.ae], [c.cn, c.ce]]) {
      if (n !== ident.name || e.toLowerCase() !== ident.email.toLowerCase())
        throw new DeliveryError(400, "Commit {sha} is signed “{who}”, not the repository identity “{ident}”: nothing was pushed.", { sha: c.sha.slice(0, 8), who: `${n} <${e}>`, ident: `${ident.name} <${ident.email}>` });
    }
    const what = internalRef(c.msg);
    if (what) throw new DeliveryError(400, "Commit {sha} mentions “{what}” (an internal reference): nothing was pushed. Reword it, then retry.", { sha: c.sha.slice(0, 8), what });
  }

  // 6. Push one branch — never "+", never --force: git itself refuses a push that would not be a fast-forward.
  if (remoteSha !== head) {
    try { await git(dir, ["push", "--no-verify", "--porcelain", remote, `${head}:refs/heads/${branch}`], token, remote); }
    catch (e) { throw new DeliveryError(409, "GitHub refused the push (the branch may have moved): nothing was overwritten. {detail}", { detail: clip((e as Error).message, 200) }); }
  }
  setPr(taskId, { pushed_sha: head });

  // 7. The pull request (or the one already open for that branch).
  let number = d.pr_number, url = d.pr_url;
  if (!number) {
    const title = clip(withoutInternalRefs(t.title), 200) || slug(t.title);
    const body = clip(withoutInternalRefs(taskLite(taskId)!.summary || ""), 8000);
    if (internalRef(title) || internalRef(body)) throw new DeliveryError(400, "Commit {sha} mentions “{what}” (an internal reference): nothing was pushed. Reword it, then retry.", { sha: "PR", what: internalRef(title) || internalRef(body) });
    const made = await gh(token, "POST", `/repos/${d.repo}/pulls`, { title, head: branch, base, body });
    let pr = made.status === 201 ? made.json : null;
    if (!pr && made.status === 422) {
      const list = await gh(token, "GET", `/repos/${d.repo}/pulls?state=open&head=${encodeURIComponent(`${d.repo.split("/")[0]}:${branch}`)}&base=${encodeURIComponent(base)}`);
      pr = Array.isArray(list.json) ? list.json.find((p: any) => p?.head?.ref === branch) : null;
    }
    if (!pr || !Number.isSafeInteger(pr.number)) throw new DeliveryError(400, "GitHub did not open the pull request (HTTP {status}).", { status: made.status });
    number = pr.number; url = /^https:\/\//.test(String(pr.html_url)) ? String(pr.html_url) : "";
  }
  setPr(taskId, { phase: "open", pr_number: number, pr_url: url, pr_state: "open", note: "", pending: "", checked_at: now() });
  q.run("UPDATE board_tasks SET note = ?, updated_at = ? WHERE id = ? AND state = 'delivering'", dt(loc, "Pull request open: done when it is merged."), now(), taskId);
  say(t, dt(loc, "Board task “{title}”: pull request opened — {url}", { title: t.title, url: url || `#${number}` }));
}

async function lsRemote(dir: string, remote: string, branch: string, token: string): Promise<string> {
  const out = await git(dir, ["ls-remote", "--heads", remote, `refs/heads/${branch}`], token, remote);
  const line = out.split("\n").find((l) => l.endsWith(`\trefs/heads/${branch}`));
  const sha = line?.split("\t")[0] ?? "";
  return SHA.test(sha) ? sha : "";
}

/** Reads the open pull request: merged into the planned base → done; closed, or merged into another branch → stopped. */
async function poll(t: TaskLite, d: PrRow) {
  if (!d.pr_number) return;
  const loc = users.localeOf(t.user_id);
  const token = await deps.token(t.user_id, d.connector);
  const r = await gh(token, "GET", `/repos/${d.repo}/pulls/${d.pr_number}`);
  if (r.status !== 200 || !r.json) { setPr(t.id, { checked_at: now() }); return; }
  const pr = r.json;
  if (pr.merged === true && pr.merged_at) {
    const into = String(pr.base?.ref ?? "");
    if (into === d.base) {
      setPr(t.id, { phase: "merged", pr_state: "merged", checked_at: now(), note: "" });
      if (taskLite(t.id)?.state === "delivering") endHook(t.id, "merged", "");
      return;
    }
    const note = dt(loc, "The pull request was merged into “{into}”, not into “{base}”: it is not delivered yet.", { into: clip(into, 100), base: d.base });
    setPr(t.id, { phase: "closed", pr_state: "merged", checked_at: now(), note });
    endHook(t.id, "stopped", note);
    say(t, dt(loc, "Board task “{title}”: delivery stopped — {note}", { title: t.title, note }));
    return;
  }
  if (pr.state === "closed") {
    const note = dt(loc, "The pull request was closed without being merged.");
    setPr(t.id, { phase: "closed", pr_state: "closed", checked_at: now(), note });
    endHook(t.id, "stopped", note);
    say(t, dt(loc, "Board task “{title}”: delivery stopped — {note}", { title: t.title, note }));
    return;
  }
  setPr(t.id, { pr_state: "open", checked_at: now() });
}

// ── The owner's clicks ──────────────────────────────────────────────────────────────────────────────────────────
/** « Autoriser la livraison »: remembers this account and identity for the repository, then goes on. */
export async function approveDelivery(userId: string, taskId: string): Promise<BoardDelivery> {
  ownedTask(userId, taskId);
  const d = prRow(taskId);
  const p = deliveryView(taskId)?.pending;
  if (!d || d.phase !== "approval" || !p) throw new DeliveryError(409, "Nothing waits for your go-ahead on this task.");
  q.run(`INSERT INTO board_pr_repos (user_id, repo, login, ident_name, ident_email, approved_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, repo) DO UPDATE SET login = excluded.login, ident_name = excluded.ident_name, ident_email = excluded.ident_email, approved_at = excluded.approved_at`, userId, d.repo, p.login, p.name, p.email, now());
  setPr(taskId, { phase: "idle", pending: "", note: "" });
  await deliver(taskId);
  return deliveryView(taskId)!;
}
/** « Refuser »: nothing is pushed; the task stops with that reason. */
export function declineDelivery(userId: string, taskId: string): BoardDelivery {
  const t = ownedTask(userId, taskId);
  const d = prRow(taskId);
  if (!d || d.phase !== "approval") throw new DeliveryError(409, "Nothing waits for your go-ahead on this task.");
  stopDelivery(t, dt(users.localeOf(userId), "You refused this delivery: nothing was pushed."));
  return deliveryView(taskId)!;
}
/** « Réessayer » after a refusal (fixed commit, other branch…) or a closed pull request (a new one is opened). */
export async function retryDelivery(userId: string, taskId: string): Promise<BoardDelivery> {
  const t = ownedTask(userId, taskId);
  const d = prRow(taskId);
  if (!d) throw new DeliveryError(400, "This task is not delivered by a pull request.");
  if (!["refused", "closed"].includes(d.phase) || t.state === "running" || t.state === "done") throw new DeliveryError(409, "There is nothing to retry on this delivery.");
  if (d.phase === "closed") setPr(taskId, { pr_number: null, pr_url: "", pr_state: "" });
  setPr(taskId, { phase: "idle", note: "" });
  q.run("UPDATE board_tasks SET state = 'delivering', armed = 0, ended_at = NULL, updated_at = ? WHERE id = ?", now(), taskId);
  await deliver(taskId);
  return deliveryView(taskId)!;
}

/** Every POLL_MS: open pull requests are read again; a delivery left half-way (restart) goes on. */
export async function sweepDeliveries(at = now()) {
  const list = q.all<{ task_id: string; phase: string; checked_at: number }>("SELECT p.task_id, p.phase, p.checked_at FROM board_pr p JOIN board_tasks t ON t.id = p.task_id WHERE t.state = 'delivering' AND p.phase IN ('open', 'idle', 'pushing')");
  for (const r of list) if (r.phase !== "open" || at - r.checked_at >= POLL_MS) await deliver(r.task_id);
}
