import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L161, first half: mise de côté après 14 jours, « raccourcis à revoir », « il me manque une capacité », « ce que ce bot
// peut lire et écrire », identité en plusieurs documents, consignes globales, rôles partagés, avatar photo, personnalités
// prêtes, docs_read. Each contract is written here first.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-botcare-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "bc:r";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;
// A docs folder of our own: two pages, a subfolder and a link that leaves the folder (both must stay unreachable).
const DOCS = mkdtempSync(path.join(tmpdir(), "sklubot-docs-"));
writeFileSync(path.join(DOCS, "CANAUX.md"), "# Canaux\n\nPour relier Telegram, ouvre Réglages → Canaux.\n" + "x".repeat(30_000));
writeFileSync(path.join(DOCS, "VOIX.md"), "# Voix\n\nLa voix se règle dans la fiche du bot.\n");
mkdirSync(path.join(DOCS, "audits"));
writeFileSync(path.join(DOCS, "audits", "SECRET.md"), "# Interne\n");
const OUTSIDE = mkdtempSync(path.join(tmpdir(), "sklubot-outside-"));
writeFileSync(path.join(OUTSIDE, "leak.md"), "# Leak\nsecret-outside\n");
symlinkSync(path.join(OUTSIDE, "leak.md"), path.join(DOCS, "LEAK.md"));
process.env.SKLUBOT_DOCS_DIR = DOCS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, users, rows } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { sweepAside, revisitTime } = await import("../src/botcarework.js");
const sharp = (await import("sharp")).default;
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { ToolContext } from "../src/agent/tools.js";

