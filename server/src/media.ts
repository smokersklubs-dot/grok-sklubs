import { computerKind, workspaceOf } from "./computer.js";
import { linuxExec } from "./linux.js";
import type { BuiltinTool, ToolOutput } from "./agent/tools.js";
import { attemptsText, DEFAULT_MAX_COST_USD, paidGate, ProviderFailure, runChain, servedLine, type Provider } from "./providers.js";
import { tr } from "./i18n.js";
import { clip, type BotRecord } from "./store.js";
import { sttFor, voiceSettings, type Stt } from "./voice/providers.js";
import { completeWav, fishAsrCost } from "./voice/fish.js";

/**
 * Seeing and hearing on the bot's own Linux computer (docs/ORDINATEUR.md): listen to what it plays (listen_screen), look
 * at a video as a few pictures (video_frames), download a video the user asked for (video_download), read the text of
 * the screen or of a picture / PDF (ocr). Everything runs inside the bot's own container (docker exec through linuxExec:
 * no shell on this server, every value passed as an argument "$1", "$2"…), never on this server and never on another
 * bot's computer.
 *
 * Programs used, all in the desktop image (docker/desktop/Dockerfile):
 * - PulseAudio 16.1 (Debian bookworm) with one null sink "sklubot", started by /opt/sklubot/sound.sh: Chromium plays into
 *   it and its monitor source "sklubot.monitor" is recorded with `ffmpeg -f pulse -i sklubot.monitor` (ffmpeg's PulseAudio
 *   input device, https://ffmpeg.org/ffmpeg-devices.html#pulse). The WAV (16 kHz mono) goes to the account's own
 *   speech-to-text (voice/providers.ts sttFor: whisper.cpp, OpenAI or Fish Audio), like `transcribe`.
 * - ffmpeg 5.1 `-f x11grab` (screen frames, https://ffmpeg.org/ffmpeg-devices.html#x11grab), `ffprobe -show_entries
 *   format=duration` and `-ss <t> -frames:v 1` (frames of a file).
 * - yt-dlp 2026.10.26 (official zipimport release, sha256-pinned), options from its README: --no-playlist, --no-progress,
 *   --restrict-filenames, --max-filesize, -f, --merge-output-format, -x --audio-format, --print after_move:filepath.
 *   /etc/yt-dlp.conf adds `--js-runtimes node` (YouTube needs a JavaScript runtime; Node 22 is in the image).
 * - Tesseract 5.3 (`tesseract <image> stdout -l fra+eng`) with the French and English data, ImageMagick `import` and
 *   `convert -crop WxH+X+Y`, poppler `pdftoppm -f N -l N -r 200 -png -singlefile`.
 */

export const LISTEN_MAX_SECONDS = 600;
export const LISTEN_DEFAULT_SECONDS = 30;
export const FRAMES_MAX = 12;
export const FRAMES_DEFAULT = 6;
export const WATCH_MAX_SECONDS = 60;
export const DOWNLOAD_MAX_MB = 20_000; // long videos (e.g. 2–3 h in 1080p); the computer's disk quota still bounds it
export const DOWNLOAD_DEFAULT_MB = 4_000;
/** 16 kHz 16-bit mono: 32 000 bytes a second. */
const WAV_BYTES_PER_SECOND = 32_000;

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const oneLine = (s: string) => !/[\0\n\r]/.test(s);

// ── The scripts (run with bash -c SCRIPT name "$@" on the bot's computer) ──────────────────────────────────────────
const RESOLVE = 'case "$in" in "~/"*) in="/root/${in#"~/"}";; /*) ;; *) in="/root/$in";; esac';

export const LISTEN_SCRIPT = `set -u
secs="$1"
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is missing on this computer." >&2; exit 30; }
[ -x /opt/sklubot/sound.sh ] && /opt/sklubot/sound.sh >/dev/null 2>&1
if ! command -v pactl >/dev/null 2>&1 || ! pactl list short sinks 2>/dev/null | grep -q sklubot; then
  echo "This computer has no sound card yet: the server's desktop image must be rebuilt (npm run computer:build), then the computer restarted (Tidy or sleep/wake)." >&2; exit 31
fi
exec ffmpeg -nostdin -loglevel error -f pulse -i sklubot.monitor -t "$secs" -ac 1 -ar 16000 -c:a pcm_s16le -f wav pipe:1`;

