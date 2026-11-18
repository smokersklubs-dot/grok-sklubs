import type { Hono } from "hono";
import { guardedFetch } from "./net.js";
import { RateWindow } from "./hardening.js";

import { bots } from "./store.js";
import { runChain, searchProviders } from "./providers.js";

const searches = new RateWindow(12, 60000);
const budget = new RateWindow(35, 60000);
export function registerReader(api: Hono<any>) {
  api.post("/bots/:id/workspace/web/search", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id"));
    if (!bot || bot.kind !== "agent" || bot.hidden) return c.json({ error: "Bot introuvable." }, 404);
    if (bot.disabledTools.includes("web")) return c.json({ error: "La recherche web est désactivée pour ce bot." }, 403);
    const body = await c.req.json().catch(() => null);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query || query.length > 400) return c.json({ error: "Entre une recherche de 1 à 400 caractères." }, 400);
    if (searches.over(user.id)) return c.json({ error: "Trop de recherches. Réessaie dans une minute." }, 429);
    c.header("Cache-Control", "no-store");
    const providers = searchProviders().filter((p) => p.tier !== "paid");
    try {
      const outcome = await runChain("web search", providers, { query }, {
        bot, signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(25000)]),
      });
      const results = (outcome.result ?? []).filter((result) => {
        try {
          const u = new URL(result.url);
          return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
        } catch { return false; }
      }).slice(0, 8);
      return c.json({ query, results, provider: outcome.servedBy });
    } catch {
      return c.json({ error: "La recherche a été interrompue." }, 503);
    }
  });
  api.post("/workspace/web/read", async (c) => {
    if (budget.over(c.get("user").id)) return c.json({ error: "Trop de lectures. Réessaie dans une minute." }, 429);
    const body = await c.req.json().catch(() => null);
    try {
      let url = new URL(String(body?.url ?? ""));
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15000)]);
      for (let hop = 0; hop < 6; hop++) {
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 3000)
          return c.json({ error: "Adresse web invalide." }, 400);
        const res = await guardedFetch(url, {
          signal,
          redirect: "manual",
          headers: { accept: "text/html,text/plain", "user-agent": "Sklubot reader" },
        });
        const to = res.headers.get("location");
        if ([301, 302, 303, 307, 308].includes(res.status) && to) {
          await res.body?.cancel();
          url = new URL(to, url);
          continue;
        }
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !/^text\/(html|plain)/i.test(type)) {
          await res.body?.cancel();
          return c.json({ error: "Cette page nécessite le navigateur interactif." }, 422);
        }
        const reader = res.body?.getReader();
        if (!reader) throw Error();
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          while (size < 512000) {
            const v = await reader.read();
            if (v.done) break;
            const part = v.value.subarray(0, 512000 - size);
            chunks.push(Buffer.from(part));
            size += part.length;
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        const links: { label: string; url: string }[] = [];
        if (type.includes("html"))
          for (const match of raw.matchAll(
            /<a\b[^>]{0,1600}?\bhref=["']([^"']{1,3000})["'][^>]*>([\s\S]{1,800}?)<\/a>/gi,
          )) {
            try {
              const href = new URL(match[1].replaceAll("&amp;", "&"), url),
                label = htmlToText(match[2]).slice(0, 100);
              if (
                label &&
                ["http:", "https:"].includes(href.protocol) &&
                !href.username &&
                !href.password &&
                !links.some((l) => l.url === href.href)
              )
                links.push({ label, url: href.href });
            } catch {
              /* invalid link */
            }
            if (links.length >= 24) break;
          }
        c.header("Cache-Control", "no-store");
        return c.json({
          url: url.href,
          title: htmlToText(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(raw)?.[1] ?? url.hostname),
          text: (type.includes("html") ? htmlToText(raw) : raw).slice(0, 45000),
          links,
        });
      }
    } catch {
      /* safe public reader errors only */
    }
    return c.json({ error: "Lecture impossible. Vérifie l’adresse ou ouvre le site sur le bureau du bot." }, 400);
  });
}

/** Crude but dependable HTML → text: enough for a model to read an article or a docs page. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}
