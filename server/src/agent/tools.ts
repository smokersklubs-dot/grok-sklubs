import { htmlToMarkdown, isMarkdown, MARKDOWN_ACCEPT, markdownExtras } from "./webfetchmd.js"; import { codeTools } from "./codebox.js"; // L75 web_fetch in Markdown, llms.txt ; L91 hidden code box
import { routeQuestion } from "./delegatedask.js";
import { unseal } from "../auth.js";
import { emit, getLive, setLive } from "../bus.js";
import { attachmentAt, botPathOf, browserAvailable, computerKind, isInlineImage, lastKnownUrl, readLibraryFile, readsTeamFolder, runShell, saveFile, screen, shellAvailable, storeBytes, teamEnabledFor, type Shot } from "../computer.js";
import { noteDiskTrouble } from "../disk.js";
import { imageTool, videoTools } from "./tools-media.js"; import { imageServiceFor } from "../mediakeys.js"; import { wan2gpTarget } from "../wan2gptarget.js";
import { connectors, slug } from "../connectors.js";
import { config } from "../config.js";
import { isValidTimezone, parseCron } from "../cron.js";
import { tr } from "../i18n.js";
import type { ImageBlock, TextBlock, ToolSpec } from "../llm/types.js";
import { describeRoutine, routines, type RoutineInput } from "../routines.js";
import { accounts as nativeAccounts } from "../native/accounts.js";
import { appOf } from "../native/vendors.js";
import { schedule, unschedule } from "../scheduler.js";
import { GEM_KINDS, GEMS_PER_DAY, REACTIONS, TAKEOVER_REASONS, type TakeoverReason, type ActivityKind, type Connector, type Gem, type GemKind, type ReactionEmoji, type Row, type ToolGroup, type SkillExtras, SKILL_EXTRA_KEYS } from "../shared.js";
import { q } from "../db.js";
import { searchConfigured, searchWeb } from "../search.js"; import { cleanDay, setMarks } from "./memorymarks.js"; import { roomMemoryTools } from "./roommemory.js";
import { fetchProblem, guardedFetch } from "../net.js";
import { config as appConfig } from "../config.js";
import { audit, bots, clip, memories, newId, pages, rows, settings, skills, skillText, tasks, vault, type BotRecord, type UserRecord } from "../store.js";
import { conversationSearchAnswer } from "../convsearch.js";
import { record as recordUsage } from "../usage.js";
import { meterOperatorUse, operatorBlock, toolRefusal, unitEstimate } from "../hosted.js";
import { interrupt, isPaused, tell } from "./loop.js";
import { pausedLine } from "./pause.js";
import { DRIVING, releaseControl, takeoverTimeoutMs, userDriving, waitForUser } from "../takeover.js";
import { pushLater } from "../push.js";
import { generatePassword, parseTotp, totpNow } from "../totp.js";
import { seal } from "../auth.js";
import { askAndWait, createRoom, deliverBotMessage, dispatchToRoom, MAX_HELPERS, MAX_HOPS, startHelper, waitsOn } from "./team.js";
import { addressesNoBot, BREAKER_LINE, dmChannel, postBudget, roomChannel, type Verdict } from "./roombudget.js";
import { myComputerTools } from "./mycomputer.js"; import { myUiTools } from "./myui.js"; import { liveDocTools } from "./livedoctools.js"; import { phoneTools } from "./phonetools.js"; import { remoteAgentTools } from "./remoteagenttools.js"; // wave 7: L164 L178 L177 L172 L174
import { botTools, profileTools, progressTools, skillImportTools, xSearchAvailable, xTools } from "./tools-team.js"; import { roomTools } from "./tools-room.js";
import { bgTasks, publicTask, startTask, stopTask } from "./bgtasks.js"; import { bgTaskToolSpecs, TaskLimitError } from "./bgtaskspecs.js";
import { findCode, mailAccounts } from "../native/access.js";
import { hideForAWhile } from "../store.js";
import { explicitRemember, memoryVerdict } from "./sensitive.js";
import { committingKind, probe, seenOf, seenTarget } from "./bind.js"; import { boundClick, browserDownloadTools, browserTabTools, shot, tabLine, typeSecret } from "./tools-browser.js";
import { elementTools, openInWords } from "./tools-elements.js"; import { noteShots, sameScreen } from "./screendedup.js"; import { traceClicks } from "./clicktrail.js"; // L65/L74/L75/L81: element tools, in words; L65 same screen skipped
import { cardLabel, cardTools } from "./payments.js";
import { guideIndex, guideTools } from "./guides.js";
import { anonymise } from "./anonymise.js"; import { evidenceFields, evidenceNote, proposalEvidence } from "../skillevidence.js";
import { apiTools, scrubSecret } from "../apiconnectors.js";
import { botMailTools } from "../botmail.js"; import { guardVault } from "../vaultaccess.js"; import { noteHost } from "../netjournal.js"; import { applyBrowserPolicy, netGate } from "../netpolicy.js"; import { offensiveRefusal } from "../offensive.js"; import { afterClick, hostBeforeClick } from "./clickhosts.js";
import { ruleTools } from "./ruletools.js";
import { botNote } from "../skillscan.js"; import { extractSeoTags, seoTagsReport } from "../seotags.js"; import { guideSearchTools } from "./guidesearch.js"; import { contactSheetTools } from "../contactsheet.js"; import { afterSave, saveRefusal, skillFeedbackTools, skillReadOutput, skillSectionParam } from "./skilltools.js";
import { pageTools } from "./pagetools.js";
import { pastReportsTool, researchTool } from "../researchroutes.js"; import { scholarTool } from "../researchscholar.js"; import { placeTools, withSiteNotes } from "./memoryplaces.js"; import { myComputerPlusTools } from "./mycomputerplus.js";
import { craftReady } from "./creative-tools.js"; import { craftCommandRefusal } from "./craft-run.js";
import { openmanWorkspace } from "./openman-tool.js";
import { meetingTranscribe } from "../meetings.js";
import { videoStudioTool, updateVideoStudio } from "../videostudio.js";
import { studioMp4Tool } from "../studiomp4.js";
import { videoWorkflowTool } from "../videoworkflows.js";
import { githubRead, githubSearch } from "../githubsearch.js";
import { reachAvailable, reachTools, youtubeBlockedGuide } from "../reach.js";
import { attemptsText, DEFAULT_MAX_COST_USD, paidConsents, paidGate, runChain, searchChainAvailable, searchProviders, servedLine, transcribeProviders } from "../providers.js";
import { cached, cachePolicy, idemKeyOf, release, remember, reserve, settle } from "../thirdparty.js";
import { commandEnded, commandStarted, provisionRelay, relayHint } from "../egress.js";
import { publicLinkTools } from "../publiclinks.js";
import { localTools } from "../localtools.js";
import { videoPriceEstimate, videoServices } from "../video.js";
import { writeComputerFile } from "../linux.js";
import { workspaceOf } from "../computer.js";
import { JobLimitError, jobLine, jobOutput, jobs, runCommand, stopJob } from "../jobs.js";
import { officeAvailable, officeTools } from "../office.js";
import { mediaAvailable, mediaTools } from "../media.js";
import { goalTools } from "./goals.js";
import { memoryPrefs } from "./memoryprefs.js"; import { searchNotesSmart } from "./semantic.js";
import { forgetNotes } from "./memorybook.js"; import { cleanInvisible, duplicateOf } from "./memorysave.js"; import { similar } from "./memory.js"; import { memoryKeep } from "./memorykeep.js"; import { recordable } from "./flowrecord.js"; // L66 ; L165 recorded flows
import { recruitTools } from "./recruit.js";
import { teamMdTools } from "./teamexport.js"; import { stepTools } from "./tools-steps.js"; import { waitTools } from "./waitlater.js"; import { offerUndo, undoText } from "./undoable.js"; import { planTools, questionCard, QUESTION_PROPS } from "./richquestion.js"; import { viewTools } from "./viewcard.js"; import { creationTools } from "./creations.js"; import { deleteCheckAnswer } from "./deletecheck.js"; // L97 wait_until, L98 « Annuler », L79, DS-Bot item 8 show_view
import { botPath, spillPath, spillPreview } from "./context.js"; import { routineFrameTools } from "./routineframe.js"; import { routineOptionTools } from "../routineoptions.js"; import { askRefusal, requestHelper, startQueuedHelpers } from "./askrules.js"; import { lt } from "./looptext.js";

