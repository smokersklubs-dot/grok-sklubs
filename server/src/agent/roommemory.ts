import { emit } from "../bus.js";
import type { ToolSpec } from "../llm/index.js";
import { bots, clip, memories, type BotRecord } from "../store.js";
import { cleanDay, setMarks } from "./memorymarks.js";
import { rankNotes } from "./recall.js";
import { memoryVerdict } from "./sensitive.js";
import type { BuiltinTool } from "./tools.js";

/**
 * Group memory (audit DS-Bot #58, #78; À faire n° 6): notes that belong to ONE group chat. Idea from DS-Bot's group
 * scope (ds-bot/src/host/memory.js, Apache-2.0); our own code.
 *  - Isolated by default: a group's notes are kept under the group itself (memories.bot_id = the room's id), read only
 *    in that group's turns (team.ts wakeInRoom shows them with the message) and by its members' group tools. They never
 *    enter a member's own memory or private chat, nor another group.
 *  - Owner-visible: they are the owner's like any note (Settings of the group → « Notes du groupe »; the same edit,
 *    pin, end date and delete as a bot's notes, through /memories/:id — memories.owned checks the account).
 *  - The same rules as memory_save: never a secret, sensitive topics only when allowed (sensitive.ts).
 */
export const ROOM_NOTES_CHARS = 1500;
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

/** The group, when this bot is one of its members (else why not). */
function roomFor(bot: BotRecord, name: unknown): BotRecord | string {
  const room = bots.byName(bot.userId, String(name ?? ""));
  if (!room || room.kind !== "room" || room.userId !== bot.userId) return `No group chat is called "${name}".`;
  if (!room.memberIds.includes(bot.id)) return "You are not a member of that group: its notes are only for its members.";
  return room;
}

/** The lines added to a member's wake message in this group (newest first within the budget), or "". */
export function roomNotesText(room: BotRecord): string {
  const notes = memories.usable(room.id, 200).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const lines: string[] = [];
  let used = 0;
  for (const m of notes) {
    const line = `- ${m.text}${m.until ? ` (until ${m.until})` : ""}`;
    if (used + line.length > ROOM_NOTES_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return "";
  const more = notes.length > lines.length ? `\n(${notes.length - lines.length} more: group_notes finds them.)` : "";
  return `\n\nNotes of this group (shared only in "${room.name}"; they are not yours to carry into other chats):\n${lines.join("\n")}${more}`;
}

export const roomMemoryTools: BuiltinTool[] = [
  {
    spec: { name: "group_note_save", description: "Keep a lasting note for one group chat you belong to (a decision, a convention, who does what). It is shared with that group only — not with your own memory or other chats.", inputSchema: obj({ room: str("The group's name"), text: str("One short, self-contained sentence"), until: str("Optional: the last day it holds, YYYY-MM-DD") }, ["room", "text"]) },
    activity: "remembering", label: "Saving a group note",
    run: async (a, c) => {
      const room = roomFor(c.bot, a.room);
      if (typeof room === "string") return { content: room, isError: true };
      const text = clip(String(a.text ?? "").replace(/\s+/g, " ").trim(), 500);
      if (!text) return { content: "Nothing to keep.", isError: true };
      const v = memoryVerdict(c.user.id, text, false);
      if (!v.ok) return { content: v.reason, isError: true, summary: "not kept" };
      const note = memories.add(room.id, text, "chat", { category: v.category });
      const until = cleanDay(a.until);
      if (until) setMarks(c.user.id, note, { until }, "bot");
      emit(c.user.id, { type: "memories", botId: room.id });
      return { content: `Kept for the group "${room.name}".`, summary: `${room.name}: ${clip(text, 60)}` };
    },
  },
  {
    spec: { name: "group_notes", description: "Read the notes of one group chat you belong to, best matches first when you give words to look for.", inputSchema: obj({ room: str("The group's name"), query: str("Optional: words to look for") }, ["room"]) },
    activity: "remembering", label: "Reading group notes",
    run: async (a, c) => {
      const room = roomFor(c.bot, a.room);
      if (typeof room === "string") return { content: room, isError: true };
      const all = memories.usable(room.id, 500);
      const query = String(a.query ?? "").trim();
      const list = query ? rankNotes(all, query).filter((r) => r.relevance > 0).map((r) => r.note) : all;
      return { content: list.length ? list.slice(0, 30).map((m) => `- ${m.text}`).join("\n") : "This group has no notes yet.", summary: `${list.length}` };
    },
  },
];