export const FRAMES_SCRIPT = `set -u
src="$1"; count="$2"; from="$3"; to="$4"; width="$5"
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is missing on this computer." >&2; exit 30; }
tmp=$(mktemp -d /tmp/sklubot-frames.XXXXXX); trap 'rm -rf "$tmp"' EXIT
if [ "$src" = screen ]; then
  ffmpeg -nostdin -loglevel error -f x11grab -framerate 4 -i "\${DISPLAY:-:1}" -t "$to" -vf "fps=$count/$to,scale=$width:-2" -frames:v "$count" -q:v 5 "$tmp/f%02d.jpg" || { echo "Could not film the screen." >&2; exit 32; }
  i=0
  for f in "$tmp"/f*.jpg; do
    [ -f "$f" ] || continue
    echo "FRAME $(awk -v i="$i" -v c="$count" -v d="$to" 'BEGIN{printf "%.1f", i*d/c}') $(base64 -w0 "$f")"
    i=$((i+1))
  done
  echo "DURATION $to"
  exit 0
fi
in="$src"; ${RESOLVE}
[ -f "$in" ] || { echo "There is no file at $in." >&2; exit 21; }
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in" 2>/dev/null | head -n 1)
case "$dur" in ""|N/A) echo "Could not read the length of this video (is it a video file?)." >&2; exit 33;; esac
span=$(awk -v f="$from" -v t="$to" -v d="$dur" 'BEGIN{ if (t<=0 || t>d) t=d; if (f<0 || f>=t) f=0; printf "%.3f %.3f", f, t }')
start=\${span% *}; end=\${span#* }
i=0
while [ "$i" -lt "$count" ]; do
  t=$(awk -v s="$start" -v e="$end" -v i="$i" -v c="$count" 'BEGIN{printf "%.2f", s+(i+0.5)*(e-s)/c}')
  if ffmpeg -nostdin -loglevel error -ss "$t" -i "$in" -frames:v 1 -vf "scale=$width:-2" -q:v 5 -y "$tmp/g.jpg" 2>/dev/null && [ -s "$tmp/g.jpg" ]; then
    echo "FRAME $t $(base64 -w0 "$tmp/g.jpg")"
  fi
  rm -f "$tmp/g.jpg"; i=$((i+1))
done
echo "DURATION $dur"`;

export const OCR_SCRIPT = `set -u
src="$1"; lang="$2"; geo="$3"; page="$4"
command -v tesseract >/dev/null 2>&1 || { echo "Tesseract (OCR) is not installed on this computer: the server's desktop image must be rebuilt, or install it: sklubot-install tesseract-ocr tesseract-ocr-fra" >&2; exit 40; }
tmp=$(mktemp -d /tmp/sklubot-ocr.XXXXXX); trap 'rm -rf "$tmp"' EXIT
if [ "$src" = screen ]; then
  import -silent -window root "png:$tmp/a.png" || { echo "Could not capture the screen." >&2; exit 41; }
  if [ -n "$geo" ]; then convert "$tmp/a.png" -crop "$geo" +repage "png:$tmp/a.png" || { echo "That region is not on the screen." >&2; exit 42; }; fi
  convert "$tmp/a.png" -colorspace Gray -resize 200% "png:$tmp/a.png" || exit 42
else
  in="$src"; ${RESOLVE}
  [ -f "$in" ] || { echo "There is no file at $in." >&2; exit 21; }
  ext=$(printf '%s' "\${in##*.}" | tr 'A-Z' 'a-z')
  if [ "$ext" = pdf ]; then
    pdftoppm -f "$page" -l "$page" -r 200 -png -singlefile "$in" "$tmp/a" 2>/dev/null || { echo "Could not read page $page of this PDF." >&2; exit 43; }
  else
    convert "\${in}[0]" "png:$tmp/a.png" 2>/dev/null || { echo "This file is not a picture ImageMagick can read." >&2; exit 43; }
  fi
  [ -n "$geo" ] && { convert "$tmp/a.png" -crop "$geo" +repage "png:$tmp/a.png" || exit 42; }
fi
tesseract "$tmp/a.png" stdout -l "$lang" 2>"$tmp/err" || { tail -c 400 "$tmp/err" >&2; exit 44; }`;

