// L160 — the demo-server watch (scripts/demo-watch.mjs), with a fake network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDemo, demoBase, watch } from "./demo-watch.mjs";

const res = (status, body, type = "application/json") => ({ status, headers: new Headers({ "content-type": type }), json: async () => body });
const healthy = async (url) => (url.endsWith("/api/health") ? res(200, { ok: true, status: "ok" }) : url.endsWith("/api/me") ? res(200, { user: null }) : res(200, null, "text/html; charset=utf-8"));

test("only https addresses (or http on this computer)", () => {
  assert.equal(demoBase("https://demo.example.fr/"), "https://demo.example.fr");
  assert.equal(demoBase("http://localhost:3000"), "http://localhost:3000");
  assert.equal(demoBase("http://demo.example.fr"), null);
  assert.equal(demoBase("pas une adresse"), null);
});

test("a healthy server passes its 3 reads; degraded still counts as up", async () => {
  const seen = [];
  const r = await checkDemo("https://d.example", async (u, o) => { seen.push(u); return healthy(u, o); });
  assert.equal(r.up, true);
  assert.deepEqual(seen, ["https://d.example/api/health", "https://d.example/api/me", "https://d.example/"]);
  const deg = await checkDemo("https://d.example", async (u) => (u.endsWith("/api/health") ? res(200, { ok: true, status: "degraded", code: "disk" }) : healthy(u)));
  assert.equal(deg.up, true);
  assert.match(deg.lines[0], /dégradé \(disk\)/);
});

test("down, wrong answer and no answer are failures", async () => {
  const down = await checkDemo("https://d.example", async (u) => (u.endsWith("/api/health") ? res(503, { ok: false }) : healthy(u)));
  assert.equal(down.up, false);
  assert.match(down.lines[0], /ÉCHEC {2}\/api\/health répond 503/);
  const other = await checkDemo("https://d.example", async (u) => (u.endsWith("/") ? res(404, null, "text/plain") : healthy(u)));
  assert.match(other.lines[2], /ÉCHEC {2}\/ répond 404/);
  const gone = await checkDemo("https://d.example", async () => { throw new TypeError("fetch failed"); });
  assert.equal(gone.lines.length, 3);
  assert.ok(gone.lines.every((l) => l.startsWith("ÉCHEC")));
});

test("watch: --once gives the exit code; the loop stops after N failures in a row", async () => {
  const log = () => undefined;
  assert.equal(await watch("https://d.example", { once: true, fetchFn: healthy, log }), 0);
  let n = 0;
  const flaky = async (u) => { if (u.endsWith("/api/health")) n++; return n === 2 || n >= 4 ? res(503, {}) : healthy(u); };
  const waits = [];
  const code = await watch("https://d.example", { maxFails: 2, fetchFn: flaky, log, wait: async (ms) => { waits.push(ms); }, rounds: 10 });
  assert.equal(code, 1);
  assert.equal(n, 5, "up, down, up (counter reset), down, down → stop");
  assert.deepEqual(waits, [300_000, 300_000, 300_000, 300_000]);
});
