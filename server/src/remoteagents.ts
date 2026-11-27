import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { seal, unseal } from "./auth.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { checkCommand, currentLauncher } from "./localtools.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { audit, clip, newId, now } from "./store.js";

/**
 * L172 — other agents working with Sklubot's bots, as connectors (Settings → the bot → « Autres agents »), each call on
 * the usual approval card (agent/remoteagenttools.ts). Implemented only from the published specifications:
 *
 *  A2A, Agent2Agent Protocol 1.0 (https://a2a-protocol.org/latest/specification/): the Agent Card at
 *  `/.well-known/agent-card.json` (§8), its `supportedInterfaces` (url, protocolBinding "JSONRPC", protocolVersion);
 *  JSON-RPC 2.0 over HTTP POST with `Content-Type: application/json` and `A2A-Version`; method `SendMessage` with
 *  params { message: { role: "ROLE_USER", parts: [{ text }], messageId } }; the answer is a Task (id, status.state
 *  TASK_STATE_*, artifacts[].parts[].text) or a Message; `GetTask` { id } while it works; `Authorization: Bearer` when
 *  the card asks for it. A card that only gives the older 0.3 form (`url`, methods `message/send` / `tasks/get`,
 *  parts with `kind: "text"`, role "user") is spoken to in that form.
 *
 *  ACP, Agent Client Protocol v1 (https://agentclientprotocol.com/protocol/v1/): an agent program (for example a
 *  coding agent's ACP adapter) started IN THE BOT'S OWN COMPUTER — never on the Sklubot server — with the same launcher as
 *  local tool servers (localtools.ts: docker exec, no shell, no host variables); newline-delimited JSON-RPC 2.0 on its
 *  standard input / output (transports: "Messages are delimited by newlines and MUST NOT contain embedded newlines");
 *  `initialize` { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false },
 *  terminal: false } }, `session/new` { cwd: "/root", mcpServers: [] }, `session/prompt` { sessionId, prompt: [{ type:
 *  "text", text }] } → { stopReason }, `session/update` notifications (agent_message_chunk), `session/cancel`.
 *  `session/request_permission` from the agent is answered by the owner's choice for that agent: « Refuser » (default:
 *  the reject option, or "cancelled"), or « Autoriser dans l'ordinateur du bot » (the allow_once option: it acts only
 *  inside the bot's sandboxed computer). Every request it made is listed in the bot's result.
 *
 * Agent cards, answers and outputs are outside content for the bot (the tool is marked so). Tokens are sealed.
 */
q.run(`CREATE TABLE IF NOT EXISTS remote_agents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', token_enc TEXT, command TEXT NOT NULL DEFAULT '', args TEXT NOT NULL DEFAULT '[]', card TEXT NOT NULL DEFAULT '{}', permissions TEXT NOT NULL DEFAULT 'refuse', created_at INTEGER NOT NULL)`);

export type RemoteKind = "a2a" | "acp";
export interface RemoteAgent { id: string; kind: RemoteKind; name: string; url: string; hasToken: boolean; command: string; args: string[]; permissions: "refuse" | "allow_in_computer"; card: { description?: string; skills?: string[]; version?: string; endpoint?: string; binding?: string }; createdAt: number }
const MAX_AGENTS = 20;
const parse = <T,>(s: unknown, d: T): T => { try { return (JSON.parse(String(s)) as T) ?? d; } catch { return d; } };
const toAgent = (r: any): RemoteAgent => ({ id: r.id, kind: r.kind, name: r.name, url: r.url, hasToken: !!r.token_enc, command: r.command, args: parse<string[]>(r.args, []), permissions: r.permissions === "allow_in_computer" ? "allow_in_computer" : "refuse", card: parse(r.card, {}), createdAt: r.created_at });

export class RemoteAgentError extends Error {}

// ── A2A ───────────────────────────────────────────────────────────────────────
/** Where the Agent Card is: the address given if it ends with .json, else the well-known path of its origin. */
export function cardUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && !(u.protocol === "http:" && process.env.ALLOW_PRIVATE_FETCH === "1")) throw new RemoteAgentError("The agent's address must start with https://.");
  if (/\.json$/i.test(u.pathname)) return u.toString();
  return `${u.origin}/.well-known/agent-card.json`;
}

