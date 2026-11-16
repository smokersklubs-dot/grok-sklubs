import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { computerKind, workspaceOf } from "./computer.js";
import { containerName, diskScript, docker, onComputerWoken, powerOf } from "./linux.js";
import type { Card, FileChange } from "./shared.js";
import { bots, rows, type BotRecord } from "./store.js";

/**
 * "Fichiers modifiés": what a turn changed in the bot's home folder (/root on its Linux computer), with a way back.
 *
 * At the start and the end of every turn (ours and the subscription tools'), the home folder is snapshotted into a
 * private git store of its own, /root/.sklubot/snap.git, with its own index file: it never touches any repository the
 * user or the bot has (the snapshot reads the files as plain files; nested .git folders are left out). The same idea as
 * deepseek-harness packages/deliverables/workspace-changes/src/git.ts (a private index and object store for snapshots;
 * MIT, Copyright (c) 2026 DeepSeek), written here as one sh script run inside the computer.
 *
 * Left out: the browser profile, caches, the sign-ins and settings of the subscription tools (.claude, .codex), keys
 * (.ssh, .gnupg), node_modules and other dependency folders, nested .git folders, the shared team folder (/root/team,
 * other bots' work) and any file of 5 MB or more. A home with too many files or too much data is skipped (a log line,
 * never an error); the store is wiped when it grows past its cap; only the last 20 turns are kept (40 snapshots).
 *
 * Fast and harmless: each snapshot is time-limited and its failure is only logged; nothing is taken while the computer
 * is asleep (the start of a turn then uses the last snapshot this server took, unless the computer woke since).
 * Undo restores the listed paths to the turn's start, deleting what the turn created — only paths inside /root (links
 * resolved, the team folder excluded), never through a link, and by default only files nobody changed since.
 */

const FILE_KB = 5 * 1024;
const KEEP_TURNS = 20;
const STORE_KB = 1024 * 1024;
const SNAP_TIMEOUT_S = 20;
const MAX_LISTED = 60;
export const DIFF_MAX_BYTES = 64 * 1024;

