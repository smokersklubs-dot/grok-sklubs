/**
 * L49 — known third-party tool servers added as LOCAL tool servers (localtools.ts) on a bot's computer: their input
 * tools are committing, their telemetry is off, their version is pinned. From the audits of ChromeDevTools/
 * chrome-devtools-mcp (Apache-2.0, docs/audits/AUDIT-CHROME-DEVTOOLS-MCP.md) and GoogleChrome/modern-web-guidance-src
 * (Apache-2.0 code, docs/audits/AUDIT-MODERN-WEB-GUIDANCE-SRC.md); only their documented flags and variables are used:
 *
 *  - chrome-devtools-mcp: `--no-usage-statistics` (usage statistics off; the audit also names the
 *    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS variable) and `--no-performance-crux` (no field-data lookups sent to Google),
 *    both added when missing. Its input tools — click, fill, fill_form, drag, hover, press_key, type_text, upload_file,
 *    handle_dialog, navigate_page, new_page, close_page, select_page, evaluate_script, emulate, resize_page — are treated
 *    as committing: never "read-only", always marked "may change things for good", so each call asks on a single-use
 *    card. A click there is NOT read in the page like element_click is (bind.ts): the card is the only check, so it can
 *    never be lifted by "Always".
 *  - modern-web-guidance: telemetry to Google is ON by default, off with DISABLE_TELEMETRY=1: the command is run through
 *    `env DISABLE_TELEMETRY=1 …` (a local server gets no environment variable otherwise, localtools.ts).
 *  - both: the package must name an exact version (`chrome-devtools-mcp@1.13.0`); `@latest` or no version is refused
 *    with the reason (each start would download whatever is newest, telemetry included).
 */
export interface ThirdParty { id: string; pkg: string; flags: string[]; env: Record<string, string>; committing: RegExp }

export const THIRD_PARTY: ThirdParty[] = [
  { id: "chrome-devtools-mcp", pkg: "chrome-devtools-mcp", flags: ["--no-usage-statistics", "--no-performance-crux"], env: {},
    committing: /^(?:click|fill|fill_form|drag|hover|press_key|type_text|upload_file|handle_dialog|navigate_page|navigate_page_history|new_page|close_page|select_page|evaluate_script|emulate\w*|resize_page)$/ },
  { id: "modern-web-guidance", pkg: "modern-web-guidance", flags: [], env: { DISABLE_TELEMETRY: "1" }, committing: /^$/ },
];

const pkgOf = (arg: string) => arg.replace(/^@?[^@]+/, (m) => m).split("@").filter(Boolean);
/** The package argument of a known third-party server in a command line, if any. */
export function thirdPartyOf(command: string, args: string[]): { tp: ThirdParty; arg: string } | null {
  for (const a of [command, ...args]) {
    const base = a.startsWith("@") ? `@${a.slice(1).split("@")[0]}` : a.split("@")[0];
    const tp = THIRD_PARTY.find((t) => base === t.pkg || base.endsWith(`/${t.pkg}`));
    if (tp) return { tp, arg: a };
  }
  return null;
}
export const hasExactVersion = (arg: string) => /@\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(arg) && !pkgOf(arg).includes("latest");

/**
 * The command line to save for a local tool server: unchanged for an unknown program; for a known third-party one, its
 * telemetry switched off. Throws (a sentence for the owner or the bot) when its version is not pinned.
 */
export function hardenCommand(command: string, args: string[]): { command: string; args: string[] } {
  const hit = thirdPartyOf(command, args);
  if (!hit) return { command, args };
  if (!hasExactVersion(hit.arg)) throw new Error(`Give ${hit.tp.pkg} an exact version (for example ${hit.tp.pkg}@1.2.3), not "latest" or none: otherwise every start downloads whatever is newest.`);
  let out = [...args];
  for (const f of hit.tp.flags) if (!out.includes(f)) out.push(f);
  const env = Object.entries(hit.tp.env).map(([k, v]) => `${k}=${v}`);
  if (!env.length) return { command, args: out };
  if (command === "env") { out = out.filter((x) => !env.some((e) => x.startsWith(`${e.split("=")[0]}=`))); return { command, args: [...env, ...out] }; }
  return { command: "env", args: [...env, command, ...out] };
}

/** A tool of a known third-party server: committing input tools are never read-only and always "destructive" (single-use cards). */
export function classifyTool(command: string, args: string[], tool: { name: string; readOnly: boolean; destructive: boolean }): { readOnly: boolean; destructive: boolean } {
  const hit = thirdPartyOf(command, args);
  if (!hit || !hit.tp.committing.test(tool.name)) return { readOnly: tool.readOnly, destructive: tool.destructive };
  return { readOnly: false, destructive: true };
}
