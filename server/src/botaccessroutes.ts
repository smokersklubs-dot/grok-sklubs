import type { Context, Hono } from "hono";
import { registerBotApi, registerBotApiOwner } from "./botapi.js";
import { handleBotMcp } from "./botmcp.js";
import { registerTeamMcp, registerTeamMcpOwner } from "./teammcp.js";
import type { BotRecord } from "./store.js";

export function registerBotClients(api: Hono<any>) {
  registerBotApi(api, handleBotMcp);
  registerTeamMcp(api);
}

export function registerBotClientSettings(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  registerBotApiOwner(api, ownAgent);
  registerTeamMcpOwner(api);
}
