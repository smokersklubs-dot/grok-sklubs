/**
 * Recorded flows, replayed without the model (L165): « routines, surveillance de site, panier ». See docs/TABLEAU.md (« Parcours »).
 *
 * Record: the owner starts a recording for one of their bots, asks the bot to do the job once in its browser, and stops
 * the recording (agent/flowrecord.ts writes down each step). Replay: the steps run again, in order, straight on the bot's
 * browser (computer.ts `screen`), with no model call, and:
 *  - checks: after each step the page must still be on the host it was on when recorded (and contain the step's
 *    expected words, when the owner added some); a click by position is done only when the control under the point
 *    still has the same words; an element step finds the element again by its role and name (exactly one match);
 *    anything else stops the run, with the reason, and nothing more is done;
 *  - evidence for each step: the page's address and title, a short excerpt, a fingerprint of its text, and the
 *    screenshot when the action returned one (kept with the last 10 runs);
 *  - page comparison: a « read » step keeps the page's text; the next run compares it with the last one and says what
 *    lines appeared or went (a site watch); a change emits `flow.page_changed` for the automations (automations.ts);
 *  - approval: every step marked « engage » (it could pay, send, order, delete…) waits for the owner's « Autoriser cette
 *    étape » for THIS run, every run — never « always », never by a bot, never by the model. A step recorded as
 *    « blocked » (a secret, a file sent, a dialog) stops the replay: a person or the bot must do it.
 *  - the bot's network policy (netpolicy.ts) applies to every address opened, as when the bot opens it itself.
 *
 * Isolation: every flow and run carries its owner's user id; every read goes through `owned`. Tables at load.
 */
import { createHash } from "node:crypto"; import type { Locale } from "./shared.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { q } from "./db.js";
import { screen, type Shot } from "./computer.js";
import { emitInternal } from "./internalevents.js";
import { netGate } from "./netpolicy.js";
import { committingKind } from "./agent/bind.js";
import { recording, MAX_STEPS, type FlowStep } from "./agent/flowrecord.js";
import type { ElementRequest, ElementSnapshot } from "./screen-elements.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "./store.js";
import { wt } from "./worki18n.js";

export type { FlowStep } from "./agent/flowrecord.js";

q.run(`CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE, user_id TEXT NOT NULL, started_at INTEGER NOT NULL,
  ended_at INTEGER, status TEXT NOT NULL DEFAULT 'running', at_step INTEGER NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '[]',
  changed INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', approved_step INTEGER, cause TEXT NOT NULL DEFAULT '')`);
q.run("CREATE INDEX IF NOT EXISTS flow_runs_flow ON flow_runs(flow_id, started_at)");
q.run(`CREATE TABLE IF NOT EXISTS flow_page_text (flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE, step INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (flow_id, step))`);

export const MAX_FLOWS = 50;
export const KEEP_RUNS = 10;
const PAGE_TEXT_CHARS = 60_000;

export type FlowRunStatus = "running" | "waiting_approval" | "done" | "failed" | "stopped";
export interface StepEvidence { n: number; kind: string; ok: boolean; url: string; title: string; excerpt: string; hash: string; note: string; shot: boolean; diff?: { added: string[]; removed: string[] } }
export interface FlowView { id: string; botId: string; name: string; steps: FlowStep[]; recording: boolean; createdAt: number; updatedAt: number; lastRunAt: number | null; commitSteps: number; blockedSteps: number }
export interface FlowRunView { id: string; flowId: string; startedAt: number; endedAt: number | null; status: FlowRunStatus; atStep: number; evidence: StepEvidence[]; changed: boolean; note: string; cause: string }

export class FlowError extends Error { constructor(public status: 400 | 404 | 409, message: string, public vars: Record<string, string | number> = {}) { super(message); } }

const parse = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const toFlow = (r: any): FlowView => {
  const steps = parse<FlowStep[]>(r.steps, []);
  return { id: r.id, botId: r.bot_id, name: r.name, steps, recording: !!r.recording, createdAt: r.created_at, updatedAt: r.updated_at, lastRunAt: r.last_run_at ?? null, commitSteps: steps.filter((s) => s.commit && s.kind !== "blocked").length, blockedSteps: steps.filter((s) => s.kind === "blocked").length };
};
const toRun = (r: any): FlowRunView => ({ id: r.id, flowId: r.flow_id, startedAt: r.started_at, endedAt: r.ended_at ?? null, status: r.status, atStep: r.at_step, evidence: parse(r.evidence, []), changed: !!r.changed, note: r.note, cause: r.cause });

