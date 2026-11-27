import dns from "node:dns";
import type net from "node:net";
import { seal, unseal } from "./auth.js";
import { computerKind } from "./computer.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { hostedMode } from "./hosted.js";
import { localize } from "./lang/index.js";
import { fetchProblem, guardedFetch, isPrivateAddress, BlockedAddressError } from "./net.js";
import { netRefusal, setBrowserPolicyExtra } from "./netpolicy.js";
import { connectThrough, parseProxyAddress, proxyLabel, ProxyError, type ProxySpec } from "./proxyconnect.js";
import { devices, listDevices, relayRequest } from "./relay.js";
import { audit, now, type BotRecord } from "./store.js";
import { canSign, directoryUrl, keyId, signRequest } from "./webbotauth.js";

/**
 * L169 — how a bot's web traffic leaves (« Sortie Internet » in its Security settings). Four exits:
 *   direct     from this server (the default);
 *   proxy      through an HTTP(S) or SOCKS5 proxy the owner gave (proxyconnect.ts); user name and password sealed with the
 *              server's data key like the vault, never sent back to the web page, never written on the bot's computer;
 *   relay      through the owner's own home connection, by their Sklubot Relais (net.fetch, docs/RELAIS-PROTOCOLE.md §19):
 *              the Relais asks on the computer before the first use by each bot, refuses the home network, can be stopped;
 *   tailscale  through the owner's home connection by a Tailscale exit node: the operator runs the official tailscale
 *              container with its SOCKS5 server and `--exit-node` (docs/ORDINATEUR.md « Sortir par la maison »), and sets
 *              TAILSCALE_PROXY (e.g. socks5://tailscale:1055). Self-hosted servers only (one server, one owner).
 *
 * The network policy (netpolicy.ts) applies on top, on every hop of a redirect. What goes through the exit:
 *   - the web tools that fetch from this server: web_fetch, media_save, page_check sheets (botFetch below);
 *   - the bot's browser on its own Linux computer, for proxy and tailscale, when computers reach the server by their
 *     socket (BOT_LINK=socket, the default with a data volume): Chromium's managed policy ProxySettings points at the
 *     socket's port in the computer, and the socket's server opens the tunnel (botforward.ts). Not for relay (the Relais
 *     forwards whole requests, not tunnels), not on a shared computer, not in network mode — said in the settings.
 * Web Bot Auth (webbotauth.ts): per bot, off by default; through relay/tailscale only when the owner also ticked it.
 */

