import http from "node:http";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config.js";
import { limitBodies } from "./hardening.js";
import { botLinkDir, isSharedMachine, machineMembers, setBotLinkOpener } from "./linux.js";

/**
 * H2: each Linux computer reaches this server through a Unix socket of its own, in a folder of the data volume mounted
 * read-only in that computer only (linux.ts BOT_LINK_MOUNT). The listener behind it serves nothing but the tool endpoint
 * and the credential relay (routes.ts botLinkRoutes), and only for the bots that use that computer. The computers sit on
 * a network of their own (BOTS_NETWORK, inter-container traffic off): they reach none of this server's ports, the mail
 * receiver, the Docker proxy, the voice services, Caddy, nor each other's.
 */

type RoutesFor = (allowed: (botId: string) => boolean) => Hono;
let routesFor: RoutesFor | null = null;
/** Bots that may use a computer's socket: its own bot, or the bots of a shared computer (sharedcomputers.ts). */
let membersOf: (key: string) => string[] = (key) => [key];

const servers = new Map<string, http.Server>();
const opening = new Map<string, Promise<void>>();

/** The socket path on this server's side. */
export const botSocketPath = (key: string) => path.join(botLinkDir(key), "s.sock");

/** Opens a computer's socket if it is not open yet (a stale file left by a previous run is replaced). */
export function openBotLink(key: string): Promise<void> {
  if (config.botLink !== "socket") return Promise.resolve();
  // The folder is mounted in the computer even when no listener is set up (the desk test's command line): it must exist.
  mkdirSync(botLinkDir(key), { recursive: true, mode: 0o755 });
  if (!routesFor) return Promise.resolve();
  if (servers.get(key)?.listening) return Promise.resolve();
  const pending = opening.get(key);
  if (pending) return pending;
  const job = new Promise<void>((resolve, reject) => {
    const dir = botLinkDir(key);
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    const file = botSocketPath(key);
    try { if (lstatSync(file).isSocket()) unlinkSync(file); } catch { /* none */ }
    const app = new Hono();
    app.use("*", limitBodies);
    // The members are read at each request: a bot that stops sharing a computer loses its way in at once.
    app.route("/", routesFor!((botId) => (isSharedMachine(key) ? membersOf(key) : machineMembers(key)).includes(botId)));
    const server = http.createServer(getRequestListener(app.fetch));
    // A subscription tool's call may wait for the user's approval (up to 30 minutes, see engine.ts TOOL_TIMEOUT_MS).
    server.requestTimeout = 0;
    server.on("error", reject);
    server.listen(file, () => {
      // The computer's programs run as root but in another user namespace on some hosts: anyone may connect; only the
      // computers that mount this folder can reach the file at all.
      try { chmodSync(file, 0o666); } catch { /* best effort */ }
      servers.set(key, server);
      resolve();
    });
  });
  opening.set(key, job);
  return job.finally(() => opening.delete(key));
}

/** Closes a computer's socket (the computer was wiped). */
export function closeBotLink(key: string) {
  const s = servers.get(key);
  servers.delete(key);
  s?.close();
  try { unlinkSync(botSocketPath(key)); } catch { /* gone */ }
}

export const closeAllBotLinks = () => { for (const key of [...servers.keys()]) closeBotLink(key); };

/** Set up once at start-up (index.ts): the routes and who may use each socket. */
export function initBotLinks(routes: RoutesFor, members: (key: string) => string[]) {
  routesFor = routes;
  membersOf = members;
  setBotLinkOpener(openBotLink);
}
