import { q } from "./db.js";
import { tr } from "./i18n.js";
import { liveDevice, relayRequest, whenOnline, type RelayResult } from "./relay.js";
import { audit, clip, now, rows } from "./store.js";
import type { ToolContext, ToolOutput } from "./agent/tools.js";
import { DESTRUCTIVE_COMMAND } from "./agent/irreversible.js";

/**
 * Safety rules for a bot on the user's own computer (Sklubot Relais), backlog L19 / L32 (audits nod §3, §5, §9;
 * agent-desktop "blocked combos"; Timon script preview — ideas only, our own code). Decided HERE first, before
 * anything is sent: the app on the computer may be outdated or tampered with. The relay then checks the same rules
 * again on the computer (companion/src/main/guard.js, docs/RELAIS-PROTOCOLE.md §14). Both lists must stay equal:
 * server/test/relay-guard.test.ts compares them.
 *
 *  - apps refused by default (terminals and script tools, system settings and tools, password managers and wallets,
 *    Sklubot itself); a terminal (and my_command) only when the owner allowed it for that computer, with a warning;
 *  - the owner's "keep out" list of apps and folders (Settings → Computers → Safety rules);
 *  - never typing into a focused password field (the Relais has no vault fill: vault_type is for the bot's own computer);
 *  - the window in front is re-read right before each click, drag, scroll, typing or key, and must still be the one
 *    the bot saw on its last screenshot;
 *  - dangerous shortcuts refused unless forced through a card the owner approved (and confirmed on the computer);
 *  - a script launched by my_command is shown on the card (first 40 lines + SHA-256), and the relay refuses to run it
 *    if it changed before the click.
 */

// ── The lists (same as companion/src/main/guard.js) ──────────────────────────
export const normApp = (s: unknown): string => {
  let v = String(s ?? "").trim().toLowerCase();
  v = v.replace(/\\/g, "/").split("/").pop() || "";
  v = v.replace(/\.(exe|app)$/, "");
  return v.replace(/[^\p{L}\p{N}]+/gu, "");
};

export type AppGroup = "terminal" | "scripts" | "settings" | "passwords" | "self";
export const DENIED_APPS: ReadonlyArray<{ group: AppGroup; names: string[]; ids: string[] }> = [
  {
    group: "terminal",
    names: ["Terminal", "iTerm2", "Warp", "Alacritty", "kitty", "WezTerm", "Hyper", "Tabby", "Ghostty", "Konsole", "GNOME Terminal", "GNOME Console", "Ptyxis", "xterm", "Terminator", "Tilix", "Guake", "Yakuake", "Xfce Terminal", "LXTerminal", "MATE Terminal", "QTerminal", "foot", "Command Prompt (cmd)", "PowerShell", "Windows Terminal", "Git Bash", "WSL"],
    ids: ["com.apple.Terminal", "iterm", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "wezterm-gui", "com.mitchellh.ghostty", "gnome-terminal-server", "org.gnome.Terminal", "kgx", "org.gnome.Console", "org.gnome.Ptyxis", "uxterm", "urxvt", "rxvt", "xfce4-terminal", "mate-terminal", "sakura", "terminology", "cmd", "powershell_ise", "pwsh", "WindowsTerminal", "wt", "conhost", "OpenConsole", "mintty", "bash", "zsh", "fish", "sh"],
  },
  {
    group: "scripts",
    names: ["Script Editor", "Automator", "Shortcuts", "Registry Editor", "Microsoft Management Console", "Windows Script Host"],
    ids: ["com.apple.ScriptEditor2", "com.apple.Automator", "com.apple.shortcuts", "regedit", "regedt32", "mmc", "gpedit", "wscript", "cscript", "mshta"],
  },
  {
    group: "settings",
    names: ["System Settings", "System Preferences", "Control Panel", "Windows Security", "Task Manager", "Activity Monitor", "Disk Utility", "GNOME Settings", "KDE System Settings", "Xfce Settings", "System Monitor", "GParted", "Disks", "System Configuration (msconfig)"],
    ids: ["com.apple.systempreferences", "SystemSettings", "control", "SecHealthUI", "taskmgr", "com.apple.ActivityMonitor", "com.apple.DiskUtility", "gnome-control-center", "org.gnome.Settings", "systemsettings", "xfce4-settings-manager", "gnome-system-monitor", "ksysguard", "plasma-systemmonitor", "gnome-disks", "msconfig", "diskmgmt", "compmgmt"],
  },
  {
    group: "passwords",
    names: ["1Password", "Bitwarden", "KeePass", "KeePassXC", "LastPass", "Dashlane", "Enpass", "NordPass", "Proton Pass", "Keeper", "RoboForm", "Passwords (macOS)", "Keychain Access", "Seahorse (Passwords and Keys)", "KWalletManager", "Ledger Live", "Exodus", "Electrum", "Trezor Suite", "Atomic Wallet"],
    ids: ["1password7", "com.1password.1password", "com.bitwarden.desktop", "keepassx", "org.keepassxc.KeePassXC", "com.apple.Passwords", "com.apple.keychainaccess", "org.gnome.seahorse.Application", "kwalletmanager5"],
  },
  { group: "self", names: ["Sklubot"], ids: ["Sklubot Relais", "fr.sklubot.desktop", "sklubot-desktop"] },
];

const DENIED_INDEX = new Map<string, AppGroup>();
const WORD_INDEX = new Map<string, AppGroup>();
const GENERIC_WORDS = new Set(["shortcuts", "passwords", "keeper", "exodus", "disks", "hyper", "tabby", "kitty"]);
for (const g of DENIED_APPS) for (const n of [...g.names, ...g.ids]) {
  for (const v of [normApp(n), normApp(n.replace(/\s*\(.*\)$/, ""))]) {
    DENIED_INDEX.set(v, g.group);
    if (g.names.includes(n) && v.length >= 5 && !GENERIC_WORDS.has(v)) WORD_INDEX.set(v, g.group);
  }
}

