/**
 * The data key: what seals every secret Sklubot keeps in its database (connector tokens, vault, backup keys, two-factor
 * seeds…). AES-256-GCM (NIST SP 800-38D), 12-byte IV, full 16-byte tag.
 *
 * Keyring (newest first):
 *   DATA_KEYS="k2:<key>,k1:<key>"   each key is 32 bytes, written as 64 hex characters or base64 / base64url
 *                                   (`openssl rand -base64 32`). An entry without "id:" gets an id made from the key's
 *                                   fingerprint ("k" + 8 hex characters), so it stays the same wherever it is written.
 *   DATA_KEY="<key>"                shorthand for a keyring of one key (id from its fingerprint, as above).
 *   (neither)                       the key derived from SESSION_SECRET, id "s0" — what every Sklubot used before, so an
 *                                   existing install keeps working without doing anything.
 * The derived key "s0" stays readable as long as SESSION_SECRET is unchanged, whatever DATA_KEYS says: values sealed
 * before a dedicated key was set can always be opened, and `rotatekey` moves them under the new key.
 *
 * Envelope:
 *   v2:<id>:<iv>.<tag>.<body>       base64 parts; the "v2:<id>" prefix is also the GCM additional data, so a value
 *                                   cannot be relabelled with another key's id.
 *   <iv>.<tag>.<body>               (no prefix) a value sealed by an older Sklubot: read with the derived key "s0".
 * New values are always sealed under the newest key of the keyring.
 *
 * A value that cannot be opened (its key is no longer in the keyring, the wrong key, a damaged value) gives null — never
 * an exception — and one clear line in the server log per key and reason.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

export const LEGACY_KEY_ID = "s0";
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const V2 = /^v2:([A-Za-z0-9_-]{1,16}):(.*)$/s;

export interface DataKey { id: string; key: Buffer; source: "DATA_KEYS" | "DATA_KEY" | "SESSION_SECRET" }
export interface Keyring { current: DataKey; keys: DataKey[] }

export class DataKeyError extends Error {}

/** 64 hex characters, or base64 / base64url of exactly 32 bytes. */
function parseKey(raw: string, where: string): Buffer {
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, "hex") : /^[A-Za-z0-9+/_-]+={0,2}$/.test(s) ? Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64") : Buffer.alloc(0);
  if (buf.length !== 32) throw new DataKeyError(`${where}: a data key must be 32 bytes, written as 64 hex characters or in base64. Generate one with: openssl rand -base64 32`);
  return buf;
}
const fingerprintId = (key: Buffer) => `k${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
const legacyKey = (secret: string): DataKey => ({ id: LEGACY_KEY_ID, key: createHash("sha256").update("connector-tokens:" + secret).digest(), source: "SESSION_SECRET" });

/** Reads a keyring from the environment's values. Throws a plain-language DataKeyError when one is malformed. */
export function parseKeyring(env: { DATA_KEYS?: string; DATA_KEY?: string }, sessionSecret: string): Keyring {
  const listed: DataKey[] = [];
  const many = (env.DATA_KEYS ?? "").trim();
  const one = (env.DATA_KEY ?? "").trim();
  if (many) {
    for (const [i, entry] of many.split(",").map((e) => e.trim()).filter(Boolean).entries()) {
      const colon = entry.indexOf(":");
      const id = colon > 0 ? entry.slice(0, colon).trim() : "";
      const key = parseKey(colon > 0 ? entry.slice(colon + 1) : entry, `DATA_KEYS (entry ${i + 1})`);
      const finalId = id || fingerprintId(key);
      if (!ID_RE.test(finalId)) throw new DataKeyError(`DATA_KEYS (entry ${i + 1}): a key id may only use letters, digits, "-" and "_" (16 at most).`);
      if (finalId === LEGACY_KEY_ID) throw new DataKeyError(`DATA_KEYS: the id "${LEGACY_KEY_ID}" is reserved for the key derived from SESSION_SECRET.`);
      if (listed.some((k) => k.id === finalId)) throw new DataKeyError(`DATA_KEYS: the id "${finalId}" is used twice.`);
      listed.push({ id: finalId, key, source: "DATA_KEYS" });
    }
  } else if (one) {
    const key = parseKey(one, "DATA_KEY");
    listed.push({ id: fingerprintId(key), key, source: "DATA_KEY" });
  }
  const keys = sessionSecret ? [...listed, legacyKey(sessionSecret)] : listed;
  if (!keys.length) throw new DataKeyError("No data key: set SESSION_SECRET (or DATA_KEYS).");
  return { current: keys[0], keys };
}

let cache: { sig: string; ring: Keyring } | null = null;
/** The keyring of the running server (read again whenever the variables change, which only tests do). */
export function keyring(): Keyring {
  const sig = `${process.env.DATA_KEYS ?? ""}\0${process.env.DATA_KEY ?? ""}\0${config.sessionSecret}`;
  if (cache?.sig !== sig) cache = { sig, ring: parseKeyring(process.env, config.sessionSecret) };
  return cache.ring;
}

/** Checked at start-up (index.ts): a malformed DATA_KEYS stops the server with the reason, before anything is sealed. */
export function checkDataKeys(): { current: string; ids: string[] } {
  const r = keyring();
  return { current: r.current.id, ids: r.keys.map((k) => k.id) };
}

const aad = (id: string) => Buffer.from(`sklubot-seal:v2:${id}`, "utf8");

export function sealWith(k: DataKey, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.key, iv, { authTagLength: 16 });
  cipher.setAAD(aad(k.id));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v2:${k.id}:${[iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".")}`;
}

