import { body, fail, HttpError } from "./routeinput.js";
import { registerSectionRoutes } from "./sectionroutes.js"; import { registerStopCauseRoutes } from "./stopcauseroutes.js"; import { registerPersonalCommandRoutes } from "./personalcommandroutes.js"; import { registerDoctorRoutes } from "./doctorroutes.js";
import { createHash } from "node:crypto";
import { closeSync, createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { registerNoticeRoutes } from "./agent/noticeroutes.js"; import { registerRoomRoutingRoutes, roomReaction } from "./agent/roomroutes.js";
import { registerFailureRoutes } from "./agent/failureroutes.js"; import { decideForConversation, registerConversationGrantRoutes } from "./agent/conversationgrantroutes.js";
import { registerRecruitRoutes } from "./agent/recruit.js"; import { registerTeamMdRoutes } from "./teammdroutes.js";
import { registerCommandRoutes } from "./command.js"; import { registerRelayGuardRoutes } from "./relayguardroutes.js"; import { registerComfortRoutes } from "./comfortroutes.js"; import { registerChantierRoutes } from "./chantierroutes.js";
import { continueAfterStepLimit, decideApproval, enqueue, inQueue, interrupt, noteHandBack, submitUserMessage, type ForcedSkill } from "./agent/loop.js"; import { sendOnce } from "./sendkeys.js";
import { cleanProfile, fetchSkillMarkdown, saveImportedSkill, undoRevision } from "./agent/tools-team.js";
import { xSearchProvider } from "./xsearch.js";
import { registerResearch } from "./researchroutes.js";
import { cleanModelList, laneKey, TeamFullError } from "./store.js"; import { newBotAutonomy } from "./botdefaults.js";
import { localTools } from "./localtools.js";
import { RELIABILITY_LIMITS, SKILL_EXTRA_KEYS, type RowBody, type SkillExtras } from "./shared.js";
import { ask, compactIfNeeded, consolidate, memoryStatus } from "./agent/memory.js";
import { telegram } from "./telegram.js";
import { EngineRestartRefused, engineLogin, engineLogout, engineModelsFor, engineRuntime, engineStatus, restartEngine } from "./agent/engine.js";
import { handleMcp } from "./agent/mcp.js";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRoom, dispatchToRoom, validMembers } from "./agent/team.js";
import { retireBot } from "./agent/tools.js";
import { dropSession, hashPassword, originAllowed, seal, SESSION_COOKIE, setupCodeMatches, setupCodeRequired, signupOpen, userForToken, verifyPassword } from "./auth.js";
import { emit, getLive, subscribe } from "./bus.js";
import { workspaceOf } from "./computer.js";
import { attachmentAt, computerKind, computerState, isInlineImage, isInlineVideo, listFiles, listTeamFiles, mimeOf, openLibraryFile, openTeamFile, readLibraryFile, removeTeamFolder, removeWorkspace, resolveInTeam, resolveInWorkspace, screen, storeBytes, teamFolderState } from "./computer.js";
import { checkDisk, deleteListed } from "./disk.js";
import { registerConnectorCatalog } from "./connectorcatalogroutes.js";
import { imageService } from "./images.js";
import { config } from "./config.js";
import { connectors, NeedsClientIdError, oauthRedirectUri } from "./connectors.js";
import { isValidTimezone } from "./cron.js";
import { pickLocale, tr } from "./i18n.js";
import { defaultModelRef, listProviders, modelAvailable } from "./llm/index.js";
import { publicRoutine, routines, runs } from "./routines.js"; import { registerRoutinePlusRoutes, runNowGuard } from "./routineplusroutes.js"; import { privateOption, registerConnectorPlusRoutes } from "./connectorplusroutes.js";
import { fireCheckin, fireRoutine, schedule, unschedule } from "./scheduler.js";
import { REACTIONS, type CheckinSettings, type ReactionEmoji, type ServerEvent, type VideoStatus } from "./shared.js";
import { videoService } from "./video.js";
import { higgsfieldFor } from "./agent/tools.js";
import { dropRecording, noteInput, recording, retryRecording, saveRecording, startRecording, stopRecording } from "./teach.js";
import { dayBound, searchMessages } from "./convsearch.js";
import { registerMemoryNoteRoutes } from "./memoryroutes.js";
import { approvals, account, audit, auditList, bots, clip, feedback, history, memories, pages, policies, publicBot, publicVault, rows, sections, settings, sha256, skills, skillText, tasks, users, vault, type BotRecord, type UserRecord, type VaultFields } from "./store.js";
import { finishTakeover, holdControl, releaseControl } from "./takeover.js";
import { deskRun, deskShot, startDeskTest } from "./desktest.js";
import { notePresence, push, pushSettings, savePushSettings, sendPush } from "./push.js";
import { parseTotp } from "./totp.js";
import { registerEmailLinkPublic } from "./emaillink.js";
import { registerTwoFactorPrivate, registerTwoFactorPublic, startSessionOrChallenge } from "./twofactor.js";
import { registerDataKeyRoutes } from "./datakeyrotate.js";
import { detectMapping, loginsFrom, parseCsv, type Mapping } from "./vault-import.js";
import { PUSH_KINDS, VAULT_KINDS, type VaultKind } from "./shared.js";
import { q } from "./db.js";
import { connectors as connectorStore } from "./connectors.js";
import type { Attachment } from "./shared.js";
import { csv as usageCsv, ownerPrices, PRICE_SOURCES, priceInfo, spentThisMonth, summary as usageSummary, UNKNOWN_ESTIMATE } from "./usage.js";
import { accounts as nativeAccounts, clients as nativeClients, disconnect as nativeDisconnect, finishSignIn as nativeFinish, publicAccount, startSignIn as nativeStart } from "./native/accounts.js";
import { appOf, appsFor, nativeRedirectUri, setupDocs, setupSteps, VENDOR_NAMES, VENDORS } from "./native/vendors.js";
import { syncSlackSockets } from "./native/triggers.js";
import { isNativeTrigger } from "./routines.js";
import type { NativeVendor, NativeVendorSetup } from "./shared.js";
import { confirmPairing, lastFrame, listDevices, relayDownloads, appDownloads, releasedDesktopFiles, revokeDevice, stopSession, userSpoke as relayUserSpoke } from "./relay.js";
import { isRuleTrigger, MAX_RULES, ruleChanges, rules } from "./rules.js";
import type { RuleTrigger } from "./shared.js";
import { executions, grants } from "./agent/executions.js";
import { bgTasks, publicTask, replyToTask, stopTask } from "./agent/bgtasks.js";
import { actOnNudge, nudges, nudgeStats, preparationPass } from "./agent/nudges.js";
import { exportMemories, importCandidates, importMemories, learnStyle } from "./agent/memory.js";
import { sentMail } from "./native/access.js";
import { handleEgress, disableRelay } from "./egress.js";
import { publicLinks, servePublicLink, DEFAULT_LINK_MIN } from "./publiclinks.js";
import { reachLogin, reachState, LOGIN_CHANNELS } from "./reach.js";
import { checkAll, checkConnector, checkSecret, healthList, recordHealth } from "./health.js";
import { commitImport, previewImport, type ImportBinding } from "./projectimport.js";
import { commitGrokImport, GrokImportError, previewGrokImport } from "./grokimport.js";
import { commitTeamFile, exportTeam, previewTeamFile, templateList } from "./teamfile.js";
import { cacheSettings, DEFAULT_CACHE, saveCacheSettings, thirdPartySummary } from "./thirdparty.js";
import { paidConsents } from "./providers.js";
import { answerCheckpoint, checkpoints } from "./agent/spend.js";
import { journalCsv, journalTotals, listJournal, type JournalFilter } from "./journal.js";
import { payments, sealCard } from "./agent/payments.js";
import { apiConnectors, approveConnector } from "./apiconnectors.js";
import { firstTaskIdeas } from "./ideas.js";
import { guideIndex } from "./agent/guides.js";
import { callEnded, callStarted } from "./calls.js";
import { saveVoiceSettings, sttFor, ttsFor, voiceSettings, voiceStatus } from "./voice/providers.js";
import { registerVoiceRoutes } from "./voice/routes.js";
import { registerTranscribeRoute } from "./voice/transcribe.js";
import { registerSpeakRoute } from "./voice/speak.js";
import { adminView, approversOf, botAccess, exportWorkspace, invites, resources, SHARED_SETTINGS, sharedBotsFor, sharedBotView, shares, workspaces, WorkspaceError, wsAudit, type BotAccess } from "./workspaces.js";
import { invalidateAudience } from "./bus.js";
import { registerGithubIssueRoutes } from "./githubissues.js";
import { registerGithubActivity } from "./githubactivity.js";
import { registerWorkContext } from "./workcontext.js";
import { registerPeerReview } from "./peerreviewroutes.js";
import { listedPathOk, undoFiles } from "./snapshots.js";
import { forgetHeld, holdAndOffer, screen as screenSecrets, takeHeld } from "./pastedsecrets.js";
import { assertPublicUrl, BlockedAddressError, clientAddress } from "./net.js";
import { apiProviders, cleanBaseUrl, cleanModels, fetchModels, PRESETS, testProvider } from "./apimodels.js";
import { botEmail, mailFor, MailError, receiving as mailReceiving, relays, releaseMail } from "./botmail.js";
import { onTurnEvent, submitMemberMessage } from "./agent/loop.js";
import { privacyPage } from "./privacy.js";
import { closeBotLink } from "./botlink.js";
import { SharedComputerInUseError } from "./linux.js";
import { sharedComputers, sharedHolder, SharedLimitError } from "./sharedcomputers.js";
import { ownerId, registerGooglePrivate, registerGooglePublic, type GoogleDeps } from "./googlelogin.js";
import { dropResetLinks, mailConfigured, registerAccountMailPrivate, registerAccountMailPublic } from "./accountmail.js";
import { registerAutoBackupRoutes } from "./autobackup.js";
import { createGoal, goalAction, GoalError, goalCommand, goals, pauseGoalsOf } from "./agent/goals.js";
import { afterMove, setPause } from "./agent/pause.js";
import { pauses } from "./pauses.js";
import { publicJobs, stopJob } from "./jobs.js";
import { healthReport } from "./monitor.js";
import { accountCreated, HostedError, hostedMode, hostedSettings, isOperator, isPlanLimit, lentProviderIds, planInviteOpens, signupChoice, subscriptionEnginesFor, suspended, type SignupChoice } from "./hosted.js";
import { registerHostedPages, registerHostedPrivate, registerHostedPublic, suspendedText } from "./hostedroutes.js";
import { TodayError, todayReport, todaySettings } from "./today.js";
import { registerBotClients, registerBotClientSettings } from "./botaccessroutes.js"; import { registerChannelRoutes } from "./channelroutes.js";
import { registerSentinelRoutes } from "./sentinel/routes.js"; import { registerHookRoutes, registerHookSettingsRoutes } from "./hookroutes.js"; import { registerReportRoutes } from "./reports.js";
import { registerAnnouncementRoutes } from "./announceroutes.js"; import { registerModelHealthRoutes } from "./modelhealth.js";
import { registerSkillsLibraryRoutes } from "./skillsroutes.js";
import { registerOpenRouterRoutes } from "./openrouterroutes.js";
import { registerSubscriptionConnectRoutes } from "./subscriptionconnect.js";
import { registerStudioMp4 } from "./studiomp4.js";
import { registerPageApi, registerPageSite, revisionTarget } from "./pageroutes.js";
import { canWatch as sentinelWatcher } from "./sentinel/view.js";
import { noteSignal } from "./sentinel/signals.js";
import { accountFlags, accountOpened, assertEmailSignupPossible, PublicSignupError, emailGateAllows, emailGateBlocks, emailGateBody, publicSignupGate, publicSignupInfo, registerPublicSignupPrivate, registerPublicSignupPublic, setAccountRemover } from "./publicsignup.js";
import { answerCapCard, amountText, CapError, capName, caps as usageCaps, capsView, cleanCapInput, cm } from "./usagecaps.js";

import { MAX_ATTACHMENTS } from "./uploadlimits.js";
import { registerUploadRoutes } from "./uploads.js"; import { noteBrowserTimezone } from "./agent/turnstamp.js"; import { registerTurnControl, typedControl } from "./turncontrolroutes.js"; import { registerMessageActions } from "./messageactionroutes.js"; import { registerInbox } from "./inboxroutes.js"; import { grantAuto } from "./agent/autocontinue.js"; import { applyDraftEdit } from "./agent/draftedit.js";
import { personalResponses } from "./personalresponses.js"; import { checkFloorApproval } from "./floorapproval.js"; import { registerSecurityRoutes } from "./securityroutes.js"; // Lot 1 security
type Env = { Variables: { user: UserRecord } };
export const api = new Hono<Env>();


api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof WorkspaceError) return c.json({ error: err.message }, err.status);
  if (err instanceof MailError) return c.json({ error: err.message }, 400);
  // Hosted mode: a plan limit or a refusal of the account's plan, in the caller's language, with what to do next.
  if (err instanceof HostedError || isPlanLimit(err)) {
    const loc = (c.get("user") as UserRecord | undefined)?.locale ?? pickLocale(undefined, c.req.header("accept-language"));
    return c.json({ error: err.text(loc), code: err instanceof HostedError ? err.code ?? "hosted" : "plan_limit", ...(isPlanLimit(err) ? { limit: err.kind } : {}) }, err instanceof HostedError ? err.status : 403);
  }
  // "Importer depuis Grok Bot" (grokimport.ts): a pasted reply that cannot be read, in the caller's language.
  if (err instanceof GrokImportError) return c.json({ error: err.text((c.get("user") as UserRecord | undefined)?.locale), code: err.code }, err.status);
  // Usage caps (usagecaps.ts): a refusal in the caller's language.
  if (err instanceof CapError) return c.json({ error: err.text((c.get("user") as UserRecord | undefined)?.locale) }, err.status);
  // "Aujourd'hui" (today.ts): a date or a setting that cannot be read.
  if (err instanceof TodayError) return c.json({ error: err.message }, err.status);
  // MAX_BOTS reached: a clear refusal, never a silent eviction.
  if (err instanceof TeamFullError) {
    const loc = (c.get("user") as UserRecord | undefined)?.locale ?? pickLocale(undefined, c.req.header("accept-language"));
    return c.json({ error: tr(loc, "The team is full: this installation holds at most {n} bots. Remove one to create another.", { n: err.max }) }, 409);
  }
  console.error("[api]", err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

// accountFlags (publicsignup.ts): `emailUnverified` / `onboarding`, only present when true.
const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name, locale: u.locale, ...accountFlags(u.id) });
const ownBot = (c: Context<Env>, id = c.req.param("id")): BotRecord => bots.owned(c.get("user").id, id ?? "") ?? fail(404, "That bot does not exist.");
const ownAgent = (c: Context<Env>): BotRecord => { const b = ownBot(c); return b.kind === "agent" ? b : fail(400, "A group chat cannot do that."); };
/**
 * Wave 6: a bot the caller owns, or one shared with them through a workspace, if their role allows `need`. No access at
 * all is a 404 (the bot's existence is not confirmed); access without the needed right is a 403. Every route that is
 * not written with this helper stays owner-only (ownBot).
 */
const accessBot = (c: Context<Env>, need: "view" | "talk" | "manage", id = c.req.param("id")): BotAccess => {
  const a = botAccess(c.get("user").id, id ?? "") ?? fail(404, "That bot does not exist.");
  const ok = need === "view" ? a.canView : need === "talk" ? a.canTalk : a.canManage;
  return ok ? a : fail(403, "Your role in this workspace does not allow that.");
};
/** A user's own bot as the app sees it, with the workspace it is shared to (wave 6). */
const ownBotView = (b: BotRecord) => ({ ...publicBot(b), sharing: b.kind === "agent" ? shares.of(b.id) : null });
/** After a change of members or shares: who sees what is looked up again, and the people concerned refresh. */
function workspaceChanged(userIds: string[]) {
  invalidateAudience();
  for (const u of new Set(userIds)) { emit(u, { type: "workspaces" }); emit(u, { type: "roster" }); }
}
// An approval of a shared bot is also pushed to the workspace's admins when the bot's rule lets them answer it.
onTurnEvent((e) => {
  if (e.type !== "waiting" || !e.approvalId) return;
  for (const u of approversOf(e.bot.id)) if (u !== e.bot.userId) void sendPush(u, { kind: "needs", title: e.bot.name, body: e.text, botId: e.bot.id }).catch(() => {});
});

/** A session, or with two-factor on a pending second step and no session (twofactor.ts): every sign-in comes here. */
const startSession = (c: Context, userId: string, via?: string) => startSessionOrChallenge(c, userId, via);

/** Routes outside /api. */
export const site = new Hono();
// Pages published by bots, in a sandbox (their scripts run as a stranger to this site): pageroutes.ts, pagefiles.ts.
registerPageSite(site);

/** The apps' privacy policy (stores and visitors read it without a session): French and English. */
site.get("/confidentialite", (c) => c.html(privacyPage("fr"), 200, { "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" }));
site.get("/privacy", (c) => c.html(privacyPage("en"), 200, { "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" }));

/** Sklubot's tools for a bot running on a subscription tool; the caller proves it is that bot's computer. */
const mcpRoute = async (c: Context) => {
  // Only the bots' computers call this, directly (their own socket, or the internal network). A request that went
  // through a reverse proxy came from the internet: it is refused (Caddy also blocks /mcp/ itself).
  if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return c.json({ error: "not found" }, 404);
  const env = c.env as { incoming?: IncomingMessage; outgoing?: ServerResponse } | undefined;
  if (!env?.incoming || !env.outgoing) return c.json({ error: "unavailable" }, 503);
  const parsed = await c.req.json().catch(() => undefined);
  await handleMcp(c.req.param("botId")!, env.incoming, env.outgoing, parsed);
  return RESPONSE_ALREADY_SENT;
};
/**
 * H2: in "socket" mode the bots' computers reach these routes only through their own socket (botlink.ts, see
 * botLinkRoutes); this server's web port does not serve them at all, so nothing else on its networks can try them.
 * In "network" mode (a server run directly on this machine) they stay on the web port, as before.
 */
if (config.botLink === "network") {
  site.post("/mcp/:botId", mcpRoute);
  site.on(["GET", "DELETE"], "/mcp/:botId", (c) => c.json({ error: "method not allowed" }, 405));
  /**
   * Wave 7 (spec 08 A1): the credential relay for programs on the bots' computers. Like /mcp/, only reached on the
   * internal network (Caddy answers 404 for /egress/ and requests that went through a proxy are refused).
   */
  site.all("/egress/:botId/*", (c) => handleEgress(c));
}

/**
 * The routes one computer's socket serves (H2): the tool endpoint and the credential relay, and only for the bots that
 * use that computer (`allowed`: its own bot, or the bots of a shared computer). Anything else: 404.
 */
export function botLinkRoutes(allowed: (botId: string) => boolean): Hono {
  const link = new Hono();
  link.use("/:kind/:botId/*", async (c, next) => { if (!allowed(c.req.param("botId"))) return c.json({ error: "not found" }, 404); await next(); });
  link.use("/:kind/:botId", async (c, next) => { if (!allowed(c.req.param("botId"))) return c.json({ error: "not found" }, 404); await next(); });
  link.post("/mcp/:botId", mcpRoute);
  link.post("/personal-plan/:botId/v1/responses", personalResponses);
  link.on(["GET", "DELETE"], "/mcp/:botId", (c) => c.json({ error: "method not allowed" }, 405));
  link.all("/egress/:botId/*", (c) => handleEgress(c));
  link.all("*", (c) => c.json({ error: "not found" }, 404));
  return link;
}
/** Wave 7 (spec 08 A8): a temporary public link to one library file (GET, or HEAD for services that check first). */
site.on(["GET", "HEAD"], "/l/:token", (c) => servePublicLink(c));

// ── Public routes ────────────────────────────────────────────────────────────
// Monitoring (monitor.ts): fast and public, so it says only ok / degraded / down and the first problem's short code.
// `ok: true` means "a Sklubot answers here" (the apps and the companion check it) — also when degraded. HTTP 200 unless
// the database cannot be written or the disk is full ("down": 503), so Docker's / Coolify's healthcheck (curl -f) only
// fails when the server really cannot work. The detail is for the server's owner: GET /api/health/deep.
api.get("/health", async (c) => {
  const r = await healthReport();
  return c.json({ ok: r.status !== "down", status: r.status, code: r.code }, r.status === "down" ? 503 : 200, { "cache-control": "no-store" });
});
// The download page (/telecharger) is public: it is linked from the sign-in page.
api.get("/downloads", (c) => c.json(appDownloads(undefined, releasedDesktopFiles())));

api.get("/me", (c) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  const video: VideoStatus = { provider: videoService()?.id ?? null, higgsfield: !!user && !!higgsfieldFor(user.id) };
  const locale = user?.locale ?? pickLocale(c.req.query("locale"), c.req.header("accept-language"));
  // Hosted mode only (no field at all otherwise): the public pages to link and, signed in, whether this is an operator.
  const hosted = hostedMode() ? { operator: !!user && isOperator(user.id), creditsForSale: hostedSettings.get().creditsForSale, links: locale === "fr" ? { pricing: "/tarifs", terms: "/cgu", legal: "/mentions-legales", privacy: "/confidentialite" } : { pricing: "/pricing", terms: "/terms", legal: "/legal-notice", privacy: "/privacy" } } : undefined;
  // `sentinel`: the signed-in person watches this server (the owner, or a hosted operator): the Surveillance page is theirs.
  const sentinel = !!user && sentinelWatcher(user.id);
  return c.json({ user: user ? publicUser(user) : null, signupOpen: signupOpen(), setupCodeRequired: setupCodeRequired(), imageGeneration: !!imageService(), video, firstBot: firstBotIdentity(locale), ...(hosted ? { hosted } : {}), ...(sentinel ? { sentinel } : {}), ...publicSignupInfo() });
});