export interface ToolContext {
  bot: BotRecord; user: UserRecord; depth: number; signal: AbortSignal;
  /** The turn has read outside content: what this tool hands to another bot carries that mark along. */
  tainted?: boolean;
  /** The thread the turn answers in (0 or absent: the main chat). */
  thread?: number;
  /** Exact addresses an app returned in this turn. */
  appUrls?: Set<string>;
  /** What started the turn ("user", "routine", "bot", "system", "nudge", "resume"): see Turn.origin. */
  origin?: string;
  /** Tool calls already run in this turn (a learned skill needs real multi-step work behind it). */
  toolsRun?: number;
  /** The turn itself, for the tools that work on its tool list (tool_search, run_steps: tools-steps.ts). */
  turn?: unknown;
}
export interface ToolOutput {
  content: string | Array<TextBlock | ImageBlock>;
  /** One short line shown next to the step in the chat. */
  summary?: string;
  isError?: boolean;
  /** Stop the turn once this batch of calls is finished. */
  endTurn?: boolean;
  /** This result is outside content even though the tool is not always (e.g. a learned skill from a tainted turn). */
  outside?: boolean;
}
export interface BuiltinTool {
  spec: ToolSpec;
  activity: ActivityKind;
  label: string;
  /** Sensitive tools ask first unless the bot is trusted with them. */
  sensitive?: boolean;
  /** Asks permission per call under its own key (English templates; {bot} and the vars are filled in). */
  gate?: (args: Record<string, any>, ctx: { botId: string; tainted: boolean }) => { key: string; title: string; reason: string; source: string; vars: Record<string, string>; /** Extra line on the card (English template). */ note?: string; /** Ask even when "Always" was chosen before. */ strict?: boolean; /** Do not offer "Always" on the card. */ once?: boolean } | null;
  /** Family this tool belongs to; a bot can have whole families switched off. */
  group?: ToolGroup;
  /** Its result comes from outside (a web page, a search): it is marked as such for the model, and the turn becomes more careful. */
  outside?: boolean;
  /** Worth a line in the account's activity log. */
  audited?: boolean;
  /**
   * Wave 6: writes to someone outside like an app's send does (the bot's own email). Asks like a built-in app write: a
   * card unless the user's words ground it, a trusted bot or an "always" choice — and after outside content, always,
   * unless the user's words in this conversation ask for exactly that (authorize.ts and its floor).
   */
  appWrite?: { title: string; reason: string; source: string };
  /**
   * Read-only and safe to run at the same time as other such calls (web reads, searches, memory, skills, job output…):
   * consecutive calls of these tools in one API step run side by side (loop.ts processCalls). Nothing that changes
   * anything, asks the user, or acts on the screen is ever marked.
   */
  parallel?: boolean;
  /** Extra detail for the live activity line. */
  detail?: (args: Record<string, any>) => string | undefined;
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolOutput>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool =>
  ({ spec: { name, description, inputSchema: schema }, ...rest });

const screenTools: BuiltinTool[] = [
  tool("screen_view", "Take a screenshot of your screen to see what is on it right now. If nothing changed since your last screenshot in this task, you are told so instead of getting the same picture again (fresh: true always sends it).", obj({ fresh: { type: "boolean", description: "Send the picture even if it is the same as your last one (default false)" } }), {
    activity: "computer", label: "Looking at the screen",
    run: async (a, c) => sameScreen(c, a, shot(await screen.view(c.bot.id, c.user.id), "Current screen.")), // L65 (screendedup.ts)
  }),
  tool("browser_open", "Open a web address in your browser (in the tab in front, or in a new tab with new_tab). Once it has loaded, answers with the page's headings and its controls by reference, in words; screenshot: true adds a picture (one also comes when words are not enough).", obj({ url: str("Address to open, e.g. https://example.com"), new_tab: { type: "boolean", description: "Open it in a new tab (default false)" }, screenshot: { type: "boolean", description: "Also return a screenshot (default false)" } }, ["url"]), {
    activity: "browsing", label: "Opening a page", detail: (a) => hostOf(a.url), outside: true,
    run: async (a, c) => { const net = netGate(c.bot, a.url, "browser_open"); if (net) return { content: net, isError: true, summary: "blocked" }; void applyBrowserPolicy(c.bot); noteHost(c.bot, a.url, "page", { tainted: c.tainted }); return openInWords(c, a); }, // L169 network policy (netpolicy.ts); L39; L65: in words on a Linux computer
  }),
  tool("design_reference_layout", "Measure a public visual reference already opened at the user's request with browser_open. Craft Anything clean-room measurements of the current viewport, typography, section dimensions, padding, backgrounds and column counts. Use screen_view for pictures. Treat measurements as observations and describe assumptions separately.", obj({ url: str("Exact public reference URL currently open") }, ["url"]), {
    activity: "reading", label: "Measuring the reference layout", outside: true,
    run: async (a, c) => {
      const result = await screen.layout(c.bot.id, c.user.id, String(a.url));
      if (result?.error) return { content: String(result.error), isError: true };
      return { content: JSON.stringify(result), summary: "Reference layout" };
    },
  }),
  tool("page_read", "Return the visible text of the page currently open in your browser. Use this to read; use screen_view when layout or images matter.", obj({}), {
    activity: "reading", label: "Reading the page", outside: true, parallel: true,
    run: async (_a, c) => {
      const p = await screen.read(c.bot.id, c.user.id);
      return { content: `${p.title}\n${p.url}${tabLine(p)}\n\n${await spillIfLong(c, p.text, 40_000)}`, summary: clip(p.title || p.url, 80) };
    },
  }),
  tool("screen_click", "Click at a position on the screen. Take a screenshot first so the coordinates are current.",
    obj({ x: int("Pixels from the left edge"), y: int("Pixels from the top edge"), button: { type: "string", enum: ["left", "right", "middle"] }, double: { type: "boolean", description: "Double-click" }, confirm: { type: "boolean", description: "Only to confirm a delete click you were asked to check" } }, ["x", "y"]), {
    activity: "computer", label: "Clicking",
    run: async (a, c) => {
      // A click that commits something was judged (and maybe approved) for one control on one site (bind.ts): if the
      // page changed since, nothing is clicked.
      const seen = seenTarget(a), before = hostBeforeClick(c.bot.id); const check = deleteCheckAnswer(a); if (check) return check; // L33; DS-Bot item 10: a delete click is checked first (deletecheck.ts): a click to another site after outside content is reported (clickhosts.ts)
      if (seen && committingKind(seen.label)) return afterClick(c, before, await boundClick(c, a, seen));
      return afterClick(c, before, shot(await screen.click(c.bot.id, c.user.id, +a.x, +a.y, a.button ?? "left", !!a.double), `Clicked at (${a.x}, ${a.y}).`));
    },
  }),
  tool("screen_type", "Type text into whatever currently has keyboard focus.", obj({ text: str("Text to type") }, ["text"]), {
    activity: "computer", label: "Typing",
    run: async (a, c) => shot(await screen.type(c.bot.id, c.user.id, String(a.text)), `Typed ${String(a.text).length} characters.`),
  }),
  tool("screen_key", "Press a key or a combination, e.g. Enter, Escape, Tab, PageDown, ctrl+a, ctrl+l.", obj({ keys: str("Key name, or several joined with +") }, ["keys"]), {
    activity: "computer", label: "Pressing keys",
    run: async (a, c) => shot(await screen.key(c.bot.id, c.user.id, String(a.keys)), `Pressed ${a.keys}.`),
  }),
  tool("screen_scroll", "Scroll the page at a position.", obj({ x: int("Pixels from the left"), y: int("Pixels from the top"), direction: { type: "string", enum: ["up", "down"] }, amount: int("Notches to scroll, default 3") }, ["x", "y", "direction"]), {
    activity: "computer", label: "Scrolling",
    run: async (a, c) => shot(await screen.scroll(c.bot.id, c.user.id, +a.x, +a.y, (a.direction === "up" ? -1 : 1) * 120 * Math.max(1, +(a.amount ?? 3))), `Scrolled ${a.direction}.`),
  }),
  tool("screen_drag", "Press the mouse at one point, move to another and release.", obj({ from_x: int("Start x"), from_y: int("Start y"), to_x: int("End x"), to_y: int("End y") }, ["from_x", "from_y", "to_x", "to_y"]), {
    activity: "computer", label: "Dragging",
    run: async (a, c) => shot(await screen.drag(c.bot.id, c.user.id, +a.from_x, +a.from_y, +a.to_x, +a.to_y), "Dragged."),
  }),
];

/** Screen actions (not looking) wait while the user drives the screen: the server refuses them, whatever the bot says. */
const ACTS_ON_SCREEN = new Set(["browser_open", "browser_back", "code_request", "screen_click", "screen_type", "screen_key", "screen_scroll", "screen_drag", "vault_type", "card_fill", "element_click", "element_type", "element_select", "element_fill", "element_hover", "element_upload", "browser_tab", "browser_dialog"]);
function respectDriver(t: BuiltinTool): BuiltinTool {
  if (!ACTS_ON_SCREEN.has(t.spec.name)) return t;
  return { ...t, run: async (a, c) => (userDriving(c.bot.id) ? { content: DRIVING, isError: true, summary: "the user is driving" } : t.run(a, c)) };
}

function hostOf(url: unknown): string | undefined {
  try { return new URL(/^[a-z]+:/i.test(String(url)) ? String(url) : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

/** A command that reads a tool result kept whole on the computer (it may be a web page or an app's answer). */
export const readsKeptOutput = (command: string) => /\.sklubot\/outputs/.test(command);

/**
 * A long tool result (over SPILL_CHARS) is kept whole on the bot's computer, ~/.sklubot/outputs/<id>.txt, when that
 * computer is on; the model gets its head and tail and where the rest is (context.ts spillPreview). Otherwise it is
 * shortened to `fallback` characters as before. Never wakes a computer for this.
 */
async function spillIfLong(c: ToolContext, text: string, fallback: number): Promise<string> {
  if (text.length <= appConfig.spillChars) return text;
  if (computerKind() === "linux" && screen.isOpen(c.bot.id)) {
    const path = spillPath();
    try {
      await writeComputerFile(c.bot.id, c.user.id, workspaceOf(c.bot.id), path, text, "600");
      return spillPreview(text, botPath(path));
    } catch (err) { console.error("[spill]", (err as Error).message); }
  }
  return clip(text, fallback);
}

const workTools: BuiltinTool[] = [
  tool("web_fetch", "Download a web page or text file and return it as Markdown (headings, links with their address, lists), or the site's own Markdown when it serves one. No browser needed. With tags: true, a web page's SEO tags (title, description, robots, canonical, hreflang, social, headings, JSON-LD, images without alt) come first. llms: true also reads the site's llms.txt (its index for AI); markdown_copy: true tries the page's own .md copy first (docs sites).", obj({ url: str("http(s) address"), tags: { type: "boolean", description: "Also list the page's SEO tags (for a page check or an SEO audit)" }, llms: { type: "boolean", description: "Also read the site's /llms.txt first (an index of the site written for AI), when it has one" }, markdown_copy: { type: "boolean", description: "Try the page's own Markdown copy (its address + .md) first" } }, ["url"]), {
    activity: "reading", label: "Reading a page", detail: (a) => hostOf(a.url), outside: true, parallel: true,
    run: async (a, c) => {
      const url = String(a.url);
      if (!/^https?:\/\//i.test(url)) return { content: "Only http and https addresses can be fetched.", isError: true }; const net = netGate(c.bot, url, "web_fetch"); if (net) return { content: net, isError: true, summary: "blocked" }; noteHost(c.bot, url, "fetch", { tainted: c.tainted }); // L169, L39
      // Public addresses only, every redirect checked: a page must not steer the bot into this server's own network.
      let res: Response; const get = (u: string, accept: string) => guardedFetch(u, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]), headers: { "user-agent": "Mozilla/5.0 (compatible; assistant)", accept }, redirect: "follow" });
      const extra = await markdownExtras(url, a, get); if (extra.copy) return { content: `Status 200 (the page's own Markdown copy: ${extra.copy.url})\n\n${extra.prefix}${await spillIfLong(c, extra.copy.text, 40_000)}`, summary: `200 · ${hostOf(url) ?? ""} · md` }; // L75 (webfetchmd.ts)
      try { res = await get(url, MARKDOWN_ACCEPT); }
      catch (err) { const why = fetchProblem(err); if (why) return { content: `Could not fetch ${url}: ${why}`, isError: true, summary: "not fetched" }; throw err; }
      const type = res.headers.get("content-type") ?? "";
      if (!/text|json|xml|javascript/.test(type)) return { content: `Fetched ${url} (status ${res.status}) but it is ${type || "binary"} content, not text.`, isError: !res.ok };
      const body = await res.text();
      const tags = a.tags === true && /html/.test(type) ? `${seoTagsReport(extractSeoTags(body, res.url || url))}\n\n` : ""; // L117 (seotags.ts)
      return { content: `Status ${res.status}${isMarkdown(type, res.url || url) ? " (the site served Markdown)" : ""}\n\n${extra.prefix}${tags}${await spillIfLong(c, /html/.test(type) ? htmlToMarkdown(body, res.url || url) : body, 40_000)}`, summary: `${res.status} · ${hostOf(url) ?? ""}`, isError: !res.ok };
    },
  }),
  tool("shell_run", "Run a shell command on your computer and return its exit code and output. A command still running at its time limit is not killed: it goes on as a background job (you get its id; check it with job_output, stop it with job_stop, and you get a message when it ends). For long work (builds, downloads, servers, long scripts) pass background: true to start it as a job straight away.",
    obj({ command: str("Command line to run with bash"), timeout_seconds: int("Wait at most this many seconds (default 120, max 290)"), background: { type: "boolean", description: "Start it as a background job and return at once (its output goes to a log file on your computer)" } }, ["command"]), {
    activity: "shell", label: "Running a command", sensitive: true, audited: true, detail: (a) => clip(String(a.command ?? ""), 60),
    run: async (a, c) => {
      const timeout = Math.min(290, Math.max(1, Number(a.timeout_seconds) || 120));
      const command = String(a.command); const craftRefused = craftCommandRefusal(command); if (craftRefused) return { content: craftRefused, isError: true, summary: "refused" }; const offensive = offensiveRefusal(c.bot.id, command); if (offensive) return { content: offensive, isError: true, summary: "refused" }; // L23: Craft Anything stays in clean-room mode; L38: no security test of a system that is not the owner's (offensive.ts)
      // Wave 7 (spec 08 A1): with the credential relay on, the computer gets the relay's address and its token (never a
      // key), and the relay knows whether this command's turn read outside content while it runs.
      if (c.bot.relayEnabled) await provisionRelay(c.bot).catch((err) => console.error("[relay]", (err as Error).message));
      // Wave 8: other bots write in the team folder — what a command may have read from it is outside content. So is a
      // tool result kept whole on the computer (~/.sklubot/outputs): it may hold a page or an app's answer.
      const outside = (teamEnabledFor(c.bot) && readsTeamFolder(command)) || readsKeptOutput(command);
      // On a Linux computer: as a job that can outlive its time limit (jobs.ts). On this server itself: as before.
      if (computerKind() === "linux") {
        commandStarted(c.bot.id, !!c.tainted);
        let r: Awaited<ReturnType<typeof runCommand>>;
        try { r = await runCommand(c.bot, workspaceOf(c.bot.id), command, timeout, { background: a.background === true, signal: c.signal, thread: c.thread, origin: c.origin, tainted: c.tainted }); }
        catch (err) { if (err instanceof JobLimitError) return { content: err.message, isError: true, summary: "too many jobs" }; throw err; }
        finally { commandEnded(c.bot.id); }
        noteDiskTrouble(c.bot, r.output);
        if (r.job && a.background === true) return { content: `Started as background job ${r.job.id}. Its output goes to ${r.job.log}. Check it with job_output (wait_seconds waits for it), stop it with job_stop; you will get a message when it ends.`, summary: tr(c.user.locale, "background job {id}", { id: r.job.id }), ...(outside ? { outside: true } : {}) };
        if (r.job) return { content: `Still running after ${timeout}s, so it goes on as background job ${r.job.id} (output: ${r.job.log}). Check it with job_output, stop it with job_stop; you will get a message when it ends.\nOutput so far (end):\n${r.output || "(no output yet)"}`, summary: tr(c.user.locale, "background job {id}", { id: r.job.id }), ...(outside ? { outside: true } : {}) };
        const hint = relayHint(c.bot, command, r.output);
        const body = r.spilled ? `${r.output}\n\n(The output was ${r.size} bytes; above is its end. Full output stored at: ${botPath(r.spilled)}. Read the parts you need with grep, sed -n or head.)` : r.output;
        return { content: `${r.timedOut ? `Timed out after ${timeout}s and was stopped.` : `Exit code ${r.code}.`}\n${body || "(no output)"}${hint}`, summary: r.timedOut ? "timed out" : `exit ${r.code}`, isError: r.timedOut || r.code !== 0, ...(outside ? { outside: true } : {}) };
      }
      if (a.background === true) return { content: "Background jobs need a Linux computer per bot, which this server does not give. Run the command without background, in shorter steps.", isError: true };
      commandStarted(c.bot.id, !!c.tainted);
      let r: Awaited<ReturnType<typeof runShell>>;
      try { r = await runShell(c.bot.id, c.user.id, command, timeout, c.signal); } finally { commandEnded(c.bot.id); }
      const hint = relayHint(c.bot, command, r.output);
      noteDiskTrouble(c.bot, r.output);
      return { content: `${r.timedOut ? `Timed out after ${timeout}s.` : `Exit code ${r.code}.`}\n${r.output || "(no output)"}${hint}`, summary: r.timedOut ? "timed out" : `exit ${r.code}`, isError: r.timedOut || r.code !== 0, ...(outside ? { outside: true } : {}) };
    },
  }),
  tool("file_save", "Save a text file into your library so the user can open or download it. Use for reports, notes, drafts, data.", obj({ filename: str("File name, optionally with folders, e.g. reports/weekly.md"), content: str("Full text content") }, ["filename", "content"]), {
    activity: "saving", label: "Saving a file", audited: true, detail: (a) => String(a.filename ?? ""),
    run: async (a, c) => {
      const saved = saveFile(c.bot.id, String(a.filename), String(a.content));
      return { content: `Saved as ${saved}.`, summary: saved };
    },
  }),
];

/** "https://www.Example.com/login" → "example.com". Empty when there is no usable host. */
function siteHost(site: string): string {
  const s = site.trim();
  if (!s) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

/** Library paths as the bot writes them ("~/files/x", "/root/files/x" or "x") → path inside the library. */
const libraryPath = (p: string) => p.trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "");

const shareTools: BuiltinTool[] = [
  tool("file_send", "Show a file from your library to the user in the chat. Pictures appear inline; other files as a download.", obj({ path: str("Path of the file in your library"), caption: str("A line to go with it") }, ["path"]), {
    activity: "saving", label: "Sending a file", detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      const att = attachmentAt(c.bot.id, libraryPath(String(a.path)));
      if (!att) return { content: `There is no file at ${a.path} in your library.`, isError: true };
      rows.append(c.bot, { kind: "message", role: "assistant", text: typeof a.caption === "string" ? a.caption : "", attachments: [att] });
      bots.bumpUnread(c.bot.id);
      return { content: "The user can see it in the chat now.", summary: att.name };
    },
  }),
];

export { higgsfieldFor, isHiggsfield, videoRoute } from "./tools-media.js"; // audit OGAI: the media tools live in tools-media.ts

/** Recent messages a bot may react to: in its own chat (or the thread it answers in), or in a group chat. */
function reactable(list: Row[], words: string, role: "user" | "any"): Row | null {
  const msgs = list.filter((r) => r.body.kind === "message" && !r.body.streaming && (role === "any" || r.body.role === "user"));
  const want = words.trim().toLowerCase();
  if (want) for (let i = msgs.length - 1; i >= 0; i--) { const b = msgs[i].body; if (b.kind === "message" && b.text.toLowerCase().includes(want)) return msgs[i]; }
  return msgs[msgs.length - 1] ?? null;
}

const reactTools: BuiltinTool[] = [
  tool("message_react", `Put a small reaction under a message instead of (or as well as) answering in words: ${REACTIONS.join(" ")}. By default it goes on the user's latest message here. Cheap and quiet: use it for acknowledgements.`,
    obj({
      emoji: { type: "string", enum: [...REACTIONS], description: "The reaction" },
      message: str("Optional: a few words quoted from the message to react to, when it is not the latest one"),
      room: str("Optional: the name of a group chat you belong to, to react to a message there"),
    }, ["emoji"]), {
    activity: "messaging", label: "Reacting",
    run: async (a, c) => {
      const emoji = String(a.emoji) as ReactionEmoji;
      if (!(REACTIONS as readonly string[]).includes(emoji)) return { content: `Use one of ${REACTIONS.join(" ")}.`, isError: true };
      let target: { id: string; userId: string; generation: number } = c.bot;
      let row: Row | null;
      if (typeof a.room === "string" && a.room.trim()) {
        const room = bots.byName(c.user.id, a.room);
        if (!room || room.kind !== "room" || !room.memberIds.includes(c.bot.id)) return { content: `You are not in a group chat called "${a.room}".`, isError: true };
        target = room;
        row = reactable(rows.list(room.id, room.generation, 40), String(a.message ?? ""), "any");
      } else {
        const bot = bots.byId(c.bot.id)!;
        target = bot;
        row = reactable(rows.list(bot.id, bot.generation, 40, undefined, c.thread ?? 0), String(a.message ?? ""), "user");
      }
      if (!row) return { content: "There is no message to react to.", isError: true };
      rows.react(target, target.generation, row.seq, { emoji, by: c.bot.id, name: c.bot.name }, true);
      return { content: "Reaction added.", summary: emoji };
    },
  }),
];

/** A vault item may only go to its own site: the host in front, or one of its subdomains. */
const sameSite = (here: string, wanted: string) => here === wanted || here.endsWith("." + wanted);
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/** Headers a bot may not set on a request that carries a secret (they would change where or how it goes). */
const FORBIDDEN_HEADERS = new Set(["host", "cookie", "content-length", "connection", "transfer-encoding", "proxy-authorization", "te", "upgrade", "keep-alive"]);
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

/**
 * Vault tools that do not need a screen. The model never sees a value: secrets are typed by the user into a card
 * (secret_request), used by the server inside one request (secret_use), and generated passwords go straight in.
 */
const vaultTools: BuiltinTool[] = guardVault([ // L41: per-item allowed bots, "ask every time", history (vaultaccess.ts)
  tool("vault_list", "List what the user saved in the vault for you: logins (name, site, username), secrets such as API keys (name and the hosts they may be sent to), two-factor code generators (name and site) and payment cards (name, network, last 4 digits). Values are never shown to you.", obj({}), {
    activity: "remembering", label: "Checking saved logins",
    run: async (_a, c) => {
      const items = vault.list(c.user.id);
      return {
        content: items.length ? JSON.stringify(items.map((i) => i.kind === "card"
          // A card: its name, network and last 4 digits only. Pay with card_fill.
          ? { kind: "card", name: i.name, label: cardLabel(i), note: i.note || undefined }
          : i.kind === "secret"
          ? { kind: "secret", name: i.name, hosts: i.hosts, saved: i.hasPassword, note: i.note || undefined }
          : i.kind === "totp" ? { kind: "totp", name: i.name, site: i.site, note: i.note || undefined }
          : { kind: "login", name: i.name, site: i.site, username: i.username, has_password: i.hasPassword, note: i.note || undefined })) : "Nothing is saved. Ask the user to add it in Settings → Vault, or use secret_request for an API key.",
        summary: `${items.length}`,
      };
    },
  }),
  tool("password_generate", "Create a strong random password and save it straight into the vault as a login, for example while signing up somewhere. You never see the password: you get the login's name back, and type it with vault_type.",
    obj({ name: str("Name for the new login, e.g. \"Supplier portal\""), site: str("The site it is for, e.g. portal.example.com"), username: str("The username or email used there"), length: int("Length, 12 to 64 (default 20)"), symbols: { type: "boolean", description: "Include symbols (default true)" }, digits: { type: "boolean", description: "Include digits (default true)" } }, ["name", "site"]), {
    activity: "saving", label: "Generating a password", audited: true, detail: (a) => String(a.name ?? ""),
    run: async (a, c) => {
      const name = clip(String(a.name).trim(), 80);
      const site = String(a.site ?? "").trim().slice(0, 300);
      if (!name) return { content: "Give the login a name.", isError: true };
      if (!siteHost(site)) return { content: "Say which site this password is for (e.g. portal.example.com).", isError: true };
      if (vault.byName(c.user.id, name)) return { content: `A vault item is already called "${name}". Pick another name; an existing password is never replaced this way.`, isError: true };
      const password = generatePassword({ length: Math.min(64, Math.max(12, Number(a.length) || 20)), symbols: a.symbols !== false, digits: a.digits !== false });
      vault.create(c.user.id, { kind: "login", name, site, username: String(a.username ?? "").trim().slice(0, 300), passwordEnc: seal(password), note: tr(c.user.locale, "Generated by {bot}", { bot: c.bot.name }) });
      audit(c.user.id, "vault", `${c.bot.name}: password generated for ${name}`, c.bot.id);
      emit(c.user.id, { type: "vault" });
      return { content: `Saved a new ${password.length}-character password in the vault as the login "${name}" (${siteHost(site)}). Type it with vault_type (item "${name}", field password) — you will never see it.`, summary: name };
    },
  }),
  tool("secret_request", "Ask the user for a secret you need, such as an API key or a token, by name. They type it into a secure card that goes straight to the server: you never see it, and it can only be sent to the host you name. This ends your turn; you are told when it is saved. Then call the API with secret_use.",
    obj({ name: str("Short name, e.g. \"Acme API key\""), reason: str("Why you need it, in one sentence"), host: str("The API host it will be sent to, e.g. api.acme.com"), header: str("The HTTP header it goes in (default Authorization)"), prefix: str("Text before the value in that header, e.g. \"Bearer \" (default for Authorization)") }, ["name", "reason", "host"]), {
    activity: "waiting", label: "Asking for a secret", detail: (a) => String(a.name ?? ""),
    run: async (a, c) => {
      const name = clip(String(a.name).trim(), 80);
      const host = siteHost(String(a.host ?? ""));
      if (!name || !host) return { content: "A secret request needs a name and the host it is for.", isError: true };
      const header = String(a.header ?? "").trim() || "Authorization";
      if (!HEADER_NAME.test(header) || FORBIDDEN_HEADERS.has(header.toLowerCase())) return { content: `"${header}" cannot be used as the header for a secret.`, isError: true };
      const prefix = typeof a.prefix === "string" ? a.prefix.slice(0, 40) : header.toLowerCase() === "authorization" ? "Bearer " : "";
      rows.append(c.bot, { kind: "card", card: { type: "secret", name, reason: clip(String(a.reason ?? ""), 300), host, header, prefix, status: "pending" } });
      bots.bumpUnread(c.bot.id);
      tell({ type: "waiting", bot: c.bot, text: tr(c.user.locale, "{bot} asks for a secret: {name}", { bot: c.bot.name, name }) });
      return { content: "A secure card is in front of the user. Stop here; you will be told when they saved it (or chose not to).", summary: name, endTurn: true };
    },
  }),
  tool("secret_use", "Call an HTTP API with one of the user's saved secrets. The server puts the secret into the request header it was saved with, and only sends it to the hosts it is bound to; you never see it. Returns the response's status and text.",
    obj({
      secret: str("Name of the saved secret"), url: str("Full https address on one of the secret's hosts"),
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Default GET" },
      headers: { type: "object", description: "Other headers to send, as name → value (not the secret's own header)", additionalProperties: { type: "string" } },
      body: str("Request body (for POST, PUT, PATCH)"),
    }, ["secret", "url"]), {
    activity: "connector", label: "Calling an API with a secret", audited: true, outside: true, detail: (a) => hostOf(a.url),
    // Each secret asks before its first use; once the turn has read outside content it asks every time, so a page
    // cannot quietly steer the bot into using it.
    gate: (a, ctx) => ({
      key: `secret: ${String(a.secret ?? "").trim()}`, strict: ctx.tainted,
      title: ctx.tainted ? "{bot} has read outside content. Allow it to use the secret {item} with {host}?" : "Allow {bot} to use the secret {item} with {host}?",
      reason: "use the secret {item}", source: "Vault", vars: { item: String(a.secret ?? ""), host: hostOf(a.url) ?? "—" },
      note: "The bot never sees the secret: the server adds it to this one request, and only to the hosts it is saved for.",
    }),
    run: async (a, c) => {
      const item = vault.byName(c.user.id, String(a.secret));
      if (!item || item.kind !== "secret") return { content: `No secret is called "${a.secret}". Use vault_list, or ask for it with secret_request.`, isError: true };
      const value = item.passwordEnc ? unseal(item.passwordEnc) : null;
      if (!value) return { content: "That secret has no value saved.", isError: true };
      let url: URL;
      try { url = new URL(String(a.url)); } catch { return { content: "That is not a full address.", isError: true }; }
      if (url.protocol !== "https:" && !(allowHttp() && url.protocol === "http:")) return { content: "Secrets are only sent over https.", isError: true };
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (!item.hosts.some((h) => sameSite(host, h))) return { content: `The secret "${item.name}" may only be sent to ${item.hosts.join(", ") || "(no host)"}, not ${host}. It was not sent.`, isError: true }; const net = netGate(c.bot, host, "secret_use"); if (net) return { content: net, isError: true, summary: "blocked" }; noteHost(c.bot, host, "secret", { tainted: c.tainted }); // L169, L39
      const headers = new Headers();
      if (a.headers && typeof a.headers === "object") for (const [k, v] of Object.entries(a.headers as Record<string, unknown>)) {
        if (typeof v !== "string" || !HEADER_NAME.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase()) || k.toLowerCase() === item.header.toLowerCase()) continue;
        headers.set(k, v.slice(0, 2000));
      }
      headers.set(item.header || "Authorization", `${item.prefix}${value}`);
      const method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(a.method)) ? String(a.method) : "GET";
      const body = method !== "GET" && typeof a.body === "string" ? a.body : undefined;
      if (body && body.length > 1_000_000) return { content: "That body is too large (1 MB at most).", isError: true };
      if (body && !headers.has("content-type")) headers.set("content-type", /^\s*[[{]/.test(body) ? "application/json" : "text/plain");
      let res: Response;
      // Redirects are not followed: the secret's header must not travel to another address.
      try { res = await guardedFetch(url.toString(), { method, headers, body, redirect: "manual", signal: AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]) }); }
      catch (err) { const why = fetchProblem(err); if (why) return { content: `Could not reach ${host}: ${why}`, isError: true, summary: "not reached" }; throw err; }
      const type = res.headers.get("content-type") ?? "";
      const where = res.headers.get("location");
      const text = /text|json|xml|javascript|html/.test(type) || !type ? await res.text() : `(${type} content, ${res.headers.get("content-length") ?? "?"} bytes, not shown)`;
      // An API that echoes the key back (an error page quoting the header, a "whoami" route…) must not hand it to the
      // bot: every form of the value is hidden, as for the API connectors and the credential relay.
      return { content: scrubSecret(`Status ${res.status}${where ? ` (redirect to ${where}, not followed)` : ""}\n\n${clip(text, 40_000)}`, value), summary: `${res.status} · ${host}`, isError: res.status >= 400 };
    },
  }),
]);

