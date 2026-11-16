import { emit } from "../bus.js";
import { tr } from "../i18n.js";
import { bots, clip, newId, rows, users, type BotRecord, type UserRecord } from "../store.js";
import { enqueue } from "./loop.js";

export const MAX_HOPS = 3;
export const MAX_HELPERS = 4;

/**
 * Puts a message from one bot into another bot's chat and wakes the recipient. `tainted`: the sender had
 * read outside content, so the recipient's turn is careful from the start (the message may carry it).
 */
export function deliverBotMessage(from: BotRecord, to: BotRecord, text: string, depth: number, tainted = false) {
  rows.append(to, { kind: "message", role: "user", text, origin: { kind: "bot", id: from.id, name: from.name } });
  enqueue(to.id, { kind: "bot", fromName: from.name, text, depth: depth + 1, tainted });
}

// ── Ask another bot and wait for its answer (bot_message with wait: true) ───
/**
 * Where a waited-for answer goes: the asking bot and the id of its wait. It rides on the "bot" trigger (so it is kept in
 * the durable queue, bot_queue) and on the answering turn (Turn.ask, and PausedTurn.ask while that turn waits for its
 * owner's approval). Same idea as SuperBot's ask/wait between agents (superbot server/src/runner.rs, where a run that asks
 * another agent waits on that agent's result; server/src/main.rs routes it): here the answer is the answering turn's last
 * words, and when nobody waits any more it goes out the ordinary way, as a message.
 */
export interface AskRoute { id: string; fromId: string }

export type AskOutcome =
  | { kind: "reply"; text: string; tainted: boolean }
  /** The answering turn ended without words (stay_quiet, or a failure it reported in its own chat). */
  | { kind: "silent" }
  /** The answering turn stopped to ask its owner for an approval: its answer will come later, as a message. */
  | { kind: "pending" }
  | { kind: "failed"; reason: string };

const askWaiters = new Map<string, (o: AskOutcome) => void>();
/** Who waits on whom right now (asking bot → bots it waits on, with a count for parallel waits). */
const waitEdges = new Map<string, Map<string, number>>();

function addEdge(from: string, to: string, d: 1 | -1) {
  const m = waitEdges.get(from) ?? new Map<string, number>();
  const n = (m.get(to) ?? 0) + d;
  if (n > 0) m.set(to, n); else m.delete(to);
  if (m.size) waitEdges.set(from, m); else waitEdges.delete(from);
}

/** True when `start` waits, directly or through others, on `goal`: `goal` waiting on `start` would never end. */
export function waitsOn(start: string, goal: string): boolean {
  const seen = new Set<string>();
  const todo = [start];
  while (todo.length) {
    const cur = todo.pop()!;
    if (cur === goal) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of waitEdges.get(cur)?.keys() ?? []) todo.push(next);
  }
  return false;
}

/**
 * The answering turn is over (or paused): its answer goes to whoever still waits for it; when nobody does (the wait timed
 * out, the asking turn was stopped, the server restarted), the answer is delivered as an ordinary message instead — so it
 * is never lost, and never delivered twice. A paused turn keeps its route: it answers once it is resumed and done.
 */
export function settleAsk(to: BotRecord, route: AskRoute, o: { lastText: string; tainted: boolean; depth: number; failed: string; paused: boolean }) {
  const waiter = askWaiters.get(route.id);
  if (o.paused) { if (waiter) { askWaiters.delete(route.id); waiter({ kind: "pending" }); } return; }
  const text = o.lastText.trim();
  const outcome: AskOutcome = o.failed ? { kind: "failed", reason: o.failed } : text ? { kind: "reply", text, tainted: o.tainted } : { kind: "silent" };
  if (waiter) { askWaiters.delete(route.id); waiter(outcome); return; }
  const from = bots.byId(route.fromId);
  // Only ever back to a bot of the same account.
  if (from && from.kind === "agent" && from.userId === to.userId && text) deliverBotMessage(to, from, text, o.depth, o.tainted);
}

export type WaitResult = AskOutcome | { kind: "timeout" } | { kind: "stopped" };

/**
 * Puts the message in the other bot's chat and queues its turn, like deliverBotMessage, then waits for that turn's
 * answer for up to `timeoutMs`, or until the asking turn is stopped (`signal`, which also fires at a subscription turn's
 * time limit). On timeout or stop the wait simply ends: the answer will arrive later as a message (settleAsk).
 */
