/**
 * An age X25519 key pair made in the browser, for the automatic backup (server: server/src/agecrypt.ts). Only the
 * public key ("age1…") is sent to the server; the private key ("AGE-SECRET-KEY-1…") stays with the owner, who saves it.
 *
 * - X25519 in WebCrypto: generateKey({ name: "X25519" }) — https://w3c.github.io/webcrypto/#x25519 (Chrome 133+,
 *   Firefox 130+, Safari 17+); the public key exports as 32 raw bytes, the private key as PKCS #8 (RFC 8410), whose
 *   last 32 bytes are the private key itself.
 * - Encoding: Bech32 (BIP 173) with HRP "age" for the recipient and "AGE-SECRET-KEY-" (upper case) for the identity,
 *   as the age format says — https://github.com/C2SP/C2SP/blob/main/age.md ("The X25519 recipient type"). The file is
 *   the same as age-keygen writes, so `age -d -i <file>` opens the backups too.
 */
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
export function bech32(hrp: string, data: Uint8Array): string {
  const h = hrp.toLowerCase();
  const words: number[] = [];
  let acc = 0, bits = 0;
  for (const b of data) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31); } }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const exp = [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
  const pm = polymod([...exp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const sum = Array.from({ length: 6 }, (_x, i) => (pm >> (5 * (5 - i))) & 31);
  return `${h}1${[...words, ...sum].map((w) => CHARSET[w]).join("")}`;
}

export interface AgeKeyPair { recipient: string; identity: string; file: string }

/** Whether this browser can make the key (WebCrypto X25519). */
export async function canMakeAgeKey(): Promise<boolean> {
  try {
    if (!globalThis.crypto?.subtle) return false;
    await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    return true;
  } catch { return false; }
}

export async function makeAgeKey(now = new Date()): Promise<AgeKeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  if (pub.length !== 32 || pkcs8.length < 32) throw new Error("unexpected X25519 key size");
  const priv = pkcs8.slice(pkcs8.length - 32);
  const recipient = bech32("age", pub);
  const identity = bech32("AGE-SECRET-KEY-", priv).toUpperCase();
  priv.fill(0);
  return { recipient, identity, file: `# Sklubot — clé de sauvegarde / backup key\n# created: ${now.toISOString()}\n# public key: ${recipient}\n${identity}\n` };
}
