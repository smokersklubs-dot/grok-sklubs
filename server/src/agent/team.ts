import { emit } from "../bus.js";
import { tr } from "../i18n.js";
import { bots, clip, rows, users, type BotRecord, type UserRecord } from "../store.js";
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
