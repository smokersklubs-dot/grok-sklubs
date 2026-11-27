import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Équipe Sklubot (.md) » (teammd.ts, teammdimport.ts, teammdyaml.ts, docs/FORMAT-EQUIPE.md): a whole team in one
// Markdown file. What is written reads back the same; a preview creates nothing; secrets and forbidden fields are
// stripped and reported; routines arrive paused; the hosted plan's limits refuse before anything is written; an address
// is fetched over https through the network guard with a 512 KB cap; re-importing offers update or copy; a file never
// reaches another account's bots; a malformed header gives a sentence, with its line.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-teammd-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "tmdscript:m-1";
delete process.env.MAX_BOTS;
delete process.env.ALLOW_PRIVATE_FETCH;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows, skills } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const { libraryEntries } = await import("../src/skillslibrary.js");
const md = await import("../src/teammd.js");
const imp = await import("../src/teammdimport.js");
const { yamlRead, yamlWrite, YamlError } = await import("../src/teammdyaml.js");
const { teamMdTools } = await import("../src/agent/teamexport.js");
const { DEFAULT_CHARACTER } = await import("../src/shared.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "tmdscript", label: "Script", models: ["m-1", "m-2"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ok");
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "m-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, host: "bots.example.test", ...(cookie ? { cookie } : {}) }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const A = client(), B = client(), Free = client();
const ids: Record<string, string> = {};
const SECRET = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const count = (sql: string, ...p: string[]) => q.get<{ n: number }>(sql, ...p)!.n;
const footprint = (userId: string) => ({
  bots: count("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", userId),
  skills: count("SELECT COUNT(*) AS n FROM skills s JOIN bots b ON b.id = s.bot_id WHERE b.user_id = ?", userId),
  routines: count("SELECT COUNT(*) AS n FROM routines r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ?", userId),
  sections: count("SELECT COUNT(*) AS n FROM bot_sections WHERE user_id = ?", userId),
  connectors: count("SELECT COUNT(*) AS n FROM connectors WHERE user_id = ?", userId),
  vault: count("SELECT COUNT(*) AS n FROM vault WHERE user_id = ?", userId),
  memories: count("SELECT COUNT(*) AS n FROM memories m JOIN bots b ON b.id = m.bot_id WHERE b.user_id = ?", userId),
});
const LIB = libraryEntries()[0];

// ── The format ───────────────────────────────────────────────────────────────────────────────────────────────────
const SAMPLE: Parameters<typeof md.writeTeamMd>[0] = {
  meta: { id: "agence-test-1a2b", name: "Agence « test » : contenu", description: "Trois bots, des \"guillemets\", un # et des : deux-points.", version: "1.2", language: "fr", author: "Moi", chief: "Léa" },
  bots: [
    {
      name: "Léa", role: "Coordonne : vite et bien", personality: "Directe.\nUn peu drôle.",
      instructions: "Toujours un brouillon.\n---\n## Pas un titre\n  indenté de deux espaces\n- clé: pas un champ\n\n# fin",
      look: { shape: "cat", color: "plum", character: { ...DEFAULT_CHARACTER, type: "mascot", eyes: "visor", accessory: "cap", idle: "bounce" } },
      model: "tmdscript:m-2",
      skills: [{ kind: "library", libraryId: LIB.id }, { kind: "inline", name: "Devis express", when: "Quand un client demande un prix", body: "1. Lire\n2. Chiffrer\n---\nname: pas un en-tête" }],
      routines: [{ name: "Relances", cron: "0 9 * * 1-5", timezone: "Europe/Paris", task: "Relance les devis.\n\nDeuxième paragraphe." }],
    },
    { name: "Max", role: "Rédige", personality: "", instructions: "commence ici\n  puis indenté", look: { shape: null, color: null, character: { ...DEFAULT_CHARACTER } }, model: "", skills: [], routines: [] },
    { name: "Zoé", role: "", personality: "", instructions: "", look: { shape: "pebble", color: "teal", character: { ...DEFAULT_CHARACTER } }, model: "", skills: [], routines: [] },
  ],
  groups: [{ name: "Comité", members: ["Léa", "Max", "Zoé"], rule: "auto", lead: "Léa" }],
  connectors: [{ name: "Google Drive", for: ["Max"], why: "lire les briefs" }, { name: "Mon outil maison", for: [], why: "" }],
};

