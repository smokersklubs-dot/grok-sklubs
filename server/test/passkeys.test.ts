import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L44 « Clés d'accès » (passkeys): the contract's acceptance checks, with a software authenticator (no real device here).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-passkeys-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://bots.example.test";
for (const k of ["SMTP_HOST", "OPEN_SIGNUP", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, bots, rows, approvals } = await import("../src/store.js");
const { relyingParty, consumeProof } = await import("../src/passkeys.js");
const { decodeCbor, parseAuthData, coseKey, WebAuthnError, verifyAssertion } = await import("../src/webauthn.js");
const { checkFloorApproval } = await import("../src/floorapproval.js");
const { securitySettings } = await import("../src/securitysettings.js");
const { beginSetup, confirmSetup } = await import("../src/twofactor.js");
const { totpNow, parseTotp } = await import("../src/totp.js");
const { createSession } = await import("../src/auth.js");

const ORIGIN = "https://bots.example.test";
const HOST = "bots.example.test";

// ── A tiny CBOR encoder (test side only) and a software authenticator ────────────────────────────────────────────
type C = number | string | Uint8Array | Map<number | string, C> | C[];
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function cbor(v: C): Buffer {
  if (typeof v === "number") return Buffer.from(v >= 0 ? head(0, v) : head(1, -v - 1));
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([Buffer.from(head(3, b.length)), b]); }
  if (v instanceof Uint8Array) return Buffer.concat([Buffer.from(head(2, v.length)), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from(head(4, v.length)), ...v.map(cbor)]);
  return Buffer.concat([Buffer.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

class Authenticator {
  key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  id = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255));
  counter = 0;
  userHandle = "";
  cose(): Buffer {
    const jwk = this.key.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    return cbor(new Map<number, C>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  }
  authData(o: { rpId?: string; flags?: number; attested?: boolean } = {}): Buffer {
    const flags = o.flags ?? (0x01 | 0x04 | (o.attested ? 0x40 : 0));
    const c = Buffer.alloc(4); c.writeUInt32BE(this.counter);
    const parts = [sha(o.rpId ?? HOST), Buffer.from([flags]), c];
    if (o.attested) { const len = Buffer.alloc(2); len.writeUInt16BE(this.id.length); parts.push(Buffer.alloc(16), len, this.id, this.cose()); }
    return Buffer.concat(parts);
  }
  create(options: any, o: { origin?: string; rpId?: string; flags?: number } = {}) {
    this.userHandle = options.user.id;
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: o.origin ?? ORIGIN, crossOrigin: false }));
    const attestationObject = cbor(new Map<string, C>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData({ attested: true, rpId: o.rpId, flags: o.flags === undefined ? undefined : o.flags | 0x40 })]]));
    return { id: b64u(this.id), rawId: b64u(this.id), type: "public-key", response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestationObject), transports: ["internal", "hybrid"] }, clientExtensionResults: {} };
  }
  get(options: any, o: { origin?: string; rpId?: string; flags?: number; keepCounter?: boolean; type?: string } = {}) {
    if (!o.keepCounter) this.counter++;
    const clientData = Buffer.from(JSON.stringify({ type: o.type ?? "webauthn.get", challenge: options.challenge, origin: o.origin ?? ORIGIN, crossOrigin: false }));
    const authData = this.authData({ rpId: o.rpId, flags: o.flags });
    const signature = cryptoSign("sha256", Buffer.concat([authData, sha(clientData)]), this.key.privateKey);
    return { id: b64u(this.id), rawId: b64u(this.id), type: "public-key", response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: this.userHandle }, clientExtensionResults: {} };
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
async function call(method: string, url: string, body?: unknown, cookie = "", origin = ORIGIN) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, origin, host: HOST, "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie?.() ?? [];
  const session = set.map((s) => s.split(";")[0]).find((s) => s.startsWith("sklubot_session="));
  return { status: res.status, json: (await res.json().catch(() => null)) as any, session };
}

