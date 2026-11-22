import { tr } from "../i18n.js";
import type { ToolSpec } from "../llm/index.js";
import { audit, bots, clip, rows, type BotRecord } from "../store.js";
import { isPaused } from "./loop.js";
import { addressesNoBot, postBudget, roomChannel } from "./roombudget.js";
import { MAX_HOPS, wakeInRoom } from "./team.js";
import type { BuiltinTool } from "./tools.js"; import { scrubHandoff } from "./handoffscrub.js";

/**
 * Hand-off between members of a group chat (spec 09 V1-013 / V1-014), kept apart from tools.ts: a member hands the
 * question to another member of the same group with an explicit message, visible to everyone in the group (« Léa passe
 * la main à @Marc : … »), and the other member is woken with it. Same limits as room_post: only between members of the
 * group (never a hidden helper, a paused bot or someone else's bot), the anti-loop budget (roombudget.ts), and the hop
 * limit. A hand-off never gives the other bot anything more than a mention would: its own tools and approvals apply.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

export const roomTools: BuiltinTool[] = [
  {
    spec: {
      name: "room_handoff",
      description: "In a group chat you belong to, hand the current question or task to another member of that group who is better placed, with a short message saying what you need from them. Everyone in the group sees the hand-off. This ends your turn.",
      inputSchema: obj({ room: str("The group's name"), to: str("The member's name"), message: str("What you hand over and what you need back, in one or two sentences"), thread: int("The thread number you were given, if any") }, ["room", "to", "message"]),
    },
    activity: "messaging", label: "Handing over in a group",
    run: async (a, c) => {
      const room = bots.byName(c.user.id, String(a.room ?? ""));
      if (!room || room.kind !== "room") return { content: `No group chat is called "${a.room}".`, isError: true };
      if (!room.memberIds.includes(c.bot.id)) return { content: "You are not a member of that group.", isError: true };
      const name = String(a.to ?? "").replace(/^@/, "").trim().toLowerCase();
      const to = room.memberIds.map((id) => bots.byId(id)).find((b): b is BotRecord => !!b && b.name.toLowerCase() === name);
      if (!to || to.kind !== "agent" || to.userId !== room.userId || to.hidden || to.parentId) return { content: `No member of "${room.name}" is called "${a.to}".`, isError: true };
      if (to.id === c.bot.id) return { content: "You cannot hand over to yourself.", isError: true };
      if (isPaused(to)) return { content: `${to.name} is paused and cannot take it now.`, isError: true };
      if (c.depth >= MAX_HOPS) return { content: "Too many hand-offs in a row: answer the group yourself.", isError: true };
      const note = clip(scrubHandoff(c.user.id, String(a.message ?? "")).replace(/\s+/g, " ").trim(), 600); // L46: no secret in a hand-off
      if (!note) return { content: "Say what you hand over.", isError: true };
      let thread = 0;
      if (a.thread !== undefined && a.thread !== null && Number(a.thread) > 0) {
        const parent = rows.get(room.id, room.generation, Number(a.thread));
        if (!parent || parent.thread || parent.body.kind !== "message") return { content: `That group has no thread number ${a.thread}.`, isError: true };
        thread = parent.seq;
      }
      const text = tr(c.user.locale, "@{to}, I'm handing this over to you: {note}", { to: to.name, note });
      const channel = roomChannel(room.id);
      if (c.origin === "user") postBudget.human(c.user.id, channel);
      const others = room.memberIds.filter((id) => id !== c.bot.id).map((id) => bots.byId(id)?.name ?? "").filter(Boolean);
      const verdict = postBudget.attempt(c.user.id, { channel, botId: c.bot.id, text, now: Date.now(), toUser: addressesNoBot(text, others) });
      if (!verdict.allow) return { content: verdict.reason, isError: true, endTurn: true };
      rows.append(room, { kind: "message", role: "assistant", text, origin: { kind: "bot", id: c.bot.id, name: c.bot.name } }, thread);
      bots.bumpUnread(room.id);
      bots.announce(room);
      audit(c.user.id, "tool", `${c.bot.name} handed over to ${to.name} in ${room.name}`, room.id);
      wakeInRoom(room, c.user, text, c.bot, c.depth, !!c.tainted, thread, [to],
        new Map([[to.id, `${c.bot.name} handed this over to you in the group. First acknowledge in one short line with room_post, then do it and post the result there. If it is not yours either, say so in the group instead of handing it on.`]]));
      return { content: `Handed over to ${to.name}.`, summary: `${room.name} → ${to.name}`, endTurn: true };
    },
  },
];
