/**
 * age v1 file encryption, X25519 recipients only — the format of https://age-encryption.org/v1 (spec text:
 * https://github.com/C2SP/C2SP/blob/main/age.md). Used by the in-app off-server backup (autobackup.ts): the server
 * holds only the owner's PUBLIC key (an "age1…" recipient) and can encrypt every night without being able to read the
 * result; the private key ("AGE-SECRET-KEY-1…") stays with the owner. Files it writes open with the standard tool
 * (`age -d -i key.txt`), and files `age -r age1…` writes open here (`node server/dist/backupcheck.js decrypt`).
 *
 * What the spec says, and where it is done below:
 *  - file key: 16 bytes from a CSPRNG, new for every file;
 *  - header: "age-encryption.org/v1\n", one stanza per recipient, then "--- " + base64(HMAC-SHA-256) where the HMAC
 *    key is HKDF-SHA-256(ikm = file key, salt = empty, info = "header") and the MAC covers the header up to and
 *    including "---"; base64 is RFC 4648 standard alphabet WITHOUT padding, stanza bodies wrapped at 64 columns and
 *    ending with a line shorter than 64 (possibly empty);
 *  - X25519 stanza: "-> X25519 <base64 ephemeral share>", body = ChaCha20-Poly1305(wrap key, nonce = 12 zero bytes,
 *    file key), wrap key = HKDF-SHA-256(ikm = X25519(eph, recipient), salt = share || recipient,
 *    info = "age-encryption.org/v1/X25519"); an all-zero shared secret aborts; a body must be exactly 32 bytes;
 *  - payload: a 16-byte nonce, then payload key = HKDF-SHA-256(ikm = file key, salt = nonce, info = "payload"),
 *    64 KiB chunks sealed with ChaCha20-Poly1305 under the nonce counter(11 bytes, big endian) || last-flag(1 byte);
 *    the final chunk may be short but is never empty unless the whole plaintext is; a stream that ends without a valid
 *    final chunk is an error;
 *  - keys: Bech32 (BIP 173, no length limit), HRP "age" for recipients and "AGE-SECRET-KEY-" for identities (written
 *    in upper case).
 * Node's crypto provides X25519 (RFC 7748, clamping included), HKDF, HMAC and "chacha20-poly1305" (RFC 8439).
 */
import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

export const AGE_VERSION_LINE = "age-encryption.org/v1";
const CHUNK = 64 * 1024;
const TAG = 16;

// ── Bech32 (BIP 173) ─────────────────────────────────────────────────────────
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
function convertBits(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) throw new Error("invalid Bech32 data");
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) throw new Error("invalid Bech32 padding");
  return out;
}
export function bech32Encode(hrp: string, data: Uint8Array): string {
  const lower = hrp.toLowerCase();
  const words = convertBits(data, 8, 5, true);
  const pm = polymod([...hrpExpand(lower), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_x, i) => (pm >> (5 * (5 - i))) & 31);
  return `${lower}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}
export function bech32Decode(s: string): { hrp: string; data: Buffer } {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new Error("mixed-case Bech32 string");
  const str = s.toLowerCase();
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) throw new Error("not a Bech32 string");
  const hrp = str.slice(0, pos);
  for (const c of hrp) if (c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126) throw new Error("invalid Bech32 prefix");
  const words: number[] = [];
  for (const c of str.slice(pos + 1)) { const v = CHARSET.indexOf(c); if (v < 0) throw new Error("invalid Bech32 character"); words.push(v); }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) throw new Error("bad Bech32 checksum");
  return { hrp, data: Buffer.from(convertBits(words.slice(0, -6), 5, 8, false)) };
}

// ── Keys ─────────────────────────────────────────────────────────────────────
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/=+$/, "");
/** Canonical unpadded base64 only (the spec forbids padding and non-canonical encodings). */
function unb64(s: string, expectLen?: number): Buffer {
  if (!/^[A-Za-z0-9+/]*$/.test(s)) throw new Error("invalid base64 in the age header");
  const out = Buffer.from(s, "base64");
  if (b64(out) !== s) throw new Error("non-canonical base64 in the age header");
  if (expectLen !== undefined && out.length !== expectLen) throw new Error("wrong length in the age header");
  return out;
}
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const privKey = (raw: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
const pubKey = (raw: Buffer): KeyObject => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });
const rawPublic = (k: KeyObject): Buffer => Buffer.from(String(k.export({ format: "jwk" }).x), "base64url");
const x25519 = (priv: KeyObject, pub: KeyObject): Buffer => diffieHellman({ privateKey: priv, publicKey: pub });

/** "age1…" → the 32-byte X25519 public key. Throws with a readable reason. */
export function parseRecipient(s: string): Buffer {
  let d: { hrp: string; data: Buffer };
  try { d = bech32Decode(s.trim()); } catch { throw new Error("This is not an age public key (it starts with age1…)."); }
  if (d.hrp !== "age" || d.data.length !== 32) throw new Error("This is not an age X25519 public key (age1…).");
  return d.data;
}
/** "AGE-SECRET-KEY-1…" (or a whole key file with # comments) → the 32-byte X25519 identity. */
export function parseIdentity(text: string): Buffer {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  if (!line) throw new Error("No age private key (AGE-SECRET-KEY-1…) in this file.");
  let d: { hrp: string; data: Buffer };
  try { d = bech32Decode(line); } catch { throw new Error("This is not an age private key (AGE-SECRET-KEY-1…)."); }
  if (d.hrp !== "age-secret-key-" || d.data.length !== 32) throw new Error("This is not an age X25519 private key (AGE-SECRET-KEY-1…).");
  return d.data;
}
export const recipientOf = (identity: Buffer): string => bech32Encode("age", rawPublic(createPublicKey(privKey(identity))));
export const encodeIdentity = (identity: Buffer): string => bech32Encode("AGE-SECRET-KEY-", identity).toUpperCase();
/** A new key pair, as age-keygen makes it (tests and the command line; the browser makes its own with WebCrypto). */
export function generateIdentity(): { identity: string; recipient: string; file: string } {
  const raw = randomBytes(32);
  const recipient = recipientOf(raw);
  const identity = encodeIdentity(raw);
  return { identity, recipient, file: `# created: ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n` };
}