export const DOWNLOAD_SCRIPT = `set -u
url="$1"; max="$2"; mode="$3"; dir="$4"
Y=$(command -v yt-dlp 2>/dev/null || ls /opt/agent-reach/tools/*/bin/yt-dlp 2>/dev/null | head -n 1)
[ -n "$Y" ] || { echo "yt-dlp is not installed on this computer: the server's desktop image must be rebuilt." >&2; exit 50; }
in="$dir"; ${RESOLVE}; dir="$in"
mkdir -p "$dir" || exit 51
if [ "$mode" = audio ]; then
  out=$("$Y" --no-playlist --no-progress --restrict-filenames --max-filesize "\${max}M" -f "ba/b" -x --audio-format mp3 -o "$dir/%(title).80B [%(id)s].%(ext)s" --print after_move:filepath -- "$url") || exit 52
else
  out=$("$Y" --no-playlist --no-progress --restrict-filenames --max-filesize "\${max}M" -f "bv*[height<=?1080]+ba/b[height<=?1080]/b" --merge-output-format mp4 -o "$dir/%(title).80B [%(id)s].%(ext)s" --print after_move:filepath -- "$url") || exit 52
fi
file=$(printf '%s\\n' "$out" | tail -n 1)
[ -n "$file" ] && [ -f "$file" ] || { echo "Nothing was downloaded (the site may refuse it, or the file is over \${max} MB)." >&2; exit 53; }
size=$(wc -c < "$file")
if [ "$size" -gt $((max * 1048576)) ]; then rm -f -- "$file"; echo "The file was over \${max} MB and was removed." >&2; exit 54; fi
echo "SAVED $file"
echo "SIZE $size"`;

// ── Arguments (exported for the tests) ─────────────────────────────────────────────────────────────────────────────
export function listenArgs(a: { seconds?: unknown }): { argv: string[]; seconds: number } {
  const seconds = int(a.seconds, 1, LISTEN_MAX_SECONDS, LISTEN_DEFAULT_SECONDS);
  return { argv: ["bash", "-c", LISTEN_SCRIPT, "listen", String(seconds)], seconds };
}

export function framesArgs(a: { source?: unknown; count?: unknown; from_seconds?: unknown; to_seconds?: unknown; watch_seconds?: unknown }): { argv: string[]; count: number } | { error: string } {
  const source = String(a.source ?? "screen").trim() || "screen";
  if (!oneLine(source)) return { error: "A path must be one line." };
  const count = int(a.count, 1, FRAMES_MAX, FRAMES_DEFAULT);
  const width = "768";
  if (source === "screen") {
    const watch = int(a.watch_seconds, 1, WATCH_MAX_SECONDS, 10);
    return { argv: ["bash", "-c", FRAMES_SCRIPT, "frames", "screen", String(count), "0", String(watch), width], count };
  }
  const from = Math.max(0, Number(a.from_seconds) || 0);
  const to = Math.max(0, Number(a.to_seconds) || 0);
  return { argv: ["bash", "-c", FRAMES_SCRIPT, "frames", source, String(count), String(from), String(to), width], count };
}

const LANG_RE = /^[a-z]{3}(_[a-z]+)?(\+[a-z]{3}(_[a-z]+)?){0,4}$/;
export function ocrArgs(a: { source?: unknown; lang?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown; page?: unknown }): string[] | { error: string } {
  const source = String(a.source ?? "screen").trim() || "screen";
  if (!oneLine(source)) return { error: "A path must be one line." };
  const lang = String(a.lang ?? "fra+eng").trim().toLowerCase() || "fra+eng";
  if (!LANG_RE.test(lang)) return { error: `Unknown language list "${clip(lang, 40)}". Use Tesseract codes joined with +, e.g. fra+eng.` };
  let geo = "";
  if (a.width !== undefined || a.height !== undefined) {
    const n = (v: unknown) => Math.floor(Number(v));
    const [x, y, w, h] = [n(a.x ?? 0), n(a.y ?? 0), n(a.width), n(a.height)];
    if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 8 || h < 8 || x + w > 8000 || y + h > 8000) return { error: "Give a region with x, y ≥ 0 and width, height of at least 8 pixels." };
    geo = `${w}x${h}+${x}+${y}`;
  }
  const page = int(a.page, 1, 10_000, 1);
  return ["bash", "-c", OCR_SCRIPT, "ocr", source, lang, geo, String(page)];
}

