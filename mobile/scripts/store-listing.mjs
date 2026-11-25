/**
 * L160 / L177 — more checks for `npm run store:check` (called from store-check.mjs), without network nor account:
 *
 * 1. store/listing.json: one entry per app language, every text within the stores' limits —
 *    Apple (https://developer.apple.com/help/app-store-connect/reference/app-information/app-information and
 *    .../platform-version-information): name 2–30 characters, subtitle ≤ 30, promotional text ≤ 170, description ≤ 4000,
 *    "What's New" ≤ 4000, keywords ≤ 100 bytes (each keyword more than two characters);
 *    Google Play (https://support.google.com/googleplay/android-developer/answer/9859152): app name ≤ 30, short
 *    description ≤ 80, full description ≤ 4000 (full-width and half-width characters count the same).
 *    Play's help gives no limit for release notes: over 500 characters is only an ATTENTION (the console form's limit).
 * 2. store/shots/<language>/<device>/: the screenshots made by `npm run store:shots` at the sizes the stores take —
 *    iPhone 6.9" 1320 × 2868 (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
 *    and Android phone 1080 × 1920 (Play: 2 to 8, each side 320–3840 px, https://support.google.com/googleplay/android-developer/answer/9866151).
 * 3. eas.json: the build and submit profiles of docs/BOUTIQUES.md (https://docs.expo.dev/eas/json/), and no account
 *    identifier written in it (Apple ID, App Store Connect ids, Team ID: they stay with the owner).
 * 4. Live Activity (L177): off unless SKLUBOT_LIVE_ACTIVITY=1, and the three copies of its content state (TypeScript and
 *    the two Swift structs) have the same fields.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pngInfo } from "./store-check.mjs";

export const LANGUAGES = ["fr", "en", "es", "de", "it", "pt", "zh"];
export const LIMITS = {
  name: { max: 30, min: 2 }, subtitle: { max: 30 }, shortDescription: { max: 80 }, promotionalText: { max: 170 },
  description: { max: 4000 }, releaseNotes: { max: 4000, soft: 500 }, keywordsBytes: { max: 100 },
};
export const DEVICES = { "iphone-6.9": { width: 1320, height: 2868 }, "android-phone": { width: 1080, height: 1920 } };
/** Characters as people count them (a code point each, as both stores do), not UTF-16 units. */
export const chars = (s) => [...String(s ?? "")].length;

/** Problems of one language's texts: [{ level: "ÉCHEC" | "ATTENTION", what }]. */
export function listingProblems(lang, e) {
  const out = [];
  const bad = (what) => out.push({ level: "ÉCHEC", what: `fiche ${lang} : ${what}` });
  if (!e || typeof e !== "object") { bad("absente de store/listing.json"); return out; }
  for (const f of ["name", "subtitle", "shortDescription", "promotionalText", "description", "releaseNotes", "keywords"]) if (typeof e[f] !== "string" || !e[f].trim()) bad(`champ « ${f} » vide`);
  if (out.length) return out;
  for (const f of ["name", "subtitle", "shortDescription", "promotionalText", "description", "releaseNotes"]) {
    const n = chars(e[f]), lim = LIMITS[f];
    if (n > lim.max) bad(`« ${f} » fait ${n} caractères, ${lim.max} au plus`);
    else if (lim.min && n < lim.min) bad(`« ${f} » fait ${n} caractères, ${lim.min} au moins`);
    else if (lim.soft && n > lim.soft) out.push({ level: "ATTENTION", what: `fiche ${lang} : « ${f} » fait ${n} caractères ; la Play Console en prend ${lim.soft}` });
  }
  const bytes = Buffer.byteLength(e.keywords, "utf8");
  if (bytes > LIMITS.keywordsBytes.max) bad(`mots-clés : ${bytes} octets, Apple en prend ${LIMITS.keywordsBytes.max}`);
  const short = e.keywords.split(",").map((k) => k.trim()).filter((k) => [...k].length <= 2 && !/[㐀-鿿]/.test(k));
  if (short.length) bad(`mots-clés de deux lettres ou moins (${short.join(", ")})`);
  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(e.apple ?? "") || !/^[a-z]{2}-[A-Z]{2}$/.test(e.play ?? "")) bad("codes de langue Apple / Play manquants");
  if (!Array.isArray(e.captions) || !e.captions.length) bad("légendes des captures manquantes");
  return out;
}

