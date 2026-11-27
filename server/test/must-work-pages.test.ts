import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// « Doit marcher » (checklist of 24/11): web pages in any language or encoding never break a bot's turn (web_fetch);
// a bot reads back the pages it saved (page_source).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-mustwork-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.DEFAULT_MODEL = "demo:demo";

// Shift_JIS 「日本語のページ」 and windows-1251 «Привет мир», as raw bytes; then broken UTF-8 and a NUL.
const SJIS = Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x79, 0x81, 0x5b, 0x83, 0x57]);
const CP1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0]);
const PAGES: Record<string, { type: string; body: Buffer }> = {
  "/rtl": { type: "text/html; charset=utf-8", body: Buffer.from('<html dir="rtl" lang="ar"><h1>مرحبا بالعالم</h1><p>שלום עולם ‏&rlm; <a href="/x">رابط</a></p></html>') },
  "/cjk": { type: "text/html; charset=utf-8", body: Buffer.from("<h1>你好，世界</h1><p>日本語のテキスト。한국어 텍스트.</p>") },
  "/emoji": { type: "text/html", body: Buffer.from("<h1>Fête 🎉👩‍👩‍👧‍👦🏳️‍🌈</h1><p>a\u0000b ‍ ﻿ fin</p>") },
  "/sjis": { type: "text/html; charset=Shift_JIS", body: Buffer.concat([Buffer.from("<p>"), SJIS, Buffer.from("</p>")]) },
  "/cp1251-meta": { type: "text/html", body: Buffer.concat([Buffer.from('<meta charset="windows-1251"><p>'), CP1251, Buffer.from("</p>")]) },
  "/bad-utf8": { type: "text/html; charset=utf-8", body: Buffer.concat([Buffer.from("<p>avant "), Buffer.from([0xc3, 0x28, 0xff, 0xfe]), Buffer.from(" après</p>")]) },
  "/unknown-charset": { type: "text/html; charset=x-made-up", body: Buffer.from("<p>texte</p>") },
  "/broken": { type: "text/html", body: Buffer.from("<div><p><b>non fermé <a href='javascript:x'>lien<table><tr><td>case" + "<span>".repeat(5000)) },
};
const site = createServer((req, res) => { const p = PAGES[req.url ?? ""]; if (!p) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": p.type }); res.end(p.body); });
await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
const origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
after(() => site.close());

const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");
const owner = users.create("mustwork@example.com", "Léa", "x", "fr");
const bot = bots.create(owner.id, { name: "Lecteur", autonomy: "balanced" });
const tool = (n: string) => builtinTools().find((t) => t.spec.name === n)!;
const ctx = () => ({ bot: bots.byId(bot.id)!, user: owner, depth: 0, signal: new AbortController().signal }) as never;
const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));

test("must work: web pages in any language or encoding are read without breaking the turn", async () => {
  const read = async (p: string) => { const r = await tool("web_fetch").run({ url: origin + p }, ctx()); assert.ok(!r.isError, `${p}: ${text(r)}`); return text(r); };
  assert.match(await read("/rtl"), /# مرحبا بالعالم[\s\S]*שלום עולם[\s\S]*\[رابط\]/);
  assert.match(await read("/cjk"), /# 你好，世界[\s\S]*日本語のテキスト。한국어 텍스트\./);
  assert.match(await read("/emoji"), /Fête 🎉👩‍👩‍👧‍👦🏳️‍🌈/);
  assert.match(await read("/sjis"), /日本語のページ/, "the charset of the content-type header is used");
  assert.match(await read("/cp1251-meta"), /Привет мир/, "the charset of <meta> is used");
  assert.match(await read("/bad-utf8"), /avant .* après/, "broken bytes become � instead of failing");
  assert.match(await read("/unknown-charset"), /texte/, "an unknown charset falls back to UTF-8");
  assert.match(await read("/broken"), /non fermé/);
});

test("must work: a bot reads back the pages it saved, and is told their names when it gets one wrong", async () => {
  const html = "<!doctype html><html lang=fr><body><h1>Ventes de novembre</h1><p>Total : 42 000 €</p></body></html>";
  const pub = await tool("page_publish").run({ name: "Rapport ventes", title: "Ventes de novembre", html, files: [{ path: "css/site.css", content: "h1{color:#1e3a5f}" }], visibility: "private" }, ctx());
  assert.ok(!pub.isError, text(pub));
  const src = JSON.parse(text(await tool("page_source").run({ name: "Rapport ventes" }, ctx())));
  assert.equal(src.source, html);
  assert.deepEqual(src.files, ["css/site.css"]);
  assert.equal(JSON.parse(text(await tool("page_source").run({ name: "Rapport ventes", file: "css/site.css" }, ctx()))).source, "h1{color:#1e3a5f}");
  const wrong = await tool("page_source").run({ name: "rapport" }, ctx());
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /Your saved pages \(name to give\): Rapport-ventes \(“Ventes de novembre”\)/);
  // Another bot of the same account does not read this bot's page.
  const other = bots.create(owner.id, { name: "Autre", autonomy: "balanced" });
  const refused = await tool("page_source").run({ name: "Rapport ventes" }, { bot: other, user: owner, depth: 0, signal: new AbortController().signal } as never);
  assert.match(text(refused), /^Page not found\. You have no saved page\./);
});
