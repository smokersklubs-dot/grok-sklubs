import type { Context, Hono } from "hono";
import { registerAccountNetRoutes } from "./accountnetroutes.js";
import { registerResearchFeedPublic } from "./researchwatch.js";
import { reportMessage } from "./researchsection.js";
import { registerBotApi, registerBotApiOwner } from "./botapi.js";
import { handleBotMcp } from "./botmcp.js";
import { registerOpenApiRoutes } from "./botopenai.js";
import { startOutWebhooks } from "./outwebhooks.js";
import { registerTeamMcp, registerTeamMcpOwner } from "./teammcp.js";
import type { BotRecord } from "./store.js";

export function registerBotClients(api: Hono<any>) {
  registerOpenApiRoutes(api); // L170: OpenAI-compatible chat, models, memories, openapi.json, deprecation headers (botopenai.ts)
  registerBotApi(api, handleBotMcp);
  registerResearchFeedPublic(api, reportMessage); // L87 private Atom feed of research reports (researchwatch.ts)
  registerTeamMcp(api);
  startOutWebhooks(); // L170: outgoing webhooks (outwebhooks.ts)
}

export function registerBotClientSettings(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  registerBotApiOwner(api, ownAgent);
  registerTeamMcpOwner(api);
  registerAccountNetRoutes(api, ownAgent); // L82 provider keys, L169 network policy, L170 webhooks, L181 local import
}
