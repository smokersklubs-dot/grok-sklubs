import type { Context, Hono } from "hono";
import { closeSync, readFileSync } from "node:fs";
import { isBusy } from "./agent/loop.js";
import { setShortReplies, shortReplies } from "./shortreplies.js";
import { BOT_STYLES, botStyle, setBotStyle } from "./botstyle.js";
import { deletionPreview, forgetTrash, restoreFromTrash, trashList, TrashError } from "./bottrash.js";
import { emit } from "./bus.js";
import { openLibraryFile, readLibraryFile } from "./computer.js";
import { config } from "./config.js";
import { ConvError, foldersOf, listConversations, reopenConversation, RETENTION_DAYS, retentionDays, setRetentionDays, updateConversation } from "./convs.js";
import { bell, clearBell, markBellRead } from "./notifyrules.js";
import { OFFICE_EXT, OFFICE_LIMITS, OfficeError, officePreview } from "./officepreview.js";
import { a4Html, capturePage, CaptureError, lineDiff, standaloneHtml } from "./pageextras.js";
import { pageFiles, pageVersions, type PageFile } from "./pagefiles.js";
import { fail } from "./routeinput.js";
import { tr } from "./i18n.js";
import { bots, pages, publicBot, rows, type BotRecord, type UserRecord } from "./store.js";
import { exportBot, importBot, BotFileError } from "./botfile.js"; import { registerPageKeepRoutes } from "./pagekeeproutes.js"; import { registerModelPlusRoutes } from "./modelplusroutes.js"; // L157, L150

type E = { Variables: { user: UserRecord } };
const json = async (c: Context<E>) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
/** Refusals in the owner's language (French texts in comfort7i18n.ts). */
const no = (c: Context<E>, status: Parameters<typeof fail>[0], text: string): never => fail(status, tr(c.get("user").locale, text));
const guardIn = (c: Context<E>) => async <T>(run: () => T | Promise<T>): Promise<T> => {
  try { return await run(); } catch (err) {
    if (err instanceof ConvError || err instanceof TrashError || err instanceof CaptureError) return no(c, err.status, err.message);
    if (err instanceof OfficeError || err instanceof BotFileError) return no(c, 400, err.message);
    throw err;
  }
};

/**
 * Wave 7 comfort (backlog A-FAIRE): L144 trash / export / import, L146 conversations, L148 Office previews, L150 model
 * per conversation, L151 the bell, L157 page diff / standalone copy / A4 sheet / capture, L161 style and history
 * retention, L141 pin / delete a message. Owner only (ownBot / ownAgent), each account sees only its own things.
 */
