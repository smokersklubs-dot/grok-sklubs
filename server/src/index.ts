// L50: first of all, the « un seul serveur » lock on the data folder (datalock.ts), before the database opens.
import "./datalockboot.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { closeAllDesktops, computerKind, initComputer } from "./computer.js";
import { startFreeComputers } from "./freecomputers.js";
import { setLookSource } from "./linux.js";
import { bots, users } from "./store.js";
import { assertConfig, config } from "./config.js";
import { checkDataKeys } from "./datakey.js";
import { startSessionSweep } from "./twofactor.js";
import { startUploadSweep } from "./uploadparts.js";
import { connectors } from "./connectors.js";
import { localTools } from "./localtools.js";
import { defaultModelRef, listProviders } from "./llm/index.js";
import { api, botLinkRoutes, site } from "./routes.js";
import { closeAllBotLinks, initBotLinks } from "./botlink.js";
import { membersOf, sharedComputers } from "./sharedcomputers.js";
import { startDiskWatchdog } from "./diskwatch.js";
import { startScheduler } from "./scheduler.js";
import { startAutoBackup } from "./autobackup.js";
import { startGithubIssueWorker } from "./githubissues.js";
import { startStudioExports } from "./studiomp4.js";
import { startHealthChecks } from "./health.js";
import { startSentinel } from "./sentinel/index.js";
import { startAnnouncements } from "./announcements.js";
import { installErrorCounter, noteSignal } from "./sentinel/signals.js";
import { attachLiveScreens } from "./vnc.js";
import { relayUpgrade } from "./relay.js";
import { closeLeftOpenWatchNotices } from "./agent/watch.js";
import { expireOrphanApprovals, interrupt, recoverInterruptedTurns, startJobWatch } from "./agent/loop.js";
import { gracefulStop } from "./agent/restartguard.js";
import { crashedTurn, TurnCrashed } from "./agent/crashguard.js";
import { rowScope } from "./store.js";
import { startLimitWatch } from "./agent/sublimit.js";
import { startResearchWorker } from "./researchreports.js";
import { sweepUncertain } from "./agent/executions.js";
import { telegram } from "./telegram.js"; import { channels } from "./channelroutes.js";
import { closeSlackSockets } from "./native/triggers.js";
import { receiving, startMailReceiver, stopMailReceiver } from "./botmail.js";
import { voiceUpgrade } from "./voice/session.js";
import { turnstileKeys } from "./publicsignup.js";
import { appCsp, inlineScriptHashes, limitBodies, openSetupProblem, securityHeaders } from "./hardening.js";

// The Sentinelle's error counter (sentinel/signals.ts): from here on, every console.error line counts.
installErrorCounter();
try { assertConfig(); checkDataKeys(); } catch (err) { console.error(`\nCannot start: ${(err as Error).message}\n`); process.exit(1); }
// M6: a fresh install open to others needs its setup code; one that already has accounts always starts.
{
  const problem = openSetupProblem({ users: users.all().length, setupCode: config.setupCode, publicUrl: config.publicUrl });
  if (problem) { console.error(`\nCannot start: ${problem}\n`); process.exit(1); }
}

const builtIndex = existsSync(path.join(config.webDist, "index.html")) ? readFileSync(path.join(config.webDist, "index.html"), "utf8") : null;
const app = new Hono();
// Security headers on every response (M3) and a size limit on every request body (M7), before any route.
app.use("*", securityHeaders(appCsp(builtIndex ? inlineScriptHashes(builtIndex) : [], { turnstile: config.openSignup && !!turnstileKeys() })));
app.use("*", limitBodies);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "No such endpoint." }, 404));

app.route("/", site);

// In production the server also serves the built web app; unknown paths fall back to its index page.
if (builtIndex) {
  const index = builtIndex;
  // Phones only offer to install the Android app when the file is announced as one.
  app.use("/download/*", async (c, next) => { await next(); if (c.req.path.endsWith(".apk")) c.header("content-type", "application/vnd.android.package-archive"); });
  // Video captions (web/public/media/*.vtt, the landing and download pages): a <track> needs text/vtt (nosniff is on).
  app.use("/media/*", async (c, next) => { await next(); if (c.req.path.endsWith(".vtt") && c.res.ok) c.header("content-type", "text/vtt; charset=utf-8"); });
  app.use("*", serveStatic({ root: path.relative(process.cwd(), config.webDist) || "." }));
  app.get("*", (c) => c.html(index));
}

setLookSource((key) => {
  const bot = bots.byId(key);
  if (!bot) {
    // A shared computer (Part B) wears its own look: its name, in the neutral colour, for its account.
    const shared = sharedComputers.byId(key);
    const owner = shared ? users.byId(shared.userId) : null;
    if (!shared || !owner) return null;
    const fr = owner.locale === "fr";
    return { name: `${fr ? "Ordinateur partagé" : "Shared computer"} ${shared.name}`, label: fr ? "Partagé entre tes bots" : "Shared by your bots", color: "slate", locale: owner.locale, owner: owner.name };
  }
  const owner = users.byId(bot.userId);
  // A custom character colour also tints the bot's computer.
  return owner ? { name: bot.name, label: bot.label, color: bot.character.customColor ?? bot.color, locale: owner.locale, owner: owner.name, kind: bot.character.type } : null;
});
// H2: each computer's own socket to this server (opened when a computer wakes, or adopted below).
initBotLinks(botLinkRoutes, membersOf);

