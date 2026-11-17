import { RfbClientParser } from "./rfb.js";
import { isRecording, noteRfb } from "./teach.js";
import { spawn } from "node:child_process";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { originAllowed, parseCookies, SESSION_COOKIE, userForToken } from "./auth.js";
import { computerKind } from "./computer.js";
import { containerName, linuxScreen } from "./linux.js";
import { bots } from "./store.js";
import { controlSocket } from "./takeover.js";
import { emailGateBlocks } from "./publicsignup.js";

/**
 * Live view of a bot's Linux computer. The browser speaks the standard remote-screen protocol (RFB, as
 * used by VNC) over a WebSocket; the server hands that stream, through Docker itself, to a VNC server that
 * listens only on the loopback of the bot's own container. No port of the container is ever exposed, and watch mode is
 * enforced by the VNC server (view-only), not by the browser.
 */
const PATH = /^\/api\/bots\/([^/]+)\/vnc$/;

function reject(socket: Duplex, status: number, text: string) {
  try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* already closed */ }
  socket.destroy();
}

/** Another WebSocket endpoint on the same server: returns true when the request was its own (handled or refused). */
export type UpgradeRoute = (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;

/** One upgrade listener for the whole server: the routes given (e.g. Sklubot Relais) first, then the live screens. */
export function attachLiveScreens(server: Server, routes: UpgradeRoute[] = []) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false), maxPayload: 1_000_000 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // A broken connection must never surface as an unhandled error event.
    socket.on("error", () => socket.destroy());
    // Whatever a stranger sends (bad origin, bad cookie, bad path), it is answered, never thrown.
    try {
      for (const route of routes) if (route(req, socket, head)) return;
      upgrade(wss, req, socket, head);
    } catch (err) {
      console.error("[live screen]", (err as Error)?.message ?? err);
      reject(socket, 400, "Bad Request");
    }
  });
}

function upgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url ?? "/", "http://local");
  const match = PATH.exec(url.pathname);
  if (!match) return reject(socket, 404, "Not Found");
  // Only pages of this site may open the stream, with the visitor's own session.
  if (!originAllowed(req.headers.origin, req.headers.host)) return reject(socket, 403, "Forbidden");
  const user = userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!user) return reject(socket, 401, "Unauthorized");
  if (emailGateBlocks(user.id)) return reject(socket, 403, "Forbidden");
  const bot = bots.owned(user.id, decodeURIComponent(match[1]));
  if (!bot || bot.kind !== "agent") return reject(socket, 404, "Not Found");
  if (computerKind() !== "linux" || !linuxScreen.isOpen(bot.id)) return reject(socket, 409, "Conflict");
  const control = url.searchParams.get("mode") === "control";
  wss.handleUpgrade(req, socket, head, (ws) => pipe(ws, bot.id, control));
}

function pipe(ws: WebSocket, botId: string, control: boolean) {
  const vnc = spawn("docker", ["exec", "-i", containerName(botId), "/opt/sklubot/screen-relay.sh", control ? "control" : "watch"], { stdio: ["pipe", "pipe", "ignore"] });
  // While someone is looking, the computer counts as in use and does not go to sleep.
  const keepAwake = setInterval(() => linuxScreen.touch(botId), 30_000);
  linuxScreen.touch(botId);
  // A stream in control mode means the user is driving: the bot's own screen actions wait (takeover.ts).
  if (control) controlSocket(botId, true);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (control) controlSocket(botId, false);
    clearInterval(keepAwake); vnc.kill("SIGKILL"); if (ws.readyState === ws.OPEN) ws.close();
  };
  vnc.stdout!.on("data", (chunk: Buffer) => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
  vnc.on("close", close);
  vnc.on("error", close);
  // Writing to a relay that just died raises EPIPE on its input: close quietly instead of crashing.
  vnc.stdin!.on("error", close);
  vnc.stdout!.on("error", close);
  // In control mode the viewer's input is read on the way (never altered, never logged) so a demonstration
  // ("Show me how") can be recorded; the parser runs from the first byte to stay in step with the protocol.
  const reader = control ? new RfbClientParser() : null;
  ws.on("message", (data: Buffer) => {
    if (vnc.stdin!.writable) vnc.stdin!.write(data);
    if (!reader || reader.lost) return;
    const events = reader.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    if (events.length && isRecording(botId)) for (const ev of events) noteRfb(botId, ev);
  });
  ws.on("close", close);
  ws.on("error", close);
}
