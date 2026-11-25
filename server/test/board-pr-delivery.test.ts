import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";

// L175 « Livrer par demande d'intégration » (workboardpr.ts; clean room: docs/cleanroom/10-timon.md T16 only). A fake
// GitHub REST API (local HTTP) and a local bare git repository stand in for GitHub: no real network.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-boardpr-"));
process.env.SESSION_SECRET = "boardpr-secret-boardpr-secret-boardpr";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "bpr:bpr-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS", "BOT_PARALLEL_TASKS", "HOSTED_MODE", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { resolveInWorkspace } = await import("../src/computer.js");
const pr = await import("../src/workboardpr.js");
const { DELIVERY_FR } = await import("../src/workboardpri18n.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

// ── The bot: every board task completes with evidence ───────────────────────────────────────────────────────
let n = 0;
const textOf = (b: Block[]) => b.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
const briefs: string[] = [];
registerProvider({
  id: "bpr", label: "Board PR test", models: ["bpr-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
    const done = (content: Block[]): TurnResult => ({ content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "bpr-1", usage });
    const last = req.messages[req.messages.length - 1];
    if (last.content.some((b) => b.type === "tool_result")) return done([{ type: "text", text: "Fait." }]);
    const all = req.messages.map((x) => textOf(x.content)).join("\n");
    const m = [...all.matchAll(/\[Board task “([^”]+)”/g)].pop();
    if (!m) return done([{ type: "text", text: "ok" }]);
    briefs.push(all);
    return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "complete", summary: `Le bouton est ajouté. Tâche n° 7 terminée.\nCo-Authored-By: Bot <bot@example.com>`, evidence: "commit dans le clone" } }]);
  },
});

// ── Fake GitHub REST API ─────────────────────────────────────────────────────────────────────────────────
const TOKEN = "gh-fake-token-for-tests";
const gh = { login: "owner-gh", push: true, pulls: [] as any[], posts: [] as any[], unauth: 0 };
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { gh.unauth++; return send(401, { message: "Bad credentials" }); }
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/user") return send(200, { login: gh.login, id: 1 });
    if (req.method === "GET" && url.pathname === "/repos/acme/site") return send(200, { full_name: "acme/site", default_branch: "main", archived: false, disabled: false, permissions: { push: gh.push } });
    if (req.method === "POST" && url.pathname === "/repos/acme/site/pulls") {
      const b = JSON.parse(raw);
      gh.posts.push(b);
      if (gh.pulls.some((p) => p.head.ref === b.head && p.state === "open")) return send(422, { message: "Validation Failed" });
      const p = { number: gh.pulls.length + 1, html_url: `https://github.com/acme/site/pull/${gh.pulls.length + 1}`, state: "open", merged: false, merged_at: null, title: b.title, body: b.body, base: { ref: b.base }, head: { ref: b.head } };
      gh.pulls.push(p);
      return send(201, p);
    }
    if (req.method === "GET" && url.pathname === "/repos/acme/site/pulls") return send(200, gh.pulls.filter((p) => p.state === "open" && `acme:${p.head.ref}` === url.searchParams.get("head")));
    const one = /^\/repos\/acme\/site\/pulls\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && one) { const p = gh.pulls.find((x) => x.number === Number(one[1])); return p ? send(200, p) : send(404, {}); }
    send(404, { message: "Not Found" });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());