test("format: what is written reads back the same (round trip), structure-like lines inside texts included", () => {
  const text = md.writeTeamMd(SAMPLE, "fr");
  assert.match(text, /^---\nformat: sklubot-team\/1\nid: agence-test-1a2b\n/);
  assert.match(text, /\n---\n\n# Agence « test » : contenu\n/, "a playbook follows the header");
  assert.match(text, /Importer une équipe \(\.md\)/);
  const p = md.parseTeamMd(text, { locale: "fr" });
  assert.deepEqual(p.removed, []);
  assert.deepEqual(p.masked, []);
  assert.equal(p.meta.name, SAMPLE.meta.name);
  assert.equal(p.meta.description, SAMPLE.meta.description);
  assert.equal(p.meta.id, "agence-test-1a2b");
  assert.equal(p.meta.chief, "Léa");
  assert.equal(p.bots.length, 3);
  for (const [i, b] of SAMPLE.bots.entries()) {
    const r = p.bots[i];
    assert.equal(r.name, b.name);
    assert.equal(r.role, b.role);
    assert.equal(r.personality, b.personality.trim());
    assert.equal(r.instructions, b.instructions.trim(), `instructions of ${b.name}`);
    assert.equal(r.look.shape, b.look.shape);
    assert.equal(r.look.color, b.look.color);
    assert.equal(r.look.character.type, b.look.character.type);
    assert.equal(r.model, b.model);
    assert.equal(r.routines.length, b.routines.length);
  }
  assert.equal(p.bots[0].chief, true);
  assert.equal(p.bots[0].look.character.eyes, "visor");
  assert.deepEqual(p.bots[0].skills.map((s) => [s.kind, s.kind === "library" ? s.libraryId : s.name]), [["library", LIB.id], ["inline", "Devis express"]]);
  assert.equal(p.bots[0].skills[0].known, true);
  assert.equal(p.bots[0].skills[1].when, "Quand un client demande un prix");
  assert.equal(p.bots[0].skills[1].body, "1. Lire\n2. Chiffrer\n---\nname: pas un en-tête");
  assert.deepEqual(p.bots[0].routines[0], { name: "Relances", cron: "0 9 * * 1-5", timezone: "Europe/Paris", task: "Relance les devis.\n\nDeuxième paragraphe.", describe: p.bots[0].routines[0].describe });
  assert.deepEqual(p.groups, [{ name: "Comité", members: ["Léa", "Max", "Zoé"], rule: "auto", lead: "Léa", missing: [] }]);
  assert.deepEqual(p.connectors.map((c) => [c.name, c.inCatalog, c.for]), [["Google Drive", true, ["Max"]], ["Mon outil maison", false, []]]);
  // Written again from what was read: the same file.
  const again = md.writeTeamMd({ ...SAMPLE, bots: p.bots.map((b, i) => ({ ...SAMPLE.bots[i], instructions: b.instructions })) }, "fr");
  assert.equal(again, text);
});

test("the YAML subset: refused constructs give a reason and a line, never a crash", () => {
  const cases: [string, RegExp][] = [
    ["a: &x 1", /Anchors/], ["a: *x", /Aliases/], ["a: !!python/object x", /Tags/], ["<<: {}", /Merge/], ["a: 1\na: 2", /given twice/],
    ["__proto__: x", /not allowed/], ["a:\n\tb: 1", /tabs/], ["a: {b: 1}", /one key per line/], ["? a\n: b", /Complex/], ["a: \"open", /not closed/],
    ["a: [x, [y]]", /inside lists/], ["- a\n- b", /not a list/], ["a: 1\n  b: 2", /indented more/],
  ];
  for (const [src, re] of cases) {
    assert.throws(() => yamlRead(src), (e: unknown) => e instanceof YamlError && re.test(e.reason) && e.line >= 1, src);
  }
  assert.match(new YamlError(3, "The key “{key}” is given twice.", { key: "x" }).message, /line 3: The key “x”/);
  const v = yamlRead("a: x\nlist:\n- 1\n- \"deux\"\nn: |+\n  t\n\nm: >-\n  un\n  deux\nempty: []\nobj: {}");
  assert.deepEqual(JSON.parse(JSON.stringify(v)), { a: "x", list: ["1", "deux"], n: "t\n\n", m: "un deux", empty: [], obj: {} });
  assert.equal(Object.getPrototypeOf(v), null, "maps have no prototype");
  // Every value is text: no number, boolean or date is guessed.
  assert.deepEqual(JSON.parse(JSON.stringify(yamlRead("v: 1.10\nb: no\nd: 2024-01-01"))), { v: "1.10", b: "no", d: "2024-01-01" });
  assert.deepEqual(JSON.parse(JSON.stringify(yamlRead(yamlWrite({ s: "a: b # c", t: "true", n: "x\n  y" })))), { s: "a: b # c", t: "true", n: "x\n  y" });
});

test("setup: an operator, a stranger and a customer on the free plan", async () => {
  ids.a = (await A("POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr" })).json.user.id;
  const b = await B("POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123", plan: "free", acceptTerms: true, locale: "fr" });
  assert.equal(b.status, 200, b.text);
  ids.b = b.json.user.id;
  const f = await Free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "free", acceptTerms: true, locale: "fr" });
  assert.equal(f.status, 200, f.text);
  ids.free = f.json.user.id;
  ids.taken = (await A("POST", "/bots", { name: "Max" })).json.bot.id;
});

