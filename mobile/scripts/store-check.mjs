#!/usr/bin/env node
/**
 * L160 — contrôle avant envoi aux boutiques (App Store, Google Play), sans réseau ni compte :
 *   cd mobile && npm run store:check            (contrôle ; code 1 s'il y a un ÉCHEC)
 *   cd mobile && npm run store:check -- --write (réécrit store/PrivacyInfo.xcprivacy depuis store/privacy-manifest.json)
 *   cd mobile && npm run store:check -- --bundle chemin/du/bundle.js   (cherche aussi des clés dans un bundle exporté)
 *   cd mobile && npm run store:check -- --permissions perms.txt        (sortie de « aapt2 dump permissions » de l'APK store)
 *
 * What it checks (each line OK / ATTENTION / ÉCHEC):
 * - versions: VERSION (x.y.z) and VERSION_CODE in app.config.ts; ios.buildNumber follows VERSION_CODE; STORE.md names the
 *   same version and versionCode; the generated Android project (if present) agrees.
 * - icons and pictures: assets/icon.png 1024 × 1024 with NO transparency (App Store marketing icon:
 *   https://developer.apple.com/design/human-interface-guidelines/app-icons — "opaque"), the adaptive icon layers
 *   1024 × 1024, store/icon-512.png 512 × 512 (Play: https://support.google.com/googleplay/android-developer/answer/9866151),
 *   2 to 8 phone screenshots whose long side is at most twice the short side (same Play page).
 * - permission strings: the photo, camera and microphone texts of expo-image-picker exist, are sentences that say why
 *   (Apple App Review Guidelines 5.1.1(ii)), and the microphone text does not promise calls on iOS where there are none.
 * - privacy manifest: store/privacy-manifest.json is what app.config.ts gives to Expo (ios.privacyManifests,
 *   https://docs.expo.dev/guides/apple-privacy/), store/PrivacyInfo.xcprivacy is the same content, no tracking, known
 *   data-type keys, and every required-reason API category + reason declared by an installed library's own
 *   PrivacyInfo.xcprivacy is declared too (Apple: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api;
 *   Expo notes that Apple does not always read the libraries' own files, hence the copy in the app's manifest).
 * - no keys bundled: the app's source (src, App.tsx, index.ts, app.config.ts, plugins, shared, store JSON) holds no API
 *   key, token or private key, and no signing file sits in assets/.
 * - permission justifications (store/permissions.json): every permission the store build declares (the repo's manifests
 *   that reach it, or the `aapt2 dump permissions` output passed with --permissions) has a plain-words reason and a
 *   « when », every iOS usage text exists, nothing from the « never in the store » list is declared, and STORE.md has
 *   the table for the reviewers (Play: https://support.google.com/googleplay/android-developer/answer/9888170 asks to
 *   declare why sensitive permissions are needed; Apple 5.1.1(ii) asks for the purpose string).
 * - « Signaler cette réponse »: the button is wired in the chat (components/Chat.tsx → ReportSheet) with its texts in
 *   both languages (Apple 1.2 asks apps that show generated content to let users report it).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── PNG: size, colour type and whether any pixel is not fully opaque ────────────────────────────────────────────
export function pngInfo(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let i = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, trns = false;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), kind = buf.toString("ascii", i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === "tRNS") trns = true;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    i += 12 + len;
  }
  return { width: w, height: h, depth, type, interlace, trns, idat: Buffer.concat(idat) };
}

/** True when the PNG has at least one pixel that is not fully opaque (8-bit RGBA / grey+alpha, not interlaced; tRNS = yes). */
export function hasTransparency(buf) {
  const p = pngInfo(buf);
  if (p.trns) return true;
  if (p.type !== 6 && p.type !== 4) return false; // no alpha channel at all
  if (p.depth !== 8 || p.interlace) return true; // not decoded here: counted as possibly transparent
  const ch = p.type === 6 ? 4 : 2, stride = p.width * ch, raw = inflateSync(p.idat);
  let prev = Buffer.alloc(stride), off = 0;
  for (let y = 0; y < p.height; y++) {
    const f = raw[off++], line = Buffer.from(raw.subarray(off, off + stride));
    off += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
    }
    for (let x = ch - 1; x < stride; x += ch) if (line[x] !== 255) return true;
    prev = line;
  }
  return false;
}

