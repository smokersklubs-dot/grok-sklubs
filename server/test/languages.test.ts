import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The languages (server/src/clientshared/locales.ts, server/src/lang/, docs/LANGUES.md): one list for every surface,
// the account language accepts every language, a missing text falls back to English (never a raw key), Spanish
// server texts and e-mails, the bots' prompts name the account language.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-languages-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.TRUST_PROXY = "1";
process.env.OPEN_SIGNUP = "1";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "SMTP_HOST"]) delete process.env[k];

const locales = await import("../src/clientshared/locales.js");
const lang = await import("../src/lang/index.js");
const { es } = await import("../src/lang/es.js");
const { tr } = await import("../src/i18n.js");

test("one list of languages; tags and Accept-Language map to them; unknown ones read as English", () => {
  assert.deepEqual([...locales.LOCALES], ["fr", "en", "es", "de", "it", "pt", "zh"]);
  assert.equal(locales.localeFromTag("es-MX"), "es");
  assert.equal(locales.localeFromTag("pt_BR"), "pt");
  assert.equal(locales.localeFromTag("zh-Hans-CN"), "zh");
  assert.equal(locales.localeFromTag("ja-JP,de;q=0.8"), "de");
  assert.equal(locales.localeFromTag("ja"), null);
  assert.equal(lang.pickLocale(undefined, "es-ES,es;q=0.9,en;q=0.8"), "es");
  assert.equal(lang.pickLocale("it", "fr"), "it");
  assert.equal(lang.pickLocale("xx", "ja"), "en");
  assert.equal(lang.asLocale("de"), "de");
  assert.equal(lang.asLocale("klingon"), "en");
  assert.equal(locales.languageName("es"), "Spanish");
  assert.equal(locales.languageName("zh"), "Simplified Chinese");
  assert.equal(locales.languageName(undefined), "English");
  assert.equal(locales.pluralForm("zh", 1), "other");
  assert.equal(locales.pluralForm("fr", 0), "one");
  assert.equal(locales.pluralForm("es", 0), "other");
});

test("server texts: French from its map, Spanish from lang/es.ts, English for a missing text or a language without a file", () => {
  assert.equal(tr("fr", "Backup failed"), "Sauvegarde en échec");
  assert.equal(tr("es", "Backup failed"), es["Backup failed"]);
  assert.notEqual(tr("es", "Backup failed"), "Backup failed");
  assert.equal(tr("es", "{bot} is paused", { bot: "Lía" }), "Lía está en pausa");
  // A language still without a file (de, it, pt, zh) and a text nobody translated: the English text, filled in.
  assert.equal(tr("de", "{bot} is paused", { bot: "Max" }), "Max is paused");
  assert.equal(tr("es", "A text no dictionary has: {x}", { x: "1" }), "A text no dictionary has: 1");
  assert.equal(lang.localize("zh", "Backup failed", { "Backup failed": "x" }), "Backup failed");
  assert.equal(lang.byLocale("es", { en: "a", fr: "b", es: "c" }), "c");
  assert.equal(lang.byLocale("it", { en: "a", fr: "b" }), "a");
});

test("every Spanish server text keeps the placeholders of its English key", () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const bad = Object.entries(es).filter(([en, t]) => vars(en) !== vars(t)).map(([en]) => en);
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(es).length > 1500, "the Spanish server dictionary is filled");
});

const { api } = await import("../src/routes.js");
const { users } = await import("../src/store.js");
type Res = { status: number; json: any; text: string; cookie: string };
let ip = 0;
async function call(method: string, url: string, o: { body?: unknown; cookie?: string; lang?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}`, origin: "https://sklubot.example", host: "sklubot.example" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.lang) headers["accept-language"] = o.lang;
  const res = await api.request(url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const set = res.headers.getSetCookie().map((s) => s.split(";")[0]).find((s) => s.startsWith("sklubot_session=") && s.length > 20) ?? "";
  return { status: res.status, json, text, cookie: set };
}

test("the account language accepts Spanish (and the other languages), refuses unknown values, and survives a reload", async () => {
  const su = await call("POST", "/auth/signup", { body: { email: "ana@example.test", password: "ana-password-1", name: "Ana", locale: "es" } });
  assert.equal(su.status, 200, su.text);
  assert.equal(su.json.user.locale, "es");
  const id = su.json.user.id as string;
  assert.equal(users.localeOf(id), "es");
  const de = await call("PUT", "/prefs", { cookie: su.cookie, body: { locale: "de" } });
  assert.equal(de.status, 200, de.text);
  assert.equal(de.json.user.locale, "de");
  const bad = await call("PUT", "/prefs", { cookie: su.cookie, body: { locale: "xx" } });
  assert.equal(bad.json.user.locale, "de", "an unknown language changes nothing");
  await call("PUT", "/prefs", { cookie: su.cookie, body: { locale: "es" } });
  assert.equal(users.byId(id)?.locale, "es");
});

test("an error before sign-in follows the browser language: Spanish for es-*, English for a language without a file", async () => {
  const es1 = await call("POST", "/auth/email-link", { lang: "es-MX,es;q=0.9", body: { email: "not-an-address" } });
  assert.equal(es1.status, 400);
  assert.equal(es1.json.error, "Introduce una dirección de correo válida.");
  const ja = await call("POST", "/auth/email-link", { lang: "ja-JP", body: { email: "not-an-address" } });
  assert.equal(ja.json.error, "Enter a valid email address.");
  const fr = await call("POST", "/auth/email-link", { body: { email: "not-an-address", locale: "fr" } });
  assert.equal(fr.json.error, "Indique une adresse e-mail valide.");
});

test("the bot's prompt asks for the account language when the conversation has none yet (Spanish, Chinese…)", async () => {
  const { languageLine } = await import("../src/agent/nodguidance.js");
  assert.match(languageLine({ id: "no-such-bot", generation: 0 }, "es"), /none yet: use Spanish/);
  assert.match(languageLine({ id: "no-such-bot", generation: 0 }, "zh"), /none yet: use Simplified Chinese/);
  assert.match(languageLine({ id: "no-such-bot", generation: 0 }, "fr"), /none yet: use French/);
});
