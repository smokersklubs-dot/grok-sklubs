import { config } from "./config.js";
import { guardedFetch } from "./net.js";
import type { XSearchProvider } from "./shared.js";

/**
 * Recent posts on X, through an official API. Two routes, chosen by the keys the server has:
 *
 * 1. X API v2 "recent search" (preferred when X_BEARER_TOKEN is set): the posts themselves, from the last 7 days.
 *    GET https://api.x.com/2/tweets/search/recent with an app-only Bearer token; parameters `query` (1-4096 chars),
 *    `max_results` (10-100), `sort_order` (recency | relevancy), `expansions=author_id`, `user.fields=username,name`
 *    and `post.fields=created_at,author_id,public_metrics` (the field list is named `post.fields` in the current
 *    reference). Response: `data[]` (id, text, author_id, created_at), `includes.users[]` (id, username, name), `meta`.
 *    Docs: https://docs.x.com/x-api/posts/search-recent-posts
 *
 * 2. xAI's server-side `x_search` tool (when only XAI_API_KEY is set): Grok searches X itself and answers with
 *    citations. POST https://api.x.ai/v1/responses with `tools: [{ type: "x_search", from_date, to_date,
 *    allowed_x_handles | excluded_x_handles }]` (dates YYYY-MM-DD; at most 20 handles, without "@"; the two handle
 *    lists cannot be combined). The answer is in `output[].content[]` blocks of type `output_text`, with
 *    `annotations[]` of type `url_citation` (url, title); `citations` lists every source seen.
 *    Docs: https://docs.x.ai/developers/tools/x-search and https://docs.x.ai/developers/tools/citations
 *
 * Whatever comes back is outside content (the tool is marked `outside`).
 */
export function xSearchProvider(): XSearchProvider {
  if (process.env.X_BEARER_TOKEN) return "x";
  if (process.env.XAI_API_KEY) return "xai";
  return null;
}

export interface XSearchInput { query: string; max?: number; sort?: "recency" | "relevancy"; fromDate?: string; toDate?: string; handles?: string[]; excludeHandles?: string[] }
export interface XPost { id: string; text: string; author: string; name?: string; at?: string; url: string; likes?: number; reposts?: number }
export interface XSearchResult { provider: "x" | "xai"; posts: XPost[]; summary?: string; citations: string[] }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const cleanHandles = (list: unknown): string[] => (Array.isArray(list) ? list : []).map((h) => String(h).trim().replace(/^@/, "")).filter((h) => HANDLE.test(h)).slice(0, 20);

export async function xSearch(input: XSearchInput, signal: AbortSignal): Promise<XSearchResult> {
  const provider = xSearchProvider();
  if (!provider) throw new Error("No X search is set up on this server (X_BEARER_TOKEN for the X API, or XAI_API_KEY for xAI).");
  const query = input.query.trim().slice(0, 4096);
  if (!query) throw new Error("Say what to search for.");
  if (input.fromDate && !DATE.test(input.fromDate)) throw new Error("from_date must be YYYY-MM-DD.");
  if (input.toDate && !DATE.test(input.toDate)) throw new Error("to_date must be YYYY-MM-DD.");
  const handles = cleanHandles(input.handles);
  const excluded = cleanHandles(input.excludeHandles);
  if (handles.length && excluded.length) throw new Error("Use either handles or exclude_handles, not both.");
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  return provider === "x" ? viaXApi(query, input, handles, excluded, timeout) : viaXai(query, input, handles, excluded, timeout);
}

