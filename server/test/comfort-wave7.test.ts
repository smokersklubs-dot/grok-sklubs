import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

// Vague 7 « confort » : corbeille des bots (L144), conversations (L146), visionneuses Office (L148), modèle par
// conversation (L150), notifications (L151), pages (L157), style et rétention (L161), épingler / supprimer un message
// (L141). Chaque contrat est écrit ici d'abord.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-wave7-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "w7:r";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, users, rows, memories, skills } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { routines } = await import("../src/routines.js");
const { autoTitle, applyRetention, listConversations } = await import("../src/convs.js");
const { workModelFor } = await import("../src/agent/workmodel.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { replyPushDecision, noteDesk, logNotification, KEEP, MIN_WORK_MS } = await import("../src/notifyrules.js");
const { officePreview, zipEntries, OfficeError, columnOf } = await import("../src/officepreview.js");
const { lineDiff, standaloneHtml, a4Html } = await import("../src/pageextras.js");
const { styleLine } = await import("../src/botstyle.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({ id: "w7", label: "Scripted", models: ["r", "s"], available: () => true, async runTurn(_req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "r", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

let cookie = "";
async function call(method: string, url: string, body?: unknown, jar?: { cookie: string }) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar ? jar.cookie : cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) { if (jar) jar.cookie = set.split(";")[0]; else cookie = set.split(";")[0]; }
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, json, text: buf.toString("utf8"), headers: res.headers };
}
const other = { cookie: "" };
let userId = "";
const fresh = async (name: string) => (await call("POST", "/bots", { name })).json.bot as { id: string; generation: number };
const user = (id: string, text: string, extra: Record<string, unknown> = {}) => rows.append(bots.byId(id)!, { kind: "message", role: "user", text, ...extra } as any, 0);
const reply = (id: string, text: string) => rows.append(bots.byId(id)!, { kind: "message", role: "assistant", text }, 0);

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "w7@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("w7@example.com")!.id;
  assert.equal((await call("POST", "/auth/signup", { email: "w7-other@example.com", password: "password-1", locale: "fr" }, other)).status, 200);
});

// ── L144 ──
test("L144: the deletion preview counts what goes; the bot lands in the trash and comes back with its content, routines off", async () => {
  const b = await fresh("Corbeille");
  user(b.id, "Bonjour"); reply(b.id, "Salut");
  memories.add(b.id, "Aime le thé");
  skills.create(b.id, "Devis", "faire un devis", "Étapes…");
  const r = routines.create(b.id, { name: "Matin", prompt: "Résumé", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" } as any);
  const p = await call("GET", `/bots/${b.id}/deletion-preview`);
  assert.equal(p.status, 200);
  assert.deepEqual([p.json.messages, p.json.memories, p.json.skills, p.json.routines, p.json.conversations, p.json.days], [2, 1, 1, 1, 1, 30]);
  assert.equal((await call("GET", `/bots/${b.id}/deletion-preview`, undefined, other)).status, 404, "another account sees nothing");
  const del = await call("DELETE", `/bots/${b.id}`);
  assert.equal(del.status, 200);
  assert.ok(del.json.trashId);
  assert.equal(bots.byId(b.id), null);
  const list = await call("GET", "/bot-trash");
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].name, "Corbeille");
  assert.equal((await call("GET", "/bot-trash", undefined, other)).json.items.length, 0, "account isolation");
  assert.equal((await call("POST", `/bot-trash/${del.json.trashId}/restore`, undefined, other)).status, 404);
  const back = await call("POST", `/bot-trash/${del.json.trashId}/restore`);
  assert.equal(back.status, 200);
  const id = back.json.bot.id as string;
  assert.notEqual(id, b.id);
  assert.deepEqual(rows.all(id, bots.byId(id)!.generation).filter((x) => x.body.kind === "message").map((x) => (x.body as any).text), ["Bonjour", "Salut"]);
  assert.equal(memories.list(id).length, 1);
  assert.equal(skills.list(id).filter((s) => s.botId === id).length, 1);
  const rr = q.get<{ enabled: number; id: string }>("SELECT enabled, id FROM routines WHERE bot_id = ?", id)!;
  assert.equal(rr.enabled, 0, "a restored routine never fires on its own");
  assert.equal(rr.id, r.id);
  assert.equal((await call("GET", "/bot-trash")).json.items.length, 0, "it left the trash");
});