let computerNote: string;
try {
  const owners = new Map(users.all().flatMap((u) => bots.list(u.id, true).map((b) => [b.id, u.id] as [string, string])));
  computerNote = await initComputer(owners);
} catch (err) { console.error(`\nCannot start: ${(err as Error).message}\n`); process.exit(1); }
// Hosted mode: the free plan's disposable computers (freecomputers.ts) — leftovers wiped, then swept every 30 s.
if (computerKind() === "linux") await startFreeComputers().catch((err) => console.error("[free computers]", (err as Error).message));

// Approvals a subscription turn was waiting on lived in memory: after a restart nobody waits for them any more.
const lapsed = expireOrphanApprovals();
if (lapsed) console.log(`${lapsed} approval(s) left from before the restart could not be kept open: marked expired.`);
// Actions that were running when the server stopped: their outcome is unknown. They are never replayed; the user gets a card.
// Notices of the turn watch that still asked something belong to turns the restart ended: they are history now.
closeLeftOpenWatchNotices();
const uncertain = sweepUncertain();
if (uncertain) console.log(`${uncertain} action(s) cut off by the restart are marked uncertain.`);
startScheduler();
// Expired sessions, pending two-factor sign-ins and one-time links are deleted (twofactor.ts), now and every hour.
startSessionSweep();
startUploadSweep();
if (process.env.NO_SCHEDULER !== "1") startGithubIssueWorker();
if (computerKind() === "linux") startStudioExports();
startAutoBackup();
startHealthChecks();
// The Sentinelle (sentinel/): a read-only scan every SENTINEL_EVERY_MIN minutes, incidents and alerts to the owner/operators.
startSentinel();
// « Annonces » (announcements.ts): push and e-mail of announcements, once per reader, every minute.
startAnnouncements();
// M2: the disk watchdog (DISK_FREE_MIN_MB; Linux computers only).
startDiskWatchdog();
if (!config.schedulerOff) { telegram.start(); channels.start(); recoverInterruptedTurns(); startJobWatch(); startLimitWatch(); }
if (!config.schedulerOff) startResearchWorker();
const server = serve({ fetch: app.fetch, port: config.port }, () => {
  const ready = listProviders().filter((p) => p.available()).map((p) => p.label);
  console.log(`Sklubot is running at ${config.publicUrl}`);
  console.log(ready.length ? `Model providers: ${ready.join(", ")} (default ${defaultModelRef()})` : "No API key configured: bots can run on your Claude or ChatGPT subscription (bot settings → Brain), or add ANTHROPIC_API_KEY to .env.");
  console.log(computerNote);
  // From here on the server is up: one bad request or a stray failure in the background is logged, never
  // allowed to stop the whole server. Start-up failures above still stop it, as they should.
  // An error raised from inside a bot's turn (a timer or an event callback of one of its tools) stops that turn only: it
  // ends with a failure card and its queue goes on (agent/crashguard.ts). A rejected promise nobody awaited is logged with
  // the turn it came from; it stops nothing (the turn's own awaits are caught by the turn).
  process.on("uncaughtException", (err) => {
    noteSignal("uncaught", "exception"); console.error("[uncaught]", err);
    try { const botId = crashedTurn(err); if (botId) interrupt(botId, new TurnCrashed(err)); } catch (e) { console.error("[uncaught] turn", e); }
  });
  process.on("unhandledRejection", (err) => console.error("[unhandled rejection]", rowScope.getStore()?.botId ? `(turn of ${rowScope.getStore()!.botId})` : "", err));
});

attachLiveScreens(server as unknown as import("node:http").Server, [relayUpgrade, voiceUpgrade]);
// The bots' own email addresses (wave 6): the embedded receiver, only when the operator set MAIL_DOMAIN and MAIL_SMTP_PORT.
if (receiving()) startMailReceiver().then((port) => console.log(`Receiving mail for @${config.mailDomain} on port ${port}.`), (err) => console.error(`[mail] receiver not started: ${(err as Error).message}`));

let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  // L18: running turns finish the step they are in and wait at the next step boundary (at most GRACEFUL_STOP_SEC, 20 s),
  // so the restart picks them up cleanly instead of cutting an action in half (agent/restartguard.ts).
  const left = await gracefulStop().catch(() => -1);
  if (left > 0) console.log(`${left} turn(s) were still in the middle of a step when the server stopped.`);
  server.close();
  telegram.stopAll(); channels.stopAll();
  closeSlackSockets();
  await stopMailReceiver().catch(() => {});
  await Promise.all([closeAllDesktops(), connectors.closeAll(), localTools.closeAll()]).catch(() => {});
  closeAllBotLinks();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