const signup = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "motdepasse1", locale: "fr" });
assert.equal(signup.status, 200);
const lea = signup.session!;
const leaUser = users.byEmail("lea@example.com")!;
// A second account (sign-ups are closed after the first one): made directly.
const marcUser = users.create("marc@example.com", "Marc", "scrypt$x$y", "en");
const marc = `sklubot_session=${createSession(marcUser.id).token}`;
const dev = new Authenticator();

async function addPasskey(a: Authenticator, cookie: string, password = "motdepasse1", name?: string) {
  const o = await call("POST", "/account/passkeys/options", { password }, cookie);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  return call("POST", "/account/passkeys", { flow: o.json.flow, response: a.create(o.json.options), name }, cookie);
}

test("relying party: RP ID and origin from PUBLIC_URL; localhost for development; never an IP or plain http", () => {
  const rp = relyingParty("https://bots.example.test");
  assert.deepEqual([rp.available, rp.rpId, rp.origins("https://evil.example")], [true, "bots.example.test", ["https://bots.example.test"]]);
  const local = relyingParty("http://localhost:8787");
  assert.deepEqual([local.available, local.rpId], [true, "localhost"]);
  assert.deepEqual(local.origins("http://localhost:5173"), ["http://localhost:8787", "http://localhost:5173"], "the Vite dev server");
  assert.deepEqual(local.origins("http://evil.localhost.example:5173"), ["http://localhost:8787"]);
  assert.equal(relyingParty("http://bots.example.test").available, false, "plain http outside localhost");
  assert.equal(relyingParty("https://192.168.1.20").available, false, "an IP address is not an RP ID");
});

test("adding a passkey needs the password; options ask user verification and a discoverable credential", async () => {
  assert.equal((await call("POST", "/account/passkeys/options", {}, lea)).status, 401);
  const wrong = await call("POST", "/account/passkeys/options", { password: "nope-nope" }, lea);
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, /mot de passe est faux/);
  const o = await call("POST", "/account/passkeys/options", { password: "motdepasse1" }, lea);
  assert.equal(o.status, 200);
  assert.equal(o.json.options.rp.id, "bots.example.test");
  assert.equal(Buffer.from(o.json.options.challenge, "base64url").length, 32, "32 random bytes");
  assert.equal(o.json.options.authenticatorSelection.userVerification, "required");
  assert.equal(o.json.options.authenticatorSelection.residentKey, "required");
  assert.equal(o.json.options.attestation, "none");
  assert.notEqual(o.json.options.user.id, leaUser.id, "the user handle is random, not the account id");
  assert.ok(!o.json.options.user.id.includes("lea"), "nor the address");
});