export function registerChatComfortRoutes(api: Hono<E>, ownBot: (c: Context<E>) => BotRecord, ownAgent: (c: Context<E>) => BotRecord) {
  registerPageKeepRoutes(api, ownAgent); registerModelPlusRoutes(api); // L157 « rien de perdu », journal de design ; L150 presets per project, OpenRouter credit alert (modelplusroutes.ts)
  // ── L144: deletion preview, trash, export / import ──
  api.get("/bots/:id/deletion-preview", (c) => c.json(deletionPreview(ownBot(c))));
  api.get("/bot-trash", (c) => c.json({ items: trashList(c.get("user").id) }));
  api.post("/bot-trash/:trashId/restore", async (c) => {
    const user = c.get("user");
    const bot = await guardIn(c)(() => restoreFromTrash(user.id, c.req.param("trashId")));
    emit(user.id, { type: "roster" });
    return c.json({ bot: publicBot(bot) });
  });
  api.delete("/bot-trash/:trashId", (c) => (forgetTrash(c.get("user").id, c.req.param("trashId")) ? c.json({ ok: true }) : no(c, 404, "This bot is no longer in the trash.")));
  api.get("/bots/:id/export", (c) => {
    const bot = ownAgent(c);
    const name = bot.name.replace(/[^\w-]+/g, "-").slice(0, 40) || "bot";
    return c.body(JSON.stringify(exportBot(bot), null, 2), 200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${name}.sklubot-bot.json"`, "cache-control": "private, no-store" });
  });
  api.post("/bots/import", async (c) => {
    const user = c.get("user");
    const raw = await json(c);
    const bot = await guardIn(c)(() => importBot(user.id, raw));
    emit(user.id, { type: "roster" });
    return c.json({ bot: publicBot(bot) });
  });

  // ── L146 / L150: conversations of a bot ──
  api.get("/bots/:id/conversations", (c) => {
    const bot = ownBot(c);
    const a = c.req.query("automatic");
    return c.json({ conversations: listConversations(bot, { automatic: a === "1" ? true : a === "0" ? false : undefined, folder: c.req.query("folder") ?? undefined, q: c.req.query("q") ?? undefined }), folders: foldersOf(bot) });
  });
  api.patch("/bots/:id/conversations/:gen", async (c) => {
    const bot = ownBot(c);
    const b = await json(c);
    await guardIn(c)(() => updateConversation(bot, Number(c.req.param("gen")), b));
    return c.json({ conversations: listConversations(bot), folders: foldersOf(bot) });
  });
  api.post("/bots/:id/conversations/:gen/open", async (c) => {
    const bot = ownBot(c);
    const generation = await guardIn(c)(() => reopenConversation(bot, Number(c.req.param("gen")), isBusy(bot.id)));
    if (generation !== bot.generation) { emit(bot.userId, { type: "reset", botId: bot.id, generation }); bots.announce(bot); }
    return c.json({ generation });
  });

  // ── L151: the bell ──
  api.get("/bell", (c) => c.json(bell(c.get("user").id, Number(c.req.query("limit") ?? 50) || 50)));
  api.post("/bell/read", (c) => c.json({ read: markBellRead(c.get("user").id) }));
  api.delete("/bell", (c) => c.json({ removed: clearBell(c.get("user").id) }));

  // ── L161: style per bot, history retention ──
  api.get("/bots/:id/style", (c) => c.json({ style: botStyle(ownAgent(c).id), styles: BOT_STYLES }));
  api.put("/bots/:id/style", async (c) => {
    const bot = ownAgent(c);
    try { return c.json({ style: setBotStyle(bot.id, (await json(c)).style) }); } catch (err) { return no(c, 400, (err as Error).message); }
  });
  // L132 « Réponses courtes »: numbered rules and channels (shortreplies.ts)
  api.get("/bots/:id/short-replies", (c) => c.json(shortReplies(ownAgent(c).id)));
  api.put("/bots/:id/short-replies", async (c) => {
    const bot = ownAgent(c);
    try { return c.json(setShortReplies(bot.id, await json(c))); } catch (err) { return no(c, 400, (err as Error).message); }
  });
  api.get("/history-retention", (c) => c.json({ days: retentionDays(c.get("user").id), choices: RETENTION_DAYS }));
  api.put("/history-retention", async (c) => {
    const user = c.get("user");
    const days = Number((await json(c)).days);
    await guardIn(c)(() => setRetentionDays(user.id, days));
    return c.json({ days: retentionDays(user.id) });
  });

  // ── L141 (rest): pin / delete a message of the conversation ──
  api.post("/bots/:id/rows/:seq/pin", async (c) => {
    const bot = ownBot(c);
    const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
    if (!row || row.body.kind !== "message" || row.body.deleted) return no(c, 404, "That message does not exist.");
    const on = (await json(c)).on !== false;
    return c.json({ row: rows.rewrite(bot, bot.generation, row.seq, { ...row.body, pinned: on || undefined }) });
  });
  api.delete("/bots/:id/rows/:seq", (c) => {
    const bot = ownBot(c);
    const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
    if (!row || row.body.kind !== "message") return no(c, 404, "That message does not exist.");
    if (row.body.streaming) return no(c, 409, "Wait until this message is finished.");
    // Hidden from the conversation (and its exports and search); what the bot already read is not rewritten.
    return c.json({ row: rows.rewrite(bot, bot.generation, row.seq, { kind: "message", role: row.body.role, text: "", deleted: true }) });
  });

  // ── L148: Excel / Word / PowerPoint previews (read as data, never run) ──
  api.get("/bots/:id/files/office-preview", async (c) => {
    const bot = ownBot(c);
    const rel = c.req.query("path") ?? "";
    if (!OFFICE_EXT.test(rel)) return no(c, 400, "Only Word, Excel and PowerPoint files (.docx, .xlsx, .pptx) can be previewed.");
    let f: ReturnType<typeof openLibraryFile>;
    try { f = openLibraryFile(bot.id, rel); } catch { return no(c, 404, "That file does not exist."); }
    let buf: Buffer;
    try { if (f.size > OFFICE_LIMITS.fileBytes) return no(c, 413, "This file is too large to preview."); buf = readFileSync(f.fd); } finally { closeSync(f.fd); }
    c.header("Cache-Control", "private, no-store");
    return c.json(await guardIn(c)(() => officePreview(buf, rel.split(".").pop() ?? "")));
  });

  // ── L157: pages ──
  const mine = (c: Context<E>) => {
    const page = pages.byToken(c.req.param("token") ?? "", config.publicUrl);
    return page && page.userId === c.get("user").id ? page : no(c, 404, "That page does not exist.");
  };
  const snapshot = (c: Context<E>, page: NonNullable<ReturnType<typeof pages.byToken>>, id: string | undefined): { html: string; files: PageFile[] } => {
    if (id === undefined || id === "current") {
      let html: string | null = null;
      try { html = readLibraryFile(page.botId, page.path).toString("utf8"); } catch { /* gone */ }
      if (html === null) return no(c, 404, "That page does not exist.");
      return { html, files: pageFiles.list(page.botId, page.path) };
    }
    return pageVersions.get(page.botId, page.path, Number(id)) ?? no(c, 404, "That version does not exist.");
  };
  const fileName = (title: string) => title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  api.get("/pages/:token/diff", (c) => {
    const page = mine(c);
    const a = snapshot(c, page, c.req.query("from")), b = snapshot(c, page, c.req.query("to") ?? "current");
    const files = [...new Set([...a.files, ...b.files].map((f) => f.file))].map((name) => ({ name, ...lineDiff(a.files.find((f) => f.file === name)?.content ?? "", b.files.find((f) => f.file === name)?.content ?? "") })).filter((f) => f.added || f.removed);
    c.header("Cache-Control", "private, no-store");
    return c.json({ html: lineDiff(a.html, b.html), files });
  });
  api.get("/pages/:token/standalone", (c) => {
    const page = mine(c);
    const s = snapshot(c, page, c.req.query("version"));
    return c.body(standaloneHtml(s.html, s.files), 200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${fileName(page.title)}.html"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  });
  api.get("/pages/:token/a4", (c) => {
    const page = mine(c);
    const s = snapshot(c, page, c.req.query("version"));
    // Shown under the same sandbox rules as a published page: never with the app's own origin rights.
    return c.body(a4Html(s.html, s.files, tr(c.get("user").locale, "Save as PDF")), 200, {
      "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox allow-scripts allow-modals; default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline'",
    });
  });
  api.post("/pages/:token/capture", async (c) => {
    const page = mine(c);
    const b = await json(c);
    const s = snapshot(c, page, typeof b.version === "number" || typeof b.version === "string" ? String(b.version) : undefined);
    const png = await guardIn(c)(() => capturePage(s.html, s.files, { selector: typeof b.selector === "string" ? b.selector : "", width: Number(b.width) || 1280, dark: b.dark === true }));
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "content-disposition": `attachment; filename="${fileName(page.title)}.png"`, "cache-control": "private, no-store" });
  });
}
