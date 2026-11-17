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
console.log(`Production build clean: ${files.length} files, no dev gallery code.`);
