/**
 * WebAuthn (passkeys, « clés d'accès »): the checks a Relying Party makes on what the browser returns, with node:crypto.
 *
 * Portions adapted from MasterKale/SimpleWebAuthn (https://github.com/MasterKale/SimpleWebAuthn, @simplewebauthn/server
 * 14.1.0, commit 01d1a640d5ded4fced0b45a9d806fd0ff44ad244), Copyright (c) 2020 Matthew Miller, MIT License — the order
 * of the checks of verifyRegistrationResponse / verifyAuthenticationResponse, parseAuthenticatorData, the COSE constants;
 * and from levischuck/tiny-cbor (https://github.com/levischuck/tiny-cbor, 0.2.11, commit
 * 3dfd6c890abf450966fc0349dd2ebb94a30144bb), Copyright (c) 2025 Levi, MIT License — the CBOR decoder.
 * Modified for Sklubot: TypeScript with no dependency (keys imported as JWK and signatures checked by node:crypto, which
 * reads DER ECDSA signatures itself); decoding only, with a depth limit and offsets kept right for sliced buffers; user
 * presence AND user verification always required; one algorithm list (ES256, EdDSA, RS256); attestation statements other
 * than "none" and self "packed" are not checked (see below); no metadata service, no network. Notices: THIRD_PARTY_NOTICES.md.
 *
 * Specification: W3C Web Authentication Level 3 (https://www.w3.org/TR/webauthn-3/).
 *  - §7.1 "Registering a New Credential" and §7.2 "Verifying an Authentication Assertion": the steps followed here
 *    (type, challenge, origin, rpIdHash = SHA-256 of the RP ID, UP and UV flags, algorithm, signature over
 *    authenticatorData || SHA-256(clientDataJSON)).
 *  - §6.1 "Authenticator Data" (flags bits 0 UP, 2 UV, 3 BE, 4 BS, 6 AT, 7 ED; big-endian 32-bit signCount) and §6.5.1
 *    "Attested Credential Data" (16-byte AAGUID, 2-byte length, credential id, COSE_Key).
 *  - §6.1.1 "Signature Counter Considerations": a counter that does not grow (when either side is non-zero) may be a
 *    cloned authenticator; the assertion is refused.
 *  - §8.7 "None Attestation Statement Format": attStmt is an empty map. Sklubot asks for attestation "none" (§5.4.7):
 *    it never decides anything from the authenticator's make; any other format is accepted as unattested (§7.1 step 21:
 *    "None" attestation acceptable under this Relying Party's policy), except self "packed", whose signature is checked.
 *  - COSE keys and algorithms: RFC 9052/9053 and the IANA COSE registry (https://www.iana.org/assignments/cose/cose.xhtml).
 *  - CBOR: RFC 8949 (definite lengths only: CTAP2 canonical CBOR never uses indefinite ones).
 */
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify, constants, type KeyObject } from "node:crypto";

export class WebAuthnError extends Error { constructor(public code: string, message: string) { super(message); } }
const fail = (code: string, message: string): never => { throw new WebAuthnError(code, message); };

export const b64url = {
  encode: (b: Uint8Array) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => Buffer.from(s, "base64url"),
  is: (s: unknown): s is string => typeof s === "string" && s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s),
};
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

// ── CBOR (decode only) ───────────────────────────────────────────────────────────────────────────────────────────────
export type Cbor = number | string | boolean | null | undefined | Uint8Array | Cbor[] | Map<string | number, Cbor>;
const MAX_DEPTH = 16;

function cborLength(v: DataView, arg: number, at: number): [number, number] {
  if (arg < 24) return [arg, 1];
  const left = v.byteLength - at - 1;
  if (arg === 24 && left >= 1) { const n = v.getUint8(at + 1); if (n >= 24) return [n, 2]; }
  if (arg === 25 && left >= 2) { const n = v.getUint16(at + 1); if (n >= 24) return [n, 3]; }
  if (arg === 26 && left >= 4) { const n = v.getUint32(at + 1); if (n >= 24) return [n, 5]; }
  if (arg === 27 && left >= 8) { const n = v.getBigUint64(at + 1); if (n >= 24n && n <= BigInt(Number.MAX_SAFE_INTEGER)) return [Number(n), 9]; }
  return fail("cbor", "CBOR length not supported or not well formed");
}