// Slows down password guessing: a handful of attempts per account, and a few dozen per client address,
// per quarter hour. The table is bounded, so a flood of made-up addresses cannot grow it without end.
const attempts = new Map<string, { n: number; until: number }>();
const MAX_TRACKED = 10_000;
function throttle(key: string, limit = 8) {
  const t = Date.now();
  const cur = attempts.get(key);
  if (cur && cur.until > t && cur.n >= limit) fail(403, "Too many attempts. Wait a few minutes and try again.");
  attempts.delete(key); // re-inserted below, so the map stays ordered from oldest to newest
  attempts.set(key, cur && cur.until > t ? { ...cur, n: cur.n + 1 } : { n: 1, until: t + 15 * 60_000 });
  if (attempts.size > MAX_TRACKED) {
    for (const [k, v] of attempts) if (v.until <= t) attempts.delete(k);
    for (const k of attempts.keys()) { if (attempts.size <= MAX_TRACKED) break; attempts.delete(k); }
  }
}

/**
 * The client's address. Behind our reverse proxy (TRUST_PROXY=1) it is the last X-Forwarded-For entry,
 * the one the proxy itself added; earlier entries come from the client and are ignored. Otherwise the
 * address of the connection.
 */
function clientIp(c: Context): string {
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  return clientAddress(config.trustProxy, env?.incoming?.socket?.remoteAddress, c.req.header("x-forwarded-for"));
}

// Checked against when the email is unknown, so a wrong address takes as long as a wrong password.
let dummyHash: string | null = null;
const dummyCheck = (password: string) => { dummyHash ??= hashPassword("not-a-real-password"); verifyPassword(password, dummyHash); };

/** The first bot's name and role: chosen at sign-up, else the server's settings, else "Juno" / "Chief of staff". */
export function firstBotIdentity(locale: "fr" | "en", name?: unknown, label?: unknown): { name: string; label: string } {
  const pick = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 60) : "");
  return {
    name: pick(name) || config.firstBotName || "Juno",
    label: pick(label) || config.firstBotLabel || tr(locale, "Chief of staff"),
  };
}

api.post("/auth/signup", async (c) => {
  const b = await body(c);
  // Wave 6: a workspace invitation lets its addressee create an account even when new accounts are closed.
  const invite = typeof b.invite === "string" && b.invite ? invites.peek(b.invite) : null;
  const invited = !!invite && invite.email.toLowerCase() === String(b.email ?? "").trim().toLowerCase();
  // Hosted mode: an operator's plan invitation also opens the door (hosted.ts).
  if (!signupOpen() && !invited && !planInviteOpens(b.planInvite, String(b.email ?? ""))) fail(403, "New accounts are closed on this server.");
  throttle(`signup:${clientIp(c)}`, 20);
  // A fresh install waits for its owner: the first account needs the code the installer printed.
  if (setupCodeRequired() && !setupCodeMatches(String(b.setupCode ?? ""))) fail(403, "The setup code is missing or wrong. It was shown at the end of the installation, and is in the server's .env file (SKLUBOT_SETUP_CODE).");
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail(400, "Enter a valid email address.");
  if (password.length < 8) fail(400, "Choose a password of at least 8 characters.");
  if (users.byEmail(email)) fail(409, "An account with this email already exists.");
  if (config.allowedEmails.length && !config.allowedEmails.includes(email.toLowerCase()) && !invited) fail(403, "This address is not allowed to create an account on this server.");
  const locale = pickLocale(b.locale, c.req.header("accept-language"));
  const firstAccount = users.count() === 0;
  // Mandatory e-mail verification (publicsignup.ts): without SMTP no link can be sent, so password sign-ups are refused
  // (Google still works). Checked before Turnstile, whose token is single use.
  try { assertEmailSignupPossible(firstAccount); } catch (err) { if (err instanceof PublicSignupError) return c.json({ error: err.text(locale), code: err.code }, err.status); throw err; }
  // OPEN_SIGNUP (publicsignup.ts): rate limits, disposable addresses and Turnstile on open sign-ups, before anything is created.
  await publicSignupGate(c, { email, token: b.turnstileToken, first: firstAccount, invited: invited || planInviteOpens(b.planInvite, email) });
  // Hosted mode: the plan the account starts on and the terms of service, checked before anything is created.
  const choice: SignupChoice | null = signupChoice({ plan: b.plan, planInvite: b.planInvite, acceptTerms: b.acceptTerms, email, first: users.count() === 0 });
  // The account's first bot needs a place in the team (MAX_BOTS): checked before anything is created.
  bots.assertRoom();
  const user = users.create(email, String(b.name ?? ""), hashPassword(password), locale);
  accountCreated(user.id, choice);
  // Every account starts with one main bot so there is someone to talk to straight away. Its name and role: what the
  // person chose on the sign-up form, else the server's settings (FIRST_BOT_NAME / FIRST_BOT_LABEL), else the defaults.
  // An account that must confirm its address first gets it only once the address is proven (publicsignup.ts markVerified).
  const first = firstBotIdentity(locale, b.botName, b.botLabel);
  if (!accountOpened(user, { first: firstAccount, verified: false, firstBot: first })) bots.create(user.id, {
    name: first.name, label: first.label, primary: true, shape: "pebble", color: "indigo",
    description: tr(locale, "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots."),
  });
  if (invited) { try { invites.accept(String(b.invite), user.id); invalidateAudience(); } catch { /* used or expired meanwhile: the account stays */ } }
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

/** What an invitation link is for, shown before signing in or up (no session needed; nothing is revealed for a bad link). */
api.get("/invites/:token", (c) => {
  const info = invites.peek(c.req.param("token"));
  return info ? c.json({ invite: info }) : c.json({ error: "This invitation has expired or was already used. Ask for a new one." }, 404);
});

api.post("/auth/login", async (c) => {
  const b = await body(c);
  const email = String(b.email ?? "").trim().toLowerCase();
  throttle(`ip:${clientIp(c)}`, 30);
  throttle(`login:${email}`);
  const user = users.byEmail(email);
  const password = String(b.password ?? "");
  // Each refused password counts for the Sentinelle (a burst of them may be someone trying passwords): the address only.
  if (!user) { dummyCheck(password); noteSignal("login_failure", clientIp(c)); fail(401, "Wrong email or password."); }
  if (!verifyPassword(password, user!.passHash)) { noteSignal("login_failure", clientIp(c)); fail(401, "Wrong email or password."); }
  attempts.delete(`login:${email}`);
  const second = startSession(c, user!.id, "password");
  if (second) return c.json(second);
  audit(user!.id, "account", "Signed in");
  return c.json({ user: publicUser(user!) });
});

/** One-time sign-in link printed on the server's command line (valid 15 minutes, single use). */
api.get("/auth/link", (c) => {
  const token = c.req.query("token") ?? "";
  const row = token ? q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM sign_in_links WHERE token_hash = ?", sha256(token)) : undefined;
  if (row) q.run("DELETE FROM sign_in_links WHERE token_hash = ?", sha256(token));
  // Used, expired or unknown: 410 with a plain page asking for a new link (the link was already deleted above).
  if (!row || row.expires_at < Date.now() || !users.byId(row.user_id)) {
    const loc = pickLocale(undefined, c.req.header("accept-language"));
    const text = tr(loc, "This sign-in link has expired or was already used. Ask for a new one (it is valid 15 minutes and works once).");
    return c.html(`<!doctype html><html lang="${loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sklubot</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f6f6f8;color:#1d1d24}main{max-width:420px;text-align:center;line-height:1.5}a{color:#4f46e5}</style></head><body><main><p>${escHtml(text)}</p><p><a href="/?link=expired">${escHtml(tr(loc, "Back to Sklubot"))}</a></p></main></body></html>`, 410, { "cache-control": "no-store", "referrer-policy": "no-referrer" });
  }
  if (startSession(c, row.user_id, "one-time link")) return c.redirect("/?second=1");
  audit(row.user_id, "account", "Signed in with a one-time link");
  return c.redirect("/");
});

api.post("/auth/logout", (c) => {
  dropSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

registerHookRoutes(api, clientIp); // Webhooks: POST /hooks/:token — signature, repeats, bursts, refusals (hookroutes.ts, L20)

/**
 * "Accès API" (botapi.ts, docs/API-BOT.md): the Bot API and its MCP control server, under /api/v1, authenticated by a
 * bot's API key (Bearer), never by a session — registered here, before the session check, like the webhooks above.
 */
registerBotClients(api);

// The browser comes back here from an app's OAuth sign-in page (the redirect URI shown in the app).
// The state parameter alone identifies the sign-in (single use, 10 minutes); a session, when present, must match it.
const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
api.get("/connectors/oauth/callback", async (c) => {
  const session = userForToken(getCookie(c, SESSION_COOKIE));
  let locale = pickLocale(session?.locale, c.req.header("accept-language"));
  let ok = false;
  let message: string;
  try {
    const r = await connectors.finishSignIn({ state: c.req.query("state") ?? "", code: c.req.query("code"), error: c.req.query("error"), iss: c.req.query("iss") }, session?.id);
    const owner = users.byId(r.userId);
    if (owner) locale = owner.locale;
    ok = r.connector.status === "ready" || !!r.alreadyDone;
    message = r.alreadyDone ? tr(locale, "Already signed in to {name}. You can close this window.", { name: r.connector.name })
      : ok ? tr(locale, "Signed in to {name}. You can close this window.", { name: r.connector.name }) : tr(locale, "Signed in to {name}, but it does not answer yet: {detail}", { name: r.connector.name, detail: r.connector.error ?? "" });
    const bot = r.botId ? bots.owned(r.userId, r.botId) : null;
    if (bot && ok && !r.alreadyDone) {
      if (r.seq !== null) rows.updateCard(bot, bot.generation, r.seq, (k) => (k.type === "connect" ? { ...k, status: "connected" } : k));
      enqueue(bot.id, { kind: "system", text: `The user signed in to ${r.connector.name}. Its tools are available now — continue with what you were doing.` });
    }
  } catch (err) {
    message = tr(locale, "The sign-in did not finish: {detail}", { detail: /[{}]/.test((err as Error).message) ? (err as Error).message : tr(locale, (err as Error).message) });
  }
  return signInPage(c, locale, ok, message);
});

/** The page the browser lands on after an app's sign-in: says how it went, tells the app's other tabs, then closes. */
function signInPage(c: Context, locale: "fr" | "en", ok: boolean, message: string) {
  const back = tr(locale, "Back to Sklubot");
  // Tell the app (any open tab, via BroadcastChannel; the opener when it still exists), then close or go back to the app.
  const script = `try{new BroadcastChannel("sklubot-oauth").postMessage({ok:${ok}})}catch(e){}try{window.opener&&window.opener.postMessage({type:"sklubot-oauth",ok:${ok}},${JSON.stringify(config.publicUrl)})}catch(e){}${ok ? 'setTimeout(function(){window.close();setTimeout(function(){location.replace("/")},400)},1200)' : ""}`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sklubot</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f6f8;color:#1d1d24;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:420px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 6px 30px rgba(0,0,0,.08);text-align:center}p{line-height:1.5}.ok{color:#137a3f}.ko{color:#b3261e}a{color:#4f46e5}@media(prefers-color-scheme:dark){body{background:#15151a;color:#ececf1}main{background:#1f1f26}}</style></head>
<body><main><p class="${ok ? "ok" : "ko"}">${escHtml(message)}</p><p><a href="/">${escHtml(back)}</a></p></main><script>${script}</script></body></html>`;
  // Its own policy (M3): the app's CSP allows only the app's inline script; this page's one is allowed by its hash.
  const csp = `default-src 'none'; script-src 'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`;
  return c.html(html, ok ? 200 : 400, { "referrer-policy": "no-referrer", "cache-control": "no-store", "content-security-policy": csp });
}

// Built-in apps: the vendor sends the browser back here (the redirect URI the user registered in their console).
api.get("/native/:vendor/callback", async (c) => {
  const vendor = c.req.param("vendor") as NativeVendor;
  const session = userForToken(getCookie(c, SESSION_COOKIE));
  let locale = pickLocale(session?.locale, c.req.header("accept-language"));
  if (!VENDORS.includes(vendor)) return c.json({ error: "No such endpoint." }, 404);
  let ok = false;
  let message: string;
  try {
    const acc = await nativeFinish(vendor, { state: c.req.query("state") ?? "", code: c.req.query("code"), error: c.req.query("error") }, session?.id);
    locale = users.localeOf(acc.userId);
    ok = true;
    message = tr(locale, acc.alreadyDone ? "Already signed in to {name}. You can close this window." : "Signed in to {name}. You can close this window.", { name: acc.name });
    if (!acc.alreadyDone) syncSlackSockets();
  } catch (err) {
    message = tr(locale, "The sign-in did not finish: {detail}", { detail: /[{}]/.test((err as Error).message) ? (err as Error).message : tr(locale, (err as Error).message) });
  }
  return signInPage(c, locale, ok, message);
});

// Hosted mode's public routes (plans, plan invitations, payment webhooks) and pages (/tarifs, /cgu…): hostedroutes.ts.
registerHostedPublic(api);
registerHostedPages(site);

// "Continuer avec Google" (googlelogin.ts): same sessions, throttling and sign-up rules as the password routes.
const googleDeps: GoogleDeps = { throttle, clientIp, startSession, publicUser, firstBotIdentity };
registerGooglePublic(api, googleDeps);
// "Mot de passe oublié ?" and the link that confirms a new address (accountmail.ts): same throttling and sessions.
registerAccountMailPublic(api, googleDeps);
// "Ouverture publique" (publicsignup.ts): the landing page's data and the e-mail verification link.
registerPublicSignupPublic(api, googleDeps);
// "Recevoir un lien de connexion par e-mail" (emaillink.ts): passwordless sign-in and sign-up, through the same 2FA gate.
registerEmailLinkPublic(api, googleDeps);
// The second step of a sign-in with two-factor on (twofactor.ts).
registerTwoFactorPublic(api, googleDeps);

// ── Everything below needs a session ─────────────────────────────────────────
api.use("*", async (c, next) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Please sign in." }, 401);
  // State-changing requests must come from our own pages, not from another site using the visitor's cookie.
  // An Origin that is not a URL of this site ("null" from a sandboxed page, garbage) is refused too.
  if (c.req.method !== "GET" && !originAllowed(c.req.header("origin"), c.req.header("host"))) return c.json({ error: "Cross-site request refused." }, 403);
  // Hosted mode: a suspended account is read-only — it can still look, export, sign out, change its own sign-in details
  // and delete itself; nothing else that changes something.
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && suspended(user.id) && !/^(\/api)?\/(account(\/|$)|prefs$|push\/|auth\/|announcements\/|bots\/[^/]+\/read$)/.test(c.req.path))
    return c.json({ error: suspendedText(user.locale), code: "suspended" }, 403);
  // Mandatory e-mail verification (publicsignup.ts): an account whose address is not confirmed may only confirm it,
  // change it, sign out, export or delete itself — every other route answers 403 { code: "email_unverified" }.
  if (emailGateBlocks(user.id) && !emailGateAllows(c.req.method, c.req.path)) return c.json(emailGateBody(user), 403);
  c.set("user", user);
  await next();
});
registerHostedPrivate(api);
registerConnectorCatalog(api);
registerGithubActivity(api,throttle);
registerGithubIssueRoutes(api,throttle);
registerWorkContext(api);
registerPublicSignupPrivate(api);
registerTwoFactorPrivate(api, googleDeps);
registerDataKeyRoutes(api);

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const user = c.get("user");
    const queue: ServerEvent[] = [{ type: "hello", now: Date.now() }];
    let wake: (() => void) | null = null;
    const off = subscribe(user.id, (e) => { queue.push(e); wake?.(); });
    stream.onAbort(() => { off(); wake?.(); });
    try {
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), 20_000);
          wake = () => { clearTimeout(timer); resolve(false); };
        });
        wake = null;
        if (timedOut && !queue.length) queue.push({ type: "ping" });
      }
    } finally { off(); }
  }));

api.put("/prefs", async (c) => {
  const b = await body(c);
  users.setPrefs(c.get("user").id, { locale: b.locale === "fr" || b.locale === "en" ? b.locale : undefined, name: typeof b.name === "string" ? b.name : undefined });
  return c.json({ user: publicUser(users.byId(c.get("user").id)!) });
});

