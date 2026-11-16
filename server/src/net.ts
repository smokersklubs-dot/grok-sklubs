import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * Outgoing requests to addresses a bot, a page or a user chose (web_fetch, watched pages, connectors and
 * their sign-in, generated pictures) must never reach this server's own network: its loopback, the
 * private ranges a VPS or a cloud provider uses, the cloud metadata service (169.254.169.254)…
 *
 * guardedFetch() works like fetch(), with three differences:
 *  - every address a name resolves to is checked, at connection time (Node's `lookup` hook of
 *    http.request), so the name cannot point somewhere else between the check and the connection;
 *  - redirects are followed by hand, each hop checked again;
 *  - an address literal (http://10.0.0.1/) is checked before anything is sent.
 * ALLOW_PRIVATE_FETCH=1 lifts the address check (local testing against servers on this machine).
 */

export class BlockedAddressError extends Error {
  constructor(host: string) { super(`${host} is on a private or local network, which this server does not reach`); this.name = "BlockedAddressError"; }
}

const allowPrivate = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

const blocked = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  // IPv4-mapped addresses (::ffff:a.b.c.d) need no rule of their own: BlockList checks them against the IPv4
  // rules above (and an ::ffff:0:0/96 rule would wrongly match every IPv4 address).
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(a, p, "ipv6");

/**
 * True for loopback, private (RFC 1918), carrier-grade NAT, link-local (cloud metadata), unique-local,
 * multicast, unspecified, documentation and reserved addresses — and for IPv6 forms that embed an IPv4
 * address (mapped, NAT64, 6to4, Teredo), which could otherwise smuggle one of the above.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) return blocked.check(ip, "ipv6");
  return true; // not an address at all: refuse
}

const bare = (hostname: string) => hostname.replace(/^\[|\]$/g, "");

/** Throws when an address literal in the URL is private. Names are checked when they are resolved. */
function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("only http and https addresses can be fetched");
  if (allowPrivate()) return;
  const host = bare(url.hostname);
  if (net.isIP(host) && isPrivateAddress(host)) throw new BlockedAddressError(host);
}

/** Resolves a name like the default lookup, and refuses it when any of its addresses is private. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: Error) => void)(err);
    const list = addresses as unknown as dns.LookupAddress[];
    if (!list.length) return (callback as (e: Error) => void)(new Error(`${hostname} has no address`));
    if (!allowPrivate() && list.some((a) => isPrivateAddress(a.address))) return (callback as (e: Error) => void)(new BlockedAddressError(hostname));
    if ((options as dns.LookupOptions).all) (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    else (callback as (e: null, a: string, f: number) => void)(null, list[0].address, list[0].family);
  });
};

/** Checks a URL the way guardedFetch would, without fetching it (for addresses handed to a browser). */
export async function assertPublicUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  checkUrl(url);
  if (allowPrivate() || net.isIP(bare(url.hostname))) return;
  const list = await dns.promises.lookup(bare(url.hostname), { all: true });
  if (list.some((a) => isPrivateAddress(a.address))) throw new BlockedAddressError(url.hostname);
}

interface Hop { method: string; headers: Headers; body: Buffer | undefined; signal: AbortSignal | undefined }

function once(url: URL, hop: Hop): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    hop.headers.forEach((v, k) => { headers[k] = v; });
    if (hop.body) headers["content-length"] = String(hop.body.length);
    const req = (url.protocol === "https:" ? https : http).request({
      protocol: url.protocol, hostname: bare(url.hostname), port: url.port || undefined, path: `${url.pathname}${url.search}`,
      // A fresh connection every time (no pool), so every request goes through the address check.
      method: hop.method, headers, lookup: guardedLookup, signal: hop.signal, agent: false,
    }, (res) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue;
        for (const one of Array.isArray(v) ? v : [v]) out.append(k, String(one));
      }
      const status = res.statusCode ?? 502;
      const noBody = hop.method === "HEAD" || [101, 103, 204, 205, 304].includes(status);
      if (noBody) res.resume();
      // Like fetch, hand back the body decoded (we never ask for compression, but some servers send it anyway).
      const coding = (res.headers["content-encoding"] ?? "").toLowerCase().trim();
      const decoder = coding === "gzip" || coding === "x-gzip" ? zlib.createGunzip() : coding === "deflate" ? zlib.createInflate() : coding === "br" ? zlib.createBrotliDecompress() : null;
      let stream: Readable = res;
      if (decoder && !noBody) { stream = res.pipe(decoder); res.on("error", (e) => decoder.destroy(e)); out.delete("content-encoding"); out.delete("content-length"); }
      const response = new Response(noBody ? null : (Readable.toWeb(stream) as unknown as ReadableStream), { status: status < 200 ? 502 : status, statusText: res.statusMessage ?? "", headers: out });
      Object.defineProperty(response, "url", { value: url.toString() });
      resolve(response);
    });
    req.on("error", reject);
    req.end(hop.body);
  });
}

