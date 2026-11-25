import type { Context, Hono } from "hono";
import { config } from "./config.js";
import { designJournal, DesignJournalError } from "./designjournal.js";
import { tr } from "./i18n.js";
import { decidePageLoss, PageLossRefused } from "./pagekeep.js";
import { body, fail } from "./routeinput.js";
import type { BotRecord, UserRecord } from "./store.js";

/**
 * L157 (backlog A-FAIRE), owner side. Behind the session like every /api route; each account reaches only its own things.
 *   POST   /bots/:id/rows/:seq/pageloss  { choice: "keep" | "restore" }   the « rien de perdu » card (pagekeep.ts)
 *   GET    /design-journal                                             the account's design decisions (designjournal.ts)
 *   POST   /design-journal                { topic, decision, why? }     one more decision, written by the owner
 *   DELETE /design-journal/:id                                          removes one (404 when it is not the caller's)
 */
type E = { Variables: { user: UserRecord } };
const no = (c: Context<E>, status: 400 | 404 | 409, text: string): never => fail(status, tr(c.get("user").locale, text));

export function registerPageKeepRoutes(api: Hono<E>, ownAgent: (c: Context<E>) => BotRecord) {
  api.post("/bots/:id/rows/:seq/pageloss", async (c) => {
    const bot = ownAgent(c);
    try { return c.json({ card: decidePageLoss(bot, c.get("user").id, Number(c.req.param("seq")), (await body(c)).choice, config.publicUrl) }); }
    catch (e) { if (e instanceof PageLossRefused) return no(c, e.status, e.message); throw e; }
  });
  api.get("/design-journal", (c) => { c.header("Cache-Control", "private, no-store"); return c.json({ decisions: designJournal.list(c.get("user").id) }); });
  api.post("/design-journal", async (c) => {
    try { return c.json({ decision: designJournal.add(c.get("user").id, await body(c), { kind: "user" }) }); }
    catch (e) { if (e instanceof DesignJournalError) return no(c, 400, e.message); throw e; }
  });
  api.delete("/design-journal/:id", (c) => (designJournal.remove(c.get("user").id, c.req.param("id")) ? c.json({ ok: true }) : no(c, 404, "That decision does not exist.")));
}