export function downloadArgs(a: { url?: unknown; max_mb?: unknown; audio_only?: unknown; folder?: unknown }): string[] | { error: string } {
  const url = String(a.url ?? "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return { error: "Give the video's full http(s) address." };
  try { new URL(url); } catch { return { error: "That is not a valid address." }; }
  const max = int(a.max_mb, 1, DOWNLOAD_MAX_MB, DOWNLOAD_DEFAULT_MB);
  const folder = String(a.folder ?? "~/files/videos").trim() || "~/files/videos";
  // Into the library only (the user sees and downloads what is there), never outside it.
  if (!oneLine(folder) || folder.split("/").includes("..") || !/^(~\/files|\/root\/files|files)(\/|$)/.test(folder)) return { error: "The folder must be inside ~/files (your library), e.g. ~/files/videos." };
  return ["bash", "-c", DOWNLOAD_SCRIPT, "download", url, String(max), a.audio_only === true ? "audio" : "video", folder];
}

/** "FRAME <t> <base64>" lines and "DURATION <s>" from FRAMES_SCRIPT. */
export function parseFrames(stdout: string): { frames: { at: number; data: string }[]; duration: number | null } {
  const frames: { at: number; data: string }[] = [];
  for (const m of stdout.matchAll(/^FRAME ([\d.]+) ([A-Za-z0-9+/=]+)$/gm)) frames.push({ at: Number(m[1]), data: m[2] });
  const d = /^DURATION ([\d.]+)/m.exec(stdout);
  return { frames, duration: d ? Number(d[1]) : null };
}

/** The loudest sample of a 16-bit PCM WAV (0 when it is silent or not a WAV): silence is not sent to speech-to-text. */
export function wavPeak(wav: Buffer): number {
  const at = wav.indexOf("data", 12, "latin1");
  if (at < 0) return 0;
  let peak = 0;
  for (let i = at + 8; i + 1 < wav.length; i += 2) { const v = Math.abs(wav.readInt16LE(i)); if (v > peak) peak = v; }
  return peak;
}
/** Below this peak (about -56 dBFS) a recording is treated as silence. */
export const SILENCE_PEAK = 50;

// ── What runs it (replaceable in tests) ────────────────────────────────────────────────────────────────────────────
type Run = { code: number | null; stdout: string; raw: Buffer; stderr: string; timedOut: boolean };
type Runner = (botId: string, userId: string, argv: string[], timeoutSec: number, maxBytes: number, signal?: AbortSignal) => Promise<Run>;
const realRunner: Runner = (botId, userId, argv, timeoutSec, maxBytes, signal) => linuxExec(botId, userId, workspaceOf(botId), argv, timeoutSec, { signal, maxBytes });
let runner: Runner = realRunner;
let linuxHere = () => computerKind() === "linux";
type SttSource = (userId: string, lang?: string) => { kind: string; stt: Stt } | null;
const realStt: SttSource = (userId, lang) => { const stt = sttFor(userId, lang); return stt ? { kind: voiceSettings(userId).stt.provider, stt } : null; };
let sttSource: SttSource = realStt;
/** For tests: replace what runs on the bot's computer, whether there are Linux computers, and the speech-to-text (null: the real ones). */
export function setMediaTestHooks(h: { runner?: Runner | null; linux?: boolean | null; stt?: SttSource | null } | null) {
  runner = h?.runner ?? realRunner;
  linuxHere = h?.linux === undefined || h?.linux === null ? () => computerKind() === "linux" : () => !!h.linux;
  sttSource = h?.stt ?? realStt;
}

/** These tools exist only where every bot has its own Linux computer. */
export const mediaAvailable = () => linuxHere();
const NO_COMPUTER = "This needs your own Linux computer, which this server does not give its bots (COMPUTER=linux).";

// ── Listening: the providers that turn the recording into text ────────────────────────────────────────────────────
interface ListenArgs { seconds: number; lang?: string; take: string }
/** The account's speech-to-text, as a chain step: whisper.cpp on the user's own server is free, OpenAI and Fish Audio are paid. */
export function listenProviders(wav: Buffer | null): Provider<ListenArgs, string>[] {
  const nothing = (t: string) => !t.trim();
  const kind = (userId: string) => sttSource(userId)?.kind ?? "";
  const run = async (a: ListenArgs, c: { bot: BotRecord; signal?: AbortSignal }) => {
    const s = sttSource(c.bot.userId, a.lang);
    if (!s || !wav) throw new ProviderFailure("speech-to-text is not set up");
    const limit = AbortSignal.timeout(Math.max(120, a.seconds * 2) * 1000);
    return s.stt(wav, c.signal ? AbortSignal.any([c.signal, limit]) : limit);
  };
  return [
    { id: "whisper", label: "Whisper (ton serveur)", tier: "owned", estimateUsd: () => 0, empty: nothing, available: (c) => kind(c.bot.userId) === "whisper-cpp", run },
    // OpenAI bills per minute of audio, at the price of the model the user chose: not known here, so the user is asked (as transcribe).
    { id: "openai-stt", label: "OpenAI (transcription)", tier: "paid", empty: nothing, estimateUsd: () => null, available: (c) => kind(c.bot.userId) === "openai", run },
    // Fish Audio's price is written to the account's usage by sttFor itself: nothing more is settled here.
    { id: "fish-stt", label: "Fish Audio (transcription)", tier: "paid", empty: nothing, estimateUsd: (a) => fishAsrCost(a.seconds), actualUsd: () => 0, available: (c) => kind(c.bot.userId) === "fish", run },
  ];
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "integer", description });
const home = (p: string) => p.replace(/^\/root\//, "~/");
const failed = (r: Run, what: string, seconds: number) => r.timedOut ? `${what} took longer than ${seconds} s and was stopped.` : clip(r.stderr.trim() || `${what} failed (exit ${r.code}).`, 800);

export const mediaTools: BuiltinTool[] = [
  {
    spec: {
      name: "listen_screen",
      description: `Listen to what your computer is playing (a video or a call in your browser…) for a number of seconds and get it as text. Start the video first (browser_open, then play it), then call this; nobody else hears it. At most ${LISTEN_MAX_SECONDS} s per call (default ${LISTEN_DEFAULT_SECONDS}); you wait while it records. The text comes from the user's own speech-to-text (free on their own Whisper; OpenAI or Fish Audio are paid: allowed only with allow_paid and the user's yes). For a video with an address, transcribe is usually quicker.`,
      inputSchema: { type: "object", properties: { seconds: num(`How long to listen, 1 to ${LISTEN_MAX_SECONDS} s (default ${LISTEN_DEFAULT_SECONDS})`), lang: str("Spoken language if known, e.g. fr or en"), allow_paid: { type: "boolean", description: "Allow a paid speech-to-text (the user is asked once for this bot, with the cost)" }, max_cost_usd: { type: "number", description: "Most this call may cost, in USD (default 1)" } }, required: [] },
    },
    activity: "computer", label: "Listening to the computer", group: "computer", outside: true, detail: (a) => `${int(a.seconds, 1, LISTEN_MAX_SECONDS, LISTEN_DEFAULT_SECONDS)} s`,
    gate: (a, ctx) => paidGate("listening", "listening to the computer", listenProviders(null), { seconds: int(a.seconds, 1, LISTEN_MAX_SECONDS, LISTEN_DEFAULT_SECONDS), take: "" }, ctx.botId, !!a.allow_paid),
    run: async (a, c): Promise<ToolOutput> => {
      if (!linuxHere()) return { content: NO_COMPUTER, isError: true, summary: "no computer" };
      if (!sttSource(c.user.id)) return { content: "No speech-to-text is set up for this account, so you cannot listen. Ask the user to switch one on in Settings → Voice (their own Whisper server is free).", isError: true, summary: tr(c.user.locale, "no speech-to-text") };
      const { argv, seconds } = listenArgs(a);
      const r = await runner(c.bot.id, c.user.id, argv, seconds + 30, seconds * WAV_BYTES_PER_SECOND + 256_000, c.signal);
      if (r.code !== 0 || r.raw.length < 100) return { content: failed(r, "Recording", seconds + 30), isError: true, summary: tr(c.user.locale, "not recorded") };
      const wav = completeWav(r.raw, 16000);
      if (wavPeak(wav) < SILENCE_PEAK) return { content: `Recorded ${seconds} s: only silence. Is the video playing, with its sound on (not muted in the page)? Check with screen_view.`, summary: tr(c.user.locale, "silence") };
      const lang = typeof a.lang === "string" ? a.lang.slice(0, 12) : undefined;
      const opts = { allowPaid: !!a.allow_paid, maxCostUsd: Number(a.max_cost_usd) > 0 ? Math.min(50, Number(a.max_cost_usd)) : DEFAULT_MAX_COST_USD };
      const o = await runChain("listening", listenProviders(wav), { seconds, lang, take: `${Date.now()}` }, { bot: c.bot, signal: c.signal }, opts);
      const line = servedLine(c.user.locale, o);
      if (o.refusal) return { content: `${o.refusal}\n${attemptsText(o)}`, isError: true, summary: line };
      if (o.needsConsent) return { content: `The user's speech-to-text is paid: ${o.needsConsent.label}${o.needsConsent.estimateUsd === null ? "" : ` (about ${o.needsConsent.estimateUsd.toFixed(2)} $ for ${seconds} s)`}. Ask the user, or call listen_screen again with allow_paid: true (they will be asked once for you).\n${attemptsText(o)}`, summary: line };
      if (!o.result) return { content: `Recorded ${seconds} s, but no words came out.\n${attemptsText(o)}`, isError: !o.attempts.some((x) => x.outcome === "empty"), summary: line };
      return { content: `What your computer played during ${seconds} s (transcribed):\n${clip(o.result.trim(), 60_000)}\n\n${attemptsText(o)}`, summary: line };
    },
  },
  {
    spec: {
      name: "video_frames",
      description: `See a video as pictures: up to ${FRAMES_MAX} frames, spread evenly, shown to you so you can describe what it shows. source "screen" (default) films your screen for watch_seconds (at most ${WATCH_MAX_SECONDS}) while a video plays there; or give the path of a video file on your computer (e.g. one from video_download) and optionally a part of it with from_seconds / to_seconds. Combine with listen_screen or transcribe for the sound.`,
      inputSchema: { type: "object", properties: { source: str('"screen" (default) or the path of a video file, e.g. ~/files/videos/clip.mp4'), count: num(`How many frames, 1 to ${FRAMES_MAX} (default ${FRAMES_DEFAULT})`), watch_seconds: num(`Screen only: how long to watch, 1 to ${WATCH_MAX_SECONDS} s (default 10)`), from_seconds: num("File only: start of the part to look at (default the start)"), to_seconds: num("File only: end of the part to look at (default the end)") }, required: [] },
    },
    activity: "computer", label: "Watching a video", group: "computer", detail: (a) => String(a.source ?? "screen").split("/").pop(),
    run: async (a, c): Promise<ToolOutput> => {
      if (!linuxHere()) return { content: NO_COMPUTER, isError: true, summary: "no computer" };
      const args = framesArgs(a);
      if ("error" in args) return { content: args.error, isError: true, summary: tr(c.user.locale, "not done") };
      const timeout = String(a.source ?? "screen") === "screen" ? WATCH_MAX_SECONDS + 30 : 180;
      const r = await runner(c.bot.id, c.user.id, args.argv, timeout, 12_000_000, c.signal);
      if (r.code !== 0) return { content: failed(r, "Taking the frames", timeout), isError: true, summary: tr(c.user.locale, "not done") };
      const { frames, duration } = parseFrames(r.stdout);
      if (!frames.length) return { content: "No frame could be taken.", isError: true, summary: tr(c.user.locale, "not done") };
      const fromScreen = (String(a.source ?? "screen").trim() || "screen") === "screen";
      const head = fromScreen ? `${frames.length} frames of your screen over ${duration ?? "?"} s (time from the start of the watch):` : `${frames.length} frames of ${String(a.source)} (${duration ? `${Math.round(duration)} s long` : "length unknown"}), with their time in the video:`;
      return {
        content: [{ type: "text", text: head }, ...frames.flatMap((f) => [{ type: "text" as const, text: `At ${f.at} s:` }, { type: "image" as const, mediaType: "image/jpeg" as const, data: f.data }])],
        summary: `${frames.length} · ${fromScreen ? tr(c.user.locale, "screen") : String(a.source).split("/").pop()}`,
        ...(fromScreen ? { outside: true } : {}),
      };
    },
  },
  {
    spec: {
      name: "video_download",
      description: `Download a video (or only its sound, audio_only) from a video site into your library with yt-dlp, to watch it with video_frames, listen to it, or hand it to the user. Only when the user asked for it, for content they may keep (their own, free to download, or allowed by the site's terms). Never to get around DRM, a paywall or a login you were not given: protected videos are refused. One video, no playlists; at most max_mb (default ${DOWNLOAD_DEFAULT_MB}, up to ${DOWNLOAD_MAX_MB}); 1080p at most.`,
      inputSchema: { type: "object", properties: { url: str("Address of the video page"), audio_only: { type: "boolean", description: "Only the sound, as MP3" }, max_mb: num(`Size limit in MB (default ${DOWNLOAD_DEFAULT_MB}, at most ${DOWNLOAD_MAX_MB})`), folder: str("Folder inside ~/files (default ~/files/videos)") }, required: ["url"] },
    },
    activity: "saving", label: "Downloading a video", group: "computer", audited: true, outside: true, detail: (a) => { try { return new URL(String(a.url)).hostname.replace(/^www\./, ""); } catch { return undefined; } },
    run: async (a, c): Promise<ToolOutput> => {
      if (!linuxHere()) return { content: NO_COMPUTER, isError: true, summary: "no computer" };
      const argv = downloadArgs(a);
      if (!Array.isArray(argv)) return { content: argv.error, isError: true, summary: tr(c.user.locale, "not downloaded") };
      const r = await runner(c.bot.id, c.user.id, argv, 900, 400_000, c.signal);
      if (r.code !== 0) {
        const drm = /drm/i.test(r.stderr);
        return { content: drm ? "This video is protected (DRM): it cannot be downloaded. Watch it in the browser instead (video_frames on the screen, listen_screen)." : `${failed(r, "The download", 900)}${r.timedOut ? " Start it with shell_run as a background job for very long videos." : ""}`, isError: true, summary: tr(c.user.locale, "not downloaded") };
      }
      const saved = /^SAVED (.+)$/m.exec(r.stdout)?.[1] ?? "";
      const size = Number(/^SIZE (\d+)$/m.exec(r.stdout)?.[1] ?? 0);
      return { content: `Downloaded. Saved as ${home(saved)} (${(size / 1048576).toFixed(1)} MB). The user can open it in your library; file_send shows it in the chat.`, summary: home(saved).split("/").pop() };
    },
  },
  {
    spec: {
      name: "ocr",
      description: "Read the text in a picture with OCR (Tesseract, French and English by default): your screen (default; optionally a region x, y, width, height in screenshot pixels), or a picture or a PDF page on your computer. Useful for text page_read cannot get: pictures, videos, scanned PDFs, other windows, canvases.",
      inputSchema: { type: "object", properties: { source: str('"screen" (default) or the path of a picture or a PDF, e.g. ~/files/scan.pdf'), lang: str("Tesseract languages joined with +, default fra+eng"), x: num("Region: pixels from the left"), y: num("Region: pixels from the top"), width: num("Region: width in pixels"), height: num("Region: height in pixels"), page: num("PDF: page number, from 1 (default 1)") }, required: [] },
    },
    activity: "reading", label: "Reading text with OCR", group: "computer", outside: true, detail: (a) => String(a.source ?? "screen").split("/").pop(),
    run: async (a, c): Promise<ToolOutput> => {
      if (!linuxHere()) return { content: NO_COMPUTER, isError: true, summary: "no computer" };
      const argv = ocrArgs(a);
      if (!Array.isArray(argv)) return { content: argv.error, isError: true, summary: tr(c.user.locale, "not done") };
      const r = await runner(c.bot.id, c.user.id, argv, 120, 2_000_000, c.signal);
      if (r.code !== 0) return { content: failed(r, "OCR", 120), isError: true, summary: tr(c.user.locale, "not done") };
      const text = r.stdout.replace(/\f/g, "").replace(/\n{3,}/g, "\n\n").trim();
      return { content: text ? `Text read (OCR, may contain mistakes):\n${clip(text, 40_000)}` : "No text was found there.", summary: `${text.length} ${tr(c.user.locale, "characters")}` };
    },
  },
];
