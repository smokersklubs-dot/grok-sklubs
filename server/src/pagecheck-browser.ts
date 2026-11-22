import type { PageCheckAnswer, PageCheckRequest } from "./pagecheck.js";

/**
 * L56 in browser mode (no Linux computer: the server's own Chromium through Playwright): the page just published,
 * served from memory at a private address of this check only (page.route + route.fulfill, with the real page's headers),
 * rendered at each size, with its console errors, failed loads, the in-page rules and one screenshot per size. The bot's
 * own tab is not touched (a temporary page of its browser context). Playwright API: https://playwright.dev/docs/api/class-page
 * (route, setViewportSize, goto, evaluate, screenshot, events "console", "pageerror", "response", "requestfailed").
 */
const BASE = "http://sklubot-check.invalid/p/check/";
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml; charset=utf-8", csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8" };

export async function browserPageCheck(context: any, req: PageCheckRequest): Promise<PageCheckAnswer> {
  const files = new Map<string, string>([["index.html", req.html], ...req.files.map((f) => [f.path.replace(/^\/+/, ""), f.content] as [string, string])]);
  const p = await context.newPage();
  const ans: Required<Pick<PageCheckAnswer, "shots" | "console" | "failed" | "rules">> = { shots: [], console: [], failed: [], rules: {} };
  let width = 0;
  try {
    await p.route("http://sklubot-check.invalid/**", (route: any) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/p\/check\//, "")) || "index.html";
      const body = files.get(rel);
      if (body === undefined) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, headers: { ...req.headers, "content-type": TYPES[rel.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" }, body });
    });
    p.on("pageerror", (e: Error) => ans.console.push({ width, text: `Uncaught ${e.message}`.slice(0, 300) }));
    p.on("console", (m: any) => { if (m.type() === "error" && !/^Failed to load resource/.test(String(m.text()))) ans.console.push({ width, text: String(m.text()).slice(0, 300), line: (m.location()?.lineNumber ?? -1) + 1, url: m.location()?.url ?? "" }); });
    p.on("response", (r: any) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) ans.failed.push({ width, url: r.url(), status: r.status() }); });
    p.on("requestfailed", (r: any) => ans.failed.push({ width, url: r.url(), error: r.failure()?.errorText ?? "failed" }));
    for (const [w, h] of req.sizes) {
      width = w;
      await p.setViewportSize({ width: w, height: h });
      await p.goto(BASE, { waitUntil: "load", timeout: 30_000 });
      await p.waitForTimeout(500);
      ans.rules[String(w)] = await p.evaluate(req.rules).catch(() => []);
      ans.shots.push({ width: w, height: h, data: (await p.screenshot({ type: "jpeg", quality: 60 })).toString("base64") });
    }
  } finally { await p.close().catch(() => {}); }
  return { ok: true, ...ans };
}
