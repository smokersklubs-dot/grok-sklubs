import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// /api/health (public, short) and /api/health/deep (the server's owner only).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-mon-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DISK_FREE_MIN_MB = "1";

const { api } = await import("../src/routes.js");
const { pingDocker, resetHealthCache, BACKUP_STATUS_FILE } = await import("../src/monitor.js");

const jars: Record<string, string> = { a: "", b: "", none: "" };
async function call(who: "a" | "b" | "none", method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && who !== "none") jars[who] = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const statusFile = path.join(process.env.DATA_DIR!, BACKUP_STATUS_FILE);

test("the public health check is short: ok/degraded and a code, nothing else", async () => {
  const r = await call("none", "GET", "/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, status: "ok", code: "ok" });
});

test("an old or failed backup makes it degraded (still 200 and ok: true for the apps and the healthcheck)", async () => {
  writeFileSync(statusFile, JSON.stringify({ at: Date.now() - 30 * 3_600_000, archive: "x.tar", ok: true }));
  resetHealthCache();
  assert.deepEqual((await call("none", "GET", "/health")).json, { ok: true, status: "degraded", code: "backup_old" });
  writeFileSync(statusFile, JSON.stringify({ at: Date.now(), ok: false }));
  resetHealthCache();
  const r = await call("none", "GET", "/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, status: "degraded", code: "backup_failed" });
  writeFileSync(statusFile, JSON.stringify({ at: Date.now() - 3_600_000, archive: "sklubot-sauvegarde-1.tar", ok: true, secrets: "age" }));
  resetHealthCache();
  assert.deepEqual((await call("none", "GET", "/health")).json, { ok: true, status: "ok", code: "ok" });
});

test("the detail is for the owner only", async () => {
  await call("a", "POST", "/auth/signup", { email: "owner@example.com", password: "password123" });
  await call("b", "POST", "/auth/signup", { email: "other@example.com", password: "password123" });
  assert.equal((await call("none", "GET", "/health/deep")).status, 401);
  assert.equal((await call("b", "GET", "/health/deep")).status, 404);
  const r = await call("a", "GET", "/health/deep");
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "ok");
  assert.deepEqual(Object.keys(r.json.checks).sort(), ["backup", "db", "disk", "docker", "queue", "scheduler"]);
  assert.equal(r.json.checks.db.state, "ok");
  assert.equal(r.json.checks.docker.state, "off");
  assert.equal(r.json.checks.scheduler.state, "off");
  assert.ok(r.json.checks.disk.detail.freeMb > 0);
  assert.equal(r.json.checks.backup.detail.secrets, "age");
  rmSync(statusFile);
});

test("Docker reachability: a proxy that answers OK, one that is down", async () => {
  const srv = createServer((req, res) => { res.end(req.url === "/_ping" ? "OK" : "no"); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  assert.deepEqual(await pingDocker({ host: "127.0.0.1", port }), { state: "ok", code: "ok" });
  srv.close();
  await new Promise((r) => setTimeout(r, 50));
  const down = await pingDocker({ host: "127.0.0.1", port }, 500);
  assert.equal(down.state, "degraded");
  assert.equal(down.code, "docker_unreachable");
});