// ── Privacy manifest as a property list (the format of PrivacyInfo.xcprivacy) ───────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function plistValue(v, pad) {
  if (v === true) return `${pad}<true/>`;
  if (v === false) return `${pad}<false/>`;
  if (typeof v === "string") return `${pad}<string>${esc(v)}</string>`;
  if (Array.isArray(v)) return v.length ? `${pad}<array>\n${v.map((x) => plistValue(x, pad + "\t")).join("\n")}\n${pad}</array>` : `${pad}<array/>`;
  return `${pad}<dict>\n${Object.entries(v).map(([k, x]) => `${pad}\t<key>${esc(k)}</key>\n${plistValue(x, pad + "\t")}`).join("\n")}\n${pad}</dict>`;
}
export function toPlist(obj) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(obj, "")}\n</plist>\n`;
}

/** The required-reason API categories and reasons a PrivacyInfo.xcprivacy declares: Map category → Set of reasons. */
export function declaredReasons(xml) {
  const out = new Map();
  const re = /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/g;
  for (let m; (m = re.exec(xml)); ) {
    const set = out.get(m[1]) ?? new Set();
    for (const r of m[2].matchAll(/<string>([^<]+)<\/string>/g)) set.add(r[1]);
    out.set(m[1], set);
  }
  return out;
}

/** Every PrivacyInfo.xcprivacy shipped by the app's direct dependencies (and react-native's own). */
export function libraryManifests(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "android" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === "PrivacyInfo.xcprivacy") found.push(p);
    }
  };
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(join(root, "node_modules", dep), 0);
  return found;
}

export const KNOWN_DATA_TYPES = new Set(["EmailAddress", "Name", "PhoneNumber", "PhysicalAddress", "OtherUserContactInfo", "PhotosorVideos", "AudioData", "GameplayContent", "CustomerSupport", "OtherUserContent", "PreciseLocation", "CoarseLocation", "Contacts", "EmailsOrTextMessages", "BrowsingHistory", "SearchHistory", "UserID", "DeviceID", "ProductInteraction", "AdvertisingData", "OtherUsageData", "CrashData", "PerformanceData", "OtherDiagnosticData", "Health", "Fitness", "PaymentInfo", "CreditInfo", "OtherFinancialInfo", "SensitiveInfo", "OtherDataTypes"].map((k) => `NSPrivacyCollectedDataType${k}`));

// ── Keys that must never ship in the app ─────────────────────────────────────────────────────────────────────────
export const KEY_PATTERNS = [
  ["clé Anthropic", /sk-ant-[A-Za-z0-9_-]{20,}/], ["clé OpenAI / sk-", /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/], ["clé Google", /AIza[0-9A-Za-z_-]{35}/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}/], ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/], ["clé Stripe", /\b[sprk]k_(?:test|live)_[A-Za-z0-9]{16,}/],
  ["clé AWS", /\bAKIA[0-9A-Z]{16}\b/], ["clé privée", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/], ["jeton Expo", /\bexpo_[A-Za-z0-9]{30,}/],
];
export function findKeys(text) {
  return KEY_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function filesUnder(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") filesUnder(p, exts, out); }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// ── The checks ───────────────────────────────────────────────────────────────────────────────────────────────────
export function runChecks(root = ROOT, opts = {}) {
  const results = [];
  const ok = (what) => results.push({ level: "OK", what });
  const warn = (what) => results.push({ level: "ATTENTION", what });
  const fail = (what) => results.push({ level: "ÉCHEC", what });
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const config = read("app.config.ts");

  // Versions
  const version = /const VERSION = "([^"]+)"/.exec(config)?.[1];
  const code = Number(/const VERSION_CODE = (\d+)/.exec(config)?.[1]);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail(`version : VERSION « ${version ?? "absente"} » n'est pas de la forme 1.2.3`);
  else if (!Number.isInteger(code) || code < 1) fail("version : VERSION_CODE doit être un entier ≥ 1");
  else {
    ok(`version ${version}, versionCode ${code}`);
    if (!/buildNumber: String\(VERSION_CODE\)/.test(config)) fail("version : ios.buildNumber doit suivre VERSION_CODE");
    if (!/versionCode: VERSION_CODE/.test(config)) fail("version : android.versionCode doit suivre VERSION_CODE");
    const store = read("STORE.md");
    if (!store.includes(`sklubot-store-${version}.aab`) || !new RegExp(`versionCode ${code}\\b`).test(store)) fail(`version : STORE.md ne cite pas sklubot-store-${version}.aab et versionCode ${code}`);
    else ok("STORE.md cite la même version");
    const gradle = join(root, "android/app/build.gradle");
    if (existsSync(gradle)) {
      const g = readFileSync(gradle, "utf8");
      const gc = Number(/versionCode (\d+)/.exec(g)?.[1]), gn = /versionName "([^"]+)"/.exec(g)?.[1];
      if (gc !== code || gn !== version) warn(`version : le projet Android généré dit ${gn} (${gc}) ; refaire « npx expo prebuild -p android --clean » avant de construire`);
      else ok("projet Android généré à jour");
    }
  }

  // Icons and pictures
  const png = (rel) => { const p = join(root, rel); return existsSync(p) ? readFileSync(p) : null; };
  const icon = png("assets/icon.png");
  if (!icon) fail("icône : assets/icon.png manquante");
  else {
    const i = pngInfo(icon);
    if (i.width !== 1024 || i.height !== 1024) fail(`icône : assets/icon.png fait ${i.width} × ${i.height}, il faut 1024 × 1024`);
    else if (hasTransparency(icon)) fail("icône : assets/icon.png a des pixels transparents ; l'App Store veut une icône opaque");
    else ok("icône 1024 × 1024 opaque");
  }
  for (const rel of ["assets/android-icon-foreground.png", "assets/android-icon-monochrome.png"]) {
    const b = png(rel);
    if (!b) fail(`icône Android : ${rel} manquante`);
    else { const i = pngInfo(b); if (i.width !== 1024 || i.height !== 1024) fail(`icône Android : ${rel} fait ${i.width} × ${i.height}`); }
  }
  const playIcon = png("store/icon-512.png");
  if (!playIcon) fail("Play : store/icon-512.png manquante");
  else { const i = pngInfo(playIcon); if (i.width !== 512 || i.height !== 512) fail(`Play : store/icon-512.png fait ${i.width} × ${i.height}, il faut 512 × 512`); else ok("icône Play 512 × 512"); }
  if (!png("assets/notification-icon.png")) fail("notifications : assets/notification-icon.png manquante");
  const shots = existsSync(join(root, "store")) ? readdirSync(join(root, "store")).filter((f) => /^\d\d-.*\.png$/.test(f)) : [];
  const badShots = shots.filter((f) => { const i = pngInfo(png(`store/${f}`)); return Math.max(i.width, i.height) > 2 * Math.min(i.width, i.height) || Math.min(i.width, i.height) < 320; });
  if (shots.length < 2 || shots.length > 8) fail(`captures : ${shots.length} dans store/, Play en veut 2 à 8`);
  else if (badShots.length) fail(`captures : mauvaises proportions (${badShots.join(", ")})`);
  else ok(`${shots.length} captures téléphone aux bonnes proportions`);

  // Permission strings
  const perm = (name) => new RegExp(`${name}:\\s*"([^"]*)"`).exec(config)?.[1] ?? "";
  for (const [name, label] of [["photosPermission", "photos"], ["cameraPermission", "appareil photo"], ["microphonePermission", "micro"]]) {
    const text = perm(name);
    if (text.length < 25 || !/seulement|quand|pendant|pour/i.test(text)) fail(`permission ${label} : texte absent ou sans raison (« ${text} »)`);
  }
  if (perm("photosPermission") && perm("cameraPermission")) ok("textes des permissions photos et appareil photo");
  if (/appel vocal/i.test(perm("microphonePermission"))) warn("permission micro : le texte parle d'appels vocaux, qui n'existent pas encore sur iPhone (src/voice/call.ts : Android seulement). Avant l'envoi iOS, adapter le texte ou retirer la permission pour iOS (voir STORE.md).");

  // Privacy manifest
  let manifest = null;
  try { manifest = JSON.parse(read("store/privacy-manifest.json")); } catch (e) { fail(`manifeste de confidentialité : store/privacy-manifest.json illisible (${e.message})`); }
  if (manifest) {
    if (!/privacyManifests: require\("\.\/store\/privacy-manifest\.json"\)/.test(config)) fail("manifeste : app.config.ts ne donne pas store/privacy-manifest.json à ios.privacyManifests");
    const xmlPath = join(root, "store/PrivacyInfo.xcprivacy");
    const want = toPlist(manifest);
    if (opts.write) { writeFileSync(xmlPath, want); ok("store/PrivacyInfo.xcprivacy réécrit"); }
    if (!existsSync(xmlPath)) fail("manifeste : store/PrivacyInfo.xcprivacy manquant (npm run store:check -- --write)");
    else if (readFileSync(xmlPath, "utf8") !== want) fail("manifeste : store/PrivacyInfo.xcprivacy diffère de store/privacy-manifest.json (npm run store:check -- --write)");
    if (manifest.NSPrivacyTracking !== false || (manifest.NSPrivacyTrackingDomains ?? []).length) fail("manifeste : l'appli ne fait aucun pistage ; NSPrivacyTracking doit être false, sans domaine");
    const unknown = (manifest.NSPrivacyCollectedDataTypes ?? []).filter((d) => !KNOWN_DATA_TYPES.has(d.NSPrivacyCollectedDataType) || d.NSPrivacyCollectedDataTypeTracking !== false || !(d.NSPrivacyCollectedDataTypePurposes ?? []).length);
    if (unknown.length) fail(`manifeste : types de données inconnus ou incomplets (${unknown.map((d) => d.NSPrivacyCollectedDataType).join(", ")})`);
    const ours = declaredReasons(want);
    const missing = [];
    const libs = libraryManifests(root);
    for (const f of libs) for (const [cat, reasons] of declaredReasons(readFileSync(f, "utf8"))) for (const r of reasons) if (!ours.get(cat)?.has(r)) missing.push(`${cat.replace("NSPrivacyAccessedAPICategory", "")} ${r} (${f.slice(root.length + 1).replace(/^node_modules\//, "").split("/")[0]})`);
    if (!libs.length) warn("manifeste : aucune bibliothèque installée trouvée (npm install d'abord) ; couverture des raisons non vérifiée");
    else if (missing.length) fail(`manifeste : raisons d'API manquantes : ${[...new Set(missing)].join(" ; ")}`);
    else ok(`manifeste de confidentialité : ${ours.size} catégories d'API, couvre les ${libs.length} manifestes des bibliothèques`);
  }

  // Keys
  const sources = [...filesUnder(join(root, "src"), [".ts", ".tsx", ".json"]), ...filesUnder(join(root, "shared"), [".ts"]), ...filesUnder(join(root, "plugins"), [".js"]), ...filesUnder(join(root, "store"), [".json"]),
    ...["App.tsx", "index.ts", "app.config.ts", "metro.config.js"].map((f) => join(root, f)).filter(existsSync), ...(opts.bundles ?? [])];
  const leaks = [];
  for (const f of sources) { const k = findKeys(readFileSync(f, "utf8")); if (k.length) leaks.push(`${f.startsWith(root) ? f.slice(root.length + 1) : f} (${k.join(", ")})`); }
  const signing = existsSync(join(root, "assets")) ? readdirSync(join(root, "assets")).filter((f) => /\.(jks|keystore|p12|p8|pem)$|keystore\.properties/.test(f)) : [];
  if (leaks.length) fail(`clés : quelque chose qui ressemble à une clé dans ${leaks.join(" ; ")}`);
  else if (signing.length) fail(`clés : fichier de signature dans assets/ (${signing.join(", ")})`);
  else ok(`aucune clé dans ${sources.length} fichiers de l'appli`);

  // « Signaler cette réponse »
  const chat = read("src/components/Chat.tsx");
  const fr = read("src/i18n/fr.ts"), en = read("src/i18n/en.ts");
  if (!/ReportButton/.test(chat) || !/canReport\(/.test(chat) || !existsSync(join(root, "src/components/ReportSheet.tsx"))) fail("« Signaler cette réponse » : le bouton n'est plus branché dans components/Chat.tsx");
  else if (!/"report\.[\w.]+":/.test(fr) || !/"report\.[\w.]+":/.test(en)) fail("« Signaler cette réponse » : textes report.* manquants en français ou en anglais");
  else ok("« Signaler cette réponse » présent dans la discussion");

  // Permission justifications (L160)
  permissionChecks(root, read, opts, ok, warn, fail);

  // Store sheet up to date with what the app does
  const sheet = read("STORE.md");
  if (/Localisation, contacts/.test(sheet) && !/position/i.test(sheet.split("Sécurité des données")[1] ?? "")) fail("STORE.md : la sécurité des données ne dit pas que la position peut être partagée (demande d'un bot, L177)");
  if (!/Classification par âge \(App Store\)/.test(sheet)) fail("STORE.md : réponses au questionnaire d'âge Apple manquantes");
  return results;
}

