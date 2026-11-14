/**
 * Web search for models that cannot search by themselves. Two back ends, picked by what is configured:
 * a Brave Search key (BRAVE_API_KEY), or the address of a SearXNG instance you run (SEARXNG_URL).
 */
export interface WebResult { title: string; url: string; snippet: string }

export const searchConfigured = () => Boolean(process.env.BRAVE_API_KEY || process.env.SEARXNG_URL);

export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebResult[]> {
  const timeout = AbortSignal.timeout(20_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (process.env.BRAVE_API_KEY) {
    const base = (process.env.BRAVE_API_URL ?? "https://api.search.brave.com").replace(/\/$/, "");
    const res = await fetch(`${base}/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, { headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_API_KEY }, signal: sig });
    if (!res.ok) throw new Error(`the search service answered ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? []).filter((r) => r.url).map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
  }
  if (process.env.SEARXNG_URL) {
    const res = await fetch(`${process.env.SEARXNG_URL.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { accept: "application/json" }, signal: sig });
    if (!res.ok) throw new Error(`the search service answered ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? []).filter((r) => r.url).slice(0, 8).map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? "" }));
  }
  throw new Error("no search service is configured on this server");
}