// `bot`: the bot whose settings are open; the subscription tools' real model list is read on its computer first (if on).
const availableModels = async (userId: string, botId?: string) => [
    // Hosted mode: the server's own models only for plans that use the operator's keys (never "bring your own key").
    ...listProviders().filter((p) => p.available() && modelAvailable(`${p.id}:${p.models[0] ?? ""}`, userId)).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m}`, provider: p.label, model: m, kind: "api" as const }))),
    // The user's own providers (Settings → Models): theirs only.
    ...apiProviders.list(userId).filter((p) => p.hasKey).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m.id}`, provider: p.name, model: m.id, kind: "api" as const }))),
    // Hosted mode: an operator's providers lent to this account's plan (by name and models only).
    ...(lentProviderIds(userId).length ? apiProviders.lentTo(userId).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m}`, provider: p.name, model: m, kind: "api" as const }))) : []),
    ...(subscriptionEnginesFor(userId) ? await engineModelsFor(userId, botId) : []),
  ];
api.get("/models", async (c) => c.json({ models: await availableModels(c.get("user").id, c.req.query("bot")), defaultRef: defaultModelRef() }));

// ── The user's own model providers (Settings → Models → API providers) ────────
// The key is accepted here and sealed; no answer ever carries it back (hasKey only).
const providerKey = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const k = String(v).trim();
  if (!k) return undefined;
  if (k.length > 4000 || /[\s\0-\x1f]/.test(k)) fail(400, "That key does not look right.");
  return k;
};
const providerFields = (b: Record<string, any>, partial: boolean) => {
  const out: { name?: string; baseUrl?: string; models?: ReturnType<typeof cleanModels>; images?: boolean } = {};
  if (b.name !== undefined || !partial) { const n = String(b.name ?? "").trim().slice(0, 60); if (!n) fail(400, "Give this provider a name."); out.name = n; }
  if (b.baseUrl !== undefined || !partial) out.baseUrl = cleanBaseUrl(b.baseUrl) ?? fail(400, "The address must be an https address, like https://api.example.com/v1.");
  if (b.models !== undefined || !partial) out.models = cleanModels(b.models);
  if (b.images !== undefined) out.images = !!b.images;
  return out;
};
/** A private or local address is refused at once (the outbound guard would refuse every call to it anyway). */
async function publicProviderUrl(base: string | undefined) {
  if (!base) return;
  try { await assertPublicUrl(base); } catch (err) { if (err instanceof BlockedAddressError) fail(400, "That address is on a private or local network, which this server does not reach."); }
}
api.get("/api-providers", (c) => c.json({ providers: apiProviders.list(c.get("user").id), presets: PRESETS }));
api.post("/api-providers", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const preset = typeof b.preset === "string" && b.preset in PRESETS ? b.preset : "";
  const f = providerFields(b, false);
  await publicProviderUrl(f.baseUrl);
  try {
    const p = apiProviders.create(user.id, { name: f.name!, baseUrl: f.baseUrl!, key: providerKey(b.key) ?? null, models: f.models!, preset, images: f.images ?? (preset ? PRESETS[preset as keyof typeof PRESETS].images : true) });
    audit(user.id, "apps", `Model provider added: ${p.name} (${p.baseUrl})`);
    return c.json({ provider: p });
  } catch (err) { return fail(400, (err as Error).message); }
});
api.patch("/api-providers/:id", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const f = providerFields(b, true);
  await publicProviderUrl(f.baseUrl);
  const p = apiProviders.update(user.id, c.req.param("id"), { ...f, key: providerKey(b.key) }) ?? fail(404, "That provider does not exist.");
  audit(user.id, "apps", `Model provider changed: ${p.name}`);
  return c.json({ provider: p });
});
api.delete("/api-providers/:id", (c) => {
  const user = c.get("user");
  const p = apiProviders.get(user.id, c.req.param("id")) ?? fail(404, "That provider does not exist.");
  apiProviders.remove(user.id, p.id);
  audit(user.id, "apps", `Model provider removed: ${p.name}`);
  return c.json({ ok: true });
});
// Read the provider's model list, or try the key: with the key typed in the form, else the saved one.
api.post("/api-providers/models", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  throttle(`provider-check:${user.id}`, 20);
  const id = typeof b.id === "string" && apiProviders.get(user.id, b.id) ? b.id : null;
  const base = cleanBaseUrl(b.baseUrl) ?? fail(400, "The address must be an https address, like https://api.example.com/v1.");
  return c.json(await fetchModels(user.id, base, id, providerKey(b.key) ?? null));
});
api.post("/api-providers/test", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  throttle(`provider-check:${user.id}`, 20);
  const id = typeof b.id === "string" && apiProviders.get(user.id, b.id) ? b.id : null;
  const base = cleanBaseUrl(b.baseUrl) ?? fail(400, "The address must be an https address, like https://api.example.com/v1.");
  const model = typeof b.model === "string" && /^[A-Za-z0-9._:/@+-]{1,100}$/.test(b.model) ? b.model : null;
  return c.json(await testProvider(user.id, base, id, providerKey(b.key) ?? null, model));
});

// ── Bots ─────────────────────────────────────────────────────────────────────
api.get("/bots", (c) => {
  const list = bots.list(c.get("user").id);
  // Wave 6: bots others share with this user through a workspace come after their own, marked with what they may do.
  const shared = sharedBotsFor(c.get("user").id);
  return c.json({
    bots: [...list.map(ownBotView), ...shared.map(sharedBotView)],
    live: Object.fromEntries([...list.map((b) => [b.id, getLive(b.id)]), ...shared.map((a) => [a.bot.id, getLive(a.bot.id)])]),
  });
});

api.post("/bots", async (c) => {
  const b = await body(c);
  if (!String(b.name ?? "").trim()) fail(400, "Give the bot a name.");
  const userId = c.get("user").id;
  if (b.model !== undefined && (typeof b.model !== "string" || (b.model && !(await availableModels(userId)).some((m) => m.ref === b.model)))) fail(400, tr(c.get("user").locale, "Choose an available model."));
  const bot = bots.create(userId, { model: b.model, name: b.name, label: b.label, description: b.description, instructions: b.instructions, shape: b.shape, color: b.color, mode: b.mode, primary: !!b.primary, character: b.character, autonomy: newBotAutonomy(b.autonomy) });
  emit(bot.userId, { type: "roster" });
  return c.json({ bot: publicBot(bot) });
});

api.patch("/bots/:id", async (c) => {
  const a = accessBot(c, "manage");
  const bot = a.bot;
  let patch = await body(c);
  // An admin of the workspace changes only the bot's identity and instructions — never its model, autonomy, tools or budget.
  if (!a.owner) {
    patch = Object.fromEntries(Object.entries(patch).filter(([k]) => (SHARED_SETTINGS as readonly string[]).includes(k)));
    wsAudit(a.share!.workspaceId, c.get("user").id, "settings", `${bot.name}: ${Object.keys(patch).join(", ") || "nothing"} changed`);
  }
  bots.patch(bot.id, patch);
  bots.announce(bot);
  // "Pause": a bot moved into a paused section is paused with it; moved out, it is free again (agent/pause.ts).
  if (a.owner && patch.sectionId !== undefined && (patch.sectionId ?? null) !== bot.sectionId) afterMove(c.get("user"), bot.id, !!bot.pause);
  // Wave 7: switching the credential relay off revokes this computer's token at once (and clears its relay file).
  if (patch.relayEnabled === false && bot.relayEnabled) void disableRelay(bot);
  if (typeof patch.relayEnabled === "boolean" && patch.relayEnabled !== bot.relayEnabled) audit(bot.userId, "computer", `${bot.name}: credential relay ${patch.relayEnabled ? "on" : "off"}`, bot.id);
  // Part B: own computer or shared one. The change applies from the bot's next use of its computer.
  if ((patch.computerMode === "own" || patch.computerMode === "shared") && patch.computerMode !== bot.computerMode) {
    audit(bot.userId, "computer", `${bot.name}: ${patch.computerMode === "shared" ? "uses a shared computer" : "uses its own computer"}`, bot.id);
    if (patch.computerMode === "shared" && computerKind() === "linux") sharedComputers.ensure(bot.userId);
    emit(bot.userId, { type: "computer", computer: computerState(bot.userId) });
  }
  // A new name, role, shape or colour shows on the bot's computer (only if it has one: U-005).
  if (["name", "label", "color", "shape", "character"].some((k) => patch[k] !== undefined)) void screen.redress(bot.id).catch(() => {});
  if (!a.owner) return c.json({ bot: sharedBotView(botAccess(c.get("user").id, bot.id)!) });
  return c.json({ bot: ownBotView(bots.byId(bot.id)!) });
});

api.delete("/bots/:id", async (c) => {
  const bot = ownBot(c);
  if (bot.primary) fail(409, "Make another bot your main contact before deleting this one.");
  // Interrupt, routines and triggers, engine, screen, files, then the record: each failure logged, none blocking (U-003).
  await retireBot(bot);
  usageCaps.forgetBot(bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/primary", (c) => {
  const bot = ownAgent(c);
  bots.makePrimary(bot.userId, bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/read", (c) => {
  // The unread mark is the owner's: someone of the workspace opening the chat leaves it as it is.
  if (!accessBot(c, "view").owner) return c.json({ ok: true });
  const bot = ownBot(c);
  bots.setUnread(bot.id, 0);
  bots.announce(bot);
  return c.json({ ok: true });
});

/** "Mark as unread": the bot shows an unread badge until it is opened again. */
api.post("/bots/:id/unread", (c) => {
  const bot = ownBot(c);
  bots.markUnread(bot.id);
  bots.announce(bot);
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

/** A copy of a bot: settings, look, instructions and skills; its memories and current conversation only when asked. */
api.post("/bots/:id/duplicate", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const copy = bots.duplicate(bot, { name: typeof b.name === "string" ? b.name : undefined, memories: b.memories === true, conversation: b.conversation === true });
  audit(bot.userId, "account", `Bot duplicated: ${bot.name} → ${copy.name}`, copy.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ bot: publicBot(copy) });
});

// ── Sidebar sections ─────────────────────────────────────────────────────────
registerSectionRoutes(api); registerStopCauseRoutes(api); registerPersonalCommandRoutes(api); registerDoctorRoutes(api); // L142 stop-cause chips (stopcauseroutes.ts) ; L152 personal / commands ; L153 « Docteur » (doctorroutes.ts)

// ── Pause (agent/pause.ts) ───────────────────────────────────────────────────
// Owner only: pausing decides about the owner's bots, spend and subscriptions. Someone of a workspace a bot is shared
// with — viewer, member or admin — cannot pause or resume it (ownAgent / sections.owned answer 404, as for any other
// account's thing); a stranger's call to "everything" pauses only their own bots. Each change is an audit line.
// "Accès API" (botapi.ts): the owner's API keys of one bot — owner only (a workspace member never manages them).
registerBotClientSettings(api, (c) => ownAgent(c as Context<Env>)); registerChannelRoutes(api, (c) => ownAgent(c as Context<Env>)); // L162: Slack, Discord, IMAP, access requests

api.get("/pauses", (c) => c.json(pauses.state(c.get("user").id)));
api.post("/bots/:id/pause", (c) => { const bot = ownAgent(c); return c.json(setPause(c.get("user"), "bot", bot.id, true, bot.name)); });
api.post("/bots/:id/resume", (c) => { const bot = ownAgent(c); return c.json(setPause(c.get("user"), "bot", bot.id, false, bot.name)); });
api.post("/sections/:id/pause", (c) => {
  const user = c.get("user");
  const sec = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
  return c.json(setPause(user, "section", sec.id, true, sec.name));
});
api.post("/sections/:id/resume", (c) => {
  const user = c.get("user");
  const sec = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
  return c.json(setPause(user, "section", sec.id, false, sec.name));
});
/** "Tout mettre en pause" / "Tout reprendre": `{ paused: true | false }`. Resuming everything leaves bots and sections paused on their own. */
api.post("/pauses/all", async (c) => {
  const b = await body(c);
  if (typeof b.paused !== "boolean") fail(400, "Say paused: true or false.");
  return c.json(setPause(c.get("user"), "all", "", b.paused));
});

// ── Conversation ─────────────────────────────────────────────────────────────
api.get("/bots/:id/rows", (c) => {
  const bot = accessBot(c, "view").bot;
  const before = Number(c.req.query("before")) || undefined;
  // ?thread=<seq>: the replies of the thread on that message instead of the main chat.
  const thread = Math.max(0, Number(c.req.query("thread")) || 0);
  return c.json({ generation: bot.generation, thread, rows: rows.list(bot.id, bot.generation, Number(c.req.query("limit")) || 200, before, thread) });
});

/**
 * Wave 6: someone of the workspace writes to a bot they do not own. Text only (the owner's library is not theirs to
 * attach to), marked as theirs (origin "member": never the owner's words), and it starts its own careful turn.
 */
async function memberMessage(c: Context<Env>, access: BotAccess, b: Record<string, any>) {
  const bot = access.bot;
  const user = c.get("user");
  // A secret pasted by a member is masked and dropped (the vault it could go in is the owner's, not theirs).
  const text = screenSecrets(String(b.text ?? "").trim(), user.locale).text;
  if (!text) fail(400, "Write a message first.");
  if (text.length > 20_000) fail(413, "That message is too long.");
  throttle(`member-msg:${user.id}:${bot.id}`, 60);
  const thread = threadParent(bot, b.thread);
  const voice = b.origin === "voice";
  const row = rows.append(bot, { kind: "message", role: "user", text, origin: { kind: "member", id: user.id, name: user.name } }, thread);
  submitMemberMessage(bot, text, { id: user.id, name: user.name, role: access.role!, workspace: access.share!.workspaceName }, voice, thread);
  return c.json({ row });
}

/** The message of the current conversation a thread hangs on: a message of the main chat. */
function threadParent(bot: BotRecord, raw: unknown): number {
  if (raw === undefined || raw === null || raw === "" || raw === 0) return 0;
  const seq = Number(raw);
  const parent = Number.isInteger(seq) && seq > 0 ? rows.get(bot.id, bot.generation, seq) : null;
  if (!parent || parent.thread || parent.body.kind !== "message") fail(400, "That message cannot have a thread.");
  return seq;
}

// Reactions: the user puts (or takes back) one of a few emoji under any message. A reaction on a bot's
// message reaches that bot as a short note at the start of its next turn in that chat or thread.
api.post("/bots/:id/rows/:seq/reactions", async (c) => {
  const bot = ownBot(c);
  const emoji = String((await body(c)).emoji ?? "") as ReactionEmoji;
  if (!(REACTIONS as readonly string[]).includes(emoji)) fail(400, "That reaction is not available.");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "message" || row.body.streaming) return fail(400, "Only a message can get a reaction.");
  const user = c.get("user");
  const list = rows.react(bot, bot.generation, row.seq, { emoji, by: "user", name: user.name })!;
  const on = list.some((r) => r.emoji === emoji && r.by === "user"); roomReaction(bot, user, row.seq, emoji, on); // a 👍 on a waiting offer
  const b = row.body;
  // Whose message it is: this bot's own reply, or (in a group chat) the member bot that posted it.
  const author = b.role === "assistant" ? (b.origin?.kind === "bot" ? bots.owned(user.id, b.origin.id) : bot.kind === "agent" ? bot : null) : null;
  if (author && author.kind === "agent") {
    const where = bot.kind === "room" ? ` in the group chat "${bot.name}"` : "";
    const note = `The user reacted ${emoji} to your message${where} "${clip(b.text.replace(/\s+/g, " ").trim() || "(a file)", 100)}".`;
    // In a group chat the member hears about it in its own chat; in the bot's own chat, in the thread the message belongs to.
    const thread = bot.kind === "room" ? 0 : row.thread ?? 0;
    if (on) feedback.add(author.id, author.generation, thread, bot.kind === "room" ? -row.seq : row.seq, emoji, note);
    else feedback.drop(author.id, author.generation, bot.kind === "room" ? -row.seq : row.seq, emoji);
  }
  return c.json({ reactions: list });
});

api.post("/bots/:id/messages", (c) => sendOnce(c, accessBot(c, "talk").bot.id, async () => { // one message per send key (sendkeys.ts)
  const access = accessBot(c, "talk");
  const b = await body(c); noteBrowserTimezone(c.get("user").id, c.req.header("x-time-zone")); // L92 (agent/turnstamp.ts)
  if (!access.owner) return memberMessage(c, access, b);
  const bot = access.bot;
  // A pasted secret (a key, a token, a password) is masked before anything is stored or sent to a model; the owner
  // gets a card to put it in the vault, or forget it (pastedsecrets.ts).
  const screened = screenSecrets(String(b.text ?? "").trim(), c.get("user").locale);
  const text = screened.text;
  let agentText = text;
  if (b.artifact !== undefined) {
    const target = typeof b.artifact === "string" && revisionTarget(c.get("user").id, bot.id, b.artifact);
    if (!target) return c.json({ error: c.get("user").locale === "fr" ? "Outil introuvable." : "Tool not found." }, 404);
    if (b.artifactVersion !== target.version) return c.json({ error: c.get("user").locale === "fr" ? "Cet outil vient de changer. Rouvre sa dernière version." : "This tool has changed. Reopen its latest version." }, 409);
    agentText = `${target.instruction}\n\n${text}`;
  }
  // Only files this bot already holds under uploads/ can be attached; anything else is ignored.
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, MAX_ATTACHMENTS)
    .map((p: unknown) => (typeof p === "string" && p.startsWith("uploads/") ? attachmentAt(bot.id, p) : null))
    .filter((a: Attachment | null): a is Attachment => !!a);
  if (!text && !attachments.length) fail(400, "Write a message first.");
  if (text.length > 100_000) fail(413, "That message is too long.");
  const voice = b.origin === "voice";
  // `thread`: a reply in the thread on that message of the main chat.
  const thread = threadParent(bot, b.thread);
  // Goal mode (see below): the objective is checked before anything is written.
  const objective = bot.kind === "agent" ? (b.goal === true ? goalCommand(text) ?? text : goalCommand(text)) : null;
  if (objective !== null && !objective.trim()) fail(400, "Write the objective after /objectif.");
  const row = rows.append(bot, { kind: "message", role: "user", text, origin: voice ? { kind: "voice", id: "", name: "Voice" } : undefined, attachments: attachments.length ? attachments : undefined }, thread);
  if (screened.secrets.length) holdAndOffer(bot, c.get("user").id, screened.secrets, thread);
  // Goal mode: "/objectif …" (or "/goal …"), or the composer's "Objectif" switch: this message becomes the objective of a
  // goal the bot keeps working on across rounds (agent/goals.ts). Its card follows the message.
  let goalId: string | undefined;
  if (objective !== null && bot.kind === "agent") {
    goalId = createGoal(bot, { objective, thread, origin: "user", maxRounds: Number(b.goalMaxRounds) || undefined }).id;
  }
  if (bot.kind === "agent" && !attachments.length && objective === null && await typedControl(bot, c.get("user"), text, thread)) return c.json({ row }); // L63 typed stop, L78 /btw and /apres
  if (bot.kind === "room") dispatchToRoom(bot, c.get("user"), text, null, 0, false, thread);
  else { relayUserSpoke(bot.id); submitUserMessage(bot, agentText, voice, attachments, undefined, thread, skillCommand(bot, text), goalId); }
  return c.json({ row });
}));

/**
 * "/skill <name> …" at the start of a message: the bot is told to follow that skill (its own, or one a teammate shared).
 * The longest skill name that the text starts with wins, so names with spaces work. The chat shows the text as typed.
 */
export function skillCommand(bot: BotRecord, text: string): ForcedSkill | undefined {
  const m = /^\/skill\s+([\s\S]+)$/i.exec(text.trim());
  if (!m) return undefined;
  const rest = m[1].toLowerCase();
  const found = skills.available(bot.id).filter((k) => rest === k.name.toLowerCase() || rest.startsWith(k.name.toLowerCase() + " ") || rest.startsWith(k.name.toLowerCase() + "\n")).sort((a, b) => b.name.length - a.name.length)[0];
  // The whole skill, with what it needs, the steps that need approval, the check and what to hand back (skillText).
  if (found) return { name: found.name, body: skillText(found), from: found.own ? undefined : found.botName };
  // An unknown name still reaches the bot, which says so instead of guessing.
  return { name: m[1].split(/\s/)[0], body: "(There is no skill by this name: tell the user, and list the skills you do have.)" };
}

/** The goal card's buttons: pause, resume, stop; accept or decline a goal the bot proposed. */
api.post("/bots/:id/goals/:goalId", async (c) => {
  const bot = ownAgent(c);
  const action = String((await body(c)).action ?? "");
  if (!["pause", "resume", "stop", "accept", "decline"].includes(action)) fail(400, "Unknown action.");
  try { return c.json({ goal: goalCardOf(goalAction(bot, c.req.param("goalId"), action as "pause")) }); }
  catch (err) { if (err instanceof GoalError) return fail(err.status, err.message); throw err; }
});
api.get("/bots/:id/goals", (c) => c.json({ goals: goals.forBot(ownAgent(c).id).map(goalCardOf) }));
const goalCardOf = (g: NonNullable<ReturnType<typeof goals.byId>>) => ({ id: g.id, objective: g.objective, status: g.status, rounds: g.rounds, maxRounds: g.maxRounds, thread: g.thread, summary: g.summary, reason: g.reason });

/** Background jobs on the bot's computer (jobs.ts), for its computer panel, and the Stop button there. */
api.get("/bots/:id/jobs", (c) => c.json({ jobs: publicJobs(ownAgent(c).id) }));
api.post("/bots/:id/jobs/:jobId/stop", async (c) => {
  const bot = ownAgent(c);
  try { await stopJob(bot, workspaceOf(bot.id), c.req.param("jobId"), "stopped by you"); }
  catch (err) { return fail(404, (err as Error).message); }
  audit(bot.userId, "computer", `${bot.name}: background job ${c.req.param("jobId")} stopped`, bot.id);
  return c.json({ jobs: publicJobs(bot.id) });
});

/** "Continue" under a notice that says the bot stopped at its step limit. */
api.post("/bots/:id/rows/:seq/continue", async (c) => {
  const bot = ownAgent(c); const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if ((await body(c)).auto === true && row?.body.kind === "notice" && row.body.action?.kind === "continue" && row.body.action.status === "pending") grantAuto(bot.id, row.thread ?? 0); // L72 « Continuer seul jusqu'au bout »
  if (!continueAfterStepLimit(bot, Number(c.req.param("seq")))) fail(409, "There is nothing to continue here.");
  return c.json({ ok: true });
});

/** "Undo" under a line saying the bot changed its own settings (self_update). */
api.post("/bots/:id/rows/:seq/undo", (c) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "event" || !row.body.undo || row.body.undo.status !== "available") fail(409, "There is nothing to undo here.");
  const ev = row!.body as Extract<RowBody, { kind: "event" }>;
  if (!undoRevision(bot, ev.undo!.revisionId)) fail(409, "That change was already undone.");
  rows.rewrite(bot, row!.generation, row!.seq, { ...ev, undo: { revisionId: ev.undo!.revisionId, status: "undone" } });
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

// ── Reliability (backup models, retries, continuations) and the shared profile ──
const reliabilityOf = (userId: string) => ({ ...settings.reliability(userId), envFallbacks: config.fallbackModels });
api.get("/reliability", (c) => c.json(reliabilityOf(c.get("user").id)));
api.put("/reliability", async (c) => {
  const b = await body(c);
  const int = (v: unknown, max: number) => (v === undefined ? undefined : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : fail(400, `Pick a number from 0 to ${max}.`));
  if (b.fallbackModels !== undefined && !Array.isArray(b.fallbackModels)) fail(400, "fallbackModels must be a list.");
  settings.saveReliability(c.get("user").id, {
    ...(b.fallbackModels !== undefined ? { fallbackModels: cleanModelList(b.fallbackModels) } : {}),
    ...(b.maxRetries !== undefined ? { maxRetries: int(b.maxRetries, RELIABILITY_LIMITS.maxRetries) } : {}),
    ...(b.maxContinuations !== undefined ? { maxContinuations: int(b.maxContinuations, RELIABILITY_LIMITS.maxContinuations) } : {}),
    ...(b.mutualAid !== undefined ? { mutualAid: typeof b.mutualAid === "boolean" ? b.mutualAid : fail(400, "mutualAid must be true or false.") } : {}),
  });
  return c.json(reliabilityOf(c.get("user").id));
});
api.get("/profile", (c) => c.json({ profile: settings.profile(c.get("user").id) }));
api.put("/profile", async (c) => {
  const r = cleanProfile(await body(c));
  if ("error" in r) fail(400, r.error);
  const user = c.get("user");
  const profile = settings.saveProfile(user.id, "fields" in r ? r.fields : {});
  audit(user.id, "account", "Shared profile updated");
  emit(user.id, { type: "profile" });
  return c.json({ profile });
});
/** Which official API x_search uses here, if any. */
api.get("/x-search", (c) => c.json({ provider: xSearchProvider(c.get("user").id) }));
registerResearch(api);

registerUploadRoutes(api, ownAgent);

registerTurnControl(api, ownBot); // L63 "Stop" (cascade) and "Tout arrêter", L94 « Reprendre ma note » (turncontrolroutes.ts)
registerMessageActions(api, ownAgent); registerInbox(api); // L136 edit / write again / branch, L98 « Annuler », L139 « À toi »

api.post("/bots/:id/reset", (c) => {
  const bot = ownBot(c);
  interrupt(bot.id);
  const generation = bots.resetConversation(bot.id);
  emit(bot.userId, { type: "reset", botId: bot.id, generation });
  bots.announce(bot);
  return c.json({ generation });
});

api.post("/approvals/:approvalId", async (c) => {
  const b = await body(c); const decision = b.decision;
  if (!["allow", "always", "conversation", "deny"].includes(decision)) fail(400, "Unknown decision."); // "conversation": agent/conversationgrants.ts
  const user = c.get("user");
  const approval = approvals.byId(c.req.param("approvalId")); if (approval && (approval.userId === user.id || botAccess(user.id, approval.botId)?.canApprove)) checkFloorApproval(approval.userId, user.id, approval, decision, b.code); // L44 (option)
  // Wave 6: an admin of the workspace answers for the owner of a shared bot, when the bot's rule allows it.
  if (approval && approval.userId !== user.id) {
    const a = botAccess(user.id, approval.botId);
    if (!a || !a.canApprove) fail(404, "That request no longer exists.");
    if (!decideApproval(approval.userId, approval.id, decision === "conversation" ? "allow" : decision, { id: user.id, name: user.name })) fail(404, "That request no longer exists.");
    wsAudit(a!.share!.workspaceId, user.id, "approval", `${a!.bot.name}: ${approval.tool} — ${decision === "deny" ? "refused" : "allowed once"}`);
    return c.json({ ok: true });
  }
  if (b.draft !== undefined && decision !== "deny") { const why = applyDraftEdit(user.id, c.req.param("approvalId"), b.draft); if (why) fail(409, why); } // L83: the words corrected on the card (agent/draftedit.ts)
  if (!(decision === "conversation" ? decideForConversation(user.id, c.req.param("approvalId")) : decideApproval(user.id, c.req.param("approvalId"), decision))) fail(404, "That request no longer exists.");
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/answer", async (c) => {
  const bot = ownBot(c);
  const screened = screenSecrets(String((await body(c)).answer ?? "").trim(), c.get("user").locale);
  const answer = screened.text;
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card" || row.body.card.type !== "question") fail(400, "That is not a question.");
  if (!answer) fail(400, "Pick or write an answer.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "answered", answer } : k));
  // A question asked in a thread is answered in that thread.
  const thread = row!.thread ?? 0;
  rows.append(bot, { kind: "message", role: "user", text: answer }, thread);
  if (screened.secrets.length) holdAndOffer(bot, c.get("user").id, screened.secrets, thread);
  submitUserMessage(bot, `(Answering your question "${card?.type === "question" ? card.question : ""}")\n${answer}`, false, [], undefined, thread);
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/dismiss", (c) => {
  const bot = ownBot(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card") fail(400, "That is not a card.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  if (card?.type === "connect" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "connect" ? { ...k, status: "skipped" } : k));
    enqueue(bot.id, { kind: "system", text: `The user chose not to connect ${card.name}. Carry on without it, or say what cannot be done.` });
  } else if (card?.type === "question" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "dismissed" } : k));
  } else if (card?.type === "secret" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "secret" ? { ...k, status: "dismissed" } : k));
    enqueue(bot.id, { kind: "system", text: `The user chose not to give the secret "${card.name}". Carry on without it, or say what cannot be done.`, thread: row!.thread || undefined });
  }
  return c.json({ ok: true });
});

/**
 * The secure card of secret_request: the value goes from the user's browser straight into the vault, sealed. It is
 * never written to the chat, the bot's history or the activity log, and no API returns it.
 */
api.post("/bots/:id/cards/:seq/secret", async (c) => {
  const bot = ownAgent(c);
  const user = c.get("user");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "secret" ? row.body.card : fail(400, "That is not a secret request.");
  if (card.status !== "pending") fail(409, "This request was already answered.");
  const b = await body(c);
  const value = typeof b.value === "string" ? b.value.trim() : "";
  if (!value) fail(400, "Type the secret first.");
  if (value.length > 8000) fail(400, "That secret is too long.");
  const host = siteOf(typeof b.host === "string" && b.host.trim() ? b.host : card.host);
  if (!host) fail(400, "Say which host the secret may be sent to.");
  const header = typeof b.header === "string" && b.header.trim() ? b.header.trim() : card.header;
  if (!HEADER_OK(header)) fail(400, "That header name cannot carry a secret.");
  const prefix = typeof b.prefix === "string" ? b.prefix.slice(0, 40) : card.prefix;
  const existing = vault.byName(user.id, card.name);
  if (existing && existing.kind !== "secret") fail(409, "A vault item with this name already exists and is not a secret.");
  const fields: VaultFields = { kind: "secret", name: card.name, site: "", username: "", passwordEnc: seal(value), note: existing?.note ?? clip(card.reason, 500), hosts: [host], header, prefix };
  if (existing) vault.update(existing.id, fields); else vault.create(user.id, fields);
  audit(user.id, "vault", `Secret saved from ${bot.name}'s request: ${card.name} (for ${host})`, bot.id);
  emit(user.id, { type: "vault" });
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "secret" ? { ...k, host, header, prefix, status: "saved" } : k));
  enqueue(bot.id, { kind: "system", text: `The user saved the secret "${card.name}" for ${host}. Use it with secret_use (secret: "${card.name}") — you will not see its value. Continue with what you were doing.`, thread: row!.thread || undefined });
  return c.json({ ok: true });
});

