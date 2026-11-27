import { BlockedAddressError, fetchProblem, guardedFetch } from "../net.js";
import { clip } from "../store.js";

/**
 * L84 — an evaluator that tests a LIVE deliverable before the work is called finished (backlog A-FAIRE L84; behaviour
 * from the Nightly, Noodle and ECC audits; our own code).
 *
 * The end check (endcheck.ts) reads the worker's final report. A report can say « la page est en ligne » while the page
 * answers 404, an error page, or nothing. Now, when unattended work (a routine run, a background task, their
 * continuations) ends on a report that gives web addresses of what it made (a page, an app), each address is opened —
 * a plain GET through the server's guarded fetch (public addresses only, never a private one, at most MAX_URLS, short
 * timeout) — and checked: it answers (status under 400), it has real content, and it is not an error page. A failure is a
 * finding: the end check then relaunches the work with that precise reason (the usual 3-relaunch limit, every approval as
 * usual), instead of a silent "done". An address that cannot be tested (private, the network refused it) is not a
 * failure: it is simply not tested.
 */
export const MAX_URLS = 3;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 400_000;

/** The web addresses a report gives (http/https, no trailing punctuation), at most MAX_URLS, in order. */
export function deliverableUrls(report: string): string[] {
  const out: string[] = [];
  for (const m of String(report ?? "").matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?»]+$/u, "");
    try { new URL(u); } catch { continue; }
    if (!out.includes(u)) out.push(u);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

/** Error pages, in their usual words (title or body). */
const ERROR_PAGE = /\b(?:404\s*(?:not found|page not found)?|page not found|not found|500 internal server error|internal server error|application error|bad gateway|service unavailable|cannot (?:get|post) \/|this site can['’]t be reached|page introuvable|erreur 404|erreur interne)\b/i;
/** Signs of a page whose script failed to fill it in. */
const BROKEN_TEXT = /\[object Object\]|\bundefined\b.{0,20}\bundefined\b|\bNaN\b.{0,40}\bNaN\b/;

/** The visible text of an HTML page, roughly (scripts and styles left out). */
export function pageText(html: string): string {
  return String(html ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** What is wrong with one fetched answer; null when it looks alive. Exported for the tests. */
export function judgePage(url: string, status: number, contentType: string, body: string): string | null {
  if (status >= 400) return `${url} answers with error ${status}`;
  if (!/html|text|json/i.test(contentType)) return null; // a file (picture, PDF, archive): answering is enough
  const text = /html/i.test(contentType) ? pageText(body) : body.trim();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim() ?? "";
  if (ERROR_PAGE.test(title) || (text.length < 400 && ERROR_PAGE.test(text))) return `${url} shows an error page (${clip(title || text, 80)})`;
  if (text.length < 20 && !/<(?:canvas|svg|img|video|iframe)\b/i.test(body)) return `${url} is empty (no visible content)`;
  if (BROKEN_TEXT.test(text)) return `${url} shows broken values (like "undefined", "NaN" or "[object Object]")`;
  return null;
}

export interface LiveResult { tested: string[]; problems: string[] }

/** Opens each address and returns what failed. `fetcher` is the guarded fetch (replaced in the tests). */
export async function liveCheck(urls: string[], fetcher: typeof guardedFetch = guardedFetch): Promise<LiveResult> {
  const out: LiveResult = { tested: [], problems: [] };
  for (const url of urls.slice(0, MAX_URLS)) {
    let res: Response;
    try { res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/html,*/*" } }); }
    catch (err) {
      // Private or refused addresses cannot be tested from here: not a failure. A site that does not answer at all is one.
      if (err instanceof BlockedAddressError) continue;
      const why = fetchProblem(err);
      out.tested.push(url);
      out.problems.push(`${url} does not answer (${clip(why ?? String((err as Error)?.message ?? err), 120)})`);
      continue;
    }
    out.tested.push(url);
    let body = "";
    try { body = (await res.text()).slice(0, MAX_BYTES); } catch { /* unreadable body: judged on its status */ }
    const problem = judgePage(url, res.status, res.headers.get("content-type") ?? "", body);
    if (problem) out.problems.push(problem);
  }
  return out;
}
