import type { BuiltinTool } from "./agent/tools.js";

/** Public repository discovery is available before an owner connects private repositories. */
export const githubSearch: BuiltinTool = {
  spec: { name: "github_search_repositories", description: "Search public repositories on GitHub by keyword, owner or topic. Returns canonical repository URLs, descriptions and detected licence. For private data use the owner's GitHub Repositories connector.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  label: "Search GitHub", group: "reach", activity: "searching", outside: true, parallel: true,
  run: async (a, c) => {
    const query = String(a.query ?? "").trim().slice(0, 240);
    if (!query) return { content: "Give a repository name or search terms.", isError: true };
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", query); url.searchParams.set("per_page", "8");
    const res = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "Sklubot" }, redirect: "error", signal: AbortSignal.any([c.signal, AbortSignal.timeout(12_000)]) });
    if (!res.ok) return { content: `GitHub search returned HTTP ${res.status}. For authenticated searches use the GitHub Repositories connector.`, isError: true };
    const result = await res.json() as { items: { full_name: string; html_url: string; description: string | null; license: {spdx_id: string} | null }[] };
    return { content: result.items.map(r => `${r.full_name} · ${r.html_url}\n${(r.description ?? "").slice(0, 320)} · ${r.license?.spdx_id ?? "Check the repository licence"}`).join("\n\n") || "No matching public repositories." };
  },
};
