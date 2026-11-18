import type { Hono } from "hono";
import { computerState } from "./computer.js";
import { isValidTimezone } from "./cron.js";
import { q } from "./db.js";
import { getLive } from "./bus.js";
import { hostedMode, hostedSettings, isOperator } from "./hosted.js";
import { commandStateOf, type CommandCard, type CommandComputer, type CommandExchange, type CommandLink, type CommandMission, type CommandResult, type CommandView } from "./commandtypes.js";
import type { ComputerState, RowBody, TodayLink } from "./shared.js";
import { bots, clip, now, sections, users, type BotRecord, type UserRecord } from "./store.js";
import { cardNeeds, dayBounds } from "./today.js";
import { userTimezone } from "./usagecaps.js";
import { sharedBotsFor, type BotAccess } from "./workspaces.js";

/**
 * « Centre de commandement » — GET /api/command: one read-only call that gives the command view everything about the
 * caller's team at once: per bot its state word (commandtypes.ts commandStateOf), live activity, current mission, last
 * result, open incidents, cards waiting for the caller, today's consumption and its computer; the links between bots
 * working together (messages between them, a failure handed over, a group chat they both talk in, over the last day);
 * and the header's figures. The page keeps it fresh with the events it already receives (live, rows, pauses, computer…).
 *
 * Cheap by design: SQL over indexed tables and the in-memory state (live turns, computers as the server last saw them:
 * computerState never calls Docker); the answer is kept CACHE_MS per account, so polls and bursts of events cost one build.
 *
 * Who sees what — the same rules as « Aujourd'hui » (today.ts): an account sees its own bots (hidden helpers count with
 * the bot they work for) and their group chats. A bot someone shares with it through a workspace (if its role lets it
 * view the chat) shows only what that chat shows — live state, goals and background tasks — plus its approvals if the
 * role answers them; never the owner's task list, incidents, costs or computer, and no action but « Ouvrir la discussion ».
 */

const DAY_MS = 86_400_000;
/** Links: what passed between bots over this window. Last results: over this one. */
export const LINK_WINDOW_MS = DAY_MS;
const RESULT_WINDOW_MS = 7 * DAY_MS;
const CACHE_MS = 1500;
/** Rows read per bot when looking for messages from teammates (newest first). */
const MESSAGE_SCAN = 300;
const EXCHANGE_LINES = 4;
const ROOM_POSTERS = 6;

const cache = new Map<string, { at: number; view: CommandView }>();
/** Tests: forget the cached answers. */
export const resetCommandCache = () => cache.clear();

const marks = (n: number) => Array(n).fill("?").join(", ");
const flat = (s: string, max: number) => clip(s.replace(/\s+/g, " ").trim(), max);

interface Entry { top: BotRecord; access: BotAccess | null }

export function commandView(userId: string, t = now()): CommandView {
  const hit = cache.get(userId);
  if (hit && t - hit.at < CACHE_MS && t >= hit.at) return hit.view;
  const view = build(userId, t);
  cache.set(userId, { at: t, view });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return view;
}