export interface Active { app?: string; bundle?: string; pid?: number | null; windowId?: string | null; title?: string; passwordField?: boolean | null; url?: string | null }
export interface OwnerGuard { keepApps: string[]; keepFolders: string[]; projectFolders: string[]; allowTerminal: boolean; commandTimeout: number }

export function deniedGroup(a: Active): AppGroup | null {
  for (const v of [a.app, a.bundle]) { const g = DENIED_INDEX.get(normApp(v)); if (v && g) return g; }
  if (/sklubot/i.test(String(a.title ?? ""))) return "self";
  return null;
}

export function deniedName(name: string): AppGroup | null {
  const g = deniedGroup({ app: name, title: name });
  if (g) return g;
  for (const w of String(name).split(/[\s—–\-:|·]+/).map(normApp).filter((x) => x.length >= 3)) { const hit = WORD_INDEX.get(w); if (hit) return hit; }
  return null;
}

const lowerPath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const baseOf = (p: string) => lowerPath(p).split("/").pop() || "";

export function keepOutHit(a: Active, g: Pick<OwnerGuard, "keepApps" | "keepFolders">): string | null {
  const app = normApp(a.app), bundle = normApp(a.bundle), title = String(a.title ?? "").toLowerCase();
  for (const e of g.keepApps) { const n = normApp(e); if (n && (n === app || n === bundle || (n.length >= 3 && normApp(title).includes(n)))) return e; }
  for (const e of g.keepFolders) { const full = lowerPath(e), base = baseOf(e); if ((full.length >= 3 && title.includes(full)) || (base.length >= 3 && title.includes(base))) return e; }
  return null;
}