/**
 * The card of a secret pasted in a message (pastedsecrets.ts): "save" seals the held value in the vault as a secret for
 * the host the user names; "discard" forgets it. The value comes from the server's memory, never from the browser, and
 * is never written anywhere else. Owner only.
 */
api.post("/bots/:id/cards/:seq/pasted-secret", async (c) => {
  const bot = ownBot(c);
  const user = c.get("user");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "pastedsecret" ? row.body.card : fail(400, "That is not a pasted secret.");
  if (card.status !== "pending") fail(409, "This was already answered.");
  const b = await body(c);
  const setStatus = (status: "saved" | "discarded" | "expired", extra: { name?: string; host?: string } = {}) =>
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "pastedsecret" ? { ...k, ...extra, status } : k));
  if (b.action === "discard") {
    forgetHeld(card.pendingId);
    setStatus("discarded");
    return c.json({ ok: true });
  }
  if (b.action !== "save") fail(400, "Unknown action.");
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) fail(400, "Give this secret a name.");
  const host = siteOf(b.host);
  if (!host) fail(400, "Say which host the secret may be sent to.");
  const header = typeof b.header === "string" && b.header.trim() ? b.header.trim() : "Authorization";
  if (!HEADER_OK(header)) fail(400, "That header name cannot carry a secret.");
  const prefix = typeof b.prefix === "string" ? b.prefix.slice(0, 40) : header.toLowerCase() === "authorization" ? "Bearer " : "";
  const existing = vault.byName(user.id, name);
  if (existing && existing.kind !== "secret") fail(409, "A vault item with this name already exists and is not a secret.");
  const value = takeHeld(user.id, bot.id, card.pendingId);
  if (!value) { setStatus("expired"); return fail(409, "The pasted value is no longer held (it is kept 30 minutes, and not across a restart). Paste it again, or add it in Settings → Vault."); }
  const fields: VaultFields = { kind: "secret", name, site: "", username: "", passwordEnc: seal(value), note: existing?.note ?? "Pasted in a chat message", hosts: [host], header, prefix };
  if (existing) vault.update(existing.id, fields); else vault.create(user.id, fields);
  audit(user.id, "vault", `Secret saved from a pasted message in ${bot.name}'s chat: ${name} (for ${host})`, bot.id);
  emit(user.id, { type: "vault" });
  setStatus("saved", { name, host });
  if (bot.kind === "agent") enqueue(bot.id, { kind: "system", text: `The user saved the secret they pasted (shown to you as a masked placeholder) in the vault as "${name}", for ${host}. Use it with secret_use (secret: "${name}") when it is needed — you will not see its value.`, thread: row!.thread || undefined });
  return c.json({ ok: true });
});

/** "I'm done, hand it back": the bot that asked for the user (ask_takeover) carries on. */
api.post("/bots/:id/takeover/:takeoverId/done", (c) => {
  const bot = ownAgent(c);
  const id = c.req.param("takeoverId");
  const row = rows.all(bot.id, bot.generation).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "takeover" && r.body.card.takeoverId === id);
  if (!row) fail(404, "That request no longer exists.");
  releaseControl(bot.id);
  noteHandBack(bot.id);
  audit(bot.userId, "system", `${bot.name}: screen handed back by the user`, bot.id);
  if (!finishTakeover(id, bot.id)) {
    // Nothing waits any more (a restart, or it timed out): the bot hears about it in a new turn.
    const card = row!.body.kind === "card" && row!.body.card.type === "takeover" ? row!.body.card : null;
    if (card?.status === "pending") {
      rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "takeover" ? { ...k, status: "done" } : k));
      enqueue(bot.id, { kind: "system", text: "The user finished what you asked them to do on your screen and handed it back. Look at the screen, then carry on.", thread: row!.thread || undefined });
    }
  }
  return c.json({ ok: true });
});

// ── Knowledge and automation ─────────────────────────────────────────────────
api.get("/bots/:id/bundle", (c) => {
  const bot = ownBot(c);
  return c.json({ memories: memories.list(bot.id), skills: skills.list(bot.id), routines: routines.forBot(bot.id).map((r) => publicRoutine(r, c.get("user").locale)), tasks: tasks.forBot(bot.id), memoryStatus: memoryStatus(bot), bgTasks: bot.kind === "agent" ? bgTasks.forBot(bot.id).map(publicTask) : [] });
});

/** The structured parts of a skill that a body or a file gives as strings (needs, check, output, approvals); others are left out. */
function extrasOf(b: Record<string, any>): Partial<SkillExtras> {
  const out: Partial<SkillExtras> = {};
  for (const k of SKILL_EXTRA_KEYS) if (typeof b?.[k] === "string") out[k] = b[k].trim().slice(0, 2000);
  return out;
}

function skillFields(b: Record<string, any>, base?: { name: string; description: string; body: string }) {
  const name = (b.name === undefined ? base?.name ?? "" : String(b.name)).trim().slice(0, 80);
  const description = (b.description === undefined ? base?.description ?? "" : String(b.description)).trim().slice(0, 300);
  const text = (b.body === undefined ? base?.body ?? "" : String(b.body)).trim().slice(0, 20_000);
  if (!name) fail(400, "Give the skill a name.");
  if (!text) fail(400, "Write the steps for this skill.");
  return { name, description, body: text, ...extrasOf(b) };
}

api.post("/bots/:id/skills", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const f = skillFields(b);
  return c.json({ skill: skills.create(bot.id, f.name, f.description, f.body, b.shared === true, {}, f) });
});
api.patch("/skills/:id", async (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  const b = await body(c);
  // `draft: false` activates an imported skill (the bot gets it from then on).
  const skill = skills.update(cur.id, { ...skillFields(b, cur), shared: typeof b.shared === "boolean" ? b.shared : undefined, draft: typeof b.draft === "boolean" ? b.draft : undefined });
  if (cur.draft && !skill.draft) audit(c.get("user").id, "account", `Skill activated: ${skill.name}`, cur.botId);
  return c.json({ skill });
});
/** Skills a bot can follow: its own and those its teammates shared (for "/skill" in the composer). */
api.get("/bots/:id/skills/available", (c) => c.json({ skills: skills.refs(ownAgent(c).id) }));
/** The user imports a skill from a public markdown file (their own action: no card). */
api.post("/bots/:id/skills/import", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  let parsed;
  try { parsed = await fetchSkillMarkdown(String(b.url ?? ""), AbortSignal.timeout(25_000)); } catch (err) { fail(400, (err as Error).message); }
  const { skill, replaced } = saveImportedSkill(bot, parsed!, String(b.name ?? ""), b.shared === true);
  audit(bot.userId, "account", `Skill imported for ${bot.name}: ${skill.name}`, bot.id);
  return c.json({ skill, replaced });
});
api.delete("/skills/:id", (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  skills.remove(cur.id);
  return c.json({ ok: true });
});
api.post("/bots/:id/memories", async (c) => {
  const bot = ownAgent(c);
  const text = clip(String((await body(c)).text ?? "").trim(), 500);
  if (!text) fail(400, "Write what to remember.");
  const memory = memories.add(bot.id, text, "chat");
  emit(bot.userId, { type: "memories", botId: bot.id });
  return c.json({ memory });
});
registerMemoryNoteRoutes(api); // edit (with history), « Oublier » into the bin, « Annuler », history: memoryroutes.ts

api.post("/bots/:id/consolidate", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await consolidate(bot)); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});
api.post("/bots/:id/compact", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await inQueue(bot.id, () => compactIfNeeded(bots.byId(bot.id)!, true))); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});

// Gem hunt: a daily routine where the bot goes through the business data it can reach and celebrates only real gems.
const GEM_HUNT = "Gem hunt";
const GEM_HUNT_PROMPT = [
  "Gem hunt. Go through the business data you can reach: connected apps (analytics, search console, CRM, sales, ads, mailbox, shop), the user's sites and pages you know, files in your library, and what you remember about the business.",
  "Look for rare, high-value opportunities: a qualified lead ready to buy, a search query or page with large traffic upside and weak competition, a sharp change in a key metric, a deal or saving far above normal, an untapped market signal.",
  "Compare with what you noted after earlier hunts (memory_search \"gem hunt\") so you judge what is really unusual for this business.",
  "If you find a gem, call celebrate with the numbers, then explain it and suggest the next step. Save one short memory with today's key figures for the next hunt.",
  "If nothing stands out, do not invent anything: end with stay_quiet.",
].join("\n");
api.get("/gems", (c) => {
  const list = q.all<{ bot_id: string; name: string; body: string; created_at: number }>(
    "SELECT r.bot_id, b.name, r.body, r.created_at FROM rows r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND r.kind = 'event' AND r.body LIKE '%\"event\":\"cheer\"%' ORDER BY r.created_at DESC LIMIT 100",
    c.get("user").id);
  return c.json({ gems: list.map((r) => { const b = JSON.parse(r.body); return { botId: r.bot_id, botName: r.name, at: r.created_at, reason: b.text, gem: b.gem ?? null }; }) });
});
api.post("/bots/:id/gem-hunt", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const existing = routines.forBot(bot.id).find((r) => r.prompt.startsWith("Gem hunt."));
  if (existing) return c.json({ routine: publicRoutine(existing, c.get("user").locale), created: false });
  const tz = typeof b.timezone === "string" && isValidTimezone(b.timezone) ? b.timezone : "UTC";
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time ?? "08:40"));
  const hh = m ? Math.min(23, Number(m[1])) : 8, mm = m ? Math.min(59, Number(m[2])) : 40;
  const r = routines.create(bot.id, { name: tr(c.get("user").locale, GEM_HUNT), prompt: GEM_HUNT_PROMPT, trigger: "cron", schedule: `${mm} ${hh} * * *`, timezone: tz });
  schedule(r.id);
  emit(c.get("user").id, { type: "routines", botId: bot.id });
  audit(c.get("user").id, "routine", `${bot.name}: gem hunt turned on`, bot.id);
  return c.json({ routine: publicRoutine(r, c.get("user").locale), created: true });
});
api.get("/bots/:id/routines", (c) => c.json({ routines: routines.forBot(ownBot(c).id).map((r) => publicRoutine(r, c.get("user").locale)) }));
const ownRoutine = (c: Context<Env>) => routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, "That routine does not exist.");
api.patch("/routines/:id", async (c) => {
  const r = ownRoutine(c);
  const updated = routines.update(r.id, { enabled: !!(await body(c)).enabled })!;
  schedule(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ routine: publicRoutine(updated, c.get("user").locale) });
});
api.get("/routines/:id/runs", (c) => c.json({ runs: runs.list(ownRoutine(c).id) }));
// "Run now" does not move the next due time and does not turn a paused routine back on; a run under way is not doubled.
api.post("/routines/:id/run", async (c) => {
  // "Run now" is the user's own: only a usage cap set to stop everything refuses it. nod item 8: not on an unreviewed change after a failure.
  const routine = ownRoutine(c); await runNowGuard(c, routine); const r = fireRoutine(routine, undefined, { byHand: true });
  if (r === "paused") fail(409, tr(c.get("user").locale, "This routine's bot is paused. Resume it to run the routine."));
  if (r === "capped") fail(409, cm(c.get("user").locale, "This usage cap still stops this work. Raise it (Settings → Usage) or wait until it resets."));
  return r === "busy" ? fail(409, "This routine is already running.") : c.json({ ok: true });
});
api.delete("/routines/:id", (c) => {
  const r = ownRoutine(c);
  unschedule(r.id);
  routines.remove(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ ok: true });
});

api.get("/tasks", (c) => c.json({ tasks: tasks.forUser(c.get("user").id) }));

// ── "Aujourd'hui" (today.ts) ─────────────────────────────────────────────────────────────────────────────────────
// The caller's own day: their bots, plus what a workspace lets them see of shared bots (today.ts says what). Unknown
// query parameters are ignored; `date` is YYYY-MM-DD in the user's timezone (default: today there).
api.get("/today", (c) => c.json(todayReport(c.get("user").id, c.req.query("date") ?? undefined)));
const todaySettingsView = (userId: string) => todaySettings.view(userId, { mailConfigured: mailConfigured(), pushDevices: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND enabled = 1", userId)?.n ?? 0 });
api.get("/today/settings", (c) => c.json(todaySettingsView(c.get("user").id)));
api.put("/today/settings", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  todaySettings.save(user.id, { minutes: b.minutes, digest: b.digest });
  return c.json(todaySettingsView(user.id));
});
api.get("/bots/:id/tasks", (c) => c.json({ tasks: tasks.forBot(ownBot(c).id) }));

// ── Voice calls, search, earlier conversations ───────────────────────────────
api.post("/bots/:id/calls", (c) => {
  const bot = accessBot(c, "talk").bot;
  if (bot.kind !== "agent") fail(400, "A group chat cannot do that.");
  return c.json({ callId: callStarted(bot, c.get("user").locale) });
});
api.post("/bots/:id/calls/:callId/end", async (c) => {
  const bot = accessBot(c, "talk").bot;
  const done = callEnded(bot, c.req.param("callId"), (await body(c)).transcript, c.get("user").locale);
  return c.json(done ? { ok: true } : { ok: true, duplicate: true });
});

api.get("/search", (c) => {
  const query = (c.req.query("q") ?? "").trim();
  return c.json({ hits: query.length >= 2 ? searchMessages(c.get("user").id, query, { since: dayBound(c.req.query("since")), until: dayBound(c.req.query("until"), true) }) : [] }); // L73: date filter
});
api.get("/bots/:id/history/:generation", (c) => {
  const bot = ownBot(c);
  const generation = Number(c.req.param("generation"));
  if (!Number.isInteger(generation) || generation < 1 || generation > bot.generation) fail(404, "That conversation does not exist.");
  // Threads included: each reply carries the seq of the message it hangs on.
  return c.json({ rows: rows.all(bot.id, generation).slice(-2000) });
});

api.get("/audit", (c) => c.json({ entries: auditList(c.get("user").id, Number(c.req.query("before")) || undefined, Number(c.req.query("limit")) || 50) }));

// ── Telegram ─────────────────────────────────────────────────────────────────
api.get("/bots/:id/telegram", (c) => c.json(telegram.status(ownAgent(c))));
api.put("/bots/:id/telegram", async (c) => {
  const bot = ownAgent(c);
  const token = String((await body(c)).token ?? "").trim();
  if (!/^\d+:[\w-]{20,}$/.test(token)) fail(400, "That does not look like a Telegram bot token.");
  try { return c.json(await telegram.connect(bot, token)); } catch (err) { return fail(400, `Telegram refused this token: ${(err as Error).message}`); }
});
api.delete("/bots/:id/telegram", (c) => { telegram.disconnect(ownAgent(c)); return c.json({ ok: true }); });

// ── Shared pages ─────────────────────────────────────────────────────────────
api.get("/pages", (c) => c.json({ pages: pages.list(c.get("user").id, config.publicUrl).map(({ userId, path: _p, ...rest }) => rest) }));
api.patch("/pages/:token", async (c) => {
  const user = c.get("user");
  const page = pages.byToken(c.req.param("token"), config.publicUrl);
  if (!page || page.userId !== user.id) fail(404, "That page does not exist.");
  const v = String((await body(c)).visibility ?? "");
  if (v !== "link" && v !== "private") fail(400, "Visibility is link or private.");
  pages.setVisibility(page!.token, v as "link" | "private");
  audit(user.id, "account", `Page ${page!.title}: ${v === "private" ? "private" : "anyone with the link"}`, page!.botId);
  emit(user.id, { type: "pages" });
  return c.json({ ok: true });
});
api.delete("/pages/:token", (c) => {
  pages.remove(c.get("user").id, c.req.param("token"));
  emit(c.get("user").id, { type: "pages" });
  return c.json({ ok: true });
});
registerStudioMp4(api, threadParent);
registerPageApi(api); // versions, restore, new address (pageroutes.ts)

// ── Account and data ─────────────────────────────────────────────────────────
registerGooglePrivate(api, googleDeps);
registerAccountMailPrivate(api, googleDeps);
// "Sauvegarde automatique" (autobackup.ts): the owner's off-server backup to S3-compatible storage.
registerAutoBackupRoutes(api, googleDeps);
// "Surveillance" (sentinel/): the Sentinelle's incidents and alert settings, for the owner and hosted operators only.
registerSentinelRoutes(api);
// « Annonces » (announcements.ts): readers' feed, and the owner/operators' page to write them.
registerAnnouncementRoutes(api); registerModelHealthRoutes(api); // model health: nod 3/4, L59, L60 (modelhealth.ts)
registerNoticeRoutes(api); registerRoomRoutingRoutes(api); // « Qui répond » in group chats (agent/roomrouting.ts)
registerFailureRoutes(api); registerConversationGrantRoutes(api); // « Coordinateur d'échecs » (agent/failures.ts) ; « Autoriser pour cette conversation »
registerRecruitRoutes(api); registerHookSettingsRoutes(api); registerReportRoutes(api); // « Bot recruteur » ; webhook settings (L20) ; « Signaler cette réponse » (L31)
registerTeamMdRoutes(api); registerRoutinePlusRoutes(api); registerConnectorPlusRoutes(api); // « Équipe Sklubot (.md) » (teammdroutes.ts): import with review, share ; routines nod 2/8/13 (routineplusroutes.ts)
registerCommandRoutes(api); registerRelayGuardRoutes(api); registerComfortRoutes(api); registerChantierRoutes(api); // « Chantier » (chantierroutes.ts) ; « Centre de commandement » (command.ts); « Règles de sécurité » of a linked computer (relayguardroutes.ts)
registerSkillsLibraryRoutes(api); registerSecurityRoutes(api); // « Bibliothèque de compétences » (skillsroutes.ts) ; Lot 1 security (securityroutes.ts)
registerOpenRouterRoutes(api); registerSubscriptionConnectRoutes(api); // OpenRouter, « Connecter mon compte ChatGPT / Claude »
api.put("/account/password", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  throttle(`pw:${user.id}`);
  if (!verifyPassword(String(b.current ?? ""), user.passHash)) fail(401, "The current password is wrong.");
  if (String(b.next ?? "").length < 8) fail(400, "Choose a password of at least 8 characters.");
  account.setPassword(user.id, hashPassword(String(b.next)));
  // Every other device is signed out; this one stays in.
  account.dropOtherSessions(user.id, sha256(getCookie(c, SESSION_COOKIE) ?? ""));
  dropResetLinks(user.id);
  audit(user.id, "account", "Password changed");
  return c.json({ ok: true });
});

/** Removes an account and everything it owns (its bots and their computers, connectors, team folder). */
async function removeAccountData(userId: string) {
  for (const bot of bots.list(userId, true)) { if (bots.byId(bot.id)) { telegram.disconnect(bot); await retireBot(bot); removeWorkspace(bot.id); } }
  for (const con of connectorStore.list(userId)) await connectorStore.remove(userId, con.id);
  removeTeamFolder(userId);
  account.remove(userId);
}
// Unverified accounts past their deadline are removed the same way (publicsignup.ts sweepUnverified).
setAccountRemover(removeAccountData);

