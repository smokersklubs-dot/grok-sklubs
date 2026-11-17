/**
 * The composer's microphone. Two ways to turn speech into text (the choice: dictationPlan.ts):
 *  - the browser's own recognition (Web Speech API), as before;
 *  - recording the microphone (MediaRecorder: WebM/Opus on Chrome, Firefox and Android, MP4/AAC on Safari and iOS),
 *    decoding it here with Web Audio into a 16 kHz mono WAV, and sending it to the server's speech-to-text
 *    (POST /api/voice/transcribe, server/src/voice/transcribe.ts). Used first when the bot's owner has server voice,
 *    and automatically when the browser has no recognition or its recognition fails ("network" on Brave and many
 *    Android web views, "service-not-allowed" on iOS…). Without either, the user is told where to turn it on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiBlob, enc, errText } from "../api";
import { t } from "../i18n";
import type { VoiceStatus } from "../types";
import { canRecognize, createRecognition, micErrorText, type Recognition } from "./speech";
import { dictationRoute, encodeWav, fallbackError, MAX_RECORD_MS, pickRecorderType, toMono16k } from "./dictationPlan";

type AudioCtor = typeof AudioContext;
const audioCtor = (): AudioCtor | null => (typeof window === "undefined" ? null : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null);

/** The browser can record the microphone and decode the recording. */
export function canRecord(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" && !!audioCtor();
}

/** What the bot owner's server offers (GET /bots/:id/voice), kept a minute per bot. */
const statusCache = new Map<string, { at: number; status: Promise<VoiceStatus | null> }>();
export function botVoiceStatus(botId: string): Promise<VoiceStatus | null> {
  const hit = statusCache.get(botId);
  if (hit && Date.now() - hit.at < 60_000) return hit.status;
  const status = api<{ status: VoiceStatus }>("GET", `/bots/${enc(botId)}/voice`).then((r) => r.status, () => null);
  statusCache.set(botId, { at: Date.now(), status });
  return status;
}

/** The browser's recognition failed in a way recording gets around: remembered for the rest of the visit. */
let browserBroken = false;

class MicError extends Error {}
function micProblem(e: unknown): MicError {
  const name = (e as { name?: string })?.name ?? "";
  return new MicError(name === "NotAllowedError" || name === "SecurityError" ? t("mic.blocked") : name === "NotFoundError" || name === "OverconstrainedError" ? t("mic.none") : t("composer.micFailed"));
}

interface Clip { stop(): Promise<Blob>; cancel(): void }
async function startClip(): Promise<Clip> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (e) {
    throw micProblem(e);
  }
  const type = pickRecorderType((x) => (typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported(x) : false));
  let rec: MediaRecorder;
  try {
    rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((tr) => tr.stop());
    throw new MicError(t("composer.micFailed"));
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach((tr) => tr.stop());
  rec.start(1000);
  return {
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" })); };
      if (rec.state === "inactive") rec.onstop(new Event("stop")); else rec.stop();
    }),
    cancel: () => { rec.onstop = null; try { if (rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ } release(); },
  };
}

