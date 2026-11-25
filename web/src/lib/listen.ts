/**
 * « Écouter les réponses »: one player for the whole app. A reply is read in the bot's own voice by the server
 * (POST /api/bots/:id/rows/:seq/speak, server/src/voice/speak.ts), part by part: part 0 plays while part 1 is being
 * made, so a long reply starts after one short sentence. Without a server voice (409 no_tts) the browser's own speech
 * reads the same cleaned text (server/src/speechtext.ts), and the player says so.
 *
 *  - One message at a time: starting another stops the current one; a call starting stops it too.
 *  - « Lire les réponses à voix haute » (bot.voice.readAloud): new replies are queued (enqueueReply) and read in turn,
 *    only while the tab is visible and the voices are not muted; typing or sending stops and clears the queue.
 *  - The global mute (« Couper toutes les voix ») is per browser (localStorage), and stops what is playing.
 */
import { create } from "zustand";
import { getLocale, intlTag, isLocale, t } from "../i18n";
import { useStore } from "../store";
import type { Bot } from "../types";
import { speechParts, speechText } from "../../../server/src/speechtext";
import { canSpeak, makeUtterance } from "./speech";

export type ListenStatus = "idle" | "loading" | "playing" | "paused" | "error";
export interface ListenState {
  /** `${botId}:${seq}` of the message being read, or null. */
  key: string | null;
  status: ListenStatus;
  /** 0 → 1 over the whole reply. */
  progress: number;
  engine: "server" | "browser" | null;
  voice: string;
  error: string | null;
  muted: boolean;
}
export interface ListenInput { botId: string; seq: number; text: string; voice: Bot["voice"]; auto?: boolean }

const MUTE_KEY = "sklubot.listen.muted";
const readMuted = () => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } };
export const useListen = create<ListenState>(() => ({ key: null, status: "idle", progress: 0, engine: null, voice: "", error: null, muted: readMuted() }));
export const listenKey = (botId: string, seq: number) => `${botId}:${seq}`;