/** A keep-out folder named in a path the bot gives (shared-folder name + path, a command, a working folder). */
export function keepOutInText(text: string, folders: string[]): string | null {
  const t = lowerPath(String(text));
  const segs = t.split(/[/\s"']+/);
  for (const e of folders) {
    const full = lowerPath(e), base = baseOf(e);
    if ((full.length >= 3 && t.includes(full)) || (base.length >= 3 && segs.includes(base))) return e;
  }
  return null;
}

export const LOGIN_TITLE = /(password|passwort|contraseña|mot de passe|passcode|\bpin\b|sign[ -]?in|log[ -]?in|connexion|se connecter|unlock|déverrouill|authenticat|authentif)/i;
export function passwordRisk(a: Active): "password_field" | "password_maybe" | null {
  if (a.passwordField === true) return "password_field";
  if (a.passwordField !== false && LOGIN_TITLE.test(String(a.title ?? ""))) return "password_maybe";
  return null;
}

export function sameWindow(a: Active, b: Active): boolean {
  if (normApp(a.app) !== normApp(b.app)) return false;
  if (a.pid && b.pid && a.pid !== b.pid) return false;
  if (a.windowId && b.windowId && String(a.windowId) !== String(b.windowId)) return false;
  return true;
}

// ── Shortcuts ────────────────────────────────────────────────────────────────
export type ShortcutWhy = "close" | "lock" | "system" | "launcher" | "switch" | "delete";
export const DANGEROUS_SHORTCUTS: ReadonlyArray<{ combo: string; why: ShortcutWhy; platforms?: string[]; ownApp?: boolean; apps?: string[] }> = [
  { combo: "alt+f4", why: "close", platforms: ["win32", "linux"], ownApp: true },
  { combo: "command+q", why: "close", platforms: ["darwin"], ownApp: true },
  { combo: "control+q", why: "close", platforms: ["linux"], ownApp: true },
  { combo: "control+alt+delete", why: "system" },
  { combo: "control+shift+escape", why: "system", platforms: ["win32"] },
  { combo: "control+alt+escape", why: "system", platforms: ["linux"] },
  { combo: "control+alt+backspace", why: "system", platforms: ["linux"] },
  ...Array.from({ length: 12 }, (_, i) => ({ combo: `control+alt+f${i + 1}`, why: "system" as const, platforms: ["linux"] })),
  { combo: "alt+command+escape", why: "system", platforms: ["darwin"] },
  { combo: "command+x", why: "system", platforms: ["win32"] },
  { combo: "command+i", why: "system", platforms: ["win32"] },
  { combo: "control+command+q", why: "lock", platforms: ["darwin"] },
  { combo: "shift+command+q", why: "lock", platforms: ["darwin"] },
  { combo: "alt+shift+command+q", why: "lock", platforms: ["darwin"] },
  { combo: "command+l", why: "lock", platforms: ["win32", "linux"] },
  { combo: "control+alt+l", why: "lock", platforms: ["linux"] },
  { combo: "command+r", why: "launcher", platforms: ["win32"] },
  { combo: "command+s", why: "launcher", platforms: ["win32"] },
  { combo: "command+q", why: "launcher", platforms: ["win32"] },
  { combo: "command+space", why: "launcher" },
  { combo: "alt+command+space", why: "launcher", platforms: ["darwin"] },
  { combo: "control+escape", why: "launcher", platforms: ["win32"] },
  { combo: "alt+f1", why: "launcher", platforms: ["linux"] },
  { combo: "alt+f2", why: "launcher", platforms: ["linux"] },
  { combo: "control+alt+t", why: "launcher", platforms: ["linux"] },
  { combo: "command+tab", why: "switch" },
  { combo: "alt+tab", why: "switch", platforms: ["win32", "linux"] },
  { combo: "control+alt+tab", why: "switch", platforms: ["win32"] },
  { combo: "command+d", why: "switch", platforms: ["win32", "linux"] },
  { combo: "shift+delete", why: "delete", platforms: ["win32", "linux"], apps: ["explorer", "nautilus", "org.gnome.Nautilus", "dolphin", "thunar", "nemo", "pcmanfm", "caja"] },
  { combo: "alt+command+backspace", why: "delete", platforms: ["darwin"], apps: ["Finder", "com.apple.finder"] },
  { combo: "shift+command+backspace", why: "delete", platforms: ["darwin"] },
  { combo: "alt+shift+command+backspace", why: "delete", platforms: ["darwin"] },
];

const MOD_ORDER = ["control", "alt", "shift", "command"];
const MOD_ALIASES: Record<string, string> = { ctrl: "control", control: "control", cmd: "command", command: "command", meta: "command", super: "command", win: "command", option: "alt", alt: "alt", shift: "shift" };
const KEY_ALIASES: Record<string, string> = { esc: "escape", return: "enter", del: "delete", pgup: "pageup", pgdn: "pagedown", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right" };

/** "Ctrl+Alt+Del" → { key: "delete", modifiers: ["control","alt"] } (the relay's own parsing, protocol.js parseKey). */
export function parseKeys(raw: string): { key: string; modifiers: string[] } {
  const parts = String(raw).trim().split("+").map((p) => p.trim()).filter(Boolean);
  const k = parts.pop() ?? "";
  const modifiers = [...new Set(parts.map((m) => MOD_ALIASES[m.toLowerCase()] ?? m.toLowerCase()))];
  const low = k.toLowerCase();
  return { key: [...k].length === 1 ? low : KEY_ALIASES[low] ?? low, modifiers };
}
export const comboOf = (key: string, modifiers: string[]) => [...MOD_ORDER.filter((m) => modifiers.includes(m)), key.toLowerCase()].join("+");

export function shortcutVerdict(k: { key: string; modifiers: string[] }, platform: string, active: Active | null, opened: Set<string> = new Set()): { combo: string; why: ShortcutWhy } | null {
  const combo = comboOf(k.key, k.modifiers);
  for (const s of DANGEROUS_SHORTCUTS) {
    if (s.combo !== combo) continue;
    if (s.platforms && !s.platforms.includes(platform)) continue;
    if (s.apps && !(active && s.apps.some((n) => normApp(n) === normApp(active.app) || normApp(n) === normApp(active.bundle)))) continue;
    if (s.ownApp && active && opened.has(normApp(active.app))) continue;
    return { combo, why: s.why };
  }
  return null;
}

// ── Scripts launched by a command (same as guard.js findScripts) ─────────────
const INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "python", "python2", "python3", "py", "node", "nodejs", "deno", "bun", "ruby", "perl", "php", "lua", "rscript", "osascript", "pwsh", "powershell", "tclsh", "source", ".", "cmd"]);
const WRAPPERS = new Set(["sudo", "env", "nohup", "time", "nice", "exec", "command", "builtin", "doas", "caffeinate", "start"]);
const SCRIPT_EXT = /\.(sh|bash|zsh|ksh|fish|command|py|pyw|rb|pl|js|mjs|cjs|ts|php|lua|r|ps1|psm1|bat|cmd|vbs|vbe|wsf|applescript|scpt|tcl)$/i;
const OPT_WITH_VALUE = new Set(["-W", "-X", "--require", "-r", "--import", "-I", "-ExecutionPolicy", "-executionpolicy"]);
type Word = { text: string; dynamic: boolean };

export function tokenize(line: string, platform: string): Word[][] {
  const win = platform === "win32";
  const segments: Word[][] = [[]];
  let cur = "", dyn = false, has = false, quote = "";
  const push = () => { if (has) segments[segments.length - 1].push({ text: cur, dynamic: dyn }); cur = ""; dyn = false; has = false; };
  const cut = () => { push(); if (segments[segments.length - 1].length) segments.push([]); };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) { quote = ""; continue; }
      if (quote === '"' && !win && c === "\\" && i + 1 < line.length) { cur += line[++i]; continue; }
      if (quote === '"' && (c === "$" || c === "`")) dyn = true;
      if (win && c === "%") dyn = true;
      cur += c; continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (!win && c === "\\" && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
    if (c === " " || c === "\t") { push(); continue; }
    if (c === ";" || c === "\n" || c === "|" || c === "&") { cut(); continue; }
    if (c === "$" || c === "`" || c === "*" || c === "?" || c === "[" || (win && c === "%")) dyn = true;
    cur += c; has = true;
  }
  push();
  return segments.filter((s) => s.length);
}

