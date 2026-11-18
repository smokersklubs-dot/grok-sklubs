import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { MAX_UPLOAD_BODY, PART_BYTES } from "./uploadlimits.js";
import { bodyLimit } from "hono/body-limit";

/**
 * Protections that apply to every request of the web server (review findings M3, M6, M7).
 */

// ── M7: request body sizes ───────────────────────────────────────────────────
const MB = 1024 * 1024;
/**
 * The largest body each kind of request may send. Every route reads its body whole (JSON, a form), so without a limit one
 * request could fill the server's memory. The larger ones match what those routes already accept (they still check
 * their own, smaller, limits): uploads in 8 MB parts or 96 MB legacy requests (+ form overhead), project import (a .env and a 5 MB zip as base64),
 * vault import 5 MB, the credential relay 20 MB (egress.ts MAX_BODY), the tool endpoint of subscription bots (a file
 * written through it). Everything else is JSON: 1 MB.
 */
export const BODY_LIMITS: { test: RegExp; max: number }[] = [
  { test: /^\/api\/bots\/[^/]+\/uploads$/, max: MAX_UPLOAD_BODY },
  { test: /^\/api\/bots\/[^/]+\/uploads\/[0-9a-f-]{36}$/, max: PART_BYTES },
  { test: /^\/api\/import\/project\/(preview|commit)$/, max: 8 * MB },
  { test: /^\/api\/vault\/import$/, max: 5 * MB },
  { test: /^\/egress\//, max: 21 * MB },
  { test: /^\/mcp\//, max: 21 * MB },
  { test: /^\/api\/hooks\//, max: 256 * 1024 },
  // The Bot API (botapi.ts): a message or an objective (20,000 characters), an MCP request.
  { test: /^\/api\/v1\//, max: 256 * 1024 },
];
export const DEFAULT_BODY_LIMIT = 1 * MB;
export const bodyLimitFor = (path: string) => BODY_LIMITS.find((l) => l.test.test(path))?.max ?? DEFAULT_BODY_LIMIT;

const limiters = new Map<number, MiddlewareHandler>();
const limiter = (max: number) => {
  let l = limiters.get(max);
  if (!l) limiters.set(max, (l = bodyLimit({ maxSize: max, onError: (c) => c.json({ error: `Request too large (${Math.round(max / MB) || "<1"} MB at most).` }, 413) })));
  return l;
};
/** Hono middleware: refuses a body over the limit of its route with 413, before any handler reads it. */
export const limitBodies: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  // This endpoint counts every byte as it reads, after authenticating the owner.
  // Avoid buffering chunked uploads here and again in the file handler.
  const max = bodyLimitFor(c.req.path);
  if ((max === MAX_UPLOAD_BODY || max === PART_BYTES && /\/uploads\//.test(c.req.path)) && c.req.method === "POST") {
    if (Number(c.req.header("content-length")) > max) return c.json({ error: "Upload request too large." }, 413);
    return next();
  }
  return limiter(max)(c, next);
};

// ── M3: security headers ─────────────────────────────────────────────────────
/** sha256 hashes of the inline <script> blocks of the built index page (the theme and language set before the app loads). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) out.push(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  return out;
}

/**
 * The app's Content-Security-Policy. Scripts: our own files and the inline start-up script of index.html (by hash).
 * Styles: 'unsafe-inline' stays, as React and the 3D/terminal views set style attributes; styles cannot run code.
 * Pictures: ours, data: and blob: only — a picture of another site in a message becomes a link (web/src/lib/markdown.ts).
 * Connections: this server (EventSource, fetch) and wss: (live screens, voice). PDF previews are shown from a blob: in an
 * iframe. Nothing may frame the app, no plugin content, no <base>.
 */
export function appCsp(scriptHashes: string[] = [], o: { turnstile?: boolean } = {}): string {
  // Cloudflare Turnstile on the sign-up form (publicsignup.ts), only when it is configured: its script and its frame come
  // from https://challenges.cloudflare.com (https://developers.cloudflare.com/turnstile/reference/content-security-policy/).
  const cf = o.turnstile ? " https://challenges.cloudflare.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim() + cf,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' wss:",
    "worker-src 'self' blob:",
    `frame-src 'self' blob:${cf}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Adds the security headers to every response that has not set its own (published pages, the privacy page and the
 * sign-in pages keep their stricter or different policies).
 */
export function securityHeaders(csp: string): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    if (!h.has("content-security-policy")) h.set("content-security-policy", csp);
    if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
    if (!h.has("referrer-policy")) h.set("referrer-policy", "same-origin");
    if (!h.has("x-frame-options")) h.set("x-frame-options", "DENY");
  };
}

// ── M6: a fresh public install without a setup code ──────────────────────────
const LOCAL = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;
/**
 * Whether the server must refuse to start: no account exists yet, no SETUP_CODE is set, and PUBLIC_URL is not this
 * machine — the first stranger to open the address would become the owner. An install that already has accounts always
 * starts (production keeps working); so does any local one (development, tests).
 */
export function openSetupProblem(o: { users: number; setupCode: string; publicUrl: string }): string | null {
  if (o.users > 0 || o.setupCode.trim() || LOCAL.test(o.publicUrl.replace(/\/$/, ""))) return null;
  return `No account exists yet and SETUP_CODE is empty, while PUBLIC_URL (${o.publicUrl}) is reachable by others: the first visitor would become the owner of this server. Set SETUP_CODE (e.g. openssl rand -hex 8) and restart, then give that code when creating the first account.`;
}

// ── L7: a simple fixed-window rate limit ─────────────────────────────────────
/**
 * Counts hits per key in fixed windows; true when this hit is over `limit` in the current window. The table is bounded
 * (oldest keys dropped first), so a flood of made-up keys cannot grow it without end.
 */
export class RateWindow {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(readonly limit: number, readonly windowMs: number, readonly maxKeys = 10_000) {}
  over(key: string, at = Date.now()): boolean {
    const cur = this.hits.get(key);
    const next = cur && cur.until > at ? { n: cur.n + 1, until: cur.until } : { n: 1, until: at + this.windowMs };
    this.hits.delete(key);
    this.hits.set(key, next);
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return next.n > this.limit;
  }
}
/** Webhooks (/api/hooks/:token): per client address (guessing tokens), and per hook (each call starts a bot turn). */
export const hookLimits = { perAddress: new RateWindow(60, 60_000), perHook: new RateWindow(20, 60_000) };