function cborNext(v: DataView, at: number, depth: number): [Cbor, number] {
  if (depth > MAX_DEPTH) fail("cbor", "CBOR nested too deeply");
  if (at >= v.byteLength) fail("cbor", "CBOR stream ended early");
  const byte = v.getUint8(at);
  const major = byte >> 5;
  const arg = byte & 0x1f;
  if (major === 0) return cborLength(v, arg, at);
  if (major === 1) { const [n, len] = cborLength(v, arg, at); return [-n - 1, len]; }
  if (major === 2 || major === 3) {
    const [n, len] = cborLength(v, arg, at);
    const start = at + len;
    if (start + n > v.byteLength) fail("cbor", "CBOR string goes past the end");
    const bytes = new Uint8Array(v.buffer, v.byteOffset + start, n).slice();
    return [major === 2 ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes), len + n];
  }
  if (major === 4) {
    const [n, len] = cborLength(v, arg, at);
    let used = len;
    const out: Cbor[] = [];
    for (let i = 0; i < n; i++) { const [item, k] = cborNext(v, at + used, depth + 1); out.push(item); used += k; }
    return [out, used];
  }
  if (major === 5) {
    const [n, len] = cborLength(v, arg, at);
    let used = len;
    const out = new Map<string | number, Cbor>();
    for (let i = 0; i < n; i++) {
      const [key, k1] = cborNext(v, at + used, depth + 1); used += k1;
      if (typeof key !== "string" && typeof key !== "number") fail("cbor", "CBOR map key must be a text or a number");
      if (out.has(key as string | number)) fail("cbor", "CBOR map has a duplicate key");
      const [val, k2] = cborNext(v, at + used, depth + 1); used += k2;
      out.set(key as string | number, val);
    }
    return [out, used];
  }
  if (major === 7) {
    if (arg === 20) return [false, 1];
    if (arg === 21) return [true, 1];
    if (arg === 22) return [null, 1];
    if (arg === 23) return [undefined, 1];
  }
  return fail("cbor", `CBOR item not supported at ${at}`);
}

/** The first CBOR item of `bytes` from `start`, and how many bytes it took. */
export function decodeCborFirst(bytes: Uint8Array, start = 0): [Cbor, number] {
  return cborNext(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start, 0);
}
export function decodeCbor(bytes: Uint8Array): Cbor {
  const [value, used] = decodeCborFirst(bytes);
  if (used !== bytes.byteLength) fail("cbor", "CBOR has bytes left over");
  return value;
}

// ── Authenticator data (§6.1) ────────────────────────────────────────────────────────────────────────────────────────
export interface AuthData {
  rpIdHash: Buffer; flags: { up: boolean; uv: boolean; be: boolean; bs: boolean; at: boolean; ed: boolean }; counter: number;
  aaguid?: Buffer; credentialId?: Buffer; credentialPublicKey?: Buffer;
}
export function parseAuthData(data: Buffer): AuthData {
  if (data.byteLength < 37) fail("auth_data", "Authenticator data is too short");
  const f = data[32]!;
  const flags = { up: !!(f & 0x01), uv: !!(f & 0x04), be: !!(f & 0x08), bs: !!(f & 0x10), at: !!(f & 0x40), ed: !!(f & 0x80) };
  const out: AuthData = { rpIdHash: data.subarray(0, 32), flags, counter: data.readUInt32BE(33) };
  let p = 37;
  if (flags.at) {
    if (data.byteLength < p + 18) fail("auth_data", "Attested credential data is too short");
    out.aaguid = data.subarray(p, p + 16); p += 16;
    const idLen = data.readUInt16BE(p); p += 2;
    // §5.8.3: a credential id is at most 1023 bytes.
    if (idLen < 1 || idLen > 1023 || p + idLen > data.byteLength) fail("auth_data", "Credential id has a wrong length");
    out.credentialId = data.subarray(p, p + idLen); p += idLen;
    const [, used] = decodeCborFirst(data, p);
    out.credentialPublicKey = data.subarray(p, p + used); p += used;
  }
  if (flags.ed) { const [, used] = decodeCborFirst(data, p); p += used; }
  if (p !== data.byteLength) fail("auth_data", "Authenticator data has bytes left over");
  return out;
}

