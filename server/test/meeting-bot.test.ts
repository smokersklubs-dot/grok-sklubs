import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * L177 « bot qui rejoint une réunion »: the links it accepts, the page driver on a fake meeting page in a real headless
 * Chromium (Playwright), and the whole meeting flow with fake hands (login wall, lobby, no chat, refusal, owner leave,
 * maximum duration, meeting ended, no speech-to-text), the approval card, owner-only tools and routes. Local data in a
 * temporary folder; no real meeting service is contacted.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-meetingbot-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";

const { api } = await import("../src/routes.js");
const { meetingLink, refusalIn, guestName, announcement } = await import("../src/meetingbot/links.js");
const { MEETING_PAGE_JS } = await import("../src/meetingbot/driver.js");
const { meetings, setMeetingDeps, meetingSettings } = await import("../src/meetingbot/session.js");
const { meetingBotTools } = await import("../src/meetingbot/tools.js");
const { setMediaTestHooks } = await import("../src/media.js");
const { tr } = await import("../src/i18n.js");
const { bots, rows } = await import("../src/store.js");
const { readLibraryFile } = await import("../src/computer.js");
import type { MeetingHands } from "../src/meetingbot/helper.js";
import type { PageLook } from "../src/meetingbot/driver.js";

setMediaTestHooks({ linux: true });
after(() => { setMediaTestHooks(null); setMeetingDeps(null); });

const jars: Record<string, string> = { a: "", b: "" };
async function call(who: "a" | "b", method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
let botId = "", userId = "";
const ctx = (over: Record<string, unknown> = {}) => { const bot = bots.byId(botId)!; return { bot, user: { id: userId, locale: "fr" }, signal: new AbortController().signal, tainted: false, origin: "user", thread: 0, ...over } as any; };
const tool = (name: string) => meetingBotTools.find((t) => t.spec.name === name)!;
const lastText = () => { const r = rows.recentMessages(botId, bots.byId(botId)!.generation, 5, 0).filter((x) => x.body.kind === "message"); const b = r[r.length - 1]?.body; return b && b.kind === "message" ? b.text : ""; };
const allText = () => rows.recentMessages(botId, bots.byId(botId)!.generation, 60, 0).map((x) => (x.body.kind === "message" ? x.body.text : "")).join("\n");

/** A WAV of a 440 Hz tone (what a meeting tab would play). */
function tone(seconds: number): Buffer {
  const n = 16000 * seconds, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 16000)), 44 + i * 2);
  return b;
}
const fast = { chunkSeconds: 1, pollMs: 20, stepMs: 10, joinMs: 1500, lobbyMs: 300 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = { stt: () => "free" as const, transcribe: async () => "On valide le budget. Marie envoie le devis vendredi.", summarize: async () => "Résumé : budget validé.\n\nActions :\n- Marie — envoyer le devis — vendredi", sleep, timing: fast };

test("setup: two accounts", async () => {
  assert.equal((await call("a", "POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" })).status, 200);
  assert.equal((await call("b", "POST", "/auth/signup", { email: "paul@example.com", name: "Paul", password: "password123", locale: "fr" })).status, 200);
  const b = (await call("a", "GET", "/bots")).json.bots.find((x: any) => x.primary);
  botId = b.id; userId = bots.byId(botId)!.userId;
});