/** `uses-permission` names of a manifest, minus those it removes (tools:node="remove"). */
export function manifestPermissions(xml) {
  return [...xml.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*\/?>/g)].filter((m) => !/tools:node="remove"/.test(m[0])).map((m) => m[1]);
}
/** Names in `aapt2 dump permissions` output ("uses-permission: name='X'"). */
export const aaptPermissions = (text) => [...text.matchAll(/uses-permission(?:-sdk-23)?: name='([^']+)'/g)].map((m) => m[1]);

function permissionChecks(root, read, opts, ok, warn, fail) {
  const p = join(root, "store/permissions.json");
  if (!existsSync(p)) { fail("permissions : store/permissions.json manquant (justification de chaque permission)"); return; }
  let j;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { fail("permissions : store/permissions.json illisible"); return; }
  const justified = new Map((j.android ?? []).map((e) => [e.permission, e]));
  for (const [name, e] of justified) if (!e.why || e.why.length < 15 || !e.when) fail(`permissions : ${name} sans raison claire ni moment`);
  // What the store build declares: the app's own manifest and the modules that reach it (live and relay are cut, withRelayVariant).
  const sources = ["android/app/src/main/AndroidManifest.xml", "modules/sklubot-voice/android/src/main/AndroidManifest.xml"].filter((f) => existsSync(join(root, f)));
  const declared = new Set(sources.flatMap((f) => manifestPermissions(read(f))));
  for (const f of opts.permissionFiles ?? []) for (const n of aaptPermissions(readFileSync(f, "utf8"))) declared.add(n);
  const never = new Set(j.neverInStore ?? []);
  const forbidden = [...declared].filter((n) => never.has(n));
  const missing = [...declared].filter((n) => !justified.has(n) && !never.has(n) && !/^com\.|^me\.|\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$/.test(n));
  if (forbidden.length) fail(`permissions : jamais dans la version store : ${forbidden.join(", ")}`);
  if (missing.length) fail(`permissions : sans justification dans store/permissions.json : ${missing.join(", ")}`);
  if (!(opts.permissionFiles ?? []).length) warn("permissions : liste lue dans le dépôt seulement ; passer la sortie de « aapt2 dump permissions » avec --permissions pour contrôler aussi celles des bibliothèques");
  const config = read("app.config.ts");
  const ios = { NSCameraUsageDescription: /cameraPermission: "[^"]{20,}"/, NSPhotoLibraryUsageDescription: /photosPermission: "[^"]{20,}"/, NSMicrophoneUsageDescription: /microphonePermission: "[^"]{20,}"/ };
  for (const e of j.ios ?? []) if (ios[e.key] && !ios[e.key].test(config)) fail(`permissions : texte iOS ${e.key} absent de app.config.ts`);
  const sheet = read("STORE.md");
  const absent = [...justified.keys()].filter((n) => !sheet.includes(n.replace("android.permission.", "")));
  if (!/Justification des permissions/.test(sheet) || absent.length) fail(`permissions : STORE.md doit avoir le tableau « Justification des permissions »${absent.length ? ` (manque ${absent.join(", ")})` : ""}`);
  if (!forbidden.length && !missing.length && !absent.length) ok(`permissions : ${justified.size} justifiées (${declared.size} déclarées dans les manifestes lus), ${(j.ios ?? []).length} textes iOS`);
}

/** A short fingerprint of the manifest, printed so two runs can be compared at a glance. */
export const manifestDigest = (root = ROOT) => createHash("sha256").update(readFileSync(join(root, "store/privacy-manifest.json"))).digest("hex").slice(0, 12);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const bundles = args.flatMap((a, i) => (a === "--bundle" && args[i + 1] ? [args[i + 1]] : []));
  const permissionFiles = args.flatMap((a, i) => (a === "--permissions" && args[i + 1] ? [args[i + 1]] : []));
  const results = runChecks(ROOT, { write: args.includes("--write"), bundles, permissionFiles });
  for (const r of results) console.log(`${r.level === "OK" ? "OK       " : r.level === "ATTENTION" ? "ATTENTION" : "ÉCHEC    "} ${r.what}`);
  const failed = results.filter((r) => r.level === "ÉCHEC").length, warned = results.filter((r) => r.level === "ATTENTION").length;
  console.log(`\n${failed ? `${failed} échec(s)` : "Prêt pour l'envoi"}${warned ? `, ${warned} point(s) à regarder` : ""}. Manifeste ${manifestDigest()}.`);
  process.exit(failed ? 1 : 0);
}