api.delete("/account", async (c) => {
  const user = c.get("user");
  throttle(`pw:${user.id}`);
  if (!verifyPassword(String((await body(c)).password ?? ""), user.passHash)) fail(401, "The password is wrong.");
  await removeAccountData(user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

const download = (c: Context, name: string, type: string, content: string) =>
  c.body(content, 200, { "content-type": type, "content-disposition": `attachment; filename="${name}"` });

api.get("/export/data", (c) => {
  const user = c.get("user");
  const mine = bots.list(user.id, true);
  const data = {
    exportedAt: new Date().toISOString(), user: publicUser(user),
    bots: mine.map((b) => ({
      ...publicBot(b),
      conversations: Array.from({ length: b.generation }, (_, i) => ({ generation: i + 1, rows: q.all<any>("SELECT seq, thread, created_at, body FROM rows WHERE bot_id = ? AND generation = ? ORDER BY seq", b.id, i + 1).map((r) => ({ seq: r.seq, ...(r.thread ? { thread: r.thread } : {}), at: r.created_at, ...JSON.parse(r.body) })) })),
      memories: memories.list(b.id, 100_000), skills: skills.list(b.id), routines: routines.forBot(b.id).map((r) => publicRoutine(r, user.locale)), tasks: tasks.forBot(b.id),
    })),
    policies: policies.list(user.id), vault: vault.list(user.id).map(publicVault),
    connectors: connectorStore.list(user.id).map((k) => ({ name: k.name, url: k.url })),
    checkins: publicCheckins(user.id), usage: usageSummary(user.id), activity: auditList(user.id, undefined, 200),
  };
  audit(user.id, "account", "Data exported");
  return download(c, "sklubot-data.json", "application/json", JSON.stringify(data, null, 2));
});

api.get("/export/team", (c) => {
  const user = c.get("user");
  const team = bots.list(user.id).filter((b) => b.kind === "agent").map((b) => ({
    name: b.name, label: b.label, description: b.description, instructions: b.instructions, shape: b.shape, color: b.color, mode: b.mode,
    effort: b.effort, model: b.model, autonomy: b.autonomy, disabledTools: b.disabledTools, character: b.character,
    skills: skills.list(b.id).map((s) => ({ name: s.name, description: s.description, body: s.body, ...extrasOf(s) })),
    routines: routines.forBot(b.id).filter((r) => r.trigger === "cron").map((r) => ({ name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone })),
  }));
  return download(c, "sklubot-team.json", "application/json", JSON.stringify({ sklubotTeam: 1, bots: team }, null, 2));
});

api.post("/import/team", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (b.sklubotTeam !== 1 || !Array.isArray(b.bots)) fail(400, "This is not a Sklubot team file.");
  let created = 0;
  for (const t of b.bots.slice(0, 30)) {
    if (!t || typeof t.name !== "string" || !t.name.trim()) continue;
    // Imported bots start careful, whatever the file says: a shared file must not hand out trust.
    const bot = bots.create(user.id, { name: t.name, label: t.label, description: t.description, instructions: t.instructions, shape: t.shape, color: t.color, mode: t.mode, effort: t.effort, autonomy: "careful" });
    if (Array.isArray(t.disabledTools)) bots.patch(bot.id, { disabledTools: t.disabledTools });
    if (t.character) bots.patch(bot.id, { character: t.character });
    for (const s of Array.isArray(t.skills) ? t.skills.slice(0, 50) : [])
      if (s && typeof s.name === "string" && typeof s.body === "string" && s.name.trim() && s.body.trim()) skills.create(bot.id, s.name.trim().slice(0, 80), String(s.description ?? "").slice(0, 300), s.body.slice(0, 20_000), false, {}, extrasOf(s));
    for (const r of Array.isArray(t.routines) ? t.routines.slice(0, 20) : [])
      if (r && typeof r.name === "string" && typeof r.prompt === "string" && typeof r.schedule === "string") {
        // Imported routines start paused, so nothing runs before you have looked at it.
        try { const made = routines.create(bot.id, { name: r.name, prompt: r.prompt, trigger: "cron", schedule: r.schedule, timezone: isValidTimezone(String(r.timezone)) ? r.timezone : "UTC" }); routines.update(made.id, { enabled: false }); } catch { /* skip a routine that cannot be read */ }
      }
    created++;
  }
  if (created) { emit(user.id, { type: "roster" }); audit(user.id, "account", `Team imported: ${created} bots`); }
  return c.json({ created });
});

/**
 * "Importer depuis Grok Bot" (grokimport.ts, docs/IMPORT-GROK.md). Preview: { text: the pasted reply } → what would be
 * created, cleaned of secrets (nothing is created). Commit: { previewId, bots: GrokImportChoice[] } → the bots, as a safe
 * package (careful, draft skills, paused routines, ticked memories only, apps as a to-do).
 */
api.post("/import/grok/preview", async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > 1_000_000) fail(413, "Too large: paste 200 KB of text at most.");
  const b = await body(c);
  return c.json(previewGrokImport(c.get("user"), typeof b.text === "string" ? b.text : ""));
});
api.post("/import/grok/commit", async (c) => {
  const b = await body(c);
  const choices = Array.isArray(b.bots) ? b.bots.slice(0, 50).filter((x: unknown) => x && typeof x === "object") : [];
  return c.json({ report: commitGrokImport(c.get("user"), String(b.previewId ?? ""), choices) });
});

/**
 * "Modèles d'équipe" (teamfile.ts, docs/MODELES-EQUIPE.md): the gallery of built-in templates; a preview of a template,
 * a file's text or an https address (nothing is created); the commit (a safe package, one transaction); and the export
 * of the caller's own bots as a team file (no memory, model, autonomy, connector or key; secrets masked).
 */
api.get("/templates", (c) => c.json({ templates: templateList() }));
api.post("/templates/preview", async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > 1_000_000) fail(413, "This file is too large (200 KB at most).");
  const user = c.get("user");
  const b = await body(c);
  // An address is fetched by the server: a few per account at a time.
  if (typeof b.url === "string" && b.url.trim()) throttle(`tplurl:${user.id}`, 20);
  return c.json(await previewTeamFile(user, { template: b.template, text: b.text, url: b.url, filename: b.filename }));
});
api.post("/templates/commit", async (c) => {
  const b = await body(c);
  const choices = Array.isArray(b.bots) ? b.bots.slice(0, 50).filter((x: unknown) => x && typeof x === "object") : [];
  return c.json({ report: commitTeamFile(c.get("user"), String(b.previewId ?? ""), choices, { section: b.section }) });
});
api.post("/templates/export", async (c) => {
  const b = await body(c);
  return c.json(exportTeam(c.get("user"), { botIds: b.botIds, sectionId: b.sectionId, title: b.title, description: b.description, icon: b.icon, category: b.category }));
});

api.get("/usage.csv", (c) => download(c, "sklubot-usage.csv", "text/csv; charset=utf-8", usageCsv(c.get("user").id)));

// ── The user's own computers (Sklubot Relais, docs/RELAIS-PROTOCOLE.md) ──────
api.get("/relay/devices", (c) => c.json({ devices: listDevices(c.get("user").id), downloads: relayDownloads(undefined, releasedDesktopFiles()) }));
/** Pairing: the user types the code their computer shows. A few tries per account and per address, then a pause. */
const pairTries = new Map<string, number[]>();
function pairThrottle(key: string, limit: number) {
  const t = Date.now();
  const recent = (pairTries.get(key) ?? []).filter((at) => at > t - 10 * 60_000);
  if (recent.length >= limit) fail(429, "Too many attempts. Wait a few minutes and try again.");
  recent.push(t);
  pairTries.set(key, recent);
  if (pairTries.size > 10_000) for (const [k, v] of pairTries) if (!v.some((at) => at > t - 10 * 60_000)) pairTries.delete(k);
}
api.post("/relay/pairings", async (c) => {
  const user = c.get("user");
  const code = String((await body(c)).code ?? "");
  pairThrottle(`user:${user.id}`, 5);
  pairThrottle(`ip:${clientIp(c)}`, 20);
  const device = confirmPairing(user, code);
  if (!device) {
    audit(user.id, "computer", tr(user.locale, "Wrong or expired pairing code"));
    fail(400, "That code is not valid, or it has expired. Check the code shown on your computer.");
  }
  return c.json({ device });
});
api.delete("/relay/devices/:id", (c) => {
  if (!revokeDevice(c.get("user").id, c.req.param("id"))) fail(404, "That computer is not linked.");
  return c.json({ ok: true });
});
/** "Stop": ends the bot's control session on that computer, cancels its commands, and keeps the bot from taking it back on its own. */
api.post("/relay/devices/:id/stop", (c) => {
  if (!stopSession(c.get("user").id, c.req.param("id"))) fail(409, "That computer is not connected.");
  return c.json({ ok: true });
});
/** The last picture seen of the computer (a bot's screenshot or the live view), for when no live view runs. */
api.get("/relay/devices/:id/last", (c) => {
  const id = c.req.param("id");
  const frame = listDevices(c.get("user").id).some((d) => d.id === id) ? lastFrame(id) : null;
  if (!frame) return c.body(null, 204);
  return c.body(new Uint8Array(Buffer.from(frame.data, "base64")), 200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-frame-at": String(frame.at) });
});

// ── Computer and files ───────────────────────────────────────────────────────
api.get("/computer", (c) => c.json(computerState(c.get("user").id)));
/**
 * The desk test (B-10): an end-to-end check of a bot computer on two computers of invented bots (no real bot, no user
 * data). One run at a time on the server; the latest result stays until the server restarts.
 */
// L4: the desk test starts computers on the server for everyone's account and shows their pictures: the server's owner
// only (the earliest account, the same rule as the Google sign-in settings, googlelogin.ts ownerId).
const deskOwner = (c: Context) => { if (ownerId() !== c.get("user").id) fail(403, tr(c.get("user").locale, "Only the owner of this server can run the desk test.")); };
api.get("/computer/desk-test", (c) => { deskOwner(c); return c.json({ run: deskRun() }); });
api.post("/computer/desk-test", (c) => {
  deskOwner(c);
  if (computerKind() !== "linux") fail(409, "The desk test needs the bots' Linux computers (Docker and the desktop image) on this server.");
  const run = startDeskTest(c.get("user").id);
  audit(c.get("user").id, "computer", "Desk test started");
  return c.json({ run });
});
api.get("/computer/desk-test/shots/:name", (c) => {
  deskOwner(c);
  const shot = deskShot(c.req.param("name"));
  if (!shot) return fail(404, "No such picture.");
  return c.body(new Uint8Array(shot), 200, { "content-type": "image/jpeg", "cache-control": "no-store" });
});

api.get("/bots/:id/screen", async (c) => {
  const shot = await screen.peek(ownBot(c).id);
  if (!shot) return c.body(null, 204);
  return c.body(new Uint8Array(shot), 200, { "content-type": "image/jpeg", "cache-control": "no-store" });
});

api.post("/bots/:id/screen/input", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const uid = bot.userId;
  try {
    // A demonstration under way records what the user does (typed text only as a count).
    noteInput(bot.id, { type: String(b.type), x: Number(b.x), y: Number(b.y), text: typeof b.text === "string" ? b.text : undefined, key: typeof b.key === "string" ? b.key : undefined, dy: Number(b.dy), url: typeof b.url === "string" ? b.url : undefined });
    if (b.type === "goto") await screen.open(bot.id, uid, String(b.url ?? ""));
    else if (!screen.isOpen(bot.id)) fail(409, "This bot's computer is not on yet.");
    else if (b.type === "click") await screen.click(bot.id, uid, Number(b.x), Number(b.y));
    else if (b.type === "type") await screen.type(bot.id, uid, String(b.text ?? ""));
    else if (b.type === "key") await screen.key(bot.id, uid, String(b.key ?? ""));
    else if (b.type === "scroll") await screen.scroll(bot.id, uid, Number(b.x), Number(b.y), Number(b.dy) || 0);
    else fail(400, "Unknown input type.");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(502, (err as Error).message);
  }
  return c.json({ ok: true });
});

api.post("/bots/:id/desktop/wake", async (c) => {
  const bot = ownAgent(c);
  try { await screen.wake(bot.id, bot.userId); } catch (err) { return fail(502, (err as Error).message); }
  return c.json({ ok: true });
});
api.post("/bots/:id/desktop/tidy", async (c) => {
  const bot = ownAgent(c);
  try { await screen.tidy(bot.id, bot.userId); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "system", `${bot.name}: screen tidied`, bot.id);
  return c.json({ ok: true });
});
// "Show me how": record a demonstration on the bot's screen, then review the skill the bot drafts from it.
api.get("/bots/:id/teach", (c) => c.json({ recording: recording(ownAgent(c).id) }));
api.post("/bots/:id/teach/start", (c) => {
  const bot = ownAgent(c);
  try { return c.json({ recording: startRecording(bot) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/stop", async (c) => {
  const bot = ownAgent(c);
  const note = String((await body(c)).note ?? "");
  try { return c.json({ recording: await stopRecording(bot.id, note) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/retry", (c) => {
  const bot = ownAgent(c);
  try { return c.json({ recording: retryRecording(bot.id) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/save", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  try { return c.json(saveRecording(bot, { name: String(b.name ?? ""), when: String(b.when ?? ""), steps: String(b.steps ?? "") })); } catch (err) { return fail(400, (err as Error).message); }
});
api.post("/bots/:id/teach/discard", (c) => { dropRecording(ownAgent(c).id); return c.json({ ok: true }); });
api.post("/bots/:id/desktop/handback", (c) => { const bot = ownAgent(c); releaseControl(bot.id); noteHandBack(bot.id); return c.json({ ok: true }); });
/** The viewer is in control mode ({ on: true }, renewed every 30 s) or left it: the bot's screen actions wait meanwhile. */
api.post("/bots/:id/desktop/control", async (c) => {
  const bot = ownAgent(c);
  if ((await body(c)).on === false) releaseControl(bot.id); else holdControl(bot.id);
  return c.json({ ok: true });
});
api.get("/bots/:id/engine", async (c) => {
  const bot = ownAgent(c);
  // ?runtime=1: only the engine's state (cheap; the panel polls it every 3 s during a restart).
  if (c.req.query("runtime")) return c.json({ runtime: engineRuntime(bot) });
  try { return c.json({ engines: await engineStatus(bot), runtime: engineRuntime(bot) }); }
  catch (err) { return c.json({ engines: (["claude-code", "codex"] as const).map((engine) => ({ engine, installed: false, signedIn: null, account: null, detail: (err as Error).message })), runtime: engineRuntime(bot) }); }
});
/**
 * "Restart the engine" (B-4): stops its turn and processes, lets its pending approvals lapse, and starts it again in the
 * background. Answers at once with the engine's state (usually "starting").
 */
api.post("/bots/:id/engine/restart", async (c) => {
  const bot = ownAgent(c);
  try {
    const runtime = await restartEngine(bot);
    audit(bot.userId, "system", `${bot.name}: engine restarted`, bot.id);
    return c.json({ runtime });
  } catch (err) {
    if (err instanceof EngineRestartRefused) return fail(409, err.message);
    return fail(502, clip(String((err as Error)?.message ?? err), 300));
  }
});
api.post("/bots/:id/engine/login", async (c) => {
  const bot = ownAgent(c);
  const engine = (await body(c)).engine === "codex" ? "codex" : "claude-code";
  try { await engineLogin(bot, engine); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "account", `${bot.name}: sign-in to ${engine === "codex" ? "ChatGPT" : "Claude"} started on its computer`, bot.id);
  return c.json({ ok: true });
});
api.post("/bots/:id/engine/logout", async (c) => {
  const bot = ownAgent(c);
  const engine = (await body(c)).engine === "codex" ? "codex" : "claude-code";
  try { await engineLogout(bot, engine); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "account", `${bot.name}: signed out of ${engine === "codex" ? "ChatGPT" : "Claude"}`, bot.id);
  return c.json({ ok: true });
});
const inUse = (c: Context, err: unknown): never => {
  if (err instanceof SharedComputerInUseError) fail(409, tr(c.get("user").locale, err.message));
  throw err;
};
api.post("/bots/:id/desktop/sleep", async (c) => { await screen.sleep(ownBot(c).id).catch((err) => inUse(c, err)); return c.json({ ok: true }); });
api.post("/bots/:id/desktop/reset", async (c) => {
  const bot = ownBot(c);
  // A bot on a shared computer: wiping it would wipe the other bots' files and sign-ins too (Settings → Computers does that).
  if (bot.computerMode === "shared" && computerKind() === "linux") fail(409, tr(c.get("user").locale, "This bot uses a shared computer. To start it afresh, reset the shared computer in Settings → Computers (it affects every bot that uses it)."));
  await screen.reset(bot.id);
  return c.json({ ok: true });
});

// ── Part B: the account's shared computers ───────────────────────────────────
const ownShared = (c: Context) => {
  const rec = sharedComputers.byId(c.req.param("sid") ?? "");
  // Isolation: an account only ever sees and changes its own shared computers.
  if (!rec || rec.userId !== c.get("user").id) fail(404, "No such shared computer.");
  return rec!;
};
const linuxOnly = (c: Context) => { if (computerKind() !== "linux") fail(409, tr(c.get("user").locale, "Shared computers need the bots' Linux computers (Docker and the desktop image) on this server.")); };
api.post("/computer/shared", (c) => {
  linuxOnly(c);
  const user = c.get("user");
  try { sharedComputers.ensure(user.id); sharedComputers.add(user.id); }
  catch (err) { if (err instanceof SharedLimitError) fail(409, tr(user.locale, "An account can have at most {n} shared computers.", { n: err.max })); throw err; }
  audit(user.id, "computer", "Shared computer added");
  emit(user.id, { type: "computer", computer: computerState(user.id) });
  return c.json({ computer: computerState(user.id) });
});
api.post("/computer/shared/:sid/sleep", async (c) => {
  linuxOnly(c);
  const rec = ownShared(c);
  if (sharedHolder(rec.id)) fail(409, tr(c.get("user").locale, "This shared computer is being used by another bot right now. Try again when it has finished."));
  await screen.sleepShared(rec.id);
  return c.json({ computer: computerState(c.get("user").id) });
});
api.post("/computer/shared/:sid/reset", async (c) => {
  linuxOnly(c);
  const rec = ownShared(c);
  if (sharedHolder(rec.id)) fail(409, tr(c.get("user").locale, "This shared computer is being used by another bot right now. Try again when it has finished."));
  await screen.resetShared(rec.id).catch((err) => inUse(c, err));
  audit(c.get("user").id, "computer", `Shared computer ${rec.name} reset`);
  return c.json({ computer: computerState(c.get("user").id) });
});
api.delete("/computer/shared/:sid", async (c) => {
  linuxOnly(c);
  const user = c.get("user");
  const rec = ownShared(c);
  if (sharedComputers.list(user.id).length <= 1) fail(409, tr(user.locale, "Keep at least one shared computer. Set your bots to their own computer first if you want none."));
  if (sharedHolder(rec.id)) fail(409, tr(user.locale, "This shared computer is being used by another bot right now. Try again when it has finished."));
  await screen.resetShared(rec.id).catch((err) => inUse(c, err));
  closeBotLink(rec.id);
  sharedComputers.remove(rec.id);
  audit(user.id, "computer", `Shared computer ${rec.name} removed`);
  emit(user.id, { type: "computer", computer: computerState(user.id) });
  return c.json({ computer: computerState(user.id) });
});

const safePath = (botId: string, rel: string) => { try { return resolveInWorkspace(botId, rel); } catch (err) { return fail(400, (err as Error).message); } };

api.get("/bots/:id/files", (c) => {
  const bot = ownBot(c);
  const rel = c.req.query("path") ?? "";
  safePath(bot.id, rel);
  return c.json({ entries: listFiles(bot.id, rel) });
});

// ── The team folder (wave 8): one per account, shared by its own bots' computers at ~/team; off by default ──
api.get("/team-folder", async (c) => c.json({ team: await teamFolderState(c.get("user").id) }));
api.put("/team-folder", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (typeof b.enabled !== "boolean") fail(400, "Say whether the team folder is on (enabled: true or false).");
  if (computerKind() !== "linux") fail(409, "The team folder needs the bots' own Linux computers, which this server does not have.");
  settings.saveTeam(user.id, b.enabled);
  audit(user.id, "account", b.enabled ? "Team folder switched on (bots' computers get ~/team when they next start)" : "Team folder switched off (bots' computers lose ~/team when they next start; its files are kept)");
  return c.json({ team: await teamFolderState(user.id) });
});
const safeTeamPath = (userId: string, rel: string) => { try { return resolveInTeam(userId, rel); } catch (err) { return fail(400, (err as Error).message); } };
api.get("/team-folder/files", (c) => {
  const user = c.get("user");
  const rel = c.req.query("path") ?? "";
  safeTeamPath(user.id, rel);
  return c.json({ entries: listTeamFiles(user.id, rel) });
});
api.get("/team-folder/files/download", (c) => {
  const user = c.get("user");
  const rel = c.req.query("path") ?? "";
  safeTeamPath(user.id, rel);
  let f: ReturnType<typeof openTeamFile>;
  try { f = openTeamFile(user.id, rel); } catch { return fail(404, "That file does not exist."); }
  const name = path.basename(f.full).replace(/[^\w. -]/g, "_");
  return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd })) as unknown as ReadableStream, 200, {
    "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": String(f.size),
  });
});

// ── A full disk (wave 8): measure on demand; delete what the user ticked on the card, after they confirmed ──
api.post("/bots/:id/disk/check", async (c) => {
  const bot = ownAgent(c);
  const report = await checkDisk(bot, { force: true });
  return c.json({ report });
});
api.post("/bots/:id/cards/:seq/disk", async (c) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "disk" ? row.body.card : fail(400, "That is not a disk card.");
  if (card.status !== "pending") fail(409, "This was already answered.");
  const b = await body(c);
  if (b.action === "dismiss") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "disk" ? { ...k, status: "dismissed" } : k));
    return c.json({ ok: true });
  }
  if (b.action !== "delete") fail(400, "Unknown action.");
  // Deleting is the user's explicit choice: they ticked these on the card and confirmed. Only paths the card listed.
  if (b.confirm !== true) fail(400, "Confirm the deletion first.");
  const chosen: string[] = Array.isArray(b.paths) ? b.paths.filter((p: unknown): p is string => typeof p === "string").slice(0, 50) : [];
  const listed = new Set(card.items.map((i) => i.path));
  if (!chosen.length || chosen.some((p) => !listed.has(p))) fail(400, "Choose among the files and folders listed on the card.");
  const r = await deleteListed(bot, card.items, chosen);
  if (r.deleted.length) audit(c.get("user").id, "computer", `${bot.name}: deleted from its computer to free disk space — ${r.deleted.join(", ")}`, bot.id);
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "disk" ? { ...k, status: "cleaned", deleted: r.deleted, freedBytes: r.freedBytes, ...(r.freeBytes !== null ? { freeBytes: r.freeBytes } : {}) } : k));
  return c.json({ ok: true, ...r });
});