test("register, then the flow cannot be replayed; the passkey is listed and announced", async () => {
  const o = await call("POST", "/account/passkeys/options", { password: "motdepasse1" }, lea);
  const response = dev.create(o.json.options);
  const saved = await call("POST", "/account/passkeys", { flow: o.json.flow, response, name: "Mon téléphone" }, lea);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.passkeys.length, 1);
  assert.equal(saved.json.passkey.name, "Mon téléphone");
  const again = await call("POST", "/account/passkeys", { flow: o.json.flow, response, name: "x" }, lea);
  assert.equal(again.status, 410, "a challenge works once");
  const list = await call("GET", "/account/passkeys", undefined, lea);
  assert.deepEqual([list.json.available, list.json.passkeys.length, list.json.passkeys[0].name], [true, 1, "Mon téléphone"]);
  const bell = q.all<{ kind: string; title: string }>("SELECT kind, title FROM notify_log WHERE user_id = ?", leaUser.id);
  assert.ok(bell.some((b) => b.kind === "security" && /clé d'accès a été ajoutée/.test(b.title)), "the addition is in the bell");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE 'Passkey added%'", leaUser.id));
  // The same authenticator cannot be saved twice (excludeCredentials asks the browser; the server refuses anyway).
  assert.equal((await addPasskey(dev, lea)).status, 409);
});

test("registration refuses another origin, another RP ID and a device that did not verify the user", async () => {
  for (const [opt, want] of [[{ origin: "https://evil.example" }, /pas pu être vérifiée/], [{ rpId: "evil.example" }, /pas pu être vérifiée/], [{ flags: 0x01 }, /n'a pas vérifié que c'est toi/]] as const) {
    const a = new Authenticator(); a.id = Buffer.from("other-device-" + JSON.stringify(opt));
    const o = await call("POST", "/account/passkeys/options", { password: "motdepasse1" }, lea);
    const r = await call("POST", "/account/passkeys", { flow: o.json.flow, response: a.create(o.json.options, opt) }, lea);
    assert.equal(r.status, 400, JSON.stringify(opt));
    assert.match(r.json.error, want);
  }
});

test("sign in with the passkey: a session, no password; replay, wrong origin, expired and cloned answers are refused", async () => {
  const o = await call("POST", "/auth/passkey/options", {}, "");
  assert.equal(o.status, 200);
  assert.deepEqual(o.json.options.allowCredentials, []);
  assert.equal(o.json.options.userVerification, "required");
  const answer = dev.get(o.json.options);
  const ok = await call("POST", "/auth/passkey/verify", { flow: o.json.flow, response: answer }, "");
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.user.email, "lea@example.com");
  assert.ok(ok.session, "a session cookie");
  const me = await call("GET", "/me", undefined, ok.session!);
  assert.equal(me.json.user.email, "lea@example.com");
  // Same flow again: used up. Same answer with a new flow: the challenge does not match.
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: o.json.flow, response: answer }, "")).status, 410);
  const o2 = await call("POST", "/auth/passkey/options", {}, "");
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: o2.json.flow, response: answer }, "")).status, 401, "replayed answer");
  // Another origin (a phishing copy of the page).
  const o3 = await call("POST", "/auth/passkey/options", {}, "");
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: o3.json.flow, response: dev.get(o3.json.options, { origin: "https://bots-example.test.evil" }) }, "")).status, 401);
  // A counter that does not grow: a copied authenticator.
  const o4 = await call("POST", "/auth/passkey/options", {}, "");
  dev.counter--; // the refused answer above moved the device's counter, not the saved one
  const cloned = await call("POST", "/auth/passkey/verify", { flow: o4.json.flow, response: dev.get(o4.json.options, { keepCounter: true }) }, "");
  assert.equal(cloned.status, 401);
  assert.match(cloned.json.error, /counter|copied/);
  // Expired: 5 minutes.
  const o5 = await call("POST", "/auth/passkey/options", {}, "");
  q.run("UPDATE passkey_challenges SET expires_at = ?", Date.now() - 1);
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: o5.json.flow, response: dev.get(o5.json.options) }, "")).status, 410);
  // A cross-site page cannot post it.
  const o6 = await call("POST", "/auth/passkey/options", {}, "");
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: o6.json.flow, response: dev.get(o6.json.options) }, "", "https://evil.example")).status, 403);
  // An unknown passkey says so, without naming any account.
  const stranger = new Authenticator(); stranger.id = Buffer.from("unknown-device-id");
  const o7 = await call("POST", "/auth/passkey/options", {}, "");
  const unknown = await call("POST", "/auth/passkey/verify", { flow: o7.json.flow, response: stranger.get(o7.json.options) }, "");
  assert.equal(unknown.status, 401);
});

test("a login challenge cannot be used to register, nor a registration challenge to sign in", async () => {
  const login = await call("POST", "/auth/passkey/options", {}, "");
  const a = new Authenticator(); a.id = Buffer.from("cross-purpose-device");
  const r = await call("POST", "/account/passkeys", { flow: login.json.flow, response: a.create({ ...login.json.options, user: { id: "x" } }) }, lea);
  assert.equal(r.status, 410);
  const reg = await call("POST", "/account/passkeys/options", { password: "motdepasse1" }, lea);
  assert.equal((await call("POST", "/auth/passkey/verify", { flow: reg.json.flow, response: dev.get(reg.json.options) }, "")).status, 410);
});

