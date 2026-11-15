import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { attachmentAt, readLibraryFile } from "./computer.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import type { PublicLink } from "./shared.js";
import { audit, bots, clip, newId, now } from "./store.js";
import type { BuiltinTool } from "./agent/tools.js";

/**
 * Wave 7 (spec 08 A8) — a temporary public address for one file of a bot's library, for a generation service (video,
 * voice, image) that only takes a public URL for a reference picture or clip.
 *
 * The address is /l/<id>.<signature>: a random id and an HMAC of it with its expiry (keyed by SESSION_SECRET), so it is
 * not guessable and cannot be stretched; only a hash of the token is stored. One file each, images, audio or video only,
 * 50 MB at most, one hour by default and one day at most, revocable at any time (Settings → Pages), and every creation,
 * download and removal is audited. The file is read through the library guard (no link or special file is ever served).
 * HEAD answers like GET without the body, for services that check the address first. Creating one after the turn read
 * outside content asks first.
 */

export const LINK_TYPES = /^(image|audio|video)\//;
export const MAX_LINK_BYTES = 50_000_000;
export const DEFAULT_LINK_MIN = 60;
export const MAX_LINK_MIN = 24 * 60;
const sign = (id: string, expires: number) => createHmac("sha256", config.sessionSecret || "dev").update(`public-link|${id}|${expires}`).digest("base64url").slice(0, 32);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const toLink = (r: any): PublicLink => ({ id: r.id, botId: r.bot_id, botName: bots.byId(r.bot_id)?.name ?? "", path: r.path, mime: r.mime, size: r.size, expiresAt: r.expires_at, revokedAt: r.revoked_at ?? null, createdAt: r.created_at, downloads: r.downloads });

export const publicLinks = {
  create(userId: string, botId: string, path: string, minutes = DEFAULT_LINK_MIN): PublicLink {
    const att = attachmentAt(botId, path);
    if (!att) throw new Error(`There is no file at ${path} in the library.`);
    if (!LINK_TYPES.test(att.mime)) throw new Error("Only pictures, audio and video can get a public link.");
    if (att.size > MAX_LINK_BYTES) throw new Error("That file is too large for a public link (50 MB at most).");
    // Read once through the library guard: a link or special file is refused here, before any address exists.
    readLibraryFile(botId, att.path);
    const id = newId("lnk").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20) + randomBytes(6).toString("hex");
    const expires = now() + Math.min(MAX_LINK_MIN, Math.max(1, Math.round(minutes))) * 60_000;
    const token = `${id}.${sign(id, expires)}`;
    q.run("INSERT INTO public_links (id, user_id, bot_id, path, mime, size, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, userId, botId, att.path, att.mime, att.size, hashToken(token), expires, now());
    audit(userId, "tool", `${bots.byId(botId)?.name ?? "?"}: temporary public link for ${att.path} (${Math.round((expires - now()) / 60_000)} min)`, botId);
    emit(userId, { type: "publicLinks" });
    return { ...toLink(q.get("SELECT * FROM public_links WHERE id = ?", id)), url: `${config.publicUrl}/l/${token}` };
  },
  list: (userId: string) => q.all("SELECT * FROM public_links WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC", userId, now()).map(toLink),
  revoke(userId: string, id: string): boolean {
    const r = q.get<{ path: string; bot_id: string }>("SELECT path, bot_id FROM public_links WHERE id = ? AND user_id = ? AND revoked_at IS NULL", id, userId);
    if (!r) return false;
    q.run("UPDATE public_links SET revoked_at = ? WHERE id = ?", now(), id);
    audit(userId, "tool", `Temporary public link removed: ${r.path}`, r.bot_id);
    emit(userId, { type: "publicLinks" });
    return true;
  },
};

/** GET or HEAD /l/:token — the file while the link is valid, else 404/410. */
export function servePublicLink(c: Context): Response {
  const token = c.req.param("token") ?? "";
  const [id, sig] = token.split(".");
  const notFound = () => new Response("This link does not exist or is no longer shared.", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (!id || !sig || !/^[a-zA-Z0-9]{8,64}$/.test(id)) return notFound();
  const r = q.get<any>("SELECT * FROM public_links WHERE id = ? AND token_hash = ?", id, hashToken(token));
  if (!r) return notFound();
  const want = Buffer.from(sign(id, r.expires_at)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return notFound();
  if (r.revoked_at || r.expires_at <= now()) return new Response("This link has expired. Ask for a new one.", { status: 410, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  let data: Buffer;
  try { data = readLibraryFile(r.bot_id, r.path); } catch { return notFound(); }
  const head = c.req.method === "HEAD";
  if (!head) {
    q.run("UPDATE public_links SET downloads = downloads + 1 WHERE id = ?", id);
    audit(r.user_id, "tool", `Temporary public link downloaded: ${clip(r.path, 120)}`, r.bot_id);
  }
  return new Response(head ? null : new Uint8Array(data), {
    status: 200,
    headers: { "content-type": r.mime, "content-length": String(data.length), "cache-control": "no-store", "x-robots-tag": "noindex", "x-content-type-options": "nosniff", "content-disposition": "inline", "referrer-policy": "no-referrer" },
  });
}

const libraryPath = (p: string) => p.trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "");

export const publicLinkTools: BuiltinTool[] = [{
  spec: {
    name: "file_public_link",
    description: "Give one picture, audio or video file of your library a temporary public address (1 hour by default, 24 hours at most), for a service that needs the public URL of a reference file (e.g. a video generator). The user can remove it at any time. Never use it to share anything else.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Path of the file in your library" }, minutes: { type: "integer", description: "How long it stays valid (default 60, max 1440)" } }, required: ["path"] },
  },
  activity: "saving", label: "Publishing a temporary link", group: "files", audited: true, detail: (a) => clip(String(a.path ?? ""), 60),
  // After outside content, a page or an email could be trying to make the bot publish a file: ask first.
  gate: (a, ctx) => (ctx.tainted ? { key: `public link: ${ctx.botId}`, strict: true, once: true, source: "Library", title: "{bot} has read outside content. Allow it to give {path} a temporary public address?", reason: "publish a file at a public address", vars: { path: clip(String(a.path ?? ""), 120) }, note: "Anyone with the address can download this file until it expires or you remove it (Settings → Pages)." } : null),
  run: async (a, c) => {
    try {
      const link = publicLinks.create(c.user.id, c.bot.id, libraryPath(String(a.path ?? "")), Number(a.minutes) || DEFAULT_LINK_MIN);
      const mins = Math.round((link.expiresAt - Date.now()) / 60_000);
      return { content: `Public address (valid ${mins} min, then removed): ${link.url}\nIf a long generation fails because the link expired, make a new one.`, summary: `${link.path} · ${mins} min` };
    } catch (err) { return { content: (err as Error).message, isError: true }; }
  },
}];
