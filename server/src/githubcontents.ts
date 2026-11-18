/** The Contents API returns one object for both files and directories with this media type.
 * A fixed API host and encoded path segments keep browsing inside the requested public repository. */
export async function readPublicPath(name: string, args: Record<string, unknown>, signal: AbortSignal) {
  const path = args.path ?? "";
  const ref = args.ref;
  const start = args.start ?? 1;
  if (typeof path !== "string" || path.length > 1024 || /[\\\x00-\x1f\x7f]/.test(path) ||
      (path !== "" && path.split("/").some(s => !s || s === "." || s === ".."))) {
    return { content: "Provide a repository-relative path, or an empty string for the root.", isError: true };
  }
  if (ref !== undefined && (typeof ref !== "string" || !ref.trim() || ref.length > 255 || /[\x00-\x1f\x7f]/.test(ref))) {
    return { content: "Provide a branch, tag or commit as the ref.", isError: true };
  }
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) return { content: "start must be a positive line or entry number.", isError: true };
  const tail = path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "";
  const url = new URL(`https://api.github.com/repos/${name}/contents${tail}`);
  if (typeof ref === "string") url.searchParams.set("ref", ref);
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github.object+json", "user-agent": "Sklubot" },
    redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  });
  if (!res.ok) return { content: `GitHub returned HTTP ${res.status}. Verify the path and ref. For private sources use the signed-in connector.`, isError: true };
  const item = await res.json() as {
    type: string; html_url: string; sha: string; encoding?: string; size: number; content?: string;
    entries?: { type: string; name: string }[];
  };
  if (item.type === "dir" && Array.isArray(item.entries)) {
    const entries = item.entries.slice(start - 1, start + 49).map(e => `${e.type}  ${e.name}`);
    const next = start + entries.length;
    return { content: [item.html_url, ...entries, ...(next <= item.entries.length ? [`Continue with start=${next}.`] : []),
      ...(item.entries.length === 1000 ? ["GitHub limits this directory response to 1,000 entries."] : [])].join("\n") };
  }
  if (item.type !== "file" || item.encoding !== "base64" || typeof item.content !== "string" || item.size > 1_048_576) {
    return { content: "This reader supports directories and text files up to 1 MiB.", isError: true };
  }
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(item.content, "base64")); }
  catch { return { content: "This file is not UTF-8 text.", isError: true }; }
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(source)) return { content: "This is a binary file.", isError: true };
  const lines = source.split(/\r?\n/);
  const excerpt: string[] = [];
  let length = 0;
  for (let i = start - 1; i < lines.length && excerpt.length < 120; i++) {
    const line = lines[i].length > 8192 ? lines[i].slice(0, 8192) + " [line truncated]" : lines[i];
    if (length + line.length > 16_384) break;
    excerpt.push(line);
    length += line.length + 1;
  }
  const next = start + excerpt.length;
  return { content: [item.html_url, `Blob ${item.sha} · start line ${start}`, ...excerpt,
    ...(next <= lines.length ? [`Continue with start=${next}.`] : [])].join("\n") };
}