// ── A local bare repository = « GitHub »'s acme/site ──────────────────────────────────────────────────────────
const WORK = mkdtempSync(path.join(tmpdir(), "sklubot-boardpr-git-"));
const BARE = path.join(WORK, "site.git");
const GENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", HOME: WORK };
const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: GENV, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
g(WORK, "init", "--bare", "-b", "main", BARE);
const SEED = path.join(WORK, "seed");
g(WORK, "clone", BARE, SEED);
writeFileSync(path.join(SEED, "index.html"), "<h1>Site</h1>\n");
g(SEED, "-c", "user.name=Someone", "-c", "user.email=someone@example.com", "add", ".");
g(SEED, "-c", "user.name=Someone", "-c", "user.email=someone@example.com", "commit", "-m", "Start");
g(SEED, "push", "origin", "main");
const remoteHead = (branch: string) => execFileSync("git", ["--git-dir", BARE, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`], { env: GENV, encoding: "utf8" }).trim();

pr.deps.apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
pr.deps.remoteUrl = (repo: string) => (repo === "acme/site" ? BARE : path.join(WORK, "nowhere.git"));
pr.deps.token = async () => TOKEN;
pr.deps.accounts = async (userId: string) => (userId ? [{ id: "conn_gh", name: "GitHub test" }] : []);

// ── Accounts, bots ───────────────────────────────────────────────────────────────────────────────────────────
const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const wait = async (ok: () => boolean, ms = 10000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 25)); } };
const task = (id: string) => q.get<{ state: string; note: string }>("SELECT state, note FROM board_tasks WHERE id = ?", id)!;
const view = async (id: string) => (await call("a", "GET", "/board")).json.tasks.find((t: any) => t.id === id);

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "stranger@example.com", name: "Other", password: "password-1", locale: "en" });
const botA = (await call("a", "GET", "/bots")).json.bots[0];

/** The bot's clone of acme/site in its files, with one commit of its own. */
function cloneFor(folder: string, o: { name?: string; email?: string; message?: string } = {}) {
  const dir = resolveInWorkspace(botA.id, folder);
  mkdirSync(path.dirname(dir), { recursive: true });
  g(WORK, "clone", BARE, dir);
  g(dir, "config", "user.name", "Studio Bot");
  g(dir, "config", "user.email", "studio@example.com");
  appendFileSync(path.join(dir, "index.html"), `<button>${folder}</button>\n`);
  g(dir, "add", ".");
  g(dir, "-c", `user.name=${o.name ?? "Studio Bot"}`, "-c", `user.email=${o.email ?? "studio@example.com"}`, "commit", "-m", o.message ?? `Add a button (${folder})`);
  return dir;
}
async function newTask(title: string, folder: string, extra: Record<string, unknown> = {}, ideaId?: string) {
  const t = (await call("a", "POST", "/board/tasks", { title, botId: botA.id, ...(ideaId ? { ideaId } : {}) })).json.task.id as string;
  const r = await call("a", "PUT", `/board/tasks/${t}/delivery`, { repo: "acme/site", folder, connectorId: "conn_gh", ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return t;
}
const phase = (id: string) => q.get<{ phase: string }>("SELECT phase FROM board_pr WHERE task_id = ?", id)?.phase;

test("internal references: found in commit messages and stripped from what Sklubot writes", () => {
  assert.match(pr.internalRef("Fix header (tâche n° 12)"), /tâche n° 12/);
  assert.match(pr.internalRef("Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>"), /Co-Authored-By/i);
  assert.match(pr.internalRef("see bt_0123456789abcdef0123"), /bt_/);
  assert.match(pr.internalRef("idea #4 done"), /idea #4/);
  assert.equal(pr.internalRef("Fix #12: header overlaps on phones"), "", "a GitHub issue reference is not internal");
  assert.equal(pr.withoutInternalRefs("Le bouton est ajouté. Tâche n° 7 terminée.\nCo-Authored-By: Bot <b@x>"), "Le bouton est ajouté. terminée.");
  assert.equal(pr.remoteRepo("git@github.com:Acme/Site.git"), "acme/site");
  assert.equal(pr.remoteRepo("https://github.com/acme/site"), "acme/site");
  assert.equal(pr.remoteRepo("https://evil.example/acme/site.git"), "");
  assert.equal(pr.validBranch("feature/x"), true);
  assert.equal(pr.validBranch("-x"), false);
  assert.equal(pr.validBranch("a..b"), false);
});

test("isolation and input: another account's card is missing (404) before any check; bad input refused in words", async () => {
  const t = (await call("a", "POST", "/board/tasks", { title: "Isolée", botId: botA.id })).json.task.id;
  for (const [m, u] of [["PUT", ""], ["DELETE", ""], ["POST", "/approve"], ["POST", "/decline"], ["POST", "/retry"]] as const)
    assert.equal((await call("b", m, `/board/tasks/${t}/delivery${u}`, {})).status, 404, `${m} ${u}`);
  assert.equal((await call("a", "PUT", `/board/tasks/${t}/delivery`, { repo: "pas un dépôt", folder: "x", connectorId: "conn_gh" })).status, 400);
  const r = await call("a", "PUT", `/board/tasks/${t}/delivery`, { repo: "acme/site", folder: "../hors", connectorId: "conn_gh" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /dossier du projet/);
  assert.equal((await call("a", "PUT", `/board/tasks/${t}/delivery`, { repo: "acme/site", folder: "x", connectorId: "someone-else" })).status, 400);
  assert.deepEqual((await call("a", "GET", "/board/github-accounts")).json.accounts, [{ id: "conn_gh", name: "GitHub test" }]);
});

let first = "", ideaId = "";
test("first delivery: the task ends with an OPEN pull request (not a merge), after the owner's go-ahead; nothing pushed before", async () => {
  ideaId = (await call("a", "POST", "/board/ideas", { title: "Un bouton" })).json.idea.id;
  const dir = cloneFor("projets/site1");
  first = await newTask("Ajouter le bouton (tâche n° 7)", "projets/site1", {}, ideaId);
  assert.equal((await call("a", "POST", "/board/tasks/launch", { ids: [first] })).status, 200);
  await wait(() => phase(first) === "approval");
  assert.equal(task(first).state, "delivering");
  assert.equal(remoteHead("ajouter-le-bouton"), "", "nothing pushed before the go-ahead");
  assert.match(briefs.at(-1)!, /Do not push/);
  const v = await view(first);
  assert.equal(v.column, "delivering");
  assert.deepEqual({ login: v.delivery.pending.login, name: v.delivery.pending.name, email: v.delivery.pending.email, branch: v.delivery.pending.branch, base: v.delivery.pending.base },
    { login: "owner-gh", name: "Studio Bot", email: "studio@example.com", branch: "ajouter-le-bouton", base: "main" });
  assert.match(v.delivery.note, /Première livraison vers acme\/site/);

  const ok = await call("a", "POST", `/board/tasks/${first}/delivery/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.delivery.phase, "open");
  assert.equal(ok.json.delivery.prUrl, "https://github.com/acme/site/pull/1");
  assert.equal(remoteHead("ajouter-le-bouton"), g(dir, "rev-parse", "HEAD"), "exactly the bot's commit was pushed");
  assert.equal(remoteHead("main"), g(SEED, "rev-parse", "HEAD"), "the base branch is untouched (no local merge, no push to main)");
  const post = gh.posts.at(-1);
  assert.equal(post.base, "main");
  assert.equal(post.head, "ajouter-le-bouton");
  assert.equal(pr.internalRef(post.title) + pr.internalRef(post.body), "", `no internal reference in ${JSON.stringify(post)}`);
  assert.equal(post.title, "Ajouter le bouton");
  assert.doesNotMatch(post.title + post.body, /tâche n°|Co-Authored-By|bt_/i);
  assert.equal(task(first).state, "delivering", "not done while the pull request is open");
  assert.notEqual((await call("a", "GET", "/board")).json.ideas.find((i: any) => i.id === ideaId).progress, "done", "the idea stays open");
  assert.equal(gh.unauth, 0);
});

