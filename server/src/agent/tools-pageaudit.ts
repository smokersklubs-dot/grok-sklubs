import { readLibraryFile, workspaceOf } from "../computer.js";
import { config as appConfig } from "../config.js";
import { linuxExec } from "../linux.js";
import type { ToolSpec } from "../llm/types.js";
import { formatAudit, PAGE_AUDIT_JS, type PageAuditAnswer } from "../pageaudit.js";
import { pageFiles, pageHeaders } from "../pagefiles.js";
import { clip, pages } from "../store.js";
import { pathOf } from "./pagetools.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * L115 — page_audit: Lighthouse and axe on the bot's own Linux computer (pageaudit.ts runs inside it), for a page the
 * bot published (served from memory inside the computer, its own files and headers) or an http(s) address (the owner's
 * site, a page of the bot's own dev server on 127.0.0.1). Read-only: nothing is changed or sent; the reports land in the
 * bot's library (audits/…) and only a short summary comes back. Linux computers only (tools.ts adds it with the computer
 * tools); it never touches the screen, so it also runs while the user drives the computer.
 */
type Runner = (c: ToolContext, req: object, timeoutSec: number) => Promise<PageAuditAnswer>;
const defaultRunner: Runner = async (c, req, timeoutSec) => {
  const r = await linuxExec(c.bot.id, c.user.id, workspaceOf(c.bot.id), ["node", "-e", PAGE_AUDIT_JS], timeoutSec, { input: JSON.stringify(req), maxBytes: 1_000_000, signal: c.signal });
  if (r.timedOut) return { error: "timeout" };
  try { return JSON.parse(r.stdout) as PageAuditAnswer; } catch { return { error: "failed", detail: clip(r.stderr || r.stdout, 200) }; }
};
let runner: Runner = defaultRunner;
/** Tests: a fake computer. */
export const setPageAuditRunner = (fn: Runner | null) => { runner = fn ?? defaultRunner; };

const ERRORS: Record<string, string> = {
  no_tools: "This computer was made from an older image without Lighthouse and axe: they come with the next computer image. Meanwhile do the manual checks of the skill “Accessibilité mesurée” (element_snapshot, screen_key Tab, screen_view).",
  timeout: "The audit took longer than 4 minutes and was stopped. Try again; if the page is very heavy, audit it in parts.",
  failed: "The audit could not run on your computer.",
  bad_request: "The audit could not read its request.",
};

/** A usable address: http(s) only, no user name or password inside it. */
export function auditUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? "").trim());
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

const spec: ToolSpec = {
  name: "page_audit",
  description: "Measure a page with Lighthouse (accessibility, performance, best practices, SEO scores) and axe (accessibility rules) on your own computer, at phone size. Give `name` for a page you published (page_publish), or `url` for an http(s) address (the user's site, a page of a dev server on your computer). Returns a short summary; the full reports are saved in your library (audits/…). Takes about 30 seconds. Use it before calling a page finished, and after fixing it.",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "The name of a page you published, e.g. weekly-report" }, url: { type: "string", description: "Or an http(s) address to audit" } }, required: [] },
};

export const pageAuditTools: BuiltinTool[] = [{
  spec, activity: "reading", label: "Auditing a page", outside: true, audited: true,
  detail: (a) => clip(String(a.name || a.url || ""), 60),
  run: async (a, c) => {
    let req: Record<string, unknown>; let what: string;
    if (typeof a.name === "string" && a.name.trim()) {
      const rel = pathOf(c.bot.id, a.name);
      if (!pages.forPath(c.bot.id, rel, appConfig.publicUrl)) {
        const mine = pages.list(c.user.id, appConfig.publicUrl).filter((p) => p.botId === c.bot.id).slice(0, 30).map((p) => p.path.split("/").pop()!.replace(/\.html$/, ""));
        return { content: `No page called "${clip(a.name, 60)}".${mine.length ? ` Your pages: ${mine.join(", ")}.` : " You have not published any page."} For another address, give url.`, isError: true, summary: "no such page" };
      }
      const { "x-robots-tag": _noindex, ...headers } = pageHeaders(); // bot pages are kept out of search engines on purpose: not a finding to fix
      const name = rel.split("/").pop()!.replace(/\.html$/, "");
      req = { name, html: readLibraryFile(c.bot.id, rel).toString("utf8"), files: pageFiles.list(c.bot.id, rel).map((f) => ({ path: f.file, content: f.content })), headers };
      what = `your page “${name}”`;
    } else if (a.url !== undefined && String(a.url).trim()) {
      const url = auditUrl(a.url);
      if (!url) return { content: "Give an http:// or https:// address (without a user name or password in it).", isError: true, summary: "bad address" };
      req = { name: new URL(url).hostname, url };
      what = url;
    } else return { content: "Give `name` (a page you published) or `url` (an http(s) address).", isError: true };
    const r = await runner(c, req, 240);
    if (!r.ok) return { content: `${ERRORS[r.error ?? "failed"] ?? `The audit failed: ${clip(r.error ?? "", 100)}`}${r.detail ? ` (${clip(r.detail, 160)})` : ""}`, isError: true, summary: clip(r.error ?? "failed", 40) };
    const s = r.lighthouse?.scores ?? {};
    return { content: formatAudit(what, r), summary: r.lighthouse?.ok ? `a11y ${s.accessibility ?? "—"} · perf ${s.performance ?? "—"} · axe ${r.axe?.count ?? "—"}` : "partial" };
  },
}];
