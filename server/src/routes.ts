import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decideApproval, enqueue, inQueue, interrupt, submitUserMessage } from "./agent/loop.js";
import { compactIfNeeded, consolidate, memoryStatus } from "./agent/memory.js";
import { createRoom, dispatchToRoom, validMembers } from "./agent/team.js";
import { retireBot } from "./agent/tools.js";
import { createSession, dropSession, hashPassword, SESSION_COOKIE, signupOpen, userForToken, verifyPassword } from "./auth.js";
import { emit, getLive, subscribe } from "./bus.js";
import { computerState, listFiles, removeWorkspace, resolveInWorkspace, screen } from "./computer.js";
import { config } from "./config.js";
import { connectors } from "./connectors.js";
import { isValidTimezone } from "./cron.js";
import { defaultModelRef, listProviders } from "./llm/index.js";
import { publicRoutine, routines } from "./routines.js";
import { fireCheckin, fireRoutine, schedule, unschedule } from "./scheduler.js";
import type { CheckinSettings, ServerEvent } from "./shared.js";
import { bots, memories, policies, publicBot, rows, settings, skills, tasks, users, type BotRecord, type UserRecord } from "./store.js";
import { summary as usageSummary } from "./usage.js";

type Env = { Variables: { user: UserRecord } };
export const api = new Hono<Env>();

class HttpError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 502, message: string) { super(message); } }
const fail = (status: HttpError["status"], message: string): never => { throw new HttpError(status, message); };

api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error("[api]", err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

const body = async (c: Context): Promise<Record<string, any>> => {
  const parsed = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? parsed : {};
};
const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name });
const ownBot = (c: Context<Env>, id = c.req.param("id")): BotRecord => bots.owned(c.get("user").id, id ?? "") ?? fail(404, "That bot does not exist.");
const ownAgent = (c: Context<Env>): BotRecord => { const b = ownBot(c); return b.kind === "agent" ? b : fail(400, "A group chat cannot do that."); };

function startSession(c: Context, userId: string) {
  const s = createSession(userId);
  setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: s.maxAgeSec, secure: config.publicUrl.startsWith("https://") });
}

// ── Public routes ────────────────────────────────────────────────────────────
api.get("/health", (c) => c.json({ ok: true, model: defaultModelRef() }));

api.get("/me", (c) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  return c.json({ user: user ? publicUser(user) : null, signupOpen: signupOpen() });
});

// Slows down password guessing: a handful of attempts per address and per account, per quarter hour.
const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const cur = attempts.get(key);
  if (cur && cur.until > Date.now() && cur.n >= 8) fail(403, "Too many attempts. Wait a few minutes and try again.");
  attempts.set(key, cur && cur.until > Date.now() ? { ...cur, n: cur.n + 1 } : { n: 1, until: Date.now() + 15 * 60_000 });
}

api.post("/auth/signup", async (c) => {
  if (!signupOpen()) fail(403, "New accounts are closed on this server.");
  const b = await body(c);
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail(400, "Enter a valid email address.");
  if (password.length < 8) fail(400, "Choose a password of at least 8 characters.");
  if (users.byEmail(email)) fail(409, "An account with this email already exists.");
  const user = users.create(email, String(b.name ?? ""), hashPassword(password));
  // Every account starts with one main bot so there is someone to talk to straight away.
  bots.create(user.id, {
    name: "Juno", label: "Chief of staff", primary: true, shape: "circle", color: "indigo",
    description: "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots.",
  });
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

api.post("/auth/login", async (c) => {
  const b = await body(c);
  const email = String(b.email ?? "").trim().toLowerCase();
  throttle(`login:${email}`);
  const user = users.byEmail(email);
  if (!user || !verifyPassword(String(b.password ?? ""), user.passHash)) fail(401, "Wrong email or password.");
  attempts.delete(`login:${email}`);
  startSession(c, user!.id);
  return c.json({ user: publicUser(user!) });
});

api.post("/auth/logout", (c) => {
  dropSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Outside systems call this address to set a webhook routine in motion. The token is the credential. */
api.post("/hooks/:token", async (c) => {
  const r = routines.byHook(c.req.param("token"));
  if (!r || !r.enabled) fail(404, "Unknown or paused hook.");
  const raw = await c.req.text();
  if (raw.length > 200_000) fail(413, "Payload too large.");
  let payload: unknown = raw || undefined;
  try { payload = raw ? JSON.parse(raw) : undefined; } catch { /* keep the raw text */ }
  fireRoutine(r!, payload);
  return c.json({ ok: true });
});

// ── Everything below needs a session ─────────────────────────────────────────
api.use("*", async (c, next) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Please sign in." }, 401);
  // State-changing requests must come from our own pages, not from another site using the visitor's cookie.
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (origin && host && new URL(origin).host !== host && origin !== config.publicUrl) return c.json({ error: "Cross-site request refused." }, 403);
  }
  c.set("user", user);
  await next();
});

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const user = c.get("user");
    const queue: ServerEvent[] = [{ type: "hello", now: Date.now() }];
    let wake: (() => void) | null = null;
    const off = subscribe(user.id, (e) => { queue.push(e); wake?.(); });
    stream.onAbort(() => { off(); wake?.(); });
    try {
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), 20_000);
          wake = () => { clearTimeout(timer); resolve(false); };
        });
        wake = null;
        if (timedOut && !queue.length) queue.push({ type: "ping" });
      }
    } finally { off(); }
  }));