/** How email_code_type reads the page in front and types (replaceable in tests); how long it waits for the email. */
export const codeScreen = {
  pageUrl: async (botId: string, userId: string) => (await screen.read(botId, userId)).url,
  // Into the focused field of the active tab, only if that tab (and each frame down to the field) is on the code's site.
  type: async (botId: string, userId: string, text: string, host = "") => { const r = await typeSecret(botId, userId, text, host, "code"); if ("refused" in r) throw new Error(`The code was not typed: ${r.refused}.`); },
  waitMs: () => Number(process.env.CODE_WAIT_MS ?? 60_000),
  everyMs: () => Number(process.env.CODE_POLL_MS ?? 5_000),
};

/** Vault tools that work on the bot's screen: they check the page in front against the item's site. */
export const screenVaultTools: BuiltinTool[] = guardVault([ // L41: per-item allowed bots, "ask every time", history (vaultaccess.ts)
  tool("vault_type", "Type a saved username or password into the field that has keyboard focus on your screen. Click the field first. You never see the password; the user is asked before it is used.",
    obj({ item: str("Name of the saved login"), field: { type: "string", enum: ["username", "password"] } }, ["item", "field"]), {
    activity: "computer", label: "Typing a saved login", audited: true, detail: (a) => String(a.item ?? ""),
    // The site check below relies on the address the bot's computer reports for the page in front, and that
    // computer is the bot's own (it is root there): a misbehaving one could report a false address. The card
    // says so, and shows the address it last reported, so the user judges for themselves.
    gate: (a, ctx) => {
      const owner = bots.byId(ctx.botId)?.userId;
      const item = owner ? vault.byName(owner, String(a.item ?? "")) : null;
      return {
        key: `vault: ${String(a.item ?? "").trim()}`, title: "Allow {bot} to type the saved {field} for {item}?", reason: "type a saved login for {item}", source: "Vault",
        vars: { item: String(a.item ?? ""), field: a.field === "username" ? "username" : "password", site: item?.site || "—", page: lastKnownUrl(ctx.botId) || "—" },
        note: "Saved for: {site}. Page the bot's computer says is open: {page}. Sklubot checks the page against the saved site using what that computer reports, which it cannot fully verify: only allow it if you expected this login now.",
      };
    },
    run: async (a, c) => {
      const item = vault.byName(c.user.id, String(a.item));
      if (!item) return { content: `No saved login is called "${a.item}". Use vault_list to see the names.`, isError: true };
      const value = a.field === "username" ? item.username : item.passwordEnc ? unseal(item.passwordEnc) : null;
      if (!value) return { content: `That login has no ${a.field} saved.`, isError: true };
      // A saved login only goes into the site it was saved for: checked on the very tab, frame and field it goes into (tools-browser.ts).
      const wanted = siteHost(item.site);
      const r = wanted ? await typeSecret(c.bot.id, c.user.id, value, wanted, a.field === "username" ? "username" : "password") : { shot: await screen.type(c.bot.id, c.user.id, value) };
      if ("refused" in r) return { content: `This login is saved for ${item.site}, but it was not typed: ${r.refused}. Open ${item.site} and click its ${a.field} field first; do not try to enter it anywhere else.`, isError: true };
      return { ...shot(r.shot, `Typed the saved ${a.field} into the focused field.`), summary: `${item.name} · ${a.field}` };
    },
  }),
  tool("email_code_type", "When a site you are signing in to sends a verification code by email, this fetches it from the user's connected mailbox (Gmail or Outlook) and types it into the field that has keyboard focus on your screen. You never see the code. Click the code field first. It waits up to a minute for the email.",
    obj({ site: str("The site the code is for, e.g. example.com (the page in front must be on it)"), from: str("Part of the sender's address, if you know it (e.g. no-reply@example.com)"), mailbox: str("Which connected mailbox, if the user has several (e.g. 'Gmail — perso')") }, ["site"]), {
    activity: "computer", label: "Typing a code from the mailbox", audited: true, detail: (a) => String(a.site ?? ""),
    // No card in a normal turn (the site and sender checks are the guard); after outside content it asks every time.
    gate: (a, ctx) => ctx.tainted ? {
      key: `email code: ${siteHost(String(a.site ?? ""))}`, strict: true, title: "{bot} has read outside content. Allow it to fetch the sign-in code for {site} from your mailbox and type it?", reason: "type the sign-in code for {site}", source: "Vault",
      vars: { site: siteHost(String(a.site ?? "")) || "—", page: lastKnownUrl(ctx.botId) || "—" }, note: "Page the bot's computer says is open: {page}.",
    } : null,
    run: async (a, c) => {
      const wanted = siteHost(String(a.site ?? ""));
      if (!wanted) return { content: "Say which site the code is for (e.g. example.com).", isError: true };
      if (!mailAccounts(c.user.id, String(a.mailbox ?? "")).length) return { content: "No connected Gmail or Outlook mailbox can be used. Ask the user to connect one (Settings → Apps), or use ask_takeover so they type the code.", isError: true };
      const here = await codeScreen.pageUrl(c.bot.id, c.user.id).then(siteHost).catch(() => "");
      if (!here) return { content: `I could not tell which page is open, so no code was fetched. Open ${wanted} first.`, isError: true };
      if (!sameSite(here, wanted)) return { content: `The code is for ${wanted}, but the page in front is ${here}. No code was fetched. Do not try to use it anywhere else.`, isError: true };
      // Only emails that arrived after the turn started (with a small margin) count.
      const since = (getLive(c.bot.id).startedAt ?? Date.now()) - 2 * 60_000;
      let found;
      try { found = await findCode(c.user.id, { site: wanted, from: String(a.from ?? ""), account: String(a.mailbox ?? ""), since, waitMs: codeScreen.waitMs(), everyMs: codeScreen.everyMs(), signal: c.signal }); }
      catch (err) { return { content: (err as Error).message, isError: true }; }
      if (!found) return { content: `No email with a code from ${wanted} arrived in the last minute. Ask the site to send it again, or use ask_takeover so the user types it.`, isError: true };
      // From here on the code is hidden from anything a model sees (page text, tool output…).
      hideForAWhile(c.user.id, found.code);
      await codeScreen.type(c.bot.id, c.user.id, found.code, wanted);
      return { content: `Typed the code from the email "${found.subject}" (${found.from}, ${new Date(found.at).toISOString().slice(11, 16)} UTC, ${found.account}) into the focused field. The code itself is kept from you. Submit the form if the site needs it, then check the result.`, summary: `${wanted} · ${found.account}` };
    },
  }),
  tool("totp_code", "Get the current two-factor code from a code generator the user saved in the vault, to type into the login page of its own site. It only works while that site is open in your browser.",
    obj({ item: str("Name of the saved code generator") }, ["item"]), {
    activity: "computer", label: "Reading a two-factor code", audited: true, detail: (a) => String(a.item ?? ""),
    // No card in a normal turn (the site check below is the guard); after outside content it asks every time.
    gate: (a, ctx) => ctx.tainted ? {
      key: `totp: ${String(a.item ?? "").trim()}`, strict: true, title: "{bot} has read outside content. Allow it to read the two-factor code for {item}?", reason: "read the two-factor code for {item}", source: "Vault",
      vars: { item: String(a.item ?? ""), page: lastKnownUrl(ctx.botId) || "—" }, note: "Page the bot's computer says is open: {page}.",
    } : null,
    run: async (a, c) => {
      const item = vault.byName(c.user.id, String(a.item));
      if (!item || item.kind !== "totp") return { content: `No code generator is called "${a.item}". Use vault_list to see the names.`, isError: true };
      const seed = item.passwordEnc ? unseal(item.passwordEnc) : null;
      const wanted = siteHost(item.site);
      if (!seed || !wanted) return { content: "That code generator is incomplete (it needs its key and its site). Ask the user to fix it in Settings → Vault.", isError: true };
      const here = await screen.read(c.bot.id, c.user.id).then((p) => siteHost(p.url)).catch(() => "");
      if (!here) return { content: `I could not tell which page is open, so no code was given. Open ${item.site} first.`, isError: true };
      if (!sameSite(here, wanted)) return { content: `This code is for ${item.site}, but the page in front is ${here}. No code was given. Do not try to use it anywhere else.`, isError: true };
      let now: { code: string; remaining: number };
      try { now = totpNow({ ...parseTotp(seed), digits: item.digits === 8 ? 8 : 6, period: item.period }); } catch (err) { return { content: (err as Error).message, isError: true }; }
      return { content: `Current code for ${item.name}: ${now.code} (valid for ${now.remaining} more seconds). Type it into the code field now.`, summary: `${item.name} · ${now.remaining}s` };
    },
  }),
]);

