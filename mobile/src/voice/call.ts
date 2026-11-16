/**
 * Voice calls in the app, like the web (web/src/lib/call.ts): through the server's voice services when the bot's owner
 * has them (GET /bots/:id/voice → mode "server"), otherwise with the phone's own speech recognition and text-to-speech.
 * The native side (modules/sklubot-voice) captures, plays, routes the audio and keeps a foreground service of type
 * "microphone" while the call lasts, so it goes on with the screen locked.
 */
import { Linking, PermissionsAndroid, Platform } from "react-native";
import { create } from "zustand";
import type { Row } from "../api/types";
import { errText, getLocale, t } from "../i18n";
import { useStore } from "../state/store";
import { DeviceCall } from "./deviceCall";
import { voiceNative } from "./native";
import { ServerCall, type CallPatch, type CallStatus, type WsLike } from "./serverCall";
import { recognitionLang, type CallLine } from "./text";

export interface CallState {
  botId: string;
  status: CallStatus;
  error: string | null;
  /** The microphone is blocked for good: the error offers the phone's settings. */
  blocked: boolean;
  muted: boolean;
  speaker: boolean;
  speaking: boolean;
  listening: boolean;
  hearing: boolean;
  lines: CallLine[];
  pipeline: "server" | "device" | null;
  providers: string;
  startedAt: number | null;
  bargedAt: number | null;
  /** Shown under the controls (focus lost to a phone call…). */
  note: string | null;
}

export const useCall = create<{ call: CallState | null }>(() => ({ call: null }));

export const callsAvailable = Platform.OS === "android" && !!voiceNative;

let session: ServerCall | DeviceCall | null = null;
let subs: { remove(): void }[] = [];

const get = () => useCall.getState().call;
function patch(p: Partial<CallState>) { useCall.setState((s) => (s.call ? { call: { ...s.call, ...p } } : {})); }
function lines(fn: (l: CallLine[]) => CallLine[]) { useCall.setState((s) => (s.call ? { call: { ...s.call, lines: fn(s.call.lines) } } : {})); }
const fromSession = (p: CallPatch) => patch(p as Partial<CallState>);

function fail(message: string, blocked = false) {
  stopSession();
  try { voiceNative?.end(); } catch { /* already ended */ }
  patch({ status: "error", error: message, blocked, listening: false, speaking: false, hearing: false });
}

function stopSession() {
  const s = session;
  session = null;
  s?.stop();
  for (const sub of subs) sub.remove();
  subs = [];
}

/** RECORD_AUDIO at the first call (https://reactnative.dev/docs/permissionsandroid). */
async function micPermission(): Promise<"granted" | "denied" | "blocked"> {
  const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(perm)) return "granted";
  const r = await PermissionsAndroid.request(perm);
  return r === PermissionsAndroid.RESULTS.GRANTED ? "granted" : r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
}

function wsUrl(origin: string, botId: string): string {
  return `${origin.replace(/^http/, "ws")}/api/voice/${encodeURIComponent(botId)}`;
}

export async function startCall(botId: string): Promise<void> {
  const store = useStore.getState();
  const bot = store.bots[botId];
  if (!bot) return;
  endCall();
  useCall.setState({ call: { botId, status: "connecting", error: null, blocked: false, muted: false, speaker: true, speaking: false, listening: false, hearing: false, lines: [], pipeline: null, providers: "", startedAt: null, bargedAt: null, note: null } });
  const native = voiceNative;
  if (!native || Platform.OS !== "android") { fail(t("call.unavailable")); return; }
  const mic = await micPermission().catch(() => "denied" as const);
  if (get()?.botId !== botId) return;
  if (mic !== "granted") { fail(t(mic === "blocked" ? "call.micBlocked" : "call.micDenied"), mic === "blocked"); return; }
  void store.loadRows(botId);
  let mode: "server" | "browser" = "browser";
  try { mode = (await store.call<{ status: { mode: "server" | "browser" } }>("GET", `/bots/${encodeURIComponent(botId)}/voice`)).status.mode; } catch { /* the phone's speech then */ }
  if (get()?.botId !== botId) return;
  try {
    native.begin(true, t("call.title", { name: bot.name }), t("call.connecting"), t("call.hangUp"));
  } catch (e) { fail(errText(e)); return; }
  subs.push(native.addListener("onHangUp", () => endCall()));
  subs.push(native.addListener("onFocus", ({ state }) => {
    // A phone call (or another app) took the audio: the microphone is muted until the user unmutes.
    if (state !== "gain" && get() && !get()!.muted) { setMuted(true); patch({ note: t("call.focusLost") }); }
  }));
  subs.push(native.addListener("onError", ({ where }) => { if (where === "capture") fail(t("call.ended")); }));
  if (mode === "server") startServer(botId);
  else startDevice(botId);
}

