import type { Context, Hono } from "hono";
import { startPeerReview, peerReviewStatus } from "./peerreviewstore.js";
import { fileDiff, listedPathOk } from "./snapshots.js";
import { bots, type BotRecord } from "./store.js";
import type { Card, Row } from "./shared.js";
export function registerPeerReview(
  api: Hono<any>,
  filesCard: (c: Context<any>) => { bot: BotRecord; row: Row; card: Extract<Card, { type: "files" }> },
  throttle: (key: string, limit: number) => void,
) {
  api.get("/bots/:id/cards/:seq/files/diff", async (c) => {
    const { bot, card } = filesCard(c);
    const path = c.req.query("path") ?? "";
    const f = card.files.find((x) => x.path === path);
    if (!f || !listedPathOk(path)) return c.json({ error: "That file is not on this card." }, 400);
    if (f!.binary) return c.json({ diff: "", truncated: false, binary: true });
    const d = await fileDiff(bot, card, path);
    if (!d) return c.json({ error: "The snapshot of this turn is no longer kept." }, 409);
    return c.json({ ...d, binary: false });
  });
  api.get("/bots/:id/cards/:seq/files/review", (c) => {
    const { bot, row } = filesCard(c);
    return c.json(peerReviewStatus(bot, row.seq), 200, { "cache-control": "no-store" });
  });
  api.post("/bots/:id/cards/:seq/files/review", async (c) => {
    const { bot, row, card } = filesCard(c);
    const b = await c.req.json().catch(() => ({})),
      user = c.get("user");
    const reviewer = typeof b.reviewer === "string" && bots.owned(user.id, b.reviewer);
    if (!reviewer) return c.notFound();
    throttle("peer-review:" + user.id, 12);
    try {
      return c.json(startPeerReview(bot, reviewer, row, card, user.locale), 202);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Relecture indisponible." }, 409);
    }
  });
}
