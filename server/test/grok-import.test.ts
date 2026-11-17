import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Importer depuis Grok Bot" (grokimport.ts, docs/IMPORT-GROK.md): the reply pasted from another assistant is parsed
// (prose around the block, small JSON mistakes, size limit), cleaned of anything that looks like a secret, previewed
// without creating anything, then imported as a safe package: careful bots on the default model, draft skills that the
// bot does not get, paused routines, only the ticked memories, apps as a to-do notice, no key, no permission.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-grok-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "grokscript:g-1";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { skills, setMaxBots, bots } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const g = await import("../src/grokimport.js");
const { GROK_EXPORT_PROMPT_FR, GROK_EXPORT_PROMPT_EN } = await import("../src/shared.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "grokscript", label: "Script", models: ["g-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ok");
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "g-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const ORIGIN = process.env.PUBLIC_URL!;
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const A = client(), B = client();
const ids: Record<string, string> = {};

// ── Realistic replies ────────────────────────────────────────────────────────────────────────────────────────────
const SECRET_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const GH_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const CARD = "4111 1111 1111 1111";
const CLEAN_REPLY = `Voici l'export de tes bots, prêt à être collé :

\`\`\`json
{
  "format": "sklubot-bots",
  "version": 1,
  "bots": [
    {
      "name": "Ava",
      "role": "Assistante administrative : trie les e-mails et prépare les factures.",
      "personality": "Chaleureuse, brève, tutoie.",
      "instructions": "Toujours proposer un brouillon avant d'envoyer quoi que ce soit.",
      "memories": ["Travaille de 9 h à 18 h, heure de Paris", "Préfère les réponses en français", "Son comptable s'appelle Marc"],
      "skills": [
        { "name": "Factures du mois", "when": "Le 1er du mois ou quand je demande les factures", "steps": ["Chercher les factures reçues", "Les classer par fournisseur", "Me faire un résumé"] },
        { "name": "Tri du matin", "when": "Chaque matin", "steps": "1. Lire les nouveaux e-mails\\n2. Marquer les urgents" }
      ],
      "routines": [
        { "name": "Point du matin", "schedule": "chaque jour de semaine à 8 h", "cron": "0 8 * * 1-5", "timezone": "Europe/Paris", "task": "Résume mes e-mails urgents." },
        { "name": "Relances", "schedule": "un vendredi sur deux", "cron": "", "timezone": "", "task": "Relance les devis sans réponse." }
      ],
      "apps": ["Gmail", "Google Agenda", "gmail"]
    },
    {
      "name": "Léo",
      "role": "Veille sur les réseaux sociaux.",
      "personality": "",
      "instructions": "Ne jamais publier sans mon accord.",
      "memories": [],
      "skills": [],
      "routines": [{ "name": "Veille", "schedule": "toutes les heures", "cron": "0 * * * *", "timezone": "Mars/Olympus", "task": "Regarde les mentions." }],
      "apps": ["X"]
    }
  ]
}
\`\`\`

Dis-moi si tu veux que j'ajoute autre chose.`;

test("the prompts are Sklubot's own, ask for one ```json block and forbid secrets; the doc carries them word for word", () => {
  for (const p of [GROK_EXPORT_PROMPT_FR, GROK_EXPORT_PROMPT_EN]) {
    assert.match(p, /```json/);
    assert.match(p, /"format": "sklubot-bots"/);
    assert.match(p, /"version": 1/);
    for (const field of ["name", "role", "personality", "instructions", "memories", "skills", "routines", "apps", "cron", "timezone", "steps", "when", "task"]) assert.ok(p.includes(`"${field}"`), field);
  }
  assert.match(GROK_EXPORT_PROMPT_FR, /JAMAIS[^]*mot de passe[^]*clé d'API[^]*jeton[^]*cookie/);
  assert.match(GROK_EXPORT_PROMPT_EN, /NEVER[^]*passwords[^]*API keys[^]*tokens[^]*cookies/);
  assert.doesNotMatch(GROK_EXPORT_PROMPT_FR + GROK_EXPORT_PROMPT_EN, /grok|xai|x\.ai/i, "the prompt names no product");
  const doc = readFileSync(new URL("../../docs/IMPORT-GROK.md", import.meta.url), "utf8");
  assert.ok(doc.includes(GROK_EXPORT_PROMPT_FR), "docs/IMPORT-GROK.md holds the French prompt as shown in the app");
  assert.ok(doc.includes(GROK_EXPORT_PROMPT_EN), "docs/IMPORT-GROK.md holds the English prompt as shown in the app");
});

test("parser: a clean reply with prose around the block", () => {
  const r = g.parseGrokExport(CLEAN_REPLY, { locale: "fr", timezone: "Europe/Paris" });
  assert.equal(r.bots.length, 2);
  const [ava, leo] = r.bots;
  assert.equal(ava.name, "Ava");
  assert.match(ava.role, /factures/);
  assert.equal(ava.memories.length, 3);
  assert.deepEqual(ava.skills.map((s) => s.name), ["Factures du mois", "Tri du matin"]);
  assert.equal(ava.skills[0].steps, "1. Chercher les factures reçues\n2. Les classer par fournisseur\n3. Me faire un résumé");
  assert.equal(ava.routines[0].cron, "0 8 * * 1-5");
  assert.match(ava.routines[0].describe, /semaine|Weekdays|8 h/i);
  assert.equal(ava.routines[1].cron, "", "no cron given: it needs one before it can be created");
  assert.deepEqual(ava.apps, ["Gmail", "Google Agenda"], "apps once each");
  assert.equal(leo.routines[0].timezone, "Europe/Paris", "an unknown time zone falls back to the user's");
  assert.deepEqual(r.stripped, []);
  assert.deepEqual(r.warnings.map((w) => w.code), ["routine_no_cron"]);
});

test("parser: small JSON mistakes are repaired (trailing commas, comments, raw line breaks, curly quotes, cut-off block)", () => {
  const sloppy = `Bien sûr ! Voici :
\`\`\`json
{
  // export
  "format": "sklubot-bots", "version": 1,
  "bots": [
    { "name": "Nina", "role": "Support client",
      "instructions": "Ligne une
Ligne deux",
      "skills": [ { "name": "Remboursement", "when": "Un client demande", "steps": ["Vérifier la commande", "Proposer un avoir",], }, ],
      "apps": ["Zendesk",],
    },
  ],
}
\`\`\``;
  const r = g.parseGrokExport(sloppy);
  assert.equal(r.bots[0].name, "Nina");
  assert.equal(r.bots[0].instructions, "Ligne une\nLigne deux");
  assert.equal(r.bots[0].skills[0].steps, "1. Vérifier la commande\n2. Proposer un avoir");
  assert.ok(r.warnings.some((w) => w.code === "repaired"));

  // No closing fence (the reply was cut off) and the last bracket missing.
  const cut = "```json\n{\"format\":\"sklubot-bots\",\"version\":1,\"bots\":[{\"name\":\"Coupé\",\"role\":\"r\"}";
  assert.equal(g.parseGrokExport(cut).bots[0].name, "Coupé");
  // No fence at all (copied with the app's copy button).
  assert.equal(g.parseGrokExport('{"format":"sklubot-bots","version":1,"bots":[{"name":"Nu"}]}').bots[0].name, "Nu");
  // Curly quotes used as JSON quotes.
  assert.equal(g.parseGrokExport("```json\n{“format”: “sklubot-bots”, “version”: 1, “bots”: [{“name”: “Courbe”}]}\n```").bots[0].name, "Courbe");
  // A first block that is not the export (an example in another language), then the export.
  const two = "Exemple :\n```python\nprint('hi')\n```\nEt l'export :\n```json\n{\"bots\":[{\"name\":\"Deux\"}],\"version\":1}\n```";
  const r2 = g.parseGrokExport(two);
  assert.equal(r2.bots[0].name, "Deux");
  assert.ok(r2.warnings.some((w) => w.code === "several_blocks"));
  // A bare list of bots, a single bot, aliases and unknown fields.
  const r3 = g.parseGrokExport('```json\n[{"nom":"Alias","job":"Compta","consignes":"Sois précis","competences":[{"nom":"TVA","quand":"fin de trimestre","etapes":["calculer"]}],"emoji":"🤖"}]\n```');
  assert.equal(r3.bots[0].name, "Alias");
  assert.equal(r3.bots[0].role, "Compta");
  assert.equal(r3.bots[0].skills[0].name, "TVA");
  assert.deepEqual(r3.warnings.map((w) => w.code).sort(), ["no_version", "unknown_fields"]);
  assert.equal(r3.warnings.find((w) => w.code === "unknown_fields")!.detail, "emoji");
  assert.ok(g.parseGrokExport('{"version": 3, "bots": [{"name": "Futur"}]}').warnings.some((w) => w.code === "newer_version" && w.n === 3));
});

test("parser: what cannot be read is refused with a clear reason", () => {
  const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { assert.ok(e instanceof g.GrokImportError, String(e)); return (e as InstanceType<typeof g.GrokImportError>).code; } };
  assert.equal(code(() => g.parseGrokExport("   ")), "empty");
  assert.equal(code(() => g.parseGrokExport("Désolé, je ne peux pas faire ça.")), "no_block");
  assert.equal(code(() => g.parseGrokExport("```json\n{\"bots\": [ {\"name\": \"x\" \"role\": } ]}\n```")), "bad_json");
  assert.equal(code(() => g.parseGrokExport("```json\n{\"weather\": \"sunny\"}\n```")), "no_bots");
  assert.equal(code(() => g.parseGrokExport('{"bots": []}')), "no_bots");
  const huge = "```json\n{\"bots\":[{\"name\":\"x\",\"instructions\":\"" + "a".repeat(g.GROK_MAX_CHARS) + "\"}]}\n```";
  let err: any; try { g.parseGrokExport(huge); } catch (e) { err = e; }
  assert.equal(err.code, "too_large");
  assert.equal(err.status, 413);
  assert.match(err.text("fr"), /trop longue \(\d+ Ko ; 200 Ko au plus\)/);
  // Too many of everything: kept to the limits, with a warning.
  const many = { version: 1, bots: Array.from({ length: 25 }, (_, i) => ({ name: `B${i}`, memories: Array.from({ length: 80 }, (_, j) => `fait ${j}`) })) };
  const r = g.parseGrokExport(JSON.stringify(many));
  assert.equal(r.bots.length, 20);
  assert.equal(r.bots[0].memories.length, 50);
  assert.ok(r.warnings.some((w) => w.code === "too_many_bots"));
  assert.ok(r.warnings.some((w) => w.code === "too_many_items"));
});

test("parser: secrets are taken out (and reported where, never what)", () => {
  const leaky = `\`\`\`json
{ "format": "sklubot-bots", "version": 1, "bots": [ {
  "name": "Fuite",
  "apiKey": "abc123def456ghi789",
  "instructions": "Utilise la clé ${SECRET_KEY} pour l'API.",
  "memories": ["Son mot de passe Gmail : Soleil2024!", "Aime le café", "Carte : ${CARD}"],
  "skills": [{ "name": "Déploiement", "when": "sur demande", "steps": ["Se connecter avec ${GH_TOKEN}", "Envoyer cookie: sessionid=9f8e7d6c5b4a39281706", "Authorization: Bearer abcdefghijklmnop1234567890"], "password": "hunter22" }],
  "routines": [{ "name": "Sauvegarde", "cron": "0 3 * * *", "task": "Sauvegarde avec token: tk_9a8b7c6d5e4f3a2b1c0d" }],
  "apps": ["Gmail (moi@example.com)", "https://evil.example.com Notion"]
} ] }
\`\`\``;
  const r = g.parseGrokExport(leaky, { locale: "fr" });
  const out = JSON.stringify(r);
  for (const secret of [SECRET_KEY, GH_TOKEN, "Soleil2024!", "4111 1111 1111 1111", "sessionid=9f8e7d6c5b4a39281706", "abcdefghijklmnop1234567890", "hunter22", "abc123def456ghi789", "tk_9a8b7c6d5e4f3a2b1c0d", "moi@example.com", "evil.example.com"])
    assert.ok(!out.includes(secret), `${secret} must not survive`);
  const bot = r.bots[0];
  assert.match(bot.instructions, /\[secret retiré\]/);
  assert.deepEqual(bot.memories.map((m) => m.flagged), [true, false, true]);
  assert.equal(bot.memories[1].text, "Aime le café");
  assert.deepEqual(bot.apps, ["Gmail", "Notion"], "apps kept by name only");
  assert.ok(bot.apps.every((a) => !/@|https?:/.test(a)));
  const kinds = r.stripped.map((s) => s.kind).sort();
  for (const k of ["key", "token", "password", "card", "cookie", "field"]) assert.ok(kinds.includes(k as any), `reported: ${k} (${kinds.join(",")})`);
  assert.ok(r.stripped.some((s) => s.kind === "field" && /apiKey/.test(s.where)));
  assert.ok(r.stripped.some((s) => s.kind === "field" && /Déploiement/.test(s.where) && /password/.test(s.where)));
  assert.ok(r.stripped.every((s) => !s.where.includes("Soleil") && !s.where.includes(SECRET_KEY)));
});

// ── Through the API ──────────────────────────────────────────────────────────────────────────────────────────────
test("setup: two accounts", async () => {
  ids.a = (await A("POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr", acceptTerms: true })).json.user.id;
  ids.b = (await B("POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123", acceptTerms: true })).json.user.id;
  // A bot already called "Ava": the import must not take its name.
  ids.ava = (await A("POST", "/bots", { name: "Ava" })).json.bot.id;
});