test("L144: « Supprimer pour de bon » forgets a copy; copies older than 30 days go by themselves", async () => {
  const b = await fresh("Vieux");
  const del = await call("DELETE", `/bots/${b.id}`);
  q.run("UPDATE bot_trash SET deleted_at = ? WHERE id = ?", Date.now() - 31 * 86_400_000, del.json.trashId);
  assert.equal((await call("GET", "/bot-trash")).json.items.length, 0);
  const c = await fresh("Autre");
  const d2 = await call("DELETE", `/bots/${c.id}`);
  assert.equal((await call("DELETE", `/bot-trash/${d2.json.trashId}`)).status, 200);
  assert.equal((await call("DELETE", `/bot-trash/${d2.json.trashId}`)).status, 404);
});

test("L144: export a bot (no secrets, no conversation), import it as a new bot whose skills wait as drafts", async () => {
  const b = await fresh("Export");
  await call("PATCH", `/bots/${b.id}`, { instructions: "Sois bref.", label: "Comptable" });
  memories.add(b.id, "Client : Camille");
  skills.create(b.id, "Relance", "relancer", "Corps");
  user(b.id, "secret de conversation");
  const ex = await call("GET", `/bots/${b.id}/export`);
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get("content-disposition") ?? "", /\.sklubot-bot\.json/);
  assert.equal(ex.json.format, "sklubot-bot");
  assert.ok(!ex.text.includes("secret de conversation"));
  assert.ok(!/token|password|vault/i.test(Object.keys(ex.json.bot).join(",")));
  const im = await call("POST", "/bots/import", ex.json);
  assert.equal(im.status, 200);
  assert.equal(im.json.bot.name, "Export (2)");
  const nb = bots.byId(im.json.bot.id)!;
  assert.equal(nb.instructions, "Sois bref.");
  assert.deepEqual(memories.list(nb.id).map((m) => m.text), ["Client : Camille"]);
  const sk = q.get<{ draft: number }>("SELECT draft FROM skills WHERE bot_id = ?", nb.id)!;
  assert.equal(sk.draft, 1);
  const bad = await call("POST", "/bots/import", { format: "autre" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "Ce n'est pas un fichier de bot Sklubot.");
});

// ── L146 / L150 ──
test("L146: automatic titles, rename, pin, folders, « Automatiques » filter, reopen an earlier conversation", async () => {
  assert.equal(autoTitle("  **Prépare** le devis pour   Camille demain matin s'il te plaît, avec les prix de la semaine dernière  "), "Prépare le devis pour Camille demain matin s'il te plaît…");
  const b = await fresh("Convs");
  user(b.id, "Premier sujet");
  await call("POST", `/bots/${b.id}/reset`);
  user(b.id, "Rapport du matin", { origin: { kind: "routine", id: "r1", name: "Matin" } });
  await call("POST", `/bots/${b.id}/reset`);
  user(b.id, "Troisième");
  let l = (await call("GET", `/bots/${b.id}/conversations`)).json.conversations;
  assert.deepEqual(l.map((c: any) => c.title), ["Troisième", "Rapport du matin", "Premier sujet"]);
  assert.equal(l[0].current, true);
  assert.deepEqual((await call("GET", `/bots/${b.id}/conversations?automatic=1`)).json.conversations.map((c: any) => c.title), ["Rapport du matin"]);
  assert.equal((await call("PATCH", `/bots/${b.id}/conversations/1`, { title: "Sujet un", pinned: true, folder: "Clients" })).status, 200);
  l = (await call("GET", `/bots/${b.id}/conversations`)).json;
  assert.deepEqual(l.conversations.map((c: any) => c.title), ["Troisième", "Sujet un", "Rapport du matin"], "pinned before the others, the open one first");
  assert.deepEqual(l.folders, ["Clients"]);
  assert.deepEqual((await call("GET", `/bots/${b.id}/conversations?folder=Clients`)).json.conversations.map((c: any) => c.generation), [1]);
  assert.equal((await call("PATCH", `/bots/${b.id}/conversations/99`, { title: "x" })).status, 404);
  const open = await call("POST", `/bots/${b.id}/conversations/1/open`);
  assert.equal(open.status, 200);
  assert.equal(open.json.generation, 4);
  const now = bots.byId(b.id)!;
  assert.equal(now.generation, 4);
  assert.deepEqual(rows.all(b.id, 4).map((r) => (r.body as any).text), ["Premier sujet"]);
  assert.equal(now.nextSeq, 2);
  const after = listConversations(now);
  assert.equal(after.find((c) => c.current)!.title, "Sujet un", "its name and pin went with it");
  assert.ok(after.some((c) => c.title === "Troisième" && !c.current), "the one that was open stays in the list");
  assert.equal((await call("POST", `/bots/${b.id}/conversations/3/open`, undefined, other)).status, 404);
});