test("a malformed file is refused with a sentence in the user's language (and its line)", async () => {
  const bad: [string, RegExp][] = [
    ["", /vide/],
    ["Juste du texte", /n'a pas d'en-tête/],
    ["---\nformat: sklubot-team/1\nbots:\n  - name: X\n", /n'est pas fermé/],
    ["---\nformat: sklubot-team/1\nbots:\n  - name: &a X\n---\n", /ligne 4 : Les ancres/],
    ["---\nformat: sklubot-team/1\nname: a\nname: b\n---\n", /ligne 4 : La clé « name » est donnée deux fois/],
    ["---\nformat: sklubot-equipe\nversion: 1\n---\n## Bot: X", /ancien fichier/],
    ["---\nname: Sans format\n---\n", /ne dit pas son format/],
    ["---\nformat: autre-chose\n---\n", /n'est pas un fichier d'équipe/],
    ["---\nformat: sklubot-team/1\nname: Vide\n---\n", /aucun bot/],
    ["<!doctype html><p>page</p>", /page web/],
  ];
  const before = footprint(ids.a);
  for (const [text, re] of bad) {
    const r = await A("POST", "/team-md/preview", { text });
    assert.equal(r.status, 400, `${text}: ${r.text}`);
    assert.match(r.json.error, re, text);
  }
  const huge = await A("POST", "/team-md/preview", { text: `---\nformat: sklubot-team/1\nbots:\n  - name: X\n---\n${"x".repeat(530_000)}` });
  assert.equal(huge.status, 413);
  assert.match(huge.json.error, /512 Ko/);
  assert.deepEqual(footprint(ids.a), before);
});

const RISKY = `---
format: sklubot-team/1
id: risque-0001
name: Équipe risquée
api_key: ${SECRET}
memory: ["tout ce que je sais"]
bots:
  - name: Nina
    role: Compta
    autonomy: autonomous
    computer: { }
    vault: ["carte bleue"]
    chats: ["bonjour"]
    model: up-1234:secret-model
    instructions: |
      Mon jeton est ${SECRET}, garde-le.
    skills:
      - name: Facturer
        when: Fin de mois
        steps: |
          export OPENAI_API_KEY=abcdefghijklmnopqrstuvwxyz123456
      - library: n-existe-pas
    routines:
      - name: Clôture
        cron: "0 18 28 * *"
        paused: false
        task: Clôturer le mois.
      - name: Sans horaire
        schedule: tous les jours
        task: Ranger.
  - name: Omar
    permissions: all
connectors:
  - name: Stripe
    url: https://evil.example/mcp
    token: ${SECRET}
  - name: https://evil.example/x
---

# Mode d'emploi

Le mot de passe est hunter2hunter2.
`;

test("secrets and forbidden fields: stripped and listed (never their value); key-like skills flagged; nothing created", async () => {
  const before = footprint(ids.a);
  const p = await A("POST", "/team-md/preview", { text: RISKY, filename: "risque.md" });
  assert.equal(p.status, 200, p.text);
  assert.deepEqual(footprint(ids.a), before, "a preview creates nothing");
  assert.ok(!p.text.includes(SECRET), "no secret in the preview");
  assert.ok(!p.text.includes("hunter2hunter2"));
  assert.ok(!p.text.includes("abcdefghijklmnopqrstuvwxyz123456") || p.json.bots[0].skills[0].mentionsKey);
  assert.deepEqual(p.json.source, { kind: "file", label: "risque.md" });
  const removed = p.json.removed.map((r: any) => `${r.where}|${r.field}|${r.reason}`);
  for (const want of ["en-tête|api_key|secret", "en-tête|memory|forbidden", "Nina|autonomy|forbidden", "Nina|computer|forbidden", "Nina|vault|forbidden", "Nina|chats|forbidden", "Nina|model|unknown", "Omar|permissions|forbidden", "appli 1|url|forbidden", "appli 1|token|secret"]) {
    assert.ok(removed.includes(want), `${want} in ${removed.join(", ")}`);
  }
  assert.ok(p.json.masked.length >= 2, "the key in the instructions and the password in the playbook are masked");
  const nina = p.json.bots[0];
  assert.equal(nina.model, "", "an account's own provider is never taken from a file");
  assert.match(nina.instructions, /\[secret retiré\]/);
  assert.equal(nina.skills[0].mentionsKey, true);
  assert.deepEqual([nina.skills[1].kind, nina.skills[1].known], ["library", false]);
  assert.deepEqual(nina.unscheduled, ["Sans horaire (tous les jours)"]);
  assert.deepEqual(p.json.connectors.map((c: any) => c.name), ["Stripe"]);
  const codes = p.json.warnings.map((w: any) => w.code);
  for (const c of ["unknown_library", "key_like", "routine_no_cron"]) assert.ok(codes.includes(c), c);
  assert.match(p.json.playbook, /Mode d'emploi/);

  const r = await A("POST", "/team-md/commit", { previewId: p.json.previewId, mode: "create", bots: [{ index: 0, include: true }, { index: 1, include: true }] });
  assert.equal(r.status, 200, r.text);
  const made = bots.byId(r.json.report.created[0].id)!;
  assert.equal(made.autonomy, "careful");
  assert.equal(made.model, "");
  assert.ok(!made.instructions.includes(SECRET));
  // The routine arrives paused whatever the file says; the unknown library skill is skipped; the file's skill is a draft.
  const rt = routines.forBot(made.id);
  assert.equal(rt.length, 1);
  assert.equal(rt[0].enabled, false);
  assert.deepEqual(skills.list(made.id).map((s) => [s.name, s.draft]), [["Facturer", true]]);
  assert.equal(footprint(ids.a).connectors, before.connectors, "no app is connected");
  assert.equal(footprint(ids.a).vault, before.vault);
  assert.equal(footprint(ids.a).memories, before.memories);
  const notice = rows.list(made.id, made.generation).map((x: any) => x.body).find((x: any) => x.kind === "notice");
  assert.match(notice.text, /Stripe/);
  assert.match(notice.text, /prudent|careful/i);
});

const TEAM = md.writeTeamMd(SAMPLE, "fr");

test("commit: bots, skills (library active, file's own as drafts), paused routines, the group and its rule, a section; a taken name is renamed", async () => {
  const p = await A("POST", "/team-md/preview", { text: TEAM });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.existing, null);
  assert.equal(p.json.hasPrimary, true);
  const max = p.json.bots[1];
  assert.deepEqual([max.name, max.nameTaken, max.suggestedName], ["Max", true, "Max (2)"]);
  assert.equal(p.json.bots[0].modelAvailable, true);
  const before = footprint(ids.a);
  const r = await A("POST", "/team-md/commit", {
    previewId: p.json.previewId, mode: "create", section: "Agence",
    bots: [{ index: 0, include: true, useModel: true }, { index: 1, include: true }, { index: 2, include: true, name: "Zoé bis" }],
  });
  assert.equal(r.status, 200, r.text);
  const rep = r.json.report;
  assert.deepEqual(rep.created.map((b: any) => b.name), ["Léa", "Max (2)", "Zoé bis"]);
  assert.equal(rep.skills, 2);
  assert.equal(rep.routines, 1);
  assert.equal(rep.section.name, "Agence");
  assert.equal(footprint(ids.a).bots, before.bots + 4, "three bots and one group");
  const lea = bots.byId(rep.created[0].id)!;
  assert.equal(lea.model, "tmdscript:m-2", "the suggested brain, ticked and available");
  assert.equal(bots.byId(rep.created[1].id)!.model, "");
  assert.equal(lea.sectionId, rep.section.id);
  assert.deepEqual(skills.list(lea.id).map((s) => [s.name, s.draft]), [[LIB.title.fr, false], ["Devis express", true]]);
  assert.ok(routines.forBot(lea.id).every((x) => !x.enabled));
  const room = bots.byId(rep.groups[0].id)!;
  assert.equal(room.kind, "room");
  assert.equal(room.roomRule, "auto");
  assert.deepEqual(room.memberIds, rep.created.map((b: any) => b.id), "the lead first");
  assert.equal(room.sectionId, rep.section.id);
  ids.lea = lea.id; ids.section = rep.section.id; ids.room = room.id;
  // The preview is used up.
  assert.equal((await A("POST", "/team-md/commit", { previewId: p.json.previewId, mode: "create", bots: [{ index: 0, include: true }] })).status, 400);
});

test("re-import: « Mettre à jour » changes the same bots in place (nothing duplicated); « Créer une copie » makes new ones", async () => {
  const changed = TEAM.replace("Toujours un brouillon.", "Toujours deux brouillons.");
  const p = await A("POST", "/team-md/preview", { text: changed });
  assert.equal(p.json.existing.bots, 3);
  assert.equal(p.json.bots[0].existingId, ids.lea);
  assert.equal(p.json.groups[0].existingId, ids.room);
  const before = footprint(ids.a);
  const u = await A("POST", "/team-md/commit", { previewId: p.json.previewId, mode: "update", section: "Agence", bots: [0, 1, 2].map((index) => ({ index, include: true })) });
  assert.equal(u.status, 200, u.text);
  assert.deepEqual(u.json.report.created, []);
  assert.equal(u.json.report.updated.length, 3);
  assert.deepEqual(footprint(ids.a), before, "no new bot, skill, routine or section");
  assert.match(bots.byId(ids.lea)!.instructions, /deux brouillons/);
  assert.equal(u.json.report.groups[0].id, ids.room);

  const p2 = await A("POST", "/team-md/preview", { text: changed });
  const c = await A("POST", "/team-md/commit", { previewId: p2.json.previewId, mode: "copy", bots: [{ index: 0, include: true }, { index: 1, include: true }] });
  assert.equal(c.status, 200, c.text);
  assert.deepEqual(c.json.report.created.map((b: any) => b.name), ["Léa (2)", "Max (3)"]);
  // The link still points at the first team.
  const p3 = await A("POST", "/team-md/preview", { text: changed });
  assert.equal(p3.json.bots[0].existingId, ids.lea);
});

test("share: a section's file has its bots, group and app names, never a secret, a memory or a key; it imports back the same elsewhere", async () => {
  bots.patch(ids.lea, { instructions: `Garde ${SECRET} pour toi.` });
  q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, auth, created_at) VALUES ('con_tmd1', ?, 'GitHub', 'https://api.githubcopilot.com/mcp/', 'sealed', 'token', 0)", ids.a);
  q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, auth, created_at) VALUES ('con_tmd2', ?, 'Serveur interne prod', 'https://10.0.0.1/', NULL, 'none', 0)", ids.a);
  const e = await A("POST", "/team-md/export", { sectionId: ids.section });
  assert.equal(e.status, 200, e.text);
  assert.equal(e.json.bots, 3);
  assert.equal(e.json.groups, 1);
  assert.equal(e.json.masked, 1);
  assert.equal(e.json.filename, "agence.md");
  const text: string = e.json.text;
  assert.ok(!text.includes(SECRET));
  assert.ok(text.includes("GitHub") && !text.includes("Serveur interne") && !text.includes("githubcopilot") && !text.includes("10.0.0.1"), "catalog app names only");
  assert.ok(!/autonomy|memory|token|vault/i.test(text.split("\n---\n")[0]), "no forbidden field in the header");
  assert.match(text, new RegExp(`library: ${LIB.id}`), "a library skill is written by its id");
  assert.match(text, /rule: auto/);
  // A second share of the same section keeps the team's id (re-importing it here offers « Mettre à jour »).
  const again = await A("POST", "/team-md/export", { sectionId: ids.section });
  assert.equal(/\nid: (\S+)/.exec(again.json.text)![1], /\nid: (\S+)/.exec(text)![1]);

  const p = await B("POST", "/team-md/preview", { text });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.existing, null, "another account never sees A's link");
  assert.deepEqual(p.json.bots.map((b: any) => b.name), ["Léa", "Max (2)", "Zoé bis"]);
  assert.equal(p.json.groups[0].members.length, 3);
  assert.equal(p.json.bots[0].skills[1].body, "1. Lire\n2. Chiffrer\n---\nname: pas un en-tête");
});

