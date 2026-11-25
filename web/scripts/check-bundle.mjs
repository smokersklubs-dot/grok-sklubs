#!/usr/bin/env node
// The production build must not contain the dev state gallery (web/src/dev/, loaded by main.tsx only when
// `import.meta.env.DEV` is true). Run after `npm run build -w web`:
//
//   npm run check:bundle -w web
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
// Strings only the gallery has: its root marker, its title, its fake-API error text, its source path.
const MARKERS = ["sklubot-dev-gallery", "galerie des états", "Exemple d'erreur : le serveur", "dev/Gallery", "gallery-swatch"];

if (!existsSync(dist)) {
  console.error("web/dist is missing: run `npm run build -w web` first.");
  process.exit(1);
}
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : /\.(js|css|html)$/.test(e.name) && files.push(join(d, e.name)); };
walk(dist);
const found = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of MARKERS) if (text.includes(m)) found.push(`${f.slice(dist.length + 1)} contains "${m}"`);
}
if (found.length) {
  console.error(`The dev gallery leaked into the production build:\n${found.join("\n")}\nKeep its import behind \`import.meta.env.DEV\` (web/src/main.tsx).`);
  process.exit(1);
}
// Each language other than French and English is loaded on demand (src/i18n/index.ts LOADERS): its texts must be in a
// chunk of their own, never in the entry script, so the app does not grow with every language (docs/LANGUES.md).
const { readDict, ROOT } = await import("../../scripts/i18n/dicts.mjs");
const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
const entryName = /<script[^>]+src="\/?assets\/([^"]+\.js)"/.exec(indexHtml)?.[1];
const entry = entryName ? readFileSync(join(dist, "assets", entryName), "utf8") : "";
const lazy = readdirSync(join(ROOT, "web/src/i18n")).map((f) => /^([a-z]{2})\.ts$/.exec(f)?.[1]).filter((l) => l && l !== "fr" && l !== "en");
const others = new Set([...readDict("web/src/i18n/en.ts", /^en$/).map.values(), ...readDict("web/src/i18n/fr.ts", /^fr$/).map.values()]);
const leaks = [];
for (const lang of lazy) {
  // A long text only this language has (JSON-escaped, as the bundler writes it, without the surrounding quotes).
  const marker = [...readDict(`web/src/i18n/${lang}.ts`, new RegExp(`^${lang}$`)).map.values()].filter((v) => typeof v === "string" && !others.has(v) && /^[^"\\]{40,200}$/.test(v)).sort((a, b) => b.length - a.length)[0];
  if (!marker) continue;
  if (entry.includes(marker)) leaks.push(`${lang}: its texts are in the entry script ${entryName}`);
  else if (!files.some((f) => readFileSync(f, "utf8").includes(marker))) leaks.push(`${lang}: its texts are in no chunk (is it registered in src/i18n/index.ts LOADERS?)`);
}
if (leaks.length) {
  console.error(`Language dictionaries must be loaded on demand:\n${leaks.join("\n")}\nRegister them with import() in web/src/i18n/index.ts (docs/LANGUES.md).`);
  process.exit(1);
}
console.log(`Production build clean: ${files.length} files, no dev gallery code; ${lazy.length} language(s) loaded on demand (${lazy.join(", ") || "none"}).`);