export const SNAP_SCRIPT = `set -u
R="\${SNAP_ROOT:-/root}"
G="$R/.sklubot/snap.git"
export GIT_DIR="$G" GIT_WORK_TREE="$R" GIT_INDEX_FILE="$G/sk-index" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_LITERAL_PATHSPECS=1 LC_ALL=C \\
  GIT_AUTHOR_NAME=sklubot GIT_AUTHOR_EMAIL=sklubot@localhost GIT_COMMITTER_NAME=sklubot GIT_COMMITTER_EMAIL=sklubot@localhost
command -v git >/dev/null 2>&1 || { echo "NOGIT"; exit 0; }
cd "$R" || exit 1
RR=$(realpath -e -- "$R")
mode="$1"; shift
inside() { case "$1/" in "$RR/team/"*|"$RR/.sklubot/"*) return 1;; "$RR/"*) return 0;; *) return 1;; esac; }
if [ "$mode" = take ]; then
  ID="$1"; BASE="$2"; MAXF="$3"; MAXKB="$4"; FILEKB="$5"; KEEP="$6"; STOREKB="$7"
  if [ ! -d "$G" ]; then mkdir -p "$R/.sklubot" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git init -q --bare "$G" >/dev/null 2>&1 || { echo "FAIL init"; exit 0; }; fi
  L="$G/sk-list.$$"
  trap 'rm -f "$L" "$L.s" "$L.o"' EXIT
  NAMES='( -name node_modules -o -name .git -o -name __pycache__ -o -name .venv -o -name .tox -o -name .mypy_cache -o -name .pytest_cache )'
  { find "$R" -xdev \\( -path "$R/.sklubot" -o -path "$R/files" -o -path "$R/team" -o -path "$R/.cache" -o -path "$R/.config/sklubot-browser" \\
      -o -path "$R/.config/chromium" -o -path "$R/.config/google-chrome" -o -path "$R/.mozilla" -o -path "$R/.claude" -o -path "$R/.claude.json" \\
      -o -path "$R/.codex" -o -path "$R/.agent-reach" -o -path "$R/.ssh" -o -path "$R/.gnupg" -o -path "$R/.pki" -o -path "$R/.local/share/Trash" \\
      -o -path "$R/.local/share/keyrings" -o -path "$R/.npm" -o -path "$R/.nvm" -o -path "$R/.rustup" -o -path "$R/.cargo" -o -path "$R/.vnc" \\
      -o -path "$R/.dbus" -o -path "$R/.Xauthority" -o -path "$R/.bash_history" -o -path "$R/.python_history" -o -path "$R/.lesshst" \\
      -o -path "$R/.viminfo" -o -path "$R/.wget-hsts" -o -path "$R/AGENTS.md" -o $NAMES \\) -prune -o \\( -type f -o -type l \\) -size -"$FILEKB"k -printf '%P\\0'
    [ -d "$R/files" ] && find "$R/files" -xdev $NAMES -prune -o \\( -type f -o -type l \\) -size -"$FILEKB"k -printf 'files/%P\\0'
  } > "$L" 2>/dev/null
  n=$(tr -cd '\\0' < "$L" | wc -c)
  [ "$n" -gt "$MAXF" ] && { echo "SKIP too-many $n"; exit 0; }
  tot=$(xargs -0 -r stat -c %s -- < "$L" 2>/dev/null | awk '{s+=$1} END {printf "%d", s/1024}')
  [ "\${tot:-0}" -gt "$MAXKB" ] && { echo "SKIP too-big $tot"; exit 0; }
  git ls-files -z > "$L.o" 2>/dev/null || : > "$L.o"
  sort -z "$L" > "$L.s"; sort -z -o "$L.o" "$L.o"
  comm -z -23 "$L.o" "$L.s" | git update-index -z --force-remove --stdin 2>/dev/null
  git update-index --add --remove -z --stdin < "$L" 2>/dev/null || { rm -f "$GIT_INDEX_FILE"; git update-index --add --remove -z --stdin < "$L" 2>/dev/null; } || { echo "FAIL index"; exit 0; }
  T=$(git write-tree) || { echo "FAIL tree"; exit 0; }
  C=$(git commit-tree "$T" -m "$ID" </dev/null) || { echo "FAIL commit"; exit 0; }
  git update-ref "refs/sk/$ID" "$C"
  echo "SNAP $ID $n"
  D="$G/sk-diff.$$"
  trap 'rm -f "$L" "$L.s" "$L.o" "$D"' EXIT
  : > "$D"
  if [ -n "$BASE" ] && BT=$(git rev-parse -q --verify "refs/sk/$BASE^{tree}" 2>/dev/null); then
    if [ "$BT" = "$T" ]; then echo "SAME"; else
      echo "SIZES"
      git diff-tree -r -z --no-renames --raw "$BT" "$T" | tr '\\0' '\\n' | awk '/^:/ {print $3; print $4}' | grep -v '^0*$' | sort -u | git cat-file --batch-check='%(objectname) %(objectsize)'
      git diff-tree -r -z --no-renames --raw --numstat "$BT" "$T" > "$D"
    fi
  fi
  git for-each-ref --sort=-committerdate --format='%(refname)' refs/sk/ | tail -n +"$((KEEP + 1))" | while read -r ref; do git update-ref -d "$ref"; done
  git -c gc.auto=1000 -c gc.pruneExpire=now gc --auto --quiet >/dev/null 2>&1
  sz=$(du -sk "$G" | cut -f1)
  if [ "$sz" -gt "$STOREKB" ]; then rm -rf "$G"; echo "RESET $sz"; exit 0; fi
  if [ -s "$D" ]; then echo "DIFF"; cat "$D"; fi
  exit 0
fi
if [ "$mode" = diff ]; then
  git diff --no-color --no-ext-diff --no-renames "refs/sk/$1" "refs/sk/$2" -- "$3" 2>/dev/null | head -c "$4"
  exit 0
fi
if [ "$mode" = restore ]; then
  BASE="$1"; END="$2"; FORCE="$3"; shift 3
  git rev-parse -q --verify "refs/sk/$BASE^{tree}" >/dev/null 2>&1 || { echo "MISSING"; exit 0; }
  entry() { git ls-tree -z "refs/sk/$1" -- "$2" 2>/dev/null | tr '\\0' '\\n' | head -n 1; }
  for rel in "$@"; do
    case "/$rel/" in *"/../"*|*"/./"*|"//"*) echo "SKIP $rel"; continue;; esac
    p="$R/$rel"; parent=$(dirname -- "$p"); name=$(basename -- "$p")
    # The nearest folder that exists must really be inside the home (links resolved): nothing is ever written elsewhere.
    a="$parent"; while [ ! -e "$a" ] && [ "$a" != / ]; do a=$(dirname -- "$a"); done
    ra=$(realpath -e -- "$a" 2>/dev/null) || { echo "SKIP $rel"; continue; }
    [ "$ra" = "$RR" ] || inside "$ra" || { echo "SKIP $rel"; continue; }
    ent=$(entry "$BASE" "$rel")
    if [ "$FORCE" != 1 ]; then
      endent=$(entry "$END" "$rel")
      if [ -L "$p" ]; then cur=$(printf '%s' "$(readlink -- "$p")" | git hash-object --stdin); elif [ -f "$p" ]; then cur=$(git hash-object -- "$p"); elif [ -e "$p" ]; then cur=other; else cur=none; fi
      if [ -n "$endent" ]; then want=$(printf '%s' "$endent" | cut -f1 | cut -d' ' -f3); else want=none; fi
      [ "$cur" = "$want" ] || { echo "CHANGED $rel"; continue; }
    fi
    if [ -z "$ent" ]; then
      if [ -L "$p" ] || [ -f "$p" ]; then
        rp=$(realpath -e -- "$parent" 2>/dev/null) || { echo "GONE $rel"; continue; }
        [ "$rp" = "$RR" ] || inside "$rp" || { echo "SKIP $rel"; continue; }
        if rm -f -- "$rp/$name"; then echo "DEL $rel"; else echo "FAIL $rel"; fi
      else echo "GONE $rel"; fi
      continue
    fi
    meta=$(printf '%s' "$ent" | cut -f1); mode=$(echo "$meta" | cut -d' ' -f1); type=$(echo "$meta" | cut -d' ' -f2); oid=$(echo "$meta" | cut -d' ' -f3)
    [ "$type" = blob ] || { echo "SKIP $rel"; continue; }
    mkdir -p -- "$parent" 2>/dev/null
    rp=$(realpath -e -- "$parent" 2>/dev/null) || { echo "FAIL $rel"; continue; }
    [ "$rp" = "$RR" ] || inside "$rp" || { echo "SKIP $rel"; continue; }
    dst="$rp/$name"
    if [ -d "$dst" ] && [ ! -L "$dst" ]; then echo "SKIP $rel"; continue; fi
    tmp="$rp/.sk-restore.$$"
    rm -f -- "$tmp"
    if [ "$mode" = 120000 ]; then ok=0; ln -s -- "$(git cat-file blob "$oid")" "$tmp" && ok=1
    else ok=0; git cat-file blob "$oid" > "$tmp" && { [ "$mode" = 100755 ] && chmod 755 "$tmp" || chmod 644 "$tmp"; } && ok=1; fi
    if [ "$ok" = 1 ] && mv -f -T -- "$tmp" "$dst"; then echo "OK $rel"; else rm -f -- "$tmp"; echo "FAIL $rel"; fi
  done
  exit 0
fi
echo "UNKNOWN"
`;