export interface FoundScripts { scripts: string[]; optional: string[]; problem?: { kind: "dynamic" | "too_many"; word: string } }
export function findScripts(command: string, platform: string, depth = 0): FoundScripts {
  const scripts: string[] = [];
  const optional: string[] = [];
  let problem: FoundScripts["problem"];
  const add = (w: Word) => { if (w.dynamic) { problem ??= { kind: "dynamic", word: w.text }; return; } if (!scripts.includes(w.text)) scripts.push(w.text); };
  const pathLike = (s: string) => /^(\.{1,2}[\\/]|~[\\/])/.test(s) || ((/[\\/]/.test(s) || /^[a-z]:/i.test(s)) && SCRIPT_EXT.test(s)) || SCRIPT_EXT.test(s);
  for (const seg of tokenize(String(command ?? ""), platform)) {
    let i = 0;
    for (let wrapped = false; i < seg.length; i++) {
      const t = seg[i].text, low = t.toLowerCase();
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(low)) { wrapped = WRAPPERS.has(low) || wrapped; continue; }
      if (wrapped && t.startsWith("-")) { if (["-u", "-g", "-n"].includes(t)) i++; continue; }
      break;
    }
    if (i >= seg.length) continue;
    const first = seg[i];
    const name = first.text.replace(/\\/g, "/").split("/").pop()!.toLowerCase().replace(/\.exe$/, "");
    if (INTERPRETERS.has(name)) {
      for (let j = i + 1; j < seg.length; j++) {
        const w = seg[j];
        const low = w.text.toLowerCase();
        if (["-c", "/c", "/k", "-e", "-command", "-encodedcommand"].includes(low)) {
          if (low === "-encodedcommand") { problem ??= { kind: "dynamic", word: w.text }; break; }
          const inner = seg.slice(j + 1).map((x) => x.text).join(" ");
          if (depth < 1 && inner) { const r = findScripts(inner, platform, depth + 1); r.scripts.forEach((s) => add({ text: s, dynamic: false })); optional.push(...r.optional); if (r.problem) problem ??= r.problem; }
          break;
        }
        if (low === "-file" || low === "-f") { if (seg[j + 1]) add(seg[j + 1]); break; }
        if ((name === "deno" || name === "bun") && (low === "run" || low.startsWith("-"))) continue;
        if (low === "-m") break;
        if (w.text.startsWith("-")) { if (OPT_WITH_VALUE.has(w.text)) j++; continue; }
        add(w);
        break;
      }
    } else if (pathLike(first.text) || (first.dynamic && /[\\/]/.test(first.text))) {
      add(first);
      if (!first.dynamic && !/[\\/]/.test(first.text) && !/^[a-z]:/i.test(first.text) && !optional.includes(first.text)) optional.push(first.text);
    }
  }
  if (scripts.length > 3) problem ??= { kind: "too_many", word: String(scripts.length) };
  const kept = scripts.slice(0, 3);
  return { scripts: kept, optional: optional.filter((o) => kept.includes(o)), ...(problem ? { problem } : {}) };
}

