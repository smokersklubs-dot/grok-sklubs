/**
 * L184 « événements MCP » (OpenClaw audit E12 — behaviour only, our own code; message names from the MCP specification,
 * https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/logging and …/server/tools#list-changed-notification,
 * …/server/resources#subscriptions).
 *
 * An app (MCP server) can send notices on its own: a log line (`notifications/message`), "my tools changed"
 * (`notifications/tools/list_changed`), "a resource changed" (`notifications/resources/updated` and `…/list_changed`),
 * "my prompts changed". They were dropped; now each is kept (200 per app, 30 days) and shown in the Activity tab of each
 * bot that may use that app (connectorbots.ts). "Tools changed" also re-reads the app's tools, so the bots see the new
 * list at their next turn. The text comes from the outside server: it is plain text, cut to 300 characters, never an
 * instruction (no bot is started by it).
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { LoggingMessageNotificationSchema, PromptListChangedNotificationSchema, ResourceListChangedNotificationSchema, ResourceUpdatedNotificationSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { emit } from "./bus.js";
import { connectorAllowedFor } from "./connectorbots.js";
import { q } from "./db.js";
import { now } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS connector_events (id INTEGER PRIMARY KEY AUTOINCREMENT, connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE, user_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, level TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS connector_events_user ON connector_events (user_id, at)");

export type AppEventKind = "log" | "tools" | "resource" | "resources" | "prompts";
export interface AppEvent { id: number; connectorId: string; name: string; kind: AppEventKind; level: string; text: string; at: number }
const KEEP = 200, KEEP_MS = 30 * 86_400_000;

const plain = (v: unknown) => (typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })()).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

export function recordAppEvent(rec: { id: string; userId: string; name: string }, kind: AppEventKind, text: string, level = "", at = now()) {
  q.run("INSERT INTO connector_events (connector_id, user_id, name, kind, level, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)", rec.id, rec.userId, rec.name, kind, level.slice(0, 12), plain(text), at);
  q.run("DELETE FROM connector_events WHERE connector_id = ? AND (at < ? OR id NOT IN (SELECT id FROM connector_events WHERE connector_id = ? ORDER BY id DESC LIMIT ?))", rec.id, at - KEEP_MS, rec.id, KEEP);
  emit(rec.userId, { type: "connectors" });
}

const rereads = new Map<string, number>();
/** Listens to the app's own notices. `onToolsChanged` re-reads its tools (connectors.ts refresh). */
export function watchAppEvents(rec: { id: string; userId: string; name: string }, client: Pick<Client, "setNotificationHandler">, onToolsChanged: () => void) {
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => recordAppEvent(rec, "log", `${n.params.logger ? `${n.params.logger}: ` : ""}${plain(n.params.data)}`, n.params.level));
  // A server that announces a change at every connection would reconnect forever: one re-read per minute at most.
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => { recordAppEvent(rec, "tools", "tools changed"); const t = Date.now(); if (t - (rereads.get(rec.id) ?? 0) >= 60_000) { rereads.set(rec.id, t); onToolsChanged(); } });
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => recordAppEvent(rec, "resource", n.params.uri));
  client.setNotificationHandler(ResourceListChangedNotificationSchema, () => recordAppEvent(rec, "resources", "resources changed"));
  client.setNotificationHandler(PromptListChangedNotificationSchema, () => recordAppEvent(rec, "prompts", "prompts changed"));
}

/** The latest notices of the apps this bot may use. */
export function appEventsFor(userId: string, botId: string, limit = 50): AppEvent[] {
  return q.all<any>("SELECT * FROM connector_events WHERE user_id = ? ORDER BY id DESC LIMIT 400", userId)
    .filter((r) => connectorAllowedFor(r.connector_id, botId)).slice(0, limit)
    .map((r) => ({ id: r.id, connectorId: r.connector_id, name: r.name, kind: r.kind, level: r.level, text: r.text, at: r.at }));
}
