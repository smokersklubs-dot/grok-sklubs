/**
 * L184 routes — polls (polls.ts), pinned dashboard (dashboardpins.ts), link preview (linkpreview.ts), apps' own notices
 * (appevents.ts), metrics (metrics.ts). Behind the session unless said; the owner's own bots only (another account's
 * answers 404).
 *   POST   /bots/:id/polls                 { question, options[], multi, thread }  posts a poll card; the bot(s) are asked to vote
 *   POST   /polls/:pollId/vote             { choices: number[] (0-based) }          the owner's vote (replaces the previous one)
 *   POST   /polls/:pollId/close
 *   POST   /bots/:id/cards/:seq/pin        pins a view card to the dashboard
 *   GET    /dashboard/pins | DELETE /dashboard/pins/:id | POST /dashboard/pins/:id/move { dir: -1 | 1 }
 *   GET    /link-preview?url=…             title, description, site of a public page (60 per minute per account)
 *   GET    /bots/:id/app-events            notices of the apps this bot may use
 *   GET    /usage-metrics                  the account's numbers
 *   GET    /metrics (public, METRICS_TOKEN) registerMetricsRoute, before the session check
 */
import type { Context, Hono } from "hono";
import { submitUserMessage } from "./agent/loop.js";
import { dispatchToRoom } from "./agent/team.js";
import { appEventsFor } from "./appevents.js";
import { dashboard } from "./dashboardpins.js";
import { linkPreview } from "./linkpreview.js";
import { metricsAllowed, prometheusText, usageMetrics } from "./metrics.js";
import { pollText, polls } from "./polls.js";
import { body, fail } from "./routeinput.js";
import type { BotRecord, UserRecord } from "./store.js";

const previewHits = new Map<string, number[]>();

export function registerMetricsRoute(api: Hono<any>) {
  api.get("/metrics", (c) => {
    if (!metricsAllowed(c.req.header("authorization"))) return c.json({ error: "Metrics are off, or the token is wrong." }, 401);
    return c.body(prometheusText(usageMetrics(null)), 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
  });
}

export function registerChatPlusRoutes(api: Hono<any>, ownBot: (c: Context) => BotRecord) {
  const user = (c: Context) => c.get("user") as UserRecord;

  api.post("/bots/:id/polls", async (c) => {
    const chat = ownBot(c);
    const u = user(c);
    const b = await body(c);
    const thread = Number.isInteger(b.thread) ? Number(b.thread) : 0;
    let card;
    try { card = polls.create(chat, `user:${u.id}`, b, thread); } catch (e) { return fail(400, (e as Error).message); }
    // The bots are asked to vote as a message from the owner (never as an instruction from outside).
    const ask = `(The user posted a poll. Vote with poll_vote, then say your choice in one short line.)\n${pollText(card)}`;
    if (chat.kind === "room") dispatchToRoom(chat, u, ask, null, 0, false, thread);
    else submitUserMessage(chat, ask, false, [], undefined, thread);
    return c.json({ poll: card });
  });
  api.post("/polls/:pollId/vote", async (c) => {
    const u = user(c);
    const b = await body(c);
    const r = polls.vote(u.id, c.req.param("pollId"), { by: `user:${u.id}`, name: u.name || u.email, choices: (Array.isArray(b.choices) ? b.choices : []).map(Number) });
    if ("error" in r) return fail(r.error === "No such poll." ? 404 : 400, r.error);
    return c.json({ poll: r });
  });
  api.post("/polls/:pollId/close", (c) => { const r = polls.close(user(c).id, c.req.param("pollId")); return r ? c.json({ poll: r }) : fail(404, "No such poll."); });

  api.post("/bots/:id/cards/:seq/pin", (c) => {
    const bot = ownBot(c);
    try { return c.json({ pins: dashboard.pin(user(c).id, bot.id, Number(c.req.param("seq"))) }); } catch (e) { return fail(400, (e as Error).message); }
  });
  api.get("/dashboard/pins", (c) => c.json({ pins: dashboard.list(user(c).id) }));
  api.delete("/dashboard/pins/:id", (c) => (dashboard.unpin(user(c).id, c.req.param("id")) ? c.json({ pins: dashboard.list(user(c).id) }) : fail(404, "No such pin.")));
  api.post("/dashboard/pins/:id/move", async (c) => c.json({ pins: dashboard.move(user(c).id, c.req.param("id"), (await body(c)).dir === -1 ? -1 : 1) }));

  api.get("/link-preview", async (c) => {
    const u = user(c);
    const t = Date.now();
    const hits = (previewHits.get(u.id) ?? []).filter((x) => t - x < 60_000);
    if (hits.length >= 60) return c.json({ preview: null, problem: "too many previews this minute" }, 429);
    hits.push(t); previewHits.set(u.id, hits);
    return c.json(await linkPreview(String(c.req.query("url") ?? "")));
  });
  api.get("/bots/:id/app-events", (c) => { const bot = ownBot(c); return c.json({ events: appEventsFor(user(c).id, bot.id) }); });
  api.get("/usage-metrics", (c) => c.json({ metrics: usageMetrics(user(c).id) }));
}
