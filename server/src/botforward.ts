import type http from "node:http";
import type { Duplex } from "node:stream";
import { setBotLinkConnect } from "./botlink.js";
import { browserCoverage, tunnelFor } from "./botroute.js";
import { isSharedMachine } from "./linux.js";
import { assertPublicUrl } from "./net.js";
import { netGate } from "./netpolicy.js";
import { bots } from "./store.js";

/**
 * L169 — the bot's browser through its proxy. On its own Linux computer, Chromium's managed policy (botroute.ts) sends
 * every page to 127.0.0.1:<BOT_LINK_PORT>, which socat joins to THIS computer's socket (botlink.ts); the socket's server
 * answers the CONNECT here. The socket itself says which computer is asking (only that computer mounts it), so no
 * password is needed in the computer and the proxy's login never goes there.
 *
 * Checked before anything is sent: the computer is the bot's own (not a shared one), the bot uses a proxy or Tailscale,
 * the site is allowed by its network policy (a "denied" journal line otherwise) and is not on this server's network;
 * ports 443 and 80 only; at most 64 tunnels at once per bot. CONNECT and its 2xx answer: RFC 9110 §9.3.6.
 */

const MAX_TUNNELS = 64;
const open = new Map<string, number>();

function refuse(socket: Duplex, status: number, text: string) {
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Gateway"}\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nSklubot: ${text}\n`);
}

export async function handleComputerConnect(key: string, req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  socket.on("error", () => {});
  const bot = bots.byId(key);
  if (!bot || bot.kind !== "agent" || isSharedMachine(key)) return refuse(socket, 403, "the proxy only serves a bot's own computer.");
  if (browserCoverage(bot) !== "yes") return refuse(socket, 403, "this bot does not use a proxy.");
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(req.url ?? "");
  const host = m?.[1]?.toLowerCase() ?? "", port = Number(m?.[2]);
  if (!host || (port !== 443 && port !== 80)) return refuse(socket, 403, "only ports 443 and 80 go through the bot's proxy.");
  const why = netGate(bot, host, "browser_open");
  if (why) return refuse(socket, 403, why);
  try { await assertPublicUrl(`https://${host.includes(":") ? `[${host}]` : host}/`); } catch { return refuse(socket, 403, "that address is on a private or local network."); }
  const n = open.get(bot.id) ?? 0;
  if (n >= MAX_TUNNELS) return refuse(socket, 502, "too many pages open at once through the proxy.");
  const tunnel = tunnelFor(bot.id);
  if (!tunnel) return refuse(socket, 403, "this bot does not use a proxy.");
  open.set(bot.id, n + 1);
  let done = false;
  const release = () => { if (done) return; done = true; const left = (open.get(bot.id) ?? 1) - 1; if (left > 0) open.set(bot.id, left); else open.delete(bot.id); };
  try {
    const up = await tunnel(host, port);
    up.on("error", () => socket.destroy());
    socket.on("close", () => { up.destroy(); release(); });
    up.on("close", () => { socket.destroy(); release(); });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  } catch (err) {
    release();
    refuse(socket, 502, `the proxy did not open ${host} (${(err as Error).message}).`);
  }
}

setBotLinkConnect((key, req, socket, head) => { void handleComputerConnect(key, req, socket, head); });
/** Tunnels open right now (tests). */
export const openTunnels = (botId: string) => open.get(botId) ?? 0;