// ── Links ──
test("links: the four services, normalised; anything else refused with a reason", () => {
  const ok = (raw: string) => { const l = meetingLink(raw); assert.ok(l.ok, raw); return l as Extract<typeof l, { ok: true }>; };
  assert.deepEqual(ok("https://meet.google.com/abc-defg-hij?authuser=2"), { ok: true, platform: "meet", host: "meet.google.com", url: "https://meet.google.com/abc-defg-hij" });
  assert.equal(ok("meet.google.com/abc-defg-hij").url, "https://meet.google.com/abc-defg-hij");
  assert.equal(ok("https://us02web.zoom.us/j/81234567890?pwd=AbC.12-x&uname=x").url, "https://us02web.zoom.us/wc/81234567890/join?pwd=AbC.12-x");
  assert.equal(ok("https://zoom.us/wc/join/81234567890").url, "https://zoom.us/wc/81234567890/join");
  assert.equal(ok("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d").platform, "teams");
  assert.equal(ok("https://teams.live.com/meet/9876543210?p=abc").url, "https://teams.live.com/meet/9876543210?p=abc");
  assert.equal(ok("https://meet.jit.si/EquipeLundi").url, "https://meet.jit.si/EquipeLundi#config.startWithAudioMuted=true&config.startWithVideoMuted=true");
  for (const [raw, why] of [
    ["", /Give the meeting link/], ["http://meet.google.com/abc-defg-hij", /https/], ["https://user:pw@meet.google.com/abc-defg-hij", /login/],
    ["https://meet.google.com/landing", /meeting code/], ["https://zoom.us/my/someone", /meeting number/], ["https://teams.microsoft.com/v2/", /invitation/],
    ["https://evil.example.com/j/81234567890", /Only Google Meet/], ["https://zoom.us.evil.com/j/81234567890", /Only Google Meet/], ["https://meet.google.com:8443/abc-defg-hij", /not valid/],
  ] as const) { const l = meetingLink(raw); assert.equal(l.ok, false, raw); assert.match((l as { error: string }).error, why, raw); }
  // Every refusal has a French text.
  for (const raw of ["", "http://x", "https://meet.google.com/x", "https://zoom.us/x", "https://teams.microsoft.com/x", "https://meet.jit.si/", "https://a.example/"]) {
    const l = meetingLink(raw); if (!l.ok) assert.notEqual(tr("fr", l.error), l.error, l.error);
  }
});

test("guest name and announcement: who it is, for whom, how to refuse (French and English)", () => {
  assert.equal(guestName("Nova", "Léa", "fr"), "Nova (assistant de Léa) — prend des notes");
  assert.equal(guestName("Nova", "Léa", "en"), "Nova (Léa's assistant) — taking notes");
  assert.match(announcement("Nova", "Léa", "fr"), /Je prends des notes pour Léa ; dites-le si vous refusez/);
  assert.match(announcement("Nova", "Léa", "en"), /taking notes for Léa; say so if you refuse/);
});

test("refusal words: a participant's refusal is seen, the bot's own announcement never", () => {
  const own = [announcement("Nova", "Léa", "fr")];
  assert.equal(refusalIn(`Nova: ${own[0]}`, own), null);
  assert.equal(refusalIn(`Nova: ${own[0]}\nPaul: Je REFUSE d'être enregistré`, own), "je refuse");
  assert.equal(refusalIn("Ann: no recording please", []), "no recording");
  assert.equal(refusalIn("Ann: pas d’enregistrement svp", []), "pas d'enregistrement");
  assert.equal(refusalIn("Ann: on parle du référendum", []), null);
  assert.equal(refusalIn("Ann: carton rouge", [], ["carton rouge"]), "carton rouge");
});

// ── The page driver in a real headless Chromium ──
const require = createRequire(import.meta.url);
let chromium: { launch(o: Record<string, unknown>): Promise<any> } | null = null;
try { chromium = (require("playwright") as { chromium: typeof chromium }).chromium; } catch { /* no browser */ }
const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-meeting.html"));
const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
after(() => server.close());
const pageUrl = (query = "") => `http://127.0.0.1:${(server.address() as AddressInfo).port}/meeting${query}`;

/** The same steps as helper.ts (find with the driver, a trusted click at its centre, typed text, Enter), with Playwright. */
function pageHands(page: any, recorded: { seconds: number[] }): MeetingHands {
  const find = (what: string) => page.evaluate(`(${MEETING_PAGE_JS})({op: 'find', what: ${JSON.stringify(what)}})`);
  return {
    async open(url) { await page.goto(url); return { tab: "t1" }; },
    look: () => page.evaluate(`(${MEETING_PAGE_JS})({op: 'look'})`) as Promise<PageLook>,
    async act(_tab, op, what, text) {
      const f = await find(what);
      if (!f.found) return false;
      await page.mouse.click(f.x, f.y);
      if (op !== "click") { await find(what); await page.keyboard.insertText(text ?? ""); }
      if (op === "send") await page.keyboard.press("Enter");
      return true;
    },
    async close() {},
    async record(seconds, signal) { recorded.seconds.push(seconds); await new Promise((r) => { const t = setTimeout(r, seconds * 1000); signal?.addEventListener("abort", () => { clearTimeout(t); r(null); }); }); return tone(seconds); },
  };
}

