import { registerReader } from "./webreading.js";
import type { Hono } from "hono";
import { catalogFor } from "./catalog.js";
import { connectors, oauthRedirectUri } from "./connectors.js";
import { registerGithubApp } from "./githubapp.js";
import { searchPublicRepositories } from "./githubsearch.js";
import { isGithubConnector, repositoryName } from "./clientshared/chatmentions.js";

export function registerConnectorCatalog(api: Hono<any>) {
  registerReader(api);
  registerGithubApp(api, connectors, oauthRedirectUri());
  api.post("/connectors/github/account-search", async c => {
    c.header("Cache-Control", "private, no-store");
    const body = await c.req.json().catch(() => null);
    const query = typeof body?.query === "string" && body.query.trim();
    if (!query || query.length > 240) return c.json({ error: "Invalid query" }, 400);
    const user = c.get("user");
    const source = connectors.list(user.id).find(app => isGithubConnector(app.url) && app.status === "ready" && app.tools.some(t => t.name === "search_repositories" && t.readOnly));
    if (!source) return c.json({ error: user.locale === "fr" ? "Connecte GitHub pour rechercher dans tes dépôts." : "Connect GitHub to search your repositories." }, 409);
    try {
      const result = await connectors.call(source.id, "search_repositories", { query, perPage: 8, minimal_output: true }, undefined, c.req.raw.signal);
      if (result.isError) throw new Error("GitHub search failed");
      const items = JSON.parse(result.text)?.items;
      if (!Array.isArray(items)) throw new Error("Unexpected search result");
      const repositories = items.slice(0, 8).flatMap(item => {
        const name = typeof item?.full_name === "string" && repositoryName(item.full_name);
        return name ? [{ name, description: typeof item.description === "string" ? item.description.slice(0, 320) : "", license: null }] : [];
      });
      return c.json({ repositories });
    } catch { return c.json({ error: user.locale === "fr" ? "Recherche GitHub indisponible. Vérifie la connexion de ton compte." : "GitHub search unavailable. Check your account connection." }, 502); }
  });
  api.get("/connectors/github/public-search", async c => {
    const query = c.req.query("q")?.trim();
    if (!query || query.length > 240) return c.json({ error: "Invalid query" }, 400);
    try { return c.json({ repositories: await searchPublicRepositories(query, c.req.raw.signal) }); }
    catch { return c.json({ error: c.get("user").locale === "fr" ? "La recherche publique GitHub est momentanément indisponible. Tu peux coller le lien du dépôt." : "Public GitHub search is unavailable. You can paste a repository link." }, 503); }
  });
  api.get("/connectors/catalog", (c) => c.json({ apps: catalogFor(c.get("user").locale), oauthRedirectUri: oauthRedirectUri() }));
  api.get("/connectors", (c) => c.json({ connectors: connectors.list(c.get("user").id), oauthRedirectUri: oauthRedirectUri() }));
}