q.run(`CREATE TABLE IF NOT EXISTS bot_egress (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, route TEXT NOT NULL DEFAULT 'direct',
  proxy_scheme TEXT, proxy_host TEXT, proxy_port INTEGER, proxy_user TEXT, proxy_pass TEXT, device_id TEXT,
  sign INTEGER NOT NULL DEFAULT 0, sign_home INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);

export type Route = "direct" | "proxy" | "relay" | "tailscale";
const ROUTES: Route[] = ["direct", "proxy", "relay", "tailscale"];
interface Row { route: string; proxy_scheme: string | null; proxy_host: string | null; proxy_port: number | null; proxy_user: string | null; proxy_pass: string | null; device_id: string | null; sign: number; sign_home: number }

export class RouteError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); this.name = "RouteError"; } }

const FR: Record<string, string> = {
  "Choose how the bot goes out: direct, proxy, home (Relais) or home (Tailscale).": "Choisis comment le bot sort : direct, proxy, maison (Relais) ou maison (Tailscale).",
  "Give the proxy's address, for example socks5://proxy.example.com:1080 or http://proxy.example.com:8080.": "Donne l'adresse du proxy, par exemple socks5://proxy.example.com:1080 ou http://proxy.example.com:8080.",
  "That proxy is on a private or local network, which this server does not reach.": "Ce proxy est sur un réseau privé ou local, que ce serveur ne joint pas.",
  "Choose the computer whose connection the bot uses.": "Choisis l'ordinateur dont le bot utilise la connexion.",
  "That computer is not yours or no longer exists.": "Cet ordinateur n'est pas à toi ou n'existe plus.",
  "Tailscale is not set up on this server (TAILSCALE_PROXY). See « Sortir par la maison » in the guide.": "Tailscale n'est pas installé sur ce serveur (TAILSCALE_PROXY). Vois « Sortir par la maison » dans le guide.",
  "Tailscale exit is only for a server of your own, not a shared one.": "La sortie Tailscale n'existe que sur un serveur à toi, pas sur un serveur partagé.",
  "This server has no public https address, so sites could not check the signature. Set PUBLIC_URL to https://….": "Ce serveur n'a pas d'adresse publique en https : les sites ne pourraient pas vérifier la signature. Mets PUBLIC_URL en https://….",
  "Choose an exit other than « direct » to test it.": "Choisis une sortie autre que « direct » pour la tester.",
  "The proxy refused the user name or password.": "Le proxy refuse le nom d'utilisateur ou le mot de passe.",
  "The proxy could not be reached: check its address and port.": "Le proxy est injoignable : vérifie son adresse et son port.",
  "The proxy did not answer in time.": "Le proxy n'a pas répondu à temps.",
  "The proxy refused to open the site.": "Le proxy a refusé d'ouvrir le site.",
  "That address does not answer like a proxy of this kind: check http, https or socks5.": "Cette adresse ne répond pas comme un proxy de ce type : vérifie http, https ou socks5.",
  "The proxy's certificate is not valid.": "Le certificat du proxy n'est pas valide.",
  "Your computer's Relais is not connected: open Sklubot on it (the computer must stay on).": "Le Relais de ton ordinateur n'est pas connecté : ouvre Sklubot dessus (l'ordinateur doit rester allumé).",
  "Your Relais is too old for this: update Sklubot on your computer.": "Ton Relais est trop ancien pour ça : mets Sklubot à jour sur ton ordinateur.",
  "You said no on your computer.": "Tu as dit non sur ton ordinateur.",
  "The Relais is stopped on your computer: press Resume there.": "Le Relais est arrêté sur ton ordinateur : appuie sur Reprendre là-bas.",
  "Too many requests through your computer: wait a little.": "Trop de demandes par ton ordinateur : attends un peu.",
  "The Relais refused: that address is on your home network.": "Le Relais a refusé : cette adresse est sur ton réseau à la maison.",
  "Your computer did not answer in time.": "Ton ordinateur n'a pas répondu à temps.",
  "The chosen exit is not available any more: choose it again in the bot's settings, or switch to direct.": "La sortie choisie n'est plus disponible : choisis-la de nouveau dans les réglages du bot, ou passe en direct.",
  "The test site could not be reached through this exit.": "Le site de test est injoignable par cette sortie.",
  "That address could not be found.": "Cette adresse est introuvable.",
  "That server could not be reached.": "Ce serveur est injoignable.",
  "The request took too long.": "La demande a pris trop de temps.",
  "That address is on a private or local network, which this server does not reach.": "Cette adresse est sur un réseau privé ou local, que ce serveur ne joint pas.",
};
const say = (locale: string | undefined, en: string) => localize(locale, en, FR);

const get = (botId: string) => q.get<Row>("SELECT * FROM bot_egress WHERE bot_id = ?", botId);
/** TAILSCALE_PROXY: the address of the tailscale container's SOCKS5 or HTTP proxy (set by the operator). */
export const tailscaleSpec = (): ProxySpec | null => (hostedMode() ? null : parseProxyAddress(process.env.TAILSCALE_PROXY ?? ""));
const allowPrivate = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

/** The proxy (with its credentials) a bot's tunnels go through, or null (direct or relay). */
export function tunnelSpec(botId: string): ProxySpec | null {
  const r = get(botId);
  if (!r) return null;
  if (r.route === "tailscale") return tailscaleSpec();
  if (r.route !== "proxy" || !r.proxy_host || !r.proxy_port || !r.proxy_scheme) return null;
  const spec: ProxySpec = { scheme: r.proxy_scheme as ProxySpec["scheme"], host: r.proxy_host, port: r.proxy_port };
  if (r.proxy_user) { spec.username = unseal(r.proxy_user) ?? ""; spec.password = r.proxy_pass ? unseal(r.proxy_pass) ?? "" : ""; }
  return spec;
}

/** Refuses a proxy on this server's own network (a typed address must not turn the proxy into a way in), except Tailscale's. */
async function checkProxyHost(spec: ProxySpec, trusted: boolean) {
  if (trusted || allowPrivate()) return;
  const list = await dns.promises.lookup(spec.host, { all: true }).catch(() => []);
  if (list.some((a) => isPrivateAddress(a.address))) throw new BlockedAddressError(spec.host);
}

/** A tunnel to host:port by the bot's proxy (net.ts Tunnel), or null when the bot does not use one. */
export function tunnelFor(botId: string): ((host: string, port: number, signal?: AbortSignal) => Promise<net.Socket>) | null {
  const spec = tunnelSpec(botId);
  if (!spec) return null;
  const trusted = get(botId)?.route === "tailscale";
  return async (host, port, signal) => { await checkProxyHost(spec, trusted); return connectThrough(spec, host, port, signal); };
}

/** Whether the bot's browser goes through the exit too (see above), and why not. */
let linuxComputers = () => computerKind() === "linux";
/** Tests: act as if bots had Linux computers. */
export const _assumeLinuxComputers = (on: boolean) => { linuxComputers = on ? () => true : () => computerKind() === "linux"; };
export function browserCoverage(bot: Pick<BotRecord, "id">): "yes" | "relay" | "direct" | "network_mode" | "not_linux" {
  const route = (get(bot.id)?.route ?? "direct") as Route;
  if (route === "direct") return "direct";
  if (route === "relay") return "relay";
  if (!linuxComputers()) return "not_linux";
  if (config.botLink !== "socket") return "network_mode";
  return tunnelSpec(bot.id) ? "yes" : "direct";
}
// Chromium managed policies (https://chromeenterprise.google/policies/#ProxySettings, #HttpsOnlyMode), merged into the
// bot's policy file by netpolicy.ts: every page through the socket's port in the computer (socat → the bot's own socket,
// docker/desktop/start-desktop.sh), and plain http pages upgraded to https (the tunnel only carries CONNECT).
setBrowserPolicyExtra((bot) => browserCoverage(bot) === "yes"
  ? { ProxySettings: { ProxyMode: "fixed_servers", ProxyServer: `127.0.0.1:${config.botLinkPort}` }, HttpsOnlyMode: "force_enabled" }
  : {});

export interface EgressView {
  route: Route; proxy: { address: string; hasLogin: boolean } | null; deviceId: string | null;
  sign: boolean; signHome: boolean; canSign: boolean; directoryUrl: string; keyId: string | null;
  tailscale: boolean; browser: ReturnType<typeof browserCoverage>;
  devices: Array<{ id: string; name: string; online: boolean; capable: boolean }>;
}
export function egressView(bot: BotRecord): EgressView {
  const r = get(bot.id);
  const route = (ROUTES.includes(r?.route as Route) ? r!.route : "direct") as Route;
  const signable = canSign();
  return {
    route,
    proxy: r?.proxy_host && r.proxy_scheme && r.proxy_port ? { address: proxyLabel({ scheme: r.proxy_scheme as ProxySpec["scheme"], host: r.proxy_host, port: r.proxy_port }), hasLogin: !!r.proxy_user } : null,
    deviceId: r?.device_id ?? null, sign: !!r?.sign, signHome: !!r?.sign_home, canSign: signable, directoryUrl: directoryUrl(),
    keyId: signable && r?.sign ? keyId() : null, tailscale: !!tailscaleSpec(), browser: browserCoverage(bot),
    devices: listDevices(bot.userId).filter((d) => d.kind === "computer").map((d) => ({ id: d.id, name: d.name, online: d.status === "online", capable: d.capabilities.includes("net.fetch") })),
  };
}

/** Changes the bot's exit. Fields left out keep their value; `proxy` replaces the proxy (and its login when it has one). */
export async function setEgress(bot: BotRecord, raw: Record<string, unknown>, locale: string | undefined): Promise<EgressView> {
  const cur = get(bot.id);
  const route = (raw.route === undefined ? cur?.route ?? "direct" : raw.route) as Route;
  if (!ROUTES.includes(route)) throw new RouteError(400, say(locale, "Choose how the bot goes out: direct, proxy, home (Relais) or home (Tailscale)."));
  let scheme = cur?.proxy_scheme ?? null, host = cur?.proxy_host ?? null, port = cur?.proxy_port ?? null, user = cur?.proxy_user ?? null, pass = cur?.proxy_pass ?? null;
  if (raw.proxy !== undefined && String(raw.proxy ?? "").trim() !== "") {
    const spec = parseProxyAddress(raw.proxy);
    if (!spec) throw new RouteError(400, say(locale, "Give the proxy's address, for example socks5://proxy.example.com:1080 or http://proxy.example.com:8080."));
    try { await checkProxyHost(spec, false); } catch { throw new RouteError(400, say(locale, "That proxy is on a private or local network, which this server does not reach.")); }
    scheme = spec.scheme; host = spec.host; port = spec.port;
    if (spec.username !== undefined) { user = seal(spec.username); pass = seal(spec.password ?? ""); }
    else if (host !== cur?.proxy_host) { user = null; pass = null; } // another proxy: the old login does not follow
  }
  if (typeof raw.username === "string" && raw.username.trim()) { user = seal(raw.username.trim().slice(0, 255)); pass = seal(typeof raw.password === "string" ? raw.password.slice(0, 255) : ""); }
  if (raw.clearLogin === true) { user = null; pass = null; }
  if (route === "proxy" && !host) throw new RouteError(400, say(locale, "Give the proxy's address, for example socks5://proxy.example.com:1080 or http://proxy.example.com:8080."));
  let deviceId = raw.deviceId === undefined ? cur?.device_id ?? null : typeof raw.deviceId === "string" && raw.deviceId ? raw.deviceId : null;
  if (route === "relay") {
    if (!deviceId) { const mine = devices.list(bot.userId); if (mine.length === 1) deviceId = mine[0].id; }
    if (!deviceId) throw new RouteError(400, say(locale, "Choose the computer whose connection the bot uses."));
    if (!devices.owned(bot.userId, deviceId)) throw new RouteError(404, say(locale, "That computer is not yours or no longer exists."));
  }
  if (route === "tailscale") {
    if (hostedMode()) throw new RouteError(409, say(locale, "Tailscale exit is only for a server of your own, not a shared one."));
    if (!tailscaleSpec()) throw new RouteError(409, say(locale, "Tailscale is not set up on this server (TAILSCALE_PROXY). See « Sortir par la maison » in the guide."));
  }
  const sign = raw.sign === undefined ? !!cur?.sign : raw.sign === true;
  if (sign && !cur?.sign && !canSign()) throw new RouteError(409, say(locale, "This server has no public https address, so sites could not check the signature. Set PUBLIC_URL to https://…."));
  const signHome = raw.signHome === undefined ? !!cur?.sign_home : raw.signHome === true;
  q.run(`INSERT INTO bot_egress (bot_id, route, proxy_scheme, proxy_host, proxy_port, proxy_user, proxy_pass, device_id, sign, sign_home, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET route = excluded.route, proxy_scheme = excluded.proxy_scheme, proxy_host = excluded.proxy_host, proxy_port = excluded.proxy_port,
    proxy_user = excluded.proxy_user, proxy_pass = excluded.proxy_pass, device_id = excluded.device_id, sign = excluded.sign, sign_home = excluded.sign_home, updated_at = excluded.updated_at`,
  bot.id, route, scheme, host, port, user, pass, deviceId, sign ? 1 : 0, signHome ? 1 : 0, now());
  audit(bot.userId, "account", `${bot.name}: internet exit set to ${route}${sign ? " (Web Bot Auth on)" : ""}`, bot.id);
  return egressView(bot);
}

/** Forgets the proxy and its login (the exit goes back to direct when it was the proxy). */
export function clearProxy(bot: BotRecord): EgressView {
  q.run("UPDATE bot_egress SET proxy_scheme = NULL, proxy_host = NULL, proxy_port = NULL, proxy_user = NULL, proxy_pass = NULL, route = CASE route WHEN 'proxy' THEN 'direct' ELSE route END, updated_at = ? WHERE bot_id = ?", now(), bot.id);
  audit(bot.userId, "account", `${bot.name}: proxy removed`, bot.id);
  return egressView(bot);
}

/** Whether this request should carry the Web Bot Auth signature. */
function signs(r: Row | undefined): boolean {
  if (!r?.sign || !canSign()) return false;
  return r.route === "relay" || r.route === "tailscale" ? !!r.sign_home : true;
}

// ── Through the owner's Relais (net.fetch, docs/RELAIS-PROTOCOLE.md §19) ─────────────────────────────────────────────
const MAX_RELAY_BODY = 180 * 1024;
const RELAY_HEADERS = ["accept", "accept-language", "content-type", "user-agent", "signature", "signature-input", "signature-agent"];

export class HomeExitError extends Error { constructor(public code: string, message: string) { super(message); this.name = "HomeExitError"; } }
async function relayOnce(bot: BotRecord, deviceId: string, url: URL, method: string, headers: Headers, body: Buffer | undefined, signal?: AbortSignal): Promise<Response> {
  if (body && body.length > MAX_RELAY_BODY) throw new HomeExitError("too_large", "request body too large for the home exit (180 KiB)");
  const h: Record<string, string> = {};
  for (const k of RELAY_HEADERS) { const v = headers.get(k); if (v) h[k] = v; }
  const r = await relayRequest(deviceId, { id: bot.id, name: bot.name }, "net.fetch", { url: url.toString(), method, headers: h, ...(body ? { body: body.toString("base64") } : {}) }, { timeoutMs: 60_000, signal });
  if (!r.ok) throw new HomeExitError(r.code, r.message);
  const res = r.result as { status?: number; headers?: Record<string, string>; data?: string };
  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers ?? {})) if (typeof v === "string") out.set(k, v);
  const status = Number(res.status) || 502;
  const response = new Response([101, 204, 205, 304].includes(status) || method === "HEAD" ? null : Buffer.from(String(res.data ?? ""), "base64"), { status: status < 200 ? 502 : status, headers: out });
  Object.defineProperty(response, "url", { value: url.toString() });
  return response;
}

/**
 * fetch() for a bot's web tools: through the bot's exit, signed when asked, the network policy checked on every hop
 * (the first one is checked by the tool itself, with its journal line), redirects followed here so each hop is signed for
 * its own site. Throws like guardedFetch (fetchProblem / exitProblem word the failure).
 */
export async function botFetch(bot: BotRecord, input: string, init: RequestInit = {}): Promise<Response> {
  const r = get(bot.id);
  const tunnel = r?.route === "proxy" || r?.route === "tailscale" ? tunnelFor(bot.id) : null;
  const relay = r?.route === "relay" && r.device_id && devices.owned(bot.userId, r.device_id) ? r.device_id : null;
  // The owner chose an exit that is gone (computer unlinked, TAILSCALE_PROXY removed): never fall back to direct silently.
  if (r && r.route !== "direct" && !tunnel && !relay) throw new HomeExitError("unavailable", "the chosen exit is not available");
  if (!tunnel && !relay && !signs(r)) return guardedFetch(input, init);
  let url = new URL(input);
  let method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  let body: Buffer | undefined = init.body ? Buffer.from(await new Response(init.body).arrayBuffer()) : undefined;
  for (let hop = 0; hop <= 10; hop++) {
    if (hop > 0) { const why = netRefusal(bot, url.hostname); if (why) throw new HomeExitError("policy", why); }
    for (const k of ["signature", "signature-input", "signature-agent"]) headers.delete(k);
    if (signs(r)) for (const [k, v] of Object.entries(signRequest(url))) headers.set(k, v);
    const res = relay ? await relayOnce(bot, relay, url, method, headers, body, init.signal ?? undefined)
      : await guardedFetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: init.signal, redirect: "manual", ...(tunnel ? { tunnel } : {}) });
    const location = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location || init.redirect === "manual") return res;
    await res.body?.cancel().catch(() => {});
    if (init.redirect === "error") throw new TypeError(`redirected from ${url.origin}`);
    const next = new URL(location, url);
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = method === "HEAD" ? "HEAD" : "GET"; body = undefined; headers.delete("content-type"); }
    if (next.origin !== url.origin) { headers.delete("authorization"); headers.delete("cookie"); }
    url = next;
  }
  throw new TypeError("too many redirects");
}

/** A failure of the exit, in the owner's or the model's words (English for the model, the owner's language in the UI). */
export function exitProblem(err: unknown, locale?: string): string | null {
  if (err instanceof ProxyError) {
    const en = { auth: "The proxy refused the user name or password.", unreachable: "The proxy could not be reached: check its address and port.", timeout: "The proxy did not answer in time.", refused: "The proxy refused to open the site.", protocol: "That address does not answer like a proxy of this kind: check http, https or socks5.", tls: "The proxy's certificate is not valid." }[err.code];
    return say(locale, en);
  }
  if (err instanceof HomeExitError) {
    const en: Record<string, string> = { offline: "Your computer's Relais is not connected: open Sklubot on it (the computer must stay on).", unknown_op: "Your Relais is too old for this: update Sklubot on your computer.", unsupported: "Your Relais is too old for this: update Sklubot on your computer.", consent_refused: "You said no on your computer.", locked: "The Relais is stopped on your computer: press Resume there.", rate_limited: "Too many requests through your computer: wait a little.", blocked_address: "The Relais refused: that address is on your home network.", timeout: "Your computer did not answer in time.", unavailable: "The chosen exit is not available any more: choose it again in the bot's settings, or switch to direct." };
    if (err.code === "policy") return err.message;
    return en[err.code] ? say(locale, en[err.code]) : `${err.message}`;
  }
  if (err instanceof BlockedAddressError && locale !== undefined) return say(locale, "That proxy is on a private or local network, which this server does not reach.");
  return null;
}

/** EGRESS_TEST_URL: a page that answers with the caller's address (Cloudflare's trace answers `ip=…`). */
const testUrl = () => process.env.EGRESS_TEST_URL || "https://www.cloudflare.com/cdn-cgi/trace";
/** « Tester »: one request through the exit; the address sites will see when the page says it. */
export async function testEgress(bot: BotRecord, locale: string | undefined): Promise<{ ok: boolean; ip?: string; ms: number; error?: string }> {
  const route = get(bot.id)?.route ?? "direct";
  const t = Date.now();
  if (route === "direct") return { ok: false, ms: 0, error: say(locale, "Choose an exit other than « direct » to test it.") };
  try {
    const res = await botFetch(bot, testUrl(), { signal: AbortSignal.timeout(30_000), headers: { accept: "text/plain" } });
    const text = (await res.text()).slice(0, 4000);
    const ip = /^ip=([0-9a-f.:]+)$/im.exec(text)?.[1];
    if (!res.ok) return { ok: false, ms: Date.now() - t, error: say(locale, "The test site could not be reached through this exit.") };
    return { ok: true, ...(ip ? { ip } : {}), ms: Date.now() - t };
  } catch (err) {
    const problem = exitProblem(err, locale ?? "en") ?? fetchProblem(err);
    return { ok: false, ms: Date.now() - t, error: problem ? localize(locale, problem, FR) : say(locale, "The test site could not be reached through this exit.") };
  }
}
