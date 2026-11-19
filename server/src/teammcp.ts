import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import {
  apiClientIp,
  apiLimits,
  BotApiError,
  botInfo,
  cleanScopes,
  handleApiRequest,
  type Caller,
} from "./botapi.js";
import { callBotTool, serveControlMcp, toolsFor } from "./botmcp.js";
import { q } from "./db.js";
import { audit, bots, newId, now, sha256, users, type BotRecord, type UserRecord } from "./store.js";
import type { BotApiScope } from "./shared.js";
import { hostedMode, suspended } from "./hosted.js";

export const TEAM_SECRET_PREFIX = "sk-team-";
interface Grant {
  id: string;
  user_id: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
}
const fields = "id,user_id,scopes,created_at,last_used_at";
const view = (g: Grant) => ({
  id: g.id,
  scopes: cleanScopes(JSON.parse(g.scopes)),
  createdAt: g.created_at,
  lastUsedAt: g.last_used_at,
});
const current = (userId: string) =>
  q.get<Grant>(`SELECT ${fields} FROM team_mcp_keys WHERE user_id=?`, userId);
const noKey = () =>
  new BotApiError(401, "unauthorized", "Jeton d’équipe Sklubot absent, invalide ou révoqué.");
const missingBot = () => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: "Bot introuvable pour cet accès. Choisis un bot_id renvoyé par list_bots.",
    },
  ],
});
const refused = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const tooMany = () =>
  new BotApiError(429, "rate_limited", "Trop de requêtes. Réessaie dans une minute.");

function authenticate(c: Context) {
  if (apiLimits.perAddress.over(apiClientIp(c))) throw tooMany();
  const secret = /^Bearer (sk-team-[a-zA-Z0-9_-]{43})$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (!secret) throw noKey();
  const grant = q.get<Grant>(`SELECT ${fields} FROM team_mcp_keys WHERE key_hash=?`, sha256(secret));
  if (!grant) throw noKey();
  const user = users.byId(grant.user_id);
  if (!user) throw noKey();
  if (hostedMode() && suspended(user.id)) throw new BotApiError(403, "suspended", "Compte suspendu.");
  if (apiLimits.perKey.over(grant.id)) throw tooMany();
  if (!grant.last_used_at || grant.last_used_at < now() - 60_000)
    q.run("UPDATE team_mcp_keys SET last_used_at=? WHERE id=?", now(), grant.id);
  return { user, grant, scopes: view(grant).scopes };
}
function callerFor(user: UserRecord, grant: Grant, bot: BotRecord, scopes: BotApiScope[]): Caller {
  return {
    user,
    bot,
    key: {
      userId: user.id,
      botId: bot.id,
      id: grant.id,
      name: "Claude Code · équipe",
      prefix: TEAM_SECRET_PREFIX,
      scopes,
      createdAt: grant.created_at,
      lastUsedAt: grant.last_used_at,
      revokedAt: null,
    },
  };
}

export function registerTeamMcp(api: Hono<any>) {
  api.post(
    "/v1/team/mcp",
    handleApiRequest(async (c) => {
      const { user, grant, scopes } = authenticate(c);
      const definitions = toolsFor(scopes).map((tool) => {
        if (tool.name === "list_bots")
          return {
            ...tool,
            description:
              "List the current personal Sklubot agents of this account, with their id, status and permitted actions.",
          };
        const schema = tool.inputSchema;
        return {
          ...tool,
          inputSchema: {
            ...schema,
            properties: {
              ...(schema.properties as object),
              bot_id: { type: "string", description: "Required target, from list_bots." },
            },
            required: [...(Array.isArray(schema.required) ? schema.required : []), "bot_id"],
          },
        };
      });
      return serveControlMcp(c, "sklubot-team", definitions, async (name, args, signal) => {
        if (!q.get("SELECT 1 FROM team_mcp_keys WHERE user_id=? AND id=?", user.id, grant.id))
          return refused("Accès révoqué.");
        if (!definitions.some((t) => t.name === name))
          return refused("Outil inconnu ou permission absente.");
        if (name === "list_bots") {
          const available = bots.list(user.id).filter((b) => b.kind === "agent" && !b.hidden);
          const reachable = available.map((bot) => ({
            ...botInfo(callerFor(user, grant, bot, scopes)).bot,
            scopes,
          }));
          return { content: [{ type: "text", text: JSON.stringify({ bots: reachable }) }] };
        }
        if (typeof args.bot_id !== "string" || !args.bot_id) return missingBot();
        const bot = bots.owned(user.id, args.bot_id);
        if (!bot || bot.hidden || bot.kind !== "agent") return missingBot();
        const output = await callBotTool(callerFor(user, grant, bot, scopes), name, args, signal);
        // A long poll can outlive a revocation; its eventual response must observe it too.
        if (!q.get("SELECT 1 FROM team_mcp_keys WHERE user_id=? AND id=?", user.id, grant.id))
          return refused("Accès révoqué.");
        return output;
      });
    }),
  );
  api.on(
    ["GET", "DELETE"],
    "/v1/team/mcp",
    handleApiRequest((c) => {
      authenticate(c);
      return c.json({ error: "Method not allowed.", code: "method" }, 405, { allow: "POST" });
    }),
  );
}
export function registerTeamMcpOwner(api: Hono<any>) {
  api.get(
    "/team-mcp",
    handleApiRequest((c) => {
      const grant = current(c.get("user").id);
      return c.json({ grant: grant ? view(grant) : null });
    }),
  );
  api.post(
    "/team-mcp",
    handleApiRequest(async (c) => {
      const owner: UserRecord = c.get("user"),
        body = await c.req.json().catch(() => null);
      const scopes = cleanScopes(body?.scopes);
      if (!scopes.length || !Array.isArray(body?.scopes) || scopes.length !== new Set(body.scopes).size)
        throw new BotApiError(400, "scope", "Choisis les autorisations de ce client.");
      const id = newId("team"),
        secret = TEAM_SECRET_PREFIX + randomBytes(32).toString("base64url");
      const inserted = q.run(
        "INSERT INTO team_mcp_keys(user_id,id,key_hash,scopes,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING",
        owner.id,
        id,
        sha256(secret),
        JSON.stringify(scopes),
        now(),
      );
      if (!inserted.changes)
        throw new BotApiError(
          409,
          "already_connected",
          "Un accès existe déjà. Révoque-le avant de le remplacer.",
        );
      audit(
        owner.id,
        "channel",
        "Création d’un accès Claude Code à l’équipe (" + scopes.join(", ") + ").",
      );
      return c.json({ grant: view(current(owner.id)!), secret }, 201);
    }),
  );
  api.delete(
    "/team-mcp",
    handleApiRequest(async (c) => {
      const owner: UserRecord = c.get("user"),
        body = await c.req.json().catch(() => null);
      if (
        typeof body?.id !== "string" ||
        !q.run("DELETE FROM team_mcp_keys WHERE user_id=? AND id=?", owner.id, body.id).changes
      )
        throw new BotApiError(404, "not_found", "Accès introuvable.");
      audit(owner.id, "channel", "Révocation de l’accès Claude Code à l’équipe.");
      return c.json({ grant: null });
    }),
  );
}