const knowledgeTools: BuiltinTool[] = [
  tool("conversation_search", "Search what was said before — in this chat, in your earlier conversations (before a reset), or in every bot's chat. Use it instead of asking the user to repeat themselves.",
    obj({ query: str("Words to look for (any of them; accents do not matter)"), scope: { type: "string", enum: ["mine", "everyone"], description: "mine (default): your own chats, current and earlier. everyone: all the user's bots." }, since: str("Optional first day, YYYY-MM-DD"), until: str("Optional last day, YYYY-MM-DD"), around_seq: int("Optional: instead of searching, show the messages around this message number (#N from a result) in your current chat"), count: int("With around_seq: messages before and after (default 3, at most 10)") }, ["query"]), {
    activity: "remembering", label: "Searching conversations", group: "memory",
    run: async (a, c) => conversationSearchAnswer(c.user.id, c.bot.id, a), // L73: full-text index, date filter, « messages autour » (convsearch.ts)
  }),
  tool("skill_read", "Read the full steps of one of your skills, or of a skill a teammate shared. Your prompt lists skill names; read one before following it. A long skill gives its index first: then read the section you need.", obj({ name: str("Name of the skill"), ...skillSectionParam }, ["name"]), {
    activity: "remembering", label: "Reading a skill", group: "memory",
    run: async (a, c) => {
      const s = skills.find(c.bot.id, String(a.name));
      if (!s) return { content: `You have no skill called "${a.name}", and no teammate shared one by that name.`, isError: true };
      // Counted, long ones by index then section, outside content kept as such (skilltools.ts, L131-L132).
      return skillReadOutput(s, a.section, a.file);
    },
  }),
  tool("skill_save", "Save a way of doing something as a skill, so you do it the same way next time. Use it when the user says to remember how to do a task, or after working out a procedure worth keeping. Fill in, whenever you know them: what the task needs first (accounts, access, files), which steps need the user's approval (sending, paying, deleting, publishing, confirming a form…), how to check that it worked, and what to hand back at the end. Saving under an existing name replaces that skill (a part you leave out keeps its current text).",
    obj({
      name: str("Short name"), when: str("When to use it, in one line"), steps: str("The procedure, step by step"),
      needs: str("What it needs before starting: accounts, access, apps, files (e.g. \"the Gmail app signed in; the invoice PDF in ~/files\")"),
      approvals: str("Which steps need the user's approval before you do them (e.g. \"step 4: sending the email\")"),
      check: str("How to check the result worked (e.g. \"the order appears in My orders with status Paid\")"),
      output: str("What to hand back to the user at the end (e.g. \"the order number and the delivery date\")"),
      shared: { type: "boolean", description: "Share it with every bot of the user (they see it in their skill list)" },
    }, ["name", "steps"]), {
    activity: "remembering", label: "Learning a skill", group: "memory", audited: true,
    run: async (a, c) => {
      const name = clip(String(a.name).trim(), 80), body = String(a.steps).trim().slice(0, 20_000), when = clip(String(a.when ?? "").trim(), 300);
      if (!name || !body) return { content: "A skill needs a name and steps.", isError: true };
      const existing = skills.list(c.bot.id).find((k) => k.name.toLowerCase() === name.toLowerCase());
      const shared = typeof a.shared === "boolean" ? a.shared : undefined;
      // Only the parts the bot gave: one it leaves out keeps what the skill already says (the user may have written it).
      const extras: Partial<SkillExtras> = {};
      for (const k of SKILL_EXTRA_KEYS) if (typeof a[k] === "string") extras[k] = clip(a[k].trim(), 2000);
      const refused = saveRefusal(existing, body); if (refused) return { content: refused, isError: true, summary: name }; // locked, or too much lost (skilltools.ts)
      const saved = existing ? skills.update(existing.id, { name, description: when, body, shared, ...extras }) : skills.create(c.bot.id, name, when, body, !!shared, {}, extras);
      offerUndo(c.bot, { kind: "skill", ref: saved.id, before: existing ? { name: existing.name, description: existing.description, body: existing.body } : null, text: undoText.skill(c.bot, name, !existing), thread: c.thread }); // L98 « Annuler » (undoable.ts)
      emit(c.user.id, { type: "memories", botId: c.bot.id }); // A flagged text stays a draft the bot cannot use until its owner accepts it (skillscan.ts).
      return { content: `${existing ? "Skill updated." : "Skill saved."}${botNote(c.bot.id, name)}${afterSave(c.user.id, c.bot.id, name, !!existing)}`, summary: name };
    },
  }),
  tool("skill_propose", "After finishing a task that took several steps (or a workaround), offer to keep the procedure as a learned skill for next time: the steps on the site or app, the pitfalls, the final check. Names, addresses, contact details, order or account numbers, amounts and message contents are replaced by placeholders before the user sees it; the user reviews and edits it before it is saved. Do not use it when the user said not to remember this task.",
    obj({ name: str("Short name"), when: str("When to use it, in one line"), steps: str("The procedure, step by step, with pitfalls and the final check") }, ["name", "steps"]), {
    activity: "remembering", label: "Proposing a skill", group: "memory",
    run: async (a, c) => {
      if (!settings.memory(c.user.id).autoCapture) return { content: "The user switched learning off (Settings → Memory): do not propose skills.", isError: true, summary: "learning off" };
      if ((c.toolsRun ?? 0) < 3) return { content: "Only propose a skill after a task that really took several steps.", isError: true, summary: "too early" };
      const known = [c.user.name, settings.profile(c.user.id).name, ...bots.list(c.user.id).map((b) => b.name)].filter(Boolean);
      const name = clip(anonymise(String(a.name ?? "").trim(), known), 80);
      const steps = anonymise(String(a.steps ?? "").trim(), known).slice(0, 8000);
      const when = clip(anonymise(String(a.when ?? "").trim(), known), 300);
      if (!name || !steps) return { content: "A skill needs a name and steps.", isError: true };
      const evidence = proposalEvidence(c.user.id, name, when, known); // L131: the same task asked in other conversations (skillevidence.ts)
      rows.append(c.bot, { kind: "card", card: { type: "skill", name, when, steps, outside: !!c.tainted, status: "pending", ...evidenceFields(evidence) } });
      bots.bumpUnread(c.bot.id);
      return { content: `The user has the proposed skill in front of them (anonymised) and decides whether to keep it. Do not save it yourself.${evidenceNote(evidence)}`, summary: name };
    },
  }),
];