test("fake meeting in headless Chromium: joins as a named guest, announces, hears the tab, leaves on a refusal, posts notes", { skip: !chromium && "Playwright is not installed" }, async () => {
  const browser = await chromium!.launch({ headless: true, args: ["--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const recorded = { seconds: [] as number[] };
    setMeetingDeps({ ...quiet, hands: () => pageHands(page, recorded) });
    // The page under test is a local file served on 127.0.0.1: the session gets its address directly (start() is what
    // the routes and the tool call after meetingLink checked a real link).
    const s = meetings.start(bots.byId(botId)!, { platform: "meet", url: pageUrl("?browser=1&lobby=1"), maxMinutes: 30 });
    assert.equal(typeof s, "object");
    const sid = (s as { id: string }).id;
    for (let i = 0; i < 200 && meetings.get(userId, sid)!.status !== "live"; i++) await sleep(25);
    assert.equal(meetings.get(userId, sid)!.status, "live", meetings.get(userId, sid)!.reason + " " + allText().slice(-400) + JSON.stringify(await page.evaluate("[location.href, document.body.innerText]")));
    const st = await page.evaluate("window.state");
    assert.equal(st.name, "Nova (assistant de Léa) — prend des notes".replace("Nova", bots.byId(botId)!.name));
    assert.deepEqual(st.trusted, [true, true], "« Continue on this browser » and « Ask to join » got real (trusted) clicks");
    assert.equal(st.micClicked, true, "the microphone was turned off before joining");
    assert.equal(st.sent.length, 1);
    assert.match(st.sent[0], /Je prends des notes pour Léa ; dites-le si vous refusez/);
    assert.equal(await page.evaluate("document.getElementById('sound').paused"), false, "the meeting's audio element plays");
    assert.match(allText(), /J'attends dans la salle d'attente/);
    assert.match(lastText(), /Je suis dans la réunion Google Meet sous le nom « .+ \(assistant de Léa\) — prend des notes »/);
    await sleep(1300); // at least one minute-chunk (1 s here) is recorded and transcribed
    await page.evaluate("window.fakeSay('Paul', 'Je refuse d\\'être enregistré')");
    await meetings.settled(botId);
    const end = meetings.get(userId, sid)!;
    assert.equal(end.status, "ended");
    assert.equal(end.reason, "refused");
    const afterState = await page.evaluate("window.state");
    assert.equal(afterState.left, true, "it clicked « Leave call »");
    assert.match(afterState.sent[1], /D'accord, je quitte la réunion/);
    assert.ok(recorded.seconds.length >= 1 && recorded.seconds.every((x: number) => x === 1));
    assert.match(lastText(), /Notes de la réunion Google Meet .*un participant a refusé \(« je refuse »\)/);
    assert.match(lastText(), /Marie — envoyer le devis — vendredi/);
    assert.match(lastText(), /Transcription complète, gardée seulement dans tes fichiers : meetings\/.+\/transcript\.txt/);
    assert.match(readLibraryFile(botId, end.transcriptFile!).toString(), /On valide le budget/);
    assert.match(readLibraryFile(botId, end.notesFile!).toString(), /Actions/);
  } finally { await browser.close(); setMeetingDeps(null); }
});

test("fake meeting in headless Chromium: a login wall is never passed; a meeting without a chat is left at once", { skip: !chromium && "Playwright is not installed" }, async () => {
  const browser = await chromium!.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const recorded = { seconds: [] as number[] };
    setMeetingDeps({ ...quiet, hands: () => pageHands(page, recorded) });
    let s = meetings.start(bots.byId(botId)!, { platform: "teams", url: pageUrl("?login=1") }) as { id: string };
    await meetings.settled(botId);
    assert.deepEqual([meetings.get(userId, s.id)!.status, meetings.get(userId, s.id)!.reason], ["failed", "login"]);
    assert.match(lastText(), /elle demande de se connecter, et je n'utilise jamais de compte/);
    assert.equal(await page.evaluate("document.querySelector('input[type=password]').value"), "", "nothing typed into the login form");
    s = meetings.start(bots.byId(botId)!, { platform: "jitsi", url: pageUrl("?nochat=1") }) as { id: string };
    await meetings.settled(botId);
    assert.deepEqual([meetings.get(userId, s.id)!.status, meetings.get(userId, s.id)!.reason], ["failed", "no_chat"]);
    assert.equal((await page.evaluate("window.state")).left, true);
    assert.equal(recorded.seconds.length, 0, "nothing was recorded");
  } finally { await browser.close(); setMeetingDeps(null); }
});

// ── The flow with scripted hands ──
interface Script { look: Partial<PageLook>; }
function scripted(o: { inMeeting?: boolean; login?: boolean; lobbyForever?: boolean; chat?: () => string; ended?: () => boolean } = {}) {
  const log: string[] = [];
  let joined = false;
  const hands: MeetingHands = {
    async open(url) { log.push("open " + url); return { tab: "t" }; },
    async look() {
      const base: PageLook = { url: "", title: "", login: !!o.login, lobby: false, inMeeting: false, ended: false, nameField: !joined, joinButton: joined ? null : "Ask to join", chatInput: true, chat: "" };
      if (o.lobbyForever && joined) return { ...base, lobby: true };
      if (joined || o.inMeeting) return { ...base, inMeeting: !(o.ended?.()), ended: !!o.ended?.(), chat: o.chat?.() ?? "" };
      return base;
    },
    async act(_t, op, what, text) { log.push(`${op} ${what}${text ? " " + text : ""}`); if (what === "join") joined = true; return what !== "browser"; },
    async close() { log.push("close"); },
    async record(seconds, signal) { log.push("record " + seconds); await new Promise((r) => { const t = setTimeout(r, 40); signal?.addEventListener("abort", () => { clearTimeout(t); r(null); }); }); return tone(1); },
  };
  return { hands, log };
}
const startWith = async (h: ReturnType<typeof scripted>, extra: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => {
  setMeetingDeps({ ...quiet, hands: () => h.hands, ...extra });
  const s = meetings.start(bots.byId(botId)!, { platform: "zoom", url: "https://zoom.us/wc/81234567890/join", ...opts });
  assert.equal(typeof s, "object", String(s));
  return (s as { id: string }).id;
};

test("flow: no speech-to-text, or a paid one not allowed — nothing is opened", async () => {
  let h = scripted();
  let id = await startWith(h, { stt: () => "none" });
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "no_stt");
  assert.deepEqual(h.log, []);
  assert.match(lastText(), /aucune transcription de la voix n'est réglée/);
  h = scripted();
  id = await startWith(h, { stt: () => "paid" });
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "paid_stt");
  assert.deepEqual(h.log, []);
  h = scripted();
  id = await startWith(h, { stt: () => "paid" }, { allowPaid: true, maxMinutes: 5 });
  await sleep(150);
  assert.ok(meetings.leave(userId, id));
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "owner");
});

test("flow: name typed, joined, announced BEFORE any recording; the owner's leave; one meeting at a time", async () => {
  const h = scripted();
  const id = await startWith(h);
  assert.equal(meetings.start(bots.byId(botId)!, { platform: "meet", url: "https://meet.google.com/abc-defg-hij" }), "This bot is already in a meeting: make it leave first.");
  for (let i = 0; i < 100 && meetings.get(userId, id)!.status !== "live"; i++) await sleep(10);
  await sleep(100);
  assert.ok(meetings.leave(userId, id));
  await meetings.settled(botId);
  const firstRecord = h.log.findIndex((l) => l.startsWith("record"));
  const announce = h.log.findIndex((l) => l.startsWith("send chat_input Bonjour"));
  assert.ok(h.log.some((l) => /^type name .+ \(assistant de Léa\) — prend des notes$/.test(l)), h.log.join("\n"));
  assert.ok(announce > 0 && firstRecord > announce, h.log.join("\n"));
  assert.ok(h.log.includes("click leave") && h.log.at(-1) === "close");
  assert.equal(meetings.get(userId, id)!.reason, "owner");
  assert.match(lastText(), /je suis parti car tu m'as demandé de partir/);
  assert.equal(meetings.leave(userId, id), false, "already gone");
});

test("flow: maximum duration, meeting ended, lobby nobody opens, login wall", async () => {
  let h = scripted();
  let clock = Date.now();
  let id = await startWith(h, { now: () => clock }, { maxMinutes: 5 });
  for (let i = 0; i < 100 && meetings.get(userId, id)!.status !== "live"; i++) await sleep(10);
  clock += 6 * 60_000;
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "max");
  assert.match(lastText(), /la durée maximale \(5 min\) était atteinte/);

  let over = false;
  h = scripted({ ended: () => over });
  id = await startWith(h);
  for (let i = 0; i < 100 && meetings.get(userId, id)!.status !== "live"; i++) await sleep(10);
  over = true;
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "ended");

  h = scripted({ lobbyForever: true });
  id = await startWith(h);
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "not_admitted");
  assert.ok(!h.log.some((l) => l.startsWith("record") || l.startsWith("send")), "nothing recorded or written while waiting");

  h = scripted({ login: true });
  id = await startWith(h);
  await meetings.settled(botId);
  assert.equal(meetings.get(userId, id)!.reason, "login");
  assert.ok(!h.log.some((l) => l.startsWith("type")), "nothing typed on a login page");
});