test("isolation: another account's section, bots and previews are out of reach", async () => {
  for (const body of [{ sectionId: ids.section }, { botIds: [ids.lea] }]) {
    const r = await B("POST", "/team-md/export", body);
    assert.equal(r.status, 404, JSON.stringify(body));
    assert.ok(!r.text.includes("Léa"));
  }
  const p = await A("POST", "/team-md/preview", { text: TEAM });
  const r = await B("POST", "/team-md/commit", { previewId: p.json.previewId, mode: "create", bots: [{ index: 0, include: true }] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /expiré/);
  // Without a session: nothing.
  const anon = client();
  for (const path of ["/team-md/preview", "/team-md/commit", "/team-md/export"]) assert.equal((await anon("POST", path, { text: TEAM })).status, 401);
});

test("hosted plan: the preview says how many bots fit; a commit that does not fit creates nothing", async () => {
  const p = await Free("POST", "/team-md/preview", { text: TEAM });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.room.bots, 1);
  assert.ok(p.json.warnings.some((w: any) => w.code === "bots_limit" && w.n === 1));
  const before = footprint(ids.free);
  const r = await Free("POST", "/team-md/commit", { previewId: p.json.previewId, mode: "create", section: "Agence", bots: [{ index: 0, include: true }, { index: 1, include: true }] });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "plan_limit");
  assert.match(r.json.error, /Ton offre permet 2 bots/);
  assert.deepEqual(footprint(ids.free), before, "nothing, not even the section");
  // One bot fits; its routine arrives paused and uses none of the plan's active routines.
  const p2 = await Free("POST", "/team-md/preview", { text: TEAM });
  const ok = await Free("POST", "/team-md/commit", { previewId: p2.json.previewId, mode: "create", bots: [{ index: 0, include: true }] });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(routines.forBot(ok.json.report.created[0].id).every((x) => !x.enabled));
});

