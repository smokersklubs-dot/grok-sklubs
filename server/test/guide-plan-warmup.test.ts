import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L153 carte « pas à pas », L145 tour de chauffe des moteurs + « ce qui reste à installer », L163 plan créé depuis la
// discussion + bot proposé pour un rôle (stepguide.ts, guidechecks.ts, enginewarmup.ts, boardplan.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-guideplan-"));
process.env.SESSION_SECRET = "guide-plan-secret-guide-plan-secret-0";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "gpw:gpw-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS", "HOSTED_MODE", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows, users } = await import("../src/store.js");
const { guideTools } = await import("../src/stepguide.js");
const { boardPlanTools, readPlan, MAX_PLAN_TASKS } = await import("../src/boardplan.js");
const { setWarmRunner, resetWarmups, warmCandidates, warmAtStartup, warmupOf } = await import("../src/enginewarmup.js");
const { GUIDE_FR } = await import("../src/guidei18n.js");
const { resetModelHealth } = await import("../src/modelhealth.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { StepGuideCard } from "../src/guidetypes.js";
import type { BoardPlanCard } from "../src/boardplantypes.js";

let modelCalls = 0;
registerProvider({
  id: "gpw", label: "Guide test", models: ["gpw-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { modelCalls++; return { content: [{ type: "text", text: "OK" }], stopReason: "end", model: req.model, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const wait = async (ok: () => boolean, ms = 5000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 10)); } };

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "stranger@example.com", name: "Other", password: "password-1", locale: "en" });
const main = (await call("a", "GET", "/bots")).json.bots[0];
const strangerMain = (await call("b", "GET", "/bots")).json.bots[0];
const userA = bots.byId(main.id)!.userId;
const userB = bots.byId(strangerMain.id)!.userId;
const cardAt = (botId: string, seq: number) => { const b = bots.byId(botId)!; const r = rows.get(b.id, b.generation, seq); return r?.body.kind === "card" ? r.body.card : null; };
const lastCard = (botId: string, type: string) => { const b = bots.byId(botId)!; const r = q.all<{ seq: number; body: string }>("SELECT seq, body FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'card' ORDER BY seq DESC", b.id, b.generation).find((x) => JSON.parse(x.body).card.type === type); return r ? { seq: r.seq, card: JSON.parse(r.body).card } : null; };
const ctx = (botId: string) => { const bot = bots.byId(botId)!; return { bot, user: users.byId(bot.userId)!, depth: 0, signal: new AbortController().signal, thread: 0 } as any; };

// ── L153 « pas à pas » ──────────────────────────────────────────────────────────────────────────────────
test("L153: a Docteur line → a « pas à pas » card in the main bot's chat; each step has a check; unknown → 404", async () => {
  const r = await call("a", "POST", "/doctor/guides/account.two_factor");
  assert.equal(r.status, 200);
  assert.equal(r.json.botId, main.id);
  const card = cardAt(main.id, r.json.seq) as StepGuideCard;
  assert.equal(card.type, "stepguide");
  assert.equal(card.guideId, "doctor:account.two_factor");
  assert.equal(card.doctorKey, "doctor.twoFactor");
  assert.deepEqual(card.steps.map((s) => [s.check, s.state]), [["self", "todo"], ["two_factor.on", "todo"]]);
  assert.equal(card.steps[1].open, "account");
  assert.equal(card.title, "Réparer pas à pas");
  for (const bad of ["nope.nope", "..%2F..%2Fetc", "UPPER"]) assert.equal((await call("a", "POST", `/doctor/guides/${bad}`)).status, 404, bad);
});

test("L153: « Vérifier » runs the step's check (not yet → hint; true → ok), « C'est fait » only on a self step, then done", async () => {
  const { seq } = (await call("a", "POST", "/doctor/guides/account.two_factor")).json;
  const url = `/bots/${main.id}/rows/${seq}/stepguide`;
  let r = await call("a", "POST", url, { action: "check", step: "s2" });
  assert.equal(r.status, 200);
  assert.equal(r.json.card.steps[1].state, "notyet");
  assert.equal(r.json.card.steps[1].hint, "La double vérification est encore désactivée.");
  assert.equal((await call("a", "POST", url, { action: "self", step: "s2" })).status, 400, "a server-checked step cannot be ticked by hand");
  assert.equal((await call("a", "POST", url, { action: "check", step: "s9" })).status, 400);
  assert.equal((await call("a", "POST", url, { action: "jump" })).status, 400);
  r = await call("a", "POST", url, { action: "self", step: "s1" });
  assert.equal(r.json.card.steps[0].state, "ok");
  assert.equal(r.json.card.status, "pending");
  q.run("INSERT INTO two_factor (user_id, secret_enc, last_step, updated_at) VALUES (?, 'sealed-fake', 0, ?) ON CONFLICT(user_id) DO UPDATE SET secret_enc = 'sealed-fake'", userA, Date.now());
  r = await call("a", "POST", url, { action: "check", step: "s2" });
  assert.equal(r.json.card.steps[1].state, "ok");
  assert.equal(r.json.card.status, "done");
  q.run("DELETE FROM two_factor WHERE user_id = ?", userA);
  // Another account never reaches the card (404 before the input is read); a closed card refuses.
  assert.equal((await call("b", "POST", url, { action: "check", step: "s2" })).status, 404);
  assert.equal((await call("a", "POST", `/bots/${main.id}/rows/999999/stepguide`, { action: "check", step: "s1" })).status, 404);
  assert.equal((await call("a", "POST", url, { action: "dismiss" })).json.card.status, "dismissed");
  assert.equal((await call("a", "POST", url, { action: "check", step: "s2" })).status, 409);
});

test("L153: a known install line has its own steps (secret: command, restart, Docteur check)", async () => {
  const r = await call("a", "POST", "/doctor/guides/auth.session_secret");
  assert.equal(r.status, 200, "the owner sees the installation lines");
  const card = cardAt(main.id, r.json.seq) as StepGuideCard;
  assert.deepEqual(card.steps.map((s) => s.check), ["self", "self", "self", "doctor:auth.session_secret"]);
  assert.equal(card.steps[0].command, "openssl rand -hex 32");
  const ok = await call("a", "POST", `/bots/${main.id}/rows/${r.json.seq}/stepguide`, { action: "check", step: "s4" });
  assert.equal(ok.json.card.steps[3].state, "ok", "the test secret is long enough: the Docteur line is fine");
  // A stranger is not the installation's owner: its install lines do not exist for it.
  assert.equal((await call("b", "POST", "/doctor/guides/auth.session_secret")).status, 404);
});

// ── L145 « ce qui reste à installer » ───────────────────────────────────────────────────────────────────
test("L145: the setup list names only what remains, free and without secrets in the chat; « Vérifier » confirms the model", async () => {
  resetModelHealth();
  const r = await call("a", "POST", `/bots/${main.id}/setup-guide`);
  assert.equal(r.status, 200);
  const card = cardAt(main.id, r.json.seq) as StepGuideCard;
  assert.equal(card.guideId, "setup");
  assert.equal(card.title, "Ce qui reste à installer");
  assert.equal(card.ready, 1, "a model is available");
  assert.deepEqual(card.steps.map((s) => s.check), ["model.answers", "two_factor.on", "backup.ready"]);
  assert.match(card.intro, /jamais dans cette discussion/);
  assert.match(card.intro, /Rien ici n'est payant/);
  for (const s of card.steps) assert.doesNotMatch(`${s.title} ${s.detail} ${s.command ?? ""}`, /\/home|\/root|sk-|https?:/);
  const before = modelCalls;
  const ok = await call("a", "POST", `/bots/${main.id}/rows/${r.json.seq}/stepguide`, { action: "check", step: "s1" });
  assert.equal(ok.json.card.steps[0].state, "ok");
  assert.equal(modelCalls, before + 1, "one tiny test message");
  // Once checked, the next list counts it as ready.
  const again = cardAt(main.id, (await call("a", "POST", `/bots/${main.id}/setup-guide`)).json.seq) as StepGuideCard;
  assert.equal(again.ready, 2);
  // A customer of the installation: no backup step (the owner's), in English.
  const b = cardAt(strangerMain.id, (await call("b", "POST", `/bots/${strangerMain.id}/setup-guide`)).json.seq) as StepGuideCard;
  assert.ok(!b.steps.some((s) => s.check === "backup.ready"));
  assert.equal(b.title, "What remains to set up");
  assert.equal((await call("b", "POST", `/bots/${main.id}/setup-guide`)).status, 404);
});

test("L145: the bot reads what remains (setup_status) and shows the card (guide_show); never a made-up guide", async () => {
  const [status, show] = guideTools;
  const s = await status.run({}, ctx(main.id));
  assert.match(String(s.content), /thing\(s\) remain/);
  assert.match(String(s.content), /Never ask for a key/);
  const shown = await show.run({ guide: "setup" }, ctx(main.id));
  assert.ok(!shown.isError);
  assert.equal(lastCard(main.id, "stepguide")!.card.guideId, "setup");
  assert.equal((await show.run({ guide: "doctor:account.two_factor" }, ctx(main.id))).isError, undefined);
  assert.equal((await show.run({ guide: "anything" }, ctx(main.id))).isError, true);
});

// ── L145 tour de chauffe des moteurs ────────────────────────────────────────────────────────────────────
test("L145: an engine bot is cold, then warming, then ready (with its time); a failure says why; API bots are « off »", async () => {
  resetWarmups();
  let release: () => void = () => undefined;
  let primed = 0;
  setWarmRunner(() => { primed++; return new Promise<void>((res) => { release = res; }); });
  const eng = bots.create(userA, { name: "Moteur", model: "" });
  q.run("UPDATE bots SET model = 'claude-code:default' WHERE id = ?", eng.id);
  const url = `/bots/${eng.id}/engine-warmup`;
  assert.equal((await call("a", "GET", url)).json.warmup.state, "cold");
  assert.equal((await call("a", "POST", url)).json.warmup.state, "warming");
  await call("a", "POST", url);
  assert.equal(primed, 1, "one warm-up at a time per bot");
  release();
  await wait(() => warmupOf(eng.id).state === "ready");
  const w = (await call("a", "GET", url)).json.warmup;
  assert.equal(w.engine, "claude-code");
  assert.equal(typeof w.ms, "number");
  setWarmRunner(async () => { throw new Error("Le moteur n'est pas installé sur l'ordinateur de ce bot."); });
  await call("a", "POST", url);
  await wait(() => warmupOf(eng.id).state === "failed");
  assert.match(warmupOf(eng.id).reason!, /pas installé/);
  assert.equal((await call("a", "GET", `/bots/${main.id}/engine-warmup`)).json.warmup.state, "off");
  assert.equal((await call("a", "POST", `/bots/${main.id}/engine-warmup`)).status, 400);
  assert.equal((await call("b", "GET", url)).status, 404);
  assert.equal((await call("b", "POST", url)).status, 404);
  // A model changed to another engine: what was primed no longer counts.
  setWarmRunner(async () => undefined);
  await call("a", "POST", url); await wait(() => warmupOf(eng.id).state === "ready");
  q.run("UPDATE bots SET model = 'codex:default' WHERE id = ?", eng.id);
  assert.equal(warmupOf(eng.id).state, "cold");
});

test("L145: after a restart only engine bots used in the last 3 days are primed, most recent first, at most 8", async () => {
  resetWarmups();
  const order: string[] = [];
  setWarmRunner(async (b) => { order.push(b.name); });
  const mk = (name: string, ago: number | null, paused = false) => {
    const b = bots.create(userB, { name, model: "" });
    q.run("UPDATE bots SET model = 'codex:default' WHERE id = ?", b.id);
    if (ago !== null) { rows.append(b, { kind: "message", role: "user", text: "salut" }, 0); q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", Date.now() - ago, b.id); }
    if (paused) bots.patch(b.id, { pause: { since: Date.now(), until: null, reason: "" } } as never);
    return b;
  };
  mk("Hier", 86_400_000); mk("Ancien", 5 * 86_400_000); mk("Jamais", null); mk("Maintenant", 1000);
  const names = warmCandidates().map((b) => b.name);
  assert.ok(names.indexOf("Maintenant") < names.indexOf("Hier"));
  assert.ok(!names.includes("Ancien") && !names.includes("Jamais"));
  assert.equal(warmCandidates(1).length, 1);
  const n = await warmAtStartup(8, 0);
  assert.equal(n, names.length);
  assert.deepEqual(order, names);
  setWarmRunner(null);
});

// ── L163 plan → tableau, bot pour un rôle ───────────────────────────────────────────────────────────────
test("L163: a plan is checked (titles, earlier tasks only, team bots, at most 12) before any card", () => {
  assert.match(String(readPlan(userA, { tasks: [] })), /at least one task/);
  assert.match(String(readPlan(userA, { tasks: Array.from({ length: MAX_PLAN_TASKS + 1 }, (_x, i) => ({ title: `T${i}` })) })), /At most 12/);
  assert.match(String(readPlan(userA, { tasks: [{ title: "A", after: [2] }, { title: "B" }] })), /not before it/);
  assert.match(String(readPlan(userA, { tasks: [{ title: "  " }] })), /needs a title/);
  assert.match(String(readPlan(userA, { tasks: [{ title: "A", bot: "Inconnu" }] })), /no bot called/);
  assert.match(String(readPlan(userA, { tasks: [{ title: "A", bot: "Other" }] })), /no bot called/, "another account's bot is unknown here");
});

test("L163: the bot proposes, the owner keeps some tasks and puts them on the board; a role nobody holds gets a proposal card", async () => {
  const coder = bots.create(userA, { name: "Codeuse", model: "" });
  const tool = boardPlanTools[0];
  const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_tasks WHERE user_id = ?", userA)!.n;
  const out = await tool.run({ title: "Site vitrine", why: "Mettre le site en ligne", tasks: [
    { title: "Écrire la page", kind: "code", bot: "Codeuse", priority: 2 },
    { title: "Relire la page", kind: "review", after: [1] },
    { title: "Publier", kind: "chore", after: [2] },
  ] }, ctx(main.id));
  assert.ok(!out.isError, String(out.content));
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_tasks WHERE user_id = ?", userA)!.n, before, "the tool creates nothing");
  const { seq, card } = lastCard(main.id, "boardplan") as { seq: number; card: BoardPlanCard };
  assert.deepEqual(card.missingRoles, ["review", "chore"]);
  assert.equal(card.tasks[0].botId, coder.id);
  const url = `/bots/${main.id}/rows/${seq}/boardplan`;
  assert.equal((await call("b", "POST", url, { action: "create" })).status, 404);
  assert.equal((await call("a", "POST", url, { action: "create", keep: [] })).status, 400);
  const r = await call("a", "POST", url, { action: "create", keep: [0, 1], launch: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.card.status, "created");
  const [t1, t2, t3] = r.json.card.taskIds;
  assert.ok(t1 && t2 && t3 === "");
  const view = (await call("a", "GET", "/board")).json;
  const task2 = view.tasks.find((t: any) => t.id === t2);
  assert.deepEqual(task2.deps, [t1]);
  assert.equal(task2.kind, "review");
  assert.equal(view.tasks.find((t: any) => t.id === t1).botId, coder.id);
  assert.equal(task2.armed, false, "not launched");
  assert.deepEqual(r.json.card.proposedRoles, ["review"], "only the kept tasks' missing roles");
  assert.equal((await call("a", "POST", url, { action: "create" })).status, 409);
  // The proposal: a « bot recruteur » card in the main bot's chat, for the role, waiting for « Créer ».
  const rec = lastCard(main.id, "recruit")!;
  assert.equal(rec.card.boardRole, "review");
  assert.equal(rec.card.status, "pending");
  assert.ok(!bots.list(userA).some((b) => b.name === "Relecteur"), "nothing created silently");
  // Not twice while one waits.
  assert.equal((await call("a", "POST", "/board/roles/review/propose-bot")).status, 409);
  // « Créer »: the bot holds the role; no request is handed to it.
  const made = await call("a", "POST", `/bots/${main.id}/cards/${rec.seq}/recruit`, { action: "create" });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const roles = (await call("a", "GET", "/board")).json.roles;
  assert.equal(roles.find((x: any) => x.role === "review").botId, made.json.bot.id);
  assert.equal(made.json.bot.model, bots.byId(main.id)!.model, "it takes the main bot's model (T10)");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND kind = 'message'", made.json.bot.id)!.n, 0, "no handover turn");
  assert.equal((await call("a", "POST", "/board/roles/review/propose-bot")).status, 409, "held now");
});

test("L163: « Non merci », « lancer tout de suite », the role routes and a full board", async () => {
  const card = readPlan(userA, { title: "P", tasks: [{ title: "Doc", kind: "docs" }] }) as BoardPlanCard;
  const seq = rows.append(bots.byId(main.id)!, { kind: "card", card }, 0).seq;
  assert.equal((await call("a", "POST", `/bots/${main.id}/rows/${seq}/boardplan`, { action: "dismiss" })).json.card.status, "dismissed");
  const card2 = readPlan(userA, { title: "P2", tasks: [{ title: "Lancer", kind: "code", bot: "Codeuse" }] }) as BoardPlanCard;
  const seq2 = rows.append(bots.byId(main.id)!, { kind: "card", card: card2 }, 0).seq;
  const r = await call("a", "POST", `/bots/${main.id}/rows/${seq2}/boardplan`, { action: "create", launch: true });
  assert.equal(r.json.card.launched, true);
  assert.equal(q.get<{ armed: number }>("SELECT armed FROM board_tasks WHERE id = ?", r.json.card.taskIds[0])!.armed, 1);
  assert.equal((await call("a", "POST", "/board/roles/lead/propose-bot")).status, 400);
  assert.equal((await call("a", "POST", "/board/roles/boss/propose-bot")).status, 404);
  const p = await call("a", "POST", "/board/roles/code/propose-bot");
  assert.equal(p.status, 200);
  assert.equal(cardAt(main.id, p.json.seq)!.type, "recruit");
  // B proposes for its own account only.
  const pb = await call("b", "POST", "/board/roles/code/propose-bot");
  assert.equal(pb.json.botId, strangerMain.id);
  // A board that cannot take the plan: refused before anything is created.
  const t = Date.now();
  for (let i = 0; i < 499; i++) q.run("INSERT INTO board_tasks (id, user_id, title, description, priority, created_at, updated_at) VALUES (?, ?, 'x', '', 3, ?, ?)", `bt_fill${i}`, userB, t, t);
  const big = readPlan(userB, { title: "Big", tasks: [{ title: "1" }, { title: "2" }] }) as BoardPlanCard;
  const seqB = rows.append(bots.byId(strangerMain.id)!, { kind: "card", card: big }, 0).seq;
  assert.equal((await call("b", "POST", `/bots/${strangerMain.id}/rows/${seqB}/boardplan`, { action: "create" })).status, 409);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_tasks WHERE user_id = ?", userB)!.n, 499);
});

test("guidei18n: every gt(\"…\") text and every guide / role text has its French line", () => {
  const files = ["stepguide.ts", "guidechecks.ts", "enginewarmup.ts", "boardplan.ts", "agent/recruit.ts"].map((f) => readFileSync(path.join(import.meta.dirname, "../src", f), "utf8"));
  const missing: string[] = [];
  for (const src of files) {
    for (const m of src.matchAll(/\bgt\((?:[\w.]+), "((?:[^"\\]|\\.)*)"/g)) if (!(m[1] in GUIDE_FR)) missing.push(m[1]);
    for (const m of src.matchAll(/\b(?:title|detail): "((?:[^"\\]|\\.)*)"/g)) if (!m[1].startsWith("doctor.") && !(m[1] in GUIDE_FR)) missing.push(m[1]);
  }
  const plan = files[3];
  for (const m of plan.matchAll(/^\s+(?:code|review|research|docs|chore): "((?:[^"\\]|\\.)*)"/gm)) if (!(m[1] in GUIDE_FR)) missing.push(m[1]);
  assert.deepEqual(missing, []);
});