/** fetch(), restricted to public addresses (see above). Accepts what the MCP SDK and our callers pass. */
export async function guardedFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  // Let the platform normalise method, headers and body exactly as fetch would.
  const request = new Request(input, init);
  const mode = init.redirect ?? (input instanceof Request ? input.redirect : "follow");
  let url = new URL(request.url);
  const hop: Hop = {
    method: request.method, headers: new Headers(request.headers),
    body: request.body ? Buffer.from(await request.arrayBuffer()) : undefined, signal: init.signal ?? undefined,
  };
  if (!hop.headers.has("accept")) hop.headers.set("accept", "*/*");
  if (!hop.headers.has("user-agent")) hop.headers.set("user-agent", "sklubot");
  for (let hops = 0; hops <= 10; hops++) {
    checkUrl(url);
    const res = await once(url, hop);
    const location = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location || mode === "manual") return res;
    await res.body?.cancel().catch(() => {});
    if (mode === "error") throw new TypeError(`redirected from ${url.origin}`);
    const next = new URL(location, url);
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && hop.method === "POST")) {
      hop.method = hop.method === "HEAD" ? "HEAD" : "GET";
      hop.body = undefined;
      for (const h of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) hop.headers.delete(h);
    }
    // Like fetch: credentials do not follow a redirect to another site.
    if (next.origin !== url.origin) { hop.headers.delete("authorization"); hop.headers.delete("cookie"); }
    url = next;
  }
  throw new TypeError("too many redirects");
}

/** Short, safe wording for a failed outgoing request: never the remote server's own error page. */
export function fetchProblem(err: unknown): string | null {
  if (err instanceof BlockedAddressError) return "That address is on a private or local network, which this server does not reach.";
  const e = err as { name?: string; cause?: { code?: string }; code?: string } | null;
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "The request took too long.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "That address could not be found.";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EHOSTUNREACH") return "That server could not be reached.";
  return null;
}

// ── The visitor's address behind our reverse proxy (L1) ──────────────────────
/**
 * TRUSTED_PROXIES: the addresses (or CIDR ranges) of the reverse proxy in front of Sklubot. Empty: any loopback or
 * private address (Caddy or Coolify's proxy reach Sklubot on a Docker network, always from such an address).
 */
const trustedList = (() => {
  const list = new net.BlockList();
  let any = false;
  for (const raw of (process.env.TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [addr, bits] = raw.split("/");
    const family = net.isIP(addr);
    if (!family) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (bits !== undefined && /^\d+$/.test(bits)) list.addSubnet(addr, Number(bits), type); else list.addAddress(addr, type);
    any = true;
  }
  return any ? list : null;
})();
const plainAddress = (ip: string) => ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
/** Whether a connection comes from the reverse proxy we trust (see TRUSTED_PROXIES above). */
export function fromTrustedProxy(remote: string | undefined): boolean {
  if (!remote) return false;
  const ip = plainAddress(remote);
  const family = net.isIP(ip);
  if (!family) return false;
  if (trustedList) return trustedList.check(ip, family === 4 ? "ipv4" : "ipv6");
  return isPrivateAddress(ip);
}
/**
 * The client's address. With TRUST_PROXY=1, and only when the connection itself comes from the trusted proxy, the last
 * X-Forwarded-For entry (the one the proxy added; earlier entries come from the client). Otherwise the connection's own
 * address: someone reaching the server directly cannot pick the address it is counted under.
 */
export function clientAddress(trustProxy: boolean, remote: string | undefined, forwardedFor: string | undefined): string {
  // No connection at all: a request made inside this process (tests), which no one on the network can send.
  if (trustProxy && (remote === undefined || fromTrustedProxy(remote))) {
    const last = String(forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return remote ?? "local";
}