registerProvider({ id: "bc", label: "Scripted", models: ["r"], available: () => true, async runTurn(_req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "r", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

let cookie = "";
async function call(method: string, url: string, body?: unknown, jar?: { cookie: string }, raw?: { bytes: Uint8Array; type: string }) {
  const headers: Record<string, string> = { cookie: jar ? jar.cookie : cookie };
  if (raw) headers["content-type"] = raw.type; else headers["content-type"] = "application/json";
  const res = await api.request(url, { method, headers, body: raw ? raw.bytes : body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) { if (jar) jar.cookie = set.split(";")[0]; else cookie = set.split(";")[0]; }
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, json, buf, headers: res.headers };
}
const other = { cookie: "" };
let userId = "";
const fresh = async (name: string, jar?: { cookie: string }) => (await call("POST", "/bots", { name }, jar)).json.bot as { id: string };
const prompt = (botId: string) => buildSystemPrompt(bots.byId(botId)!, users.byId(bots.byId(botId)!.userId)!, { connectorNames: [], browser: true, shell: true, linux: false } as any);
const tool = (name: string) => builtinTools({}).find((t) => t.spec.name === name)!;
const ctx = (botId: string): ToolContext => ({ bot: bots.byId(botId)!, user: users.byId(bots.byId(botId)!.userId)!, depth: 0, signal: new AbortController().signal, thread: 0 });
const DAY = 86_400_000;

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "bc@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("bc@example.com")!.id;
  assert.equal((await call("POST", "/auth/signup", { email: "bc-other@example.com", password: "password-1", locale: "fr" }, other)).status, 200);
});

// ── 1. Mise de côté après 14 jours ──
test("aside: a bot unused for 14 days goes to « Masqués »; the main, pinned and « jamais » bots stay; use brings it back", async () => {
  const old = await fresh("Ancien");
  const pinned = await fresh("Épinglé");
  const never = await fresh("Jamais");
  const recent = await fresh("Récent");
  bots.patch(pinned.id, { pinned: true });
  assert.equal((await call("PUT", `/bots/${never.id}/aside`, { never: true })).json.never, true);
  const t = Date.now();
  for (const b of [old, pinned, never]) { q.run("UPDATE bots SET created_at = ? WHERE id = ?", t - 15 * DAY, b.id); q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", t - 15 * DAY, b.id); }
  q.run("UPDATE bots SET created_at = ? WHERE user_id = ? AND is_primary = 1", t - 30 * DAY, userId);
  q.run("UPDATE rows SET created_at = ? WHERE bot_id IN (SELECT id FROM bots WHERE user_id = ? AND is_primary = 1)", t - 30 * DAY, userId);
  const r = sweepAside(t);
  assert.deepEqual(r.setAside.filter((id) => bots.byId(id)!.userId === userId), [old.id]);
  assert.equal(bots.byId(old.id)!.listHidden, true);
  for (const b of [pinned, never, recent]) assert.equal(bots.byId(b.id)!.listHidden, false, "kept in the list");
  const v = await call("GET", `/bots/${old.id}/aside`);
  assert.equal(v.json.aside, true);
  assert.equal(v.json.days, 14);
  assert.equal((await call("GET", `/bots/${old.id}/aside`, undefined, other)).status, 404, "account isolation");
  // Nothing deleted: the bot, its chat rows are all there.
  assert.ok(bots.byId(old.id));
  // Used again (a routine run, a message): back by itself on the next pass.
  rows.append(bots.byId(old.id)!, { kind: "message", role: "user", text: "Coucou" } as any, 0);
  assert.deepEqual(sweepAside(Date.now() + 1000).back, [old.id]);
  assert.equal(bots.byId(old.id)!.listHidden, false);
  assert.equal((await call("GET", `/bots/${old.id}/aside`)).json.aside, false);
});

test("aside: « Le ressortir » gives 14 new days; showing it by hand counts too", async () => {
  const b = await fresh("Endormi");
  const t = Date.now();
  q.run("UPDATE bots SET created_at = ? WHERE id = ?", t - 20 * DAY, b.id); q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", t - 20 * DAY, b.id);
  sweepAside(t);
  assert.equal(bots.byId(b.id)!.listHidden, true);
  const back = await call("PUT", `/bots/${b.id}/aside`, { back: true });
  assert.equal(back.json.aside, false);
  assert.equal(bots.byId(b.id)!.listHidden, false);
  assert.equal(sweepAside(Date.now() + DAY).setAside.includes(b.id), false, "not set aside again the next day");
  assert.equal(sweepAside(Date.now() + 15 * DAY).setAside.includes(b.id), true, "14 days later without use: aside again");
  bots.patch(b.id, { listHidden: false }); // shown by hand from the list menu
  sweepAside(Date.now() + 15 * DAY + 1000);
  assert.equal(bots.byId(b.id)!.listHidden, false, "the owner's choice wins on the next pass");
  assert.equal((await call("PUT", `/bots/${b.id}/aside`, { never: "yes" })).status, 400);
});

// ── 2. Raccourcis à revoir ──
test("shortcuts: the bot notes one; the owner sees it with its bot; no moment to revisit is flagged; a due one comes first", async () => {
  const b = await fresh("Prospection");
  const a = await tool("shortcut_note").run({ what: "J'ai pris les 50 premiers prospects", leaves_out: "Les 400 suivants", revisit: "dans 2 semaines" }, ctx(b.id));
  assert.equal(a.isError, undefined);
  await tool("shortcut_note").run({ what: "Taux de TVA estimé à 20 %" }, ctx(b.id));
  await tool("shortcut_note").run({ what: "Liste partielle des fournisseurs", revisit: "2020-01-01" }, ctx(b.id));
  assert.equal((await tool("shortcut_note").run({}, ctx(b.id))).isError, true, "what is required");
  const list = (await call("GET", "/bot-shortcuts")).json.items;
  assert.equal(list.length, 3);
  assert.equal(list[0].what, "Liste partielle des fournisseurs");
  assert.equal(list[0].due, true);
  assert.equal(list[1].noRevisit, true);
  const two = list.find((s: any) => s.what.startsWith("J'ai pris"));
  assert.equal(two.botName, "Prospection");
  assert.ok(Math.abs(two.revisitAt - (Date.now() + 14 * DAY)) < 60_000);
  assert.equal((await call("GET", "/bot-shortcuts", undefined, other)).json.items.length, 0, "account isolation");
  assert.equal((await call("POST", `/bot-shortcuts/${two.id}/done`, undefined, other)).status, 404);
  assert.equal((await call("POST", `/bot-shortcuts/${two.id}/done`)).json.items.length, 2);
  assert.equal((await call("DELETE", `/bot-shortcuts/${list[0].id}`)).json.items.length, 1);
  assert.equal(revisitTime("le 2027-03-01"), Date.UTC(2027, 2, 1));
  assert.equal(revisitTime("quand le client répond"), null);
});

// ── 3. Il me manque une capacité ──
test("capability_gap: a card in the chat, a line for the owner, the same need counted once; nothing goes out", async () => {
  const b = await fresh("Agenda");
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { calls++; return realFetch(...args); }) as typeof fetch;
  try {
    const r = await tool("capability_gap").run({ what: "Lire mon agenda Google", why: "Tu m'as demandé mes rendez-vous de demain", tried: "Aucun outil d'agenda" }, ctx(b.id));
    assert.match(String(r.content), /Nothing was installed/);
    await tool("capability_gap").run({ what: "lire mon agenda google" }, ctx(b.id));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 0, "no network");
  const all = q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND kind = 'notice'", b.id).map((x) => JSON.parse(x.body));
  assert.equal(all.length, 2);
  assert.match(all[0].text, /Capacité manquante notée pour toi : Lire mon agenda Google/);
  assert.deepEqual(all[0].action, { kind: "settings", section: "team" });
  const gaps = (await call("GET", "/capability-gaps")).json.items;
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].times, 2);
  assert.equal(gaps[0].botName, "Agenda");
  assert.equal((await call("GET", "/capability-gaps", undefined, other)).json.items.length, 0);
  assert.equal((await call("POST", `/capability-gaps/${gaps[0].id}/done`, undefined, other)).status, 404);
  assert.equal((await call("POST", `/capability-gaps/${gaps[0].id}/done`)).json.items.length, 0);
  assert.equal((await tool("capability_gap").run({}, ctx(b.id))).isError, true);
});

