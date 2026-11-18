import { randomInt } from "node:crypto";
import { screen } from "./computer.js";
import { containerName, docker } from "./linux.js";
import { beginPersonal, finishPersonal, personalEnabled } from "./personalplan.js";
import type { BotRecord } from "./store.js";

// Only the official authorization page and its short-lived callback visit the
// desktop. The PKCE verifier and the grant never leave the trusted app server.
const listen = `
import http.server,json,os,subprocess,sys,time,urllib.parse
port,url,state=json.load(sys.stdin)
class Callback(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  p=urllib.parse.urlsplit(self.path)
  q=urllib.parse.parse_qs(p.query)
  if p.path!='/auth/callback' or q.get('state')!=[state]:
   self.send_error(404); return
  self.send_response(200); self.send_header('Content-Type','text/plain; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers()
  self.wfile.write('Retourne dans Sklubot pour vérifier la connexion.'.encode())
  self.server.result=p.query
with http.server.HTTPServer(('127.0.0.1',port),Callback) as s:
 s.timeout=1; s.result=None
 subprocess.Popen(['xdg-open',url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 end=time.monotonic()+300
 while s.result is None and time.monotonic()<end: s.handle_request()
 if s.result: print(s.result,flush=True)
`;
const pending = new Map<string, { botId: string; error?: string }>();
export const personalLoginState = (owner: string) => pending.get(owner);
export function startPersonalLogin(bot: BotRecord) {
  if (!personalEnabled(bot.userId) || bot.computerMode === "shared") throw new Error("Use a private desktop for personal sign-in.");
  const previous = pending.get(bot.userId);
  if (previous && !previous.error) return previous.botId;
  const state: { botId: string; error?: string } = { botId: bot.id };
  pending.set(bot.userId, state);
  void (async () => {
    const release = await screen.holdTurn(bot.id, bot.userId);
    try {
      await screen.ready(bot.id, bot.userId);
      const port = randomInt(20000, 50000);
      const a = beginPersonal(bot.userId, "http://127.0.0.1:" + port + "/auth/callback");
      const r = await docker(["exec", "-i", containerName(bot.id), "python3", "-u", "-c", listen], {
        input: JSON.stringify([port, a.url, a.state]), timeoutMs: 315_000, maxBytes: 12_000 });
      if (r.code !== 0 || r.timedOut || !r.stdout.length) throw new Error("Authorization expired");
      await finishPersonal(a, new URLSearchParams(r.stdout.toString("utf8").trim()));
      pending.delete(bot.userId);
    } finally { release(); }
  })().catch(() => { state.error = "authorization_incomplete"; });
  return bot.id;
}