test("flow: the owner's own refusal words; no speech heard → no notes, no files", async () => {
  meetingSettings.set(bots.byId(botId)!, { words: ["carton rouge"] });
  let chat = "";
  const h = scripted({ chat: () => chat });
  const id = await startWith(h, { transcribe: async () => "" });
  for (let i = 0; i < 100 && meetings.get(userId, id)!.status !== "live"; i++) await sleep(10);
  chat = "Ann: carton rouge pour le bot";
  await meetings.settled(botId);
  const s = meetings.get(userId, id)!;
  assert.deepEqual([s.reason, s.transcriptFile, s.notesFile], ["refused", null, null]);
  assert.match(lastText(), /Je n'ai entendu personne parler, il n'y a donc pas de notes/);
  meetingSettings.set(bots.byId(botId)!, { words: [] });
});

// ── Tools: approval card, owner only ──
test("meeting_join: a strict one-time card with the exact link and the consent warning; owner's own turn only", async () => {
  const join = tool("meeting_join");
  const card = join.gate!({ url: "https://us02web.zoom.us/j/81234567890?pwd=abc", max_minutes: 45 }, { botId, tainted: false })!;
  assert.equal(card.strict, true);
  assert.equal(card.once, true);
  assert.equal(card.vars.url, "https://us02web.zoom.us/wc/81234567890/join?pwd=abc");
  assert.equal(card.vars.minutes, "45");
  const fr = tr("fr", card.title, { bot: "Nova", ...card.vars });
  assert.match(fr, /^Envoyer Nova dans cette réunion Zoom pour prendre des notes \? https:\/\/us02web\.zoom\.us\/wc\/81234567890\/join\?pwd=abc$/);
  assert.match(tr("fr", card.note!, card.vars), /La loi peut exiger l'accord de chaque participant/);
  assert.match(tr("fr", join.gate!({ url: "https://meet.jit.si/Equipe", allow_paid: true }, { botId, tainted: false })!.note!, {}), /La transcription payante est autorisée/);
  assert.equal(join.gate!({ url: "https://example.com/x" }, { botId, tainted: false }), null, "a bad link: the tool explains, no card");
  for (const origin of ["routine", "email", "webhook", "bot", "api", "member"]) {
    const r = await join.run({ url: "https://meet.google.com/abc-defg-hij" }, ctx({ origin }));
    assert.equal(r.isError, true, origin);
    assert.match(String(r.content), /Only your owner can send you to a meeting/);
  }
  assert.match(String((await join.run({ url: "https://example.com/x" }, ctx())).content), /Only Google Meet/);
  setMeetingDeps({ ...quiet, hands: () => scripted().hands });
  const ok = await join.run({ url: "https://meet.google.com/abc-defg-hij", max_minutes: 10 }, ctx());
  assert.equal(ok.isError, undefined, String(ok.content));
  assert.match(String(ok.content), /Joining the Google Meet meeting/);
  await sleep(80);
  assert.match(String((await tool("meeting_leave").run({}, ctx({ origin: "routine" }))).content), /Only your owner/);
  assert.match(String((await tool("meeting_leave").run({}, ctx())).content), /Leaving the meeting now/);
  await meetings.settled(botId);
  assert.match(String((await tool("meeting_leave").run({}, ctx())).content), /not in a meeting/);
});

// ── Routes ──
test("routes: review card, confirm, leave, settings — the owner's alone", async () => {
  setMeetingDeps({ ...quiet, hands: () => scripted().hands });
  setMediaTestHooks({ linux: true });
  const info = await call("a", "GET", `/bots/${botId}/meeting-bots`);
  assert.equal(info.status, 200);
  assert.equal(info.json.available, true);
  assert.equal(info.json.settings.maxMinutes, 60);
  assert.match(info.json.name, /\(assistant de Léa\) — prend des notes$/);
  const check = await call("a", "POST", `/bots/${botId}/meeting-bots/check`, { url: "https://zoom.us/j/81234567890" });
  assert.deepEqual([check.status, check.json.platform, check.json.url, check.json.maxMinutes], [200, "zoom", "https://zoom.us/wc/81234567890/join", 60]);
  assert.match((await call("a", "POST", `/bots/${botId}/meeting-bots/check`, { url: "https://example.com/" })).json.error, /Seuls les liens Google Meet/);
  assert.equal((await call("a", "POST", `/bots/${botId}/meeting-bots`, { url: "https://zoom.us/j/81234567890" })).status, 400, "not confirmed");
  assert.equal((await call("a", "POST", `/bots/${botId}/meeting-bots`, { url: "https://zoom.us/j/81234567890", confirm: true, maxMinutes: 2 })).status, 400);
  const started = await call("a", "POST", `/bots/${botId}/meeting-bots`, { url: "https://zoom.us/j/81234567890", confirm: true, maxMinutes: 20 });
  assert.equal(started.status, 200, started.text);
  const mid = started.json.session.id;
  assert.equal((await call("a", "POST", `/bots/${botId}/meeting-bots`, { url: "https://zoom.us/j/81234567890", confirm: true })).status, 409);
  // A stranger sees nothing and can do nothing.
  for (const [m, u, b] of [["GET", `/bots/${botId}/meeting-bots`], ["POST", `/bots/${botId}/meeting-bots/check`, { url: "https://zoom.us/j/81234567890" }], ["POST", `/bots/${botId}/meeting-bots`, { url: "https://zoom.us/j/81234567890", confirm: true }], ["POST", `/bots/${botId}/meeting-bots/${mid}/leave`], ["PUT", `/bots/${botId}/meeting-bot-settings`, { maxMinutes: 30 }]] as const) {
    const r = await call("b", m, u, b);
    assert.equal(r.status, 404, `${m} ${u}`);
    assert.ok(!r.text.includes("zoom.us/wc"), "no leak");
  }
  await sleep(80);
  assert.equal((await call("a", "POST", `/bots/${botId}/meeting-bots/${mid}/leave`)).status, 200);
  await meetings.settled(botId);
  assert.equal((await call("a", "POST", `/bots/${botId}/meeting-bots/${mid}/leave`)).status, 404);
  assert.equal((await call("a", "GET", `/bots/${botId}/meeting-bots`)).json.sessions[0].reason, "owner");
  assert.equal((await call("a", "PUT", `/bots/${botId}/meeting-bot-settings`, { maxMinutes: 300 })).status, 400);
  const saved = await call("a", "PUT", `/bots/${botId}/meeting-bot-settings`, { maxMinutes: 90, words: ["carton rouge", "x", "carton rouge"] });
  assert.deepEqual(saved.json.settings, { maxMinutes: 90, words: ["carton rouge"] });
  setMeetingDeps(null);
});

test("the computer helper is valid Python (and so is its permission keeper); it asks for the documented CDP methods only", async () => {
  const { MEETING_PY } = await import("../src/meetingbot/helper.js");
  const { spawnSync } = await import("node:child_process");
  const check = "import ast, sys\nsrc = sys.stdin.read()\ntree = ast.parse(src)\nkeeper = [n.value.value for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'KEEPER']\nast.parse(keeper[0])\nprint('ok')";
  const r = spawnSync("python3", ["-c", check], { input: MEETING_PY });
  if (r.error) return; // no python3 here: the helper only runs on the bot's computer
  assert.equal(r.stdout.toString().trim(), "ok", r.stderr.toString());
  const methods = [...new Set([...MEETING_PY.matchAll(/"((?:Browser|Runtime|Input)\.\w+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(methods, ["Browser.setPermission", "Input.dispatchKeyEvent", "Input.dispatchMouseEvent", "Input.insertText", "Runtime.evaluate"]);
  assert.match(MEETING_PY, /setting.: .denied/);
});

test("flow: an unexpected error never leaves a meeting « in progress »; the computer is held awake only meanwhile", async () => {
  let held = 0, released = 0;
  const h = scripted();
  h.hands.look = async () => { throw new Error("the computer went away"); };
  const id = await startWith(h, { hold: () => { held++; return () => { released++; }; } });
  await meetings.settled(botId);
  const s = meetings.get(userId, id)!;
  assert.deepEqual([s.status, s.reason], ["failed", "error"]);
  assert.match(lastText(), /J'ai arrêté la réunion Zoom après une erreur : the computer went away/);
  assert.deepEqual([held, released], [1, 1]);
  assert.equal(meetings.active(botId), null);
  setMeetingDeps(null);
});