/** Reads an Agent Card: name, description, skills, and the JSON-RPC endpoint (1.0 supportedInterfaces, or 0.3 url). */
export function parseCard(card: any): { name: string; description: string; skills: string[]; endpoint: string; version: string; bearer: boolean } {
  if (!card || typeof card !== "object") throw new RemoteAgentError("This address gives no Agent Card.");
  const ifaces: any[] = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
  const rpc = ifaces.find((i) => String(i?.protocolBinding ?? "").toUpperCase() === "JSONRPC" && typeof i?.url === "string");
  const endpoint = rpc?.url ?? (typeof card.url === "string" && (!card.preferredTransport || String(card.preferredTransport).toUpperCase() === "JSONRPC") ? card.url : "");
  if (!endpoint) throw new RemoteAgentError("This agent offers no JSON-RPC interface (the only one Sklubot speaks).");
  const version = String(rpc?.protocolVersion ?? card.protocolVersion ?? "0.3");
  const schemes = card.securitySchemes && typeof card.securitySchemes === "object" ? Object.values(card.securitySchemes) as any[] : [];
  const bearer = schemes.some((s) => /bearer/i.test(String(s?.httpAuthSecurityScheme?.scheme ?? s?.scheme ?? "")) || s?.type === "http");
  return {
    name: clip(String(card.name ?? ""), 80), description: clip(String(card.description ?? ""), 500), version, bearer,
    skills: (Array.isArray(card.skills) ? card.skills : []).map((s: any) => clip(String(s?.name ?? s?.id ?? ""), 60)).filter(Boolean).slice(0, 20),
    endpoint: new URL(endpoint).toString(),
  };
}
const legacy = (version: string) => /^0\./.test(version);

/** The text of an A2A answer (a Message, or a Task's status message and artifacts), and whether it is still working. */
export function a2aText(result: any): { text: string; taskId: string | null; state: string } {
  const obj = result?.task ?? result?.message ?? result;
  const partsText = (parts: any[]) => (Array.isArray(parts) ? parts : []).map((p) => (typeof p?.text === "string" ? p.text : p?.data ? JSON.stringify(p.data) : p?.url ? `[file: ${p.url}]` : "")).filter(Boolean).join("\n");
  const isTask = !!obj && (obj.status !== undefined || obj.kind === "task" || result?.task);
  if (!isTask) return { text: partsText(obj?.parts), taskId: null, state: "completed" };
  const state = String(obj.status?.state ?? "").toLowerCase().replace(/^task_state_/, "");
  const texts = [partsText(obj.status?.message?.parts), ...(Array.isArray(obj.artifacts) ? obj.artifacts.map((a: any) => partsText(a?.parts)) : [])].filter(Boolean);
  return { text: texts.join("\n\n"), taskId: typeof obj.id === "string" ? obj.id : null, state };
}

async function rpc(endpoint: string, version: string, token: string | null, method: string, params: unknown, signal?: AbortSignal): Promise<any> {
  const res = await guardedFetch(endpoint, {
    method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", accept: "application/json", "a2a-version": legacy(version) ? "0.3" : "1.0", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
  });
  if (res.status === 401 || res.status === 403) throw new RemoteAgentError("The agent refused Sklubot's access (a token is missing or wrong).");
  const body = await res.text();
  if (!res.ok) throw new RemoteAgentError(`The agent answered with an error (HTTP ${res.status}).`);
  let json: any;
  try { json = JSON.parse(body); } catch { throw new RemoteAgentError("The agent's answer is not JSON-RPC."); }
  if (json?.error) throw new RemoteAgentError(`The agent answered with an error: ${clip(String(json.error.message ?? json.error.code ?? ""), 200)}`);
  return json?.result;
}

/** Sends one message to an A2A agent and waits (up to 2 minutes) for its answer. */
export async function a2aSend(agent: { url: string; card: RemoteAgent["card"] }, token: string | null, text: string, signal?: AbortSignal, pollMs = 2000): Promise<string> {
  const endpoint = agent.card.endpoint || agent.url;
  const version = agent.card.version ?? "1.0";
  const message = legacy(version)
    ? { kind: "message", role: "user", parts: [{ kind: "text", text }], messageId: randomUUID() }
    : { role: "ROLE_USER", parts: [{ text }], messageId: randomUUID() };
  let r = a2aText(await rpc(endpoint, version, token, legacy(version) ? "message/send" : "SendMessage", { message }, signal));
  const end = Date.now() + 120_000;
  while (r.taskId && ["submitted", "working"].includes(r.state) && Date.now() < end) {
    await new Promise((ok) => setTimeout(ok, pollMs));
    if (signal?.aborted) break;
    r = a2aText(await rpc(endpoint, version, token, legacy(version) ? "tasks/get" : "GetTask", { id: r.taskId }, signal));
  }
  const tail = ["submitted", "working"].includes(r.state) ? "\n(The agent is still working on it after 2 minutes.)" : r.state && !["completed", ""].includes(r.state) ? `\n(The agent's task ended as: ${r.state}.)` : "";
  return clip(r.text || "(no text in the answer)", 40_000) + tail;
}

