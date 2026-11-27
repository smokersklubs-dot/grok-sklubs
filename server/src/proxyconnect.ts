import net from "node:net";
import tls from "node:tls";

/**
 * L169 — opening a connection to a site THROUGH a proxy the owner gave for a bot (botroute.ts). No library: the two
 * protocols are small and written from their specifications.
 *
 *  - HTTP proxy (http:// or https:// proxy address): the CONNECT method, RFC 9110 §9.3.6 — the client sends
 *    `CONNECT host:port HTTP/1.1` with `Host: host:port`, and any 2xx answer turns the connection into a tunnel.
 *    Credentials: `Proxy-Authorization: Basic base64(user:password)` (RFC 9110 §11.7.2 and the Basic scheme of
 *    RFC 7617 §2). A 407 answer means the proxy wants (other) credentials (RFC 9110 §15.5.8).
 *  - SOCKS5 proxy (socks5:// address): RFC 1928 (greeting, CONNECT command 0x01, address type 0x03 = domain name so the
 *    PROXY resolves the name, like curl's socks5h) and RFC 1929 (username/password sub-negotiation, method 0x02).
 *
 * The tunnel is plain TCP to the site; the caller adds TLS itself for https sites (net.ts), so the proxy never sees the
 * page, only the site's name and port.
 */

export type ProxyScheme = "http" | "https" | "socks5";
export interface ProxySpec { scheme: ProxyScheme; host: string; port: number; username?: string; password?: string }

/** A failure the owner can act on: `code` is stable (the UI words it), `message` is English for the logs. */
export class ProxyError extends Error {
  constructor(public code: "unreachable" | "auth" | "refused" | "timeout" | "protocol" | "tls", message: string) { super(message); this.name = "ProxyError"; }
}

const TIMEOUT_MS = 15_000;
const MAX_HEAD = 16 * 1024;

/** Reads from the socket until `done(buffer)` returns a length (bytes consumed); what is left is pushed back. */
function readUntil(sock: net.Socket, done: (b: Buffer) => number | null, ms: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new ProxyError("timeout", "the proxy did not answer in time")), ms);
    const finish = (err: Error | null, out?: Buffer) => {
      clearTimeout(timer); sock.off("data", onData); sock.off("error", onError); sock.off("close", onClose);
      if (err) reject(err); else resolve(out!);
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const used = done(buf);
      if (used !== null) { sock.pause(); const rest = buf.subarray(used); if (rest.length) sock.unshift(rest); return finish(null, buf.subarray(0, used)); }
      if (buf.length > MAX_HEAD) finish(new ProxyError("protocol", "the proxy's answer is too long"));
    };
    const onError = (e: Error) => finish(new ProxyError("unreachable", e.message));
    const onClose = () => finish(new ProxyError("refused", "the proxy closed the connection"));
    sock.on("data", onData); sock.on("error", onError); sock.on("close", onClose);
    sock.resume();
  });
}

/** Opens the TCP (or TLS, for an https:// proxy) connection to the proxy itself. */
function dialProxy(p: ProxySpec, signal?: AbortSignal): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock: net.Socket = p.scheme === "https" ? tls.connect({ host: p.host, port: p.port, servername: net.isIP(p.host) ? undefined : p.host }) : net.connect({ host: p.host, port: p.port });
    const ready = p.scheme === "https" ? "secureConnect" : "connect";
    const timer = setTimeout(() => { sock.destroy(); reject(new ProxyError("timeout", "the proxy could not be reached in time")); }, TIMEOUT_MS);
    const onAbort = () => { sock.destroy(); clearTimeout(timer); reject(new ProxyError("timeout", "stopped")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    sock.once(ready, () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(sock); });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      reject(new ProxyError(p.scheme === "https" && /certificate|SSL|TLS/i.test(e.message) ? "tls" : "unreachable", e.message));
    });
  });
}

const hostForConnect = (host: string) => (net.isIP(host) === 6 ? `[${host}]` : host);

/** HTTP CONNECT (RFC 9110 §9.3.6). */
async function httpConnect(sock: net.Socket, p: ProxySpec, host: string, port: number): Promise<void> {
  const target = `${hostForConnect(host)}:${port}`;
  const auth = p.username !== undefined && p.username !== "" ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${p.password ?? ""}`).toString("base64")}\r\n` : "";
  sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
  const head = await readUntil(sock, (b) => { const i = b.indexOf("\r\n\r\n"); return i < 0 ? null : i + 4; }, TIMEOUT_MS);
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.toString("latin1"))?.[1] ?? 0);
  if (status >= 200 && status < 300) return;
  if (status === 407) throw new ProxyError("auth", "the proxy refused the user name or password (407)");
  if (!status) throw new ProxyError("protocol", "the proxy's answer is not HTTP: is it really an HTTP proxy?");
  throw new ProxyError("refused", `the proxy refused to open ${target} (${status})`);
}