/** Options every provider-chain tool takes (spec 08 A3). */
const chainProps = {
  allow_paid: { type: "boolean", description: "Only after the free ways found nothing: allow a paid provider (the user is asked once for this bot, with the cost)" },
  max_cost_usd: { type: "number", description: "Most this call may cost, in USD (default 1)" },
  prefer: str("Optional: the provider to try first (its id)"),
  exclude: { type: "array", items: { type: "string" }, description: "Optional: provider ids to leave out" },
  fresh: { type: "boolean", description: "Force a real call instead of a recent cached answer" },
};
const chainOpts = (a: Record<string, any>) => ({ allowPaid: !!a.allow_paid, maxCostUsd: Number(a.max_cost_usd) > 0 ? Math.min(50, Number(a.max_cost_usd)) : DEFAULT_MAX_COST_USD, prefer: typeof a.prefer === "string" ? a.prefer : undefined, exclude: Array.isArray(a.exclude) ? a.exclude.map(String) : undefined });

const searchTools: BuiltinTool[] = [
  tool("search_web", "Search the web and get a list of results (title, address, excerpt). Sklubot tries the ways available in order — the user's own keys first, then free services, then paid ones only with the user's yes — and tells you which one answered. Open a result with web_fetch, reach_read or the browser to read it.", obj({ query: str("What to search for"), ...chainProps }, ["query"]), {
    activity: "searching", label: "Searching the web", group: "web", outside: true, detail: (a) => clip(String(a.query ?? ""), 60),
    gate: (a, ctx) => paidGate("web search", "a web search", searchProviders(), { query: String(a.query ?? "") }, ctx.botId, !!a.allow_paid),
    run: async (a, c) => {
      const query = String(a.query ?? "").trim();
      if (!query) return { content: "Say what to search for.", isError: true };
      const hit = a.fresh ? null : cached(c.user.id, "search_web", "chain", { query });
      if (hit) return { content: `${hit.note}\n${hit.response}`, summary: `${tr(c.user.locale, "cached")} · ${hit.age}` };
      const o = await runChain("web search", searchProviders(), { query }, { bot: c.bot, signal: c.signal }, chainOpts(a));
      const line = servedLine(c.user.locale, o);
      if (o.refusal) return { content: `${o.refusal}\n${attemptsText(o)}`, isError: true, summary: line };
      if (o.needsConsent) return { content: `The free ways found nothing. The next way is paid: ${o.needsConsent.label}${o.needsConsent.estimateUsd === null ? " (price not known in advance)" : ` (about ${o.needsConsent.estimateUsd.toFixed(2)} $)`}. Ask the user whether it is worth it, or call search_web again with allow_paid: true (they will be asked once for you).\n${attemptsText(o)}`, summary: line };
      if (!o.result) return { content: o.attempts.some((x) => x.outcome !== "skipped") ? `Nothing found.\n${attemptsText(o)}` : "No web search is set up for you: the user (or the server's admin) can add a Brave key in the vault (bound to api.search.brave.com), set up SearXNG, or switch on Agent Reach (your tools).", isError: !o.attempts.some((x) => x.outcome === "empty"), summary: line };
      const text = o.result.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${clip(r.snippet, 300)}`).join("\n");
      remember(c.user.id, "search_web", "chain", { query }, text, cachePolicy(c.user.id, "search_web", o.attempts.find((x) => x.outcome === "served")?.provider === "Treg" ? "treg" : undefined));
      return { content: `${text}\n\n${attemptsText(o)}`, summary: `${o.result.length} · ${line}` };
    },
  }),
];

/** Transcription of a video or podcast address (spec 08 A3): subtitles first (free), then the user's own Whisper, then paid. */
const transcribeTools: BuiltinTool[] = [
  tool("transcribe", "Get the transcript of a video (YouTube and other video sites) as text. Sklubot tries the subtitles first (free), then the user's own speech-to-text service, then a paid one only with the user's yes, and tells you which one answered.", obj({ url: str("Address of the video"), lang: str("Preferred languages, e.g. fr,en"), ...chainProps }, ["url"]), {
    activity: "reading", label: "Transcribing a video", group: "web", outside: true, detail: (a) => hostOf(a.url),
    gate: (a, ctx) => paidGate("transcription", "a transcription", transcribeProviders(), { url: String(a.url ?? "") }, ctx.botId, !!a.allow_paid),
    run: async (a, c) => {
      const url = String(a.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return { content: "Give the video's full http(s) address.", isError: true };
      const args = { url, lang: typeof a.lang === "string" ? a.lang.slice(0, 40) : undefined };
      const hit = a.fresh ? null : cached(c.user.id, "transcribe", "chain", args);
      if (hit) return { content: `${hit.note}\n${hit.response}`, summary: `${tr(c.user.locale, "cached")} · ${hit.age}` };
      const o = await runChain("transcription", transcribeProviders(), args, { bot: c.bot, signal: c.signal }, chainOpts(a));
      const line = servedLine(c.user.locale, o);
      if (o.refusal) return { content: `${o.refusal}\n${attemptsText(o)}`, isError: true, summary: line };
      if (o.needsConsent) return { content: `The free ways did not work. The next way is paid: ${o.needsConsent.label} (price not known in advance). Ask the user, or call transcribe again with allow_paid: true.\n${attemptsText(o)}`, summary: line };
      if (!o.result) {
        const blocked = o.attempts.some((x) => /blocks this server|confirm you|not a bot/i.test(x.detail));
        // Blocked: the ordered way round (the bot's own browser, the owner's computer, the sound, then one card) — reach.ts.
        return { content: `No transcript.${blocked ? ` ${youtubeBlockedGuide(c)}` : ""}\n${attemptsText(o)}`, isError: true, summary: blocked ? tr(c.user.locale, "YouTube blocks this server") : line };
      }
      const text = clip(o.result, 60_000);
      remember(c.user.id, "transcribe", "chain", args, text, cachePolicy(c.user.id, "transcribe"));
      return { content: `${text}\n\n${attemptsText(o)}`, summary: line };
    },
  }),
];

const memoryTools: BuiltinTool[] = [
  tool("memory_save", "Remember a lasting fact or preference. Write one short, self-contained sentence.", obj({ text: str("The fact to remember"), until: str("Optional: the last day it holds, YYYY-MM-DD, when the user says it is only until a date") }, ["text"]), {
    activity: "remembering", label: "Saving a note",
    run: async (a, c) => {
      const text = clip(cleanInvisible(String(a.text)), 500); // L67 invisible characters removed (memorysave.ts)
      if (!text) return { content: "Nothing to remember.", isError: true };
      // Sensitive topics (health, religion, politics…) and anything that looks like a secret are not kept, unless the user
      // turned that topic on or explicitly asked, in their own last message, to remember (sensitive.ts).
      const asked = explicitRemember(c.bot, c.thread ?? 0), v = memoryVerdict(c.user.id, text, asked);
      if (!v.ok) return { content: v.reason, isError: true, summary: "not kept" };
      if (!asked && memoryPrefs.noLearn(c.bot.id)) return { content: "Not kept: the user switched on « Ne rien retenir » for you. Only what they explicitly ask you to remember is kept.", isError: true, summary: "not kept" }; // L88
      if (asked) memoryKeep.unbury(c.bot.id, text); else if (memoryKeep.buried(c.bot.id, text)) return { content: "Not kept: the user removed this from your memory before. It is kept again only if they ask you to remember it, in their own words.", isError: true, summary: "not kept" }; // L66 (memorykeep.ts)
      const dup = duplicateOf(c.bot.id, text, similar); if (dup) return { content: `Already remembered, nothing added: "${dup.text}" (note of ${new Date(dup.createdAt).toISOString().slice(0, 10)}). To change it, the user edits it in Settings → Memory.`, summary: "already known" }; // L67
      const note = memories.add(c.bot.id, text, "chat", { category: v.category }); const until = cleanDay(a.until); if (until) setMarks(c.user.id, note, { until }, "bot"); // audit DS-Bot #82
      emit(c.user.id, { type: "memories", botId: c.bot.id });
      return { content: "Remembered.", summary: clip(text, 80) };
    },
  }),
  tool("memory_forget", "Forget notes, only when the user asks you to in their own message (\"oublie que…\", \"forget that…\"): the closest notes to the words you give are set aside (archived; the user sees it and can bring them back in Settings → Memory). Never to tidy up on your own.", obj({ query: str("Words of the note to forget") }, ["query"]), {
    activity: "remembering", label: "Forgetting a note",
    run: async (a, c) => forgetNotes(c.bot, c.user, String(a.query ?? ""), { origin: c.origin, thread: c.thread }),
  }),
  tool("memory_search", "Search everything you have remembered, by keywords (French or English; no synonyms). Returns the best matches first.", obj({ query: str("Words to look for") }, ["query"]), {
    activity: "remembering", label: "Checking notes",
    run: async (a, c) => {
      // Ranked by keywords, recency and confidence (recall.ts); archived notes are never returned.
      const found = await searchNotesSmart(c.bot, String(a.query ?? "")); // L71: fused with meaning when the owner switched it on (semantic.ts)
      memories.touch(found.ids);
      return { content: found.content || "No matching memories.", summary: `${found.count} found` };
    },
  }),
];

function announceRoutine(c: ToolContext, text: string) {
  rows.append(c.bot, { kind: "event", event: "routine", text });
  emit(c.user.id, { type: "routines", botId: c.bot.id });
}

function checkSchedule(scheduleExpr: string, tz: string): string | null {
  try { parseCron(scheduleExpr); } catch (e) { return `Invalid schedule: ${(e as Error).message}.`; }
  return isValidTimezone(tz) ? null : `Unknown timezone "${tz}". Use an IANA name such as Europe/Paris.`;
}

const routineTools: BuiltinTool[] = [
  tool("routine_create",
    "Create a routine: an instruction you will carry out later without being asked. Kinds — 'cron' repeats on a schedule (use it for 'every N minutes' too), 'once' runs a single time, 'webhook' runs whenever an outside system calls its web address, 'watch' runs only when a web page or a file changes (checking costs nothing while nothing changes). With a built-in app account: 'email' runs once per new email matching `query`, 'slack' once per new Slack message in `channel` (or '@dm' for direct messages; mentions_only for mentions of the app), 'calendar' a few minutes (`lead_minutes`) before each event.",
    obj({
      name: str("Short name"), prompt: str("What to do on each run, written as a complete instruction to yourself"),
      kind: { type: "string", enum: ["cron", "once", "webhook", "watch", "email", "slack", "calendar"] },
      account: str("For email, slack and calendar: the account's exact name, e.g. \"Gmail — perso\""),
      query: str("For email: which emails (Gmail search syntax; for Outlook words, from: and subject:). Empty: every new email in the inbox"),
      channel: str("For slack: #channel or channel id, or @dm"),
      mentions_only: { type: "boolean", description: "For slack: only messages that mention the app" },
      lead_minutes: int("For calendar: minutes before the event (1 to 1440, default 10)"),
      watch_url: str("For watch: a web address to check regularly; the routine runs when its content changes"),
      watch_file: str("For watch: instead of a web address, a file in your library to check"),
      every_minutes: int("For watch: minutes between checks (5 to 1440, default 30). For email, slack and calendar: 2 to 1440, default 5"),
      schedule: str("For cron: five fields — minute hour day-of-month month day-of-week, e.g. '0 9 * * 1-5'"),
      only_if_new: { type: "array", items: { type: "string" }, description: "For cron routines that wait for something new (a reply, a new email, a page change): the mail accounts (exact names) or web addresses to check first. When nothing changed since the last run, the run is skipped without calling the model. Not for reminders or summaries, which must run every time." },
      run_at: str("For once: ISO 8601 date and time with offset, e.g. 2030-01-31T09:00:00+01:00"),
      timezone: str("IANA timezone for cron schedules, e.g. Europe/Paris. Ask the user if you do not know it."),
    }, ["name", "prompt", "kind"]), {
    activity: "planning", label: "Setting up a routine", audited: true,
    run: async (a, c) => {
      // A routine cannot create routines (spec 07 A7): only work the user started can set one up.
      if (c.origin === "routine") return { content: "A routine cannot create other routines. Tell the user what you would set up, and let them ask for it.", isError: true };
      const kind = a.kind as "cron" | "once" | "webhook" | "watch" | "email" | "slack" | "calendar";
      if (kind === "email" || kind === "slack" || kind === "calendar") {
        const all = nativeAccounts.list(c.user.id);
        const acc = all.find((x) => x.name.toLowerCase() === String(a.account ?? "").trim().toLowerCase());
        const fits = all.filter((x) => appOf(x.app)?.triggers.includes(kind)).map((x) => x.name);
        if (!acc || !appOf(acc.app)!.triggers.includes(kind)) return { content: `Name the account exactly: one of ${fits.join(", ") || "(none connected — ask the user to connect one in Settings → Apps)"}.`, isError: true };
        if (kind === "slack" && !String(a.channel ?? "").trim()) return { content: "A slack routine needs channel (#name, id or @dm).", isError: true };
        const r = routines.create(c.bot.id, { name: String(a.name), prompt: String(a.prompt), trigger: kind, native: { accountId: acc.id, query: String(a.query ?? "").trim(), channel: String(a.channel ?? "").trim(), mentionsOnly: !!a.mentions_only, leadMin: Math.min(1440, Math.max(1, Number(a.lead_minutes) || 10)), everyMin: Math.min(1440, Math.max(2, Number(a.every_minutes) || 5)) } });
        schedule(r.id);
        announceRoutine(c, tr(c.user.locale, "Routine created: {name} — {when}", { name: r.name, when: describeRoutine(r, c.user.locale) }));
        return { content: JSON.stringify({ id: r.id, when: describeRoutine(r) }), summary: r.name };
      }
      let watch: { kind: string; target: string; everyMin: number } | undefined;
      const tz = a.timezone ? String(a.timezone) : "UTC";
      let runAt: number | null = null;
      if (kind === "cron") {
        const problem = checkSchedule(String(a.schedule ?? ""), tz);
        if (problem) return { content: problem, isError: true };
      } else if (kind === "once") {
        runAt = Date.parse(String(a.run_at ?? ""));
        if (!Number.isFinite(runAt) || runAt <= Date.now()) return { content: "run_at must be a valid date and time in the future.", isError: true };
      } else if (kind === "watch") {
        const everyMin = Math.min(1440, Math.max(5, Number(a.every_minutes) || 30));
        if (a.watch_url) {
          if (!/^https?:\/\//i.test(String(a.watch_url))) return { content: "watch_url must be an http(s) address.", isError: true };
          watch = { kind: "url", target: String(a.watch_url), everyMin };
        } else if (a.watch_file) watch = { kind: "file", target: libraryPath(String(a.watch_file)), everyMin };
        else return { content: "A watch needs watch_url or watch_file.", isError: true };
      } else if (kind !== "webhook") return { content: "kind must be cron, once, webhook or watch.", isError: true };
      // "Only when something is new": the mail accounts or web addresses the routine waits for (cron routines only).
      const inputs: RoutineInput[] = [];
      if (kind === "cron" && Array.isArray(a.only_if_new)) {
        const all = nativeAccounts.list(c.user.id);
        for (const ref of a.only_if_new.map(String).slice(0, 5)) {
          if (/^https?:\/\//i.test(ref)) { inputs.push({ kind: "url", url: ref.trim() }); continue; }
          const acc = all.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
          if (!acc || (acc.app !== "gmail" && acc.app !== "outlook")) return { content: `only_if_new takes mail accounts (${all.filter((x) => x.app === "gmail" || x.app === "outlook").map((x) => x.name).join(", ") || "none connected"}) or http(s) addresses; "${ref}" is neither.`, isError: true };
          inputs.push({ kind: "account", accountId: acc.id });
        }
      }
      // No duplicates: an identical routine already set up is kept instead of a copy.
      const twin = routines.twin(c.bot.id, { prompt: String(a.prompt), trigger: kind, schedule: kind === "cron" ? String(a.schedule) : "", timezone: tz, runAt, watchTarget: watch?.target });
      if (twin) return { content: JSON.stringify({ id: twin.id, note: "An identical routine already exists; it was kept and no copy was made." }), summary: twin.name };
      const r = routines.create(c.bot.id, { name: String(a.name), prompt: String(a.prompt), trigger: kind, schedule: kind === "cron" ? String(a.schedule) : "", timezone: tz, runAt, watch, inputs });
      schedule(r.id);
      const cost = r.projectedMonthlyUsd ? tr(c.user.locale, " · about {usd} $ a month", { usd: r.projectedMonthlyUsd.toFixed(2) }) : "";
      announceRoutine(c, tr(c.user.locale, "Routine created: {name} — {when}", { name: r.name, when: describeRoutine(r, c.user.locale) }) + (r.skipUnchanged ? tr(c.user.locale, " (skipped when nothing is new)") : "") + cost);
      return { content: JSON.stringify({ id: r.id, when: describeRoutine(r), webhook_url: r.hookUrl ?? undefined, projected_monthly_usd: r.projectedMonthlyUsd ?? undefined, skips_when_unchanged: r.skipUnchanged || undefined }), summary: r.name };
    },
  }),
  tool("routine_list", "List your routines with their ids, schedules and state.", obj({}), {
    activity: "planning", label: "Checking routines",
    run: async (_a, c) => {
      const list = routines.forBot(c.bot.id);
      return { content: list.length ? JSON.stringify(list.map((r) => ({ id: r.id, name: r.name, when: describeRoutine(r), enabled: r.enabled, prompt: r.prompt, webhook_url: r.hookUrl ?? undefined }))) : "You have no routines.", summary: `${list.length} routines` };
    },
  }),
  tool("routine_update", "Change one of your routines. Only the fields you pass are changed.",
    obj({ id: str("Routine id"), name: str("New name"), prompt: str("New instruction"), schedule: str("New five-field schedule"), timezone: str("New IANA timezone"), enabled: { type: "boolean", description: "Pause (false) or resume (true)" } }, ["id"]), {
    activity: "planning", label: "Updating a routine",
    run: async (a, c) => {
      const cur = routines.byId(String(a.id));
      if (!cur || cur.botId !== c.bot.id) return { content: "No routine of yours has that id.", isError: true };
      if (cur.trigger === "cron") {
        const problem = checkSchedule(a.schedule ?? cur.schedule, a.timezone ?? cur.timezone);
        if (problem) return { content: problem, isError: true };
      }
      const r = routines.update(cur.id, { name: a.name, prompt: a.prompt, schedule: cur.trigger === "cron" ? a.schedule : undefined, timezone: a.timezone, enabled: typeof a.enabled === "boolean" ? a.enabled : undefined })!;
      schedule(r.id); offerUndo(c.bot, { kind: "routine", ref: r.id, before: { name: cur.name, prompt: cur.prompt, schedule: cur.schedule, timezone: cur.timezone, enabled: cur.enabled }, text: undoText.routine(c.bot, r.name, cur.enabled && !r.enabled), thread: c.thread }); // L98
      announceRoutine(c, tr(c.user.locale, "Routine updated: {name} — {when}", { name: r.name, when: r.enabled ? describeRoutine(r, c.user.locale) : tr(c.user.locale, "paused") }));
      return { content: "Updated.", summary: r.name };
    },
  }),
  tool("routine_delete", "Delete one of your routines for good.", obj({ id: str("Routine id") }, ["id"]), {
    activity: "planning", label: "Removing a routine", audited: true,
    run: async (a, c) => {
      const cur = routines.byId(String(a.id));
      if (!cur || cur.botId !== c.bot.id) return { content: "No routine of yours has that id.", isError: true };
      unschedule(cur.id);
      routines.remove(cur.id);
      emit(c.user.id, { type: "routines", botId: c.bot.id });
      return { content: "Deleted.", summary: cur.name };
    },
  }),
  tool("checkins_set", "Turn proactive check-ins on or off and set their times. Only the user's main bot performs check-ins. Ask for the timezone if you do not know it.",
    obj({ enabled: { type: "boolean" }, times: { type: "array", items: { type: "string" }, description: "Local times as HH:MM, 24-hour, at most 6" }, timezone: str("IANA timezone") }, ["enabled"]), {
    activity: "planning", label: "Adjusting check-ins",
    run: async (a, c) => {
      const cur = settings.checkins(c.user.id);
      if (a.timezone && !isValidTimezone(String(a.timezone))) return { content: `Unknown timezone "${a.timezone}".`, isError: true };
      const times = Array.isArray(a.times) ? a.times.filter((t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6) : cur.times;
      const next = { ...cur, enabled: !!a.enabled, times: times.length ? times : cur.times, timezone: a.timezone ? String(a.timezone) : cur.timezone };
      settings.saveCheckins(c.user.id, next);
      const text = next.enabled ? `Check-ins at ${next.times.join(", ")} (${next.timezone})` : "Check-ins off";
      return { content: text, summary: text };
    },
  }),
];

const taskTools: BuiltinTool[] = [
  tool("task_add", "Start tracking a piece of work so the user can follow it. Returns the task id.", obj({ title: str("What is being done") }, ["title"]), {
    activity: "planning", label: "Tracking a task",
    run: async (a, c) => {
      const t = tasks.create(c.bot.id, String(a.title));
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      return { content: JSON.stringify({ id: t.id }), summary: t.title };
    },
  }),
  tool("task_update", "Update a tracked task: still working, waiting on the user, or done.",
    obj({ id: str("Task id"), state: { type: "string", enum: ["working", "needs_input", "done"] }, note: str("One line on where it stands") }, ["id", "state"]), {
    activity: "planning", label: "Updating a task",
    run: async (a, c) => {
      if (!["working", "needs_input", "done"].includes(a.state)) return { content: "state must be working, needs_input or done.", isError: true };
      const t = tasks.update(c.bot.id, String(a.id), a.state, typeof a.note === "string" ? clip(a.note, 500) : undefined);
      if (!t) return { content: "No task of yours has that id.", isError: true };
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      return { content: "Updated.", summary: `${t.title} → ${t.state.replace("_", " ")}` };
    },
  }),
];

const bgTaskTools: BuiltinTool[] = [
  tool(bgTaskToolSpecs.start.name, bgTaskToolSpecs.start.description, bgTaskToolSpecs.start.inputSchema, {
    activity: "planning", label: "Starting a background task", audited: true, detail: (a) => String(a.title ?? ""),
    run: async (a, c) => {
      if (!String(a.goal ?? "").trim()) return { content: "Describe the goal of the task.", isError: true };
      try {
        const t = startTask(c.bot, String(a.title ?? ""), String(a.goal), c.depth, c.tainted, a.level); // L69 « modèle par tâche » (modelmodes.ts)
        return { content: JSON.stringify({ id: t.id, note: "Started. The user follows it on its card; its report will reach you when it is done. Tell the user in one line that you started it, then carry on." }), summary: t.title };
      } catch (err) { return { content: (err as Error).message, isError: true }; }
    },
  }),
  tool(bgTaskToolSpecs.list.name, bgTaskToolSpecs.list.description, bgTaskToolSpecs.list.inputSchema, {
    activity: "planning", label: "Checking background tasks",
    run: async (_a, c) => {
      const list = bgTasks.forBot(c.bot.id).slice(0, 20).map((t) => ({ ...publicTask(t), result: clip(t.result, 300) }));
      return { content: list.length ? JSON.stringify(list) : "You have no background tasks.", summary: `${list.length}` };
    },
  }),
  tool(bgTaskToolSpecs.stop.name, bgTaskToolSpecs.stop.description, bgTaskToolSpecs.stop.inputSchema, {
    activity: "planning", label: "Stopping a background task",
    run: async (a, c) => {
      const t = bgTasks.byId(String(a.id));
      if (!t || t.botId !== c.bot.id) return { content: "No background task of yours has that id.", isError: true };
      await stopTask(t);
      return { content: "Stopped.", summary: t.title };
    },
  }),
];
void TaskLimitError;

/**
 * A post refused by the anti-loop limits (roombudget.ts): nothing is sent, the bot is told why and not to retry, and its
 * turn ends so it cannot route around it. When the refusal opens a breaker, `where` (the room, or the sender's own chat
 * for bot_message) gets one line saying the bots are stopped until the user writes.
 */
function loopRefusal(v: Extract<Verdict, { allow: false }>, where: BotRecord, c: ToolContext): ToolOutput {
  if (v.opened) {
    rows.append(where, { kind: "notice", tone: "warn", text: tr(c.user.locale, BREAKER_LINE) });
    audit(c.user.id, "system", `Anti-loop breaker opened in ${where.name} (${v.rule})`, where.id);
  }
  return { content: v.reason, isError: true, endTurn: true, summary: tr(c.user.locale, "stopped: possible loop") };
}

const teamTools: BuiltinTool[] = [
  tool("bot_message", `Send a message to another bot on the team. Their answer arrives later as a message to you — or, with wait: true, you wait for it (up to wait_seconds, default ${config.botWaitDefaultSec}, at most ${config.botWaitMaxSec}) and get it right here, in this turn. Wait only when you need the answer to go on; if it takes longer, it still arrives later as a message.`,
    obj({ bot: str("The bot's name"), message: str("What you need, with all the context they need"), wait: { type: "boolean", description: "Wait for their answer and get it as this tool's result" }, wait_seconds: int(`How long to wait at most, in seconds (default ${config.botWaitDefaultSec}, at most ${config.botWaitMaxSec})`) }, ["bot", "message"]), {
    activity: "messaging", label: "Messaging a teammate", audited: true, detail: (a) => String(a.bot ?? ""),
    run: async (a, c) => {
      const target = bots.byName(c.user.id, String(a.bot));
      const names = bots.list(c.user.id).filter((b) => b.kind === "agent" && b.id !== c.bot.id).map((b) => b.name);
      if (!target) return { content: `No bot is called "${a.bot}". The team: ${names.join(", ") || "nobody else yet"}.`, isError: true };
      if (target.id === c.bot.id) return { content: "That is you.", isError: true };
      if (target.kind === "room") return { content: "That is a group chat; use room_post.", isError: true };
      const notMine = askRefusal(c.bot, target); if (notMine) return { content: notMine, isError: true, summary: tr(c.user.locale, "not allowed") }; // L96 who may ask whom (askrules.ts)
      // "Pause": nothing is sent to a paused bot; the sender is told, and not to route around it.
      if (isPaused(target)) return { content: pausedLine(target), isError: true, summary: tr(c.user.locale, "{bot} is paused", { bot: target.name }) };
      if (c.depth >= MAX_HOPS) return { content: "This exchange has bounced between bots too many times. Wrap up and report to the user instead.", isError: true };
      // Anti-loop limits (roombudget.ts). A turn the user started by writing counts as a human in between.
      const channel = dmChannel(c.bot.id, target.id);
      if (c.origin === "user") postBudget.human(c.user.id, channel);
      const verdict = postBudget.attempt(c.user.id, { channel, botId: c.bot.id, text: String(a.message), now: Date.now() });
      if (!verdict.allow) return loopRefusal(verdict, c.bot, c);
      if (a.wait !== true) {
        deliverBotMessage(c.bot, target, String(a.message), c.depth, c.tainted, true); // a request: its own thread (lanes.ts)
        return { content: `Delivered to ${target.name}. Their reply will reach you as a new message.`, summary: `to ${target.name}` };
      }
      // Waiting on a bot that waits (directly or through others) for you would never end: refused, nothing is sent.
      if (waitsOn(target.id, c.bot.id)) return { content: `${target.name} is itself waiting for your answer right now. Do not wait on it: finish your turn — your final message goes back to it — or send without wait.`, isError: true, summary: "would wait forever" };
      const seconds = Math.min(config.botWaitMaxSec, Math.max(1, Math.round(Number(a.wait_seconds) || config.botWaitDefaultSec)));
      setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "waiting", detail: target.name, since: Date.now() }, awaiting: null });
      const r = await askAndWait(c.bot, target, String(a.message), c.depth, !!c.tainted, seconds * 1000, c.signal);
      setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "thinking", since: Date.now() } });
      switch (r.kind) {
        // Its words are as trustworthy as its turn was: outside content when it had read some.
        case "reply": return { content: `${target.name} answered:\n${clip(r.text, 40_000)}`, summary: tr(c.user.locale, "{bot} answered", { bot: target.name }), outside: r.tainted };
        case "silent": return { content: `${target.name} ended its turn without an answer (it may have run into a problem: its own chat says more).`, isError: true, summary: tr(c.user.locale, "no answer") };
        case "failed": return { content: `${target.name}'s turn failed (${clip(r.reason, 200)}). Nothing more will come from it for this message.`, isError: true, summary: tr(c.user.locale, "failed") };
        case "pending": return { content: `${target.name} stopped to ask its owner for an approval. Its answer will reach you later as a new message; carry on without it for now.`, summary: tr(c.user.locale, "answer later") };
        case "timeout": return { content: `No answer from ${target.name} within ${seconds} seconds. The message was delivered: their answer will reach you later as a new message, as with an ordinary bot_message. Carry on without it for now.`, summary: tr(c.user.locale, "answer later") };
        case "stopped": return { content: "Stopped while waiting for the answer. It will arrive later as a new message.", isError: true, summary: tr(c.user.locale, "stopped") };
      }
    },
  }),
  tool("helper_start", "Start a temporary helper that works on a self-contained goal in parallel and reports back when done.", obj({ goal: str("Everything the helper needs to know: the goal, the context, what to report"), label: str("A few words naming the job") }, ["goal"]), {
    activity: "messaging", label: "Starting a helper",
    run: async (a, c) => {
      if (c.bot.parentId || c.depth >= 2) return { content: "Helpers cannot start further helpers.", isError: true };
      // L96 (askrules.ts): beyond MAX_HELPERS at work the request waits in a queue instead of being refused.
      const got = requestHelper(c.bot, String(a.goal), a.label ? String(a.label) : undefined, c.depth, !!c.tainted);
      if ("refused" in got) return { content: got.refused, isError: true };
      if ("queued" in got) return { content: `Queued (number ${got.queued}): ${MAX_HELPERS} helpers are already at work. It starts on its own when one of them finishes, and reports back to you like the others.`, summary: lt(c.user.locale, "Helper queued: {label} (starts when one of the {max} running helpers finishes)", { label: String(a.label ?? a.goal).slice(0, 40), max: MAX_HELPERS }) };
      const h = got.started;
      return { content: JSON.stringify({ id: h.id, name: h.name, note: "It will report back when finished." }), summary: h.name };
    },
  }),
  tool("helper_list", "List your helpers and what each is doing.", obj({}), {
    activity: "messaging", label: "Checking on helpers",
    run: async (_a, c) => {
      const list = bots.children(c.bot.id).map((h) => {
        const live = getLive(h.id);
        return { id: h.id, name: h.name, running: live.running, activity: live.activity?.kind ?? null, last_message: clip(h.preview, 300), started: new Date(h.createdAt).toISOString() };
      });
      return { content: list.length ? JSON.stringify(list) : "You have no helpers.", summary: `${list.length} helpers` };
    },
  }),
  tool("helper_message", "Send a follow-up message to one of your helpers.", obj({ id: str("Helper id"), message: str("What to tell it") }, ["id", "message"]), {
    activity: "messaging", label: "Messaging a helper",
    run: async (a, c) => {
      const h = bots.byId(String(a.id));
      if (!h || h.parentId !== c.bot.id) return { content: "No helper of yours has that id.", isError: true };
      if (c.depth >= MAX_HOPS + 2) return { content: "You and this helper have gone back and forth too many times. Wrap up with what you have.", isError: true };
      deliverBotMessage(c.bot, h, String(a.message), c.depth, c.tainted);
      return { content: "Delivered.", summary: h.name };
    },
  }),
  tool("helper_stop", "Stop one of your helpers and remove it.", obj({ id: str("Helper id") }, ["id"]), {
    activity: "messaging", label: "Stopping a helper",
    run: async (a, c) => {
      const h = bots.byId(String(a.id));
      if (!h || h.parentId !== c.bot.id) return { content: "No helper of yours has that id.", isError: true };
      await retireBot(h); startQueuedHelpers(c.bot.id); // L96: a queued helper takes the free place
      return { content: "Stopped and removed.", summary: h.name };
    },
  }),
  tool("room_create", "Create a group chat with several bots.", obj({ name: str("Group name"), bots: { type: "array", items: { type: "string" }, description: "Names of the bots to include" } }, ["name", "bots"]), {
    activity: "messaging", label: "Creating a group",
    run: async (a, c) => {
      const wanted: string[] = Array.isArray(a.bots) ? a.bots.map(String) : [];
      const found = wanted.map((n) => bots.byName(c.user.id, n)).filter((b): b is BotRecord => !!b && b.kind === "agent");
      const missing = wanted.filter((n) => !found.some((b) => b.name.toLowerCase() === n.trim().toLowerCase()));
      const ids = [...new Set(found.map((b) => b.id))];
      if (ids.length < 2) return { content: `A group needs at least two bots. Not found: ${missing.join(", ") || "—"}.`, isError: true };
      const room = createRoom(c.user.id, String(a.name).trim().slice(0, 60) || "Group", ids);
      rows.append(room, { kind: "event", event: "members", text: tr(c.user.locale, "{bot} created this group with {names}.", { bot: c.bot.name, names: found.map((b) => b.name).join(", ") }) });
      return { content: JSON.stringify({ id: room.id, missing }), summary: room.name };
    },
  }),
  tool("room_post", "Post a message into a group chat you belong to. This ends your turn. When you were brought into a thread of that group, pass its thread number so your answer goes into the thread.", obj({ room: str("The group's name"), text: str("Your message"), thread: int("The thread number you were given, to answer inside that thread") }, ["room", "text"]), {
    activity: "messaging", label: "Posting to a group", detail: (a) => String(a.room ?? ""),
    run: async (a, c) => {
      const room = bots.byName(c.user.id, String(a.room));
      if (!room || room.kind !== "room") return { content: `No group chat is called "${a.room}".`, isError: true };
      if (!room.memberIds.includes(c.bot.id)) return { content: "You are not a member of that group.", isError: true };
      const text = String(a.text);
      let thread = 0;
      if (a.thread !== undefined && a.thread !== null && Number(a.thread) > 0) {
        const parent = rows.get(room.id, room.generation, Number(a.thread));
        if (!parent || parent.thread || parent.body.kind !== "message") return { content: `That group has no thread number ${a.thread}.`, isError: true };
        thread = parent.seq;
      }
      // Anti-loop limits (roombudget.ts). A turn the user started by writing counts as a human in between.
      const channel = roomChannel(room.id);
      if (c.origin === "user") postBudget.human(c.user.id, channel);
      const others = room.memberIds.filter((id) => id !== c.bot.id).map((id) => bots.byId(id)?.name ?? "").filter(Boolean);
      const verdict = postBudget.attempt(c.user.id, { channel, botId: c.bot.id, text, now: Date.now(), toUser: addressesNoBot(text, others) });
      if (!verdict.allow) return loopRefusal(verdict, room, c);
      rows.append(room, { kind: "message", role: "assistant", text, origin: { kind: "bot", id: c.bot.id, name: c.bot.name } }, thread);
      bots.bumpUnread(room.id);
      bots.announce(room);
      dispatchToRoom(room, c.user, text, c.bot, c.depth, c.tainted, thread);
      return { content: thread ? "Posted in the thread." : "Posted.", summary: room.name, endTurn: true };
    },
  }),
];