// ── 4. Ce que ce bot peut lire et écrire ──
test("reach card: derived from the bot's real tools; a family switched off disappears; apps only when allowed", async () => {
  const b = await fresh("Lecteur");
  const card = (await call("GET", `/bots/${b.id}/read-write`)).json;
  const fam = (g: string) => card.families.find((f: any) => f.group === g);
  assert.ok(fam("memory"), "memory family");
  assert.ok(fam("general").reads.includes("docs_read"), "a read-only tool is a read");
  assert.ok(card.families.some((f: any) => f.asks.length > 0), "some tools ask first");
  const all = card.families.flatMap((f: any) => [...f.reads, ...f.acts, ...f.asks]);
  const real = builtinTools({ owner: userId, disabled: bots.byId(b.id)!.disabledTools }).map((t) => t.spec.name);
  assert.deepEqual([...new Set(all)].sort(), [...new Set(real)].sort(), "exactly the tools of its next turn");
  assert.deepEqual(card.apps, []);
  await call("PATCH", `/bots/${b.id}`, { disabledTools: ["memory"] });
  const off = (await call("GET", `/bots/${b.id}/read-write`)).json;
  assert.ok(off.off.includes("memory"));
  assert.equal(off.families.find((f: any) => f.group === "memory"), undefined);
  assert.equal((await call("GET", `/bots/${b.id}/read-write`, undefined, other)).status, 404);
  assert.doesNotMatch(JSON.stringify(off), /token_enc|sk-[A-Za-z0-9]{6}|"secret":/, "no secret value");
});

