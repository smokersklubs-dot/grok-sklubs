import type { ToolSpec } from "../llm/types.js";
import { netGate } from "../netpolicy.js";
import { bots, clip } from "../store.js";
import type { BuiltinTool, ToolContext } from "../agent/tools.js";
import { meetingLink, PLATFORM_LABEL } from "./links.js";
import { guestNameFor, meetings, meetingSettings, MAX_MINUTES, MIN_MINUTES } from "./session.js";

/**
 * L177 — the meeting bot's tools (session.ts). meeting_join always shows the owner an approval card with the exact
 * link, the guest name and the consent warning (strict, once: an earlier « always » never skips it), and runs only in
 * a turn the owner started themselves (not a routine, an email, a webhook, another bot, the Bot API or a workspace
 * member). It starts the meeting in the background and returns at once; the notes come later in this conversation.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const OWNER_ORIGINS = new Set(["user", "resume", undefined]);

function onlyOwner(c: ToolContext): string | null {
  if (c.user.id !== c.bot.userId || !OWNER_ORIGINS.has(c.origin)) return "Only your owner can send you to a meeting, by asking you in this chat (or with the Meeting button). Do not try another way.";
  return null;
}

export const meetingBotTools: BuiltinTool[] = [
  {
    spec: {
      name: "meeting_join",
      description: "Join an online meeting (Google Meet, Zoom, Microsoft Teams, Jitsi) as a muted guest that takes notes, when your owner gives you the link and asks. You announce yourself in the meeting chat, leave on any refusal, never sign in and never speak. The owner approves a card first. Returns at once; the notes and action items are posted here when you leave. Use meeting_leave to leave earlier.",
      inputSchema: obj({ url: { type: "string", description: "The meeting link the owner gave, exactly" }, max_minutes: { type: "integer", description: `Longest stay in minutes (${MIN_MINUTES}–${MAX_MINUTES}); default: the owner's setting` }, allow_paid: { type: "boolean", description: "Allow a paid speech-to-text for this meeting (shown on the card)" } }, ["url"]),
    },
    activity: "computer", label: "Joining a meeting", group: "computer", audited: true,
    gate: (a, ctx) => {
      const link = meetingLink(a.url);
      const bot = bots.byId(ctx.botId);
      if (!link.ok || !bot) return null; // the tool explains
      const minutes = Number.isInteger(a.max_minutes) ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, a.max_minutes)) : meetingSettings.get(bot.id).maxMinutes;
      return {
        key: "meeting_join", strict: true, once: true, source: "Meeting",
        vars: { url: clip(link.url, 300), meeting: PLATFORM_LABEL[link.platform], name: guestNameFor(bot), minutes: String(minutes) },
        title: "Send {bot} into this {meeting} meeting to take notes? {url}",
        reason: "join the {meeting} meeting {url}",
        note: `It joins as a guest named « {name} », announces itself in the meeting chat, stays muted, never signs in, and leaves on any refusal or after {minutes} min.${a.allow_paid === true ? " Paid transcription is allowed for this meeting." : ""} Local laws may require everyone's consent before recording: tell the participants.`,
      };
    },
    run: async (a, c) => {
      const refused = onlyOwner(c);
      if (refused) return { content: refused, isError: true, summary: "owner only" };
      const link = meetingLink(a.url);
      if (!link.ok) return { content: link.error, isError: true, summary: "link refused" };
      const net = netGate(c.bot, link.url, "meeting_join");
      if (net) return { content: net, isError: true, summary: "network" };
      const s = meetings.start(c.bot, { platform: link.platform, url: link.url, thread: c.thread, maxMinutes: Number.isInteger(a.max_minutes) ? a.max_minutes : undefined, allowPaid: a.allow_paid === true });
      if (typeof s === "string") return { content: s, isError: true, summary: "not started" };
      return { content: `Joining the ${PLATFORM_LABEL[link.platform]} meeting as « ${s.guestName} » (at most ${s.maxMinutes} min). You will post the status and, at the end, the notes in this conversation by yourself: do not wait or poll. Tell the owner in one short sentence, and remind them that local laws may require everyone's consent.`, summary: PLATFORM_LABEL[link.platform] };
    },
  },
  {
    spec: { name: "meeting_leave", description: "Leave the online meeting you are in (when your owner asks). Your notes are then posted here.", inputSchema: obj({}) },
    activity: "computer", label: "Leaving the meeting", group: "computer",
    run: async (_a, c) => {
      const refused = onlyOwner(c);
      if (refused) return { content: refused, isError: true, summary: "owner only" };
      const s = meetings.active(c.bot.id);
      if (!s || !meetings.leave(c.user.id, s.id)) return { content: "You are not in a meeting.", summary: "not in a meeting" };
      return { content: "Leaving the meeting now. The notes will be posted here in a moment.", summary: "leaving" };
    },
  },
];