const count = (sql: string, ...p: string[]) => q.get<{ n: number }>(sql, ...p)!.n;
const footprint = (userId: string) => ({
  bots: count("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", userId),
  skills: count("SELECT COUNT(*) AS n FROM skills s JOIN bots b ON b.id = s.bot_id WHERE b.user_id = ?", userId),
  routines: count("SELECT COUNT(*) AS n FROM routines r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ?", userId),
  memories: count("SELECT COUNT(*) AS n FROM memories m JOIN bots b ON b.id = m.bot_id WHERE b.user_id = ?", userId),
  policies: count("SELECT COUNT(*) AS n FROM policies WHERE user_id = ?", userId),
  vault: count("SELECT COUNT(*) AS n FROM vault WHERE user_id = ?", userId),
  approvals: count("SELECT COUNT(*) AS n FROM approvals WHERE user_id = ?", userId),
  connectors: count("SELECT COUNT(*) AS n FROM connectors WHERE user_id = ?", userId),
});

test("preview: creates nothing, flags the name already taken, lists the apps once, keeps the reply for this account only", async () => {
  const before = footprint(ids.a);
  const p = await A("POST", "/import/grok/preview", { text: CLEAN_REPLY });
  assert.equal(p.status, 200, p.text);
  assert.deepEqual(footprint(ids.a), before, "a preview creates nothing");
  assert.equal(p.json.bots.length, 2);
  assert.equal(p.json.bots[0].nameTaken, true);
  assert.equal(p.json.bots[1].nameTaken, false);
  assert.deepEqual(p.json.apps, ["Gmail", "Google Agenda", "X"]);
  assert.deepEqual(p.json.room, { bots: null, activeRoutines: null });
  ids.preview = p.json.previewId;
  // B cannot commit A's preview (nor learn anything from trying).
  const stolen = await B("POST", "/import/grok/commit", { previewId: ids.preview, bots: [{ index: 0, include: true }] });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.json.code, "expired");
  assert.ok(!stolen.text.includes("Ava"));
  assert.equal(count("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", ids.b), 1, "only B's own main bot");
  // Errors come back in the user's language, with a code.
  const bad = await A("POST", "/import/grok/preview", { text: "rien ici" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "no_block");
  assert.match(bad.json.error, /Aucun export trouvé/);
  const none = await A("POST", "/import/grok/commit", { previewId: ids.preview, bots: [{ index: 0, include: false }] });
  assert.equal(none.json.code, "nothing");
});