export const flows = {
  list: (userId: string) => q.all("SELECT * FROM flows WHERE user_id = ? ORDER BY created_at DESC", userId).map(toFlow),
  owned: (userId: string, id: string) => { const r = q.get("SELECT * FROM flows WHERE id = ? AND user_id = ?", id, userId); return r ? toFlow(r) : null; },
  byId: (id: string) => { const r = q.get("SELECT * FROM flows WHERE id = ?", id); return r ? toFlow(r) : null; },
  runs: (flowId: string) => q.all("SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?", flowId, KEEP_RUNS).map(toRun),
  run: (userId: string, runId: string) => { const r = q.get("SELECT * FROM flow_runs WHERE id = ? AND user_id = ?", runId, userId); return r ? toRun(r) : null; },

  /** Starts recording for one of the owner's bots (one recording per bot). */
  startRecording(userId: string, botId: string, name: string): FlowView {
    const bot = bots.owned(userId, botId);
    if (!bot || bot.kind !== "agent") throw new FlowError(404, "That bot is not one of yours.");
    if (recording.of(bot.id)) throw new FlowError(409, "This bot is already recording a flow: stop it first.");
    if (q.get<{ n: number }>("SELECT COUNT(*) AS n FROM flows WHERE user_id = ?", userId)!.n >= MAX_FLOWS) throw new FlowError(409, "At most {n} recorded flows: delete one first.", { n: MAX_FLOWS });
    const id = newId("flw");
    const t = now();
    q.run("INSERT INTO flows (id, user_id, bot_id, name, recording, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)", id, userId, bot.id, clip(String(name ?? "").trim(), 80) || wt(users.localeOf(userId), "Recorded flow"), t, t);
    audit(userId, "routine", `${bot.name}: recording a flow`, bot.id);
    return flows.owned(userId, id)!;
  },
  stopRecording(userId: string, id: string): FlowView {
    const f = flows.owned(userId, id) ?? missing();
    q.run("UPDATE flows SET recording = 0, updated_at = ? WHERE id = ?", now(), f.id);
    return flows.owned(userId, id)!;
  },
  /** The owner edits a flow: its name, or one step's expected words (a check), or removes a step. Never adds a step by hand. */
  edit(userId: string, id: string, o: { name?: unknown; expectText?: { step: number; text: string }; removeStep?: number }): FlowView {
    const f = flows.owned(userId, id) ?? missing();
    if (f.recording) throw new FlowError(409, "Stop the recording before editing the flow.");
    const steps = [...f.steps];
    if (o.expectText) {
      const s = steps[o.expectText.step] ?? (() => { throw new FlowError(400, "That step does not exist."); })();
      s.expectText = clip(String(o.expectText.text ?? "").trim(), 200) || undefined;
    }
    if (o.removeStep !== undefined) { if (!steps[o.removeStep]) throw new FlowError(400, "That step does not exist."); steps.splice(o.removeStep, 1); }
    const name = o.name === undefined ? f.name : clip(String(o.name).trim(), 80) || f.name;
    q.run("UPDATE flows SET name = ?, steps = ?, updated_at = ? WHERE id = ?", name, JSON.stringify(steps.slice(0, MAX_STEPS)), now(), f.id);
    return flows.owned(userId, id)!;
  },
  remove(userId: string, id: string) {
    const f = flows.owned(userId, id) ?? missing();
    for (const r of q.all<{ id: string }>("SELECT id FROM flow_runs WHERE flow_id = ?", f.id)) rmSync(runDir(r.id), { recursive: true, force: true });
    q.run("DELETE FROM flows WHERE id = ?", f.id);
  },
  shot(userId: string, runId: string, n: number): Buffer | null {
    if (!flows.run(userId, runId)) return null;
    try { return readFileSync(path.join(runDir(runId), `${Math.floor(n)}.jpg`)); } catch { return null; }
  },
};
const missing = (): never => { throw new FlowError(404, "That flow does not exist."); };
const runDir = (runId: string) => path.join(config.dataDir, "flows", runId.replace(/[^a-z0-9_]/gi, ""));