/** SOCKS5 (RFC 1928) with username/password (RFC 1929). */
async function socks5Connect(sock: net.Socket, p: ProxySpec, host: string, port: number): Promise<void> {
  const withAuth = p.username !== undefined && p.username !== "";
  // Greeting: VER 5, NMETHODS, METHODS (0x00 no auth, 0x02 username/password).
  sock.write(Buffer.from(withAuth ? [5, 2, 0, 2] : [5, 1, 0]));
  const choice = await readUntil(sock, (b) => (b.length >= 2 ? 2 : null), TIMEOUT_MS);
  if (choice[0] !== 5) throw new ProxyError("protocol", "the proxy's answer is not SOCKS5: is it really a SOCKS5 proxy?");
  if (choice[1] === 0xff) throw new ProxyError("auth", withAuth ? "the proxy accepts none of our sign-in methods" : "the proxy wants a user name and password");
  if (choice[1] === 2) {
    if (!withAuth) throw new ProxyError("auth", "the proxy wants a user name and password");
    const u = Buffer.from(p.username!, "utf8"), w = Buffer.from(p.password ?? "", "utf8");
    if (u.length > 255 || w.length > 255) throw new ProxyError("auth", "user name or password too long for SOCKS5 (255 bytes)");
    sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([w.length]), w]));
    const ok = await readUntil(sock, (b) => (b.length >= 2 ? 2 : null), TIMEOUT_MS);
    if (ok[1] !== 0) throw new ProxyError("auth", "the proxy refused the user name or password");
  } else if (choice[1] !== 0) throw new ProxyError("protocol", "the proxy chose an unknown sign-in method");
  // CONNECT request: VER 5, CMD 1, RSV 0, ATYP (1 IPv4, 3 domain, 4 IPv6), address, port (big-endian).
  const family = net.isIP(host);
  let addr: Buffer;
  if (family === 4) addr = Buffer.from([1, ...host.split(".").map(Number)]);
  else if (family === 6) addr = Buffer.concat([Buffer.from([4]), ipv6Bytes(host)]);
  else { const h = Buffer.from(host, "ascii"); if (h.length > 255) throw new ProxyError("protocol", "site name too long"); addr = Buffer.concat([Buffer.from([3, h.length]), h]); }
  sock.write(Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 0xff])]));
  const reply = await readUntil(sock, (b) => {
    if (b.length < 5) return null;
    const len = b[3] === 1 ? 4 : b[3] === 4 ? 16 : b[3] === 3 ? 1 + b[4] : -1;
    if (len < 0) return b.length;
    return b.length >= 4 + len + 2 ? 4 + len + 2 : null;
  }, TIMEOUT_MS);
  if (reply[1] === 0) return;
  // REP codes, RFC 1928 §6.
  const why: Record<number, string> = { 1: "general failure", 2: "not allowed by the proxy's rules", 3: "network unreachable", 4: "site unreachable", 5: "connection refused by the site", 6: "TTL expired", 7: "command not supported", 8: "address type not supported" };
  throw new ProxyError("refused", `the proxy could not open ${host}:${port} (${why[reply[1]] ?? `code ${reply[1]}`})`);
}

function ipv6Bytes(ip: string): Buffer {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  const parts = [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  return Buffer.from(parts.flatMap((x) => { const n = parseInt(x || "0", 16); return [n >> 8, n & 0xff]; }));
}

/** A plain TCP tunnel to host:port through the proxy (the caller adds TLS for https sites). */
export async function connectThrough(p: ProxySpec, host: string, port: number, signal?: AbortSignal): Promise<net.Socket> {
  const sock = await dialProxy(p, signal);
  try {
    if (p.scheme === "socks5") await socks5Connect(sock, p, host, port); else await httpConnect(sock, p, host, port);
    return sock;
  } catch (e) { sock.destroy(); throw e; }
}

/** Reads « http://user:pass@host:port », « socks5://host:1080 », « host:port » (http by default). Null when unreadable. */
export function parseProxyAddress(raw: unknown): ProxySpec | null {
  let text = String(raw ?? "").trim();
  if (!text || text.length > 500 || /\s/.test(text)) return null;
  if (!/^[a-z0-9]+:\/\//i.test(text)) text = `http://${text}`;
  let u: URL;
  try { u = new URL(text); } catch { return null; }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase().replace(/^socks5h$/, "socks5");
  if (scheme !== "http" && scheme !== "https" && scheme !== "socks5") return null;
  if ((u.pathname && u.pathname !== "/") || u.search || u.hash) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return null;
  const port = u.port ? Number(u.port) : scheme === "socks5" ? 1080 : scheme === "https" ? 443 : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const spec: ProxySpec = { scheme, host, port };
  if (u.username) { spec.username = decodeURIComponent(u.username); spec.password = decodeURIComponent(u.password); }
  return spec;
}

/** The address without credentials, as shown back to the owner (never the password). */
export const proxyLabel = (p: Pick<ProxySpec, "scheme" | "host" | "port">) => `${p.scheme}://${hostForConnect(p.host)}:${p.port}`;
