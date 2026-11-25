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
 *  - L115: chrome-devtools-mcp 1.14.0 is also IN the computer image (docker/desktop/Dockerfile, pinned by its lockfile):
 *    the bare command `chrome-devtools-mcp` runs that copy, so it needs no version. When it is not told to join a running
 *    browser (--browserUrl/-u, --wsEndpoint/-w, --autoConnect) nor given a browser (--executablePath/-e, --channel), it
 *    gets the computer's own Chromium, headless: `--executablePath=/opt/sklubot/headless-chromium --headless` (its
 *    browser options, out/Default/gen/src/config/browser-options.js of 1.14.0), never a downloaded Chrome nor a second
 *    window on the bot's screen. Its 1.14 `set_logpoints` changes how a page's scripts run: committing too.
 */
export interface ThirdParty { id: string; pkg: string; flags: string[]; env: Record<string, string>; committing: RegExp; preinstalled?: boolean }

export const THIRD_PARTY: ThirdParty[] = [
  { id: "chrome-devtools-mcp", pkg: "chrome-devtools-mcp", flags: ["--no-usage-statistics", "--no-performance-crux"], env: {}, preinstalled: true,
    committing: /^(?:click|fill|fill_form|drag|hover|press_key|type_text|upload_file|handle_dialog|navigate_page|navigate_page_history|new_page|close_page|select_page|evaluate_script|emulate\w*|resize_page|set_logpoints)$/ },
  { id: "modern-web-guidance", pkg: "modern-web-guidance", flags: [], env: { DISABLE_TELEMETRY: "1" }, committing: /^$/ },
];

/** The computer's Chromium for tools that start their own browser (docker/desktop/headless-chromium). */
export const IMAGE_CHROMIUM = "/opt/sklubot/headless-chromium";
const BROWSER_GIVEN = /^(?:--(?:browserUrl|browser-url|wsEndpoint|ws-endpoint|autoConnect|auto-connect|executablePath|executable-path|channel)\b|-[uwe]$|-[uwe]=)/;
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
  const image = !!hit.tp.preinstalled && hit.arg === command && command === hit.tp.pkg; // L115: the image's own pinned copy
  if (!image && !hasExactVersion(hit.arg)) throw new Error(`Give ${hit.tp.pkg} an exact version (for example ${hit.tp.pkg}@1.2.3), not "latest" or none: otherwise every start downloads whatever is newest.`);
  let out = [...args];
  for (const f of hit.tp.flags) if (!out.includes(f)) out.push(f);
  if (hit.tp.id === "chrome-devtools-mcp" && !out.some((x) => BROWSER_GIVEN.test(x))) out.push(`--executablePath=${IMAGE_CHROMIUM}`, ...(out.some((x) => /^--(no-)?headless\b/.test(x)) ? [] : ["--headless"]));
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