function build(userId: string, t: number): CommandView {
  const all = bots.list(userId, true);
  const byId = new Map(all.map((b) => [b.id, b]));
  // Every own bot id (helpers included) → the bot it shows under.
  const topOf = new Map<string, BotRecord>();
  for (const b of all) {
    let top = b;
    for (let i = 0; i < 3 && top.hidden && top.parentId && byId.get(top.parentId); i++) top = byId.get(top.parentId)!;
    topOf.set(b.id, top);
  }
  const own = all.filter((b) => !b.hidden && b.kind === "agent");
  const rooms = all.filter((b) => !b.hidden && b.kind === "room");
  const shared = sharedBotsFor(userId).filter((a) => a.canView);
  const entries: Entry[] = [...own.map((b) => ({ top: b, access: null })), ...shared.map((a) => ({ top: a.bot, access: a }))];
  const ownIds = [...topOf.keys()];
  const sharedIds = shared.map((a) => a.bot.id);
  const chatIds = [...ownIds, ...sharedIds];
  const topIdOf = (botId: string) => topOf.get(botId)?.id ?? (sharedIds.includes(botId) ? botId : null);

  // ── Missions: active goals and running background tasks (chat-visible), the owner's tasks and long commands ──
  const missions = new Map<string, CommandMission[]>();
  const addMission = (botId: string, m: CommandMission) => { const top = topIdOf(botId); if (!top) return; const l = missions.get(top) ?? []; l.push(m); missions.set(top, l); };
  const results = new Map<string, CommandResult>();
  const addResult = (botId: string, r: CommandResult) => { const top = topIdOf(botId); if (!top) return; const cur = results.get(top); if (!cur || cur.at < r.at) results.set(top, r); };
  const botLink = (botId: string): TodayLink => ({ kind: "bot", botId: topIdOf(botId) ?? botId });
  const rowLink = (botId: string, generation: number, seq: number | null, thread = 0): TodayLink => {
    const top = topIdOf(botId);
    const b = top ? byId.get(top) ?? shared.find((a) => a.bot.id === top)?.bot : undefined;
    return top === botId && b && seq !== null && generation === b.generation ? { kind: "row", botId, seq, ...(thread ? { thread } : {}) } : botLink(botId);
  };
  if (chatIds.length) {
    for (const g of q.all<{ bot_id: string; objective: string; evidence: string; summary: string; status: string; generation: number; thread: number; card_seq: number | null; created_at: number; updated_at: number }>(
      `SELECT bot_id, objective, evidence, summary, status, generation, thread, card_seq, created_at, updated_at FROM bot_goals WHERE bot_id IN (${marks(chatIds.length)}) AND (status = 'active' OR (status = 'complete' AND updated_at >= ?))`, ...chatIds, t - RESULT_WINDOW_MS)) {
      const link = rowLink(g.bot_id, g.generation, g.card_seq, g.thread);
      if (g.status === "active") addMission(g.bot_id, { kind: "goal", title: flat(g.objective, 200), since: g.created_at, link });
      else addResult(g.bot_id, { kind: "goal", title: flat(g.objective, 200), detail: flat(g.evidence || g.summary, 240), at: g.updated_at, link });
    }
    for (const b of q.all<{ bot_id: string; title: string; result: string; state: string; generation: number; card_seq: number | null; created_at: number; updated_at: number }>(
      `SELECT bot_id, title, result, state, generation, card_seq, created_at, updated_at FROM bg_tasks WHERE bot_id IN (${marks(chatIds.length)}) AND (state = 'running' OR (state = 'done' AND updated_at >= ?))`, ...chatIds, t - RESULT_WINDOW_MS)) {
      const link = rowLink(b.bot_id, b.generation, b.card_seq);
      if (b.state === "running") addMission(b.bot_id, { kind: "bgTask", title: flat(b.title, 200), since: b.created_at, link });
      else addResult(b.bot_id, { kind: "bgTask", title: flat(b.title, 200), detail: flat(b.result, 240), at: b.updated_at, link });
    }
  }
  if (ownIds.length) {
    for (const tk of q.all<{ bot_id: string; title: string; note: string; state: string; created_at: number; updated_at: number }>(
      `SELECT bot_id, title, note, state, created_at, updated_at FROM tasks WHERE bot_id IN (${marks(ownIds.length)}) AND (state IN ('working', 'needs_input') OR (state = 'done' AND updated_at >= ?))`, ...ownIds, t - RESULT_WINDOW_MS)) {
      if (tk.state === "done") addResult(tk.bot_id, { kind: "task", title: flat(tk.title, 200), detail: flat(tk.note, 240), at: tk.updated_at, link: botLink(tk.bot_id) });
      else addMission(tk.bot_id, { kind: "task", title: flat(tk.title, 200), since: tk.created_at, link: botLink(tk.bot_id) });
    }
    for (const j of q.all<{ bot_id: string; command: string; started_at: number }>(
      `SELECT bot_id, command, started_at FROM bot_jobs WHERE bot_id IN (${marks(ownIds.length)}) AND status = 'running'`, ...ownIds)) {
      addMission(j.bot_id, { kind: "job", title: flat(j.command, 200), since: j.started_at, link: botLink(j.bot_id) });
    }
  }

  // ── Incidents (owner only) and today's consumption (the account's own usage lines) ──
  const incidents = new Map<string, { open: number; waiting: number }>();
  if (ownIds.length) {
    for (const r of q.all<{ bot_id: string; status: string; n: number }>(
      `SELECT bot_id, status, COUNT(*) AS n FROM bot_failures WHERE bot_id IN (${marks(ownIds.length)}) AND status IN ('auto', 'waiting', 'retrying') GROUP BY bot_id, status`, ...ownIds)) {
      const top = topIdOf(r.bot_id)!;
      const cur = incidents.get(top) ?? { open: 0, waiting: 0 };
      cur.open += r.n; if (r.status === "waiting") cur.waiting += r.n;
      incidents.set(top, cur);
    }
  }
  const tz = userTimezone(userId);
  const day = dayBounds(isValidTimezone(tz) ? tz : "UTC", undefined, t);
  const usage = new Map<string, { usd: number; tokens: number }>();
  for (const r of q.all<{ bot_id: string; c: number | null; i: number | null; o: number | null }>(
    "SELECT bot_id, SUM(cost_usd + est_cost_usd) AS c, SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM usage WHERE user_id = ? AND at >= ? AND at < ? GROUP BY bot_id", userId, day.start, day.end)) {
    const top = topIdOf(r.bot_id) ?? r.bot_id;
    const cur = usage.get(top) ?? { usd: 0, tokens: 0 };
    cur.usd += r.c ?? 0; cur.tokens += (r.i ?? 0) + (r.o ?? 0);
    usage.set(top, cur);
  }

  // ── Computers, as the server last saw them ──
  const comp = computerState(userId);
  const computerOf = (b: BotRecord): CommandComputer | null => computerFor(comp, b);

  // ── The cards ──
  const cards: CommandCard[] = entries.map(({ top, access }) => {
    const isOwn = !access;
    const live = getLive(top.id);
    const list = (missions.get(top.id) ?? []).sort((a, b) => b.since - a.since);
    const awaiting = isOwn ? cardNeeds(top, { approveOnly: false, shared: false }).length : access.canApprove ? cardNeeds(top, { approveOnly: true, shared: true }).length : 0;
    const inc = isOwn ? incidents.get(top.id) ?? { open: 0, waiting: 0 } : null;
    const use = usage.get(top.id);
    const state = commandStateOf({ paused: !!top.pause, live, awaiting, incidentsWaiting: inc?.waiting ?? 0, missions: list.length });
    return {
      botId: top.id, name: top.name, label: top.label, shape: top.shape, color: top.color, primary: isOwn && top.primary, character: top.character,
      sectionId: isOwn ? top.sectionId : null,
      shared: access ? { workspaceName: access.share?.workspaceName ?? "", ownerName: users.byId(top.userId)?.name || "?", role: access.role ?? "viewer" } : null,
      state, live, pause: isOwn ? top.pause : top.pause ? { ...top.pause, sectionId: null } : null,
      mission: list[0] ?? null, missions: list.length, awaiting,
      incidents: inc ? inc.open : null, incidentsWaiting: inc ? inc.waiting : null,
      lastResult: results.get(top.id) ?? null,
      usage: isOwn ? { usd: round4(use?.usd ?? 0), tokens: use?.tokens ?? 0 } : null,
      computer: isOwn ? computerOf(top) : null,
      can: { pause: isOwn, stop: isOwn, chat: true, computer: isOwn && comp.kind !== "none", incidents: isOwn },
      lastActivityAt: top.lastActivityAt,
    };
  });

  const visible = new Set(cards.map((c) => c.botId));
  const links = linksOf(userId, entries, rooms, visible, topIdOf, t);

  // ── Header figures ──
  const totalUsd = [...usage.values()].reduce((a, u) => a + u.usd, 0);
  const totalTokens = [...usage.values()].reduce((a, u) => a + u.tokens, 0);
  const hosted = hostedMode() && !isOperator(userId);
  const subOnly = totalUsd === 0 && totalTokens > 0;
  const desktopsOn = comp.desktops.filter((d) => d.open).length + (comp.shared ?? []).filter((s) => s.power === "running").length;
  const pauseState = q.get("SELECT 1 FROM bot_pauses WHERE user_id = ? AND scope = 'all'", userId);
  return {
    generatedAt: t,
    windowMs: LINK_WINDOW_MS,
    sections: sections.list(userId).map((s) => ({ id: s.id, name: s.name, paused: s.paused })),
    cards,
    links,
    kpis: {
      working: cards.filter((c) => c.state === "working").length,
      waiting: cards.reduce((a, c) => a + (c.awaiting || (c.live.awaiting ? 1 : 0)), 0),
      incidents: cards.reduce((a, c) => a + (c.incidents ?? 0), 0),
      paused: cards.filter((c) => c.state === "paused").length,
      usage: { usd: round4(totalUsd), tokens: totalTokens, eur: hosted ? Math.round(totalUsd * hostedSettings.get().usdToEur * 100) / 100 : null },
      eurPerUsd: hosted ? hostedSettings.get().usdToEur : null,
      display: hosted ? "eur" : subOnly ? "tokens" : "usd",
      computersOn: comp.kind === "none" ? 0 : desktopsOn,
      computersMax: comp.kind === "none" ? 0 : comp.maxDesktops + (comp.maxShared ?? 0) * (comp.shared?.length ? 1 : 0),
    },
    pausedAll: !!pauseState,
  };
}
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function computerFor(comp: ComputerState, b: BotRecord): CommandComputer | null {
  if (comp.kind === "none") return null;
  if (b.computerMode === "shared" && comp.kind === "linux") {
    const s = (comp.shared ?? []).find((x) => x.busyWith === b.id) ?? (comp.shared ?? []).find((x) => x.lastBots[0] === b.id) ?? (comp.shared ?? [])[0];
    if (!s) return { power: "absent", shared: true, name: "" };
    return { power: s.power === "running" ? "on" : s.power === "asleep" ? "asleep" : "absent", shared: true, name: s.name };
  }
  const d = comp.desktops.find((x) => x.botId === b.id);
  // Browser mode lists only the browsers open now: none means it opens on first use.
  return { power: d ? (d.open ? "on" : "asleep") : "absent", shared: false, name: "" };
}

