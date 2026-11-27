import type { ChatMessage, ToolSpec } from "./types.js";
import { turnStartIndex } from "./cachelayout.js";

/**
 * Tool search (Hermes audit, gap 4). A bot has ~100 built-in tools plus every tool of the user's apps; sending every
 * full definition on every call costs tokens and makes the model choose worse. Instead the model always gets a compact
 * core set and `tool_search`, whose description lists every other tool by name and one line; a search loads the full
 * definitions of the tools it found for the rest of the turn.
 *
 * - Anthropic: every definition is still sent, the others with `defer_loading: true`, and tool_search's result is sent
 *   as `tool_reference` blocks, which the API expands into the full definitions ("Custom tool search implementation:
 *   return a standard tool_result with tool_reference blocks in the content array [...] Every tool referenced must have a
 *   corresponding tool definition in the top-level tools parameter, normally with defer_loading: true";
 *   platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool). The tool list never changes, so the prompt
 *   cache is kept ("Internally, the API excludes deferred tools from the system-prompt prefix").
 * - OpenAI-compatible providers have no documented equivalent: the core set plus the tools loaded in this turn are sent.
 * - Anything else (a provider that does not know this protocol, a subscription engine with its own tools) simply gets
 *   the full list, tool_search included: it still answers, there is just nothing to save.
 *
 * Approvals do not depend on what was sent: a call is judged and run by name exactly as before (agent/loop.ts).
 */
export const TOOL_SEARCH = "tool_search";
export const RUN_STEPS = "run_steps";
/** First line of tool_search's result: the names it loaded, comma-separated. */
export const LOADED_PREFIX = "Loaded tools:";
/** Below this many tools, everything is sent as before (the docs: "Standard tool calling [...] when you have fewer than 10 tools"). */
export const TOOL_SEARCH_MIN = 30;

/** What a bot uses on most turns, always sent in full ("Keep your 3–5 most frequently used tools non-deferred"). */
export const CORE_TOOLS = new Set([
  TOOL_SEARCH, RUN_STEPS, "web_fetch", "search_web", "shell_run", "file_save", "file_send", "file_change", "memory_save", "memory_search",
  "skill_read", "guide_read", "ask_user", "message_react", "progress_update", "bot_message", "routine_create", "task_add", "conversation_search",
  "connector_request", "stay_quiet", "browser_open", "screen_view", "screen_click", "screen_type", "screen_key", "screen_scroll", "artifact_create",
]);

const off = () => /^(0|off|false|no)$/i.test(process.env.TOOL_SEARCH ?? "");

/** Whether this tool list is worth splitting (it has tool_search and is long enough, and it is not switched off). */
export function toolSearchActive(tools: ToolSpec[]): boolean {
  return !off() && tools.length >= TOOL_SEARCH_MIN && tools.some((t) => t.name === TOOL_SEARCH);
}

export const isDeferred = (name: string) => !CORE_TOOLS.has(name);

/** One line about a tool: its description's first sentence, kept short. */
export function oneLine(t: ToolSpec): string {
  const first = t.description.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 90 ? `${first.slice(0, 89)}…` : first;
}

/** tool_search with the catalog of the tools not sent in full: deterministic, so the request stays byte-identical. */
export function withCatalog(spec: ToolSpec, tools: ToolSpec[]): ToolSpec {
  const rest = tools.filter((t) => isDeferred(t.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!rest.length) return spec;
  return { ...spec, description: `${spec.description}\nOther tools (call tool_search with their names or what you need to use one):\n${rest.map((t) => `- ${t.name}: ${oneLine(t)}`).join("\n")}` };
}

/** Names loaded by tool_search since the turn in progress started (read from the transcript itself: nothing to keep). */
export function loadedInTurn(messages: ChatMessage[]): Set<string> {
  const from = Math.max(0, turnStartIndex(messages));
  const searches = new Set<string>();
  const out = new Set<string>();
  for (const m of messages.slice(from)) for (const b of m.content) {
    if (b.type === "tool_use" && b.name === TOOL_SEARCH) searches.add(b.id);
    else if (b.type === "tool_result" && searches.has(b.toolUseId)) for (const n of namesIn(b.content)) out.add(n);
  }
  return out;
}

/** The names on a tool_search result's first line. */
export function namesIn(content: Array<{ type: string; text?: string }>): string[] {
  const first = content.find((c) => c.type === "text")?.text ?? "";
  const line = first.split("\n").find((l) => l.startsWith(LOADED_PREFIX));
  return line ? line.slice(LOADED_PREFIX.length).split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Client-side split (OpenAI-compatible): core tools, tool_search with its catalog, and whatever was loaded this turn. */
export function toolsForCall(tools: ToolSpec[], messages: ChatMessage[]): ToolSpec[] {
  if (!toolSearchActive(tools)) return tools;
  const loaded = loadedInTurn(messages);
  return tools.filter((t) => !isDeferred(t.name) || loaded.has(t.name)).map((t) => (t.name === TOOL_SEARCH ? withCatalog(t, tools) : t));
}

/** Words of a query, lower-cased, accents folded. */
const words = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * The search itself: when the query is only exact names, those; else exact names first, then tools whose name or description share words with the query, best match
 * first. At most `limit` (default 5, like the API's own search).
 */
export function searchTools(tools: ToolSpec[], query: string, limit = 5): ToolSpec[] {
  const q = query.trim();
  const exact = new Set(q.split(/[\s,]+/).filter(Boolean));
  // Only exact names asked for: exactly those.
  const named = tools.filter((t) => exact.has(t.name) && t.name !== TOOL_SEARCH);
  if (named.length && named.length === exact.size) return named.slice(0, 20);
  const qw = words(q);
  const scored = tools.filter((t) => t.name !== TOOL_SEARCH).map((t) => {
    if (exact.has(t.name)) return { t, s: 1000 };
    const nw = new Set(words(t.name.replace(/_/g, " ")));
    const dw = new Set(words(t.description));
    let s = 0;
    for (const w of qw) { if (nw.has(w)) s += 3; else if ([...nw].some((n) => n.startsWith(w) || w.startsWith(n))) s += 2; if (dw.has(w)) s += 1; }
    return { t, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, Math.max(1, Math.min(20, limit))).map((x) => x.t);
}