// ── Primitives ───────────────────────────────────────────────────────────────
const hkdf = (ikm: Buffer, salt: Buffer, info: string, len = 32) => Buffer.from(hkdfSync("sha256", ikm, salt, info, len));
function seal(key: Buffer, nonce: Buffer, plain: Buffer): Buffer {
  const c = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
function open(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < TAG) throw new Error("truncated age data");
  const d = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
}
const ZERO_NONCE = Buffer.alloc(12);
function chunkNonce(counter: bigint, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  let c = counter;
  for (let i = 10; i >= 0; i--) { n[i] = Number(c & 0xffn); c >>= 8n; }
  if (c) throw new Error("age stream too long");
  n[11] = last ? 1 : 0;
  return n;
}
function wrapBody(body: Buffer): string {
  const s = b64(body);
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 64) lines.push(s.slice(i, i + 64));
  if (s.length % 64 === 0) lines.push(""); // the body must end with a line shorter than 64 columns
  return lines.join("\n");
}

/** The header for these recipients, and the payload key material. */
function makeHeader(recipients: Buffer[]): { header: Buffer; fileKey: Buffer } {
  if (!recipients.length) throw new Error("no age recipient");
  const fileKey = randomBytes(16);
  let text = `${AGE_VERSION_LINE}\n`;
  for (const r of recipients) {
    const eph = randomBytes(32);
    const ephPriv = privKey(eph);
    const share = rawPublic(createPublicKey(ephPriv));
    const shared = x25519(ephPriv, pubKey(r));
    if (shared.every((b) => b === 0)) throw new Error("invalid age recipient");
    const wrapKey = hkdf(shared, Buffer.concat([share, r]), "age-encryption.org/v1/X25519");
    text += `-> X25519 ${b64(share)}\n${wrapBody(seal(wrapKey, ZERO_NONCE, fileKey))}\n`;
  }
  text += "---";
  const mac = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(text).digest();
  return { header: Buffer.from(`${text} ${b64(mac)}\n`), fileKey };
}

/** A Transform: plaintext in, an age file out, 64 KiB at a time (memory stays at about one chunk). */
export function encryptStream(recipient: string | string[]): Transform {
  const recipients = (Array.isArray(recipient) ? recipient : [recipient]).map(parseRecipient);
  const { header, fileKey } = makeHeader(recipients);
  const nonce = randomBytes(16);
  const key = hkdf(fileKey, nonce, "payload");
  let counter = 0n;
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let started = false;
  const start = (t: Transform) => { if (!started) { started = true; t.push(header); t.push(nonce); } };
  const take = (n: number): Buffer => {
    const all = pending.length === 1 ? pending[0] : Buffer.concat(pending);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    pending = rest.length ? [rest] : [];
    pendingLen = rest.length;
    return out;
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      start(this);
      pending.push(chunk); pendingLen += chunk.length;
      // A full chunk is sealed only once more data follows it: the last chunk must carry the "final" flag.
      while (pendingLen > CHUNK) { this.push(seal(key, chunkNonce(counter, false), Buffer.from(take(CHUNK)))); counter++; }
      cb();
    },
    flush(cb: TransformCallback) {
      start(this);
      this.push(seal(key, chunkNonce(counter, true), Buffer.from(take(pendingLen))));
      cb();
    },
  });
}

