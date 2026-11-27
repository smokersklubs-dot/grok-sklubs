import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { seal, unseal } from "./auth.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { now } from "./store.js";

/**
 * L169 — Web Bot Auth: the bots' web requests carry a signature that tells a site « this request really comes from the
 * Sklubot of bots.example.com », so a site can let identified bots through instead of guessing from the address.
 *
 * Specifications read on 25/11/2026 (IETF Web Bot Auth working group):
 *  - draft-ietf-webbotauth-httpsig-protocol-01 (29/10/2026), https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/
 *    §5.2: cover `@authority` (or `@target-uri`); `created` and `expires` required (expires ≤ 24 h after created: we use
 *    5 minutes, since a signature over the authority alone can be replayed on that site until it expires, §C);
 *    `keyid` = base64url JWK SHA-256 thumbprint (RFC 7638; for Ed25519 the members of RFC 8037 Appendix A.3);
 *    `tag="web-bot-auth"`. §5.2.1: every signed request carries `Signature-Agent`, a Dictionary Structured Field
 *    (RFC 9651 §3.2) whose member is an https URI of the key directory, and that member is a covered component.
 *    §5.5.1 / §8.1 / §8.2.1: the directory is a JWK Set (RFC 7517 §5) served over HTTPS at
 *    /.well-known/http-message-signatures-directory with media type application/http-message-signatures-directory+json.
 *    Appendix B.1: the directory response SHOULD be signed with each of its keys, covering `"@authority";req` and
 *    `content-digest`, `tag="http-message-signatures-directory"`.
 *  - HTTP Message Signatures, RFC 9421: signature base §2.5, dictionary member components (`;key=`) §2.1.2, derived
 *    component @authority §2.2.3 (lowercase host, port only when not the default), `alg="ed25519"` §3.3.6.
 *  - Content-Digest, RFC 9530 §2 (`sha-256=:<base64>:`).
 *
 * One key pair per installation (Ed25519), made the first time it is needed; the private key is sealed with the server's
 * data key (datakey.ts) like the vault. On/off per bot (botroute.ts), off by default; never through the owner's home exit
 * unless the owner said so (privacy: the signature names this server on a request that leaves from their home).
 */

export const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
export const DIRECTORY_TYPE = "application/http-message-signatures-directory+json";
export const LABEL = "sig1";
const LIFETIME_S = 300;

q.run(`CREATE TABLE IF NOT EXISTS web_bot_auth_key (id TEXT PRIMARY KEY, private_sealed TEXT NOT NULL, x TEXT NOT NULL, created_at INTEGER NOT NULL)`);

interface Key { priv: KeyObject; x: string; kid: string; createdAt: number }
let cached: Key | null = null;

/** RFC 8037 Appendix A.3 / RFC 7638 §3: SHA-256 over {"crv","kty","x"} in that order, no spaces, base64url. */
export const thumbprint = (x: string) => createHash("sha256").update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest("base64url");

function key(): Key {
  if (cached) return cached;
  let row = q.get<{ private_sealed: string; x: string; created_at: number }>("SELECT private_sealed, x, created_at FROM web_bot_auth_key WHERE id = 'main'");
  if (!row) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const x = String((publicKey.export({ format: "jwk" }) as { x: string }).x);
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    q.run("INSERT OR IGNORE INTO web_bot_auth_key (id, private_sealed, x, created_at) VALUES ('main', ?, ?, ?)", seal(pem), x, now());
    row = q.get<{ private_sealed: string; x: string; created_at: number }>("SELECT private_sealed, x, created_at FROM web_bot_auth_key WHERE id = 'main'")!;
  }
  const pem = unseal(row.private_sealed);
  if (!pem) throw new Error("the Web Bot Auth key cannot be opened (data key changed?)");
  cached = { priv: createPrivateKey(pem), x: row.x, kid: thumbprint(row.x), createdAt: row.created_at };
  return cached;
}

/** The public URL of the directory: signing only makes sense when this server is reachable over https (§5.5.1). */
export const directoryUrl = () => `${config.publicUrl}${DIRECTORY_PATH}`;
export const canSign = () => /^https:\/\/[^/]+/i.test(config.publicUrl) && !/^https:\/\/(localhost|127\.|\[::1\])/i.test(config.publicUrl);

/** The JWK Set (§5.5.1). */
export function directory(): { keys: Array<Record<string, unknown>> } {
  const k = key();
  return { keys: [{ kty: "OKP", crv: "Ed25519", x: k.x, kid: k.kid, use: "sig", nbf: Math.floor(k.createdAt / 1000) }] };
}

/** RFC 9651 §4.1.6: a String is quoted, with \ and " escaped (our values are plain ASCII URLs). */
const sfString = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
/** RFC 9421 §2.2.3: the authority, lowercase, with its port only when it is not the scheme's default (URL drops those). */
const authorityOf = (url: URL) => url.host.toLowerCase();

function params(components: string, created: number, extra: string, tag: string) {
  return `(${components});created=${created};expires=${created + LIFETIME_S};keyid=${sfString(key().kid)};alg="ed25519"${extra};tag=${sfString(tag)}`;
}
/** RFC 9421 §2.5: one line per component, then the @signature-params line, joined by \n with no final newline. */
const base = (lines: Array<[string, string]>, sigParams: string) => [...lines.map(([id, v]) => `${id}: ${v}`), `"@signature-params": ${sigParams}`].join("\n");

/** The three headers that sign one request to `url` (web-bot-auth, §5.2). */
export function signRequest(url: string | URL, at = Math.floor(Date.now() / 1000)): Record<string, string> {
  const u = new URL(url);
  const agent = sfString(directoryUrl());
  const sigParams = params(`"@authority" "signature-agent";key=${sfString(LABEL)}`, at, `;nonce=${sfString(randomBytes(32).toString("base64"))}`, "web-bot-auth");
  const sb = base([[`"@authority"`, authorityOf(u)], [`"signature-agent";key=${sfString(LABEL)}`, agent]], sigParams);
  const sig = sign(null, Buffer.from(sb, "utf8"), key().priv).toString("base64");
  return { "signature-agent": `${LABEL}=${agent}`, "signature-input": `${LABEL}=${sigParams}`, signature: `${LABEL}=:${sig}:` };
}

/** The directory response with its own signature (Appendix B.1): body + headers. */
export function signedDirectory(requestAuthority: string, at = Math.floor(Date.now() / 1000)): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(directory());
  const digest = `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
  const sigParams = params(`"@authority";req "content-digest"`, at, "", "http-message-signatures-directory");
  const sb = base([[`"@authority";req`, requestAuthority.toLowerCase()], [`"content-digest"`, digest]], sigParams);
  const sig = sign(null, Buffer.from(sb, "utf8"), key().priv).toString("base64");
  return { body, headers: { "content-type": DIRECTORY_TYPE, "cache-control": "max-age=86400", "content-digest": digest, "signature-input": `${LABEL}=${sigParams}`, signature: `${LABEL}=:${sig}:` } };
}

/** The public key as a KeyObject (tests, the settings' fingerprint). */
export const publicKey = () => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key().x }, format: "jwk" });
export const keyId = () => key().kid;
/** Tests: forget the cached key (a new DATA_DIR). */
export const _resetWebBotAuthKey = () => { cached = null; };