// ── ACP ───────────────────────────────────────────────────────────────────────
export interface AcpRun { text: string; stopReason: string; permissions: { title: string; answer: string }[] }

/**
 * One prompt to an ACP agent over newline-delimited JSON-RPC (stdin/stdout of `io`). Exported for tests, which give
 * a fake agent; `answer` decides each permission request.
 */
export async function acpPrompt(io: { write(line: string): void; onLine(fn: (line: string) => void): void; close(): void }, text: string, allow: boolean, signal?: AbortSignal, timeoutMs = 10 * 60_000): Promise<AcpRun> {
  let next = 0;
  const pending = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  const chunks: string[] = [];
  const permissions: AcpRun["permissions"] = [];
  let sessionId = "";
  const send = (msg: object) => io.write(JSON.stringify(msg));
  const request = (method: string, params: unknown) => new Promise<any>((ok, no) => { const id = next++; pending.set(id, { ok, no }); send({ jsonrpc: "2.0", id, method, params }); });
  io.onLine((line) => {
    let m: any;
    try { m = JSON.parse(line); } catch { return; } // not ACP: ignored (logs belong on stderr)
    if (m && m.id !== undefined && m.method === undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.no(new RemoteAgentError(`The agent answered with an error: ${clip(String(m.error.message ?? m.error.code), 200)}`)); else p.ok(m.result);
      return;
    }
    if (m?.method === "session/update") {
      const u = m.params?.update;
      if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && typeof u.content.text === "string") chunks.push(u.content.text);
      return;
    }
    if (m?.method === "session/request_permission" && m.id !== undefined) {
      const opts: any[] = Array.isArray(m.params?.options) ? m.params.options : [];
      const pick = opts.find((o) => o?.kind === (allow ? "allow_once" : "reject_once")) ?? (allow ? null : opts.find((o) => o?.kind === "reject_always"));
      permissions.push({ title: clip(String(m.params?.toolCall?.title ?? m.params?.toolCall?.toolCallId ?? "an action"), 120), answer: pick ? String(pick.kind) : "cancelled" });
      send({ jsonrpc: "2.0", id: m.id, result: { outcome: pick ? { outcome: "selected", optionId: pick.optionId } : { outcome: "cancelled" } } });
      return;
    }
    // Any other request from the agent (files, terminal): not offered (clientCapabilities say so).
    if (m?.method && m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  });
  const timer = setTimeout(() => { for (const p of pending.values()) p.no(new RemoteAgentError("The agent did not finish in time.")); pending.clear(); }, timeoutMs);
  const onAbort = () => { if (sessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "sklubot", title: "Sklubot", version: "1.0.0" } });
    if (Number(init?.protocolVersion) !== 1) throw new RemoteAgentError("This agent speaks another version of ACP.");
    sessionId = String((await request("session/new", { cwd: "/root", mcpServers: [] }))?.sessionId ?? "");
    if (!sessionId) throw new RemoteAgentError("The agent did not open a session.");
    const done = await request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    return { text: clip(chunks.join(""), 40_000), stopReason: String(done?.stopReason ?? ""), permissions };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    io.close();
  }
}

/** Starts the agent program in the bot's computer and sends it one prompt. */
async function acpRun(bot: { id: string; userId: string }, agent: RemoteAgent, text: string, signal?: AbortSignal): Promise<AcpRun> {
  const l = currentLauncher();
  const why = l.unavailable();
  if (why) throw new RemoteAgentError(why);
  const params = await l.params(bot, `acp-${agent.id}`, agent.command, agent.args);
  const child = spawn(params.command, params.args ?? [], { env: params.env, stdio: ["pipe", "pipe", "ignore"], shell: false });
  const release = l.hold(bot.id);
  let buf = "";
  const listeners: ((line: string) => void)[] = [];
  child.stdout!.setEncoding("utf8").on("data", (d: string) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) for (const f of listeners) f(line); } });
  try {
    return await acpPrompt({ write: (line) => child.stdin!.write(`${line}\n`), onLine: (f) => listeners.push(f), close: () => { try { child.stdin!.end(); } catch { /* gone */ } } }, text, agent.permissions === "allow_in_computer", signal);
  } finally {
    release();
    setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* gone */ } void l.stop(bot.id, `acp-${agent.id}`).catch(() => {}); }, 2000).unref?.();
  }
}