interface MsgRow { bot_id: string; seq: number; thread: number; created_at: number; body: string }
interface BotMsg { row: MsgRow; from: string; text: string }

/** Who worked with whom over the window: messages between bots, failures handed over, group chats both talk in. */
function linksOf(userId: string, entries: Entry[], rooms: BotRecord[], visible: Set<string>, topIdOf: (id: string) => string | null, t: number): CommandLink[] {
  const since = t - LINK_WINDOW_MS;
  const byKey = new Map<string, CommandLink>();
  const pairKey = (kind: string, a: string, b: string, room = "") => `${kind}:${room}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
  const lineOf = (m: BotMsg, toId: string): CommandExchange => ({ at: m.row.created_at, fromId: m.from, toId, text: m.text, botId: m.row.bot_id, seq: m.row.seq, thread: m.row.thread });
  const linkOf = (kind: CommandLink["kind"], from: string, to: string, room?: BotRecord): CommandLink => {
    const key = pairKey(kind, from, to, room?.id);
    let l = byKey.get(key);
    if (!l) { l = { id: key, kind, from, to, count: 0, lastAt: 0, roomId: room?.id ?? null, roomName: room?.name ?? "", exchange: [] }; byKey.set(key, l); }
    return l;
  };
  /** The messages bots wrote in one conversation over the window (newest first), by the visible bot they show under. */
  const botMessages = (bot: BotRecord): BotMsg[] => {
    const out: BotMsg[] = [];
    for (const r of q.all<MsgRow>("SELECT bot_id, seq, thread, created_at, body FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' ORDER BY seq DESC LIMIT ?", bot.id, bot.generation, MESSAGE_SCAN)) {
      if (r.created_at < since) break;
      let b: RowBody;
      try { b = JSON.parse(r.body) as RowBody; } catch { continue; }
      if (b.kind !== "message" || b.origin?.kind !== "bot") continue;
      const from = topIdOf(b.origin.id);
      if (!from || !visible.has(from)) continue;
      out.push({ row: r, from, text: flat(b.text || "", 220) });
    }
    return out;
  };
  // Messages a bot received from a teammate (bot_message), in its current conversation.
  for (const { top } of entries) {
    for (const m of botMessages(top)) {
      if (m.from === top.id) continue;
      const l = linkOf("message", m.from, top.id);
      l.count++; l.lastAt = Math.max(l.lastAt, m.row.created_at);
      if (l.exchange.length < EXCHANGE_LINES) l.exchange.push(lineOf(m, top.id));
    }
  }
  // Work handed to a teammate after a failure (agent/failures.ts): the incident names the teammate it went to.
  const own = entries.filter((e) => !e.access).map((e) => e.top);
  if (own.length) {
    const byName = new Map(own.map((b) => [b.name.toLowerCase(), b.id]));
    for (const f of q.all<{ bot_id: string; tried: string; resolved_at: number | null }>("SELECT bot_id, tried, resolved_at FROM bot_failures WHERE user_id = ? AND status = 'handed' AND resolved_at >= ?", userId, since)) {
      const from = topIdOf(f.bot_id);
      let note = "";
      try { const tried = JSON.parse(f.tried) as { action: string; note?: string }[]; note = [...tried].reverse().find((x) => x.action === "handoff")?.note ?? ""; } catch { /* unreadable */ }
      const to = byName.get(note.toLowerCase());
      if (!from || !to || from === to || !visible.has(from) || !visible.has(to)) continue;
      const l = linkOf("handoff", from, to);
      l.count++; l.lastAt = Math.max(l.lastAt, f.resolved_at ?? t);
    }
  }
  // Group chats: the members who posted there over the window, two by two.
  for (const room of rooms) {
    const posts = botMessages(room).filter((m) => room.memberIds.includes(m.from) || room.memberIds.some((id) => topIdOf(id) === m.from));
    const posters = [...new Set(posts.map((m) => m.from))].slice(0, ROOM_POSTERS).sort();
    for (let i = 0; i < posters.length; i++) for (let j = i + 1; j < posters.length; j++) {
      const a = posters[i], b = posters[j];
      const both = posts.filter((m) => m.from === a || m.from === b);
      const l = linkOf("room", a, b, room);
      l.count = both.length; l.lastAt = both[0]?.row.created_at ?? 0;
      l.exchange = both.slice(0, EXCHANGE_LINES).map((m) => lineOf(m, m.from === a ? b : a));
    }
  }
  // A failure handed over and the message that carried it are one link: the handoff wins.
  for (const l of [...byKey.values()]) {
    if (l.kind !== "handoff") continue;
    const msg = byKey.get(pairKey("message", l.from, l.to));
    if (msg) { l.count = Math.max(l.count, msg.count); l.lastAt = Math.max(l.lastAt, msg.lastAt); l.exchange = msg.exchange; byKey.delete(msg.id); }
  }
  return [...byKey.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 60);
}

type Env = { Variables: { user: UserRecord } };
/** GET /command: the caller's command view (read-only; behind the session like every /api route). */
export function registerCommandRoutes(api: Hono<Env>) {
  api.get("/command", (c) => c.json(commandView(c.get("user").id)));
}
