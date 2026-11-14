import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { closeAllDesktops, initComputer } from "./computer.js";
import { setLookSource } from "./linux.js";
import { bots, users } from "./store.js";
import { assertConfig, config } from "./config.js";
import { connectors } from "./connectors.js";
import { defaultModelRef, listProviders } from "./llm/index.js";
import { api, site } from "./routes.js";
import { startScheduler } from "./scheduler.js";
import { attachLiveScreens } from "./vnc.js";
import { relayUpgrade } from "./relay.js";
import { recoverInterruptedTurns } from "./agent/loop.js";
import { telegram } from "./telegram.js";
import { closeSlackSockets } from "./native/triggers.js";

try { assertConfig(); } catch (err) { console.error(`\nCannot start: ${(err as Error).message}\n`); process.exit(1); }

const app = new Hono();
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "No such endpoint." }, 404));

app.route("/", site);

// In production the server also serves the built web app; unknown paths fall back to its index page.
if (existsSync(path.join(config.webDist, "index.html"))) {
  const index = readFileSync(path.join(config.webDist, "index.html"), "utf8");
  // Phones only offer to install the Android app when the file is announced as one.
  app.use("/download/*", async (c, next) => { await next(); if (c.req.path.endsWith(".apk")) c.header("content-type", "application/vnd.android.package-archive"); });
  app.use("*", serveStatic({ root: path.relative(process.cwd(), config.webDist) || "." }));
  app.get("*", (c) => c.html(index));
}

setLookSource((botId) => {
  const bot = bots.byId(botId);
  const owner = bot ? users.byId(bot.userId) : null;
  // A custom character colour also tints the bot's computer.
  return bot && owner ? { name: bot.name, label: bot.label, color: bot.character.customColor ?? bot.color, locale: owner.locale, owner: owner.name, kind: bot.character.type } : null;
});

let computerNote: string;
try {
  const owners = new Map(users.all().flatMap((u) => bots.list(u.id, true).map((b) => [b.id, u.id] as [string, string])));
  computerNote = await initComputer(owners);
} catch (err) { console.error(`\nCannot start: ${(err as Error).message}\n`); process.exit(1); }

startScheduler();
if (!config.schedulerOff) { telegram.start(); recoverInterruptedTurns(); }
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  const ready = listProviders().filter((p) => p.available()).map((p) => p.label);
  console.log(`Sklubot is running at ${config.publicUrl}`);
  console.log(ready.length ? `Model providers: ${ready.join(", ")} (default ${defaultModelRef()})` : "No API key configured: bots can run on your Claude or ChatGPT subscription (bot settings → Brain), or add ANTHROPIC_API_KEY to .env.");
  console.log(computerNote);
  // From here on the server is up: one bad request or a stray failure in the background is logged, never
  // allowed to stop the whole server. Start-up failures above still stop it, as they should.
  process.on("uncaughtException", (err) => console.error("[uncaught]", err));
  process.on("unhandledRejection", (err) => console.error("[unhandled rejection]", err));
});

attachLiveScreens(server as unknown as import("node:http").Server, [relayUpgrade]);

async function shutdown() {
  server.close();
  telegram.stopAll();
  closeSlackSockets();
  await Promise.all([closeAllDesktops(), connectors.closeAll()]).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
