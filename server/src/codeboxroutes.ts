import type { Context, Hono } from "hono";
import { answerCode } from "./agent/codebox.js";
import { fail } from "./routeinput.js";
import { tr } from "./i18n.js";
import { rows, type BotRecord, type UserRecord } from "./store.js";

type E = { Variables: { user: UserRecord } };

/**
 * L91 — the answer on a hidden code card (agent/codebox.ts): POST { code } types it into the page's field (the code
 * goes straight to the waiting tool, never stored nor logged), POST { dismiss: true } says "I don't have it". A card
 * nothing waits on any more (a restart) is closed as stopped.
 */
export function registerCodeBoxRoutes(api: Hono<E>, ownAgent: (c: Context<E>) => BotRecord) {
  api.post("/bots/:id/code/:codeId", async (c) => {
    const bot = ownAgent(c);
    const locale = c.get("user").locale;
    const id = c.req.param("codeId");
    const row = rows.all(bot.id, bot.generation).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "code" && r.body.card.codeId === id);
    if (!row) return fail(404, tr(locale, "That request no longer exists."));
    const b = (await c.req.json().catch(() => ({}))) as { code?: unknown; dismiss?: unknown };
    const r = answerCode(bot.id, id, b);
    if (r === "bad") return fail(400, tr(locale, "A code has 1 to 16 letters, digits, spaces or dashes."));
    if (r === "gone") {
      rows.updateCard(bot, row.generation, row.seq, (k) => (k.type === "code" && k.status === "pending" ? { ...k, status: "stopped" } : k));
      return fail(409, tr(locale, "The bot no longer waits for this code (it was stopped or restarted). Ask it again if it still needs one."));
    }
    return c.json({ ok: true });
  });
}