// ── COSE keys ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** COSE algorithm ids (IANA): the ones Sklubot offers, in its order of preference. */
export const COSE_ALG = { ES256: -7, EdDSA: -8, RS256: -257 } as const;
export const SUPPORTED_ALGS: number[] = [COSE_ALG.ES256, COSE_ALG.EdDSA, COSE_ALG.RS256];

export function coseKey(cose: Uint8Array): { key: KeyObject; alg: number } {
  const m = decodeCbor(cose);
  if (!(m instanceof Map)) return fail("cose", "The public key is not a COSE map");
  const kty = m.get(1), alg = m.get(3);
  const bytes = (k: number) => { const v = m.get(k); return v instanceof Uint8Array ? b64url.encode(v) : fail("cose", "The public key is missing a part"); };
  if (typeof alg !== "number" || !SUPPORTED_ALGS.includes(alg)) fail("alg", "This kind of key is not supported");
  let jwk: Record<string, string>;
  if (kty === 2 && alg === COSE_ALG.ES256 && m.get(-1) === 1) jwk = { kty: "EC", crv: "P-256", x: bytes(-2), y: bytes(-3) };
  else if (kty === 1 && alg === COSE_ALG.EdDSA && m.get(-1) === 6) jwk = { kty: "OKP", crv: "Ed25519", x: bytes(-2) };
  else if (kty === 3 && alg === COSE_ALG.RS256) jwk = { kty: "RSA", n: bytes(-1), e: bytes(-2) };
  else return fail("cose", "The public key does not match its algorithm");
  try { return { key: createPublicKey({ key: jwk, format: "jwk" }), alg: alg as number }; }
  catch { return fail("cose", "The public key cannot be read"); }
}

function checkSignature(alg: number, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  try {
    if (alg === COSE_ALG.ES256) return cryptoVerify("sha256", data, { key, dsaEncoding: "der" }, signature);
    if (alg === COSE_ALG.RS256) return cryptoVerify("sha256", data, { key, padding: constants.RSA_PKCS1_PADDING }, signature);
    if (alg === COSE_ALG.EdDSA) return cryptoVerify(null, data, key, signature);
  } catch { /* a malformed signature is a wrong one */ }
  return false;
}

// ── Client data (§5.8.1) ─────────────────────────────────────────────────────────────────────────────────────────────
interface Expect { challenge: string; origins: string[]; rpId: string }
function checkClientData(raw: unknown, type: "webauthn.create" | "webauthn.get", e: Expect): Buffer {
  if (!b64url.is(raw)) fail("client_data", "clientDataJSON is missing");
  const bytes = b64url.decode(raw as string);
  let cd: Record<string, unknown>;
  try { cd = JSON.parse(bytes.toString("utf8")); } catch { return fail("client_data", "clientDataJSON cannot be read"); }
  if (cd.type !== type) fail("type", `Unexpected type ${String(cd.type)}`);
  const a = Buffer.from(String(cd.challenge ?? "")), b = Buffer.from(e.challenge);
  if (a.length !== b.length || !timingSafeEqual(a, b)) fail("challenge", "The challenge does not match");
  if (typeof cd.origin !== "string" || !e.origins.includes(cd.origin)) fail("origin", `Unexpected origin ${String(cd.origin)}`);
  // Sklubot is never embedded in another site's frame (frame-ancestors 'none'): a cross-origin ceremony is refused.
  if (cd.crossOrigin === true || cd.topOrigin !== undefined) fail("origin", "Cross-origin ceremony refused");
  return bytes;
}

function checkCredentialShape(r: any): void {
  if (!r || typeof r !== "object") fail("shape", "No credential");
  if (!b64url.is(r.id) || r.id !== r.rawId) fail("shape", "Credential id is not base64url");
  if (r.type !== "public-key") fail("shape", "Unexpected credential type");
  if (!r.response || typeof r.response !== "object") fail("shape", "Credential has no response");
}