test("an intermediate merge (into another branch) does not close the idea; a real merge into the base does", async () => {
  // A second task merged into « staging »: stopped, not done.
  const t2 = await newTask("Page contact", "projets/site2", { base: "main" });
  cloneFor("projets/site2");
  await call("a", "POST", "/board/tasks/launch", { ids: [t2] });
  await wait(() => phase(t2) === "open");
  const p2 = gh.pulls.find((p) => p.head.ref === "page-contact")!;
  Object.assign(p2, { state: "closed", merged: true, merged_at: "2026-11-25T10:00:00Z", base: { ref: "staging" } });
  await pr.sweepDeliveries(Date.now() + pr.POLL_MS);
  assert.equal(task(t2).state, "blocked");
  assert.match(task(t2).note, /intégrée dans « staging », pas dans « main »/);

  // Still open: one poll changes nothing.
  await pr.sweepDeliveries(Date.now() + pr.POLL_MS);
  assert.equal(task(first).state, "delivering");
  const p1 = gh.pulls[0];
  Object.assign(p1, { state: "closed", merged: true, merged_at: "2026-11-25T11:00:00Z" });
  await pr.sweepDeliveries(Date.now() + 2 * pr.POLL_MS);
  assert.equal(task(first).state, "done");
  const v = await view(first);
  assert.equal(v.delivery.prState, "merged");
  assert.equal((await call("a", "GET", "/board")).json.ideas.find((i: any) => i.id === ideaId).progress, "done", "closed only at the real merge");
});