// ── "Fichiers modifiés" (snapshots.ts): a turn's file changes — the diff of one listed file, and undo (owner only) ──
const filesCard = (c: Context<Env>) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "files" ? row.body.card : fail(400, "That is not a list of changed files.");
  return { bot, row: row!, card };
};
registerPeerReview(api,filesCard,throttle);
api.post("/bots/:id/cards/:seq/files", async (c) => {
  const { bot, row, card } = filesCard(c);
  if (card.status !== "available") fail(409, "These changes were already undone.");
  const b = await body(c);
  if (b.action !== "undo") fail(400, "Unknown action.");
  // Undoing is the owner's explicit choice, confirmed on the card. Only paths the card lists.
  if (b.confirm !== true) fail(400, "Confirm first.");
  const listed = card.files.map((f) => f.path);
  const chosen: string[] = Array.isArray(b.paths) ? b.paths.filter((p: unknown): p is string => typeof p === "string") : listed;
  if (!chosen.length || chosen.some((p) => !listed.includes(p) || !listedPathOk(p))) fail(400, "Choose among the files listed on the card.");
  const r = await undoFiles(bot, card, chosen, b.force === true);
  if (r.missing) {
    rows.updateCard(bot, row.generation, row.seq, (k) => (k.type === "files" ? { ...k, status: "expired" } : k));
    return fail(409, "The snapshot of this turn is no longer kept (only the last 20 turns are), so it cannot be undone.");
  }
  if (r.restored.length) audit(c.get("user").id, "computer", `${bot.name}: file changes undone — ${r.restored.slice(0, 20).join(", ")}${r.restored.length > 20 ? "…" : ""}`, bot.id);
  rows.updateCard(bot, row.generation, row.seq, (k) => (k.type === "files" ? { ...k, status: r.restored.length ? "undone" : k.status, restored: r.restored, changedSince: r.changedSince } : k));
  // The bot hears about it at the start of its next turn in that chat (no turn is started just for this).
  if (r.restored.length) feedback.add(bot.id, bot.generation, row.thread ?? 0, -row.seq, "undo", `The user undid your file changes from an earlier turn: ${r.restored.slice(0, 30).join(", ")}${r.restored.length > 30 ? " and more" : ""} (relative to /root) are back as they were before that turn. Do not redo those changes unless asked.`);
  return c.json({ ok: true, ...r });
});

/** Opens a library file for sending: only a plain file inside the library, never through a link. */
function libraryFileFor(botId: string, rel: string) {
  safePath(botId, rel);
  try { return openLibraryFile(botId, rel); } catch { return fail(404, "That file does not exist."); }
}

api.get("/bots/:id/files/download", (c) => {
  const bot = ownBot(c);
  const f = libraryFileFor(bot.id, c.req.query("path") ?? "");
  const name = path.basename(f.full).replace(/[^\w. -]/g, "_");
  return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd })) as unknown as ReadableStream, 200, {
    "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": String(f.size),
  });
});

/** Shows a library file in the page. Only plain pictures and videos are served inline; everything else is a download, so an uploaded page can never run as ours. */
api.get("/bots/:id/files/view", (c) => {
  const bot = ownBot(c);
  const f = libraryFileFor(bot.id, c.req.query("path") ?? "");
  const mime = mimeOf(f.full);
  // Videos play in the chat's player; nothing else that could run as a page is ever served inline.
  const inline = isInlineImage(mime) || isInlineVideo(mime);
  // Players ask for byte ranges to seek in a video (RFC 9110 §14): one range is served, anything else gets the whole file.
  const range = isInlineVideo(mime) ? /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "") : null;
  if (range && (range[1] || range[2]) && f.size > 0) {
    let start = range[1] ? Number(range[1]) : Math.max(0, f.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), f.size - 1) : f.size - 1;
    if (start >= f.size || start > end) { closeSync(f.fd); return c.body(null, 416, { "content-range": `bytes */${f.size}` }); }
    start = Math.max(0, start); end = Math.max(start, end);
    return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd, start, end })) as unknown as ReadableStream, 206, {
      "content-type": mime, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${f.size}`, "accept-ranges": "bytes",
      "content-disposition": `inline; filename="${path.basename(f.full).replace(/[^\w. -]/g, "_")}"`,
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=300",
    });
  }
  return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd })) as unknown as ReadableStream, 200, {
    "content-type": inline ? mime : "application/octet-stream", "content-length": String(f.size), ...(isInlineVideo(mime) ? { "accept-ranges": "bytes" } : {}),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${path.basename(f.full).replace(/[^\w. -]/g, "_")}"`,
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=300",
  });
});

// ── Vault ────────────────────────────────────────────────────────────────────
const siteOf = (raw: unknown) => {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
/** A header name that may carry a secret (RFC 9110 token, and not one that would change where the request goes). */
const HEADER_OK = (h: string) => /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(h) && !["host", "cookie", "content-length", "connection", "transfer-encoding"].includes(h.toLowerCase());
function vaultFields(b: Record<string, any>, base?: VaultFields & { card?: { dailyCapUsd: number | null; monthlyCapUsd: number | null; brand: string; last4: string } | null }): VaultFields {
  const kind: VaultKind = (VAULT_KINDS as readonly string[]).includes(b.kind) ? b.kind : base?.kind ?? "login";
  const pick = (key: "name" | "site" | "username" | "note", max: number) => (b[key] === undefined ? base?.[key] ?? "" : String(b[key])).trim().slice(0, max);
  const name = pick("name", 80);
  if (!name) fail(400, "Give this item a name.");
  const password = typeof b.password === "string" && b.password ? b.password : null;
  if (password && password.length > 8000) fail(400, "That value is too long.");
  const f: VaultFields = { kind, name, site: pick("site", 300), username: kind === "login" ? pick("username", 300) : "", note: pick("note", 500), passwordEnc: base?.passwordEnc ?? null };
  if (kind === "secret") {
    const raw: unknown[] = Array.isArray(b.hosts) ? b.hosts : b.hosts === undefined ? base?.hosts ?? [] : String(b.hosts).split(/[\s,]+/);
    const hosts = raw.map(siteOf).filter(Boolean).slice(0, 10);
    if (!hosts.length) fail(400, "Say which host this secret may be sent to.");
    const header = (b.header === undefined ? base?.header ?? "" : String(b.header)).trim() || "Authorization";
    if (!HEADER_OK(header)) fail(400, "That header name cannot carry a secret.");
    const prefix = (b.prefix === undefined ? base?.prefix ?? (header.toLowerCase() === "authorization" ? "Bearer " : "") : String(b.prefix)).slice(0, 40);
    // Wave 7 (spec 08 A2): an optional read-only address to check the key with — https, on one of its hosts.
    const checkUrl = (b.checkUrl === undefined ? (base as { checkUrl?: string } | undefined)?.checkUrl ?? "" : String(b.checkUrl)).trim().slice(0, 500);
    if (checkUrl) {
      let u: URL | null = null;
      try { u = new URL(checkUrl); } catch { /* checked below */ }
      const httpOk = process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
      if (!u || !(u.protocol === "https:" || (httpOk && u.protocol === "http:")) || !hosts.some((h) => u!.hostname.toLowerCase() === h || u!.hostname.toLowerCase().endsWith(`.${h}`))) fail(400, "The check address must be an https address on one of the secret's hosts.");
    }
    Object.assign(f, { site: "", hosts, header, prefix, checkUrl });
  }
  if (kind === "card") {
    // A payment card (spec 07 A12): number, expiry, CVC and the name on it are sealed together; only the network and
    // the last 4 digits are kept in the clear. Changing the card means typing all of it again.
    const cap = (v: unknown, cur: number | null | undefined) => (v === undefined ? cur ?? null : v === null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : fail(400, "A spending cap is an amount, or empty for none."));
    Object.assign(f, { site: "", dailyCapUsd: cap(b.dailyCapUsd, base?.card?.dailyCapUsd), monthlyCapUsd: cap(b.monthlyCapUsd, base?.card?.monthlyCapUsd), brand: base?.card?.brand ?? "", last4: base?.card?.last4 ?? "" });
    if (b.number !== undefined && String(b.number).trim()) {
      try { const sealed = sealCard({ number: b.number, expiry: b.expiry, cvc: b.cvc, holder: b.holder }); Object.assign(f, { passwordEnc: sealed.enc, brand: sealed.brand, last4: sealed.last4 }); }
      catch (err) { return fail(400, (err as Error).message); }
    }
    if (!f.passwordEnc) fail(400, "Type the card number, expiry and security code.");
    return f;
  }
  if (kind === "totp") {
    let digits = base?.digits ?? 6, period = base?.period ?? 30;
    if (password) {
      // A pasted otpauth:// URI brings its own settings; only the base32 key is stored.
      try { const seed = parseTotp(password); digits = seed.digits; period = seed.period; f.passwordEnc = seal(seed.secret); }
      catch (err) { return fail(400, (err as Error).message); }
    }
    if (!siteOf(f.site)) fail(400, "Say which site these codes are for.");
    if (!f.passwordEnc) fail(400, "Paste the key or the otpauth:// address the site gave you.");
    Object.assign(f, { digits, period });
    return f;
  }
  if (password) f.passwordEnc = seal(password);
  return f;
}
api.get("/vault", (c) => c.json({ items: vault.list(c.get("user").id).map(publicVault) }));
/**
 * Wave 7 (spec 08 A2): a secret typed by the user is tried with the provider before it is saved (a known free check, or
 * its check address). When the provider refuses it, nothing is saved and the answer says so (422, with the check);
 * `force: true` saves it anyway. No check possible, or the provider unreachable: saved, with that state.
 */
async function verifyBeforeSave(b: Record<string, any>, f: VaultFields) {
  if (f.kind !== "secret" || typeof b.password !== "string" || !b.password) return null;
  const r = await checkSecret({ hosts: f.hosts ?? [], checkUrl: f.checkUrl ?? "", header: f.header ?? "", prefix: f.prefix ?? "", passwordEnc: null }, b.password);
  if (r.state === "broken" && b.force !== true) return c422(r);
  return r;
}
const c422 = (r: { state: string; detail: string; how: string }) => ({ refused: r });
api.post("/vault", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const f = vaultFields(b);
  if (vault.byName(user.id, f.name)) fail(409, "A login with this name already exists.");
  const check = await verifyBeforeSave(b, f);
  if (check && "refused" in check) return c.json({ error: "The provider refused this key.", health: check.refused }, 422);
  audit(user.id, "vault", `Vault item added (${f.kind}): ${f.name}`);
  emit(user.id, { type: "vault" });
  const item = vault.create(user.id, f);
  if (check) { recordHealth(user.id, "vault", item.id, item.name, check, { quiet: true }); emit(user.id, { type: "health" }); }
  return c.json({ item: publicVault(item), health: check ?? undefined });
});
api.patch("/vault/:id", async (c) => {
  const user = c.get("user");
  const cur = vault.owned(user.id, c.req.param("id")) ?? fail(404, "That login does not exist.");
  const b = await body(c);
  const f = vaultFields(b, cur);
  const clash = vault.byName(user.id, f.name);
  if (clash && clash.id !== cur.id) fail(409, "A login with this name already exists.");
  const check = await verifyBeforeSave(b, f);
  if (check && "refused" in check) return c.json({ error: "The provider refused this key.", health: check.refused }, 422);
  vault.update(cur.id, f);
  if (check) { recordHealth(user.id, "vault", cur.id, f.name, check, { quiet: true }); emit(user.id, { type: "health" }); }
  return c.json({ item: publicVault(vault.owned(user.id, cur.id)!), health: check ?? undefined });
});
api.delete("/vault/:id", (c) => {
  const cur = vault.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That login does not exist.");
  vault.remove(cur.id);
  audit(c.get("user").id, "vault", `Vault item removed: ${cur.name}`);
  for (const key of [`vault: ${cur.name}`, `secret: ${cur.name}`, `totp: ${cur.name}`, `card: ${cur.name}`]) policies.remove(c.get("user").id, key);
  return c.json({ ok: true });
});

// ── Wave 7 (spec 08) ─────────────────────────────────────────────────────────
/** Agent Reach on the bot's computer: channels and reading logins. */
api.get("/bots/:id/reach", async (c) => c.json(await reachState(ownAgent(c))));
/**
 * The user signs in themselves on the bot's screen (Agent Reach opens its browser window there): the bot's own screen
 * actions wait meanwhile (control mode, renewed by the viewer). The model never sees anything of it.
 */
api.post("/bots/:id/reach/:channel/:action", async (c) => {
  const bot = ownAgent(c);
  const action = c.req.param("action");
  const channel = c.req.param("channel");
  if (action !== "login" && action !== "logout") fail(400, "Unknown action.");
  if (!LOGIN_CHANNELS.some((l) => l.channel === channel)) fail(400, "Unknown channel.");
  if (action === "login") holdControl(bot.id);
  const r = await reachLogin(bot, channel, action as "login" | "logout");
  if (!r.ok) { if (action === "login") releaseControl(bot.id); return fail(502, r.message); }
  return c.json({ ok: true, opened: r.opened ?? null, next: r.message });
});

/** Health of keys and connections (A2). */
/** Every check with its detail (disk space, backup age…), for the server's owner only; anyone else gets a 404. */
api.get("/health/deep", async (c) => {
  if (ownerId() !== c.get("user").id) fail(404, "No such endpoint.");
  return c.json(await healthReport(0), 200, { "cache-control": "no-store" });
});
api.get("/health/credentials", (c) => c.json({ items: healthList(c.get("user").id) }));
api.post("/health/credentials/check", async (c) => c.json({ items: await checkAll(c.get("user").id) }));
api.post("/health/credentials/:kind/:id/check", async (c) => {
  const user = c.get("user");
  const kind = c.req.param("kind"), id = c.req.param("id");
  if (kind === "vault") {
    const item = vault.owned(user.id, id) ?? fail(404, "That item does not exist.");
    if (item!.kind !== "secret") fail(400, "Only secrets are checked.");
    recordHealth(user.id, "vault", item!.id, item!.name, await checkSecret(item!));
  } else if (kind === "api") {
    const conn = (await import("./apiconnectors.js")).apiConnectors.owned(user.id, id) ?? fail(404, "That connector does not exist.");
    recordHealth(user.id, "api", conn!.id, conn!.name, await checkConnector(user.id, conn!.id));
  } else await checkAll(user.id);
  emit(user.id, { type: "health" });
  return c.json({ items: healthList(user.id) });
});

/** Temporary public links (A8): the active ones, one created by the user, and "remove". */
api.get("/public-links", (c) => c.json({ links: publicLinks.list(c.get("user").id) }));
api.post("/bots/:id/public-links", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  try { return c.json({ link: publicLinks.create(bot.userId, bot.id, String(b.path ?? ""), Number(b.minutes) || DEFAULT_LINK_MIN) }); }
  catch (err) { return fail(400, (err as Error).message); }
});
api.delete("/public-links/:id", (c) => {
  if (!publicLinks.revoke(c.get("user").id, c.req.param("id"))) fail(404, "That link does not exist or is already gone.");
  return c.json({ ok: true });
});

/**
 * Project import (A6). Preview: { env?: text of a .env file, zip?: base64 of a zip of skills } → names, guessed hosts,
 * skills — never a value. Commit: { previewId, bindings: [{ name, import, hosts, header?, prefix? }], replace, skills,
 * skillScope: "shared" | botId }.
 */
api.post("/import/project/preview", async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > 8_000_000) fail(413, "Too large (a .env file and a 5 MB zip at most).");
  const b = await body(c);
  const env = typeof b.env === "string" ? b.env.slice(0, 200_000) : "";
  let zip: Buffer | null = null;
  if (typeof b.zip === "string" && b.zip) { zip = Buffer.from(b.zip, "base64"); if (zip.length > 5_000_000) fail(413, "The zip is too large (5 MB at most)."); }
  if (!env && !zip) fail(400, "Drop a .env file or a zip of skills.");
  try { return c.json(previewImport(c.get("user").id, env, zip)); } catch (err) { return fail(400, (err as Error).message); }
});
api.post("/import/project/commit", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const bindings: ImportBinding[] = Array.isArray(b.bindings) ? b.bindings.filter((x: any) => x && typeof x.name === "string").map((x: any) => ({ name: String(x.name), import: !!x.import, hosts: Array.isArray(x.hosts) ? x.hosts.map(String) : String(x.hosts ?? "").split(/[\s,]+/).filter(Boolean), header: typeof x.header === "string" ? x.header : undefined, prefix: typeof x.prefix === "string" ? x.prefix : undefined })) : [];
  const scope = typeof b.skillScope === "string" && b.skillScope ? b.skillScope : "shared";
  if (scope !== "shared" && !bots.owned(user.id, scope)) fail(404, "That bot does not exist.");
  try { return c.json({ report: await commitImport(user.id, String(b.previewId ?? ""), bindings, { replace: !!b.replace, skills: Array.isArray(b.skills) ? b.skills.map(String) : [], skillScope: scope }) }); }
  catch (err) { return fail(400, (err as Error).message); }
});

/** Paid third-party tools (A4): what was spent (account, or one bot with ?bot=), and the cache policies (A5). */
api.get("/thirdparty", (c) => {
  const user = c.get("user");
  const botId = c.req.query("bot");
  if (botId && !bots.owned(user.id, botId)) fail(404, "That bot does not exist.");
  return c.json({ spend: thirdPartySummary(user.id, botId || undefined), consents: botId ? paidConsents.list(botId) : [] });
});
api.delete("/bots/:id/paid-consents", (c) => { const bot = ownAgent(c); paidConsents.clear(bot.id); audit(bot.userId, "apps", `${bot.name}: paid providers must ask again`, bot.id); return c.json({ ok: true }); });
api.get("/cache-policy", (c) => c.json({ policies: cacheSettings(c.get("user").id), defaults: DEFAULT_CACHE }));
api.put("/cache-policy", async (c) => c.json({ policies: saveCacheSettings(c.get("user").id, (await body(c)).policies) }));

/**
 * CSV import of logins (see vault-import.ts for the formats). Body: { csv, mapping? }. Without a recognisable header
 * the answer is { needsMapping: true, headers } — header names only, never a value — and the browser sends a mapping.
 * Names already in the vault are skipped, never overwritten.
 */
api.post("/vault/import", async (c) => {
  const user = c.get("user");
  if (Number(c.req.header("content-length") ?? 0) > 5_000_000) fail(413, "That file is too large (5 MB at most).");
  const b = await body(c);
  const text = typeof b.csv === "string" ? b.csv : "";
  if (!text.trim()) fail(400, "That file is empty.");
  const all = parseCsv(text);
  if (all.length < 2) fail(400, "No logins were found in that file.");
  const headers = all[0].map((h) => clip(h.trim(), 60));
  let map: Mapping | null = null;
  if (b.mapping && typeof b.mapping === "object") {
    map = {};
    for (const k of ["name", "url", "username", "password", "note", "totp"] as const) {
      const raw = b.mapping[k];
      const v = Number(raw);
      if (raw !== null && raw !== undefined && raw !== "" && Number.isInteger(v) && v >= 0 && v < headers.length) map[k] = v;
    }
    if (map.password === undefined || (map.name === undefined && map.url === undefined)) fail(400, "Choose at least the password column and a name or address column.");
  } else map = detectMapping(headers);
  if (!map) return c.json({ imported: 0, skipped: 0, totp: 0, needsMapping: true, headers });
  const { logins, skipped } = loginsFrom(all.slice(1, 5001), map);
  let imported = 0, totp = 0, dupes = 0;
  for (const l of logins) {
    if (vault.byName(user.id, l.name)) { dupes++; continue; }
    vault.create(user.id, { kind: "login", name: l.name, site: l.url, username: l.username, passwordEnc: seal(l.password), note: l.note });
    imported++;
    if (l.totp && siteOf(l.url)) {
      const name = clip(`${l.name} (2FA)`, 80);
      try {
        const seed = parseTotp(l.totp);
        if (!vault.byName(user.id, name)) { vault.create(user.id, { kind: "totp", name, site: l.url, username: "", passwordEnc: seal(seed.secret), note: "", digits: seed.digits, period: seed.period }); totp++; }
      } catch { /* not a usable seed: the login is kept without it */ }
    }
  }
  audit(user.id, "vault", `Logins imported from a file: ${imported}${totp ? ` (+${totp} two-factor)` : ""}`);
  emit(user.id, { type: "vault" });
  return c.json({ imported, skipped: skipped + dupes, totp });
});

// ── Push notifications ───────────────────────────────────────────────────────
api.get("/push", (c) => {
  const user = c.get("user");
  const endpoint = c.req.query("endpoint");
  return c.json({ ...push.state(user.id), currentId: endpoint ? push.byEndpoint(user.id, endpoint)?.id ?? null : null });
});
api.post("/push/subscribe", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  let device;
  try { device = push.subscribe(user.id, b.subscription ?? {}, typeof b.label === "string" ? b.label : ""); }
  catch (err) { return fail(400, (err as Error).message); }
  audit(user.id, "account", `Push notifications on for ${device.label}`);
  return c.json({ device });
});
api.post("/push/unsubscribe", async (c) => {
  push.removeEndpoint(c.get("user").id, String((await body(c)).endpoint ?? ""));
  return c.json({ ok: true });
});
api.patch("/push/devices/:id", async (c) => {
  const b = await body(c);
  const device = push.update(c.get("user").id, c.req.param("id"), { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, label: typeof b.label === "string" ? b.label : undefined }) ?? fail(404, "That device does not exist.");
  return c.json({ device });
});
api.delete("/push/devices/:id", (c) => {
  if (!push.remove(c.get("user").id, c.req.param("id"))) fail(404, "That device does not exist.");
  return c.json({ ok: true });
});
api.put("/push/settings", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const cur = pushSettings(user.id);
  const kinds = { ...cur.kinds };
  for (const k of PUSH_KINDS) if (typeof b.kinds?.[k] === "boolean") kinds[k] = b.kinds[k];
  const qt = b.quiet ?? {};
  const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  if (qt.timezone !== undefined && !isValidTimezone(String(qt.timezone))) fail(400, "Unknown timezone.");
  const next = { kinds, quiet: { enabled: typeof qt.enabled === "boolean" ? qt.enabled : cur.quiet.enabled, start: hhmm(qt.start, cur.quiet.start), end: hhmm(qt.end, cur.quiet.end), timezone: qt.timezone ? String(qt.timezone) : cur.quiet.timezone } };
  savePushSettings(user.id, next);
  return c.json({ settings: next });
});
api.post("/push/test", async (c) => {
  const user = c.get("user");
  const sent = await sendPush(user.id, { kind: "test", title: "Sklubot", body: tr(user.locale, "Notifications work on this device.") });
  return c.json({ sent });
});
/** Open app windows say whether they are visible, so a finished reply is pushed only when nobody is looking. */
api.post("/presence", async (c) => {
  const b = await body(c);
  notePresence(c.get("user").id, String(b.clientId ?? "default"), b.visible === true);
  return c.json({ ok: true });
});