// ── Records ─────────────────────────────────────────────────────────────────────
export const remoteAgents = {
  list: (userId: string): RemoteAgent[] => q.all("SELECT * FROM remote_agents WHERE user_id = ? ORDER BY created_at", userId).map(toAgent),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM remote_agents WHERE id = ? AND user_id = ?", id, userId); return r ? toAgent(r) : null; },
  byName(userId: string, name: string) { const n = String(name ?? "").trim().toLowerCase(); return remoteAgents.list(userId).find((a) => a.id === name || a.name.toLowerCase() === n) ?? null; },
  /** Adds an A2A agent: its card is read first (name, skills, endpoint). */
  async addA2A(userId: string, f: { url?: unknown; token?: unknown; name?: unknown }): Promise<RemoteAgent> {
    if (remoteAgents.list(userId).length >= MAX_AGENTS) throw new RemoteAgentError("At most 20 other agents.");
    let where: string;
    try { where = cardUrl(String(f.url ?? "")); } catch (e) { throw e instanceof RemoteAgentError ? e : new RemoteAgentError("Give the agent's address (https://…)."); }
    let raw: any;
    try {
      const res = await guardedFetch(where, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new RemoteAgentError(`No Agent Card at ${where} (HTTP ${res.status}).`);
      raw = JSON.parse(await res.text());
    } catch (e) { if (e instanceof RemoteAgentError) throw e; throw new RemoteAgentError(`The Agent Card could not be read: ${fetchProblem(e) ?? "not JSON"}.`); }
    const card = parseCard(raw);
    const token = typeof f.token === "string" && f.token.trim() ? f.token.trim().slice(0, 4000) : null;
    const id = newId("ragt");
    const name = clip(String(f.name ?? "").trim(), 60) || card.name || new URL(where).hostname;
    q.run("INSERT INTO remote_agents (id, user_id, kind, name, url, token_enc, card, created_at) VALUES (?, ?, 'a2a', ?, ?, ?, ?, ?)", id, userId, name, where, token ? seal(token) : null, JSON.stringify({ description: card.description, skills: card.skills, version: card.version, endpoint: card.endpoint, binding: "JSONRPC" }), now());
    audit(userId, "apps", `Other agent added (A2A): ${name} — ${card.endpoint}`);
    emit(userId, { type: "connectors" });
    return remoteAgents.owned(userId, id)!;
  },
  /** Adds an ACP agent program (run in the calling bot's computer). */
  addAcp(userId: string, f: { name?: unknown; command?: unknown; args?: unknown; permissions?: unknown }): RemoteAgent {
    if (remoteAgents.list(userId).length >= MAX_AGENTS) throw new RemoteAgentError("At most 20 other agents.");
    const args = Array.isArray(f.args) ? f.args.map(String) : [];
    const problem = checkCommand(f.command, args);
    if (problem) throw new RemoteAgentError(problem);
    const id = newId("ragt");
    const name = clip(String(f.name ?? "").trim(), 60) || String(f.command);
    q.run("INSERT INTO remote_agents (id, user_id, kind, name, command, args, permissions, created_at) VALUES (?, ?, 'acp', ?, ?, ?, ?, ?)", id, userId, name, String(f.command), JSON.stringify(args), f.permissions === "allow_in_computer" ? "allow_in_computer" : "refuse", now());
    audit(userId, "apps", `Other agent added (ACP): ${name} — ${clip([String(f.command), ...args].join(" "), 200)}`);
    emit(userId, { type: "connectors" });
    return remoteAgents.owned(userId, id)!;
  },
  setPermissions(userId: string, id: string, p: unknown) { q.run("UPDATE remote_agents SET permissions = ? WHERE id = ? AND user_id = ?", p === "allow_in_computer" ? "allow_in_computer" : "refuse", id, userId); emit(userId, { type: "connectors" }); },
  remove(userId: string, id: string) { const a = remoteAgents.owned(userId, id); q.run("DELETE FROM remote_agents WHERE id = ? AND user_id = ?", id, userId); if (a) audit(userId, "apps", `Other agent removed: ${a.name}`); emit(userId, { type: "connectors" }); },
  /** One message to the agent; its answer as text (outside content). */
  async ask(bot: { id: string; userId: string }, agent: RemoteAgent, text: string, signal?: AbortSignal): Promise<string> {
    if (agent.kind === "a2a") {
      const r = q.get<{ token_enc: string | null }>("SELECT token_enc FROM remote_agents WHERE id = ?", agent.id);
      return a2aSend(agent, r?.token_enc ? unseal(r.token_enc) : null, text, signal);
    }
    const run = await acpRun(bot, agent, text, signal);
    const asked = run.permissions.length ? `\n\nThe agent asked permission ${run.permissions.length} time(s): ${run.permissions.map((p) => `${p.title} → ${p.answer}`).join("; ")}.${agent.permissions === "refuse" ? " (The owner set this agent to refuse; they can allow it inside your computer in its settings.)" : ""}` : "";
    return `${run.text || "(no text in the answer)"}${run.stopReason && run.stopReason !== "end_turn" ? `\n(Stopped: ${run.stopReason}.)` : ""}${asked}`;
  },
};