function startServer(botId: string) {
  const native = voiceNative!;
  const { client, origin, bots } = useStore.getState();
  if (!client || !origin) { fail(t("api.unreachable")); return; }
  patch({ pipeline: "server" });
  const s = new ServerCall({
    // React Native's WebSocket: (url, protocols, { headers }) — the session cookie goes in the headers.
    connect: () => new (WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => WsLike)(wsUrl(origin, botId), undefined, { headers: client.authHeaders() }),
    audio: {
      startCapture: () => native.startCapture(),
      stopCapture: () => native.stopCapture(),
      play: (id, b64) => native.play(id, b64),
      stopPlayback: () => native.stopPlayback(),
      setVolume: (v) => native.setVolume(v),
      onPcm: (fn) => { const sub = native.addListener("onPcm", (e) => fn(e.data, e.level)); return () => sub.remove(); },
      onPlayed: (fn) => { const sub = native.addListener("onPlayed", (e) => fn(e.id)); return () => sub.remove(); },
    },
    lang: recognitionLang(bots[botId]?.voice, getLocale()),
    patch: (p) => { fromSession(p); if (p.status === "live" && !get()?.startedAt) patch({ startedAt: Date.now() }); },
    lines,
    toast: (m) => patch({ note: m }),
    muted: () => !!get()?.muted,
    failed: (reason) => {
      session = null;
      if (reason === "unavailable" && voiceNative?.recognitionAvailable()) { startDevice(botId); return; }
      if (reason === "session") { fail(t("api.unreachable")); return; }
      fail(t(reason === "unavailable" ? "call.serverUnavailable" : "call.ended"));
    },
  });
  session = s;
  if (!s.start()) { session = null; fail(t("call.ended")); }
}

function startDevice(botId: string) {
  const native = voiceNative!;
  if (!native.recognitionAvailable()) { fail(t("call.noSpeech")); return; }
  const bot = useStore.getState().bots[botId];
  patch({ pipeline: "device", status: "connecting" });
  const enc = encodeURIComponent(botId);
  const d = new DeviceCall({
    speech: {
      listen: (lang) => native.listen(lang),
      stopListening: () => native.stopListening(),
      speak: (id, text, lang, rate) => native.speak(id, text, lang, rate),
      stopSpeaking: () => native.stopSpeaking(),
      onSpeech: (fn) => { const sub = native.addListener("onSpeech", (e) => fn(e.type, e.text, e.code)); return () => sub.remove(); },
      onTts: (fn) => { const sub = native.addListener("onTts", (e) => fn(e.type, e.id)); return () => sub.remove(); },
    },
    lang: recognitionLang(bot?.voice, getLocale()),
    rate: bot?.voice?.rate && bot.voice.rate > 0 ? bot.voice.rate : 1,
    patch: fromSession,
    lines,
    getLines: () => get()?.lines ?? [],
    toast: (m) => patch({ note: m }),
    failed: (reason) => { session = null; fail(t(reason === "micBlocked" ? "call.micBlocked" : "call.noSpeech"), reason === "micBlocked"); },
    muted: () => !!get()?.muted,
    sendMessage: async (text) => {
      const s = useStore.getState();
      const r = await s.call<{ row: Row }>("POST", `/bots/${enc}/messages`, { text, origin: "voice" });
      void s.loadRows(botId, true);
      return r.row;
    },
    thread: () => useStore.getState().threads[botId],
    subscribe: (fn) => useStore.subscribe(fn),
    startRecord: async () => (await useStore.getState().call<{ callId: string }>("POST", `/bots/${enc}/calls`)).callId,
    endRecord: (callId, transcript) => useStore.getState().call("POST", `/bots/${enc}/calls/${encodeURIComponent(callId)}/end`, { transcript }),
    sendFailed: (e) => patch({ note: t("call.sendFailed", { error: errText(e) }) }),
  });
  session = d;
  d.start();
}

export function setMuted(muted: boolean) {
  if (!get()) return;
  patch({ muted, note: muted ? get()!.note : null });
  session?.mute(muted);
}

export function setSpeaker(on: boolean) {
  if (!get()) return;
  try { voiceNative?.setSpeaker(on); patch({ speaker: on }); } catch { /* routing unavailable */ }
}

export function bargeIn() {
  session?.bargeIn();
  patch({ bargedAt: Date.now() });
}

export function endCall() {
  stopSession();
  try { voiceNative?.end(); } catch { /* not started */ }
  if (get()) useCall.setState({ call: null });
}

/** The microphone was refused for good: only the phone's settings can allow it again. */
export function openMicSettings() { void Linking.openSettings(); }
