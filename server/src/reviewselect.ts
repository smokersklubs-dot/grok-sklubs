/*
 * Portions adapted from alibaba/open-code-review (https://github.com/alibaba/open-code-review, commit
 * e74f2c6bd4422bd1e12d257d1725bcce1d6b9ddd), Copyright 2026 alibaba/open-code-review Contributors, Apache-2.0;
 * modified for Sklubot: internal/agent/selection.go (one deterministic selection pass with a reason per excluded file)
 * and internal/config/allowlist/{secret_path.go,default_secret_patterns.json,default_exclude_patterns.json} ported to
 * TypeScript with a small glob matcher; test files are NOT excluded here (the grid asks « test manquant ? », so the
 * reviewer must see them); files are packed into size-bounded lots by folder instead of OCR's LLM grouping.
 */
import type { FileChange } from "./shared.js";
import type { ReviewCoverage } from "./peerreviewtypes.js";

/** Credential paths: never read, never sent (upstream default_secret_patterns.json, plus .env* except templates). */
const SECRET = ["**/.ssh/**", "**/id_rsa", "**/id_dsa", "**/id_ecdsa", "**/id_ed25519", "**/.netrc", "**/_netrc", "**/.npmrc", "**/.pypirc", "**/.dockercfg", "**/*.pem", "**/*.key", "**/.git-credentials"];
/** Generated, locked or vendored files (subset of upstream default_exclude_patterns.json, tests removed). */
const GENERATED = [
  "**/node_modules/**", "**/bower_components/**", "**/.pnpm-store/**", "**/.pnp.cjs", "**/.pnp.loader.mjs",
  "**/package-lock.json", "**/pnpm-lock.yaml", "**/npm-shrinkwrap.json", "**/yarn.lock", "**/poetry.lock", "**/cargo.lock", "**/composer.lock", "**/gemfile.lock", "**/uv.lock",
  "**/*.min.{js,css}", "**/*.map", "**/dist/**", "**/.next/**", "**/.nuxt/**", "**/.svelte-kit/**", "**/.astro/**", "**/.turbo/**", "**/.angular/**", "**/.parcel-cache/**",
  "**/vendor/**", "**/.bundle/**", "**/target/**", "**/.gradle/**", "**/__pycache__/**", "**/.venv/**", "**/venv/**", "**/site-packages/**", "**/*.egg-info/**",
  "**/*.generated.*", "**/*.gen.go", "**/*.pb.go", "**/__snapshots__/**", "**/*.snap", "**/coverage/lcov-report/**", "**/.terraform.lock.hcl",
];

/** `**` any folders (or none), `*` any characters but `/`, `{a,b}` alternatives — the doublestar subset the patterns use. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (glob.startsWith("**/", i)) { re += "(?:.*/)?"; i += 2; }
    else if (glob.startsWith("/**", i) && i + 3 === glob.length) { re += "(?:/.*)?"; i += 2; }
    else if (ch === "*") re += "[^/]*";
    else if (ch === "{") { const end = glob.indexOf("}", i); re += "(?:" + glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|") + ")"; i = end; }
    else re += ch.replace(/[.+?^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
const SECRET_RE = SECRET.map(globToRegExp);
const GENERATED_RE = GENERATED.map(globToRegExp);

export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (![".env.example", ".env.sample", ".env.template"].includes(base) && (base === ".env" || base.startsWith(".env."))) return true;
  return SECRET_RE.some((r) => r.test(lower));
}
export const isGeneratedPath = (path: string) => GENERATED_RE.some((r) => r.test(path.toLowerCase()));

/** Why a listed file is not sent to the reviewer, before anything is read (null: it is reviewed). */
export function whyExcluded(f: FileChange, pathOk: (p: string) => boolean): ReviewCoverage["reason"] | null {
  if (!pathOk(f.path)) return "unavailable";
  if (f.binary) return "binary";
  if (isSecretPath(f.path)) return "secret";
  if (isGeneratedPath(f.path)) return "generated";
  return null;
}

/** One file's diff as sent to the reviewer. */
export interface BatchFile { path: string; diff: string; truncated: boolean }

/** Per-file and per-lot sizes (characters). Lots replace the old « 12 files, 24 000 characters, then stop ». */
export const FILE_CHARS = 20_000;
export const BATCH_CHARS = 24_000;
export const MAX_BATCHES = 6;

/**
 * Packs files into lots: files of the same folder stay together (cross-file mistakes are found inside a lot), a lot is
 * closed when the next file would pass BATCH_CHARS. Files that do not fit in MAX_BATCHES lots are returned in `over`.
 */
export function packBatches(files: BatchFile[], maxBatches = MAX_BATCHES, batchChars = BATCH_CHARS): { batches: BatchFile[][]; over: BatchFile[] } {
  const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const sorted = [...files].sort((a, b) => dir(a.path).localeCompare(dir(b.path)) || a.path.localeCompare(b.path));
  const batches: BatchFile[][] = [];
  const over: BatchFile[] = [];
  let current: BatchFile[] = [], size = 0;
  for (const f of sorted) {
    if (current.length && size + f.diff.length > batchChars) { batches.push(current); current = []; size = 0; }
    if (batches.length >= maxBatches) { over.push(f); continue; }
    current.push(f);
    size += f.diff.length;
  }
  if (current.length) { if (batches.length < maxBatches) batches.push(current); else over.push(...current); }
  return { batches, over };
}
