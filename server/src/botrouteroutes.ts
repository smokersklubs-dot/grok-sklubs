import type { Context, Hono } from "hono";
import { config } from "./config.js";
import { applyBrowserPolicy } from "./netpolicy.js";
import { clearProxy, egressView, RouteError, setEgress, testEgress } from "./botroute.js";
import { body, fail } from "./routeinput.js";
import type { BotRecord, UserRecord } from "./store.js";
import { DIRECTORY_PATH, signedDirectory } from "./webbotauth.js";

/**
 * L169 owner routes (behind the session; another account's bot answers 404, ownAgent):
 *   GET /bots/:id/egress                      the bot's exit (never the proxy's password or user name)
 *   PUT /bots/:id/egress { route, proxy?, username?, password?, clearLogin?, deviceId?, sign?, signHome? }
 *   DELETE /bots/:id/egress/proxy             forget the proxy and its login
 *   POST /bots/:id/egress/test                « Tester »: one request through the exit
 * Public: GET /.well-known/http-message-signatures-directory (webbotauth.ts), mounted by index.ts.
 */
export function registerBotRouteRoutes(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  const locale = (c: Context) => (c.get("user") as UserRecord).locale;
  api.get("/bots/:id/egress", (c) => c.json({ egress: egressView(ownAgent(c)) }));
  api.put("/bots/:id/egress", async (c) => {
    const bot = ownAgent(c);
    try {
      const egress = await setEgress(bot, await body(c), locale(c));
      void applyBrowserPolicy(bot);
      return c.json({ egress });
    } catch (e) { if (e instanceof RouteError) return fail(e.status, e.message); throw e; }
  });
  api.delete("/bots/:id/egress/proxy", (c) => { const bot = ownAgent(c); const egress = clearProxy(bot); void applyBrowserPolicy(bot); return c.json({ egress }); });
  api.post("/bots/:id/egress/test", async (c) => c.json({ test: await testEgress(ownAgent(c), locale(c)) }));
}

/** The public key directory (draft-ietf-webbotauth-httpsig-protocol-01 §5.5.1), signed (Appendix B.1). */
export function registerWebBotAuthDirectory(app: Hono<any>) {
  app.get(DIRECTORY_PATH, (c) => {
    const d = signedDirectory(new URL(config.publicUrl).host); // the address verifiers fetch (behind a reverse proxy too)
    return c.body(d.body, 200, d.headers);
  });
}