test("rename and remove: own passkeys only; the password still signs in once every passkey is gone", async () => {
  const id = (await call("GET", "/account/passkeys", undefined, lea)).json.passkeys[0].id;
  const pk = encodeURIComponent(id);
  assert.equal((await call("PATCH", `/account/passkeys/${pk}`, { name: "Marc's" }, marc)).status, 404, "someone else's");
  assert.equal((await call("DELETE", `/account/passkeys/${pk}`, undefined, marc)).status, 404, "someone else's");
  assert.equal((await call("PATCH", `/account/passkeys/${pk}`, { name: "  " }, lea)).status, 400);
  const renamed = await call("PATCH", `/account/passkeys/${pk}`, { name: "Ordinateur du bureau" }, lea);
  assert.equal(renamed.json.passkey.name, "Ordinateur du bureau");
  const extra = new Authenticator(); extra.id = Buffer.from("second-device-of-lea");
  assert.equal((await addPasskey(extra, lea)).status, 200);
  const extraId = `/account/passkeys/${encodeURIComponent(b64u(extra.id))}`;
  assert.equal((await call("DELETE", extraId, {}, lea)).status, 401, "removing needs the password too");
  assert.equal((await call("DELETE", extraId, { password: "wrong-one" }, lea)).status, 401);
  const removed = await call("DELETE", extraId, { password: "motdepasse1" }, lea);
  assert.equal(removed.json.passkeys.length, 1);
  // Recovery: no passkey at all, the password still works.
  q.run("DELETE FROM passkeys WHERE user_id = ?", leaUser.id);
  const pw = await call("POST", "/auth/login", { email: "lea@example.com", password: "motdepasse1" }, "");
  assert.equal(pw.status, 200);
  dev.counter = 0;
  assert.equal((await addPasskey(dev, lea)).status, 200, "the same device can be added again");
});

test("floor approvals: a passkey proof bound to that card works once, instead of the two-factor code", async () => {
  const bot = bots.byId((await call("GET", "/bots", undefined, lea)).json.bots[0].id)!;
  // Turning the option on: a passkey is enough (no two-factor app on this account).
  const on = await call("PUT", "/security/settings", { floorSecondFactor: true }, lea);
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.passkey, true);
  const card = (n: number) => {
    const seq = rows.append(bot, { kind: "card", card: { type: "approval", approvalId: `apr_floor${n}`, title: "Payer", detail: "", tool: "pay", source: "Banque", status: "pending", irreversible: true } } as any).seq;
    return approvals.create(bot.id, leaUser.id, bot.generation, seq, "pay", `apr_floor${n}`);
  };
  const a1 = card(1), a2 = card(2);
  assert.throws(() => checkFloorApproval(leaUser.id, leaUser.id, a1, "allow", ""), /use your passkey/);
  const proofFor = async (purpose: string) => {
    const o = await call("POST", "/account/passkey-proof/options", { purpose }, lea);
    assert.equal(o.status, 200, JSON.stringify(o.json));
    assert.equal(o.json.options.allowCredentials.length, 1);
    const r = await call("POST", "/account/passkey-proof", { flow: o.json.flow, response: dev.get(o.json.options) }, lea);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.proof as string;
  };
  const p1 = await proofFor(`floor:${a1.id}`);
  assert.throws(() => checkFloorApproval(leaUser.id, leaUser.id, a2, "allow", p1), /not right/, "a proof made for another card");
  const p1b = await proofFor(`floor:${a1.id}`);
  assert.doesNotThrow(() => checkFloorApproval(leaUser.id, leaUser.id, a1, "allow", p1b));
  assert.throws(() => checkFloorApproval(leaUser.id, leaUser.id, a1, "allow", p1b), /not right/, "used once");
  // Someone else's proof is worth nothing for this account.
  assert.equal(consumeProof(marcUser.id, `floor:${a1.id}`, await proofFor(`floor:${a1.id}`)), false);
  // Expired proof.
  const late = await proofFor(`floor:${a2.id}`);
  q.run("UPDATE passkey_proofs SET expires_at = ?", Date.now() - 1);
  assert.throws(() => checkFloorApproval(leaUser.id, leaUser.id, a2, "allow", late), /not right/);
  // A bad purpose is refused; Marc has no passkey.
  assert.equal((await call("POST", "/account/passkey-proof/options", { purpose: "anything" }, lea)).status, 400);
  assert.equal((await call("POST", "/account/passkey-proof/options", { purpose: "floor-off" }, marc)).status, 409);
  // Turning the option off needs a proof made for that.
  assert.equal((await call("PUT", "/security/settings", { floorSecondFactor: false, code: await proofFor(`floor:${a2.id}`) }, lea)).status, 401);
  const off = await call("PUT", "/security/settings", { floorSecondFactor: false, code: await proofFor("floor-off") }, lea);
  assert.equal(off.status, 200);
  assert.equal(securitySettings.get(leaUser.id).floorSecondFactor, false);
});