/** Parses an age header from the start of `buf`. Null: not complete yet. */
function parseHeader(buf: Buffer): { stanzas: { args: string[]; body: Buffer }[]; macInput: string; mac: Buffer; length: number } | null {
  // The header is text; it ends with the line starting "--- ". Look for it without decoding the binary payload.
  let pos = 0;
  const lines: string[] = [];
  for (;;) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) { if (buf.length - pos > 4096 || buf.length > 1 << 20) throw new Error("This is not an age file (no header)."); return null; }
    const line = buf.subarray(pos, nl).toString("latin1");
    pos = nl + 1;
    lines.push(line);
    if (lines.length === 1 && line !== AGE_VERSION_LINE) throw new Error(line.startsWith("age-encryption.org/") ? "Unsupported age version." : "This is not an age file.");
    if (line.startsWith("---")) break;
  }
  const last = lines[lines.length - 1];
  if (!last.startsWith("--- ")) throw new Error("Malformed age header.");
  const stanzas: { args: string[]; body: Buffer }[] = [];
  let i = 1;
  while (i < lines.length - 1) {
    const l = lines[i];
    if (!l.startsWith("-> ")) throw new Error("Malformed age header.");
    const args = l.slice(3).split(" ");
    if (!args.length || args.some((a) => !a)) throw new Error("Malformed age header.");
    i++;
    let body = "";
    for (;;) {
      if (i >= lines.length - 1) throw new Error("Malformed age header.");
      const bl = lines[i++];
      if (bl.length > 64) throw new Error("Malformed age header.");
      body += bl;
      if (bl.length < 64) break;
    }
    stanzas.push({ args, body: unb64(body) });
  }
  if (!stanzas.length) throw new Error("Malformed age header (no recipient).");
  const headerText = lines.join("\n");
  return { stanzas, macInput: headerText.slice(0, headerText.length - last.length + 3), mac: unb64(last.slice(4), 32), length: pos };
}

/** A Transform: an age file in, the plaintext out. Fails (stream error) on a wrong key or any tampering. */
export function decryptStream(identityText: string): Transform {
  const identity = parseIdentity(identityText);
  const idPriv = privKey(identity);
  const idPub = rawPublic(createPublicKey(idPriv));
  let buf: Buffer = Buffer.alloc(0);
  let key: Buffer | null = null;
  let counter = 0n;
  let done = false;
  const SEALED = CHUNK + TAG;
  const unwrap = (stanzas: { args: string[]; body: Buffer }[]): Buffer => {
    for (const s of stanzas) {
      if (s.args[0] !== "X25519") continue;
      if (s.args.length !== 2) throw new Error("Malformed X25519 stanza.");
      const share = unb64(s.args[1], 32);
      if (s.body.length !== 32) throw new Error("Malformed X25519 stanza.");
      const shared = x25519(idPriv, pubKey(share));
      if (shared.every((b) => b === 0)) throw new Error("Invalid X25519 share.");
      const wrapKey = hkdf(shared, Buffer.concat([share, idPub]), "age-encryption.org/v1/X25519");
      try { return open(wrapKey, ZERO_NONCE, s.body); } catch { /* addressed to another key: try the next stanza */ }
    }
    throw new Error("This private key does not open this backup (it was encrypted for another key).");
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        if (done) throw new Error("Data after the end of the age file.");
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        if (!key) {
          const h = parseHeader(buf);
          if (!h || buf.length < h.length + 16) return cb();
          const fileKey = unwrap(h.stanzas);
          const mac = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(h.macInput, "latin1").digest();
          if (!timingSafeEqual(mac, h.mac)) throw new Error("The backup's header was changed (bad MAC).");
          key = hkdf(fileKey, buf.subarray(h.length, h.length + 16), "payload");
          buf = buf.subarray(h.length + 16);
        }
        while (buf.length > SEALED) {
          this.push(open(key, chunkNonce(counter, false), buf.subarray(0, SEALED)));
          counter++;
          buf = buf.subarray(SEALED);
        }
        cb();
      } catch (err) { cb(err as Error); }
    },
    flush(cb: TransformCallback) {
      try {
        if (!key) throw new Error("This is not a complete age file.");
        let plain: Buffer;
        try { plain = open(key, chunkNonce(counter, true), buf); } catch { throw new Error("The backup is truncated or was changed (its last part does not check out)."); }
        if (!plain.length && counter > 0n) throw new Error("Malformed age file (empty final chunk).");
        done = true;
        this.push(plain);
        cb();
      } catch (err) { cb(err as Error); }
    },
  });
}