test("address: https only, through the network guard, GitHub and gist pages to raw, 512 KB at most, web pages refused", async () => {
  assert.equal(imp.teamMdRawAddress(new URL("https://github.com/o/r/blob/main/equipe.md")).toString(), "https://raw.githubusercontent.com/o/r/main/equipe.md");
  assert.equal(imp.teamMdRawAddress(new URL("https://gist.github.com/someone/0123456789abcdef")).toString(), "https://gist.githubusercontent.com/someone/0123456789abcdef/raw");
  assert.match((await A("POST", "/team-md/preview", { url: "http://example.com/equipe.md" })).json.error, /qu'en https/);
  assert.match((await A("POST", "/team-md/preview", { url: "pas une adresse" })).json.error, /adresse complète/);
  assert.match((await A("POST", "/team-md/preview", { url: "https://user:pw@example.com/e.md" })).json.error, /identifiant/);
  // A private address is refused by the guard (no ALLOW_PRIVATE_FETCH here).
  const priv = await A("POST", "/team-md/preview", { url: "https://127.0.0.1:9/equipe.md" });
  assert.equal(priv.status, 400);
  assert.match(priv.json.error, /réseau privé ou local/);

  const server: Server = createServer((req, res) => {
    if (req.url === "/equipe.md") { res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" }); res.end(TEAM); return; }
    if (req.url === "/page") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><p>hi</p>"); return; }
    if (req.url === "/image") { res.writeHead(200, { "content-type": "image/png" }); res.end("x"); return; }
    if (req.url === "/redirect-creds") { res.writeHead(302, { location: "http://u:p@127.0.0.1/equipe.md" }); res.end(); return; }
    if (req.url === "/huge") {
      // No content-length: the cap is applied while reading.
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = "x".repeat(64 * 1024);
      let n = 0;
      const push = () => { while (n < 12) { n++; if (!res.write(chunk)) { res.once("drain", push); return; } } res.end(); };
      push();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.ALLOW_PRIVATE_FETCH = "1";
  try {
    const before = footprint(ids.a);
    const ok = await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/equipe.md` });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json.source, { kind: "url", label: "127.0.0.1/equipe.md", url: `http://127.0.0.1:${port}/equipe.md` });
    assert.equal(ok.json.bots.length, 3);
    assert.deepEqual(footprint(ids.a), before);
    assert.match((await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/page` })).json.error, /pas un fichier texte|page web/);
    assert.match((await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/image` })).json.error, /pas un fichier texte/);
    assert.match((await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/redirect-creds` })).json.error, /refusé/);
    const huge = await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/huge` });
    assert.equal(huge.status, 413);
    assert.match((await A("POST", "/team-md/preview", { url: `http://127.0.0.1:${port}/nothing` })).json.error, /code 404/);
  } finally {
    delete process.env.ALLOW_PRIVATE_FETCH;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("the team_export tool: the owner's own team, saved in the bot's library and shown in the chat", async () => {
  const lea = bots.byId(ids.lea)!;
  const user = { id: ids.a, locale: "fr" } as any;
  const tool = teamMdTools[0];
  assert.equal(tool.spec.name, "team_export");
  assert.match(tool.spec.description, /never publish it anywhere public/);
  const out = await tool.run({ scope: "section" }, { bot: lea, user, depth: 0, signal: AbortSignal.timeout(5000) } as any);
  assert.ok(!out.isError, out.content);
  assert.match(out.content, /equipes\/agence\.md/);
  const att = rows.list(lea.id, lea.generation).map((x: any) => x.body).filter((x: any) => x.kind === "message" && x.attachments?.length).at(-1);
  assert.equal(att.attachments[0].name, "agence.md");
  const { workspaceOf } = await import("../src/computer.js");
  const saved = readFileSync(path.join(workspaceOf(lea.id), att.attachments[0].path), "utf8");
  assert.match(saved, /^---\nformat: sklubot-team\/1\n/);
  assert.ok(!saved.includes(SECRET));
  // Names of another account's bots are not found.
  const bob = bots.list(ids.b).find((b) => b.kind === "agent")!;
  const refused = await tool.run({ scope: "bots", bots: ["Léa"] }, { bot: bob, user: { id: ids.b, locale: "fr" } as any, depth: 0, signal: AbortSignal.timeout(5000) } as any);
  assert.equal(refused.isError, true);
});
