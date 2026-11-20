import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// The seeing-and-hearing tools of the bot's Linux computer (media.ts): their argument checks and caps, that they only
// ever run on the calling bot's own computer, the silence check, the speech-to-text chain (free Whisper, paid others
// only with a yes), and the refusal where bots have no Linux computer. The computer and the speech-to-text are fakes here;
// the real programs (ffmpeg, PulseAudio, yt-dlp, Tesseract) are checked by building the desktop image (CI computer:build).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-media-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const media = await import("../src/media.js");
const { mediaTools, setMediaTestHooks, listenArgs, framesArgs, ocrArgs, downloadArgs, parseFrames, wavPeak, LISTEN_MAX_SECONDS, FRAMES_MAX, DOWNLOAD_MAX_MB, LISTEN_SCRIPT, DOWNLOAD_SCRIPT } = media;
const { users, bots } = await import("../src/store.js");
const { paidConsents } = await import("../src/providers.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { meetingInput } = await import("../src/meetings.js");
test("meeting segments accept only an audio upload and a valid resume offset", () => {
  assert.equal(meetingInput("~/files/uploads/réunion.webm", 120).rel, "uploads/réunion.webm");
  assert.equal(meetingInput("uploads/réunion.webm", undefined).offset, 0);
  for (const path of ["../other/audio.wav", "uploads/../private.wav", "https://vendor.invalid/a.wav", "uploads/file.html"])
    assert.throws(() => meetingInput(path, 0));
  assert.throws(() => meetingInput("uploads/a.wav", -120));
  assert.throws(() => meetingInput("uploads/a.wav", 1));
});
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { linkHint } = await import("../src/agent/links.js");
import type { ToolContext } from "../src/agent/tools.js";

after(() => setMediaTestHooks(null));

const alice = users.create("alice-media@example.test", "Alice", "x", "fr");
const bob = users.create("bob-media@example.test", "Bob", "x", "en");
const aliceBot = bots.create(alice.id, { name: "Ada" });
const bobBot = bots.create(bob.id, { name: "Bea" });
const ctxOf = (bot = aliceBot, user = alice): ToolContext => ({ bot, user, depth: 0, signal: new AbortController().signal });
const tool = (name: string) => mediaTools.find((t) => t.spec.name === name)!;

/** A 16 kHz mono 16-bit WAV of `seconds`, a tone (or silence). */
function wav(seconds: number, amplitude: number): Buffer {
  const n = Math.round(seconds * 16000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(amplitude * Math.sin((i / 16000) * 2 * Math.PI * 440)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(0xffffffff, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(0xffffffff, 40);
  return Buffer.concat([h, data]);
}

type Call = { botId: string; userId: string; argv: string[]; timeoutSec: number; maxBytes: number };
const calls: Call[] = [];
let answer: (argv: string[]) => { code: number; stdout?: string; raw?: Buffer; stderr?: string; timedOut?: boolean } = () => ({ code: 0 });
const runner = async (botId: string, userId: string, argv: string[], timeoutSec: number, maxBytes: number) => {
  calls.push({ botId, userId, argv, timeoutSec, maxBytes });
  const a = answer(argv);
  const raw = a.raw ?? Buffer.from(a.stdout ?? "");
  return { code: a.code, stdout: a.stdout ?? raw.toString("utf8"), raw, stderr: a.stderr ?? "", timedOut: !!a.timedOut };
};
const heard: { userId: string; bytes: number }[] = [];
let sttKind = "whisper-cpp";
const stt = (userId: string) => (sttKind ? { kind: sttKind, stt: async (w: Buffer) => { heard.push({ userId, bytes: w.length }); return "bonjour à tous"; } } : null);

test("arguments: durations and counts are capped, paths are one line, nothing is written into a script", () => {
  assert.equal(listenArgs({ seconds: 99999 }).seconds, LISTEN_MAX_SECONDS);
  assert.equal(listenArgs({ seconds: -4 }).seconds, 30, "nonsense: the default");
  assert.equal(listenArgs({}).seconds, 30);
  assert.deepEqual(listenArgs({ seconds: 12.9 }).argv.slice(3), ["listen", "12"]);
  assert.equal(listenArgs({}).argv[2], LISTEN_SCRIPT, "the script is fixed text; the duration is an argument");

  const f = framesArgs({ count: 500, watch_seconds: 999 });
  assert.ok(!("error" in f));
  if (!("error" in f)) { assert.equal(f.count, FRAMES_MAX); assert.deepEqual(f.argv.slice(4, 9), ["screen", String(FRAMES_MAX), "0", "60", "768"]); }
  const file = framesArgs({ source: "~/files/a $(rm -rf).mp4", count: 3, from_seconds: 5, to_seconds: 9 });
  assert.ok(!("error" in file) && file.argv[4] === "~/files/a $(rm -rf).mp4", "a path is passed as one argument, never interpreted");
  assert.ok("error" in framesArgs({ source: "a\nb.mp4" }));

  assert.deepEqual((ocrArgs({}) as string[]).slice(4), ["screen", "fra+eng", "", "1"]);
  assert.deepEqual((ocrArgs({ x: 10, y: 20, width: 300, height: 40, lang: "DEU+eng" }) as string[]).slice(4, 7), ["screen", "deu+eng", "300x40+10+20"]);
  assert.ok("error" in (ocrArgs({ lang: "fra; rm -rf /" }) as object));
  assert.ok("error" in (ocrArgs({ x: -1, y: 0, width: 50, height: 50 }) as object));
  assert.ok("error" in (ocrArgs({ width: 4, height: 4 }) as object), "a region too small to hold text");
  assert.equal((ocrArgs({ source: "~/files/scan.pdf", page: 3.6 }) as string[])[7], "3");

  const d = downloadArgs({ url: "https://www.youtube.com/watch?v=x", max_mb: 99999 }) as string[];
  assert.deepEqual(d.slice(3), ["download", "https://www.youtube.com/watch?v=x", String(DOWNLOAD_MAX_MB), "video", "~/files/videos"]);
  assert.equal(d[2], DOWNLOAD_SCRIPT);
  assert.match(DOWNLOAD_SCRIPT, /--max-filesize/); assert.match(DOWNLOAD_SCRIPT, /--no-playlist/);
  assert.equal((downloadArgs({ url: "https://x.example/v", audio_only: true, folder: "~/files/podcasts" }) as string[])[6], "audio");
  assert.ok("error" in (downloadArgs({ url: "file:///etc/passwd" }) as object), "web addresses only");
  assert.ok("error" in (downloadArgs({ url: "javascript:alert(1)" }) as object));
  assert.ok("error" in (downloadArgs({ url: "https://x.example/v", folder: "/etc" }) as object), "into the library only");
  assert.ok("error" in (downloadArgs({ url: "https://x.example/v", folder: "~/files/../.ssh" }) as object));
});

test("frames and silence are read from the script's output", () => {
  const p = parseFrames("FRAME 1.5 /9j/AAA=\nnoise\nFRAME 4.00 /9j/BBB=\nDURATION 8.000000\n");
  assert.deepEqual(p.frames, [{ at: 1.5, data: "/9j/AAA=" }, { at: 4, data: "/9j/BBB=" }]);
  assert.equal(p.duration, 8);
  assert.equal(wavPeak(wav(0.5, 0)), 0);
  assert.ok(wavPeak(wav(0.5, 8000)) > 7000);
  assert.equal(wavPeak(Buffer.from("not a wav")), 0);
});

test("where bots have no Linux computer: the tools are not offered, and refuse if called", async () => {
  setMediaTestHooks({ runner, linux: false, stt });
  calls.length = 0;
  const names = builtinTools().map((t) => t.spec.name);
  for (const n of ["listen_screen", "video_frames", "video_download", "ocr"]) assert.ok(!names.includes(n), `${n} is not offered`);
  for (const t of mediaTools) {
    const out = await t.run(t.spec.name === "video_download" ? { url: "https://x.example/v" } : {}, ctxOf());
    assert.equal(out.isError, true, t.spec.name);
    assert.match(String(out.content), /Linux computer/);
  }
  assert.equal(calls.length, 0, "nothing ran");
});

test("on a Linux computer: offered in the computer family, and switched off with it", () => {
  setMediaTestHooks({ runner, linux: true, stt });
  const all = builtinTools();
  for (const n of ["listen_screen", "video_frames", "video_download", "ocr"]) assert.equal(all.find((t) => t.spec.name === n)?.group, "computer", n);
  assert.ok(!builtinTools({ disabled: ["computer"] }).some((t) => t.spec.name === "ocr"));
});

test("listen_screen: records on the caller's own computer only, skips silence, transcribes with the owner's speech-to-text", async () => {
  setMediaTestHooks({ runner, linux: true, stt });
  calls.length = 0; heard.length = 0; sttKind = "whisper-cpp";
  answer = () => ({ code: 0, raw: wav(2, 9000) });
  const out = await tool("listen_screen").run({ seconds: 2 }, ctxOf());
  assert.ok(!out.isError, String(out.content));
  assert.match(String(out.content), /bonjour à tous/);
  assert.match(String(out.content), /Whisper/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].botId, aliceBot.id); assert.equal(calls[0].userId, alice.id);
  assert.ok(calls[0].maxBytes >= 2 * 32000, "room for the whole recording");
  assert.ok(calls[0].timeoutSec <= 2 + 30, "the wait is bounded by the duration");
  assert.deepEqual(heard.map((h) => h.userId), [alice.id], "the owner's own speech-to-text");

  // Bob's call runs on Bob's computer, never Alice's.
  calls.length = 0;
  await tool("listen_screen").run({ seconds: 1 }, ctxOf(bobBot, bob));
  assert.deepEqual(calls.map((c) => c.botId), [bobBot.id]);

  // Silence: nothing is sent to speech-to-text.
  heard.length = 0;
  answer = () => ({ code: 0, raw: wav(2, 0) });
  const quiet = await tool("listen_screen").run({ seconds: 2 }, ctxOf());
  assert.match(String(quiet.content), /silence/);
  assert.equal(heard.length, 0);

  // An older image without the sound card: its message comes back.
  answer = () => ({ code: 31, stderr: "This computer has no sound card yet: the server's desktop image must be rebuilt" });
  const old = await tool("listen_screen").run({ seconds: 2 }, ctxOf());
  assert.equal(old.isError, true);
  assert.match(String(old.content), /no sound card/);
});

test("listen_screen: no speech-to-text set up → says where to switch it on, records nothing", async () => {
  sttKind = "";
  setMediaTestHooks({ runner, linux: true, stt });
  calls.length = 0;
  const out = await tool("listen_screen").run({ seconds: 5 }, ctxOf());
  assert.equal(out.isError, true);
  assert.match(String(out.content), /Settings → Voice/);
  assert.equal(calls.length, 0);
  sttKind = "whisper-cpp";
});

test("listen_screen: a paid speech-to-text needs allow_paid and the user's yes (asked once, with the cost)", async () => {
  sttKind = "fish";
  setMediaTestHooks({ runner, linux: true, stt });
  heard.length = 0;
  answer = () => ({ code: 0, raw: wav(2, 9000) });
  const t = tool("listen_screen");
  const first = await t.run({ seconds: 60 }, ctxOf());
  assert.match(String(first.content), /paid/);
  assert.equal(heard.length, 0, "nothing paid without a yes");
  const card = t.gate!({ seconds: 60, allow_paid: true }, { botId: aliceBot.id, tainted: false });
  assert.ok(card, "the user is asked");
  assert.match(card!.note ?? "", /Estimated cost/);
  assert.equal(t.gate!({ seconds: 60 }, { botId: aliceBot.id, tainted: false }), null, "no card without allow_paid");
  const paid = await t.run({ seconds: 60, allow_paid: true }, ctxOf());
  assert.match(String(paid.content), /bonjour/);
  assert.ok(paidConsents.has(aliceBot.id, "listening", "fish-stt"), "the yes is remembered for this bot");
  sttKind = "whisper-cpp";
});

test("video_frames: pictures for the model, a bounded call, the right computer", async () => {
  setMediaTestHooks({ runner, linux: true, stt });
  calls.length = 0;
  answer = () => ({ code: 0, stdout: "FRAME 0.0 /9j/AAA=\nFRAME 2.5 /9j/BBB=\nDURATION 5\n" });
  const out = await tool("video_frames").run({ count: 2, watch_seconds: 5 }, ctxOf());
  assert.ok(Array.isArray(out.content));
  const images = (out.content as { type: string; mediaType?: string }[]).filter((b) => b.type === "image");
  assert.equal(images.length, 2);
  assert.equal(images[0].mediaType, "image/jpeg");
  assert.equal(calls[0].botId, aliceBot.id);
  assert.ok(calls[0].timeoutSec <= 90);
  answer = () => ({ code: 21, stderr: "There is no file at /root/files/nope.mp4." });
  const missing = await tool("video_frames").run({ source: "~/files/nope.mp4" }, ctxOf());
  assert.equal(missing.isError, true);
  assert.match(String(missing.content), /no file/);
});

test("video_download: into the library, DRM refused plainly, audited", async () => {
  setMediaTestHooks({ runner, linux: true, stt });
  assert.equal(tool("video_download").audited, true);
  assert.match(tool("video_download").spec.description, /Only when the user asked/);
  assert.match(tool("video_download").spec.description, /DRM/);
  answer = () => ({ code: 0, stdout: "SAVED /root/files/videos/clip [abc].mp4\nSIZE 2097152\n" });
  const ok = await tool("video_download").run({ url: "https://videos.example/abc" }, ctxOf());
  assert.match(String(ok.content), /~\/files\/videos\/clip \[abc\]\.mp4 \(2\.0 MB\)/);
  answer = () => ({ code: 52, stderr: "ERROR: [generic] This video is DRM protected" });
  const drm = await tool("video_download").run({ url: "https://videos.example/drm" }, ctxOf());
  assert.equal(drm.isError, true);
  assert.match(String(drm.content), /protected \(DRM\)/);
  calls.length = 0;
  const bad = await tool("video_download").run({ url: "https://videos.example/abc", folder: "/etc/cron.d" }, ctxOf());
  assert.equal(bad.isError, true);
  assert.equal(calls.length, 0);
});

test("ocr: the text comes back, marked as possibly wrong", async () => {
  setMediaTestHooks({ runner, linux: true, stt });
  answer = () => ({ code: 0, stdout: "Facture n° 42\n\n\n\nTotal : 19,90 €\f" });
  const out = await tool("ocr").run({ source: "screen", x: 0, y: 0, width: 400, height: 200 }, ctxOf());
  assert.match(String(out.content), /may contain mistakes/);
  assert.match(String(out.content), /Facture n° 42\n\nTotal : 19,90 €$/);
  answer = () => ({ code: 40, stderr: "Tesseract (OCR) is not installed on this computer" });
  assert.equal((await tool("ocr").run({}, ctxOf())).isError, true);
});

test("the prompt lists the new abilities, the safe way to sign in, and where the rights stop (API models and engines)", () => {
  for (const extras of [
    { connectorNames: [], browser: true, shell: true, linux: true },
    { connectorNames: [], browser: true, shell: true, linux: true, engine: "claude-code" as const },
    { connectorNames: [], browser: true, shell: true, linux: true, engine: "codex" as const },
  ]) {
    const p = buildSystemPrompt(aliceBot, alice, extras);
    for (const name of ["listen_screen", "video_frames", "video_download", "ocr", "sklubot-install", "vault_list", "Se connecter à un site"]) assert.ok(p.includes(name), `${name} in ${JSON.stringify(extras)}`);
    assert.match(p, /never to get around DRM/);
    assert.match(p, /check vault_list first, without being asked/);
    assert.match(p, /sending, paying, deleting or publishing anything outside still goes through the user's approvals/);
    assert.doesNotMatch(p, /cannot watch the pictures/);
  }
  const plain = buildSystemPrompt(aliceBot, alice, { connectorNames: [], browser: true, shell: true, linux: false });
  assert.doesNotMatch(plain, /listen_screen|sklubot-install/, "no Linux computer: not mentioned");
  assert.match(plain, /cannot watch the pictures/);
  assert.match(linkHint("https://youtu.be/abc", true, true), /video_frames/);
  assert.match(linkHint("https://youtu.be/abc", true), /cannot watch the pictures/);
});
