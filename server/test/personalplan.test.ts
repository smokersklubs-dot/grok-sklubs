import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "sklubot-personal-"));
process.env.BOT_LINK = "socket";
process.env.NO_SCHEDULER = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.OPEN_SIGNUP = "1";
process.env.COMPUTER = "browser";
const { api, botLinkRoutes, site } = await import("../src/routes.js");
const { issueEngineToken, revokeEngineToken } = await import("../src/agent/engine.js");
const { beginPersonal, finishPersonal, personalActive, personalModels, personalAccess, disconnectPersonal } =
  await import("../src/personalplan.js");
const original = globalThis.fetch;
after(() => {
  globalThis.fetch = original;
});

test("personal grant is shared by two owned bots only on their own sockets, renewed once and revoked", async () => {
  async function signup() {
    const r = await api.request("/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: randomUUID() + "@example.com", password: "test-password" }),
    });
    assert.equal(r.status, 200);
    return { cookie: r.headers.get("set-cookie")!.split(";")[0], id: ((await r.json()) as any).user.id };
  }
  const owner = await signup(),
    other = await signup();
  const directory = path.join(process.env.DATA_DIR!, "personal-chatgpt");
  mkdirSync(directory);
  writeFileSync(path.join(directory, "owner"), owner.id);
  const { bots } = await import("../src/store.js");
  const first = bots.primary(owner.id)!;
  bots.patch(first.id, { model: "codex:model-a" });
  const second = bots.create(owner.id, { name: "Second" });
  const foreign = bots.primary(other.id)!;
  bots.patch(foreign.id, { model: "codex:model-a" });
  assert.equal(second.model, "codex:model-a");
  assert.throws(() => beginPersonal(other.id, "http://127.0.0.1:4567/auth/callback"));
  const a = beginPersonal(owner.id, "http://127.0.0.1:4567/auth/callback");
  const auth = new URL(a.url);
  assert.equal(auth.origin, "https://auth.openai.com");
  assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
  const pair = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256", use: "sig" };
  const client = "oaiapp_fixture";
  const identity = await new SignJWT({ nonce: a.nonce })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(auth.origin)
    .setAudience(client)
    .setSubject("fixture-subject")
    .setExpirationTime("5m")
    .sign(pair.privateKey);
  let refreshes = 0,
    calls = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url instanceof Request ? url.url : url));
    if (u.pathname.endsWith("openid-configuration"))
      return Response.json({
        issuer: auth.origin,
        jwks_uri: auth.origin + "/jwks",
        revocation_endpoint: auth.origin + "/revoke",
      });
    if (u.pathname === "/jwks") return Response.json({ keys: [jwk] });
    if (u.pathname.endsWith("/oauth/token")) {
      const refresh = String(init?.body).includes("grant_type=refresh_token");
      if (refresh) refreshes++;
      return Response.json({
        access_token: refresh ? "renewed-fixture" : "initial-fixture",
        refresh_token: "refresh-fixture",
        expires_in: refresh ? 3600 : 1,
        id_token: identity,
        scope: "openid chatgpt.tokens.use.direct",
      });
    }
    if (u.pathname === "/v1/models")
      return Response.json({
        models: [
          { slug: "model-a", visibility: "list" },
          { slug: "private", visibility: "hide" },
        ],
      });
    if (u.pathname === "/revoke") return new Response("");
    assert.equal(u.href, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer renewed-fixture");
    const wire = JSON.parse(String(init?.body));
    assert.equal(wire.model, "model-a");
    assert.equal(wire.stream, true);
    assert.equal(wire.store, false);
    calls++;
    return new Response("data: fixture\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  const cb = new URLSearchParams({ code: "fixture", client_id: client, state: a.state });
  await assert.rejects(finishPersonal({ ...a, state: "wrong" }, cb));
  await assert.rejects(finishPersonal({ ...a, nonce: "wrong" }, cb));
  assert.equal(personalActive(owner.id), false);
  await finishPersonal(a, cb);
  assert.deepEqual(personalModels(owner.id), ["model-a"]);
  assert.equal(personalActive(other.id), false);
  assert.equal((await Promise.all([personalAccess(owner.id), personalAccess(owner.id)])).length, 2);
  assert.equal(refreshes, 1);
  const request = (id: string, proof: string, body: unknown = { input: [], store: true }) =>
    new Request("http://local/personal-plan/" + id + "/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer " + proof, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const bot of [first, second]) {
    const link = botLinkRoutes((id) => id === bot.id),
      proof = issueEngineToken(bot.id);
    assert.equal((await link.request(request(bot.id, "invalid"))).status, 401);
    assert.equal((await link.request(request(foreign.id, proof))).status, 404);
    assert.equal(
      (await link.request(request(bot.id, proof, { input: [], previous_response_id: "unrelated" }))).status,
      400,
    );
    assert.equal((await link.request(request(bot.id, proof, { input: [], tools: [{ type: "mcp" }] }))).status, 400);
    assert.equal((await link.request(request(bot.id, proof))).status, 200);
    assert.equal((await site.request(request(bot.id, proof))).status, 404);
    revokeEngineToken(bot.id);
    assert.equal((await link.request(request(bot.id, proof))).status, 401);
  }
  const foreignProof = issueEngineToken(foreign.id);
  assert.equal((await botLinkRoutes(() => true).request(request(foreign.id, foreignProof))).status, 404);
  revokeEngineToken(foreign.id);
  assert.equal(calls, 2);
  await disconnectPersonal(owner.id);
  assert.equal(personalActive(owner.id), false);
  assert.equal(beginPersonal(owner.id, a.redirect).client, client);
});
