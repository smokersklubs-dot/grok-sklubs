import { spawn } from "node:child_process";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { parseCookies, SESSION_COOKIE, userForToken } from "./auth.js";
import { computerKind } from "./computer.js";
import { config } from "./config.js";
import { containerName, linuxScreen } from "./linux.js";
import { bots } from "./store.js";

/**
 * Live view of a bot's Linux computer. The browser speaks the standard remote-screen protocol (RFB, as
 * used by VNC) over a WebSocket; the server hands that stream, through Docker itself, to a VNC server that
 * listens only on the loopback of the bot's own container. No port of the container is ever exposed, and watch mode is
 * enforced by the VNC server (view-only), not by the browser.
 */
const PATH = /^\/api\/bots\/([^/]+)\/vnc$/;

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachLiveScreens(server: Server) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has("binary") ? "binary" : false), maxPayload: 1_000_000 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    const match = PATH.exec(url.pathname);
    if (!match) return reject(socket, 404, "Not Found");
    // Only pages of this site may open the stream, with the visitor's own session.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host && origin !== config.publicUrl) return reject(socket, 403, "Forbidden");
    const user = userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) return reject(socket, 401, "Unauthorized");
    const bot = bots.owned(user.id, decodeURIComponent(match[1]));
    if (!bot || bot.kind !== "agent") return reject(socket, 404, "Not Found");
    if (computerKind() !== "linux" || !linuxScreen.isOpen(bot.id)) return reject(socket, 409, "Conflict");
    const control = url.searchParams.get("mode") === "control";
    wss.handleUpgrade(req, socket, head, (ws) => pipe(ws, bot.id, control));
  });
}

function pipe(ws: WebSocket, botId: string, control: boolean) {
  const vnc = spawn("docker", ["exec", "-i", containerName(botId), "/opt/sklubot/screen-relay.sh", control ? "control" : "watch"], { stdio: ["pipe", "pipe", "ignore"] });
  // While someone is looking, the computer counts as in use and does not go to sleep.
  const keepAwake = setInterval(() => linuxScreen.touch(botId), 30_000);
  linuxScreen.touch(botId);
  const close = () => { clearInterval(keepAwake); vnc.kill("SIGKILL"); if (ws.readyState === ws.OPEN) ws.close(); };
  vnc.stdout!.on("data", (chunk: Buffer) => { if (ws.readyState === ws.OPEN) ws.send(chunk); });
  vnc.on("close", close);
  vnc.on("error", close);
  ws.on("message", (data: Buffer) => { if (vnc.stdin!.writable) vnc.stdin!.write(data); });
  ws.on("close", close);
  ws.on("error", close);
}