// ── Local tool servers (localtools.ts): owner only (ownAgent), each on one bot's own Linux computer ──
api.get("/bots/:id/local-tools", (c) => c.json(localTools.state(ownAgent(c).id, c.get("user").locale)));
api.post("/bots/:id/local-tools", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const args = Array.isArray(b.args) ? b.args : [];
  let rec;
  try { rec = localTools.add(bot, { name: String(b.name ?? ""), command: String(b.command ?? "").trim(), args }, "owner"); }
  catch (err) { fail(400, tr(c.get("user").locale, (err as Error).message)); }
  // Started in the background: the page follows it through "localtools" events.
  void localTools.start(rec!.id);
  return c.json(localTools.state(bot.id, c.get("user").locale));
});
/** A local tool server of one of the caller's own bots (404 otherwise). */
const ownLocalTool = (c: Context<Env>) => {
  const rec = localTools.get(c.req.param("id") ?? "");
  if (!rec || rec.userId !== c.get("user").id || bots.byId(rec.botId)?.userId !== c.get("user").id) fail(404, tr(c.get("user").locale, "That local tool server does not exist."));
  return rec!;
};
api.post("/local-tools/:id/restart", async (c) => {
  const rec = ownLocalTool(c);
  await localTools.stop(rec.id);
  void localTools.start(rec.id);
  return c.json(localTools.state(rec.botId, c.get("user").locale));
});
api.post("/local-tools/:id/stop", async (c) => {
  const rec = ownLocalTool(c);
  await localTools.stop(rec.id);
  return c.json(localTools.state(rec.botId, c.get("user").locale));
});
api.delete("/local-tools/:id", async (c) => {
  const rec = ownLocalTool(c);
  await localTools.remove(rec.id);
  return c.json(localTools.state(rec.botId, c.get("user").locale));
});


api.post("/connectors", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  let connector;
  const opts = b.auth === "oauth"
    ? { auth: "oauth" as const, clientId: b.clientId ? String(b.clientId) : undefined, clientSecret: b.clientSecret ? String(b.clientSecret) : undefined }
    : { token: b.token ? String(b.token) : undefined };
  try { connector = await connectors.add(user.id, String(b.name ?? ""), String(b.url ?? ""), { ...opts, catalogId: b.catalogId, ...privateOption(b) }); } // nod 17: private address typed by the user
  catch (err) { return fail(400, (err as Error).message); }
  emit(user.id, { type: "connectors" });
  audit(user.id, "apps", connector.status === "needs_auth" ? `App added, waiting for sign-in: ${connector.name}` : `App ${connector.status === "ready" ? "connected" : "connection failed"}: ${connector.name}`);
  const bot = typeof b.botId === "string" ? bots.owned(user.id, b.botId) : null;
  if (bot && connector.status === "ready") {
    if (Number.isInteger(b.seq)) rows.updateCard(bot, bot.generation, b.seq, (k) => (k.type === "connect" ? { ...k, status: "connected" } : k));
    enqueue(bot.id, { kind: "system", text: `The user connected ${connector.name}. Its tools are available now — continue with what you were doing.` });
  }
  return c.json({ connector });
});

api.post("/connectors/:id/refresh", async (c) => c.json({ connector: (await connectors.refresh(c.get("user").id, c.req.param("id"))) ?? fail(404, "That connector does not exist.") }));
api.delete("/connectors/:id", async (c) => {
  const user = c.get("user");
  const con = connectors.list(user.id).find((k) => k.id === c.req.param("id"));
  await connectors.remove(user.id, c.req.param("id"));
  if (con) audit(user.id, "apps", `App removed: ${con.name}`);
  return c.json({ ok: true });
});

// OAuth sign-in: returns the app's page to open in a popup (or the connector when the sign-in could just be renewed).
// { needsClientId: true } when the app has no dynamic registration: the user then pastes a client ID (and secret).
api.post("/connectors/:id/oauth/start", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  try {
    return c.json(await connectors.startSignIn(user.id, c.req.param("id"), {
      clientId: typeof b.clientId === "string" ? b.clientId : undefined, clientSecret: typeof b.clientSecret === "string" ? b.clientSecret : undefined,
      botId: typeof b.botId === "string" && bots.owned(user.id, b.botId) ? b.botId : undefined, seq: Number.isInteger(b.seq) ? b.seq : undefined,
    }));
  } catch (err) {
    if (err instanceof NeedsClientIdError) return c.json({ needsClientId: true, redirectUri: oauthRedirectUri() });
    return fail(400, (err as Error).message);
  }
});
api.post("/connectors/:id/oauth/disconnect", async (c) => c.json({ connector: (await connectors.signOut(c.get("user").id, c.req.param("id"))) ?? fail(404, "That connector does not exist.") }));

// ── Built-in apps (Gmail, Google Calendar, Google Drive, Outlook, Slack) ─────
const vendorParam = (c: Context<Env>): NativeVendor => { const v = c.req.param("vendor") as NativeVendor; return VENDORS.includes(v) ? v : fail(404, "Unknown app vendor."); };
function vendorSetup(userId: string, locale: "fr" | "en", vendor: NativeVendor): NativeVendorSetup {
  const client = nativeClients.get(userId, vendor);
  return {
    vendor, name: VENDOR_NAMES[vendor], redirectUri: nativeRedirectUri(vendor), steps: setupSteps(vendor, locale), docs: setupDocs(vendor),
    configured: !!client, clientId: client?.clientId ?? null,
    ...(vendor === "microsoft" ? { tenant: client?.tenant ?? "common" } : {}),
    ...(vendor === "slack" ? { hasAppToken: !!client?.appToken } : {}),
  };
}
api.get("/native", (c) => {
  const user = c.get("user");
  return c.json({ apps: appsFor(user.locale), vendors: VENDORS.map((v) => vendorSetup(user.id, user.locale, v)), accounts: nativeAccounts.list(user.id).map(publicAccount) });
});
// The OAuth client the user created. The secret and the Slack app-level token are sealed and never sent back.
api.put("/native/clients/:vendor", async (c) => {
  const user = c.get("user");
  const vendor = vendorParam(c);
  const b = await body(c);
  try {
    nativeClients.set(user.id, vendor, { clientId: String(b.clientId ?? ""), clientSecret: typeof b.clientSecret === "string" ? b.clientSecret : undefined, tenant: typeof b.tenant === "string" ? b.tenant : undefined, appToken: b.appToken === null ? null : typeof b.appToken === "string" ? b.appToken : undefined });
  } catch (err) { return fail(400, (err as Error).message); }
  syncSlackSockets();
  return c.json({ vendor: vendorSetup(user.id, user.locale, vendor) });
});
api.delete("/native/clients/:vendor", (c) => {
  const user = c.get("user");
  nativeClients.remove(user.id, vendorParam(c));
  syncSlackSockets();
  return c.json({ ok: true });
});
// A new labelled account ("Gmail — pro"): returns the vendor's sign-in page to open in a popup.
api.post("/native/accounts", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const app = appOf(String(b.app ?? ""));
  if (!app) return fail(400, "Unknown app.");
  if (!nativeClients.get(user.id, app.vendor)) return fail(400, `Set up your ${VENDOR_NAMES[app.vendor]} OAuth client first.`);
  let acc;
  try { acc = nativeAccounts.create(user.id, app.id, String(b.label ?? "")); } catch (err) { return fail(400, (err as Error).message); }
  return c.json({ account: publicAccount(acc), authorizeUrl: nativeStart(user.id, acc.id) });
});
// Sign in again (never a dead end): a new sign-in for the same account keeps its label, routines and permissions.
api.post("/native/accounts/:id/signin", (c) => {
  const user = c.get("user");
  try { return c.json({ authorizeUrl: nativeStart(user.id, c.req.param("id")) }); } catch (err) { return fail(400, (err as Error).message); }
});
api.patch("/native/accounts/:id", async (c) => {
  const user = c.get("user");
  try { return c.json({ account: publicAccount(nativeAccounts.rename(user.id, c.req.param("id"), String((await body(c)).label ?? ""))) }); } catch (err) { return fail(400, (err as Error).message); }
});
// Disconnect: the vendor is asked to revoke the token where it can, then everything is forgotten here.
api.delete("/native/accounts/:id", async (c) => {
  const user = c.get("user");
  if (!(await nativeDisconnect(user.id, c.req.param("id")))) return fail(404, "That account does not exist.");
  syncSlackSockets();
  for (const b of bots.list(user.id)) emit(user.id, { type: "routines", botId: b.id });
  return c.json({ ok: true });
});

// A routine fed by a built-in app account (new email, new Slack message, upcoming event), set up from the routines screen.
api.post("/bots/:id/routines", async (c) => {
  const user = c.get("user");
  const bot = ownAgent(c);
  const b = await body(c);
  const kind = String(b.kind ?? "");
  if (!isNativeTrigger(kind)) return fail(400, "kind must be email, slack or calendar.");
  const acc = nativeAccounts.owned(user.id, String(b.accountId ?? ""));
  if (!acc) return fail(400, "Pick one of your connected accounts.");
  if (!appOf(acc.app)!.triggers.includes(kind)) return fail(400, `${acc.name} cannot be used for this kind of trigger.`);
  const prompt = String(b.prompt ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!name || !prompt) return fail(400, "A routine needs a name and an instruction.");
  const channel = String(b.channel ?? "").trim();
  if (kind === "slack" && !channel) return fail(400, "Choose a channel (#name or id), or @dm for direct messages.");
  const r = routines.create(bot.id, {
    name, prompt, trigger: kind,
    native: { accountId: acc.id, query: String(b.query ?? "").trim().slice(0, 300), channel: channel.slice(0, 100), mentionsOnly: !!b.mentionsOnly, leadMin: Math.min(1440, Math.max(1, Math.round(Number(b.leadMin) || 10))), everyMin: Math.min(1440, Math.max(2, Math.round(Number(b.everyMin) || 5))) },
  });
  schedule(r.id);
  syncSlackSockets();
  audit(user.id, "routine", `${bot.name}: routine created — ${r.name} (${publicRoutine(r, "en").describe})`, bot.id);
  rows.append(bot, { kind: "event", event: "routine", text: tr(user.locale, "Routine created: {name} — {when}", { name: r.name, when: publicRoutine(r, user.locale).describe }) });
  emit(user.id, { type: "routines", botId: bot.id });
  return c.json({ routine: publicRoutine(r, user.locale) });
});

api.get("/policies", (c) => c.json({ policies: policies.list(c.get("user").id) }));
api.delete("/policies/:tool", (c) => { policies.remove(c.get("user").id, decodeURIComponent(c.req.param("tool"))); return c.json({ ok: true }); });

// ── Rooms ────────────────────────────────────────────────────────────────────
api.post("/rooms", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const name = String(b.name ?? "").trim().slice(0, 60);
  const ids = validMembers(user.id, b.botIds);
  if (!name) fail(400, "Give the group a name.");
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  return c.json({ id: createRoom(user.id, name, ids).id });
});

const ownRoom = (c: Context<Env>) => { const b = ownBot(c); return b.kind === "room" ? b : fail(404, "That group does not exist."); };
api.get("/rooms/:id/members", (c) => { const room = ownRoom(c); return c.json({ members: room.memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b && b.userId === room.userId).map(publicBot) }); });

api.put("/rooms/:id/members", async (c) => {
  const room = ownRoom(c);
  const ids = validMembers(room.userId, (await body(c)).botIds);
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  const name = (id: string) => bots.byId(id)?.name ?? "a bot";
  const joined = ids.filter((id) => !room.memberIds.includes(id)).map(name);
  const left = room.memberIds.filter((id) => !ids.includes(id)).map(name);
  const loc = c.get("user").locale;
  bots.patch(room.id, { memberIds: ids, description: tr(loc, "Group chat with {n} bots.", { n: ids.length }) });
  if (joined.length || left.length)
    rows.append(room, { kind: "event", event: "members", text: [joined.length ? tr(loc, "{names} joined", { names: joined.join(", ") }) : "", left.length ? tr(loc, "{names} left", { names: left.join(", ") }) : ""].filter(Boolean).join(" · ") });
  emit(room.userId, { type: "roster" });
  return c.json({ ok: true });
});

// ── Check-ins and usage ──────────────────────────────────────────────────────
const publicCheckins = (userId: string): CheckinSettings => { const s = settings.checkins(userId); return { enabled: s.enabled, times: s.times, timezone: s.timezone }; };
api.get("/checkins", (c) => c.json(publicCheckins(c.get("user").id)));
api.put("/checkins", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const cur = settings.checkins(user.id);
  if (b.timezone !== undefined && !isValidTimezone(String(b.timezone))) fail(400, "Unknown timezone. Use a name like Europe/Paris.");
  const times = Array.isArray(b.times) ? b.times.filter((t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6) : cur.times;
  settings.saveCheckins(user.id, { ...cur, enabled: b.enabled === undefined ? cur.enabled : !!b.enabled, times, timezone: b.timezone === undefined ? cur.timezone : String(b.timezone) });
  return c.json(publicCheckins(user.id));
});
api.post("/checkins/now", (c) => { fireCheckin(c.get("user").id, 0); return c.json({ ok: true }); });

api.get("/usage", (c) => c.json(usageSummary(c.get("user").id)));
api.put("/usage/budget", async (c) => {
  const v = (await body(c)).budgetUsd;
  if (v !== null && !(typeof v === "number" && v >= 0)) fail(400, "The budget must be a positive number, or empty for no limit.");
  settings.setBudget(c.get("user").id, v);
  emit(c.get("user").id, { type: "usage" });
  return c.json(usageSummary(c.get("user").id));
});

/**
 * Usage caps (usagecaps.ts): today and this month per bot and for the account, with the caps (GET); one cap set or
 * removed (PUT: limit null or 0 removes it) — the account's own caps only (an operator's cap on a hosted customer is
 * set in the administration); the answer on a cap's card (POST).
 */
const capsViewOf = (userId: string) => {
  const d = new Date();
  return capsView(userId, { owner: true, budgetUsd: settings.budget(userId), budgetSpentUsd: spentThisMonth(userId), budgetResetAt: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) });
};
api.get("/usage/caps", (c) => c.json(capsViewOf(c.get("user").id)));
api.put("/usage/caps", async (c) => {
  const user = c.get("user");
  const f = cleanCapInput(await body(c));
  if (f.botId) { const b = bots.owned(user.id, f.botId); if (!b || b.kind !== "agent" || b.hidden) throw new CapError(404, "Unknown bot."); }
  if (usageCaps.set(user.id, f, "self", user.id)) {
    const name = capName({ ...f, setBy: "self" }, "en");
    audit(user.id, "account", f.limit === null ? `Usage cap removed: ${name}` : `Usage cap set: ${name} ${amountText(f.unit, f.limit, "en")}, stops ${f.mode === "everything" ? "everything" : "unattended work"}, warning at ${f.warnPercent}%`, f.botId);
  }
  emit(user.id, { type: "usage" });
  return c.json(capsViewOf(user.id));
});
api.post("/usage/caps/stops/:stopId", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  await answerCapCard(user.id, c.req.param("stopId"), String(b.action ?? ""), b.limit);
  return c.json({ ok: true });
});

/**
 * SK-P0-06: prices of the server's own models (the .env providers). Every signed-in user sees where each price comes
 * from ("builtin" with its official page, "owner", or unknown → "coût inconnu"); only the instance owner (the first
 * account, googlelogin.ts ownerId) may set a price. Prices in USD per million tokens, like the user providers' fields.
 */
function serverModelPrices(userId: string) {
  const models = new Set<string>(listProviders().filter((p) => p.available() && p.id !== "demo").flatMap((p) => p.models));
  for (const r of ownerPrices.list()) models.add(r.model);
  for (const r of q.all<{ model: string }>("SELECT DISTINCT model FROM usage WHERE price_status = 'unknown' AND model NOT LIKE 'up-%' AND user_id = ?", userId)) models.add(r.model);
  const notes = new Map(ownerPrices.list().map((r) => [r.model, r.note]));
  return {
    owner: ownerId() === userId,
    unknownEstimate: { input: UNKNOWN_ESTIMATE[0], output: UNKNOWN_ESTIMATE[1], cached: UNKNOWN_ESTIMATE[2] },
    checkedOn: PRICE_SOURCES.checkedOn,
    models: [...models].sort().map((model) => {
      const info = priceInfo(model);
      return { model, origin: info?.origin ?? null, source: info?.source ?? null, input: info?.prices[0] ?? null, output: info?.prices[1] ?? null, cached: info?.prices[2] ?? null, note: notes.get(model) ?? "" };
    }),
  };
}
api.get("/model-prices", (c) => c.json(serverModelPrices(c.get("user").id)));
api.put("/model-prices/:model", async (c) => {
  const user = c.get("user");
  if (ownerId() !== user.id) fail(403, "Only the owner of this server can change this.");
  const model = c.req.param("model");
  if (!model || model.length > 100 || !/^[A-Za-z0-9._:/@+-]+$/.test(model) || model.startsWith("up-")) fail(400, "Unknown model.");
  const b = await body(c);
  const price = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.round(n * 1_000_000) / 1_000_000 : fail(400, "A price is a number of dollars per million tokens (0 to 10000).");
  };
  ownerPrices.set(model, { input: price(b.input), output: price(b.output), cached: price(b.cached), note: typeof b.note === "string" ? b.note : "" }, user.id);
  audit(user.id, "account", `Price of model ${model} set (per million tokens: input ${b.input ?? "—"}, output ${b.output ?? "—"}, cached ${b.cached ?? "—"})`);
  return c.json(serverModelPrices(user.id));
});

// ── Wave 5: rules and the reviewer, uncertain actions, background tasks, nudges, memory ──────────────────
api.get("/rules", (c) => c.json(rulesState(c.get("user").id)));
api.post("/rules", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const text = String(b.text ?? "").trim();
  if (!text) fail(400, "Write the rule.");
  if (rules.count(user.id) >= MAX_RULES) fail(409, `At most ${MAX_RULES} rules.`);
  const botId = typeof b.botId === "string" && b.botId ? ownBot(c, b.botId).id : null;
  const scope = ruleScopeOf(user.id, b);
  const rule = rules.create(user.id, text, scope.routineBot ?? botId, { routineId: scope.routineId, trigger: scope.trigger });
  audit(user.id, "account", `Rule added${botId ? ` for ${bots.byId(botId)?.name}` : ""}: ${clip(rule.text, 200)}`, botId);
  emit(user.id, { type: "rules" });
  return c.json({ rule });
});
api.patch("/rules/:id", async (c) => {
  const user = c.get("user");
  const cur = rules.owned(user.id, c.req.param("id")) ?? fail(404, "That rule does not exist.");
  const b = await body(c);
  const scope = "routineId" in b || "trigger" in b ? ruleScopeOf(user.id, b) : null;
  const rule = rules.update(cur.id, { text: typeof b.text === "string" ? b.text : undefined, enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, ...(scope ? { routineId: scope.routineId, trigger: scope.trigger, ...(scope.routineBot ? { botId: scope.routineBot } : {}) } : {}) });
  audit(user.id, "account", `Rule changed: ${clip(rule.text, 200)}${rule.enabled ? "" : " (off)"}`, rule.botId);
  emit(user.id, { type: "rules" });
  return c.json({ rule });
});
api.delete("/rules/:id", (c) => {
  const user = c.get("user");
  const cur = rules.owned(user.id, c.req.param("id")) ?? fail(404, "That rule does not exist.");
  rules.remove(cur.id);
  audit(user.id, "account", `Rule removed: ${clip(cur.text, 200)}`, cur.botId);
  emit(user.id, { type: "rules" });
  return c.json({ ok: true });
});
api.put("/rules/reviewer", async (c) => {
  const user = c.get("user");
  const model = String((await body(c)).model ?? "").trim();
  if (model && cleanModelList([model]).length !== 1) fail(400, "That is not a model reference (provider:model).");
  settings.saveReview(user.id, { model });
  emit(user.id, { type: "rules" });
  return c.json(rulesState(user.id));
});
function rulesState(userId: string) { return { rules: rules.all(userId), reviewerModel: settings.review(userId).model, auxModel: config.auxModel, changes: ruleChanges.list(userId) }; }
/** A rule's scope from a request: one of the user's routines (then it belongs to that routine's bot), or a trigger kind. */
function ruleScopeOf(userId: string, b: Record<string, any>): { routineId: string | null; trigger: RuleTrigger | null; routineBot: string | null } {
  if (typeof b.routineId === "string" && b.routineId) {
    const r = routines.owned(userId, b.routineId) ?? fail(404, "That routine does not exist.");
    return { routineId: r.id, trigger: null, routineBot: r.botId };
  }
  if (b.trigger !== undefined && b.trigger !== null && b.trigger !== "") {
    if (!isRuleTrigger(b.trigger)) fail(400, "Unknown trigger kind.");
    return { routineId: null, trigger: b.trigger as RuleTrigger, routineBot: null };
  }
  return { routineId: null, trigger: null, routineBot: null };
}
/** Undoes a rule change a bot made from the chat (one click in Settings → Rules or on the chat line). */
api.post("/rules/changes/:id/undo", (c) => {
  const user = c.get("user");
  const ch = ruleChanges.owned(user.id, c.req.param("id")) ?? fail(404, "That change does not exist.");
  if (!ruleChanges.undo(user.id, ch.id)) fail(409, "This change was already undone.");
  audit(user.id, "account", `Rule change undone (${ch.action}): ${clip(ch.text, 200)}`, ch.botId);
  emit(user.id, { type: "rules" });
  return c.json(rulesState(user.id));
});

// ── Wave 5b ──────────────────────────────────────────────────────────────────
// Spend checkpoints (A5): the account's default, and the answer on a checkpoint card.
api.get("/spend", (c) => c.json({ settings: settings.spend(c.get("user").id) }));
api.put("/spend", async (c) => {
  const user = c.get("user");
  const n = Number((await body(c)).checkpointUsd);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) fail(400, "The checkpoint is an amount between 0 (off) and 10 000.");
  const next = settings.saveSpend(user.id, { checkpointUsd: n });
  audit(user.id, "account", `Spend checkpoint set to ${next.checkpointUsd.toFixed(2)} $`);
  emit(user.id, { type: "usage" });
  return c.json({ settings: next });
});
api.post("/spend/:id", async (c) => {
  const user = c.get("user");
  const cp = checkpoints.byId(c.req.param("id"));
  const worker = cp ? bots.byId(cp.workerId) : null;
  if (!cp || !worker || worker.userId !== user.id) return fail(404, "That checkpoint does not exist.");
  const action = String((await body(c)).action ?? "");
  if (action !== "continue" && action !== "raise" && action !== "stop") fail(400, "Unknown action.");
  if (!(await answerCheckpoint(cp, action as "continue" | "raise" | "stop"))) fail(409, "This was already answered.");
  // Stopping at a checkpoint also pauses the worker's goals: no new round starts on its own.
  if (action === "stop") pauseGoalsOf(worker, tr(user.locale, "stopped at a spend checkpoint"));
  return c.json({ ok: true });
});