export function easProblems(eas) {
  const out = [];
  const bad = (what) => out.push(`eas.json : ${what}`);
  const prod = eas?.build?.production, prev = eas?.build?.preview;
  if (eas?.cli?.appVersionSource !== "local") bad("cli.appVersionSource doit être « local » (les versions viennent de app.config.ts)");
  if (!prod || prod.distribution !== "store" || prod.android?.buildType !== "app-bundle" || prod.env?.SKLUBOT_VARIANT !== "store") bad("profil build.production : distribution store, android.buildType app-bundle, env.SKLUBOT_VARIANT store");
  if (!prev || prev.distribution !== "internal" || prev.android?.buildType !== "apk" || prev.env?.SKLUBOT_VARIANT !== "store") bad("profil build.preview : distribution internal, android.buildType apk, env.SKLUBOT_VARIANT store");
  if (!eas?.submit?.production) bad("profil submit.production manquant");
  const ids = [];
  for (const [name, p] of Object.entries(eas?.submit ?? {})) for (const k of ["appleId", "ascAppId", "appleTeamId", "ascApiKeyId", "ascApiKeyIssuerId", "ascApiKeyPath", "serviceAccountKeyPath"]) {
    const v = p?.ios?.[k] ?? p?.android?.[k];
    if (typeof v === "string" && !v.startsWith("$")) ids.push(`${name}.${k}`);
  }
  if (ids.length) bad(`identifiants de compte écrits dans le fichier (${ids.join(", ")}) : les laisser à EAS (il les demande) ou passer par une variable $…`);
  if (JSON.stringify(eas ?? {}).match(/SKLUBOT_LIVE_ACTIVITY/)) bad("SKLUBOT_LIVE_ACTIVITY ne doit pas être allumé dans eas.json (désactivé par défaut)");
  return out;
}

/** Field names of a Swift `struct ContentState` and of the TypeScript `interface TaskActivityState`. */
export const swiftStateFields = (src) => [...(/struct ContentState[^{]*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? "").matchAll(/var (\w+): (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
const TS_TO_SWIFT = { string: ["String"], number: ["Int", "Double"], boolean: ["Bool"] };
export const tsStateFields = (src) => [...(/interface TaskActivityState \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "").matchAll(/^\s*(\w+): (\w+);/gm)].map((m) => `${m[1]}:${m[2]}`);
export function stateFieldsMatch(ts, a, b) {
  if (!ts.length || a.join() !== b.join() || ts.length !== a.length) return false;
  return ts.every((t, i) => { const [n, type] = t.split(":"), [sn, st] = a[i].split(":"); return n === sn && (TS_TO_SWIFT[type] ?? []).includes(st); });
}

export function listingChecks(root, ok, warn, fail) {
  // 1. Texts
  let listing = null;
  try { listing = JSON.parse(readFileSync(join(root, "store/listing.json"), "utf8")); } catch (e) { fail(`fiche : store/listing.json illisible (${e.message})`); }
  if (listing) {
    const probs = LANGUAGES.flatMap((l) => listingProblems(l, listing.locales?.[l]));
    for (const p of probs) (p.level === "ÉCHEC" ? fail : warn)(p.what);
    if (!probs.some((p) => p.level === "ÉCHEC")) ok(`fiche des boutiques : ${LANGUAGES.length} langues dans les limites Apple et Google Play`);
    // 2. Screenshots
    const screens = listing.screens ?? [];
    const missing = [], wrong = [];
    for (const l of LANGUAGES) for (const [dev, size] of Object.entries(DEVICES)) for (let i = 0; i < screens.length; i++) {
      const f = join(root, "store/shots", l, dev, `${String(i + 1).padStart(2, "0")}.png`);
      if (!existsSync(f)) { missing.push(`${l}/${dev}`); continue; }
      const p = pngInfo(readFileSync(f));
      if (p.width !== size.width || p.height !== size.height) wrong.push(`${l}/${dev}/${i + 1} (${p.width} × ${p.height})`);
    }
    if (screens.length < 2 || screens.length > 8) fail(`captures : ${screens.length} écrans dans store/listing.json, il en faut 2 à 8`);
    else if (wrong.length) fail(`captures à la mauvaise taille : ${wrong.slice(0, 5).join(", ")}`);
    else if (missing.length) warn(`captures des boutiques pas encore faites (${[...new Set(missing)].length} dossiers) : npm run store:shots`);
    else ok(`captures des boutiques : ${screens.length} × ${LANGUAGES.length} langues × iPhone 6,9" et Android`);
  }
  // 3. eas.json
  let eas = null;
  try { eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8")); } catch (e) { fail(`eas.json illisible (${e.message})`); }
  if (eas) { const probs = easProblems(eas); for (const p of probs) fail(p); if (!probs.length) ok("eas.json : profils preview et production, aucun identifiant de compte"); }
  // 4. Live Activity
  const config = readFileSync(join(root, "app.config.ts"), "utf8");
  if (!/const LIVE_ACTIVITY = process\.env\.SKLUBOT_LIVE_ACTIVITY === "1";/.test(config)) fail("Live Activity : doit rester éteinte par défaut (SKLUBOT_LIVE_ACTIVITY=1 seulement)");
  const ts = join(root, "../server/src/clientshared/taskactivity.ts"), w = join(root, "targets/sklubot-live/SklubotTaskAttributes.swift"), m = join(root, "modules/sklubot-liveactivity/ios/SklubotLiveActivityModule.swift");
  if (![ts, w, m, join(root, "targets/sklubot-live/expo-target.config.js")].every(existsSync)) fail("Live Activity : fichiers manquants (targets/sklubot-live, modules/sklubot-liveactivity, clientshared/taskactivity.ts)");
  else if (!stateFieldsMatch(tsStateFields(readFileSync(ts, "utf8")), swiftStateFields(readFileSync(w, "utf8")), swiftStateFields(readFileSync(m, "utf8")))) fail("Live Activity : ContentState différent entre TypeScript et les deux fichiers Swift");
  else ok("Live Activity : éteinte par défaut, même contenu côté serveur, appli et widget");
}
