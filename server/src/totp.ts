import { createHmac, randomInt } from "node:crypto";

/**
 * Two-factor codes and generated passwords.
 *
 * TOTP follows RFC 6238 (https://www.rfc-editor.org/rfc/rfc6238): HOTP (RFC 4226, section 5.3 dynamic truncation)
 * over the number of `period`-second steps since the Unix epoch. Seeds are base32 (RFC 4648, section 6), the format
 * authenticator apps use. An `otpauth://totp/...` URI carries the seed and its settings in the query string
 * (`secret`, `digits`, `period`, `algorithm`), as described by the Key URI Format of Google Authenticator
 * (https://github.com/google/google-authenticator/wiki/Key-Uri-Format).
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("That is not a valid base32 key (letters A–Z and digits 2–7).");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export interface TotpSeed { secret: string; digits: 6 | 8; period: number; algorithm: TotpAlgorithm; issuer?: string; account?: string }

/** Reads a base32 seed or an otpauth:// URI. Throws a plain-language error when it is neither. */
export function parseTotp(raw: string): TotpSeed {
  const s = raw.trim();
  if (/^otpauth:/i.test(s)) {
    const u = new URL(s);
    if (u.hostname.toLowerCase() !== "totp") throw new Error("Only time-based codes (otpauth://totp/…) are supported.");
    const secret = u.searchParams.get("secret") ?? "";
    base32Decode(secret);
    const digits = u.searchParams.get("digits") === "8" ? 8 : 6;
    const period = Number(u.searchParams.get("period") ?? 30);
    const alg = (u.searchParams.get("algorithm") ?? "SHA1").toUpperCase();
    const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const [issuerPart, account] = label.includes(":") ? label.split(/:(.*)/s) : [undefined, label];
    return {
      secret: secret.toUpperCase().replace(/\s/g, ""), digits, period: Number.isInteger(period) && period >= 15 && period <= 120 ? period : 30,
      algorithm: alg === "SHA256" || alg === "SHA512" ? alg : "SHA1", issuer: u.searchParams.get("issuer") ?? issuerPart, account: account || undefined,
    };
  }
  base32Decode(s);
  return { secret: s.toUpperCase().replace(/[\s-]/g, ""), digits: 6, period: 30, algorithm: "SHA1" };
}

/** HOTP value for one counter (RFC 4226, section 5.3). */
export function hotp(key: Buffer, counter: number, digits = 6, algorithm: TotpAlgorithm = "SHA1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm.toLowerCase(), key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** The code for `at` (ms), and how many seconds it stays valid. */
export function totpNow(seed: TotpSeed, at = Date.now()): { code: string; remaining: number } {
  const step = Math.floor(at / 1000 / seed.period);
  return { code: hotp(base32Decode(seed.secret), step, seed.digits, seed.algorithm), remaining: seed.period - (Math.floor(at / 1000) % seed.period) };
}

// ── Passwords ────────────────────────────────────────────────────────────────
const LOWER = "abcdefghijkmnopqrstuvwxyz", UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ", DIGITS = "23456789", SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

/** A random password from the chosen sets, at least one character of each (crypto.randomInt: uniform, no modulo bias). */
export function generatePassword(opts: { length?: number; digits?: boolean; symbols?: boolean } = {}): string {
  const length = Math.min(128, Math.max(8, Math.round(opts.length ?? 20)));
  const sets = [LOWER, UPPER, ...(opts.digits === false ? [] : [DIGITS]), ...(opts.symbols === false ? [] : [SYMBOLS])];
  const all = sets.join("");
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher–Yates, so the guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