test("commit: a safe package — careful bots, default model, draft skills, paused routines, ticked memories, a to-do notice", async () => {
  const before = footprint(ids.a);
  const r = await A("POST", "/import/grok/commit", {
    previewId: ids.preview,
    bots: [
      {
        index: 0, include: true,
        skills: [{ index: 0, include: true, name: "Factures" }, { index: 1, include: false }],
        routines: [{ index: 0, include: true }, { index: 1, include: true }],
        memories: [0, 2],
      },
      { index: 1, include: true, name: "Ava", apps: [], routines: [{ index: 0, include: true, name: "Veille horaire", cron: "*/30 * * * *" }] },
      { index: 0, include: true }, // the same bot twice: counted once
    ],
  });
  assert.equal(r.status, 200, r.text);
  const rep = r.json.report;
  assert.deepEqual(rep.bots.map((b: any) => b.name), ["Ava (2)", "Ava (3)"], "names never collide, even renamed into one another");
  assert.equal(rep.skills, 1);
  assert.equal(rep.routines, 2);
  assert.equal(rep.memories, 2);
  assert.deepEqual(rep.unscheduled, ["Relances (un vendredi sur deux)"]);
  assert.deepEqual(rep.apps, ["Gmail", "Google Agenda"], "X was unticked from Léo's to-do");
  const after = footprint(ids.a);
  for (const k of ["policies", "vault", "approvals", "connectors"] as const) assert.equal(after[k], before[k], `no ${k} granted or created`);
  assert.equal(after.bots, before.bots + 2);

  const [ava2, ava3] = rep.bots.map((b: any) => bots.byId(b.id)!);
  for (const b of [ava2, ava3]) {
    assert.equal(b.autonomy, "careful");
    assert.equal(b.model, "", "the account's default model");
    assert.deepEqual(b.disabledTools, bots.byId(ids.ava)!.disabledTools, "the default tools, nothing more");
    assert.equal(b.mode, "personal");
  }
  assert.match(ava2.description, /Assistante administrative/);
  assert.match(ava2.instructions, /Toujours proposer un brouillon[^]*Personnalité et ton : Chaleureuse/);

  // Skills: a draft — listed, never given to the bot.
  const sk = skills.list(ava2.id);
  assert.deepEqual(sk.map((s) => [s.name, s.draft]), [["Factures", true]]);
  assert.equal(skills.available(ava2.id).length, 0);
  assert.equal(skills.find(ava2.id, "Factures"), null, "skill_read cannot find a draft");
  assert.equal((await A("GET", `/bots/${ava2.id}/skills/available`)).json.skills.length, 0);
  // Shared or not, a draft never reaches a teammate.
  q.run("UPDATE skills SET shared = 1 WHERE bot_id = ?", ava2.id);
  assert.equal(skills.sharedWith(ids.ava).length, 0);
  assert.equal(skills.usable(ava2.id).length, 0, "the prompt builder (skills.usable) leaves drafts out");

  // Routines: paused, valid schedules, the user's override taken.
  const rt = routines.forBot(ava2.id);
  assert.deepEqual(rt.map((x) => [x.name, x.schedule, x.timezone, x.enabled]), [["Point du matin", "0 8 * * 1-5", "Europe/Paris", false]]);
  assert.deepEqual(routines.forBot(ava3.id).map((x) => [x.name, x.schedule, x.enabled]), [["Veille horaire", "*/30 * * * *", false]]);

  // Memories: only the ticked ones, marked as imported.
  const mem = q.all<{ text: string; source: string }>("SELECT text, source FROM memories WHERE bot_id = ? ORDER BY text", ava2.id).map((m) => ({ text: m.text, source: m.source }));
  assert.deepEqual(mem, [{ text: "Son comptable s'appelle Marc", source: "import" }, { text: "Travaille de 9 h à 18 h, heure de Paris", source: "import" }]);
  assert.equal(count("SELECT COUNT(*) AS n FROM memories WHERE bot_id = ?", ava3.id), 0);

  // The to-do notice, in the user's language, pointing to the apps settings.
  const rows = (await A("GET", `/bots/${ava2.id}/rows`)).json.rows.map((x: any) => x.body);
  const notice = rows.find((b: any) => b.kind === "notice");
  assert.ok(notice, "a to-do notice in the new bot's chat");
  assert.match(notice.text, /mode prudent/);
  assert.match(notice.text, /connecte Gmail, Google Agenda/);
  assert.match(notice.text, /1 compétence\(s\) en brouillon/);
  assert.match(notice.text, /1 routine\(s\) en pause/);
  assert.match(notice.text, /Relances \(un vendredi sur deux\)/);
  assert.deepEqual(notice.action, { kind: "settings", section: "connectors" });

  // An audit line.
  const auditLine = q.get<{ text: string }>("SELECT text FROM audit WHERE user_id = ? AND text LIKE 'Bots imported%' ORDER BY id DESC", ids.a)!.text;
  assert.match(auditLine, /Ava \(2\), Ava \(3\) \(1 draft skills, 2 paused routines, 2 memories, 2 apps to connect\)/);

  // The preview is used up.
  const again = await A("POST", "/import/grok/commit", { previewId: ids.preview, bots: [{ index: 0, include: true }] });
  assert.equal(again.json.code, "expired");
  ids.draftBot = ava2.id;
});