test("L150: a model chosen for the open conversation is used for the owner's messages, not for routines; an unusable one is ignored", async () => {
  const b = await fresh("Modèle");
  await call("PATCH", `/bots/${b.id}`, { model: "w7:r" });
  const gen = bots.byId(b.id)!.generation;
  assert.equal((await call("PATCH", `/bots/${b.id}/conversations/${gen}`, { model: "w7:s" })).status, 200);
  const rec = bots.byId(b.id)!;
  assert.equal(workModelFor(rec, { kind: "user", text: "x" } as any), "w7:s");
  assert.equal(workModelFor(rec, { kind: "routine", routineId: "r", name: "x", text: "x" } as any), rec.model);
  await call("PATCH", `/bots/${b.id}/conversations/${gen}`, { model: "nope:zzz" });
  assert.equal(workModelFor(bots.byId(b.id)!, { kind: "user", text: "x" } as any), rec.model);
  assert.equal((await call("PATCH", `/bots/${b.id}/conversations/${gen}`, { model: "bad model!" })).status, 400);
});

// ── L161 ──
test("L161: history retention deletes old earlier conversations, never the open one nor a pinned one", async () => {
  const b = await fresh("Rétention");
  user(b.id, "vieux 1"); await call("POST", `/bots/${b.id}/reset`);
  user(b.id, "vieux épinglé"); await call("POST", `/bots/${b.id}/reset`);
  user(b.id, "ouvert");
  q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", Date.now() - 100 * 86_400_000, b.id);
  await call("PATCH", `/bots/${b.id}/conversations/2`, { pinned: true });
  assert.equal(applyRetention(userId), 0, "keep everything by default");
  assert.equal((await call("PUT", "/history-retention", { days: 7 })).status, 400);
  assert.equal((await call("PUT", "/history-retention", { days: 90 })).json.days, 90);
  assert.equal(applyRetention(userId) >= 1, true);
  assert.deepEqual(listConversations(bots.byId(b.id)!).map((c) => c.title).sort(), ["ouvert", "vieux épinglé"]);
  await call("PUT", "/history-retention", { days: 0 });
});

test("L161: style per bot adds one line to its instructions (none for normal)", async () => {
  const b = await fresh("Style");
  assert.equal(styleLine(b.id), "");
  assert.equal((await call("PUT", `/bots/${b.id}/style`, { style: "loud" })).status, 400);
  assert.equal((await call("PUT", `/bots/${b.id}/style`, { style: "challenge" })).json.style, "challenge");
  const prompt = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: true, shell: true, linux: false } as any);
  assert.match(prompt, /Do not just agree/);
  await call("PUT", `/bots/${b.id}/style`, { style: "simple" });
  assert.match(buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: true, shell: true, linux: false } as any), /plain words and short sentences/);
});

// ── L141 ──
test("L141: pin and delete a message (the text is emptied, the row stays as « deleted »)", async () => {
  const b = await fresh("Messages");
  const m = user(b.id, "à garder");
  const pin = await call("POST", `/bots/${b.id}/rows/${m.seq}/pin`, { on: true });
  assert.equal(pin.json.row.body.pinned, true);
  assert.equal((await call("POST", `/bots/${b.id}/rows/${m.seq}/pin`, { on: false })).json.row.body.pinned, undefined);
  const del = await call("DELETE", `/bots/${b.id}/rows/${m.seq}`);
  assert.equal(del.json.row.body.deleted, true);
  assert.equal(del.json.row.body.text, "");
  assert.equal((await call("POST", `/bots/${b.id}/rows/${m.seq}/pin`)).status, 404);
  assert.equal((await call("DELETE", `/bots/${b.id}/rows/${m.seq}`, undefined, other)).status, 404);
});

// ── L151 ──
test("L151: a reply goes to the phone only after 30 s idle at the computer and only when the work took time", () => {
  const t0 = 1_000_000_000_000;
  noteDesk(userId, "w1", true, 5_000, t0);
  assert.deepEqual(replyPushDecision(userId, t0 - 60_000, t0), { push: false, reason: "atDesk" });
  assert.deepEqual(replyPushDecision(userId, t0 + 30_000 - 60_000, t0 + 30_000), { push: true, reason: "" }, "35 s without a key or the mouse: away");
  noteDesk(userId, "w1", false, 0, t0 + 40_000);
  assert.deepEqual(replyPushDecision(userId, t0 + 40_000 - 5_000, t0 + 40_000), { push: false, reason: "quick" });
  assert.deepEqual(replyPushDecision(userId, t0 + 40_000 - MIN_WORK_MS, t0 + 40_000), { push: true, reason: "" });
});