api.get("/models", (c) => c.json({
  models: listProviders().filter((p) => p.available()).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m}`, provider: p.label, model: m }))),
  defaultRef: defaultModelRef(),
}));

// ── Bots ─────────────────────────────────────────────────────────────────────
api.get("/bots", (c) => {
  const list = bots.list(c.get("user").id);
  return c.json({ bots: list.map(publicBot), live: Object.fromEntries(list.map((b) => [b.id, getLive(b.id)])) });
});

api.post("/bots", async (c) => {
  const b = await body(c);
  if (!String(b.name ?? "").trim()) fail(400, "Give the bot a name.");
  const bot = bots.create(c.get("user").id, { name: b.name, label: b.label, description: b.description, instructions: b.instructions, shape: b.shape, color: b.color, mode: b.mode, primary: !!b.primary });
  emit(bot.userId, { type: "roster" });
  return c.json({ bot: publicBot(bot) });
});

api.patch("/bots/:id", async (c) => {
  const bot = ownBot(c);
  bots.patch(bot.id, await body(c));
  bots.announce(bot);
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

api.delete("/bots/:id", async (c) => {
  const bot = ownBot(c);
  if (bot.primary) fail(409, "Make another bot your main contact before deleting this one.");
  await retireBot(bot);
  removeWorkspace(bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/primary", (c) => {
  const bot = ownAgent(c);
  bots.makePrimary(bot.userId, bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/read", (c) => {
  const bot = ownBot(c);
  bots.setUnread(bot.id, 0);
  bots.announce(bot);
  return c.json({ ok: true });
});

// ── Conversation ─────────────────────────────────────────────────────────────
api.get("/bots/:id/rows", (c) => {
  const bot = ownBot(c);
  const before = Number(c.req.query("before")) || undefined;
  return c.json({ generation: bot.generation, rows: rows.list(bot.id, bot.generation, Number(c.req.query("limit")) || 200, before) });
});

api.post("/bots/:id/messages", async (c) => {
  const bot = ownBot(c);
  const b = await body(c);
  const text = String(b.text ?? "").trim();
  if (!text) fail(400, "Write a message first.");
  if (text.length > 100_000) fail(413, "That message is too long.");
  const voice = b.origin === "voice";
  const row = rows.append(bot, { kind: "message", role: "user", text, origin: voice ? { kind: "voice", id: "", name: "Voice" } : undefined });
  if (bot.kind === "room") dispatchToRoom(bot, c.get("user"), text, null, 0);
  else submitUserMessage(bot, text, voice);
  return c.json({ row });
});

api.post("/bots/:id/stop", (c) => { interrupt(ownBot(c).id); return c.json({ ok: true }); });

api.post("/bots/:id/reset", (c) => {
  const bot = ownBot(c);
  interrupt(bot.id);
  const generation = bots.resetConversation(bot.id);
  emit(bot.userId, { type: "reset", botId: bot.id, generation });
  bots.announce(bot);
  return c.json({ generation });
});

api.post("/approvals/:approvalId", async (c) => {
  const decision = (await body(c)).decision;
  if (!["allow", "always", "deny"].includes(decision)) fail(400, "Unknown decision.");
  if (!decideApproval(c.get("user").id, c.req.param("approvalId"), decision)) fail(404, "That request no longer exists.");
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/answer", async (c) => {
  const bot = ownBot(c);
  const answer = String((await body(c)).answer ?? "").trim();
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card" || row.body.card.type !== "question") fail(400, "That is not a question.");
  if (!answer) fail(400, "Pick or write an answer.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "answered", answer } : k));
  rows.append(bot, { kind: "message", role: "user", text: answer });
  submitUserMessage(bot, `(Answering your question "${card?.type === "question" ? card.question : ""}")\n${answer}`);
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/dismiss", (c) => {
  const bot = ownBot(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card") fail(400, "That is not a card.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  if (card?.type === "connect" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "connect" ? { ...k, status: "skipped" } : k));
    enqueue(bot.id, { kind: "system", text: `The user chose not to connect ${card.name}. Carry on without it, or say what cannot be done.` });
  } else if (card?.type === "question" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "dismissed" } : k));
  }
  return c.json({ ok: true });
});

// ── Knowledge and automation ─────────────────────────────────────────────────
api.get("/bots/:id/bundle", (c) => {
  const bot = ownBot(c);
  return c.json({ memories: memories.list(bot.id), skills: skills.list(bot.id), routines: routines.forBot(bot.id).map(publicRoutine), tasks: tasks.forBot(bot.id), memoryStatus: memoryStatus(bot) });
});

function skillFields(b: Record<string, any>, base?: { name: string; description: string; body: string }) {
  const name = (b.name === undefined ? base?.name ?? "" : String(b.name)).trim().slice(0, 80);
  const description = (b.description === undefined ? base?.description ?? "" : String(b.description)).trim().slice(0, 300);
  const text = (b.body === undefined ? base?.body ?? "" : String(b.body)).trim().slice(0, 20_000);
  if (!name) fail(400, "Give the skill a name.");
  if (!text) fail(400, "Write the steps for this skill.");
  return { name, description, body: text };
}

api.post("/bots/:id/skills", async (c) => {
  const bot = ownAgent(c);
  const f = skillFields(await body(c));
  return c.json({ skill: skills.create(bot.id, f.name, f.description, f.body) });
});
api.patch("/skills/:id", async (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  return c.json({ skill: skills.update(cur.id, skillFields(await body(c), cur)) });
});
api.delete("/skills/:id", (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  skills.remove(cur.id);
  return c.json({ ok: true });
});
api.delete("/memories/:id", (c) => { memories.removeOwned(c.get("user").id, c.req.param("id")); return c.json({ ok: true }); });

api.post("/bots/:id/consolidate", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await consolidate(bot)); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});
api.post("/bots/:id/compact", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await inQueue(bot.id, () => compactIfNeeded(bots.byId(bot.id)!, true))); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});

api.get("/bots/:id/routines", (c) => c.json({ routines: routines.forBot(ownBot(c).id).map(publicRoutine) }));
const ownRoutine = (c: Context<Env>) => routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, "That routine does not exist.");
api.patch("/routines/:id", async (c) => {
  const r = ownRoutine(c);
  const updated = routines.update(r.id, { enabled: !!(await body(c)).enabled })!;
  schedule(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ routine: publicRoutine(updated) });
});
api.post("/routines/:id/run", (c) => { fireRoutine(ownRoutine(c)); return c.json({ ok: true }); });
api.delete("/routines/:id", (c) => {
  const r = ownRoutine(c);
  unschedule(r.id);
  routines.remove(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ ok: true });
});

api.get("/tasks", (c) => c.json({ tasks: tasks.forUser(c.get("user").id) }));
api.get("/bots/:id/tasks", (c) => c.json({ tasks: tasks.forBot(ownBot(c).id) }));

// ── Computer and files ───────────────────────────────────────────────────────
api.get("/computer", (c) => c.json(computerState(c.get("user").id)));

api.get("/bots/:id/screen", async (c) => {
  const shot = await screen.peek(ownBot(c).id);
  if (!shot) return c.body(null, 204);
  return c.body(new Uint8Array(shot), 200, { "content-type": "image/jpeg", "cache-control": "no-store" });
});

api.post("/bots/:id/screen/input", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const uid = bot.userId;
  try {
    if (b.type === "goto") await screen.open(bot.id, uid, String(b.url ?? ""));
    else if (!screen.isOpen(bot.id)) fail(409, "This bot has no browser open yet.");
    else if (b.type === "click") await screen.click(bot.id, uid, Number(b.x), Number(b.y));
    else if (b.type === "type") await screen.type(bot.id, uid, String(b.text ?? ""));
    else if (b.type === "key") await screen.key(bot.id, uid, String(b.key ?? ""));
    else if (b.type === "scroll") await screen.scroll(bot.id, uid, Number(b.x), Number(b.y), Number(b.dy) || 0);
    else fail(400, "Unknown input type.");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(502, (err as Error).message);
  }
  return c.json({ ok: true });
});

api.post("/bots/:id/desktop/reset", async (c) => { await screen.reset(ownBot(c).id); return c.json({ ok: true }); });

const safePath = (botId: string, rel: string) => { try { return resolveInWorkspace(botId, rel); } catch (err) { return fail(400, (err as Error).message); } };

api.get("/bots/:id/files", (c) => {
  const bot = ownBot(c);
  const rel = c.req.query("path") ?? "";
  safePath(bot.id, rel);
  return c.json({ entries: listFiles(bot.id, rel) });
});

api.get("/bots/:id/files/download", (c) => {
  const bot = ownBot(c);
  const full = safePath(bot.id, c.req.query("path") ?? "");
  if (!existsSync(full) || !statSync(full).isFile()) fail(404, "That file does not exist.");
  const name = path.basename(full).replace(/[^\w. -]/g, "_");
  return c.body(Readable.toWeb(createReadStream(full)) as unknown as ReadableStream, 200, {
    "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": String(statSync(full).size),
  });
});

// ── Connectors and permissions ───────────────────────────────────────────────
api.get("/connectors", (c) => c.json({ connectors: connectors.list(c.get("user").id) }));

api.post("/connectors", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  let connector;
  try { connector = await connectors.add(user.id, String(b.name ?? ""), String(b.url ?? ""), b.token ? String(b.token) : undefined); }
  catch (err) { return fail(400, (err as Error).message); }
  emit(user.id, { type: "connectors" });
  const bot = typeof b.botId === "string" ? bots.owned(user.id, b.botId) : null;
  if (bot && connector.status === "ready") {
    if (Number.isInteger(b.seq)) rows.updateCard(bot, bot.generation, b.seq, (k) => (k.type === "connect" ? { ...k, status: "connected" } : k));
    enqueue(bot.id, { kind: "system", text: `The user connected ${connector.name}. Its tools are available now — continue with what you were doing.` });
  }
  return c.json({ connector });
});

api.post("/connectors/:id/refresh", async (c) => c.json({ connector: (await connectors.refresh(c.get("user").id, c.req.param("id"))) ?? fail(404, "That connector does not exist.") }));
api.delete("/connectors/:id", async (c) => { await connectors.remove(c.get("user").id, c.req.param("id")); return c.json({ ok: true }); });

api.get("/policies", (c) => c.json({ policies: policies.list(c.get("user").id) }));
api.delete("/policies/:tool", (c) => { policies.remove(c.get("user").id, decodeURIComponent(c.req.param("tool"))); return c.json({ ok: true }); });

// ── Rooms ────────────────────────────────────────────────────────────────────
api.post("/rooms", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const name = String(b.name ?? "").trim().slice(0, 60);
  const ids = validMembers(user.id, b.botIds);
  if (!name) fail(400, "Give the group a name.");
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  return c.json({ id: createRoom(user.id, name, ids).id });
});

const ownRoom = (c: Context<Env>) => { const b = ownBot(c); return b.kind === "room" ? b : fail(404, "That group does not exist."); };
api.get("/rooms/:id/members", (c) => c.json({ members: ownRoom(c).memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b).map(publicBot) }));

api.put("/rooms/:id/members", async (c) => {
  const room = ownRoom(c);
  const ids = validMembers(room.userId, (await body(c)).botIds);
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  const name = (id: string) => bots.byId(id)?.name ?? "a bot";
  const joined = ids.filter((id) => !room.memberIds.includes(id)).map(name);
  const left = room.memberIds.filter((id) => !ids.includes(id)).map(name);
  bots.patch(room.id, { memberIds: ids, description: `Group chat with ${ids.length} bots.` });
  if (joined.length || left.length)
    rows.append(room, { kind: "event", event: "members", text: [joined.length ? `${joined.join(", ")} joined` : "", left.length ? `${left.join(", ")} left` : ""].filter(Boolean).join(" · ") });
  emit(room.userId, { type: "roster" });
  return c.json({ ok: true });
});

// ── Check-ins and usage ──────────────────────────────────────────────────────
const publicCheckins = (userId: string): CheckinSettings => { const s = settings.checkins(userId); return { enabled: s.enabled, times: s.times, timezone: s.timezone }; };
api.get("/checkins", (c) => c.json(publicCheckins(c.get("user").id)));
api.put("/checkins", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const cur = settings.checkins(user.id);
  if (b.timezone !== undefined && !isValidTimezone(String(b.timezone))) fail(400, "Unknown timezone. Use a name like Europe/Paris.");
  const times = Array.isArray(b.times) ? b.times.filter((t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6) : cur.times;
  settings.saveCheckins(user.id, { ...cur, enabled: b.enabled === undefined ? cur.enabled : !!b.enabled, times, timezone: b.timezone === undefined ? cur.timezone : String(b.timezone) });
  return c.json(publicCheckins(user.id));
});
api.post("/checkins/now", (c) => { fireCheckin(c.get("user").id, 0); return c.json({ ok: true }); });

api.get("/usage", (c) => c.json(usageSummary(c.get("user").id)));
api.put("/usage/budget", async (c) => {
  const v = (await body(c)).budgetUsd;
  if (v !== null && !(typeof v === "number" && v >= 0)) fail(400, "The budget must be a positive number, or empty for no limit.");
  settings.setBudget(c.get("user").id, v);
  emit(c.get("user").id, { type: "usage" });
  return c.json(usageSummary(c.get("user").id));
});