function checkRp(auth: AuthData, rpId: string) {
  if (!auth.rpIdHash.equals(sha256(Buffer.from(rpId, "utf8")))) fail("rp_id", "The credential is for another site");
  if (!auth.flags.up) fail("user_presence", "The user was not present");
  // Sklubot always asks userVerification "required" (§5.4.6) and checks it here: the passkey is two factors on its own.
  if (!auth.flags.uv) fail("user_verification", "The user was not verified (PIN, fingerprint or face)");
  // §6.1: BS (backed up) without BE (backup eligible) is not a valid state.
  if (auth.flags.bs && !auth.flags.be) fail("auth_data", "Impossible backup flags");
}

// ── Registration (§7.1) ──────────────────────────────────────────────────────────────────────────────────────────────
export interface NewCredential { id: string; publicKey: string; alg: number; counter: number; transports: string[]; backedUp: boolean; multiDevice: boolean }

export function verifyRegistration(response: unknown, e: Expect): NewCredential {
  const r = response as any;
  checkCredentialShape(r);
  checkClientData(r.response.clientDataJSON, "webauthn.create", e);
  if (!b64url.is(r.response.attestationObject)) fail("shape", "attestationObject is missing");
  const att = decodeCbor(b64url.decode(r.response.attestationObject));
  if (!(att instanceof Map)) return fail("attestation", "attestationObject is not a map");
  const fmt = att.get("fmt"), authBytes = att.get("authData"), attStmt = att.get("attStmt");
  if (typeof fmt !== "string" || !(authBytes instanceof Uint8Array) || !(attStmt instanceof Map)) return fail("attestation", "attestationObject is incomplete");
  const authData = Buffer.from(authBytes);
  const auth = parseAuthData(authData);
  checkRp(auth, e.rpId);
  if (!auth.flags.at || !auth.credentialId || !auth.credentialPublicKey) return fail("auth_data", "No new credential in the answer");
  if (!auth.credentialId.equals(b64url.decode(r.id))) fail("shape", "Credential id does not match");
  const { key, alg } = coseKey(auth.credentialPublicKey);
  if (fmt === "none" && attStmt.size > 0) fail("attestation", "None attestation with a statement");
  // Self attestation (§8.2, no x5c): signed by the new credential's own key over authData || hash(clientDataJSON).
  if (fmt === "packed" && !attStmt.has("x5c")) {
    const sig = attStmt.get("sig");
    if (attStmt.get("alg") !== alg || !(sig instanceof Uint8Array)) fail("attestation", "Self attestation is incomplete");
    const signed = Buffer.concat([authData, sha256(b64url.decode(r.response.clientDataJSON))]);
    if (!checkSignature(alg, key, signed, Buffer.from(sig as Uint8Array))) fail("signature", "Self attestation signature is wrong");
  }
  const transports = Array.isArray(r.response.transports) ? r.response.transports.filter((t: unknown) => typeof t === "string" && /^[a-z-]{2,20}$/.test(t)).slice(0, 8) : [];
  return { id: r.id, publicKey: b64url.encode(auth.credentialPublicKey), alg, counter: auth.counter, transports, backedUp: auth.flags.bs, multiDevice: auth.flags.be };
}

// ── Authentication (§7.2) ────────────────────────────────────────────────────────────────────────────────────────────
export function verifyAssertion(response: unknown, e: Expect, credential: { id: string; publicKey: string; counter: number }): { counter: number; backedUp: boolean } {
  const r = response as any;
  checkCredentialShape(r);
  if (r.id !== credential.id) fail("shape", "Another credential answered");
  const clientData = checkClientData(r.response.clientDataJSON, "webauthn.get", e);
  if (!b64url.is(r.response.authenticatorData) || !b64url.is(r.response.signature)) fail("shape", "Assertion is incomplete");
  const authData = b64url.decode(r.response.authenticatorData);
  const auth = parseAuthData(authData);
  checkRp(auth, e.rpId);
  const { key, alg } = coseKey(b64url.decode(credential.publicKey));
  if (!checkSignature(alg, key, Buffer.concat([authData, sha256(clientData)]), b64url.decode(r.response.signature))) fail("signature", "The signature is wrong");
  // §6.1.1: checked after the signature, so a forged answer cannot be used to probe the stored counter.
  if ((auth.counter > 0 || credential.counter > 0) && auth.counter <= credential.counter) fail("counter", "The passkey's counter went backwards (copied authenticator?)");
  return { counter: auth.counter, backedUp: auth.flags.bs };
}
