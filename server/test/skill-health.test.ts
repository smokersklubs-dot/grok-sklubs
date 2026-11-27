import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Santé des compétences » (skillhealth.ts, skillcatalog.ts, skillhealthroutes.ts, agent/skilltools.ts): L131 counts,
// lock, revision guard, versions, near duplicates; the Hermes curator port (stale / archived, never pinned, locked,
// owner-made, routine-used or in-prompt skills); L133 scopes and « seulement quand je le demande »; L132 long skills by
// index then section and « toujours en entier »; versioned library copies and the « Mettre à jour » chip; L135 the
// team catalogue (account-only); L134 the with / without test bench.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-skh-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "skhscript:s-1";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api, skillCommand } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { skills, bots, users } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const health = await import("../src/skillhealth.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { builtinTools } = await import("../src/agent/tools.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

// The bench's model: says whether the skill was in its instructions.
registerProvider({
  id: "skhscript", label: "Script", models: ["s-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const text = /Skill to follow/.test(req.system ?? "") ? "WITH: three short lines." : "WITHOUT: a long answer that rambles on and on.";
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", model: "s-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
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
const A = client(), B = client();
const ids: Record<string, string> = {};
const DAY = 86_400_000;
const tool = (name: string) => builtinTools().find((t) => t.spec.name === name)!;
const ctx = (botId = ids.aBot) => ({ bot: bots.byId(botId)!, user: users.byId(ids.a)!, depth: 0, signal: new AbortController().signal, toolsRun: 5 }) as any;
const skillOf = (botId: string, name: string) => skills.list(botId).find((k) => k.name === name)!;
const prompt = (botId: string) => buildSystemPrompt(bots.byId(botId)!, users.byId(ids.a)!, { connectorNames: [], browser: false, shell: false });
const age = (id: string, days: number) => { const t = Date.now() - days * DAY; q.run("UPDATE skills SET created_at = ? WHERE id = ?", t, id); health.metaOf(id); q.run("UPDATE skill_meta SET first_seen_at = ? WHERE skill_id = ?", t, id); };

test("setup: two accounts, three bots for A", async () => {
  ids.a = (await A("POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr", acceptTerms: true })).json.user.id;
  ids.b = (await B("POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123", acceptTerms: true })).json.user.id;
  ids.aBot = bots.list(ids.a).find((x) => x.kind === "agent")!.id;
  ids.bBot = bots.list(ids.b).find((x) => x.kind === "agent")!.id;
  ids.a2 = (await A("POST", "/bots", { name: "Compta" })).json.bot.id;
  ids.a3 = (await A("POST", "/bots", { name: "Ventes" })).json.bot.id;
  assert.ok(ids.a2 && ids.a3);
});

test("L131: reads and failures are counted; the owner sees them", async () => {
  await A("POST", `/bots/${ids.aBot}/skills`, { name: "Rapport", description: "Chaque lundi", body: "1. Ouvre le tableur.\n2. Résume les ventes." });
  const r1 = await tool("skill_read").run({ name: "Rapport" }, ctx());
  assert.match(String(r1.content), /Résume les ventes/);
  await tool("skill_read").run({ name: "rapport" }, ctx());
  const fb = await tool("skill_feedback").run({ name: "Rapport", problem: "Étape 1 : le tableur a changé d'adresse." }, ctx());
  assert.equal(fb.isError, undefined);
  const rep = (await A("GET", "/skills/health")).json.report;
  const h = rep.skills.find((x: any) => x.name === "Rapport");
  assert.deepEqual([h.uses, h.failures, h.lastFailure], [2, 1, "Étape 1 : le tableur a changé d'adresse."]);
  assert.ok(h.lastUsedAt > 0);
  // A second failure: the curator card says "à revoir".
  await tool("skill_feedback").run({ name: "Rapport", problem: "Encore." }, ctx());
  const rep2 = (await A("GET", "/skills/health")).json.report;
  assert.ok(rep2.suggestions.some((s: any) => s.kind === "failing" && s.name === "Rapport"));
  // Another account sees nothing of it.
  assert.equal((await B("GET", "/skills/health")).json.report.skills.length, 0);
});

test("L131: lock and revision guard stop the bot; versions keep the text before each change", async () => {
  const long = Array.from({ length: 10 }, (_, i) => `${i + 1}. Étape numéro ${i + 1} avec ses détails précis.`).join("\n");
  await A("POST", `/bots/${ids.aBot}/skills`, { name: "Commande", description: "Passer une commande", body: long });
  const s = skillOf(ids.aBot, "Commande");
  // Losing more than a quarter in one save: refused, nothing changed.
  const cut = await tool("skill_save").run({ name: "Commande", steps: "1. Commande." }, ctx());
  assert.equal(cut.isError, true);
  assert.match(String(cut.content), /more than a quarter/);
  assert.equal(skillOf(ids.aBot, "Commande").body, long);
  // A small change is fine, and the previous text is kept as a version.
  const ok = await tool("skill_save").run({ name: "Commande", steps: long + "\n11. Vérifie le total." }, ctx());
  assert.match(String(ok.content), /^Skill updated\./);
  const v = (await A("GET", `/skills/${s.id}/versions`)).json.versions;
  assert.equal(v.length, 1);
  assert.equal(v[0].body, long);
  // Locked by the owner: the bot cannot change it at all.
  assert.equal((await A("PATCH", `/skills/${s.id}/meta`, { locked: true })).status, 200);
  const locked = await tool("skill_save").run({ name: "Commande", steps: long + "\n12. Autre." }, ctx());
  assert.equal(locked.isError, true);
  assert.match(String(locked.content), /locked/);
  // Restore puts the old text back, and keeps the replaced one (undoable).
  const back = await A("POST", `/skills/${s.id}/versions/${v[0].id}/restore`, {});
  assert.equal(back.status, 200, back.text);
  assert.equal(skillOf(ids.aBot, "Commande").body, long);
  const v2 = (await A("GET", `/skills/${s.id}/versions`)).json.versions;
  assert.equal(v2.length, 2);
  assert.match(v2[0].body, /11\. Vérifie le total/);
  // At most 10 versions.
  for (let i = 0; i < 14; i++) skills.update(s.id, { name: "Commande", description: "x", body: `${long}\nv${i}` });
  assert.equal(health.skillVersions.count(s.id), 10);
  // B cannot read or restore A's versions.
  assert.equal((await B("GET", `/skills/${s.id}/versions`)).status, 404);
  assert.equal((await B("PATCH", `/skills/${s.id}/meta`, { locked: false })).status, 404);
});

test("L131: a near-identical skill is said at once (editor check and skill_save)", async () => {
  const body = "1. Ouvre la boîte mail.\n2. Cherche les factures du mois.\n3. Range-les dans le dossier comptabilité.";
  await A("POST", `/bots/${ids.a2}/skills`, { name: "Factures du mois", description: "Ranger les factures", body });
  const dup = await A("POST", "/skills/duplicates", { name: "Ranger factures", description: "Ranger les factures", body });
  assert.equal(dup.json.similar[0].name, "Factures du mois");
  assert.ok(dup.json.similar[0].score >= health.NEAR_DUPLICATE);
  assert.deepEqual((await A("POST", "/skills/duplicates", { name: "Autre chose", description: "Rien à voir", body: "Réserver un restaurant pour deux." })).json.similar, []);
  const saved = await tool("skill_save").run({ name: "Ranger les factures", when: "Ranger les factures", steps: body }, ctx());
  assert.match(String(saved.content), /almost identical to the skill "Factures du mois" \(Compta\)/);
  const rep = (await A("GET", "/skills/health")).json.report;
  assert.ok(rep.suggestions.some((s: any) => s.kind === "duplicate"));
  // B's account is never compared with A's.
  assert.deepEqual((await B("POST", "/skills/duplicates", { name: "Factures du mois", description: "Ranger les factures", body })).json.similar, []);
});

test("Hermes curator: a bot-made skill unused 15 days goes stale, 31 days archived; pinned, locked, owner-made, routine-used kept", async () => {
  // Enough skills that they are listed, not given in full (a skill in the prompt is never retired).
  const filler = "Une étape détaillée. ".repeat(200);
  for (const n of ["Vieille A", "Vieille B", "Épinglée", "Routine X", "Jeune", "De la patronne"]) {
    if (n === "De la patronne") await A("POST", `/bots/${ids.a3}/skills`, { name: n, description: n, body: filler + n });
    else await tool("skill_save").run({ name: n, when: n, steps: `${filler} ${n} ${Math.random()}` }, ctx(ids.a3));
  }
  age(skillOf(ids.a3, "Vieille A").id, 15);
  age(skillOf(ids.a3, "Vieille B").id, 31);
  age(skillOf(ids.a3, "Épinglée").id, 40);
  age(skillOf(ids.a3, "Routine X").id, 40);
  age(skillOf(ids.a3, "De la patronne").id, 40);
  age(skillOf(ids.a3, "Jeune").id, 3);
  health.skillMeta.setFlag(skillOf(ids.a3, "Épinglée").id, "pinned", true);
  routines.create(ids.a3, { name: "Lundi", prompt: "Suis la compétence Routine X puis écris le rapport.", trigger: "schedule", schedule: "0 9 * * 1", paused: true });
  const pass = health.applyTransitions(ids.a);
  assert.equal(pass.archived, 1);
  assert.equal(pass.markedStale, 1);
  const state = (n: string) => health.metaOf(skillOf(ids.a3, n).id).state;
  assert.deepEqual(["Vieille A", "Vieille B", "Épinglée", "Routine X", "Jeune", "De la patronne"].map(state), ["stale", "archived", "active", "active", "active", "active"]);
  // An archived skill is no longer given to the bot (prompt, skill_read), but stays in the owner's list.
  assert.ok(!prompt(ids.a3).includes("Vieille B"));
  assert.equal((await tool("skill_read").run({ name: "Vieille B" }, ctx(ids.a3))).isError, true);
  assert.ok(skills.list(ids.a3).some((k) => k.name === "Vieille B"));
  // Reading a stale skill makes it active again (Hermes bump_use).
  await tool("skill_read").run({ name: "Vieille A" }, ctx(ids.a3));
  assert.equal(state("Vieille A"), "active");
  // The card proposes the archived one back; the owner brings it back.
  const rep = (await A("GET", "/skills/health")).json.report;
  assert.ok(rep.suggestions.some((s: any) => s.kind === "archived" && s.name === "Vieille B"));
  const id = skillOf(ids.a3, "Vieille B").id;
  await A("PATCH", `/skills/${id}/meta`, { state: "active" });
  assert.equal(state("Vieille B"), "active");
  assert.ok(prompt(ids.a3).includes("Vieille B"));
  // Archived by the owner: the curator never brings it back on its own.
  await A("PATCH", `/skills/${id}/meta`, { state: "archived" });
  health.applyTransitions(ids.a);
  assert.equal(state("Vieille B"), "archived");
});

test("L133: a shared skill reaches only its scope; « seulement quand je le demande » waits for /skill", async () => {
  const made = (await A("POST", `/bots/${ids.a2}/skills`, { name: "Devis", description: "Faire un devis", body: "1. Lignes.\n2. TVA.", shared: true })).json.skill;
  assert.ok(prompt(ids.aBot).includes("Devis"), "shared with every bot by default");
  await A("PATCH", `/skills/${made.id}/meta`, { scope: { bots: [ids.a3], sections: [], exclude: [] } });
  assert.ok(!prompt(ids.aBot).includes("- Devis"), "out of scope");
  assert.equal(skills.find(ids.aBot, "Devis"), null);
  assert.ok(skills.find(ids.a3, "Devis"));
  // By section, with an exclusion.
  const sec = (await A("POST", "/sections", { name: "Bureau" })).json.section.id;
  q.run("UPDATE bots SET section_id = ? WHERE id IN (?, ?)", sec, ids.aBot, ids.a3);
  await A("PATCH", `/skills/${made.id}/meta`, { scope: { bots: [], sections: [sec], exclude: [ids.a3] } });
  assert.ok(skills.find(ids.aBot, "Devis"));
  assert.equal(skills.find(ids.a3, "Devis"), null);
  // Ids of another account are dropped.
  await A("PATCH", `/skills/${made.id}/meta`, { scope: { bots: [ids.bBot], sections: [], exclude: [] } });
  assert.deepEqual(health.metaOf(made.id).scope, { sections: [], bots: [], exclude: [] });
  // Only on request: not in the prompt, skill_read refuses, "/skill Devis" still gives it in full.
  await A("PATCH", `/skills/${made.id}/meta`, { onlyOnRequest: true });
  assert.ok(!prompt(ids.aBot).includes("Devis"));
  const read = await tool("skill_read").run({ name: "Devis" }, ctx());
  assert.equal(read.isError, true);
  assert.match(String(read.content), /only when the user asks/);
  assert.match(skillCommand(bots.byId(ids.aBot)!, "/skill Devis pour Martin")!.body, /TVA/);
});

test("L132: a long skill is read by its index then one section, with its approval steps every time; « toujours en entier »", async () => {
  const sec = (t: string) => `## ${t}\n${`Détail de ${t}. `.repeat(110)}`;
  const body = ["Introduction courte.", sec("Préparer"), sec("Envoyer"), sec("Vérifier")].join("\n\n");
  const made = (await A("POST", `/bots/${ids.a2}/skills`, { name: "Campagne", description: "Envoyer une campagne", body, approvals: "l'envoi final" })).json.skill;
  assert.ok(body.length > health.LONG_SKILL_CHARS);
  const idx = await tool("skill_read").run({ name: "Campagne" }, ctx(ids.a2));
  assert.match(String(idx.content), /4 sections/);
  assert.match(String(idx.content), /3\. Envoyer/);
  assert.match(String(idx.content), /need the user's approval.*l'envoi final/);
  assert.ok(String(idx.content).length < 1500);
  const part = await tool("skill_read").run({ name: "Campagne", section: "3" }, ctx(ids.a2));
  assert.match(String(part.content), /Section 3 of 4: Envoyer/);
  assert.match(String(part.content), /l'envoi final/);
  assert.ok(!String(part.content).includes("Détail de Vérifier"));
  assert.match(String((await tool("skill_read").run({ name: "Campagne", section: "vérif" }, ctx(ids.a2))).content), /Section 4 of 4/);
  assert.match(prompt(ids.a2), /Campagne \[long: skill_read gives its index/);
  // « Toujours en entier »: read whole, and given in full in the prompt.
  await A("PATCH", `/skills/${made.id}/meta`, { alwaysFull: true });
  assert.match(String((await tool("skill_read").run({ name: "Campagne" }, ctx(ids.a2))).content), /Détail de Vérifier/);
  assert.match(prompt(ids.a2), /### Campagne/);
  assert.equal(health.sectionsOf("Texte\n```\n# pas un titre\n```\n## Vrai titre\nx").length, 2, "a heading inside a code block is not a section");
});

test("versioned library copies: the « Mettre à jour » chip and the update keep the old text", async () => {
  const add = await A("POST", "/skills-library/explique-simplement/add", { target: ids.aBot });
  assert.equal(add.status, 200, add.text);
  const s = skills.list(ids.aBot).find((k) => health.metaOf(k.id).originId === "explique-simplement")!;
  assert.ok(s, "the copy remembers its source");
  let h = (await A("GET", "/skills/health")).json.report.skills.find((x: any) => x.skillId === s.id);
  assert.equal(h.update, null, "up to date");
  // The library got a newer text (simulated: the copy was installed at an older version).
  q.run("UPDATE skill_meta SET origin_version = 'old' WHERE skill_id = ?", s.id);
  skills.update(s.id, { name: s.name, description: s.description, body: "Mon texte modifié." });
  h = (await A("GET", "/skills/health")).json.report.skills.find((x: any) => x.skillId === s.id);
  assert.equal(h.update.kind, "library");
  const up = await A("POST", `/skills/${s.id}/update`, {});
  assert.equal(up.status, 200, up.text);
  assert.notEqual(skills.list(ids.aBot).find((k) => k.id === s.id)!.body, "Mon texte modifié.");
  assert.ok(health.skillVersions.list(s.id).some((v) => v.body === "Mon texte modifié."), "the owner's text can be put back");
  assert.equal((await A("POST", `/skills/${s.id}/update`, {})).status, 400, "already up to date");
  assert.equal((await B("POST", `/skills/${s.id}/update`, {})).status, 404);
  // A copy installed before versions existed is seeded at today's version: no false chip.
  const legacy = skills.create(ids.a2, "Explique simplement", "x", "ancien texte");
  assert.equal((await A("GET", "/skills/health")).json.report.skills.find((x: any) => x.skillId === legacy.id).update, null);
});

test("L135: the team catalogue — publish, add, new version, update chip; account-only", async () => {
  await A("POST", `/bots/${ids.aBot}/skills`, { name: "Accueil client", description: "Répondre à un nouveau client", body: "1. Remercier.\n2. Proposer un appel." });
  const src = skillOf(ids.aBot, "Accueil client");
  const pub = await A("POST", `/skills/${src.id}/publish`, {});
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.json.entry.version, 1);
  const cat = (await A("GET", "/skills-catalog")).json.catalog;
  assert.deepEqual(cat.map((x: any) => [x.name, x.version, x.fromBot]), [["Accueil client", 1, bots.byId(ids.aBot)!.name]]);
  const add = await A("POST", `/skills-catalog/${cat[0].id}/add`, { target: "all" });
  assert.deepEqual(add.json.report.already, [bots.byId(ids.aBot)!.name]);
  assert.equal(add.json.report.added.length, 2);
  const copy = skillOf(ids.a2, "Accueil client");
  // A new version: the copies show the chip, and update to it.
  skills.update(src.id, { name: "Accueil client", description: "Répondre à un nouveau client", body: "1. Remercier.\n2. Proposer un appel.\n3. Envoyer la plaquette." });
  assert.equal((await A("POST", `/skills/${src.id}/publish`, {})).json.entry.version, 2);
  const h = (await A("GET", "/skills/health")).json.report.skills.find((x: any) => x.skillId === copy.id);
  assert.deepEqual(h.update, { kind: "catalog", title: "Accueil client" });
  await A("POST", `/skills/${copy.id}/update`, {});
  assert.match(skillOf(ids.a2, "Accueil client").body, /plaquette/);
  // Another account: sees an empty catalogue, cannot add, publish or delete A's.
  assert.deepEqual((await B("GET", "/skills-catalog")).json.catalog, []);
  assert.equal((await B("POST", `/skills-catalog/${cat[0].id}/add`, { target: "all" })).status, 404);
  assert.equal((await B("POST", `/skills/${src.id}/publish`, {})).status, 404);
  assert.equal((await B("DELETE", `/skills-catalog/${cat[0].id}`)).status, 404);
  assert.equal((await A("DELETE", `/skills-catalog/${cat[0].id}`)).status, 200);
  assert.deepEqual((await A("GET", "/skills-catalog")).json.catalog, []);
});

test("L134: the bench answers the same request with and without the skill, side by side", async () => {
  const s = skillOf(ids.aBot, "Rapport");
  assert.equal((await A("POST", `/skills/${s.id}/bench`, { prompt: "court" })).status, 400, "a request of 10 characters at least");
  const r = await A("POST", `/skills/${s.id}/bench`, { prompt: "Fais le rapport des ventes de la semaine." });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.result.withSkill.text, /^WITH/);
  assert.match(r.json.result.without.text, /^WITHOUT/);
  const lib = await A("POST", "/skills-library/conversation-courte/bench", { prompt: "Explique-moi la TVA en deux mots.", botId: ids.aBot });
  assert.equal(lib.status, 200, lib.text);
  assert.match(lib.json.result.withSkill.text, /^WITH/);
  assert.equal((await B("POST", `/skills/${s.id}/bench`, { prompt: "Fais le rapport des ventes." })).status, 404);
  assert.equal((await B("POST", "/skills-library/conversation-courte/bench", { prompt: "Explique-moi la TVA.", botId: ids.aBot })).status, 404, "not B's bot");
});
