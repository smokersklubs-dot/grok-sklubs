import dns from "node:dns";
import net from "node:net";
import { hostedMode, isOperator } from "./hosted.js";
import { assertPublicUrl, guardedFetch } from "./net.js";
import { mediaKeys } from "./mediakeys.js";
import { liveDevice, relayRequest, devices, labelOf, type RelayBot } from "./relay.js";
import { createMcpClient, DEFAULT_WAN2GP_PORT, type FetchLike, type Wan2gpClient } from "./wan2gp.js";

/**
 * Where the owner's Wan2GP runs (audit Open Generative AI §1.3, §5 item 7) — always a machine with a GPU the owner
 * controls, never one of ours, and free for them:
 *
 *  - "relay": their own PC, through their Sklubot Relais (protocol §17, op `gpu.http`). The Relais only ever talks to
 *    127.0.0.1 on that PC, asks on its own screen the first time a bot uses it, and Stop locks it like everything else.
 *  - "url": a Wan2GP server address the owner typed. Self-hosted Sklubot only: a hosted server never reaches into a
 *    private network on behalf of an account (that would let one account probe the operator's network). On a
 *    self-hosted server, only the instance's owner (or an operator) may give a private (LAN, loopback) address; another
 *    account may give a public address only. Link-local and cloud-metadata addresses (169.254.0.0/16, fe80::/10) are
 *    always refused; redirects are refused.
 */
export type Wan2gpTarget = { mode: "relay"; deviceId: string; port: number; label: string } | { mode: "url"; url: string; label: string };

export class Wan2gpSetupError extends Error { constructor(public status: 400 | 404, message: string) { super(message); } }

const metaBlock = new net.BlockList();
metaBlock.addSubnet("169.254.0.0", 16, "ipv4");
metaBlock.addSubnet("0.0.0.0", 8, "ipv4");
metaBlock.addSubnet("224.0.0.0", 4, "ipv4");
metaBlock.addSubnet("fe80::", 10, "ipv6");
metaBlock.addSubnet("ff00::", 8, "ipv6");
const refusedAddress = (ip: string) => { const f = net.isIP(ip); return f === 4 ? metaBlock.check(ip, "ipv4") : f === 6 ? metaBlock.check(ip, "ipv6") : true; };

/** Checks a Wan2GP server address the owner typed (throws a sentence for them). */
export async function checkWan2gpUrl(raw: string, userId: string): Promise<string> {
  if (hostedMode()) throw new Wan2gpSetupError(400, "On this hosted service, Wan2GP runs on your own computer through the Sklubot Relais: choose your computer instead of an address.");
  let u: URL;
  try { u = new URL(raw); } catch { throw new Wan2gpSetupError(400, "Give the full address (https://…)."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Wan2gpSetupError(400, "Give the full address (https://…).");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw new Wan2gpSetupError(400, "This address cannot be found.");
  if (ips.some(refusedAddress)) throw new Wan2gpSetupError(400, "This address is refused (link-local or cloud metadata).");
  if (!isOperator(userId)) await assertPublicUrl(u.toString()).catch(() => { throw new Wan2gpSetupError(400, "Only the owner of this server can use a Wan2GP address on a private network. Use a public address, or your own computer through the Sklubot Relais."); });
  return u.toString().replace(/\/+$/, "");
}

/** fetch for the "url" mode: the address is checked at every call; no redirect is followed. */
export const urlFetch = (userId: string): FetchLike => async (url, init) => {
  await checkWan2gpUrl(url, userId);
  const go = isOperator(userId) ? fetch : guardedFetch;
  return go(url, { method: init.method, headers: init.headers, body: init.body as BodyInit | undefined, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000), redirect: "error" });
};

/** Server → Relais messages stay under 256 KiB (protocol §2): a request body is at most this (the start picture is shrunk to fit). */
export const RELAY_MAX_BODY = 180 * 1024;

/** fetch for the "relay" mode: each request goes to 127.0.0.1:<port> on the owner's PC; long answers come back in pieces. */
export function relayFetch(deviceId: string, port: number, bot: RelayBot, send: typeof relayRequest = relayRequest): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const body = init.body === undefined ? undefined : Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body);
    if (body && body.length > RELAY_MAX_BODY) throw new Error("this request is too large to send through the Relais");
    const args: Record<string, unknown> = { port, method: init.method, path: `${u.pathname}${u.search}`, headers: init.headers ?? {}, ...(body ? { body: body.toString("base64") } : {}) };
    const parts: Buffer[] = [];
    let first: { status: number; headers: Record<string, string> } | null = null;
    for (let hop = 0; hop < 200; hop++) {
      const r = await send(deviceId, bot, "gpu.http", args, { timeoutMs: 180_000, signal: init.signal });
      if (!r.ok) throw Object.assign(new Error(`the Relais answered ${r.code}: ${r.message}`), { relayCode: r.code });
      const res = r.result as { status?: number; headers?: Record<string, string>; data?: string; token?: string | null };
      if (!first) first = { status: Number(res.status) || 502, headers: res.headers ?? {} };
      if (typeof res.data === "string" && res.data) parts.push(Buffer.from(res.data, "base64"));
      if (!res.token) break;
      for (const k of Object.keys(args)) delete args[k];
      Object.assign(args, { port, read: { token: res.token, offset: parts.reduce((n, p) => n + p.length, 0) } });
    }
    const all = Buffer.concat(parts);
    return new Response(all.length ? all : null, { status: first!.status < 200 ? 502 : first!.status, headers: first!.headers });
  };
}

/** The owner's Wan2GP, or null when they did not set one up. */
export function wan2gpTarget(userId: string): Wan2gpTarget | null {
  const s = mediaKeys.secret(userId, "wan2gp");
  if (!s) return null;
  if (s.deviceId) {
    const row = devices.owned(userId, s.deviceId);
    if (!row) return null;
    let port = DEFAULT_WAN2GP_PORT;
    try { if (s.baseUrl) port = Number(new URL(s.baseUrl).port) || DEFAULT_WAN2GP_PORT; } catch { /* default */ }
    return { mode: "relay", deviceId: row.id, port, label: labelOf(row) };
  }
  if (s.baseUrl && !hostedMode()) return { mode: "url", url: s.baseUrl, label: new URL(s.baseUrl).host };
  return null;
}

/** Whether the owner's Wan2GP can answer now (the PC's Relais connected, or an address set). */
export function wan2gpReachable(userId: string, t = wan2gpTarget(userId)): boolean {
  if (!t) return false;
  return t.mode === "url" || !!liveDevice(userId, t.deviceId)?.capabilities.includes("gpu.http");
}

/** A client for the owner's Wan2GP (the PC through the Relais, or the typed address). */
export function wan2gpClient(userId: string, t: Wan2gpTarget, bot: RelayBot): Wan2gpClient {
  return t.mode === "relay" ? createMcpClient(`http://127.0.0.1:${t.port}/mcp`, relayFetch(t.deviceId, t.port, bot)) : createMcpClient(t.url, urlFetch(userId));
}