const GEM_LABEL: Record<GemKind, string> = { lead: "New lead", seo: "SEO", data: "Data", opportunity: "Opportunity", deal: "Deal", saving: "Saving", other: "Gem" };

const userTools: BuiltinTool[] = [
  tool("ask_user", "Ask the user a question that only they can answer. Offer a few ready-made answers. This ends your turn; their answer arrives as their next message.",
    obj({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "Up to six suggested answers" }, ...QUESTION_PROPS }, ["question"]), {
    activity: "waiting", label: "Asking you",
    run: async (a, c) => {
      const routed = await routeQuestion(a, c); if (routed) return routed; // L25: the bot that gave the work answers first (delegatedask.ts)
      const card = questionCard(a); if ("error" in card) return { content: card.error, isError: true }; // L79: why, recommended, irreversible, several answers, pictures, 2-4 questions (richquestion.ts)
      rows.append(c.bot, { kind: "card", card });
      return { content: "The question is in front of the user. Stop here and wait for their answer.", summary: clip(String(a.question), 80), endTurn: true };
    },
  }),
  tool("connector_request", "Ask the user to connect an app you need (a remote tool server). This ends your turn.", obj({ app: str("Name of the app or service"), reason: str("Why you need it, in one sentence"), hint: str("If you know it: the address of the app's tool server") }, ["app", "reason"]), {
    activity: "waiting", label: "Asking to connect an app",
    run: async (a, c) => {
      rows.append(c.bot, { kind: "card", card: { type: "connect", name: clip(String(a.app), 60), hint: clip(String(a.hint ?? ""), 300), reason: clip(String(a.reason), 300), status: "pending" } });
      return { content: "The user has been asked to connect it. Stop here; you will be told when it is connected or skipped.", summary: String(a.app), endTurn: true };
    },
  }),
  tool("ask_takeover", "Ask the user to take over your screen for something only a human can do: a CAPTCHA, a two-factor code sent to their phone, a login with their own credentials, a payment confirmation, or changing a password on a site (reason password: never change one yourself — they do it and you never see it). They get a card and a notification; you wait (up to 30 minutes) until they hand the screen back, then look at it again before carrying on.",
    obj({ reason: { type: "string", enum: [...TAKEOVER_REASONS], description: "captcha, 2fa, login, payment, password (a password change they do themselves) or other" }, detail: str("What exactly they should do, in one or two sentences") }, ["reason", "detail"]), {
    activity: "waiting", label: "Waiting for you on the screen", group: "computer",
    run: async (a, c) => {
      const reason: TakeoverReason = (TAKEOVER_REASONS as readonly string[]).includes(String(a.reason)) ? (String(a.reason) as TakeoverReason) : "other";
      const detail = clip(String(a.detail ?? "").trim(), 400);
      const takeoverId = newId("tko");
      const card = rows.append(c.bot, { kind: "card", card: { type: "takeover", takeoverId, reason, detail, status: "pending", expiresAt: Date.now() + takeoverTimeoutMs() } });
      bots.bumpUnread(c.bot.id);
      const loc = c.user.locale;
      const title = tr(loc, "{bot} needs you on its screen", { bot: c.bot.name });
      setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "waiting", since: Date.now() }, awaiting: { reason: tr(loc, "take over its screen"), since: Date.now() } });
      tell({ type: "waiting", bot: c.bot, text: detail ? `${title} — ${detail}` : title });
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      const outcome = await waitForUser(takeoverId, c.bot.id, c.signal);
      rows.updateCard(c.bot, card.generation, card.seq, (k) => (k.type === "takeover" ? { ...k, status: outcome === "done" ? "done" : outcome === "timeout" ? "timeout" : "cancelled" } : k));
      releaseControl(c.bot.id);
      setLive(c.user.id, c.bot.id, { running: true, awaiting: null, activity: { kind: "thinking", since: Date.now() } });
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      if (outcome === "done") return { content: "The user finished and handed the screen back. Windows, pages and fields may have changed: take a screenshot before carrying on.", summary: tr(loc, "handed back") };
      if (outcome === "timeout") return { content: "The user did not come back within 30 minutes. Do not try to get past this step yourself: tell them where things stand and what they need to do when they are back.", isError: true, summary: tr(loc, "no answer") };
      return { content: "Stopped while waiting for the user.", isError: true, summary: tr(loc, "stopped") };
    },
  }),
  tool("celebrate", "Go euphoric when your own analysis shows a real gem for the user's business: a rare, high-value opportunity backed by data. Examples: a qualified lead ready to buy, a search query or page with large traffic upside and weak competition, a sharp jump in a key metric, a deal or saving far above normal, an untapped market signal. Score it honestly from 0 to 100 against what is normal for this business and give the numbers that prove it. Ordinary results, routine progress and things the user asked you to find are not gems. If it passes the user's bar, your character goes wild with joy where the user sees it; otherwise it is simply noted.",
    obj({
      kind: { type: "string", enum: [...GEM_KINDS], description: "lead, seo, data (a metric or trend), opportunity, deal, saving or other" },
      score: int("How rare and valuable it is, 0-100 (90+ = exceptional, seen a few times a year)"),
      evidence: str("The data that shows it, with numbers (for example: 'volume 4 400/month, top results weak, we rank 14th')"),
      value: str("What it could be worth, if you can estimate it (for example: '≈ 3 000 €/month')"),
      reason: str("The gem in a few words"),
    }, ["kind", "score", "evidence", "reason"]), {
    activity: "thinking", label: "Found a gem",
    run: async (a, c) => {
      const kind = (GEM_KINDS as readonly string[]).includes(String(a.kind)) ? (String(a.kind) as GemKind) : "other";
      const score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
      const why = clip(String(a.evidence ?? "").trim(), 400);
      const value = clip(String(a.value ?? "").trim(), 80);
      const reason = clip(String(a.reason ?? "").trim(), 160);
      const look = c.bot.character;
      const noted = (msg: string) => ({ content: `${msg} Tell the user what you found as a normal finding.`, summary: `${reason} · ${score}/100` });
      if (!reason) return { content: "Say what the gem is.", isError: true };
      if (!/\d/.test(why)) return noted("Not celebrated: a gem needs data. Give the numbers that show it.");
      if (!look.euphoria) return noted("Noted (celebrations are turned off for you).");
      if (score < look.gemThreshold) return noted(`Below the user's bar (${score} < ${look.gemThreshold}): good, but not a gem.`);
      const today = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND kind = 'event' AND body LIKE '%\"event\":\"cheer\"%' AND created_at > ?", c.bot.id, Date.now() - 86_400_000)?.n ?? 0;
      if (today >= GEMS_PER_DAY) return noted(`Not celebrated: you already went euphoric ${today} times in the last 24 hours, and gems must stay rare.`);
      const gem: Gem = { kind, score, why, value };
      rows.append(c.bot, { kind: "event", event: "cheer", text: reason, gem });
      emit(c.user.id, { type: "cheer", botId: c.bot.id, reason, gem });
      // Away from the screen (a morning gem hunt, say): also tell the user on Telegram when this bot is linked there.
      const loc = c.user.locale;
      const alert = [tr(loc, "💎 {bot} found a gem: {reason}", { bot: c.bot.name, reason }), `${tr(loc, GEM_LABEL[kind])} · ${score}/100${value ? ` · ${value}` : ""}`, why].join("\n");
      void import("../telegram.js").then((m) => m.send(c.bot, alert)).catch(() => undefined);
      pushLater(c.user.id, { kind: "gem", title: tr(loc, "💎 {bot} found a gem", { bot: c.bot.name }), body: `${reason} · ${score}/100${value ? ` · ${value}` : ""}`, botId: c.bot.id });
      return { content: "The user saw you celebrate. Now explain the gem: what you found, the numbers, what it could bring and the next step you suggest.", summary: `${reason} · ${score}/100` };
    },
  }),
  tool("stay_quiet", "End your turn without sending anything. Use it when a check-in, routine or group message leaves you with nothing worth saying.", obj({ reason: str("Why there is nothing to say") }), {
    activity: "thinking", label: "Nothing to report",
    run: async () => ({ content: "Understood.", endTurn: true }),
  }),
];

