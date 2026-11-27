/**
 * L159 « connecteurs pour tous mes bots » (backlog A-FAIRE L159; behaviour from the Noah audit: "a connection made on one
 * agent is valid for all, except those you untick" — our own code).
 *
 * An app (MCP connector, connectors.ts) belongs to the account. By default it serves ALL the owner's bots (as before):
 * each bot can be unticked. Or the owner switches it to « seulement les bots choisis » and ticks the ones that may use
 * it. A bot that may not use an app never sees its tools (connectors.toolsFor) and cannot call it (connectors.call).
 * Bots created later follow the app's choice: with « tous mes bots » they get it, with « choisis » they do not.
 */
import { q } from "./db.js";
import { now } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS connector_bot_scope (connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE, user_id TEXT NOT NULL, all_bots INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS connector_bot_choice (connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, allowed INTEGER NOT NULL, PRIMARY KEY (connector_id, bot_id))`);

export interface ConnectorBotAccess { allBots: boolean; /** Bots that differ from the default: unticked when allBots, ticked otherwise. */ bots: Record<string, boolean> }

export function connectorBotAccess(connectorId: string): ConnectorBotAccess {
  const scope = q.get<{ all_bots: number }>("SELECT all_bots FROM connector_bot_scope WHERE connector_id = ?", connectorId);
  const bots: Record<string, boolean> = {};
  for (const r of q.all<{ bot_id: string; allowed: number }>("SELECT bot_id, allowed FROM connector_bot_choice WHERE connector_id = ?", connectorId)) bots[r.bot_id] = r.allowed === 1;
  return { allBots: scope ? scope.all_bots === 1 : true, bots };
}

/** May this bot use this app? No bot (a call outside any turn) keeps the account-wide behaviour. */
export function connectorAllowedFor(connectorId: string, botId: string | null | undefined): boolean {
  if (!botId) return true;
  const a = connectorBotAccess(connectorId);
  const own = a.bots[botId];
  return a.allBots ? own !== false : own === true;
}

/**
 * Saves the choice. `bots` maps the owner's bot ids to allowed or not; ids of other accounts are ignored (the caller
 * passes the owner's bot ids in `ownBots`). Only the differences from the default are kept.
 */
export function setConnectorBotAccess(userId: string, connectorId: string, allBots: boolean, bots: Record<string, unknown>, ownBots: Set<string>): ConnectorBotAccess {
  q.tx(() => {
    q.run("INSERT INTO connector_bot_scope (connector_id, user_id, all_bots, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(connector_id) DO UPDATE SET all_bots = excluded.all_bots, updated_at = excluded.updated_at", connectorId, userId, allBots ? 1 : 0, now());
    q.run("DELETE FROM connector_bot_choice WHERE connector_id = ?", connectorId);
    for (const [botId, v] of Object.entries(bots ?? {})) {
      if (!ownBots.has(botId) || typeof v !== "boolean") continue;
      if (v === allBots) continue; // same as the default: nothing to keep
      q.run("INSERT INTO connector_bot_choice (connector_id, bot_id, allowed) VALUES (?, ?, ?)", connectorId, botId, v ? 1 : 0);
    }
  });
  return connectorBotAccess(connectorId);
}

/** The ids of the bots that may use the app, among `botIds` (for the settings list). */
export const botsAllowed = (connectorId: string, botIds: string[]) => botIds.filter((b) => connectorAllowedFor(connectorId, b));
