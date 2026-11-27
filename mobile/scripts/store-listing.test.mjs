// L160 / L177: listing limits, eas.json profiles, Live Activity state fields, screenshot page, store-rules watch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chars, easProblems, LANGUAGES, listingProblems, stateFieldsMatch, swiftStateFields, tsStateFields } from "./store-listing.mjs";
import { compare, exitCode, findDate, SOURCES } from "./store-rules-watch.mjs";
import { shotHtml } from "./store-shots.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const listing = JSON.parse(readFileSync(join(ROOT, "store/listing.json"), "utf8"));
const eas = JSON.parse(readFileSync(join(ROOT, "eas.json"), "utf8"));

test("listing: the 7 app languages, every text within Apple and Google Play limits", () => {
  assert.deepEqual(Object.keys(listing.locales).sort(), [...LANGUAGES].sort());
  for (const l of LANGUAGES) assert.deepEqual(listingProblems(l, listing.locales[l]).filter((p) => p.level === "ÉCHEC"), [], l);
  for (const l of LANGUAGES) assert.equal(listing.locales[l].captions.length, listing.screens.length, `${l} captions`);
});

test("listing limits: 31-char name, 81-char short text, 101-byte keywords, 2-letter keyword all fail", () => {
  const ok = listing.locales.en;
  const fails = (patch) => listingProblems("en", { ...ok, ...patch }).some((p) => p.level === "ÉCHEC");
  assert.equal(fails({}), false);
  assert.ok(fails({ name: "x".repeat(31) }));
  assert.ok(!fails({ name: "x".repeat(30) }));
  assert.ok(fails({ shortDescription: "x".repeat(81) }));
  assert.ok(fails({ subtitle: "x".repeat(31) }));
  assert.ok(fails({ promotionalText: "x".repeat(171) }));
  assert.ok(fails({ description: "x".repeat(4001) }));
  assert.ok(fails({ keywords: "机器人".repeat(12) })); // 108 bytes, 36 characters
  assert.ok(fails({ keywords: "chat,AI,bots" }));
  assert.equal(chars("é😀"), 2);
  assert.ok(listingProblems("en", { ...ok, releaseNotes: "x".repeat(600) }).some((p) => p.level === "ATTENTION"));
});

test("eas.json: preview (internal APK) and production (store AAB) profiles, no account id written", () => {
  assert.deepEqual(easProblems(eas), []);
  assert.ok(easProblems({ ...eas, submit: { production: { ios: { appleTeamId: "AB12XYZ34S" } } } }).some((p) => /identifiants de compte/.test(p)));
  assert.ok(!easProblems({ ...eas, submit: { production: { ios: { ascApiKeyPath: "$ASC_API_KEY_PATH" } } } }).some((p) => /identifiants/.test(p)));
  assert.ok(easProblems({ ...eas, build: { ...eas.build, production: { ...eas.build.production, env: { SKLUBOT_VARIANT: "store", SKLUBOT_LIVE_ACTIVITY: "1" } } } }).some((p) => /SKLUBOT_LIVE_ACTIVITY/.test(p)));
});

test("Live Activity content state: TypeScript and both Swift copies agree; a renamed field is caught", () => {
  const ts = tsStateFields(readFileSync(join(ROOT, "../server/src/clientshared/taskactivity.ts"), "utf8"));
  const w = swiftStateFields(readFileSync(join(ROOT, "targets/sklubot-live/SklubotTaskAttributes.swift"), "utf8"));
  const m = swiftStateFields(readFileSync(join(ROOT, "modules/sklubot-liveactivity/ios/SklubotLiveActivityModule.swift"), "utf8"));
  assert.deepEqual(ts, ["step:string", "steps:number", "startedAt:number", "awaiting:boolean"]);
  assert.ok(stateFieldsMatch(ts, w, m));
  assert.ok(!stateFieldsMatch(ts, w, m.map((f) => f.replace("awaiting", "waiting"))));
  assert.ok(!stateFieldsMatch(ts, w.map((f) => f.replace("startedAt:Double", "startedAt:String")), m));
});

test("screenshot page: caption escaped, phone frame fits the canvas", () => {
  const html = shotHtml({ width: 1320, height: 2868, caption: "<b>&", imageDataUri: "data:image/png;base64,AA" });
  assert.match(html, /&lt;b&gt;&amp;/);
  const w = Number(/\.phone\{width:(\d+)px;height:(\d+)px/.exec(html)[1]), h = Number(/\.phone\{width:\d+px;height:(\d+)px/.exec(html)[1]);
  assert.ok(w <= 1320 && h + Math.round(2868 * 0.17) <= 2868);
});

test("rules watch: date found on both pages, change → code 2, unreadable → code 1", () => {
  const [apple, google] = SOURCES;
  assert.equal(findDate(apple, "<footer><p>Last Updated: October 16, 2026</p></footer>"), "October 16, 2026");
  assert.equal(findDate(google, "<div>October 29, 2026: We&#39;re updating our policies. <a>Learn more</a></div>"), "October 29, 2026");
  assert.equal(findDate(google, "<div>October 29, 2026: We’re updating our policies.</div>"), "October 29, 2026");
  const saved = { apple: { date: "October 16, 2026" }, google: { date: "October 29, 2026" } };
  const same = compare(saved, { apple: { date: "October 16, 2026" }, google: { date: "October 29, 2026" } });
  assert.equal(exitCode(same), 0);
  const changed = compare(saved, { apple: { date: "December 1, 2026" }, google: { date: "October 29, 2026" } });
  assert.equal(changed[0].level, "CHANGÉ");
  assert.equal(exitCode(changed), 2);
  assert.equal(exitCode(compare(saved, { apple: { error: "HTTP 503" }, google: { date: null } })), 1);
});
