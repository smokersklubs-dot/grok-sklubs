import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { q } from "./db.js";
import { now, randomToken, sha256, users, type UserRecord } from "./store.js";

export const SESSION_COOKIE = "sklubot_session";
const SESSION_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

/** Only a hash of the session token is stored, so a database leak does not hand out live sessions. */
export function createSession(userId: string): { token: string; maxAgeSec: number } {
  const token = randomToken(32);
  q.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, now(), now() + SESSION_MS);
  return { token, maxAgeSec: SESSION_MS / 1000 };
}

export function userForToken(token: string | undefined): UserRecord | null {
  if (!token) return null;
  const s = q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", sha256(token));
  if (!s || s.expires_at < now()) return null;
  return users.byId(s.user_id);
}

export function dropSession(token: string | undefined) {
  if (token) q.run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export const signupOpen = () => config.openSignup || users.count() === 0;

// Connector tokens are encrypted at rest with a key derived from SESSION_SECRET.
const key = () => createHash("sha256").update("connector-tokens:" + config.sessionSecret).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