async function viaXApi(query: string, input: XSearchInput, handles: string[], excluded: string[], signal: AbortSignal): Promise<XSearchResult> {
  // Handle filters become search operators (from:, -from:), which the recent search query language supports.
  const q = [query, handles.length ? `(${handles.map((h) => `from:${h}`).join(" OR ")})` : "", ...excluded.map((h) => `-from:${h}`)].filter(Boolean).join(" ").slice(0, 4096);
  const url = new URL(`${config.xApiBaseUrl}/2/tweets/search/recent`);
  url.searchParams.set("query", q);
  url.searchParams.set("max_results", String(Math.min(100, Math.max(10, input.max ?? 10))));
  if (input.sort) url.searchParams.set("sort_order", input.sort);
  // start_time must lie within the last 7 days (the API refuses older ones): an older from_date is simply not sent.
  if (input.fromDate) { const t = Date.parse(`${input.fromDate}T00:00:00Z`); if (t > Date.now() - 7 * 86_400_000 + 60_000) url.searchParams.set("start_time", new Date(t).toISOString()); }
  if (input.toDate) { const t = Date.parse(`${input.toDate}T00:00:00Z`); if (t < Date.now() - 30_000) url.searchParams.set("end_time", new Date(t).toISOString()); }
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");
  url.searchParams.set("post.fields", "created_at,author_id,public_metrics");
  const res = await guardedFetch(url.toString(), { headers: { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }, redirect: "error", signal });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(`The X API answered ${res.status}${body?.title ? `: ${String(body.title).slice(0, 120)}` : ""}${res.status === 429 ? " (rate limit — try later)" : ""}.`);
  const users = new Map<string, { username: string; name?: string }>((body?.includes?.users ?? []).map((u: any) => [String(u.id), { username: String(u.username ?? ""), name: u.name ? String(u.name) : undefined }]));
  const posts: XPost[] = (Array.isArray(body?.data) ? body.data : []).map((p: any) => {
    const u = users.get(String(p.author_id)) ?? { username: "i" };
    return {
      id: String(p.id), text: String(p.text ?? ""), author: u.username, name: u.name, at: p.created_at ? String(p.created_at) : undefined,
      url: `https://x.com/${u.username || "i"}/status/${p.id}`, likes: p.public_metrics?.like_count, reposts: p.public_metrics?.retweet_count,
    };
  });
  return { provider: "x", posts, citations: posts.map((p) => p.url) };
}

async function viaXai(query: string, input: XSearchInput, handles: string[], excluded: string[], signal: AbortSignal): Promise<XSearchResult> {
  const tool: Record<string, unknown> = { type: "x_search" };
  if (input.fromDate) tool.from_date = input.fromDate;
  if (input.toDate) tool.to_date = input.toDate;
  if (handles.length) tool.allowed_x_handles = handles;
  if (excluded.length) tool.excluded_x_handles = excluded;
  const base = (process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/$/, "");
  const res = await guardedFetch(`${base}/responses`, {
    method: "POST", redirect: "error", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: config.xaiSearchModel,
      input: [{ role: "user", content: `Search X for recent posts about: ${query}\nList the most relevant posts (author handle, date, what they say) with a link to each post. Do not add anything that is not in the posts.` }],
      tools: [tool],
    }),
  });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(`xAI answered ${res.status}${body?.error ? `: ${String(body.error?.message ?? body.error).slice(0, 160)}` : ""}.`);
  const texts: string[] = [];
  const cited = new Set<string>();
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    if (item?.type !== "message") continue;
    for (const c of Array.isArray(item.content) ? item.content : []) {
      if (c?.type !== "output_text") continue;
      texts.push(String(c.text ?? ""));
      for (const a of Array.isArray(c.annotations) ? c.annotations : []) if (a?.type === "url_citation" && typeof a.url === "string") cited.add(a.url);
    }
  }
  for (const u of Array.isArray(body?.citations) ? body.citations : []) if (typeof u === "string") cited.add(u);
  const posts: XPost[] = [...cited].map((u) => /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(u)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[2], text: "", author: m[1], url: `https://x.com/${m[1]}/status/${m[2]}` }));
  return { provider: "xai", posts, summary: texts.join("\n\n").trim(), citations: [...cited] };
}

/** The result as the model reads it. */
export function formatXResult(r: XSearchResult): string {
  if (r.provider === "x") {
    if (!r.posts.length) return "No recent posts on X match (the X API searches the last 7 days).";
    return [`${r.posts.length} recent posts on X (X API, last 7 days):`, ...r.posts.map((p, i) => `${i + 1}. @${p.author}${p.name ? ` (${p.name})` : ""}${p.at ? ` · ${p.at.slice(0, 16).replace("T", " ")} UTC` : ""}${p.likes !== undefined ? ` · ${p.likes} likes` : ""}\n   ${p.text.replace(/\s+/g, " ").slice(0, 600)}\n   ${p.url}`)].join("\n");
  }
  return [`X search through xAI (Grok searched X and summarised; check the links):`, r.summary || "(no answer)", r.citations.length ? `Sources:\n${r.citations.slice(0, 25).map((u) => `- ${u}`).join("\n")}` : "No sources were cited: treat the answer as unsourced."].join("\n\n");
}