/** Any recording the browser made → a 16 kHz mono 16-bit WAV, what the server's speech-to-text takes. */
export async function recordingToWav(blob: Blob): Promise<Blob> {
  const Ctor = audioCtor();
  if (!Ctor) throw new MicError(t("mic.unavailable"));
  const ctx = new Ctor();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return new Blob([encodeWav(toMono16k(channels, audio.sampleRate)) as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

export async function transcribeRecording(botId: string, lang: string, blob: Blob): Promise<string> {
  const wav = await recordingToWav(blob);
  const r = await apiBlob<{ text: string }>(`/voice/transcribe?bot=${enc(botId)}&lang=${enc(lang)}`, wav);
  return (r.text ?? "").trim();
}

export type DictationState = "idle" | "recording" | "transcribing";

/**
 * Dictation for the composer: text is delivered once, when recording stops. `onUnavailable`: neither way works here
 * (the composer shows the message with a button to Settings → Voice).
 */
export function useDictation(botId: string, lang: string, onText: (text: string) => void, onError: (message: string) => void, onUnavailable: () => void) {
  const [state, setState] = useState<DictationState>("idle");
  const rec = useRef<Recognition | null>(null);
  const clip = useRef<Clip | null>(null);
  const starting = useRef<{ stopAsked: boolean; cancelled: boolean } | null>(null);
  const finals = useRef("");
  const cancelled = useRef(false);
  const switching = useRef(false);
  const browserStopped = useRef(false);
  const autoStop = useRef(0);
  const status = useRef<VoiceStatus | null>(null);
  const cb = useRef({ onText, onError, onUnavailable });
  useEffect(() => {
    cb.current = { onText, onError, onUnavailable };
  });
  useEffect(() => {
    status.current = null;
    let dead = false;
    void botVoiceStatus(botId).then((s) => { if (!dead) status.current = s; });
    return () => { dead = true; };
  }, [botId]);

  const route = () => dictationRoute({
    serverMode: status.current?.mode === "server",
    serverDictation: !!status.current?.dictation,
    browser: canRecognize(),
    recorder: canRecord(),
    browserFailed: browserBroken,
  });

  const finishClip = useCallback(async () => {
    const c = clip.current;
    if (!c) return;
    clip.current = null;
    window.clearTimeout(autoStop.current);
    setState("transcribing");
    try {
      const text = await transcribeRecording(botId, lang, await c.stop());
      if (text) cb.current.onText(text);
    } catch (e) {
      cb.current.onError(errText(e));
    } finally {
      setState("idle");
    }
  }, [botId, lang]);

  const startServer = useCallback(async () => {
    const pending = { stopAsked: false, cancelled: false };
    starting.current = pending;
    setState("recording");
    try {
      const c = await startClip();
      starting.current = null;
      if (pending.cancelled) { c.cancel(); setState("idle"); return; }
      clip.current = c;
      autoStop.current = window.setTimeout(() => void finishClip(), MAX_RECORD_MS);
      if (pending.stopAsked) void finishClip();
    } catch (e) {
      starting.current = null;
      setState("idle");
      cb.current.onError(e instanceof Error ? e.message : t("composer.micFailed"));
    }
  }, [finishClip]);

  const startBrowser = useCallback(() => {
    const r = createRecognition(lang);
    if (!r) { browserBroken = true; return false; }
    finals.current = "";
    cancelled.current = false;
    switching.current = false;
    browserStopped.current = false;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals.current = `${finals.current} ${(res[0]?.transcript ?? "").trim()}`.trim();
      }
    };
    r.onerror = (e) => {
      if (fallbackError(e.error)) {
        // The browser's service cannot work here: record and send the audio to the server instead, or say what to do.
        browserBroken = true;
        switching.current = true;
        if (route() !== "server") cb.current.onUnavailable();
        else if (browserStopped.current || cancelled.current) { if (!cancelled.current) cb.current.onError(t("mic.switched")); }
        else void startServer();
        return;
      }
      const message = micErrorText(e.error);
      if (message) cb.current.onError(message);
    };
    r.onend = () => {
      if (rec.current === r) rec.current = null;
      if (switching.current) { switching.current = false; if (!clip.current && !starting.current) setState("idle"); return; }
      setState("idle");
      if (!cancelled.current && finals.current) cb.current.onText(finals.current);
    };
    rec.current = r;
    try {
      r.start();
      setState("recording");
      return true;
    } catch {
      rec.current = null;
      browserBroken = true;
      return false;
    }
  }, [lang, startServer]);

  const start = useCallback(() => {
    if (rec.current || clip.current || starting.current) return;
    const way = route();
    if (way === "browser" && startBrowser()) return;
    if (route() === "server") { void startServer(); return; }
    cb.current.onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startBrowser, startServer]);

  const stop = useCallback(() => {
    if (starting.current) { starting.current.stopAsked = true; return; }
    if (clip.current) { void finishClip(); return; }
    if (!rec.current) return;
    browserStopped.current = true;
    setState("transcribing");
    try {
      rec.current.stop();
    } catch {
      rec.current = null;
      setState("idle");
    }
  }, [finishClip]);

  const cancel = useCallback(() => {
    if (starting.current) { starting.current.cancelled = true; return; }
    if (clip.current) {
      window.clearTimeout(autoStop.current);
      clip.current.cancel();
      clip.current = null;
      setState("idle");
      return;
    }
    if (!rec.current) return;
    cancelled.current = true;
    try {
      rec.current.abort();
    } catch {
      rec.current = null;
      setState("idle");
    }
  }, []);

  useEffect(() => cancel, [cancel]);
  return { state, start, stop, cancel };
}