// ── 5 & 9. Identité en plusieurs documents, personnalités prêtes ──
test("identity: named documents reach the bot's instructions; 8 at most; a personality writes « Caractère » first", async () => {
  const b = await fresh("Plume");
  assert.doesNotMatch(prompt(b.id), /## Who you are/, "nothing added for a bot without documents");
  const d = await call("POST", `/bots/${b.id}/identity`, { title: "Style", body: "Phrases courtes, jamais d'anglicismes." });
  assert.equal(d.status, 200);
  assert.match(prompt(b.id), /## Who you are: Style\nPhrases courtes, jamais d'anglicismes\./);
  assert.equal((await call("POST", `/bots/${b.id}/identity`, { title: "Vide", body: "  " })).json.error, "Ce document est vide.");
  assert.equal((await call("POST", `/bots/${b.id}/identity`, { title: "Long", body: "x".repeat(4001) })).status, 400);
  const p = await call("POST", `/bots/${b.id}/identity/personality`, { personality: "direct" });
  assert.equal(p.json.docs[0].title, "Caractère : Direct et bref");
  await call("POST", `/bots/${b.id}/identity/personality`, { personality: "calme" });
  const list = (await call("GET", `/bots/${b.id}/identity`)).json;
  assert.equal(list.docs.length, 2, "the personality replaces the previous one");
  assert.equal(list.docs[0].title, "Caractère : Calme et posé");
  assert.equal(list.personalities.length, 6);
  assert.ok(prompt(b.id).indexOf("Who you are: Caractère") < prompt(b.id).indexOf("Who you are: Style"));
  const upd = await call("PUT", `/bots/${b.id}/identity/${d.json.doc.id}`, { title: "Style maison", body: "Tutoiement." });
  assert.equal(upd.json.doc.title, "Style maison");
  for (let i = 0; i < 6; i++) assert.equal((await call("POST", `/bots/${b.id}/identity`, { title: `Doc ${i}`, body: "texte" })).status, 200);
  assert.equal((await call("POST", `/bots/${b.id}/identity`, { title: "Neuvième", body: "texte" })).status, 409);
  assert.equal((await call("POST", `/bots/${b.id}/identity/personality`, { personality: "inconnue" })).status, 404);
  assert.equal((await call("GET", `/bots/${b.id}/identity`, undefined, other)).status, 404);
  assert.equal((await call("DELETE", `/bots/${b.id}/identity/${d.json.doc.id}`, undefined, other)).status, 404);
  assert.equal((await call("DELETE", `/bots/${b.id}/identity/${d.json.doc.id}`)).json.docs.length, 7);
});

// ── 6. Consignes pour tous les bots ──
test("global instructions: one text every bot of the account receives, new bots included; never another account's", async () => {
  const before = await fresh("Avant");
  assert.equal((await call("PUT", "/global-instructions", { text: "Réponds toujours en français." })).status, 200);
  const after = await fresh("Après");
  for (const b of [before, after]) assert.match(prompt(b.id), /## Instructions from .+ for every bot\nRéponds toujours en français\./);
  const theirs = await fresh("Autre", other);
  assert.doesNotMatch(prompt(theirs.id), /Réponds toujours en français/);
  assert.equal((await call("GET", "/global-instructions")).json.text, "Réponds toujours en français.");
  assert.equal((await call("GET", "/global-instructions", undefined, other)).json.text, "");
  assert.equal((await call("PUT", "/global-instructions", { text: "x".repeat(4001) })).status, 400);
  await call("PUT", "/global-instructions", { text: "" });
  assert.doesNotMatch(prompt(after.id), /for every bot\n/);
});

// ── 7. Rôles partagés ──
test("shared roles: an edited role reaches every bot of that role; « Rétablir » goes back to the product's text", async () => {
  const r1 = await fresh("Relecteur 1");
  const r2 = await fresh("Relecteur 2");
  const roles = (await call("GET", "/shared-roles")).json.roles;
  assert.equal(roles.filter((r: any) => r.builtin).length, 6);
  for (const b of [r1, r2]) assert.equal((await call("PUT", `/bots/${b.id}/shared-role`, { roleId: "relecteur" })).json.roleId, "relecteur");
  assert.match(prompt(r1.id), /## Your shared role: Relecteur\n/);
  const edited = await call("PUT", "/shared-roles/relecteur", { name: "Relecteur", text: "Relis aussi les liens." });
  assert.equal(edited.json.role.modified, true);
  for (const b of [r1, r2]) assert.match(prompt(b.id), /Relis aussi les liens\./);
  const listed = (await call("GET", "/shared-roles")).json.roles.find((r: any) => r.id === "relecteur");
  assert.deepEqual(listed.bots.map((x: any) => x.name).sort(), ["Relecteur 1", "Relecteur 2"]);
  await call("DELETE", "/shared-roles/relecteur");
  assert.doesNotMatch(prompt(r1.id), /Relis aussi les liens/);
  assert.match(prompt(r1.id), /fautes, chiffres, noms/);
  const custom = await call("POST", "/shared-roles", { name: "Veilleur", text: "Surveille les prix." });
  const cid = custom.json.role.id;
  assert.equal((await call("PUT", `/bots/${r2.id}/shared-role`, { roleId: cid })).status, 200);
  const theirs = await fresh("Leur bot", other);
  assert.equal((await call("PUT", `/bots/${theirs.id}/shared-role`, { roleId: cid }, other)).status, 404, "another account cannot use A's role");
  assert.equal((await call("PUT", `/shared-roles/${cid}`, { name: "X", text: "Y" }, other)).status, 404);
  await call("DELETE", `/shared-roles/${cid}`);
  assert.equal((await call("GET", `/bots/${r2.id}/shared-role`)).json.roleId, null, "a removed own role leaves its bots without one");
  assert.equal((await call("PUT", `/bots/${r2.id}/shared-role`, { roleId: "nope" })).status, 404);
  assert.equal((await call("POST", "/shared-roles", { name: "", text: "x" })).status, 400);
});

// ── 8. Avatar photo ──
test("photo: any picture becomes a 256 px square WebP without metadata, served to the owner only; not a picture is refused", async () => {
  const b = await fresh("Photo");
  const png = await sharp({ create: { width: 1000, height: 600, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().withMetadata({ exif: { IFD0: { Artist: "Quelqu'un" } } }).toBuffer();
  const up = await call("PUT", `/bots/${b.id}/photo`, undefined, undefined, { bytes: png, type: "image/png" });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.match(up.json.url, new RegExp(`^/api/bots/${b.id}/photo\\?v=\\d+$`));
  const got = await call("GET", `/bots/${b.id}/photo`);
  assert.equal(got.headers.get("content-type"), "image/webp");
  const meta = await sharp(got.buf).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.exif], ["webp", 256, 256, undefined]);
  assert.equal((await call("GET", `/bots/${b.id}/photo`, undefined, other)).status, 404, "account isolation");
  assert.equal((await call("GET", "/bot-photos")).json.photos[b.id], up.json.url);
  assert.deepEqual((await call("GET", "/bot-photos", undefined, other)).json.photos, {});
  const bad = await call("PUT", `/bots/${b.id}/photo`, undefined, undefined, { bytes: Buffer.from("<svg onload=alert(1)>"), type: "image/svg+xml" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /JPEG, PNG ou WebP/);
  assert.equal((await call("DELETE", `/bots/${b.id}/photo`)).json.removed, true);
  assert.equal((await call("GET", `/bots/${b.id}/photo`)).status, 404);
});

// ── 10. docs_read ──
test("docs_read: the index, a page by parts, a search; nothing outside the top of docs/ can be read", async () => {
  const b = await fresh("Aide");
  const run = (a: Record<string, unknown>) => tool("docs_read").run(a, ctx(b.id));
  const index = String((await run({})).content);
  assert.match(index, /CANAUX\.md — Canaux/);
  assert.match(index, /VOIX\.md — Voix/);
  assert.doesNotMatch(index, /SECRET|audits/);
  const page = String((await run({ name: "canaux" })).content);
  assert.match(page, /^# docs\/CANAUX\.md \(part 1 of 3\)/);
  assert.match(String((await run({ name: "CANAUX.md", part: 3 })).content), /part 3 of 3/);
  for (const bad of ["../README.md", "audits/SECRET.md", "/etc/passwd", "LEAK.md"]) {
    const r = await run({ name: bad });
    assert.equal(r.isError, true, bad);
    assert.doesNotMatch(String(r.content), /secret-outside|Interne/);
  }
  assert.match(String((await run({ search: "relier telegram" })).content), /CANAUX\.md:3: Pour relier Telegram/);
  assert.equal(tool("docs_read").parallel, true, "read-only");
  assert.ok(builtinTools({ owner: userId }).some((t) => t.spec.name === "docs_read"), "the tool is offered to every bot");
});
