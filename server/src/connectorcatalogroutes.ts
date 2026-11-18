import { registerReader } from "./webreading.js";
import type { Hono } from "hono";
import { catalogFor } from "./catalog.js";
import { connectors, oauthRedirectUri } from "./connectors.js";
import { registerGithubApp } from "./githubapp.js";

export function registerConnectorCatalog(api: Hono<any>) {
  registerReader(api);
  registerGithubApp(api, connectors, oauthRedirectUri());
  api.get("/connectors/catalog", (c) => c.json({ apps: catalogFor(c.get("user").locale), oauthRedirectUri: oauthRedirectUri() }));
  api.get("/connectors", (c) => c.json({ connectors: connectors.list(c.get("user").id), oauthRedirectUri: oauthRedirectUri() }));
}
