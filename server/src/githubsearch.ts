import type { BuiltinTool } from "./agent/tools.js";
import { repositoryName } from "./clientshared/chatmentions.js";

export interface PublicRepository { name: string; description: string; license: string | null }
class GithubResponseError extends Error {
  constructor(readonly status: number) { super(`GitHub HTTP ${status}`); }
}
function githubRequest(url: URL, signal: AbortSignal, accept = "application/vnd.github+json") {
  return fetch(url, { headers: { accept, "user-agent": "Sklubot" }, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
}
export async function searchPublicRepositories(query: string, signal: AbortSignal): Promise<PublicRepository[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query.trim().slice(0, 240));
  url.searchParams.set("per_page", "8");
  const res = await githubRequest(url, signal);
  if (!res.ok) throw new GithubResponseError(res.status);
  const result = await res.json() as { items: { full_name: string; description: string | null; license: { spdx_id: string } | null }[] };
  return result.items.filter(r => repositoryName(r.full_name)).map(r => ({
    name: r.full_name, description: (r.description ?? "").slice(0, 320), license: r.license?.spdx_id ?? null,
  }));
}

/** Public repository discovery is available before an owner connects private repositories. */
export const githubSearch: BuiltinTool = {
  spec: { name: "github_search_repositories", description: "Search public repositories on GitHub by keyword, owner or topic. Returns canonical repository URLs, descriptions and detected licence. For private data use the owner's GitHub Repositories connector.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  label: "Search GitHub", group: "reach", activity: "searching", outside: true, parallel: true,
  run: async (a, c) => {
    const query = String(a.query ?? "").trim().slice(0, 240);
    if (!query) return { content: "Give a repository name or search terms.", isError: true };
    let repos: PublicRepository[];
    try { repos = await searchPublicRepositories(query, c.signal); }
    catch (err) {
      if (!(err instanceof GithubResponseError)) throw err;
      return { content: `GitHub search returned HTTP ${err.status}. For authenticated searches use the GitHub Repositories connector.`, isError: true };
    }
    return { content: repos.map(r => `${r.name} · https://github.com/${r.name}\n${r.description} · ${r.license ?? "Check the repository licence"}`).join("\n\n") || "No matching public repositories." };
  },
};

export const githubRead: BuiltinTool = {
  spec: { name: "github_read_repository", description: "Read the README of a specified public GitHub repository by URL or owner/name. For private repositories, use the signed-in GitHub connector.", inputSchema: { type: "object", properties: { repository: { type: "string" } }, required: ["repository"] } },
  label: "Read GitHub README", group: "reach", activity: "reading", outside: true, parallel: true,
  run: async (args, ctx) => {
    const name = repositoryName(String(args.repository ?? ""));
    if (!name) return { content: "Supply a GitHub repository URL or owner/name.", isError: true };
    const res = await githubRequest(new URL(`https://api.github.com/repos/${name}/readme`), ctx.signal, "application/vnd.github.raw+json");
    if (!res.ok || !res.body) return { content: `README unavailable (GitHub HTTP ${res.status}). For private repositories use the connected account.`, isError: true };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const limit = 16_384;
    let count = 0, output = "", truncated = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const part = value.subarray(0, limit - count);
        output += decoder.decode(part, { stream: true });
        count += part.length;
        if (part.length < value.length) { truncated = true; break; }
      }
    } finally { await reader.cancel(); }
    return { content: `https://github.com/${name}#readme\n\n${output}${decoder.decode()}${truncated ? "\n[README excerpt truncated]" : ""}` };
  },
};
