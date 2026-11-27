/**
 * Which built-in tools a subscription engine gets for one turn (owner decision n° 8, 25/11/2026, backlog L64).
 *
 * When the bot's own browser is ready (its computer answers on the browser's debugging port), Claude Code loses its
 * WebFetch tool: a link is then opened in the real browser on the bot's screen (browser_open, then page_read), so the
 * owner watches it live and the site's checks (allowed sites, logins, approvals) apply. When the browser is NOT ready
 * (computer still starting, browser crashed, a test's fake computer), WebFetch stays: the bot is never left without a way
 * to read a page.
 *
 * Claude Code: `--tools <tools...>` "Built-in tools to make available: "" for none, "default" for the default set, or tool
 * names (e.g. "Bash,Edit,Read")" (`claude --help`, Claude Code 2.1.332). Leaving WebFetch out of that list removes it;
 * `--disallowedTools` ("Comma or space-separated list of tool names to deny", same help) would also work, but a single
 * list is clearer. WebSearch stays (a search is not a page; the owner's decision names WebFetch only).
 *
 * Codex: nothing to remove. Its only built-in web tool is `web_search` (a search, documented in the Codex configuration
 * reference as `web_search = "live" | "cached" | "disabled"`); Codex has no page-reading tool of its own — it reads a page
 * through its shell, which the engine prompt already steers towards browser_open.
 */

/** Claude Code's built-in tools for a bot's turn, in the order the CLI is given them. */
export const CLAUDE_BUILTIN_TOOLS = ["Bash", "Read", "Write", "Edit", "WebFetch", "WebSearch", "Task", "NotebookEdit"] as const;

/** The value of Claude Code's `--tools` for this turn: WebFetch is left out once the browser is ready. */
export function claudeToolList(browserReady: boolean): string {
  return CLAUDE_BUILTIN_TOOLS.filter((t) => !(browserReady && t === "WebFetch")).join(",");
}

/**
 * Whether the bot's browser is ready for this turn: Sklubot's browser tools exist on this server AND the browser answers
 * right now. A host that cannot tell (no `browserAnswers`, an error) counts as not ready, so WebFetch is kept.
 */
export async function browserReadyFor(available: boolean, answers: (() => Promise<boolean>) | undefined): Promise<boolean> {
  if (!available || !answers) return false;
  try { return (await answers()) === true; } catch { return false; }
}

/** The line added to the engine's standing instructions when WebFetch was removed for the turn. */
export const NO_WEBFETCH_NOTE =
  "\n\n- Your WebFetch tool is off while your own browser is ready: open every link and every page with browser_open (the user watches it live on your screen), then read it with page_read. Never fetch a page with curl or wget to get around this; WebSearch is still fine for finding pages.";
