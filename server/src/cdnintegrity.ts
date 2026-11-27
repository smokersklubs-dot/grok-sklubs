import { PAGE_CDNS } from "./pagefiles.js";

/**
 * L45 — scripts and style sheets that a published page loads from a CDN (pagefiles.ts PAGE_CDNS) must carry their
 * fingerprint: `integrity="sha384-…" crossorigin="anonymous"` (Subresource Integrity, https://www.w3.org/TR/SRI/ ;
 * the "secure external subresources" guide of GoogleChrome/modern-web-guidance-src, CC BY 4.0, read for this item). With
 * it, a CDN that is compromised or serves another file cannot change the page: the browser refuses the file. An exact
 * version in the address (`lib@3.4.1`, `/3.4.1/`) is needed too, or the fingerprint breaks at the next release.
 *
 * The publish still goes through (a page without them works as before, in its sandbox); the bot is told which files lack
 * them and how to fix it with page_edit, and the owner sees the same line in the tool's result. Nothing is fetched here.
 */
export interface CdnProblem { url: string; tag: "script" | "link"; missing: ("integrity" | "crossorigin" | "version")[] }

const TAG = /<(script|link)\b([^>]*)>/gi;
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
const value = (m: RegExpExecArray | null) => (m ? (m[2] ?? m[3] ?? m[4] ?? "") : null);
/** An exact version in a CDN address: `@1.2.3` (npm CDNs) or `/1.2.3/` (cdnjs). `@latest`, `@3`, no version: not pinned. */
export const pinnedVersion = (url: string) => /@\d+\.\d+\.\d+(?:[-+][\w.]+)?(?:\/|$)/.test(url) || /\/\d+\.\d+\.\d+(?:[-+][\w.]+)?\//.test(url);

export function cdnProblems(html: string): CdnProblem[] {
  const out: CdnProblem[] = [];
  for (const m of html.matchAll(TAG)) {
    const tag = m[1].toLowerCase() as "script" | "link";
    const attrs = m[2];
    if (tag === "link" && !/stylesheet|modulepreload|preload/i.test(value(attr(attrs, "rel")) ?? "")) continue;
    const url = value(attr(attrs, tag === "script" ? "src" : "href"));
    if (!url || !PAGE_CDNS.some((c) => url.startsWith(`${c}/`))) continue;
    const integrity = value(attr(attrs, "integrity"));
    const missing: CdnProblem["missing"] = [];
    if (!integrity || !/^sha(256|384|512)-[A-Za-z0-9+/=]{20,}/.test(integrity.trim())) missing.push("integrity");
    if (attr(attrs, "crossorigin") === null) missing.push("crossorigin");
    if (!pinnedVersion(url)) missing.push("version");
    if (missing.length) out.push({ url, tag, missing });
  }
  return out;
}

/** The line added to page_publish / page_edit results (English: the model reads it), or "". */
export function cdnWarning(html: string): string {
  const list = cdnProblems(html);
  if (!list.length) return "";
  const lines = list.slice(0, 8).map((p) => `- ${p.url}: missing ${p.missing.join(", ")}`);
  return `\nWarning — CDN files without their fingerprint (a compromised CDN could change this page):\n${lines.join("\n")}${list.length > 8 ? `\n- …and ${list.length - 8} more` : ""}\nFix it with page_edit: pin an exact version in each address and add integrity="sha384-…" crossorigin="anonymous" (the CDN shows the SRI hash next to each file; cdnjs and jsDelivr both do).`;
}
