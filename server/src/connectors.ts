import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { seal, unseal } from "./auth.js";
import { newId, now } from "./store.js";
import type { ToolSpec } from "./llm/types.js";
import type { Connector } from "./shared.js";

/**
 * A connector is a remote tool server speaking the open Model Context Protocol over HTTP.
 * Any app that offers such an endpoint (many do, directly or through a gateway) can be plugged in.
 */

interface LiveConnector { client: Client; tools: { name: string; description: string; readOnly: boolean; schema: ToolSpec["inputSchema"] }[] }
interface Entry { record: ConnectorRecord; live: LiveConnector | null; error: string | null; connecting: Promise<void> | null }
interface ConnectorRecord { id: string; userId: string; name: string; url: string; tokenEnc: string | null }

const entries = new Map<string, Entry>();
const toRecord = (r: any): ConnectorRecord => ({ id: r.id, userId: r.user_id, name: r.name, url: r.url, tokenEnc: r.token_enc });

const READ_WORDS = new Set(["get", "list", "search", "fetch", "find", "read", "retrieve", "query", "lookup", "check", "describe", "view", "count", "show"]);
/** A tool is treated as read-only when the server says so, or when its name reads like a lookup. */
export function looksReadOnly(name: string, hint?: boolean): boolean {
  if (hint !== undefined) return hint;
  return name.split(/[^a-zA-Z0-9]+|(?<=[a-z])(?=[A-Z])/).some((word) => READ_WORDS.has(word.toLowerCase()));
}

async function connect(entry: Entry) {
  const { record } = entry;
  const token = record.tokenEnc ? unseal(record.tokenEnc) : null;
  const transport = new StreamableHTTPClientTransport(new URL(record.url), {
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name: "sklubot", version: "0.1.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  entry.live = {
    client,
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: (t.description ?? "").slice(0, 1000),
      readOnly: looksReadOnly(t.name, t.annotations?.readOnlyHint),
      schema: { type: "object", properties: (t.inputSchema?.properties ?? {}) as Record<string, unknown>, required: t.inputSchema?.required },
    })),
  };
  entry.error = null;
}

function ensure(record: ConnectorRecord): Entry {
  let entry = entries.get(record.id);
  if (!entry) entries.set(record.id, (entry = { record, live: null, error: null, connecting: null }));
  if (!entry.live && !entry.connecting) {
    entry.connecting = connect(entry)
      .catch((err) => { entry.error = String(err?.message ?? err).slice(0, 300); })
      .finally(() => { entry.connecting = null; emit(record.userId, { type: "connectors" }); });
  }
  return entry;
}

const view = (e: Entry): Connector => ({
  id: e.record.id, name: e.record.name, url: e.record.url, hasToken: !!e.record.tokenEnc,
  status: e.live ? "ready" : e.connecting ? "connecting" : "error", error: e.live ? null : e.error,
  tools: (e.live?.tools ?? []).map(({ name, description, readOnly }) => ({ name, description, readOnly })),
});

const recordsFor = (userId: string) => q.all("SELECT * FROM connectors WHERE user_id = ? ORDER BY created_at", userId).map(toRecord);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "app";

export const connectors = {
  list: (userId: string): Connector[] => recordsFor(userId).map((r) => view(ensure(r))),
  async add(userId: string, name: string, url: string, token?: string): Promise<Connector> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("That does not look like a valid URL."); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Connector URLs must start with http:// or https://");
    const id = newId("con");
    q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, userId, name.trim().slice(0, 60) || parsed.hostname, parsed.toString(), token ? seal(token) : null, now());
    const entry = ensure(toRecord(q.get("SELECT * FROM connectors WHERE id = ?", id)));
    await entry.connecting;
    return view(entry);
  },
  async refresh(userId: string, id: string): Promise<Connector | null> {
    const r = q.get("SELECT * FROM connectors WHERE id = ? AND user_id = ?", id, userId);
    if (!r) return null;
    await connectors.drop(id);
    const entry = ensure(toRecord(r));
    await entry.connecting;
    return view(entry);
  },
  async drop(id: string) {
    const entry = entries.get(id);
    entries.delete(id);
    try { await entry?.live?.client.close(); } catch { /* closing a dead connection is fine */ }
  },
  async remove(userId: string, id: string) {
    q.run("DELETE FROM connectors WHERE id = ? AND user_id = ?", id, userId);
    await connectors.drop(id);
    emit(userId, { type: "connectors" });
  },
  closeAll: () => Promise.all([...entries.keys()].map((id) => connectors.drop(id))),
  /** Tools from every ready connector, namespaced so two servers can expose the same tool name. */
  async toolsFor(userId: string): Promise<{ spec: ToolSpec; connectorId: string; connectorName: string; remoteName: string; readOnly: boolean }[]> {
    const out = [];
    for (const record of recordsFor(userId)) {
      const entry = ensure(record);
      if (entry.connecting) await entry.connecting;
      for (const t of entry.live?.tools ?? []) {
        out.push({
          spec: { name: `app_${slug(record.name)}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), description: `[${record.name}] ${t.description}`, inputSchema: t.schema },
          connectorId: record.id, connectorName: record.name, remoteName: t.name, readOnly: t.readOnly,
        });
      }
    }
    return out;
  },
  async call(connectorId: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const entry = entries.get(connectorId);
    if (!entry?.live) throw new Error("this connector is not connected right now");
    const res = await entry.live.client.callTool({ name: tool, arguments: args });
    const parts = Array.isArray(res.content) ? res.content : [];
    const text = parts.map((p: any) => (p.type === "text" ? p.text : `[${p.type} content]`)).join("\n") || JSON.stringify(res.structuredContent ?? {});
    return { text: text.length > 60_000 ? text.slice(0, 60_000) + "\n…[truncated]" : text, isError: res.isError === true };
  },
};