// The detailed usage journal (A14): filterable, exportable.
function journalFilter(c: Context<Env>): JournalFilter {
  const n = (k: string) => { const v = Number(c.req.query(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const days = n("days");
  return { from: n("from") ?? (days ? Date.now() - days * 86400_000 : undefined), to: n("to"), botId: c.req.query("bot") || undefined, tool: c.req.query("tool") || undefined, decision: c.req.query("decision") || undefined, limit: n("limit"), before: n("before") };
}
api.get("/journal", (c) => { const user = c.get("user"); const f = journalFilter(c); return c.json({ entries: listJournal(user.id, f), totals: journalTotals(user.id, f) }); });
api.get("/journal.csv", (c) => download(c, "sklubot-journal.csv", "text/csv; charset=utf-8", journalCsv(c.get("user").id, journalFilter(c))));

// Card payments (A12): the list, for the vault page.
api.get("/payments", (c) => c.json({ payments: payments.list(c.get("user").id) }));

// Task guides (A10): the built-in index.
api.get("/guides", (c) => c.json({ guides: guideIndex() }));

// First-task ideas (A19). ?mail=1: the user opted in to a sample of recent email subjects (read-only, matched here).
api.get("/ideas", async (c) => {
  const user = c.get("user");
  const r = await firstTaskIdeas(user.id, user.locale, c.req.query("mail") === "1");
  if (r.source === "mail") audit(user.id, "apps", `First-task ideas from ${r.sampled} email subjects (read-only)`);
  return c.json(r);
});

// A learned skill the bot proposed (A9): saved (as reviewed, maybe edited, by the user) or dismissed.
api.post("/bots/:id/cards/:seq/skill", async (c) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "skill" ? row.body.card : fail(400, "That is not a proposed skill.");
  if (card.status !== "pending") fail(409, "This was already answered.");
  const b = await body(c);
  if (b.action === "dismiss") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "skill" ? { ...k, status: "dismissed" } : k));
    return c.json({ ok: true });
  }
  if (b.action !== "save") fail(400, "Unknown action.");
  const name = clip(String(b.name ?? card.name).trim(), 80), when = clip(String(b.when ?? card.when).trim(), 300), steps = String(b.steps ?? card.steps).trim().slice(0, 20_000);
  if (!name || !steps) fail(400, "A skill needs a name and steps.");
  const existing = skills.list(bot.id).find((k) => k.name.toLowerCase() === name.toLowerCase());
  if (existing) fail(409, "A skill with this name already exists.");
  // Kept as outside content when the task had read outside content: it then never authorises anything.
  const saved = skills.create(bot.id, name, when, steps, false, { learned: true, outside: card.outside });
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "skill" ? { ...k, name, when, steps, status: "saved" } : k));
  audit(c.get("user").id, "account", `${bot.name}: learned skill saved — ${name}${card.outside ? " (outside content)" : ""}`, bot.id);
  emit(c.get("user").id, { type: "memories", botId: bot.id });
  return c.json({ ok: true, draft: saved.draft }); // draft: the safety check flagged it (skillscan.ts)
});

// A contradicted note (memory confidence): the user says which is right. "old" keeps the note (confirmed), "new"
// archives it and keeps the new fact, confirmed, with the user's words.
api.post("/bots/:id/cards/:seq/memory", async (c) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "memory" ? row.body.card : fail(400, "That is not a memory question.");
  if (card.status !== "pending") fail(409, "This was already answered.");
  const choice = String((await body(c)).choice ?? "");
  if (choice !== "old" && choice !== "new") fail(400, "Choose old or new.");
  const m = memories.owned(c.get("user").id, card.memoryId);
  if (choice === "old") { if (m) { memories.setStatus(m.id, "active"); memories.confirm(m.id); } }
  else {
    if (m) memories.setStatus(m.id, "archived");
    const fresh = memories.add(bot.id, card.newText, "learned", { quote: card.quote, category: m?.category ?? null });
    memories.confirm(fresh.id);
  }
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "memory" ? { ...k, status: choice === "old" ? "kept" : "replaced" } : k));
  emit(c.get("user").id, { type: "memories", botId: bot.id });
  return c.json({ ok: true });
});

// API connectors on demand (A16).
api.get("/api-connectors", (c) => c.json({ connectors: apiConnectors.list(c.get("user").id) }));
api.delete("/api-connectors/:id", (c) => {
  const user = c.get("user");
  const conn = apiConnectors.owned(user.id, c.req.param("id")) ?? fail(404, "That connector does not exist.");
  apiConnectors.remove(user.id, conn.id);
  audit(user.id, "apps", `API connector removed: ${conn.name}`);
  emit(user.id, { type: "apiConnectors" });
  return c.json({ ok: true });
});
/** The card of api_connector_propose: approve (with the token typed there when the vault has none) or dismiss. */
api.post("/bots/:id/cards/:seq/apiconnector", async (c) => {
  const bot = ownAgent(c);
  const user = c.get("user");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "apiconnector" ? row.body.card : fail(400, "That is not an API connector.");
  if (card.status !== "pending") fail(409, "This was already answered.");
  const conn = apiConnectors.owned(user.id, card.connectorId) ?? fail(404, "That connector does not exist.");
  const b = await body(c);
  if (b.action === "dismiss") {
    apiConnectors.remove(user.id, conn.id);
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "apiconnector" ? { ...k, status: "dismissed" } : k));
    enqueue(bot.id, { kind: "system", text: `The user did not approve the API connector "${conn.name}". Carry on without it, or say what cannot be done.`, thread: row!.thread || undefined });
    emit(user.id, { type: "apiConnectors" });
    return c.json({ ok: true });
  }
  if (b.action !== "approve") fail(400, "Unknown action.");
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (token.length > 8000) fail(400, "That token is too long.");
  const r = approveConnector(user.id, conn, token ? seal(token) : null);
  if (!r.ok) return fail(400, r.error);
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "apiconnector" ? { ...k, secretSaved: true, status: "approved" } : k));
  enqueue(bot.id, { kind: "system", text: `The user approved the API connector "${conn.name}" (${conn.endpoints.length} endpoints). Use api_get to read and api_send to change things — you will not see the token. Continue with what you were doing.`, thread: row!.thread || undefined });
  return c.json({ ok: true });
});

/** An action whose outcome is unknown: it went through (done), the bot checks (check), or it is retried once (retry). */
api.post("/executions/:id", async (c) => {
  const user = c.get("user");
  const exec = executions.owned(user.id, c.req.param("id")) ?? fail(404, "That action does not exist.");
  const action = String((await body(c)).action ?? "");
  if (!["done", "check", "retry", "dismiss"].includes(action)) fail(400, "Unknown action.");
  const bot = bots.byId(exec.botId) ?? fail(404, "That bot does not exist.");
  const status = action === "done" ? "done" : action === "check" ? "checking" : action === "retry" ? "retried" : "dismissed";
  if (exec.cardSeq !== null && exec.generation === bot.generation) {
    const row = rows.get(bot.id, exec.generation, exec.cardSeq);
    if (row?.body.kind === "card" && row.body.card.type === "uncertain" && row.body.card.status !== "pending") fail(409, "This was already answered.");
    rows.updateCard(bot, exec.generation, exec.cardSeq, (k) => (k.type === "uncertain" ? { ...k, status } : k));
  }
  const thread = exec.thread || undefined;
  if (action === "done") enqueue(bot.id, { kind: "system", thread, text: `The user confirmed that this action went through: ${exec.label} (${clip(exec.detail.replace(/\n/g, "; "), 400)}). Do not do it again.` });
  if (action === "check") enqueue(bot.id, { kind: "system", thread, text: `The outcome of this action is unknown: ${exec.label} (${clip(exec.detail.replace(/\n/g, "; "), 400)}). Check whether it went through — look, list or read — WITHOUT doing it again, then tell the user plainly.` });
  if (action === "retry") {
    // One single-use grant for exactly this action (same tool, same arguments), valid 30 minutes.
    grants.create(bot.id, exec.actionHash);
    enqueue(bot.id, { kind: "system", thread, text: `The user asked you to retry this action once, exactly as before: ${exec.tool} with ${clip(exec.detail.replace(/\n/g, "; "), 800)}. First check quickly whether it already went through; if it did not, call ${exec.tool} again with exactly the same arguments.` });
  }
  audit(user.id, "approval", `${bot.name} : ${exec.label} — ${tr(user.locale, action === "done" ? "went through (user)" : action === "check" ? "check asked" : action === "retry" ? "retry allowed once" : "dismissed")}`, bot.id);
  return c.json({ ok: true });
});

// Background tasks.
const ownTask = (c: Context<Env>) => { const bot = ownAgent(c); const t = bgTasks.byId(c.req.param("taskId") ?? ""); return t && t.botId === bot.id ? t : fail(404, "That task does not exist."); };
api.get("/bots/:id/bgtasks", (c) => c.json({ tasks: bgTasks.forBot(ownAgent(c).id).map(publicTask) }));
api.post("/bots/:id/bgtasks/:taskId/stop", async (c) => c.json({ task: publicTask(await stopTask(ownTask(c))) }));
api.post("/bots/:id/bgtasks/:taskId/reply", async (c) => {
  const t = ownTask(c);
  const screened = screenSecrets(String((await body(c)).text ?? "").trim(), c.get("user").locale);
  const text = screened.text;
  if (!text) fail(400, "Write a message first.");
  // The card for a pasted secret goes in the bot's own chat (the task card lives there).
  if (screened.secrets.length) { const owner = bots.byId(t.botId); if (owner) holdAndOffer(owner, c.get("user").id, screened.secrets); }
  try { return c.json({ task: publicTask(await replyToTask(t, clip(text, 20_000))) }); } catch (err) { return fail(409, (err as Error).message); }
});

// Nudges.
api.get("/bots/:id/nudges", (c) => { const bot = ownAgent(c); return c.json({ settings: bot.nudges, stats: nudgeStats(bot.id), nudges: nudges.forBot(bot.id).map(({ generation: _g, cardSeq: _c, ...n }) => n) }); });
api.post("/bots/:id/nudges/run", async (c) => {
  const bot = ownAgent(c);
  try { return c.json({ result: await preparationPass(bot.id, true), stats: nudgeStats(bot.id) }); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});
api.post("/bots/:id/nudges/:nudgeId", async (c) => {
  const bot = ownAgent(c);
  const n = nudges.byId(c.req.param("nudgeId")) ?? fail(404, "That nudge does not exist.");
  if (n.botId !== bot.id) fail(404, "That nudge does not exist.");
  const action = String((await body(c)).action ?? "");
  if (!["do", "later", "never"].includes(action)) fail(400, "Unknown action.");
  if (n.status !== "pending") fail(409, "This nudge was already answered.");
  return c.json({ nudge: actOnNudge(bot, n, action as "do" | "later" | "never") });
});

// Memory: import / export, settings (sensitive topics, writing style). One note (statuses, text, bin): memoryroutes.ts.
api.get("/bots/:id/memories/export", (c) => {
  const bot = ownAgent(c);
  const format = c.req.query("format") === "json" ? "json" : "md";
  const text = exportMemories(bot, format, c.get("user").locale);
  return download(c, `${bot.name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}-memories.${format === "json" ? "json" : "md"}`, format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8", text);
});
api.post("/bots/:id/memories/import", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const text = String(b.text ?? "");
  if (!text.trim()) fail(400, "Paste the memories to import.");
  if (text.length > 200_000) fail(413, "That is too long.");
  if (b.commit !== true) return c.json({ candidates: importCandidates(bot, text) });
  const chosen = Array.isArray(b.chosen) ? b.chosen.filter((x: unknown): x is string => typeof x === "string") : null;
  const r = importMemories(bot, text, chosen, b.allowSensitive === true);
  audit(bot.userId, "account", `Memories imported for ${bot.name}: ${r.imported}`, bot.id);
  return c.json(r);
});
api.get("/memory-settings", (c) => c.json({ settings: settings.memory(c.get("user").id) }));
api.put("/memory-settings", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const next = settings.saveMemory(user.id, {
    autoCapture: typeof b.autoCapture === "boolean" ? b.autoCapture : undefined,
    autoRecall: typeof b.autoRecall === "boolean" ? b.autoRecall : undefined,
    allowSensitive: b.allowSensitive && typeof b.allowSensitive === "object" ? b.allowSensitive : undefined,
    style: b.style && typeof b.style === "object" ? { ...(typeof b.style.enabled === "boolean" ? { enabled: b.style.enabled } : {}), ...(b.style.clear === true ? { profile: "", updatedAt: null, source: null, samples: 0 } : {}) } : undefined,
  });
  emit(user.id, { type: "memorySettings" });
  return c.json({ settings: next });
});
api.post("/memory-settings/style/learn", async (c) => {
  const user = c.get("user");
  const bot = bots.primary(user.id) ?? bots.list(user.id).find((b) => b.kind === "agent") ?? fail(400, "Create a bot first.");
  let mail: string[] = [];
  try { mail = await sentMail(user.id); } catch { /* no mailbox, or it failed: learn from the chat */ }
  try {
    const r = await learnStyle(user.id, bot, mail);
    audit(user.id, "account", `Writing style learned from ${r.samples} ${r.source === "mail" ? "sent emails" : "chat messages"}`);
    emit(user.id, { type: "memorySettings" });
    return c.json({ settings: settings.memory(user.id), source: r.source, samples: r.samples });
  } catch (err) { return fail(502, (err as Error).message); }
});

// ── Wave 6: workspaces, roles, shared bots ───────────────────────────────────
api.get("/workspaces", (c) => c.json({ workspaces: workspaces.listFor(c.get("user").id) }));
api.post("/workspaces", async (c) => {
  const user = c.get("user");
  const ws = workspaces.create(user.id, String((await body(c)).name ?? ""));
  workspaceChanged([user.id]);
  return c.json({ workspace: ws });
});
api.patch("/workspaces/:wid", async (c) => {
  const ws = workspaces.update(c.req.param("wid"), c.get("user").id, await body(c));
  workspaceChanged(workspaces.memberIds(ws.id));
  return c.json({ workspace: ws });
});
api.delete("/workspaces/:wid", (c) => {
  const members = workspaces.remove(c.req.param("wid"), c.get("user").id);
  workspaceChanged(members);
  return c.json({ ok: true });
});
/** Who is in the workspace (any member may see the list: it is who they share bots with). */
api.get("/workspaces/:wid/members", (c) => {
  const user = c.get("user");
  workspaces.listFor(user.id).find((w) => w.id === c.req.param("wid")) ?? fail(404, "That workspace does not exist.");
  return c.json({ members: workspaces.members(c.req.param("wid")) });
});
api.put("/workspaces/:wid/members/:uid", async (c) => {
  const wid = c.req.param("wid");
  workspaces.setRole(wid, c.get("user").id, c.req.param("uid"), (await body(c)).role);
  workspaceChanged(workspaces.memberIds(wid));
  return c.json({ members: workspaces.members(wid) });
});
/** Removes someone (or leaves, for yourself). ?purge=1: also deletes what they wrote in the workspace's shared bots. */
api.delete("/workspaces/:wid/members/:uid", (c) => {
  const wid = c.req.param("wid");
  const target = c.req.param("uid");
  const before = workspaces.memberIds(wid);
  workspaces.removeMember(wid, c.get("user").id, target, c.req.query("purge") === "1");
  workspaceChanged(before.includes(target) ? before : [...before, target]);
  return c.json({ ok: true });
});
api.post("/workspaces/:wid/invites", async (c) => {
  const b = await body(c);
  const invite = invites.create(c.req.param("wid"), c.get("user").id, b.email, b.role);
  emit(c.get("user").id, { type: "workspaces" });
  return c.json({ invite });
});
api.delete("/workspaces/:wid/invites/:iid", (c) => {
  invites.revoke(c.req.param("wid"), c.get("user").id, c.req.param("iid"));
  return c.json({ ok: true });
});
api.post("/invites/accept", async (c) => {
  const user = c.get("user");
  throttle(`invite:${user.id}`, 10);
  const ws = invites.accept(String((await body(c)).token ?? ""), user.id);
  workspaceChanged(workspaces.memberIds(ws.id));
  return c.json({ workspace: ws });
});
api.get("/workspaces/:wid/admin", (c) => c.json(adminView(c.req.param("wid"), c.get("user").id)));
api.get("/workspaces/:wid/export", (c) => {
  const data = exportWorkspace(c.req.param("wid"), c.get("user").id);
  return c.body(JSON.stringify(data, null, 2), 200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="workspace-${c.req.param("wid")}.json"`, "cache-control": "no-store" });
});
api.post("/workspaces/:wid/resources", async (c) => {
  const b = await body(c);
  resources.share(c.req.param("wid"), c.get("user").id, b.kind, b.id);
  return c.json({ resources: resources.list(c.req.param("wid")) });
});
api.delete("/workspaces/:wid/resources/:kind/:rid", (c) => {
  resources.unshare(c.req.param("wid"), c.get("user").id, c.req.param("kind"), c.req.param("rid"));
  return c.json({ resources: resources.list(c.req.param("wid")) });
});
/** The owner shares one of their bots to a workspace (everyone, or a list of members) and picks who answers its approvals. */
api.put("/bots/:id/share", async (c) => {
  const bot = ownAgent(c);
  const before = shares.of(bot.id);
  const share = shares.set(bot, c.get("user").id, await body(c));
  workspaceChanged([...workspaces.memberIds(share.workspaceId), ...(before ? workspaces.memberIds(before.workspaceId) : [])]);
  return c.json({ share });
});
api.delete("/bots/:id/share", (c) => {
  const bot = ownAgent(c);
  const before = shares.of(bot.id);
  shares.clear(bot, c.get("user").id);
  if (before) workspaceChanged(workspaces.memberIds(before.workspaceId));
  return c.json({ ok: true });
});

// ── Wave 6: the bots' own email addresses ────────────────────────────────────
/** Whether this server receives mail, for which domain, and the account's relay (secrets never returned). */
api.get("/mail", (c) => c.json({ domain: config.mailDomain || null, receiving: mailReceiving(), relay: relays.get(c.get("user").id) }));
api.put("/mail/relay", async (c) => c.json({ relay: relays.set(c.get("user").id, await body(c)) }));
api.delete("/mail/relay", (c) => { relays.remove(c.get("user").id); return c.json({ ok: true }); });
api.get("/bots/:id/email", (c) => {
  const bot = ownAgent(c);
  return c.json({ email: botEmail.get(bot.id), mails: mailFor(bot.id, 50), routine: routines.forBot(bot.id).some((r) => r.trigger === "botmail") });
});
api.put("/bots/:id/email", async (c) => {
  const bot = ownAgent(c);
  const email = botEmail.set(bot, await body(c));
  return c.json({ email });
});
api.delete("/bots/:id/email", (c) => { botEmail.remove(ownAgent(c)); return c.json({ ok: true }); });
/** A held mail (sender not allowed, DMARC fail, spam) is let through by the user: the bot can read it now. */
api.post("/bots/:id/mail/:mailId/release", (c) => {
  const bot = ownAgent(c);
  const m = releaseMail(bot, c.req.param("mailId")) ?? fail(404, "That email does not exist or is not held.");
  return c.json({ mail: m });
});
/** The "new email to this bot" routine: one per bot, with the user's instructions for what to do with each mail. */
api.post("/bots/:id/email/routine", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  if (routines.forBot(bot.id).some((r) => r.trigger === "botmail")) fail(409, "This bot already has a routine for its emails.");
  const prompt = String(b.prompt ?? "").trim() || tr(c.get("user").locale, "Read the new email. If it needs an answer, draft a short reply and ask me before sending it.");
  const r = routines.create(bot.id, { name: String(b.name ?? "").trim().slice(0, 80) || tr(c.get("user").locale, "New email"), prompt: prompt.slice(0, 4000), trigger: "botmail" });
  emit(bot.userId, { type: "routines", botId: bot.id });
  return c.json({ routine: publicRoutine(r, c.get("user").locale) });
});

// ── Wave 6: server-mediated voice ────────────────────────────────────────────
/** What a call with this bot will use (the bot's owner's services): the server pipeline, or the browser's own speech. */
api.get("/voice", (c) => c.json({ status: voiceStatus(c.get("user").id), settings: voiceSettings(c.get("user").id) }));
api.get("/bots/:id/voice", (c) => { const a = accessBot(c, "talk"); return c.json({ status: voiceStatus(a.bot.userId, a.bot.id) }); });
api.put("/voice", async (c) => {
  const user = c.get("user");
  const settings = saveVoiceSettings(user.id, await body(c));
  audit(user.id, "account", "Voice settings changed");
  return c.json({ settings, status: voiceStatus(user.id) });
});
/** Checks the services: a short sentence is spoken, then transcribed back. */
api.post("/voice/test", async (c) => {
  const user = c.get("user");
  const tts = ttsFor(user.id);
  const stt = sttFor(user.id, user.locale);
  if (!tts || !stt) return c.json({ ok: false, error: tr(user.locale, "No speech service is configured.") });
  const t0 = Date.now();
  try {
    const wav = await tts(tr(user.locale, "Hello, this is a voice test."));
    const t1 = Date.now();
    const text = await stt(wav);
    return c.json({ ok: true, heard: text, ttsMs: t1 - t0, sttMs: Date.now() - t1, audioBytes: wav.length });
  } catch (err) {
    return c.json({ ok: false, error: clip((err as Error).message, 300) });
  }
});
// A voice per bot and the voice pickers (Fish Audio's library, Kokoro): voice/routes.ts.
registerVoiceRoutes(api);
// One-shot dictation for browsers without working speech recognition (iOS Safari, Firefox…): voice/transcribe.ts.
registerTranscribeRoute(api);
// « Écouter les réponses »: a reply read out in the bot's own voice (voice/speak.ts).
registerSpeakRoute(api);
