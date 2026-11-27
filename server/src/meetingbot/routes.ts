import type { Context, Hono } from "hono";
import { tr } from "../i18n.js";
import { mediaAvailable } from "../media.js";
import { netGate } from "../netpolicy.js";
import { body, fail } from "../routeinput.js";
import { bots, type BotRecord, type UserRecord } from "../store.js";
import { meetingLink, PLATFORM_LABEL, REFUSAL_WORDS } from "./links.js";
import { guestNameFor, meetings, meetingSettings, MAX_MINUTES, MIN_MINUTES } from "./session.js";

/**
 * L177 — the meeting dialog (web MeetingBotDialog.tsx). Owner only: every route checks that the bot is the caller's
 * own (account isolation; a workspace member or viewer gets 404 like a stranger).
 *  GET  /bots/:id/meeting-bots                → { available, sessions, settings, defaults }
 *  POST /bots/:id/meeting-bots/check { url }  → { platform, url, name, maxMinutes } (the review card, nothing starts)
 *  POST /bots/:id/meeting-bots { url, maxMinutes?, allowPaid?, confirm: true } → { session } (the owner's « Envoyer »)
 *  POST /bots/:id/meeting-bots/:mid/leave     → { ok }
 *  PUT  /bots/:id/meeting-bot-settings { maxMinutes?, words? } → { settings }
 */
export function registerMeetingBotRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const own = (c: Context): BotRecord => {
    const b = bots.owned(user(c).id, c.req.param("id") ?? "") ?? fail(404, tr(user(c).locale, "That bot does not exist."));
    return b.kind === "agent" ? b : fail(400, tr(user(c).locale, "A group chat cannot do that."));
  };
  const checked = (c: Context, b: BotRecord, raw: unknown) => {
    const link = meetingLink(raw);
    if (!link.ok) return fail(400, tr(user(c).locale, link.error));
    const net = netGate(b, link.url, "meeting_join");
    if (net) fail(403, net);
    return link;
  };
  const minutes = (c: Context, b: BotRecord, raw: unknown) => {
    if (raw === undefined || raw === null || raw === "") return meetingSettings.get(b.id).maxMinutes;
    const n = Number(raw);
    return Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES ? n : fail(400, tr(user(c).locale, "The maximum duration is between 5 and 240 minutes."));
  };

  api.get("/bots/:id/meeting-bots", (c) => {
    const b = own(c);
    return c.json({ available: mediaAvailable(), sessions: meetings.list(user(c).id, b.id), settings: meetingSettings.get(b.id), defaults: { words: REFUSAL_WORDS, min: MIN_MINUTES, max: MAX_MINUTES }, name: guestNameFor(b) });
  });
  api.post("/bots/:id/meeting-bots/check", async (c) => {
    const b = own(c);
    const f = await body(c);
    const link = checked(c, b, f.url);
    return c.json({ platform: link.platform, label: PLATFORM_LABEL[link.platform], url: link.url, name: guestNameFor(b), maxMinutes: minutes(c, b, f.maxMinutes) });
  });
  api.post("/bots/:id/meeting-bots", async (c) => {
    const b = own(c);
    const u = user(c);
    if (!mediaAvailable()) fail(400, tr(u.locale, "Meetings need the bot's own Linux computer, which this server does not give its bots."));
    const f = await body(c);
    if (f.confirm !== true) fail(400, tr(u.locale, "Confirm the card first."));
    const link = checked(c, b, f.url);
    const s = meetings.start(b, { platform: link.platform, url: link.url, maxMinutes: minutes(c, b, f.maxMinutes), allowPaid: f.allowPaid === true });
    if (typeof s === "string") fail(409, tr(u.locale, s));
    return c.json({ session: s });
  });
  api.post("/bots/:id/meeting-bots/:mid/leave", (c) => {
    const b = own(c);
    const s = meetings.get(user(c).id, c.req.param("mid") ?? "");
    if (!s || s.botId !== b.id || !meetings.leave(user(c).id, s.id)) fail(404, tr(user(c).locale, "This bot is not in that meeting."));
    return c.json({ ok: true });
  });
  api.put("/bots/:id/meeting-bot-settings", async (c) => {
    const b = own(c);
    const problem = meetingSettings.set(b, await body(c));
    if (problem) fail(400, tr(user(c).locale, problem));
    return c.json({ settings: meetingSettings.get(b.id) });
  });
}