// ── The browser the replay drives (the tests give a fake one) ─────────────────────────────────────────────────────
export interface FlowDriver {
  open(url: string): Promise<Shot>;
  click(x: number, y: number): Promise<Shot>;
  type(text: string): Promise<Shot>;
  key(keys: string): Promise<Shot>;
  scroll(x: number, y: number, dy: number): Promise<Shot>;
  read(): Promise<{ url: string; title: string; text: string }>;
  /** The words of the control under a point, and the page's host. */
  targetAt(x: number, y: number): Promise<{ label: string; host: string } | null>;
  elements(): Promise<ElementSnapshot>;
  elementAct(req: ElementRequest): Promise<{ ok: boolean; error?: string }>;
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export function screenDriver(bot: BotRecord): FlowDriver {
  return {
    open: (url) => screen.open(bot.id, bot.userId, url),
    click: (x, y) => screen.click(bot.id, bot.userId, x, y),
    type: (t) => screen.type(bot.id, bot.userId, t),
    key: (k) => screen.key(bot.id, bot.userId, k),
    scroll: (x, y, dy) => screen.scroll(bot.id, bot.userId, x, y, dy),
    read: () => screen.read(bot.id, bot.userId),
    targetAt: async (x, y) => { const t = await screen.targetAt(bot.id, x, y).catch(() => null); return t ? { label: t.label, host: hostOf(t.url) } : null; },
    elements: () => screen.elements(bot.id, bot.userId, 300),
    elementAct: async (req) => { const r = await screen.elementAct(bot.id, bot.userId, req); const a = (r as any).answer ?? r; return { ok: !!a.ok, error: a.error ?? a.stale ?? a.covered }; },
  };
}
let driverFor: (bot: BotRecord) => FlowDriver = screenDriver;
/** For the tests. */
export const setFlowDriver = (fn: (bot: BotRecord) => FlowDriver) => { driverFor = fn; };

// ── Page comparison ───────────────────────────────────────────────────────────────────────────────────────────────
/** Lines that appeared and lines that went, between two texts of a page (whitespace folded, at most 20 each). */
export function compareText(before: string, after: string): { added: string[]; removed: string[] } {
  const lines = (s: string) => s.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1);
  const a = new Set(lines(before)), b = new Set(lines(after));
  return { added: [...b].filter((l) => !a.has(l)).slice(0, 20).map((l) => clip(l, 200)), removed: [...a].filter((l) => !b.has(l)).slice(0, 20).map((l) => clip(l, 200)) };
}