test("L151: the bell keeps sent and held notifications, unread count, read, clear, at most KEEP", async () => {
  logNotification(userId, { kind: "reply", title: "Juno", body: "fini", botId: null }, false, "atDesk");
  const b = await call("GET", "/bell");
  assert.equal(b.json.items[0].reason, "atDesk");
  assert.equal(b.json.unread >= 1, true);
  assert.equal((await call("GET", "/bell", undefined, other)).json.items.length, 0);
  await call("POST", "/bell/read");
  assert.equal((await call("GET", "/bell")).json.unread, 0);
  for (let i = 0; i < KEEP + 5; i++) logNotification(userId, { kind: "reply", title: "x", body: String(i) }, true);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM notify_log WHERE user_id = ?", userId)!.n, KEEP);
  await call("DELETE", "/bell");
  assert.equal((await call("GET", "/bell")).json.items.length, 0);
});

// ── L148 ──
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8"), comp = deflateRawSync(data), n = Buffer.from(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, comp); central.push(c, n); offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

test("L148: xlsx — every sheet, shared and inline strings, empty cells kept in place, macros flagged and never read", () => {
  assert.equal(columnOf("AB12"), 27);
  const x = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Ventes &amp; co" sheetId="1" r:id="rId1"/><sheet name="Vide" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Produit</t></si><si><r><t>Pr</t></r><r><t>ix</t></r></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Thé</t></is></c><c r="C3"><v>4.5</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"/></sheetData></worksheet>',
    "xl/vbaProject.bin": "MACRO",
  });
  const p = officePreview(x, "xlsm");
  assert.equal(p.macros, true);
  assert.equal(p.sheets!.length, 2);
  assert.equal(p.sheets![0].name, "Ventes & co");
  assert.deepEqual(p.sheets![0].rows, [["Produit", "", "Prix"], [], ["Thé", "", "4.5"]]);
});

test("L148: docx headings, paragraphs and tables; pptx slides in order with titles; bad or bomb files refused", () => {
  const d = zip({ "word/document.xml": '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Titre</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Bonjour </w:t></w:r><w:r><w:t>Camille</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body></w:document>' });
  assert.deepEqual(officePreview(d, "docx").blocks, [{ type: "heading", level: 1, text: "Titre" }, { type: "paragraph", text: "Bonjour Camille" }, { type: "table", rows: [["A", "B"]] }]);
  const s = zip({
    "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml": '<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>Un</a:t></a:r></a:p></p:sp><a:p><a:r><a:t>point</a:t></a:r></a:p></p:sld>',
    "ppt/slides/slide2.xml": '<p:sld><a:p><a:r><a:t>Deux</a:t></a:r></a:p></p:sld>',
  });
  assert.deepEqual(officePreview(s, "pptx").slides, [{ n: 1, title: "Deux", lines: [] }, { n: 2, title: "Un", lines: ["point"] }]);
  assert.throws(() => officePreview(Buffer.from("not a zip at all, sorry"), "docx"), OfficeError);
  assert.throws(() => officePreview(zip({ "word/document.xml": "<w:document>" + "a".repeat(3_000_000) + "</w:document>" }), "docx"), /too large/);
  assert.equal(zipEntries(d).length, 1);
});

// ── L157 ──
test("L157: line diff folds unchanged stretches; standalone copy inlines the page's own files only; A4 sheet has @page A4 and a print button", () => {
  const before = Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join("\n");
  const after = before.replace("ligne 10", "ligne dix").concat("\nfin");
  const d = lineDiff(before, after);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.ok(d.lines.some((l) => l.op === "fold" && (l.count ?? 0) >= 4));
  assert.deepEqual(d.lines.filter((l) => l.op !== "same" && l.op !== "fold").map((l) => `${l.op}:${l.text}`), ["del:ligne 10", "add:ligne dix", "add:fin"]);
  const html = '<html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><img src="./logo.svg"><script src="app.js"></script></body></html>';
  const out = standaloneHtml(html, [{ file: "style.css", content: "body{background:url(bg.svg)}" }, { file: "app.js", content: "console.log('</script>')" }, { file: "logo.svg", content: "<svg/>" }, { file: "bg.svg", content: "<svg/>" }]);
  assert.match(out, /<style>body\{background:url\("data:image\/svg\+xml;base64,/);
  assert.match(out, /https:\/\/cdn\.example\.com\/x\.css/, "outside addresses untouched");
  assert.match(out, /<img src="data:image\/svg\+xml;base64,/);
  assert.match(out, /console\.log\('<\\\/script>'\)/);
  const a4 = a4Html("<html><head></head><body><p>x</p></body></html>", [], "Enregistrer en PDF");
  assert.match(a4, /@page\{size:A4/);
  assert.match(a4, /window\.print\(\)/);
});
