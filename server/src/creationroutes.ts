/**
 * L158 « Créations » (agent/creations.ts): the owner's own routes for a creation's trajectory — the list of a bot's
 * creations, one creation with all its renders, and one render's preview. Same rules as the library (routes.ts
 * /bots/:id/files/view): the owner's own bot only; images and videos are served inline with a sandboxing CSP; any other
 * file is a download, never a page; a page render goes to the existing owner-only page version address.
 */
import { closeSync, createReadStream, openSync, fstatSync, constants as FS } from "node:fs"; import { tr } from "./i18n.js";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import { creations, showTrajectory, trajectoryCard } from "./agent/creations.js";
import { craftUpdate, ownerResolves, setBudget } from "./agent/creationplus.js";
import { isInlineImage, isInlineVideo, mimeOf } from "./computer.js";
import type { BotRecord, UserRecord } from "./store.js";

export function registerCreationRoutes(api: Hono<any>, ownBot: (c: Context) => BotRecord) {
  api.get("/bots/:id/creations", (c) => {
    const bot = ownBot(c);
    return c.json({ creations: creations.list(bot.id).map((x) => trajectoryCard(x)) });
  });
  api.get("/bots/:id/creations/:cid", (c) => {
    const bot = ownBot(c);
    const found = creations.get(bot.id, c.req.param("cid"));
    if (!found) return c.json({ error: tr((c.get("user") as UserRecord).locale, "That creation does not exist.") }, 404);
    const card = trajectoryCard(found);
    // Every render, not only the latest ones the card shows (the compare can pick any two).
    return c.json({ ...card, all: creations.renders(found.id).map((r) => ({ id: r.id, n: r.n, stage: r.stage, kind: r.kind, name: r.name, note: r.note, at: r.created_at, bytes: r.bytes, unchanged: !!r.unchanged, preview: !!r.copy || (r.kind === "page" && r.page_version != null) })) });
  });
  // L158 (agent/creationplus.ts): the owner's budget for a creation, ticking an open question off, a newer Craft Anything.
  const refresh = (bot: BotRecord, id: string) => {
    const found = creations.get(bot.id, id)!;
    const card = trajectoryCard(found);
    if (found.seq != null && found.generation === bot.generation) showTrajectory(bot, found, card);
    return card;
  };
  api.put("/bots/:id/creations/:cid/budget", async (c) => {
    const bot = ownBot(c);
    const found = creations.get(bot.id, c.req.param("cid"));
    if (!found) return c.json({ error: tr((c.get("user") as UserRecord).locale, "That creation does not exist.") }, 404);
    const body = await c.req.json().catch(() => ({})) as { usd?: unknown };
    try { setBudget(found.id, body.usd); } catch { return c.json({ error: tr((c.get("user") as UserRecord).locale, "Give an amount between $0.01 and $10,000.") }, 400); }
    return c.json(refresh(bot, found.id));
  });
  api.post("/bots/:id/creations/:cid/questions/:qid/resolve", (c) => {
    const bot = ownBot(c);
    const found = creations.get(bot.id, c.req.param("cid"));
    if (!found || !ownerResolves(found.id, Number(c.req.param("qid")))) return c.json({ error: tr((c.get("user") as UserRecord).locale, "That question is no longer open.") }, 404);
    return c.json(refresh(bot, found.id));
  });
  api.get("/bots/:id/craft-update", async (c) => { ownBot(c); return c.json({ update: await craftUpdate() }); });
  api.get("/bots/:id/creations/:cid/renders/:rid", (c) => {
    const bot = ownBot(c);
    const found = creations.get(bot.id, c.req.param("cid"));
    const r = found ? creations.render(found.id, Number(c.req.param("rid"))) : null;
    const missing = () => c.json({ error: tr((c.get("user") as UserRecord).locale, "This render has no preview.") }, 404);
    if (!r) return missing();
    if (r.kind === "page") return r.page_token && r.page_version != null ? c.redirect(`/api/pages/${encodeURIComponent(r.page_token)}/versions/${r.page_version}/view`, 302) : missing();
    const full = creations.copyPath(bot.id, r);
    if (!full) return missing();
    let fd: number;
    try { fd = openSync(full, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0)); } catch { return missing(); }
    let size: number;
    try { const st = fstatSync(fd); if (!st.isFile()) throw new Error("not a file"); size = st.size; } catch { closeSync(fd); return missing(); }
    const mime = mimeOf(r.name);
    const inline = isInlineImage(mime) || isInlineVideo(mime);
    const name = path.basename(r.name).replace(/[^\w. -]/g, "_");
    return c.body(Readable.toWeb(createReadStream(full, { fd })) as unknown as ReadableStream, 200, {
      "content-type": inline ? mime : "application/octet-stream", "content-length": String(size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=3600",
    });
  });
}