// ── Commands always asked, whatever the rules (same as guard.js commandFloor) ──
/** The relay's additions to irreversible.ts DESTRUCTIVE_COMMAND (deletions, git rewrites, SQL drops…), reused as is. */
const AT_CMD = String.raw`(^|[;&|(\x60]|\$\()\s*`;
export const FLOOR_EXTRA: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: "git", re: /\bgit\s+(branch\s+[^;&|]*-D\b|push\b[^;&|]*\s\+\S|checkout\s+--\s+\.|filter-branch\b)/i },
  { kind: "admin", re: new RegExp(AT_CMD + String.raw`(sudo|su|runas|doas|pkexec|gsudo)\b`, "i") },
  { kind: "install", re: /\b(apt(-get)?|dnf|yum|zypper|pacman|apk|brew|port|snap|flatpak|choco|winget|scoop)\s+(install|reinstall|remove|uninstall|upgrade|purge|-S\w*)\b/i },
  { kind: "install", re: /\b(npm|pnpm)\s+(i|install|add|uninstall|remove|rm)\b[^;&|]*\s(-g|--global)\b|\byarn\s+global\b|\bpip3?\s+install\b[^;&|]*\s(--user|--break-system-packages)\b|\b(gem|cargo)\s+install\b/i },
  { kind: "disk", re: new RegExp(AT_CMD + String.raw`(diskutil|diskpart|fdisk|sfdisk|gdisk|parted|mkswap|mount|umount|losetup|cryptsetup|bcdedit|format-volume|clear-disk|initialize-disk)\b`, "i") },
  { kind: "perms", re: new RegExp(AT_CMD + String.raw`(chmod|chown|chgrp|icacls|takeown)\b[^;&|]*\s(-\w*R\b|--recursive\b|/t\b)[^;&|]*\s["']?(/|~|\.\.|[a-z]:\\)`, "i") },
  { kind: "remote_script", re: /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;&]*\|\s*(sudo\s+)?((ba|z|da|k|fi)?sh|python3?|node|perl|ruby|iex|invoke-expression|powershell|pwsh)\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)\b|\biex\s*\(\s*(iwr|irm|invoke-webrequest|invoke-restmethod|\(new-object)/i },
  { kind: "network", re: /\bssh\b[^;&|]*\s-\w*R\b|\b(nc|ncat|netcat)\b[^;&|]*\s-\w*l|\bsocat\b[^;&|]*\b(tcp|udp)\d?-listen\b|(^|[;&|(\s])(ngrok|cloudflared|localtunnel|lt|bore|frpc|serveo)\b|\btailscale\s+(funnel|serve)\b/i },
  { kind: "startup", re: /(\.bashrc|\.bash_profile|\.bash_login|\.profile|\.zshrc|\.zprofile|\.zshenv|\.zlogin|config\.fish|powershell_profile\.ps1|\$profile\b|\.config\/autostart|launchagents|launchdaemons|\bcrontab\b|\/etc\/|\\startup\\|currentversion\\run)/i },
  { kind: "outside", re: /(^|[^\d&])>{1,2}\s*["']?(\/(?!dev\/null\b)|~|\.\.|[a-z]:\\|\$home\b|%userprofile%)/i },
  { kind: "outside", re: /\b(tee|cp|mv|touch|mkdir|ln|install|rsync|scp|xcopy|robocopy|copy|move|copy-item|move-item|set-content|out-file|new-item)\b[^;&|]*\s["']?(\/(?!dev\/null\b)|~|\.\.|[a-z]:\\|\$home\b|%userprofile%)/i },
];
export { DESTRUCTIVE_COMMAND };

const normFolder = (p: string) => lowerPath(String(p || ""));
export const inProjects = (cwd: string, projects: string[]) => { const c = normFolder(cwd); return projects.some((p) => { const n = normFolder(p); return !!n && (c === n || c.startsWith(n + "/")); }); };

export function commandFloor(command: string, cwd: string, projects: string[] = []): { kind: string } | null {
  const c = String(command ?? "");
  if (DESTRUCTIVE_COMMAND.some((re) => re.test(c))) return { kind: "delete" };
  for (const f of FLOOR_EXTRA) if (f.re.test(c)) return { kind: f.kind };
  if (cwd && projects.length && !inProjects(cwd, projects)) return { kind: "outside" };
  return null;
}

export function commandPrefix(command: string): string {
  const c = String(command ?? "").trim().replace(/\s+/g, " ");
  if (/[;&|`\n<>]|\$\(/.test(c)) return c.slice(0, 300);
  const words = c.split(" ");
  const out = [words[0]];
  const max = /^(npm|pnpm|yarn|bun|npx)$/i.test(words[0]) && /^(run|exec|x|dlx)$/i.test(words[1] || "") ? 3 : 2;
  for (let i = 1; i < words.length && out.length < max; i++) { if (!/^[A-Za-z0-9][\w.:@-]*$/.test(words[i])) break; out.push(words[i]); }
  return out.join(" ").slice(0, 120);
}

export const FLOOR_LABEL: Record<string, string> = {
  delete: "it deletes or overwrites data", git: "it rewrites git history", admin: "it asks for administrator rights", install: "it installs or removes software for the whole computer",
  disk: "it touches disks", perms: "it changes file permissions outside the project", remote_script: "it runs a script downloaded from the internet", network: "it opens your computer to the network",
  startup: "it touches the files that run when your computer or shell starts", outside: "it works outside your project folders",
};

// ── Vault fill on the user's computer (same as guard.js vaultVerdict) ────────
export const BROWSERS = ["Google Chrome", "Chrome", "Chromium", "Firefox", "Safari", "Microsoft Edge", "msedge", "Brave Browser", "brave", "Opera", "Vivaldi", "Arc", "com.google.Chrome", "com.apple.Safari", "org.mozilla.firefox", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser", "google-chrome", "chromium-browser", "firefox-esr"];
const BROWSER_SET = new Set(BROWSERS.map(normApp));
export const isBrowser = (a: Active) => BROWSER_SET.has(normApp(a.app)) || BROWSER_SET.has(normApp(a.bundle));
export function hostOf(s: unknown): string {
  const v = String(s ?? "").trim().toLowerCase();
  if (!v) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, ""); } catch { return ""; }
}
export const sameSite = (here: string, wanted: string) => !!here && !!wanted && (here === wanted || here.endsWith("." + wanted));
export type VaultField = "username" | "password" | "code";
export function vaultVerdict(a: Active, item: { site: string; field: VaultField }): string | null {
  if (deniedGroup(a)) return "blocked_app";
  if (isBrowser(a)) {
    const here = hostOf(a.url);
    if (!here) return "host_unknown";
    if (!sameSite(here, hostOf(item.site))) return "host_mismatch";
  } else if (!normApp(item.site) || (normApp(item.site) !== normApp(a.app) && normApp(item.site) !== normApp(a.bundle))) return "app_mismatch";
  if (item.field === "password" && a.passwordField !== true) return "not_password_field";
  if (item.field !== "password" && a.passwordField === true) return "password_field";
  return null;
}
/** Where a saved item would go: the page host in a browser, else the app (the card and its "Always" are per place). */
export const placeOf = (a: Active) => (isBrowser(a) ? hostOf(a.url) : clip(String(a.app ?? ""), 80));

// ── The owner's rules, per computer ──────────────────────────────────────────
q.run(`CREATE TABLE IF NOT EXISTS relay_guards (
  device_id TEXT PRIMARY KEY REFERENCES relay_devices(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  keep_apps TEXT NOT NULL DEFAULT '[]', keep_folders TEXT NOT NULL DEFAULT '[]', allow_terminal INTEGER NOT NULL DEFAULT 1,
  project_folders TEXT NOT NULL DEFAULT '[]', command_timeout INTEGER NOT NULL DEFAULT 120, updated_at INTEGER NOT NULL)`);
// A table made by a build of this change before the owner's decision (commands on by default, project folders).
for (const col of ["project_folders TEXT NOT NULL DEFAULT '[]'", "command_timeout INTEGER NOT NULL DEFAULT 120"]) { try { q.run(`ALTER TABLE relay_guards ADD COLUMN ${col}`); } catch { /* already there */ } }

export const GUARD_LIMIT = 50;
/** Default time a command may run (seconds), and the bounds of the owner's setting. */
export const TIMEOUT_DEFAULT = 120, TIMEOUT_MIN = 5, TIMEOUT_MAX = 3600;
const timeoutOf = (v: unknown, cur: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, v))) : cur);
const cleanList = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").map((x) => x.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200)).filter(Boolean))].slice(0, GUARD_LIMIT);
const parseList = (s: string) => { try { return cleanList(JSON.parse(s)); } catch { return []; } };

export const guards = {
  /** Commands are ON by default on the owner's own computer (owner decision); the owner can turn them off. */
  get(userId: string, deviceId: string): OwnerGuard & { updatedAt: number | null } {
    const r = q.get<{ keep_apps: string; keep_folders: string; project_folders: string; allow_terminal: number; command_timeout: number; updated_at: number }>("SELECT * FROM relay_guards WHERE device_id = ? AND user_id = ?", deviceId, userId);
    return r ? { keepApps: parseList(r.keep_apps), keepFolders: parseList(r.keep_folders), projectFolders: parseList(r.project_folders), allowTerminal: r.allow_terminal === 1, commandTimeout: timeoutOf(r.command_timeout, TIMEOUT_DEFAULT), updatedAt: r.updated_at }
      : { keepApps: [], keepFolders: [], projectFolders: [], allowTerminal: true, commandTimeout: TIMEOUT_DEFAULT, updatedAt: null };
  },
  set(userId: string, deviceId: string, patch: { keepApps?: unknown; keepFolders?: unknown; projectFolders?: unknown; allowTerminal?: unknown; commandTimeout?: unknown }): OwnerGuard & { updatedAt: number | null } {
    const cur = guards.get(userId, deviceId);
    const list = (v: unknown, c: string[]) => (v === undefined ? c : cleanList(v));
    const next = { keepApps: list(patch.keepApps, cur.keepApps), keepFolders: list(patch.keepFolders, cur.keepFolders), projectFolders: list(patch.projectFolders, cur.projectFolders), allowTerminal: patch.allowTerminal === undefined ? cur.allowTerminal : patch.allowTerminal === true, commandTimeout: timeoutOf(patch.commandTimeout, cur.commandTimeout) };
    q.run(`INSERT INTO relay_guards (device_id, user_id, keep_apps, keep_folders, project_folders, allow_terminal, command_timeout, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET keep_apps = excluded.keep_apps, keep_folders = excluded.keep_folders, project_folders = excluded.project_folders, allow_terminal = excluded.allow_terminal, command_timeout = excluded.command_timeout, updated_at = excluded.updated_at`,
      deviceId, userId, JSON.stringify(next.keepApps), JSON.stringify(next.keepFolders), JSON.stringify(next.projectFolders), next.allowTerminal ? 1 : 0, next.commandTimeout, now());
    return guards.get(userId, deviceId);
  },
};

/** Sends the owner's rules to the computer (guard.set, §14): they only add refusals there. Old relays ignore it. */
export function pushGuard(userId: string, deviceId: string): Promise<RelayResult> {
  const g = guards.get(userId, deviceId);
  return relayRequest(deviceId, SYSTEM_BOT, "guard.set", { keepApps: g.keepApps, keepFolders: g.keepFolders, projectFolders: g.projectFolders, terminal: g.allowTerminal }, { timeoutMs: 10_000 });
}
export const SYSTEM_BOT = { id: "sklubot", name: "Sklubot" };
whenOnline((userId, deviceId, capabilities) => { if (capabilities.includes("guard.set")) void pushGuard(userId, deviceId); });

// ── What the bot saw, what it opened, the scripts it showed ──────────────────
/** The window in front at the bot's last screenshot, per computer. */
const seen = new Map<string, Active & { sessionId: string }>();
/** Apps the bot opened itself in this control session (it may close those), per computer. */
const opened = new Map<string, { sessionId: string; apps: Set<string> }>();

const sessionOf = (userId: string, deviceId: string) => liveDevice(userId, deviceId)?.session?.sessionId ?? "";
export function noteOpened(userId: string, deviceId: string, app: string) {
  const s = sessionOf(userId, deviceId);
  const cur = opened.get(deviceId);
  if (!cur || cur.sessionId !== s) opened.set(deviceId, { sessionId: s, apps: new Set([normApp(app)]) });
  else cur.apps.add(normApp(app));
}
const openedApps = (userId: string, deviceId: string) => { const o = opened.get(deviceId); return o && o.sessionId === sessionOf(userId, deviceId) ? o.apps : new Set<string>(); };

/** Whether this relay knows the safety rules (protocol 1.3). */
export const guardCapable = (caps: string[]) => caps.includes("window.active");

/** Reads the window in front (window.active). */
type Request = (op: string, args: Record<string, unknown>) => Promise<RelayResult>;
async function readActive(c: ToolContext, deviceId: string, request?: Request): Promise<Active | null | RelayResult> {
  const r = request ? await request("window.active", {}) : await relayRequest(deviceId, { id: c.bot.id, name: c.bot.name }, "window.active", {}, { timeoutMs: 15_000, signal: c.signal });
  if (!r.ok) return r;
  const a = r.result.active as Active | null | undefined;
  if (!a || typeof a !== "object" || typeof a.app !== "string" || !a.app) return null;
  return { app: clip(a.app, 200), bundle: clip(String(a.bundle ?? ""), 200), pid: typeof a.pid === "number" ? a.pid : null, windowId: a.windowId ? clip(String(a.windowId), 64) : null, title: clip(String(a.title ?? ""), 300), passwordField: a.passwordField === true ? true : a.passwordField === false ? false : null, url: typeof a.url === "string" && a.url ? clip(a.url, 2048) : null };
}

/** The window in front at the bot's last screenshot on that computer (for the vault card). */
export const lastSeen = (userId: string, deviceId: string): Active | null => { const s = seen.get(deviceId); return s && s.sessionId === (liveDevice(userId, deviceId)?.session?.sessionId ?? "") ? s : null; };

/** After a screenshot: remember which window was in front (the baseline for the next click or key). */
export async function noteSeen(c: ToolContext, userId: string, deviceId: string): Promise<void> {
  const live = liveDevice(userId, deviceId);
  if (!live || live.kind === "phone" || !guardCapable(live.capabilities)) return;
  const a = await readActive(c, deviceId);
  if (a && !("ok" in a)) seen.set(deviceId, { ...a, sessionId: live.session?.sessionId ?? "" });
  else seen.delete(deviceId);
}

// ── Refusals ─────────────────────────────────────────────────────────────────
const GROUP_LABEL: Record<AppGroup, string> = { terminal: "a terminal", scripts: "a script tool", settings: "system settings or a system tool", passwords: "a password manager or wallet", self: "Sklubot itself" };
const WHY_LABEL: Record<ShortcutWhy, string> = { close: "it closes an app", lock: "it locks the session or logs out", system: "it opens a system screen or switches console", launcher: "it opens a launcher that can start any program", switch: "it switches app or desktop out of sight", delete: "it deletes for good" };

/** Refusals decided by the safety rules (here or on the computer, same codes): told to the bot, never retried. */
export const GUARD_REFUSALS: Record<string, { model: string; user?: string; summary: string }> = {
  blocked_app: { model: "That app or window is refused on the user's computer by Sklubot's safety rules (terminal windows and script tools, system settings and system tools, password managers and wallets, Sklubot itself). Nothing was done. For a terminal, use my_command instead (each command is shown to the user). Otherwise do not try another way to reach it: ask the user to do that part themselves.", user: "{bot} was stopped on {device}: {what} is off-limits.", summary: "app off-limits" },
  terminal_off: { model: "Commands are off on this computer (the owner turned them off in Sklubot: Settings → Computers → Safety rules). Nothing was done. Do not try another way: tell the user what you wanted to do; they can turn commands back on there if they wish.", user: "{bot} wanted to run a command on {device}: commands are off for this computer.", summary: "commands off" },
  host_mismatch: { model: "The saved login is for another site than the page in front: nothing was typed. Open the item's own site and click its field first; never enter it anywhere else.", user: "{bot} did not type a saved login on {device}: the page is not its site.", summary: "wrong site" },
  host_unknown: { model: "The address of the page in front could not be read on the user's computer (this browser does not tell it), so no saved login was typed. Ask the user to type it themselves.", summary: "address unknown" },
  app_mismatch: { model: "The app in front is not the one this saved item is for: nothing was typed.", summary: "wrong app" },
  not_password_field: { model: "The field with the focus is not a password field (or the computer cannot tell): no password was typed. Click the password field first, look again, then retry.", summary: "not a password field" },
  keep_out: { model: "The user keeps this app, window or folder out of reach on their computer (their keep-out list in Sklubot). Nothing was done. Do not try another way to reach it.", user: "{bot} was stopped on {device}: “{what}” is on your keep-out list.", summary: "kept out" },
  password_field: { model: "A password field has the keyboard focus on the user's computer: the relay never types there (there is no vault fill on the user's own computer). Ask the user to type it themselves. You may press tab or escape to leave the field.", user: "{bot} did not type on {device}: a password field had the focus.", summary: "password field" },
  password_maybe: { model: "This window looks like a sign-in screen and the computer cannot tell whether a password field has the focus, so nothing was typed. Ask the user to type it themselves.", summary: "sign-in window" },
  window_changed: { model: "Another window came to the front since your last screenshot: nothing was done. Look again with my_screen before acting.", summary: "window changed" },
  no_look: { model: "Take a screenshot with my_screen first: before each click or key, the window in front must still be the one you saw.", summary: "look first" },
  foreground_unknown: { model: "The computer cannot tell which window is in front (on Linux this needs an X11 session with xprop), so nothing was done. Tell the user.", summary: "window unknown" },
  relay_old: { model: "The Sklubot app on that computer is too old for the safety checks (relay protocol 1.3). Nothing was done. Ask the user to update the Sklubot app on that computer.", user: "{bot} needs a newer Sklubot app on {device} (safety checks).", summary: "app too old" },
  blocked_shortcut: { model: "{what} is a protected shortcut on the user's computer ({why}). It was not pressed. Only if the user asked for exactly this, call my_key again with force: true: they will be asked on a card, then on the computer.", summary: "protected shortcut" },
  script_changed: { model: "The script changed after the user saw it, or is not the one shown on the card: nothing was run. Call my_command again (without script_fingerprint) to show the new version.", user: "The script changed before it ran on {device}: nothing was run.", summary: "script changed" },
  script_unreadable: { model: "The command launches a script that cannot be shown to the user ({what}). Nothing was run. Use a plain path to a script inside the command's folder or the home folder, or ask the user to run it.", summary: "script not shown" },
};

export function guardRefusal(c: ToolContext, device: string, code: string, vars: { what?: string; why?: string } = {}): ToolOutput {
  const r = GUARD_REFUSALS[code] ?? GUARD_REFUSALS.blocked_app;
  const loc = c.user.locale;
  const v = { device, bot: c.bot.name, what: tr(loc, vars.what ?? ""), why: tr(loc, vars.why ?? "") };
  if (r.user) {
    const line = tr(loc, r.user, v);
    rows.append(c.bot, { kind: "event", event: "relay", text: line, tone: "warn" });
    audit(c.user.id, "computer", `${c.bot.name} : ${line}`, c.bot.id);
  }
  return { content: r.model.replace("{what}", vars.what ?? "").replace("{why}", vars.why ?? ""), isError: true, summary: tr(loc, r.summary) };
}

export type InputKind = "click" | "drag" | "scroll" | "type" | "key";
const NAV_KEYS = new Set(["tab", "escape", "up", "down", "left", "right", "home", "end", "pageup", "pagedown"]);

/**
 * Right before a click, drag, scroll, typing or key on a computer: the app must know the safety rules, the window in
 * front is read again and must be the one of the bot's last screenshot, not a refused app, not on the keep-out list,
 * not a password field (for typing), and a key must not be a dangerous shortcut (unless forced through the card).
 * Returns the `expect` to send with the action (the relay checks again), or the refusal.
 */
export async function inputGuard(c: ToolContext, t: { id: string; label: string; platform: string }, kind: InputKind, extra: { keys?: string; force?: boolean } = {}, request?: Request): Promise<{ expect: { app: string; pid?: number; windowId?: string }; forced?: boolean } | ToolOutput> {
  const live = liveDevice(c.user.id, t.id);
  if (!live) return guardRefusal(c, t.label, "foreground_unknown");
  if (!guardCapable(live.capabilities)) return guardRefusal(c, t.label, "relay_old");
  const a = await readActive(c, t.id, request);
  if (!a) return guardRefusal(c, t.label, "foreground_unknown");
  if ("ok" in a) return { content: `The computer did not answer (${a.ok ? "" : a.code}). Nothing was done.`, isError: true, summary: a.ok ? "" : a.code };
  const before = seen.get(t.id);
  if (!before || before.sessionId !== (liveDevice(c.user.id, t.id)?.session?.sessionId ?? "")) return guardRefusal(c, t.label, "no_look");
  if (!sameWindow(before, a)) return guardRefusal(c, t.label, "window_changed");
  const owner = guards.get(c.user.id, t.id);
  // A terminal window too: the bot runs commands with my_command (each one on a card), never keystrokes into one.
  const group = deniedGroup(a);
  if (group) return guardRefusal(c, t.label, "blocked_app", { what: GROUP_LABEL[group] });
  const keep = keepOutHit(a, owner);
  if (keep) return guardRefusal(c, t.label, "keep_out", { what: keep });
  let forced = false;
  if (kind === "type" || kind === "key") {
    const k = kind === "key" ? parseKeys(extra.keys ?? "") : null;
    const nav = !!k && NAV_KEYS.has(k.key) && k.modifiers.every((m) => m === "shift");
    const risk = nav ? null : passwordRisk(a);
    if (risk) return guardRefusal(c, t.label, risk);
    if (k) {
      const v = shortcutVerdict(k, t.platform, a, openedApps(c.user.id, t.id));
      if (v && !extra.force) return guardRefusal(c, t.label, "blocked_shortcut", { what: v.combo, why: WHY_LABEL[v.why] });
      forced = !!v;
    }
  }
  return { expect: { app: a.app!, ...(a.pid ? { pid: a.pid } : {}), ...(a.windowId ? { windowId: a.windowId } : {}) }, ...(forced ? { forced } : {}) };
}

/** my_open / my_window_focus: a refused app or a keep-out entry by name, before anything is sent. */
export function nameGuard(c: ToolContext, t: { id: string; label: string }, name: string): ToolOutput | null {
  const owner = guards.get(c.user.id, t.id);
  const group = deniedName(name);
  if (group) return guardRefusal(c, t.label, "blocked_app", { what: GROUP_LABEL[group] });
  const keep = keepOutHit({ app: name, title: name }, owner);
  return keep ? guardRefusal(c, t.label, "keep_out", { what: keep }) : null;
}

/** Whether a key press would be a protected shortcut on that computer (for the card of a forced my_key). */
export function protectedShortcut(keys: string, platform: string): { combo: string; why: string } | null {
  const v = shortcutVerdict(parseKeys(keys), platform, null);
  return v ? { combo: v.combo, why: WHY_LABEL[v.why] } : null;
}

// ── Scripts shown on the command card (L32) ──────────────────────────────────
export interface Peek { path: string; sha256: string; size: number; lines: string[]; more: number; binary: boolean; at: number; card: number }
/** What the computer showed of each script, by computer, folder, path and fingerprint (16 hex characters). */
const peeks = new Map<string, Peek>();
const PEEK_TTL_MS = 30 * 60_000;
const peekKey = (deviceId: string, cwd: string, path: string, fp: string) => `${deviceId}\n${cwd}\n${path}\n${fp}`;
export const fingerprint = (sha256: string) => sha256.slice(0, 16);

export function cachedPeek(deviceId: string, cwd: string, path: string, fp: string): Peek | null {
  const p = peeks.get(peekKey(deviceId, cwd, path, fp));
  if (!p || now() - p.at > PEEK_TTL_MS) return null;
  return p;
}

/** Reads a script on the computer (script.peek: never runs it), and keeps what it showed. */
export async function peekOnComputer(c: ToolContext, deviceId: string, cwd: string, path: string): Promise<Peek | RelayResult> {
  const r = await relayRequest(deviceId, { id: c.bot.id, name: c.bot.name }, "script.peek", { path, ...(cwd ? { cwd } : {}) }, { timeoutMs: 15_000, signal: c.signal });
  if (!r.ok) return r;
  const sha256 = String(r.result.sha256 ?? "");
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, code: "internal", message: "no fingerprint" };
  for (const [k, v] of peeks) if (now() - v.at > PEEK_TTL_MS) peeks.delete(k);
  const p: Peek = { path, sha256, size: Number(r.result.size) || 0, lines: (Array.isArray(r.result.lines) ? r.result.lines : []).slice(0, 40).map((l) => clip(String(l), 200)), more: Number(r.result.more) || 0, binary: r.result.binary === true, at: now(), card: 0 };
  peeks.set(peekKey(deviceId, cwd, path, fingerprint(sha256)), p);
  return p;
}

/** The card's text for a script: its path, fingerprint and first 40 lines. */
export function scriptCardText(p: Peek): string {
  const body = p.binary ? "(a program, not text: its content cannot be shown)" : `${p.lines.join("\n")}${p.more ? `\n… (+${p.more})` : ""}`;
  return `── ${p.path} · sha256 ${fingerprint(p.sha256)}…\n${body}`;
}