test("a remote branch that moved on its own is never overwritten: refused, the owner is told", async () => {
  // Someone else already pushed « deja-la ».
  const other = path.join(WORK, "other");
  g(WORK, "clone", BARE, other);
  writeFileSync(path.join(other, "x.txt"), "theirs\n");
  g(other, "add", ".");
  g(other, "-c", "user.name=Someone", "-c", "user.email=someone@example.com", "commit", "-m", "Theirs");
  g(other, "push", "origin", "HEAD:refs/heads/deja-la");
  const theirs = remoteHead("deja-la");
  cloneFor("projets/site3");
  const t = await newTask("Bannière", "projets/site3", { branch: "deja-la" });
  await call("a", "POST", "/board/tasks/launch", { ids: [t] });
  await wait(() => task(t).state === "blocked");
  assert.match(task(t).note, /a bougé sans Sklubot.*rien n'a été écrasé/);
  assert.equal(remoteHead("deja-la"), theirs, "their commit is still there");
  assert.equal((await view(t)).delivery.phase, "refused");
});

test("commits: wrong identity or an internal reference refuse the push; fixed locally then « Réessayer » opens the pull request", async () => {
  cloneFor("projets/site4", { name: "Random Person", email: "random@example.com" });
  const t = await newTask("Pied de page", "projets/site4");
  await call("a", "POST", "/board/tasks/launch", { ids: [t] });
  await wait(() => task(t).state === "blocked");
  assert.match(task(t).note, /signé « Random Person <random@example.com> », pas avec l'identité du dépôt « Studio Bot <studio@example.com> »/);
  assert.equal(remoteHead("pied-de-page"), "");

  const dir = resolveInWorkspace(botA.id, "projets/site4");
  g(dir, "-c", "user.name=Studio Bot", "-c", "user.email=studio@example.com", "commit", "--amend", "--reset-author", "-m", "Footer links\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
  assert.equal((await call("a", "POST", `/board/tasks/${t}/delivery/retry`)).status, 200);
  assert.equal(task(t).state, "blocked");
  assert.match(task(t).note, /référence interne/);
  assert.equal(remoteHead("pied-de-page"), "");

  g(dir, "-c", "user.name=Studio Bot", "-c", "user.email=studio@example.com", "commit", "--amend", "-m", "Footer links");
  const r = await call("a", "POST", `/board/tasks/${t}/delivery/retry`);
  assert.equal(r.json.delivery.phase, "open", "the repository was already allowed: no new card");
  assert.equal(remoteHead("pied-de-page"), g(dir, "rev-parse", "HEAD"));
});

test("another GitHub account than the allowed one: a new go-ahead is asked, naming both", async () => {
  gh.login = "intruder-gh";
  cloneFor("projets/site5");
  const t = await newTask("Menu", "projets/site5");
  await call("a", "POST", "/board/tasks/launch", { ids: [t] });
  await wait(() => phase(t) === "approval");
  const v = await view(t);
  assert.equal(v.delivery.pending.expectedLogin, "owner-gh");
  assert.match(v.delivery.note, /intruder-gh.*owner-gh/);
  assert.equal(remoteHead("menu"), "");
  const d = await call("a", "POST", `/board/tasks/${t}/delivery/decline`);
  assert.equal(d.status, 200);
  assert.equal(task(t).state, "blocked");
  assert.match(task(t).note, /Tu as refusé cette livraison/);
  gh.login = "owner-gh";
});

test("unsafe clone settings (a program to run, a rewritten address) or another origin: refused, nothing sent", async () => {
  const dir = cloneFor("projets/site6");
  g(dir, "config", "core.sshCommand", "touch /tmp/should-never-run");
  const t = await newTask("Logo", "projets/site6");
  await call("a", "POST", "/board/tasks/launch", { ids: [t] });
  await wait(() => task(t).state === "blocked");
  assert.match(task(t).note, /core\.sshcommand/);

  g(dir, "config", "--unset", "core.sshCommand");
  g(dir, "config", "remote.origin.url", path.join(WORK, "elsewhere.git"));
  await call("a", "POST", `/board/tasks/${t}/delivery/retry`);
  assert.match(task(t).note, /ne pointe pas vers acme\/site/);
  assert.equal(remoteHead("logo"), "");
});

test("a pull request closed without merge stops the task (blocked), the idea stays open; a delivering task cannot be deleted", async () => {
  const idea = (await call("a", "POST", "/board/ideas", { title: "Couleurs" })).json.idea.id;
  cloneFor("projets/site7");
  const t = await newTask("Couleurs", "projets/site7", {}, idea);
  await call("a", "POST", "/board/tasks/launch", { ids: [t] });
  await wait(() => phase(t) === "open");
  assert.equal((await call("a", "DELETE", `/board/tasks/${t}`)).status, 409);
  assert.equal((await call("a", "PUT", `/board/tasks/${t}/delivery`, { repo: "acme/site", folder: "x", connectorId: "conn_gh" })).status, 409);
  gh.pulls.find((p) => p.head.ref === "couleurs")!.state = "closed";
  await pr.sweepDeliveries(Date.now() + 10 * pr.POLL_MS);
  assert.equal(task(t).state, "blocked");
  assert.match(task(t).note, /fermée sans être intégrée/);
  assert.notEqual((await call("a", "GET", "/board")).json.ideas.find((i: any) => i.id === idea).progress, "done");
});

test("every owner-facing text of the delivery has its French line, with the same placeholders", () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const missing: string[] = [];
  for (const f of ["workboardpr.ts", "workboardprroutes.ts"]) {
    const s = readFileSync(path.join(src, f), "utf8");
    for (const re of [/\bdt\([^,]+,\s*"((?:[^"\\]|\\.)+)"/g, /new DeliveryError\(\d+,\s*"((?:[^"\\]|\\.)+)"/g])
      for (const m of s.matchAll(re)) { const en = JSON.parse(`"${m[1]}"`); if (!(en in DELIVERY_FR)) missing.push(`${f}: ${en}`); }
  }
  assert.deepEqual(missing, []);
  for (const [en, fr] of Object.entries(DELIVERY_FR)) {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(vars(fr), vars(en), en);
  }
});
