#!/usr/bin/env node
/**
 * L160 — surveillance du serveur de démonstration pendant la relecture des boutiques (1re cause de rejet : « le serveur
 * de démo ne répondait pas », AUDIT-APP-STORE-COMPLIANCE C1). Sans compte ni clé : il ne fait que lire des pages publiques.
 *
 *   node scripts/demo-watch.mjs https://demo.example.fr --once          un contrôle ; code 0 si tout va bien, 1 sinon
 *   node scripts/demo-watch.mjs https://demo.example.fr --every 5       un contrôle toutes les 5 minutes, sans fin ;
 *                                                                       s'arrête avec le code 1 après 3 échecs de suite
 *                                                                       (--fails N pour changer), pour qu'une tâche
 *                                                                       planifiée (cron, systemd) te prévienne
 *
 * What one check reads (each with a 15 s limit, https only except localhost):
 *   - GET /api/health → 200 with { ok: true } (server/src/routes.ts « /health »: "a Sklubot answers here"; status
 *     "degraded" is reported but still counts as up, as the apps do);
 *   - GET /api/me → 200 JSON (the sign-in screen the reviewer sees first loads it);
 *   - GET / → 200 HTML (the web page behind the address the reviewer types).
 */
import { fileURLToPath } from "node:url";

const LIMIT_MS = 15_000;

/** The demo server's address, cleaned; null when it is not https (or http on this computer). */
export function demoBase(raw) {
  try {
    const u = new URL(String(raw ?? ""));
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

/** One check. `fetchFn` is injected by the tests. Returns { up, lines } (lines in French, one per page read). */
export async function checkDemo(base, fetchFn = fetch) {
  const lines = [];
  let up = true;
  const get = async (path) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), LIMIT_MS);
    try { return await fetchFn(`${base}${path}`, { signal: ctl.signal, redirect: "follow", headers: { accept: path === "/" ? "text/html" : "application/json" } }); }
    finally { clearTimeout(timer); }
  };
  const step = async (path, judge) => {
    try {
      const res = await get(path);
      const verdict = await judge(res);
      if (verdict.ok) lines.push(`OK     ${path} ${verdict.note ?? ""}`.trimEnd());
      else { up = false; lines.push(`ÉCHEC  ${path} ${verdict.note}`); }
    } catch (e) {
      up = false;
      lines.push(`ÉCHEC  ${path} ${e?.name === "AbortError" ? "pas de réponse en 15 s" : `injoignable (${e?.message ?? e})`}`);
    }
  };
  await step("/api/health", async (r) => {
    if (r.status !== 200) return { ok: false, note: `répond ${r.status}` };
    const j = await r.json().catch(() => null);
    if (!j?.ok) return { ok: false, note: "ne dit pas « ok » (ce n'est pas un serveur Sklubot ?)" };
    return { ok: true, note: j.status === "degraded" ? `en service mais dégradé (${j.code ?? "?"})` : "" };
  });
  await step("/api/me", async (r) => (r.status === 200 && /json/.test(r.headers.get("content-type") ?? "") ? { ok: true } : { ok: false, note: `répond ${r.status}` }));
  await step("/", async (r) => (r.status === 200 && /html/.test(r.headers.get("content-type") ?? "") ? { ok: true } : { ok: false, note: `répond ${r.status} (${r.headers.get("content-type") ?? "?"})` }));
  return { up, lines };
}

/** Watches until `maxFails` failures in a row. Returns the exit code. `wait(ms)` is injected by the tests. */
export async function watch(base, { everyMin = 5, maxFails = 3, once = false, fetchFn = fetch, log = console.log, wait = (ms) => new Promise((r) => setTimeout(r, ms)), rounds = Infinity } = {}) {
  let fails = 0;
  for (let i = 0; i < rounds; i++) {
    const { up, lines } = await checkDemo(base, fetchFn);
    log(`[${new Date().toISOString()}] ${base} — ${up ? "en ligne" : "PROBLÈME"}`);
    for (const l of lines) log(`  ${l}`);
    if (once) return up ? 0 : 1;
    fails = up ? 0 : fails + 1;
    if (fails >= maxFails) { log(`Le serveur de démonstration ne répond plus depuis ${fails} contrôles de suite : relance-le avant que la relecture échoue.`); return 1; }
    await wait(everyMin * 60_000);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt; };
  const base = demoBase(args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)));
  if (!base) { console.error("Donne l'adresse https du serveur de démonstration, par exemple : node scripts/demo-watch.mjs https://demo.exemple.fr --once"); process.exit(2); }
  const everyMin = Math.max(1, opt("--every", 5)), maxFails = Math.max(1, opt("--fails", 3));
  process.exit(await watch(base, { everyMin, maxFails, once: args.includes("--once") }));
}