/** A few silent samples: played inside the click so phones (iOS Safari) let the later, awaited play() through. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

interface Session {
  id: number;
  input: ListenInput;
  parts: number | null;
  part: number;
  urls: Map<number, Promise<string | "browser" | null>>;
  ctrl: AbortController;
  browserParts: string[] | null;
}
let audio: HTMLAudioElement | null = null;
let session: Session | null = null;
let nextId = 1;
let queue: ListenInput[] = [];

const set = (p: Partial<ListenState>) => useListen.setState(p);
const lang = (v: Bot["voice"]) => (v.lang && v.lang !== "auto" ? v.lang : getLocale());

function player(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) { audio = new Audio(); audio.preload = "auto"; }
  return audio;
}
function unlock(): void {
  const a = player();
  if (!a || a.dataset.unlocked) return;
  a.dataset.unlocked = "1";
  a.src = SILENT_WAV;
  void a.play().catch(() => undefined);
}

/** Part `n` as an object URL; "browser" when the server has no voice; null when it failed. */
function fetchPart(s: Session, n: number): Promise<string | "browser" | null> {
  let p = s.urls.get(n);
  if (p) return p;
  p = (async () => {
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(s.input.botId)}/rows/${s.input.seq}/speak`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ part: n }), signal: s.ctrl.signal,
      });
      if (res.status === 409) return "browser";
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        if (session === s && j?.error) set({ error: j.error });
        return null;
      }
      const total = Number(res.headers.get("x-speak-parts"));
      if (Number.isInteger(total) && total > 0) s.parts = total;
      const voice = decodeURIComponent(res.headers.get("x-speak-voice") ?? "");
      if (session === s && voice) set({ voice });
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  })();
  s.urls.set(n, p);
  return p;
}

function release(s: Session): void {
  s.ctrl.abort();
  for (const p of s.urls.values()) void p.then((u) => { if (u && u !== "browser") URL.revokeObjectURL(u); });
}

function finish(s: Session): void {
  if (session !== s) return;
  release(s);
  session = null;
  set({ key: null, status: "idle", progress: 0, engine: null, voice: "", error: null });
  const next = queue.shift();
  if (next) void start(next);
}

function fail(s: Session, message?: string): void {
  if (session !== s) return;
  release(s);
  session = null;
  queue = [];
  set({ status: "error", error: useListen.getState().error ?? message ?? t("listen.failed"), engine: null });
}

async function playServerPart(s: Session, n: number): Promise<void> {
  const url = await fetchPart(s, n);
  if (session !== s) return;
  if (url === "browser") { playBrowser(s); return; }
  if (!url) { fail(s); return; }
  // While this part plays, the next one is being made.
  if (s.parts !== null && n + 1 < s.parts) void fetchPart(s, n + 1);
  const a = player();
  if (!a) { playBrowser(s); return; }
  s.part = n;
  a.onended = () => { if (session !== s) return; if (s.parts !== null && n + 1 < s.parts) void playServerPart(s, n + 1); else finish(s); };
  a.ontimeupdate = () => {
    if (session !== s || !s.parts) return;
    const within = a.duration > 0 && Number.isFinite(a.duration) ? a.currentTime / a.duration : 0;
    set({ progress: Math.min(1, (n + within) / s.parts) });
  };
  a.onerror = () => fail(s);
  a.src = url;
  try {
    await a.play();
    if (session === s && useListen.getState().status !== "paused") set({ status: "playing", engine: "server" });
  } catch {
    fail(s);
  }
}

function playBrowser(s: Session): void {
  if (!canSpeak()) { fail(s, t("listen.unavailable")); return; }
  const parts = s.browserParts ?? speechParts(speechText(s.input.text, lang(s.input.voice)));
  s.browserParts = parts;
  if (!parts.length) { finish(s); return; }
  set({ engine: "browser", status: "playing", voice: "", error: null });
  const synth = window.speechSynthesis;
  synth.cancel();
  const say = (i: number) => {
    if (session !== s) return;
    if (i >= parts.length) { finish(s); return; }
    s.part = i;
    set({ progress: i / parts.length });
    const u = makeUtterance(parts[i], s.input.voice);
    if (!s.input.voice.lang || s.input.voice.lang === "auto") { const l = lang(s.input.voice); u.lang = l === "en" ? "en-US" : isLocale(l) ? intlTag(l) : u.lang; }
    u.onend = () => say(i + 1);
    u.onerror = () => { if (session === s) finish(s); };
    synth.speak(u);
  };
  say(0);
}

async function start(input: ListenInput): Promise<void> {
  if (input.auto && (useListen.getState().muted || document.visibilityState === "hidden" || useStore.getState().call)) return;
  const s: Session = { id: nextId++, input, parts: null, part: 0, urls: new Map(), ctrl: new AbortController(), browserParts: null };
  session = s;
  set({ key: listenKey(input.botId, input.seq), status: "loading", progress: 0, engine: null, voice: "", error: null });
  await playServerPart(s, 0);
}

/** Reads one reply (the 🔊 button): stops whatever was playing, and the auto-read queue. Call it inside the click. */
export function listen(input: ListenInput): void {
  stopListening();
  if (useListen.getState().muted) setMuted(false);
  unlock();
  void start(input);
}

/** « Lire les réponses à voix haute »: a new reply, read after the ones already waiting. */
export function enqueueReply(input: ListenInput): void {
  if (useListen.getState().muted || document.visibilityState === "hidden") return;
  if (session) { queue.push({ ...input, auto: true }); return; }
  void start({ ...input, auto: true });
}

export function pauseListening(): void {
  if (!session || useListen.getState().status !== "playing") return;
  if (useListen.getState().engine === "browser") window.speechSynthesis.pause(); else audio?.pause();
  set({ status: "paused" });
}
export function resumeListening(): void {
  if (!session || useListen.getState().status !== "paused") return;
  if (useListen.getState().engine === "browser") window.speechSynthesis.resume(); else void audio?.play().catch(() => undefined);
  set({ status: "playing" });
}

/** Stops the reading and forgets the queue. */
export function stopListening(): void {
  queue = [];
  const s = session;
  session = null;
  if (s) release(s);
  if (audio) { audio.onended = audio.ontimeupdate = audio.onerror = null; audio.pause(); }
  if (canSpeak() && useListen.getState().engine === "browser") window.speechSynthesis.cancel();
  set({ key: null, status: "idle", progress: 0, engine: null, voice: "", error: null });
}

/** The user types or sends: the automatic reading stops (a reply they asked to hear goes on). */
export function stopAuto(): void {
  queue = [];
  if (session?.input.auto) stopListening();
}

export function setMuted(on: boolean): void {
  try { localStorage.setItem(MUTE_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
  if (on) stopListening();
  set({ muted: on });
}

if (typeof window !== "undefined") {
  // A call takes the speakers: the reading stops.
  useStore.subscribe((s, prev) => { if (s.call && !prev.call) stopListening(); });
  // Hidden tab: what was read automatically stops (a reply the user asked for goes on).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    queue = [];
    if (session?.input.auto) stopListening();
  });
  window.addEventListener("pagehide", () => stopListening());
}