/** How the script reaches a bot's disk (replaceable in tests): in its running computer, or (diff, undo) a throwaway one. */
export const snapRunner = {
  /** Tests only: snapshots on without a Linux computer (the runner below is replaced too). */
  forceEnabled: false,
  running: async (botId: string) => (await powerOf(botId)) === "running",
  exec: (botId: string, args: string[], timeoutS: number) =>
    docker(["exec", "-w", "/root", containerName(botId), "timeout", "-k", "3", String(timeoutS), "sh", "-c", SNAP_SCRIPT, "sh", ...args], { timeoutMs: (timeoutS + 8) * 1000, maxBytes: 4_000_000 })
      .then((r) => ({ code: r.code, stdout: r.stdout, stderr: r.stderr })),
  /** Diff and undo also work while the computer is asleep (diskScript: its home volume in a throwaway container). */
  any: (botId: string, args: string[], timeoutS: number) =>
    diskScript(botId, workspaceOf(botId), SNAP_SCRIPT, args, timeoutS * 1000).then((r) => (r ? { code: r.code, stdout: r.stdout, stderr: r.stderr } : null)),
};

/** The last snapshot this server took at the end of a turn, per bot (forgotten when the computer wakes up). */
const lastEnd = new Map<string, string>();
onComputerWoken((botId) => { lastEnd.delete(botId); });
/** The end snapshot of the bot's previous turn, still running: the next turn waits for it (bounded). */
const pending = new Map<string, Promise<void>>();