test("with two-factor on, a passkey sign-in is the second factor itself; the password still asks the code", async () => {
  const s = beginSetup(leaUser);
  confirmSetup(leaUser, totpNow(parseTotp(s.secret)).code);
  const pw = await call("POST", "/auth/login", { email: "lea@example.com", password: "motdepasse1" }, "");
  assert.ok(pw.json.twoFactor, "the password needs the code");
  const o = await call("POST", "/auth/passkey/options", {}, "");
  const r = await call("POST", "/auth/passkey/verify", { flow: o.json.flow, response: dev.get(o.json.options) }, "");
  assert.equal(r.status, 200);
  assert.ok(r.session && !r.json.twoFactor);
});

test("webauthn.ts: CBOR, authenticator data and COSE keys are read strictly", () => {
  assert.deepEqual(decodeCbor(cbor(new Map<number, C>([[1, 2], [-1, "x"]]))), new Map<number | string, unknown>([[1, 2], [-1, "x"]]));
  assert.throws(() => decodeCbor(Buffer.concat([cbor(1), Buffer.from([0])])), WebAuthnError, "bytes left over");
  assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x02, 0x01, 0x03])), /duplicate/);
  assert.throws(() => decodeCbor(Buffer.from([0x9f])), WebAuthnError, "indefinite length");
  let deep: Buffer = cbor(1); for (let i = 0; i < 40; i++) deep = Buffer.concat([Buffer.from([0x81]), deep]);
  assert.throws(() => decodeCbor(deep), /deeply/);
  const a = new Authenticator();
  const ad = parseAuthData(a.authData({ attested: true }));
  assert.deepEqual([ad.flags.up, ad.flags.uv, ad.flags.at, ad.credentialId!.equals(a.id)], [true, true, true, true]);
  assert.throws(() => parseAuthData(Buffer.concat([a.authData(), Buffer.from([1])])), /left over/);
  assert.equal(coseKey(a.cose()).alg, -7);
  assert.throws(() => coseKey(cbor(new Map<number, C>([[1, 2], [3, -36]]))), /not supported/, "only the offered algorithms");
  // Signature over authenticatorData || SHA-256(clientDataJSON), and the counter rule (§6.1.1).
  const cred = { id: b64u(a.id), publicKey: b64u(a.cose()), counter: 5 };
  a.counter = 5;
  assert.throws(() => verifyAssertion(a.get({ challenge: "c" }, { keepCounter: true }), { challenge: "c", origins: [ORIGIN], rpId: HOST }, cred), /counter/);
  assert.equal(verifyAssertion(a.get({ challenge: "c" }), { challenge: "c", origins: [ORIGIN], rpId: HOST }, cred).counter, 6);
  const forged = a.get({ challenge: "c" }); forged.response.signature = b64u(Buffer.alloc(70, 1));
  assert.throws(() => verifyAssertion(forged, { challenge: "c", origins: [ORIGIN], rpId: HOST }, cred), /signature/);
  assert.throws(() => verifyAssertion(a.get({ challenge: "c" }, { type: "webauthn.create" }), { challenge: "c", origins: [ORIGIN], rpId: HOST }, cred), /type/);
});