export function sealValue(plain: string): string {
  return sealWith(keyring().current, plain);
}

export type OpenFailure = "unknown-key" | "wrong-key" | "malformed";
export type Opened = { ok: true; value: string; keyId: string } | { ok: false; reason: OpenFailure; keyId: string | null };

function decrypt(key: Buffer, parts: string, additional: Buffer | null): string | null {
  try {
    const [iv, tag, body, extra] = parts.split(".");
    if (iv === undefined || tag === undefined || body === undefined || extra !== undefined) return null;
    const ivb = Buffer.from(iv, "base64"), tagb = Buffer.from(tag, "base64");
    // authTagLength: a shortened tag (which GCM would otherwise accept, down to 4 bytes) is refused.
    if (tagb.length !== 16 || ivb.length < 12) return null;
    const d = createDecipheriv("aes-256-gcm", key, ivb, { authTagLength: 16 });
    if (additional) d.setAAD(additional);
    d.setAuthTag(tagb);
    return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

/** Opens a sealed value and says why when it cannot. Never throws. */
export function openValue(sealed: string, ring: Keyring = keyring()): Opened {
  if (typeof sealed !== "string" || !sealed) return { ok: false, reason: "malformed", keyId: null };
  const m = V2.exec(sealed);
  if (m) {
    const k = ring.keys.find((x) => x.id === m[1]);
    if (!k) return { ok: false, reason: "unknown-key", keyId: m[1] };
    const value = decrypt(k.key, m[2], aad(k.id));
    return value === null ? { ok: false, reason: "wrong-key", keyId: k.id } : { ok: true, value, keyId: k.id };
  }
  if (sealed.split(".").length !== 3) return { ok: false, reason: "malformed", keyId: null };
  // A value from before the keyring: only ever sealed with the key derived from SESSION_SECRET, no additional data.
  const legacy = ring.keys.find((x) => x.id === LEGACY_KEY_ID);
  if (!legacy) return { ok: false, reason: "unknown-key", keyId: LEGACY_KEY_ID };
  const value = decrypt(legacy.key, sealed, null);
  return value === null ? { ok: false, reason: "wrong-key", keyId: LEGACY_KEY_ID } : { ok: true, value, keyId: LEGACY_KEY_ID };
}

/** The key id a sealed value names ("s0" for an unprefixed one), without opening it. */
export function keyIdOf(sealed: string): string | null {
  const m = V2.exec(sealed);
  return m ? m[1] : sealed.split(".").length === 3 ? LEGACY_KEY_ID : null;
}
/** Whether a value is already in the newest envelope, under the newest key (rotation leaves it as it is). */
export const isCurrent = (sealed: string, ring: Keyring = keyring()) => V2.exec(sealed)?.[1] === ring.current.id;

export function failureText(o: Exclude<Opened, { ok: true }>): string {
  if (o.reason === "unknown-key") return o.keyId === LEGACY_KEY_ID
    ? "A secret was sealed with the key derived from SESSION_SECRET, which is not available: put back the SESSION_SECRET it was sealed with."
    : `A secret was sealed with the data key "${o.keyId}", which is no longer in DATA_KEYS: add that key back (after the newest one), then run the key rotation.`;
  if (o.reason === "wrong-key") return o.keyId === LEGACY_KEY_ID
    ? "A secret does not open with the key derived from SESSION_SECRET (SESSION_SECRET changed?): put back the SESSION_SECRET it was sealed with, or enter that secret again."
    : `A secret does not open with the data key "${o.keyId}": that key in DATA_KEYS is not the one it was sealed with.`;
  return "A sealed value is damaged and cannot be read: enter that secret again.";
}

const warned = new Set<string>();
/** Opens a sealed value, or null. One line in the log per key and reason, so a wrong key is noticed without flooding. */
export function unsealValue(sealed: string): string | null {
  const o = openValue(sealed);
  if (o.ok) return o.value;
  const sig = `${o.reason}:${o.keyId ?? ""}`;
  if (!warned.has(sig)) { warned.add(sig); console.warn(`[data-key] ${failureText(o)}`); }
  return null;
}