const enabled = (bot: BotRecord) => config.fileSnapshots && (computerKind() === "linux" || snapRunner.forceEnabled) && bot.kind === "agent";
const newSnapId = () => `t${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;

interface Taken { id: string; changes: FileChange[] | null; skipped?: string }

/** Reads the script's output after "take": the snapshot, then the sizes of the changed blobs and the raw + numstat diff. */
export function parseTake(out: Buffer): Taken | null {
  const text = out.toString("utf8");
  const at = text.indexOf("\nDIFF\n");
  const head = at >= 0 ? text.slice(0, at) : text;
  const lines = head.split("\n");
  const snap = lines.map((l) => /^SNAP (\S+)/.exec(l)).find(Boolean);
  const skip = lines.find((l) => /^(SKIP|FAIL|RESET|NOGIT)\b/.test(l));
  if (!snap) return skip ? { id: "", changes: null, skipped: skip } : null;
  if (lines.some((l) => l.startsWith("RESET"))) return { id: "", changes: null, skipped: lines.find((l) => l.startsWith("RESET")) };
  const sizes = new Map<string, number>();
  for (const l of lines) { const m = /^([0-9a-f]{40,64}) (\d+)$/.exec(l); if (m) sizes.set(m[1], Number(m[2])); }
  if (at < 0) return { id: snap[1], changes: [] };
  const tokens = text.slice(at + 6).split("\0");
  const byPath = new Map<string, FileChange>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith(":")) {
      const [, , oldOid, newOid, status] = t.slice(1).split(" ");
      const path = tokens[++i];
      if (!path) continue;
      const change = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
      byPath.set(path, { path, change, added: null, removed: null, binary: false, oldSize: /^0+$/.test(oldOid) ? null : sizes.get(oldOid) ?? null, newSize: /^0+$/.test(newOid) ? null : sizes.get(newOid) ?? null });
    } else {
      const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(t);
      const f = m ? byPath.get(m[3]) : undefined;
      if (!f || !m) continue;
      if (m[1] === "-") f.binary = true; else { f.added = Number(m[1]); f.removed = Number(m[2]); }
    }
  }
  return { id: snap[1], changes: [...byPath.values()] };
}

async function take(bot: BotRecord, base: string | null): Promise<Taken | null> {
  if (!(await snapRunner.running(bot.id))) return null;
  const id = newSnapId();
  const r = await snapRunner.exec(bot.id, ["take", id, base ?? "", String(config.snapshotMaxFiles), String(config.snapshotMaxMb * 1024), String(FILE_KB), String(KEEP_TURNS * 2), String(STORE_KB)], SNAP_TIMEOUT_S);
  const t = r.code === 0 ? parseTake(r.stdout) : null;
  if (!t) { console.error(`[snapshot ${bot.id}] skipped: ${r.code === null || r.code === 124 ? "took too long" : (r.stderr || r.stdout.toString("utf8")).trim().slice(0, 200)}`); return null; }
  if (t.skipped) { console.log(`[snapshot ${bot.id}] skipped: ${t.skipped}`); return null; }
  return t;
}

/**
 * The start of a turn: a fresh snapshot when the computer is on, else the last one this server took (when the computer
 * has not woken since). Returns the snapshot the turn's changes are measured against, or null. Never throws.
 */
export async function turnStarted(bot: BotRecord): Promise<string | null> {
  if (!enabled(bot)) return null;
  try {
    const before = pending.get(bot.id);
    if (before) await Promise.race([before, new Promise((r) => setTimeout(r, (SNAP_TIMEOUT_S + 10) * 1000))]);
    const t = await take(bot, null);
    return t?.id ?? lastEnd.get(bot.id) ?? null;
  } catch (err) { console.error(`[snapshot ${bot.id}]`, (err as Error)?.message ?? err); return null; }
}

/**
 * The end of a turn: a snapshot (only when the computer is on), compared with the start; when files changed, the
 * "Fichiers modifiés" card. Runs after the turn, in the background (the next turn of this bot waits for it).
 */
export function turnEnded(bot: BotRecord, base: string | null, thread: number) {
  if (!enabled(bot)) return;
  const job = (async () => {
    const t = await take(bot, base);
    if (!t) return;
    lastEnd.set(bot.id, t.id);
    if (!base || !t.changes?.length) return;
    const fresh = bots.byId(bot.id);
    if (!fresh) return;
    const sorted = [...t.changes].sort((a, b) => a.path.localeCompare(b.path));
    const card: Card = { type: "files", snapId: t.id, baseId: base, files: sorted.slice(0, MAX_LISTED), more: Math.max(0, sorted.length - MAX_LISTED), status: "available" };
    rows.append(fresh, { kind: "card", card }, thread);
  })().catch((err) => console.error(`[snapshot ${bot.id}]`, (err as Error)?.message ?? err)).finally(() => { if (pending.get(bot.id) === job) pending.delete(bot.id); });
  pending.set(bot.id, job);
}

/** For tests: wait for the bot's end-of-turn snapshot. */
export const settled = (botId: string) => pending.get(botId) ?? Promise.resolve();

/** Whether a path from a card may be shown or restored: relative to /root, no "..", no control characters. */
export const listedPathOk = (p: string) => typeof p === "string" && p.length > 0 && p.length <= 1000 && !p.startsWith("/") && !/[\0-\x1f]/.test(p) && !p.split("/").some((s) => s === ".." || s === "." || s === "");

/** The text diff of one listed file (at most DIFF_MAX_BYTES). Null when the snapshots are gone or the disk unreachable. */
export async function fileDiff(bot: BotRecord, card: Extract<Card, { type: "files" }>, path: string): Promise<{ diff: string; truncated: boolean } | null> {
  const r = await snapRunner.any(bot.id, ["diff", card.baseId, card.snapId, path, String(DIFF_MAX_BYTES + 1)], 30);
  if (!r || r.code !== 0) return null;
  const s = r.stdout.toString("utf8");
  return { diff: s.slice(0, DIFF_MAX_BYTES), truncated: r.stdout.length > DIFF_MAX_BYTES };
}

export interface UndoResult { restored: string[]; changedSince: string[]; failed: string[]; missing: boolean }

/** Puts the listed paths back as they were at the start of the turn (`force`: even those changed since the turn). */
export async function undoFiles(bot: BotRecord, card: Extract<Card, { type: "files" }>, paths: string[], force = false): Promise<UndoResult> {
  const r = await snapRunner.any(bot.id, ["restore", card.baseId, card.snapId, force ? "1" : "0", ...paths], 120);
  const out = r?.stdout.toString("utf8") ?? "";
  const lines = out.split("\n");
  const pick = (tag: string) => lines.filter((l) => l.startsWith(tag + " ")).map((l) => l.slice(tag.length + 1));
  return {
    restored: [...pick("OK"), ...pick("DEL"), ...pick("GONE")],
    changedSince: pick("CHANGED"),
    failed: [...pick("FAIL"), ...pick("SKIP"), ...(r ? [] : paths)],
    missing: lines.includes("MISSING"),
  };
}
