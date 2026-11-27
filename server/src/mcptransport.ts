/*
 * Portions adapted from n8n-io/nod (https://github.com/n8n-io/nod, commit 0f9de28af967ad6f7be12a3181edcef860216328),
 * Copyright 2026 n8n GmbH, Apache License 2.0; modified for Sklubot: connectRemoteMcp of
 * src/providers/discovered/remote.ts (try the Streamable HTTP transport, fall back to the older HTTP+SSE transport on a
 * 4xx answer other than 401/403, keep the first error when the fallback fails too, no redirects) and the "owner address"
 * idea of the same file (a private address only when the owner typed it, the token sent only there) rewritten for
 * Sklubot's connector records, guarded fetch, OAuth provider and hosted mode.
 *
 * nod audit items 10 (HTTP+SSE fallback) and 17 / row 64 (a private MCP address the user typed, self-hosted only).
 * MCP transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports (Streamable HTTP; "Backwards
 * compatibility": a client tries POST first and, on 400 / 404 / 405, opens the old SSE endpoint with GET).
 */
import net from "node:net";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { q } from "./db.js";
import { hostedMode } from "./hosted.js";
import { guardedFetch, isPrivateAddress } from "./net.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Whether a failed Streamable HTTP connection may be tried again with HTTP+SSE: a 4xx answer, never 401 / 403. */
export function shouldFallBack(err: unknown): boolean {
  const status: unknown = Object(err).code;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 401 && status !== 403;
}

/**
 * Connects `make()`'s client with Streamable HTTP, then HTTP+SSE when the server refuses the newer transport. Returns
 * which transport worked. The same headers, sign-in and fetch (address checks) apply to both.
 */
export async function connectWithFallback(make: () => Client, url: URL, opts: { authProvider?: OAuthClientProvider; headers?: Record<string, string>; fetch: FetchFn }): Promise<{ client: Client; transport: "streamable" | "sse" }> {
  const requestInit = opts.headers ? { headers: opts.headers } : undefined;
  const client = make();
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: opts.authProvider, requestInit, fetch: opts.fetch }));
    return { client, transport: "streamable" };
  } catch (cause) {
    await client.close().catch(() => {});
    if (!shouldFallBack(cause)) throw cause;
    const legacy = make();
    try {
      await legacy.connect(new SSEClientTransport(url, { authProvider: opts.authProvider, requestInit, fetch: opts.fetch}));
      return { client: legacy, transport: "sse" };
    } catch {
      await legacy.close().catch(() => {});
      throw cause;
    }
  }
}

// ── Private addresses the user typed (item 17) ─────────────────────────────────────────────────────────────────────
q.run(`CREATE TABLE IF NOT EXISTS connector_private (connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE, origin TEXT NOT NULL)`);

export class PrivateAddressError extends Error {}

/** localhost, a LAN or Tailscale address, a .local / .lan / .home.arpa / .ts.net name: an address on the user's own network. */
export function looksPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (net.isIP(host)) return isPrivateAddress(host) && host !== "0.0.0.0" && host !== "::";
  return /\.(local|lan|home\.arpa|internal|ts\.net)$/.test(host) || !host.includes(".");
}

/**
 * A private address for an MCP connector, typed by the user in the app (never proposed by a bot: no tool reaches
 * this). Refused in hosted mode (the server's own network belongs to the operator). Returns the origin it is bound to.
 */
export function checkPrivateConnectorUrl(raw: string): string {
  if (hostedMode()) throw new PrivateAddressError("A private network address is only possible on a Sklubot you host yourself.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new PrivateAddressError("That does not look like a valid URL."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new PrivateAddressError("Use an http:// or https:// address without a name or password in it.");
  if (!looksPrivateHost(url.hostname)) throw new PrivateAddressError("This address is not on a private network: add it as a normal app.");
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && /^(169\.254\.|fe80:)/i.test(url.hostname.replace(/^\[|\]$/g, ""))) throw new PrivateAddressError("Link-local addresses (cloud metadata) are never reachable.");
  return url.origin;
}
export const privateConnectors = {
  allow: (connectorId: string, origin: string) => q.run("INSERT OR REPLACE INTO connector_private (connector_id, origin) VALUES (?, ?)", connectorId, origin),
  originOf: (connectorId: string): string | null => q.get<{ origin: string }>("SELECT origin FROM connector_private WHERE connector_id = ?", connectorId)?.origin ?? null,
};

/**
 * The fetch a connector uses: the guarded one (public addresses only), or — for a private address the user typed, on
 * a self-hosted server — one bound to that exact origin: no redirect, nothing else reachable, so its token goes there only.
 */
export function fetchForConnector(connectorId: string): FetchFn {
  const origin = hostedMode() ? null : privateConnectors.originOf(connectorId);
  if (!origin) return guardedFetch;
  return async (input, init = {}) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== origin) throw new PrivateAddressError("This connector may only reach the address you typed.");
    return fetch(request, { redirect: "error" });
  };
}