// ── Replay ────────────────────────────────────────────────────────────────────────────────────────────────────────
const setRun = (id: string, p: { status?: FlowRunStatus; at_step?: number; evidence?: StepEvidence[]; changed?: boolean; note?: string; ended_at?: number | null; approved_step?: number | null }) => {
  const keys = Object.keys(p) as (keyof typeof p)[];
  q.run(`UPDATE flow_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => { const v = p[k]; return typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) ? JSON.stringify(v) : v ?? null; }) as never[], id);
};
const running = new Set<string>();

/** Starts a replay (by the owner, a routine without AI or an automation). Returns the run; it goes on in the background. */
export function startReplay(userId: string, flowId: string, cause = "owner"): FlowRunView {
  const f = flows.owned(userId, flowId) ?? missing();
  if (f.recording) throw new FlowError(409, "Stop the recording before replaying the flow.");
  if (!f.steps.length) throw new FlowError(400, "This flow has no step yet.");
  if (q.get("SELECT 1 FROM flow_runs WHERE flow_id = ? AND status IN ('running', 'waiting_approval')", f.id)) throw new FlowError(409, "This flow is already running or waits for your approval.");
  const id = newId("frun");
  q.run("INSERT INTO flow_runs (id, flow_id, user_id, started_at, cause) VALUES (?, ?, ?, ?, ?)", id, f.id, userId, now(), clip(cause, 40));
  q.run("UPDATE flows SET last_run_at = ? WHERE id = ?", now(), f.id);
  // The newest KEEP_RUNS runs (and their screenshots) are kept.
  for (const old of q.all<{ id: string }>("SELECT id FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?", f.id, KEEP_RUNS)) { q.run("DELETE FROM flow_runs WHERE id = ?", old.id); rmSync(runDir(old.id), { recursive: true, force: true }); }
  void continueRun(id).catch((err) => console.error("[flow]", (err as Error).message));
  return toRun(q.get("SELECT * FROM flow_runs WHERE id = ?", id));
}

/** « Autoriser cette étape »: the owner allows the one committing step this run waits on, then the replay goes on. */
export function approveStep(userId: string, runId: string, step: number): FlowRunView {
  const r = flows.run(userId, runId) ?? missing();
  if (r.status !== "waiting_approval" || r.atStep !== step) throw new FlowError(409, "This run does not wait for that step any more.");
  setRun(runId, { status: "running", approved_step: step, note: "" });
  void continueRun(runId).catch((err) => console.error("[flow]", (err as Error).message));
  return flows.run(userId, runId)!;
}
export function stopRun(userId: string, runId: string): FlowRunView {
  const r = flows.run(userId, runId) ?? missing();
  if (r.status === "running" || r.status === "waiting_approval") setRun(runId, { status: "stopped", ended_at: now(), note: wt(users.localeOf(userId), "stopped by you") });
  return flows.run(userId, runId)!;
}

/** Runs the steps from where the run is. Exported for the tests (they await it). */
export async function continueRun(runId: string): Promise<FlowRunView | null> {
  if (running.has(runId)) return null;
  running.add(runId);
  try {
    const row = q.get<any>("SELECT * FROM flow_runs WHERE id = ?", runId);
    if (!row || row.status !== "running") return row ? toRun(row) : null;
    const f = flows.byId(row.flow_id);
    const bot = f ? bots.owned(row.user_id, f.botId) : null;
    const loc = users.localeOf(row.user_id);
    const evidence: StepEvidence[] = parse(row.evidence, []);
    const fail = (n: number, note: string) => {
      setRun(runId, { status: "failed", at_step: n, evidence, note, ended_at: now() });
      if (f) emitInternal({ type: "flow.run_failed", userId: row.user_id, ...(row.cause === "trigger" ? { cause: "trigger" as const } : {}), botId: f.botId, subjectId: f.id, label: f.name, data: { step: n + 1, note } });
      if (bot && f) rows.append(bot, { kind: "notice", tone: "warn", text: wt(loc, "Flow “{name}” stopped at step {n}: {why}", { name: f.name, n: n + 1, why: note }) });
      return toRun(q.get("SELECT * FROM flow_runs WHERE id = ?", runId));
    };
    if (!f || !bot) return fail(row.at_step, wt(loc, "its bot is gone"));
    const drive = driverFor(bot);
    let changed = !!row.changed;
    for (let n = row.at_step; n < f.steps.length; n++) {
      if (q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", runId)?.status !== "running") return flows.run(row.user_id, runId);
      const s = f.steps[n];
      if (s.kind === "blocked") return fail(n, wt(loc, "this step needs the bot or you ({why}): it is never replayed", { why: wt(loc, s.why ?? "?") }));
      // Every committing step waits for the owner, for this run only.
      const approved = q.get<{ approved_step: number | null }>("SELECT approved_step FROM flow_runs WHERE id = ?", runId)?.approved_step === n;
      if (s.commit && !approved) {
        setRun(runId, { status: "waiting_approval", at_step: n, evidence, note: wt(loc, "Step {n} could commit something ({what}): allow it to go on.", { n: n + 1, what: stepWords(s) }) });
        rows.append(bot, { kind: "notice", tone: "warn", text: wt(loc, "Flow “{name}” waits for your approval at step {n} ({what}). Open « Parcours » to allow it.", { name: f.name, n: n + 1, what: stepWords(s) }) });
        return flows.run(row.user_id, runId);
      }
      let ev: StepEvidence;
      try {
        ev = await runStep(drive, bot, s, n, runId, loc);
      } catch (err) {
        return fail(n, clip((err as Error).message || "?", 300));
      }
      if (s.kind === "read") {
        const prev = q.get<{ text: string }>("SELECT text FROM flow_page_text WHERE flow_id = ? AND step = ?", f.id, n);
        const page = lastText.get(runId) ?? "";
        if (prev) { const d = compareText(prev.text, page); if (d.added.length || d.removed.length) { ev.diff = d; changed = true; } }
        q.run("INSERT INTO flow_page_text (flow_id, step, text, at) VALUES (?, ?, ?, ?) ON CONFLICT(flow_id, step) DO UPDATE SET text = excluded.text, at = excluded.at", f.id, n, page.slice(0, PAGE_TEXT_CHARS), now());
      }
      evidence.push(ev);
      if (!ev.ok) return fail(n, ev.note);
      setRun(runId, { at_step: n + 1, evidence, changed, approved_step: null });
    }
    setRun(runId, { status: "done", at_step: f.steps.length, evidence, changed, ended_at: now() });
    if (changed) {
      const d = evidence.find((e) => e.diff)?.diff;
      emitInternal({ type: "flow.page_changed", userId: row.user_id, ...(row.cause === "trigger" ? { cause: "trigger" as const } : {}), botId: bot.id, subjectId: f.id, label: f.name, data: { added: d?.added.slice(0, 5) ?? [], removed: d?.removed.slice(0, 5) ?? [] } });
      rows.append(bot, { kind: "notice", tone: "info", text: wt(loc, "Flow “{name}”: the page changed since the last run ({added} new line(s), {removed} gone).", { name: f.name, added: d?.added.length ?? 0, removed: d?.removed.length ?? 0 }) });
    }
    return flows.run(row.user_id, runId);
  } finally {
    running.delete(runId);
    lastText.delete(runId);
  }
}

const lastText = new Map<string, string>();
const stepWords = (s: FlowStep) => s.kind === "open" ? `open ${hostOf(s.url ?? "") || "?"}` : s.label ? `“${clip(s.label, 60)}”` : s.keys ? s.keys : s.kind;

async function runStep(d: FlowDriver, bot: BotRecord, s: FlowStep, n: number, runId: string, loc: Locale): Promise<StepEvidence> {
  let shot: Shot | null = null;
  const no = (note: string): StepEvidence => ({ n, kind: s.kind, ok: false, url: "", title: "", excerpt: "", hash: "", note, shot: false });
  switch (s.kind) {
    case "open": {
      const net = netGate(bot, s.url, "browser_open");
      if (net) return no(net);
      shot = await d.open(s.url ?? "");
      break;
    }
    case "click": {
      // A click by position only when the control under the point has the words it had when recorded.
      const t = await d.targetAt(s.x ?? 0, s.y ?? 0);
      if (!t || (s.label && t.label !== s.label) || (s.host && t.host && t.host !== s.host)) return no(wt(loc, "the control under that point is now “{now}” (it was “{was}”): nothing was clicked", { now: clip(t?.label || "?", 80), was: clip(s.label ?? "", 80) }));
      if (!s.commit && committingKind(t.label)) return no(wt(loc, "the control under that point now commits something (“{now}”): nothing was clicked", { now: clip(t.label, 80) }));
      shot = await d.click(s.x ?? 0, s.y ?? 0);
      break;
    }
    case "type": shot = await d.type(s.text ?? ""); break;
    case "key": shot = await d.key(s.keys ?? ""); break;
    case "scroll": shot = await d.scroll(s.x ?? 0, s.y ?? 0, s.dy ?? 360); break;
    case "read": break;
    case "element_click": case "element_type": case "element_select": {
      const snap = await d.elements();
      const same = snap.elements.filter((e) => e.role === s.role && e.name === s.label && e.visible);
      if (same.length !== 1) return no(same.length ? wt(loc, "{n} elements are called “{name}”: nothing was done", { n: same.length, name: clip(s.label ?? "", 60) }) : wt(loc, "no {role} called “{name}” on the page: nothing was done", { role: s.role ?? "element", name: clip(s.label ?? "", 60) }));
      const e = same[0];
      const req: ElementRequest = { node: e.node, role: e.role, name: e.name, target: snap.target, loader: snap.loader, action: s.kind === "element_click" ? "click" : s.kind === "element_type" ? "type" : "select", ...(s.kind === "element_type" ? { text: s.text ?? "", clear: !!s.clear, submit: !!s.submit } : {}), ...(s.kind === "element_select" ? { value: s.option ?? "" } : {}), ...(s.commit ? { expect: { label: e.name, host: s.expectHost ?? "" } } : {}) };
      const r = await d.elementAct(req);
      if (!r.ok) return no(r.error ? clip(r.error, 200) : wt(loc, "the browser did not do it"));
      break;
    }
  }
  const page = await d.read();
  lastText.set(runId, page.text.slice(0, PAGE_TEXT_CHARS));
  const host = hostOf(page.url);
  const ev: StepEvidence = { n, kind: s.kind, ok: true, url: clip(page.url, 500), title: clip(page.title, 200), excerpt: clip(page.text.replace(/\s+/g, " ").trim(), 240), hash: createHash("sha256").update(page.text).digest("hex").slice(0, 16), note: "", shot: false };
  if (shot?.data) { try { mkdirSync(runDir(runId), { recursive: true }); writeFileSync(path.join(runDir(runId), `${n}.jpg`), Buffer.from(shot.data, "base64"), { mode: 0o600 }); ev.shot = true; } catch { /* evidence without the picture */ } }
  if (s.expectHost && host && host !== s.expectHost && !host.endsWith(`.${s.expectHost}`)) return { ...ev, ok: false, note: wt(loc, "the page is now on {host}, not {expected}: stopped", { host, expected: s.expectHost }) };
  if (s.expectText && !page.text.toLowerCase().includes(s.expectText.toLowerCase())) return { ...ev, ok: false, note: wt(loc, "the page does not show “{text}”: stopped", { text: clip(s.expectText, 80) }) };
  return ev;
}