export async function askAndWait(from: BotRecord, to: BotRecord, text: string, depth: number, tainted: boolean, timeoutMs: number, signal: AbortSignal): Promise<WaitResult> {
  const route: AskRoute = { id: newId("ask"), fromId: from.id };
  addEdge(from.id, to.id, 1);
  let timer: NodeJS.Timeout | null = null;
  let onAbort: (() => void) | null = null;
  try {
    const answer = new Promise<WaitResult>((resolve) => {
      askWaiters.set(route.id, resolve);
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      onAbort = () => resolve({ kind: "stopped" });
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    });
    rows.append(to, { kind: "message", role: "user", text, origin: { kind: "bot", id: from.id, name: from.name } });
    enqueue(to.id, { kind: "bot", fromName: from.name, text, depth: depth + 1, tainted, ask: route });
    return await answer;
  } finally {
    askWaiters.delete(route.id);
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    addEdge(from.id, to.id, -1);
  }
}

export function startHelper(parent: BotRecord, goal: string, label: string | undefined, depth: number, tainted = false): BotRecord {
  const short = clip((label || goal).replace(/\s+/g, " ").trim(), 32);
  const helper = bots.create(parent.userId, {
    name: `${parent.name} › ${short}`, label: tr(users.localeOf(parent.userId), "Helper"), description: tr(users.localeOf(parent.userId), "Temporary helper working for {name}.", { name: parent.name }),
    shape: parent.shape, color: parent.color, mode: parent.mode, effort: parent.effort, model: parent.model, autonomy: parent.autonomy,
    hidden: true, parentId: parent.id,
  });
  deliverBotMessage(parent, helper, goal, depth, tainted);
  return helper;
}

/** Names mentioned with "@" in a room message. "@everyone" / "@all" address the whole room. */
function mentioned(text: string, members: BotRecord[]): BotRecord[] {
  if (/@(everyone|all)\b/i.test(text)) return members;
  const lower = text.toLowerCase();
  return members.filter((m) => lower.includes("@" + m.name.toLowerCase()));
}

/**
 * Decides who answers a message in a group chat: whoever is mentioned; when nobody is, the first
 * member takes it. Bots reply into the room through their room_post tool, or stay quiet.
 * `thread`: the message was posted in a thread (the seq it hangs on). Mentions work the same; when nobody is
 * mentioned, the bots already in that thread (or the bot whose message started it) answer, else the room's rule.
 */
export function dispatchToRoom(room: BotRecord, user: UserRecord, text: string, fromBot: BotRecord | null, depth: number, tainted = false, thread = 0) {
  // A member that belongs to someone else (however it got on the list) is never woken by this room.
  const members = room.memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b && b.kind === "agent" && b.userId === room.userId);
  let targets = mentioned(text, members).filter((m) => m.id !== fromBot?.id);
  const parent = thread ? rows.get(room.id, room.generation, thread) : null;
  if (!targets.length && !fromBot && parent) {
    const inThread = new Set<string>();
    for (const r of [parent, ...rows.list(room.id, room.generation, 200, undefined, thread)])
      if (r.body.kind === "message" && r.body.origin?.kind === "bot") inThread.add(r.body.origin.id);
    targets = members.filter((m) => inThread.has(m.id));
  }
  // Nobody mentioned: the room's rule decides. "lead" = the first member; "everyone" = all of them; "mentions" = nobody.
  if (!targets.length && !fromBot) targets = room.roomRule === "everyone" ? members : room.roomRule === "mentions" ? [] : members.slice(0, 1);
  if (depth >= MAX_HOPS) return;
  const roster = members.map((m) => m.name).join(", ");
  const about = parent && parent.body.kind === "message"
    ? `This was posted in thread number ${thread} of the group, a side conversation on this message${parent.body.origin?.kind === "bot" ? ` by ${parent.body.origin.name}` : parent.body.role === "user" ? ` by ${user.name}` : ""}: "${clip(parent.body.text || "(a file)", 600)}".\n`
    : "";
  for (const target of targets) {
    enqueue(target.id, {
      kind: "system", depth: depth + 1, tainted: !!fromBot && tainted,
      text: `New message in the group chat "${room.name}" (members: ${roster}).\n${about}${fromBot ? fromBot.name : user.name} wrote: ${text}\n\n` +
        `If you have something useful to add, answer in the group with room_post (room "${room.name}"${thread ? `, thread ${thread}` : ""}). Mention a teammate with @Name to bring them in. If there is nothing worth saying, call stay_quiet.`,
    });
  }
}

export function createRoom(userId: string, name: string, memberIds: string[]): BotRecord {
  const room = bots.create(userId, { kind: "room", name, label: tr(users.localeOf(userId), "Group"), description: tr(users.localeOf(userId), "Group chat with {n} bots.", { n: memberIds.length }), shape: "squircle", color: "slate", memberIds });
  emit(userId, { type: "roster" });
  return room;
}

/** Valid room members: the user's own visible agent bots, without duplicates. */
export function validMembers(userId: string, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  for (const id of ids) {
    const b = typeof id === "string" ? bots.owned(userId, id) : null;
    if (b && b.kind === "agent" && !b.hidden) seen.add(b.id);
  }
  return [...seen];
}