/** Stops a bot's work and removes it together with its files and browser. */
/** Deletes a bot, step by step (see retire.ts). */
export async function retireBot(b: BotRecord) {
  return (await import("./retire.js")).retireBot(b);
}

const inGroup = (group: ToolGroup, list: BuiltinTool[]) => list.map((t) => ({ ...t, group: t.group ?? group }));

/** `video`: how videos are made for this user (see videoRoute); without one, the video tools are not offered. */
/**
 * A bot may PROPOSE a local tool server for its own computer (localtools.ts), never add one on its own: the card always
 * asks (a strict gate: an earlier "Always" does not count, and "Always" is not offered), shows the exact command line,
 * and only the owner's yes adds it. Its tools then ask like any app's.
 */
const localServerTools: BuiltinTool[] = [
  tool("local_tool_server_add", "Propose a local tool server (an MCP server started by a command, e.g. npx -y some-mcp-server) to run on your own computer, so you get its tools. The user sees the exact command on a card and decides; nothing is added without their yes. Its tools are available from your next turn. Never pass keys or passwords in the arguments.",
    obj({ name: str("Short name for it, e.g. Filesystem"), command: str("The program to run, one word: npx, uvx, node, python3…"), args: { type: "array", items: { type: "string" }, description: "Its arguments, one per item, e.g. [\"-y\", \"@modelcontextprotocol/server-filesystem\", \"/root/files\"]" }, reason: str("Why you need it, in one sentence for the user") }, ["name", "command"]), {
    activity: "connector", label: "Adding a local tool server", group: "apps", audited: true,
    gate: (a) => ({
      key: "local_tool_server_add", title: "Allow {bot} to add a tool server that runs on its own computer: {name}?",
      reason: "add a local tool server", source: "Its computer",
      vars: { name: clip(String(a.name ?? a.command ?? "?"), 40), line: clip([String(a.command ?? ""), ...(Array.isArray(a.args) ? a.args.map((x: unknown) => (/[\s"'\\]/.test(String(x)) ? JSON.stringify(String(x)) : String(x))) : [])].join(" "), 600) },
      note: "Command: {line}\nIt runs inside the bot's own computer, never on the Sklubot server, and starts when the bot needs its tools. Only say yes if you trust this program.",
      strict: true, once: true,
    }),
    run: async (a, c) => {
      const args = Array.isArray(a.args) ? a.args.map(String) : [];
      let rec;
      try { rec = localTools.add(c.bot, { name: String(a.name ?? ""), command: String(a.command ?? ""), args }, "bot"); }
      catch (err) { return { content: `Not added: ${(err as Error).message}`, isError: true, summary: "not added" }; }
      await localTools.start(rec.id);
      const now = localTools.get(rec.id);
      const st = localTools.state(c.bot.id, "en").servers.find((x) => x.id === rec.id);
      if (st?.status !== "ready") return { content: `Added "${rec.name}", but it did not start: ${st?.error ?? "unknown reason"} The user can retry it in the bot's settings (Local tools).`, isError: true, summary: "did not start" };
      return { content: `Added "${rec.name}" with ${now?.tools.length ?? 0} tools (${(now?.tools ?? []).slice(0, 20).map((t) => t.name).join(", ")}). They are available from your next turn.`, summary: rec.name };
    },
  }),
];

/** Background jobs on the bot's own Linux computer (jobs.ts): started by shell_run. */
const jobTools: BuiltinTool[] = [
  tool("job_output", "Check a background job started by shell_run: its state, exit code once it ended, how long it ran, and the end of its output. wait_seconds: wait up to that long for it to end first (at most 290).", obj({ id: str("The job's id, e.g. j1a2b3c4d5"), wait_seconds: int("Wait up to this many seconds for it to end (default 0)") }, ["id"]), {
    activity: "shell", label: "Checking a background job", parallel: true, detail: (a) => String(a.id ?? ""),
    run: async (a, c) => {
      let r: Awaited<ReturnType<typeof jobOutput>>;
      try { r = await jobOutput(c.bot, workspaceOf(c.bot.id), String(a.id ?? "").trim(), Math.min(290, Math.max(0, Number(a.wait_seconds) || 0)), c.signal); }
      catch (err) { return { content: (err as Error).message, isError: true, summary: "no such job" }; }
      const j = r.job;
      const head = j.status === "running" ? `[Background job ${j.id} — \`${clip(j.command, 200)}\` — still running after ${Math.round((Date.now() - j.startedAt) / 60_000)} min. Output so far: ${r.size} bytes in ${j.log}]` : jobLine({ id: j.id, command: j.command, status: j.status, exit_code: j.exitCode, started_at: j.startedAt, ended_at: j.endedAt, note: j.note }, "");
      const outside = (teamEnabledFor(c.bot) && readsTeamFolder(j.command)) || readsKeptOutput(j.command);
      return { content: `${head}\nEnd of its output:\n${r.tail.trim() || "(no output yet)"}${r.size > 8000 ? `\n(Only the end is shown; read more of ${j.log} with shell_run.)` : ""}`, summary: j.status === "running" ? tr(c.user.locale, "still running") : j.exitCode !== null ? `exit ${j.exitCode}` : tr(c.user.locale, j.status), ...(outside ? { outside: true } : {}) };
    },
  }),
  tool("job_stop", "Stop a background job started by shell_run (the whole command and what it started).", obj({ id: str("The job's id") }, ["id"]), {
    activity: "shell", label: "Stopping a background job", audited: true, detail: (a) => String(a.id ?? ""),
    run: async (a, c) => {
      try {
        const j = await stopJob(c.bot, workspaceOf(c.bot.id), String(a.id ?? "").trim());
        return { content: j.status === "stopped" ? `Stopped job ${j.id}.` : `Job ${j.id} had already ended (${j.status}).`, summary: j.id };
      } catch (err) { return { content: (err as Error).message, isError: true, summary: "no such job" }; }
    },
  }),
  tool("job_list", "List your background jobs (running and recently ended) with their ids and states.", obj({}), {
    activity: "shell", label: "Listing background jobs", parallel: true,
    run: async (_a, c) => {
      const list = jobs.forBot(c.bot.id, 15);
      return { content: list.length ? list.map((j) => `${j.id} · ${j.status}${j.exitCode !== null ? ` (exit ${j.exitCode})` : ""} · ${clip(j.command, 120)}`).join("\n") : "You have no background jobs.", summary: `${list.length}` };
    },
  }),
];

export function builtinTools(opts: { owner?: string; nativeSearch?: boolean; /** The bot's own model offers a documented web search (nativesearch.ts). */ modelSearch?: boolean; disabled?: readonly string[]; video?: "connector" | "api" | null; bgTasks?: boolean } = {}): BuiltinTool[] {
  return [...assemble(opts), ...placeTools].map(withSiteNotes).filter((t) => !t.group || !(opts.disabled ?? []).includes(t.group)); // L88 site notes, documents, project memory (memoryplaces.ts)
}

function assemble(opts: { owner?: string; nativeSearch?: boolean; modelSearch?: boolean; video?: "connector" | "api" | null; bgTasks?: boolean }): BuiltinTool[] {
  return [
    ...(browserAvailable() ? inGroup("computer", screenTools).map(respectDriver).map(noteShots).map(traceClicks).map(recordable) : []),
    ...(computerKind() === "linux" ? inGroup("computer", [...elementTools, ...browserTabTools, ...browserDownloadTools]).map(respectDriver).map(noteShots).map(recordable) : []),
    // On its own Linux computer a bot's commands are contained, so they do not need a permission card.
    // Background jobs and office documents: on the bots' own Linux computers only (shell_run starts the jobs).
    ...(computerKind() === "linux" && shellAvailable() ? [...inGroup("shell", jobTools), craftReady, openmanWorkspace] : []),
    ...(officeAvailable() ? officeTools : []),
    // Listening, watching a video, downloading one, OCR: on the bots' own Linux computers only (media.ts).
    ...(mediaAvailable() ? inGroup("computer", [...mediaTools, meetingTranscribe]) : []),
    ...workTools.filter((t) => t.spec.name !== "shell_run" || shellAvailable())
      .map((t): BuiltinTool => ({ ...t, group: t.spec.name === "shell_run" ? "shell" : t.spec.name === "web_fetch" ? "web" : "files", sensitive: t.spec.name === "shell_run" && computerKind() === "linux" ? false : t.sensitive })),
    ...((searchChainAvailable() || opts.modelSearch) && !opts.nativeSearch ? searchTools : []),
    // Wave 7: Agent Reach (read-only) on the bot's Linux computer, transcription, temporary public links.
    ...(reachAvailable() ? inGroup("reach", reachTools) : []),
    ...(computerKind() === "linux" || reachAvailable() ? transcribeTools : []),
    githubSearch, githubRead, videoWorkflowTool, videoStudioTool, updateVideoStudio, ...(computerKind() === "linux" ? [studioMp4Tool] : []), ...publicLinkTools,
    ...knowledgeTools, ...guideTools, ...guideSearchTools, ...(browserAvailable() ? contactSheetTools : []), ...ruleTools, ...pageTools, ...progressTools, ...profileTools, ...skillImportTools, ...botTools, ...recruitTools, ...inGroup("team", teamMdTools),
    researchTool, scholarTool, pastReportsTool, ...(xSearchAvailable(opts.owner) ? xTools : []), ...stepTools,
    ...shareTools.map((t): BuiltinTool => ({ ...t, group: "files" })), ...(imageServiceFor(opts.owner) || (opts.owner && wan2gpTarget(opts.owner)) ? [{ ...imageTool, group: "images" as const }] : []),
    ...inGroup("vault", vaultTools),
    ...(browserAvailable() ? inGroup("vault", screenVaultTools).map(respectDriver).map(recordable) : []),
    ...(browserAvailable() ? inGroup("vault", cardTools).map(respectDriver).map(recordable) : []),
    ...inGroup("apps", apiTools),
    // A bot's own email address (wave 6): offered by newTurn only to bots that have one.
    ...inGroup("apps", botMailTools),
    // Proposing a local tool server for its own computer: offered by newTurn only where bots have Linux computers.
    ...localServerTools,
    ...(opts.video ? inGroup("video", videoTools) : []),
    // The user's own computers (Sklubot Relais): offered by newTurn only to users who linked one.
    ...myComputerTools, ...myComputerPlusTools, ...myUiTools, ...phoneTools, ...liveDocTools, ...remoteAgentTools,
    ...inGroup("memory", [...memoryTools, ...roomMemoryTools, ...skillFeedbackTools]), ...inGroup("routines", [...routineTools, ...routineFrameTools, ...routineOptionTools]), ...inGroup("tasks", taskTools), ...(opts.bgTasks === false ? [] : inGroup("tasks", bgTaskTools)), ...goalTools, ...waitTools, ...planTools, ...viewTools, ...creationTools, ...inGroup("team", [...teamTools, ...roomTools]), ...userTools.filter((t) => t.spec.name !== "ask_takeover" || browserAvailable()), ...(computerKind() === "linux" ? codeTools : []), ...reactTools,
  ];
}
