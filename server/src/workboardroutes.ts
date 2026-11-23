/**
 * « Tableau de travail » (L163) — the routes, behind the session like every /api route. Only the owner sees or touches
 * their board: another account's card reads as missing (404).
 *
 *  GET    /board?ideas=200                      { tasks, ideas }  (ideas: 200 by default, 1000 at most)
 *  POST   /board/tasks { title, description?, botId?, priority?, startAt?, deps?, acceptance?, chantierId? } → { task, warning }
 *  PATCH  /board/tasks/:id { same fields }       → { task, warning }
 *  DELETE /board/tasks/:id                       refused (409, naming them) while tasks wait on it or it is under way
 *  POST   /board/tasks/launch { ids: [] }        « Lancer » (several = one batch: one grouped recap for the main bot)
 *  POST   /board/tasks/:id/stop | /accept | /reject { note }
 *  POST   /board/tasks/:id/files                 raw body, header x-filename (15 MB; type checked on its content)
 *  GET    /board/tasks/:id/files/:fid            the file (download)
 *  DELETE /board/tasks/:id/files/:fid
 *  POST   /board/ideas { title, body?, urgency? } · PATCH /board/ideas/:id · DELETE /board/ideas/:id
 *  POST   /board/ideas/:id/files · GET /board/ideas/:id/files/:fid
 *  POST   /board/ideas/:id/promote { botId?, priority?, … }   once; a second time: 409 naming the task
 *  POST   /board/ideas/:id/send                  « Envoyer au chef »: the idea goes to the main bot to discuss it first
 */
import type { Context, Hono } from "hono";
import { submitUserMessage } from "./agent/loop.js";
import { bots, clip, type UserRecord } from "./store.js";
import { board, BoardError, ideas, IDEAS_PAGE, MAX_FILE_BYTES } from "./workboard.js";
import { wt } from "./worki18n.js";

type Env = { Variables: { user: UserRecord } };
const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, any>;

function guard(c: Context<Env>, fn: () => Response | Promise<Response>) {
  return Promise.resolve().then(fn).catch((e) => {
    if (e instanceof BoardError) return c.json({ error: wt(c.get("user").locale, e.message, Object.fromEntries(Object.entries(e.vars).map(([k, v]) => [k, typeof v === "string" ? wt(c.get("user").locale, v) : v]))) }, e.status);
    throw e;
  });
}

async function rawFile(c: Context<Env>): Promise<{ name: string; bytes: Buffer }> {
  const name = decodeURIComponent(c.req.header("x-filename") ?? c.req.query("name") ?? "");
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_FILE_BYTES + 1024) throw new BoardError(413, "“{name}” was not added: {why}.", { name: clip(name, 120) || "?", why: "the file is larger than 15 MB" });
  return { name, bytes: Buffer.from(await c.req.arrayBuffer()) };
}
const sendFile = (c: Context, f: { file: { name: string; type: string }; bytes: Buffer } | null) => {
  if (!f) return c.json({ error: "Not found" }, 404);
  return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.file.type, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.file.name)}`, "x-content-type-options": "nosniff" } });
};

export function registerBoardRoutes(api: Hono<Env>) {
  const uid = (c: Context<Env>) => c.get("user").id;
  api.get("/board", (c) => guard(c, () => c.json(board.view(uid(c), Number(c.req.query("ideas") ?? IDEAS_PAGE) || IDEAS_PAGE))));
  api.post("/board/tasks", (c) => guard(c, async () => c.json(board.create(uid(c), await body(c)))));
  api.post("/board/tasks/launch", (c) => guard(c, async () => { const b = await body(c); return c.json({ tasks: board.launch(uid(c), Array.isArray(b.ids) ? b.ids.map(String).slice(0, 50) : []) }); }));
  api.patch("/board/tasks/:id", (c) => guard(c, async () => c.json(board.update(uid(c), c.req.param("id"), await body(c)))));
  api.delete("/board/tasks/:id", (c) => guard(c, () => { board.remove(uid(c), c.req.param("id")); return c.json({ ok: true }); }));
  api.post("/board/tasks/:id/stop", (c) => guard(c, () => c.json({ task: board.stop(uid(c), c.req.param("id")) })));
  api.post("/board/tasks/:id/accept", (c) => guard(c, () => c.json({ task: board.accept(uid(c), c.req.param("id")) })));
  api.post("/board/tasks/:id/reject", (c) => guard(c, async () => c.json({ task: board.reject(uid(c), c.req.param("id"), String((await body(c)).note ?? "")) })));
  api.post("/board/tasks/:id/files", (c) => guard(c, async () => { const f = await rawFile(c); return c.json({ file: board.addFile(uid(c), c.req.param("id"), f.name, f.bytes) }); }));
  api.get("/board/tasks/:id/files/:fid", (c) => sendFile(c, board.fileBytes(uid(c), "task", c.req.param("id"), c.req.param("fid"))));
  api.delete("/board/tasks/:id/files/:fid", (c) => guard(c, () => { board.removeFile(uid(c), c.req.param("id"), c.req.param("fid")); return c.json({ ok: true }); }));

  api.post("/board/ideas", (c) => guard(c, async () => c.json({ idea: ideas.create(uid(c), await body(c)) })));
  api.patch("/board/ideas/:id", (c) => guard(c, async () => c.json({ idea: ideas.update(uid(c), c.req.param("id"), await body(c)) })));
  api.delete("/board/ideas/:id", (c) => guard(c, () => { ideas.remove(uid(c), c.req.param("id")); return c.json({ ok: true }); }));
  api.post("/board/ideas/:id/files", (c) => guard(c, async () => { const f = await rawFile(c); return c.json({ file: ideas.addFile(uid(c), c.req.param("id"), f.name, f.bytes) }); }));
  api.get("/board/ideas/:id/files/:fid", (c) => sendFile(c, board.fileBytes(uid(c), "idea", c.req.param("id"), c.req.param("fid"))));
  api.post("/board/ideas/:id/promote", (c) => guard(c, async () => c.json(ideas.promote(uid(c), c.req.param("id"), await body(c)))));
  api.post("/board/ideas/:id/send", (c) => guard(c, () => {
    const user = c.get("user");
    const i = ideas.get(user.id, c.req.param("id"));
    if (!i) throw new BoardError(404, "That idea does not exist.");
    const main = bots.primary(user.id);
    if (!main) throw new BoardError(409, "You have no main bot to send it to.");
    // The owner's own click: the idea goes to the main bot as the owner's message (it discusses it; nothing is created).
    submitUserMessage(main, wt(user.locale, "Idea #{n} sent by the board: “{title}”.\n\n{body}\n\nDiscuss it with me before creating any task.", { n: i.number, title: i.title, body: clip(i.body, 4000) || "—" }));
    if (i.progress === "todo") ideas.update(user.id, i.id, { progress: "analysed" });
    return c.json({ ok: true, botId: main.id });
  }));
}
