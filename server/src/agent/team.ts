import { emit } from "../bus.js";
import { tr } from "../i18n.js";
import { bots, clip, newId, rows, users, type BotRecord, type UserRecord } from "../store.js";
import { enqueue, isPaused } from "./loop.js";
import { postBudget, roomChannel } from "./roombudget.js";
import { answerOffer, noteBotPost, roomRouting, routeAuto } from "./roomrouting.js";

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
 * Decides who answers a message in a group chat: whoever is mentioned; when nobody is, the room's rule — the first
 * member ("lead"), all of them ("everyone"), nobody ("mentions"), or "auto": a quick choice of the best member for this
 * message (agent/roomrouting.ts), which never overrides a mention. Bots reply into the room through their room_post
 * tool, or stay quiet.
 * `thread`: the message was posted in a thread (the seq it hangs on). Mentions work the same; when nobody is
 * mentioned, the bots already in that thread (or the bot whose message started it) answer, else the room's rule.
 */
export function dispatchToRoom(room: BotRecord, user: UserRecord, text: string, fromBot: BotRecord | null, depth: number, tainted = false, thread = 0) {
  // A human wrote in the room: its anti-loop breaker closes and its counters start over (roombudget.ts).
  if (!fromBot) postBudget.human(room.userId, roomChannel(room.id));
  // A member's post may be the offer it was asked to make first (« Proposer avant de commencer »): note where it is.
  else noteBotPost(room, fromBot, thread);
  // A member that belongs to someone else (however it got on the list) is never woken by this room.
  const all = room.memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b && b.kind === "agent" && b.userId === room.userId);
  // "Pause": a paused member is skipped and the room goes on with the others. One that was called by name says so in the
  // room (once per message), so whoever wrote knows not to wait for it.
  const members = all.filter((m) => !isPaused(m));
  const asleep = mentioned(text, all).filter((m) => m.id !== fromBot?.id && isPaused(m));
  if (asleep.length && depth < MAX_HOPS) {
    const loc = users.localeOf(room.userId);
    rows.append(room, { kind: "notice", tone: "info", text: asleep.length === 1 ? tr(loc, "{bot} is paused and will not answer until it is resumed.", { bot: asleep[0].name }) : tr(loc, "{bots} are paused and will not answer until they are resumed.", { bots: asleep.map((m) => m.name).join(", ") }) }, thread);
  }
  let targets = mentioned(text, members).filter((m) => m.id !== fromBot?.id);
  const parent = thread ? rows.get(room.id, room.generation, thread) : null;
  if (!targets.length && !fromBot && parent) {
    const inThread = new Set<string>();
    for (const r of [parent, ...rows.list(room.id, room.generation, 200, undefined, thread)])
      if (r.body.kind === "message" && r.body.origin?.kind === "bot") inThread.add(r.body.origin.id);
    targets = members.filter((m) => inThread.has(m.id));
  }
  // A yes (or a no) to a member's offer to take a task goes to that member, without anything else (roomrouting.ts).
  if (!targets.length && !fromBot && depth < MAX_HOPS && answerOffer(room, user, text, members, thread)) return;
  // "auto": the choice takes a moment (at most ~1.5 s); the chosen member is woken from there, through wakeInRoom.
  if (!targets.length && !fromBot && room.roomRule === "auto") { if (depth < MAX_HOPS) void routeAuto(room, user, text, members, thread); return; }
  // Nobody mentioned: the room's rule decides. "lead" = the first member; "everyone" = all of them; "mentions" = nobody.
  if (!targets.length && !fromBot) targets = room.roomRule === "everyone" ? members : room.roomRule === "mentions" ? [] : members.slice(0, 1);
  if (depth >= MAX_HOPS) return;
  wakeInRoom(room, user, text, fromBot, depth, tainted, thread, targets);
}

/**
 * Wakes these members of the room on a message: each gets the message, who wrote it, the roster, the thread it is in,
 * and how to answer (room_post) or not (stay_quiet). `notes`: extra lines for one member (why it was picked, an offer to
 * make first…). A discreet room (roomrouting.ts) tells them never to chime in unasked.
 */
export function wakeInRoom(room: BotRecord, user: UserRecord, text: string, fromBot: BotRecord | null, depth: number, tainted: boolean, thread: number, targets: BotRecord[], notes?: Map<string, string>) {
  if (depth >= MAX_HOPS || !targets.length) return;
  const members = room.memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b && b.kind === "agent" && b.userId === room.userId && !isPaused(b));
  const parent = thread ? rows.get(room.id, room.generation, thread) : null;
  const roster = members.map((m) => m.name).join(", ");
  const about = parent && parent.body.kind === "message"
    ? `This was posted in thread number ${thread} of the group, a side conversation on this message${parent.body.origin?.kind === "bot" ? ` by ${parent.body.origin.name}` : parent.body.role === "user" ? ` by ${user.name}` : ""}: "${clip(parent.body.text || "(a file)", 600)}".\n`
    : "";
  const quiet = roomRouting.get(room.id).discreet
    ? "\nThis group is set to discreet: answer only what you were asked or what is clearly for you; never add unprompted remarks. When the message is not for you, call stay_quiet." : "";
  for (const target of targets) {
    if (target.userId !== room.userId || target.kind !== "agent") continue;
    const note = notes?.get(target.id);
    enqueue(target.id, {
      kind: "system", depth: depth + 1, tainted: !!fromBot && tainted, unattended: !!fromBot || undefined,
      text: `New message in the group chat "${room.name}" (members: ${roster}).\n${about}${fromBot ? fromBot.name : user.name} wrote: ${text}\n\n` +
        `If you have something useful to add, answer in the group with room_post (room "${room.name}"${thread ? `, thread ${thread}` : ""}). Mention a teammate with @Name to bring them in. If there is nothing worth saying, call stay_quiet.${quiet}${note ? `\n${note}` : ""}`,
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