test("a draft skill is activated by the user, and only then given to the bot", async () => {
  const s = skills.list(ids.draftBot)[0];
  const r = await A("PATCH", `/skills/${s.id}`, { draft: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.skill.draft, false);
  assert.equal(skills.find(ids.draftBot, "Factures")?.name, "Factures");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text = 'Skill activated: Factures'", ids.a));
  // B cannot touch it.
  assert.equal((await B("PATCH", `/skills/${s.id}`, { draft: true })).status, 404);
});

test("limits: an installation's bot limit refuses the whole import before anything is created", async () => {
  const p = await A("POST", "/import/grok/preview", { text: CLEAN_REPLY });
  const have = bots.teamCount();
  setMaxBots(have + 1);
  try {
    const p2 = await A("POST", "/import/grok/preview", { text: CLEAN_REPLY });
    assert.ok(p2.json.warnings.some((w: any) => w.code === "team_full" && w.n === have + 1));
    const before = footprint(ids.a);
    const r = await A("POST", "/import/grok/commit", { previewId: p.json.previewId, bots: [{ index: 0, include: true }, { index: 1, include: true }] });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /équipe est pleine/);
    assert.deepEqual(footprint(ids.a), before, "nothing was created");
    // One bot fits.
    const ok = await A("POST", "/import/grok/commit", { previewId: p.json.previewId, bots: [{ index: 1, include: true }] });
    assert.equal(ok.status, 200, ok.text);
  } finally { setMaxBots(0); }
});

test("an oversized request is refused before it is read", async () => {
  const r = await A("POST", "/import/grok/preview", { text: "x".repeat(g.GROK_MAX_CHARS + 10) });
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "too_large");
  const unauth = await client()("POST", "/import/grok/preview", { text: CLEAN_REPLY });
  assert.equal(unauth.status, 401);
});
