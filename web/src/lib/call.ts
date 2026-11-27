/**
 * Browser-only voice calls: continuous speech recognition → each final utterance is sent as a
 * voice-origin message → the bot's next finished replies are read aloud with speech synthesis.
 */
import { api, ApiError } from "../api";
import { createOutbox, resultOf, type OutboxItem } from "./calloutbox";
import { t } from "../i18n";
import { useStore, type CallLine, type CallState, type Thread } from "../store";
import type { Row } from "../types";
import { voiceStarted, voiceStopped, voiceWord } from "./voiceLevel";
import { canCall, createRecognition, makeUtterance, micErrorText, recognitionLang, speakable, type Recognition } from "./speech";
import { fallbackError } from "./dictationPlan";
import { dropPrimedAudio, endServerCall, primeCallAudio, serverBargeIn, serverCallActive, serverMute, startServerCall } from "./voice";
import type { VoiceStatus } from "../types";

let rec: Recognition | null = null;
let recRunning = false;
let restartTimer: number | undefined;
let unsubscribe: (() => void) | null = null;
let spokenUpTo: number | null = null; // speak assistant messages with seq above this
let generation = -1;
let lastThread: Thread | undefined;
let queue: string[] = [];
let speakingNow = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let lineId = 0;

/* ---------- Call trace: the server keeps a "call started / call ended" record with the captions ---------- */

interface Trace { botId: string; callId: string | null; ended: boolean; lines: { role: "user" | "assistant"; text: string }[] | null }
let trace: Trace | null = null;
const MAX_TRACE_LINES = 200;

/** The captions said so far: final lines only, the last 200. */
function captionLines(): { role: "user" | "assistant"; text: string }[] {
  const lines = getCall()?.lines ?? [];
  return lines.filter((l) => l.final && l.text.trim()).slice(-MAX_TRACE_LINES).map((l) => ({ role: l.role, text: l.text }));
}

function beginTrace(botId: string): void {
  const mine: Trace = { botId, callId: null, ended: false, lines: null };
  trace = mine;
  api<{ callId: string }>("POST", `/bots/${botId}/calls`).then(
    (r) => {
      mine.callId = r.callId;
      // The call ended before the server answered: close the record now.
      if (mine.ended) sendEnd(mine, false);
    },
    () => undefined, // the call itself still works without its record
  );
}

/* ---------- L154 outbox: nothing said in a call is lost when the network drops (calloutbox.ts) ---------- */

const outbox = createOutbox({
  storage: () => (typeof window !== "undefined" ? window.localStorage : null),
  send: async (item: OutboxItem) => {
    try {
      const r = await api<{ row?: Row }>("POST", item.path, item.body);
      if (item.kind === "utterance" && r?.row) utteranceSaved(item.path.split("/")[2] ?? "", r.row);
      return "ok";
    } catch (e) {
      return resultOf(e instanceof ApiError ? e.status : 0);
    }
  },
});
let outboxTimer: number | undefined;
function flushOutbox(): void {
  void outbox.flush().then(() => {
    window.clearTimeout(outboxTimer);
    if (outbox.pending().length) outboxTimer = window.setTimeout(flushOutbox, 15_000);
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("online", flushOutbox);
  window.setTimeout(flushOutbox, 3000); // what an earlier page could not send
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

function sendEnd(tr: Trace, beacon: boolean): void {
  if (!tr.callId) return;
  const path = `/bots/${tr.botId}/calls/${tr.callId}/end`;
  const body = { transcript: tr.lines ?? [] };
  const item = { id: `end:${tr.callId}`, path, body, kind: "end" as const };
  if (beacon) {
    // The page is going away: kept in the outbox too (sent again at the next load; the server answers « duplicate »).
    outbox.queue(item);
    if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(`/api${path}`, new Blob([JSON.stringify(body)], { type: "application/json" }));
    return;
  }
  void outbox.send(item).then((r) => { if (r === "retry") flushLater(); });
}
const flushLater = () => { window.clearTimeout(outboxTimer); outboxTimer = window.setTimeout(flushOutbox, 15_000); };

/** Close the server's record of the current call, once. `beacon` is for when the page is going away. */
function endTrace(beacon = false): void {
  const tr = trace;
  if (!tr || tr.ended) return;
  tr.ended = true;
  tr.lines = captionLines();
  trace = null;
  sendEnd(tr, beacon);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => endTrace(true));
}

const getCall = (): CallState | null => useStore.getState().call;
function patch(p: Partial<CallState>): void {
  useStore.setState((s) => (s.call ? { call: { ...s.call, ...p } } : {}));
}
function setLines(fn: (lines: CallLine[]) => CallLine[]): void {
  useStore.setState((s) => (s.call ? { call: { ...s.call, lines: fn(s.call.lines) } } : {}));
}

function shouldListen(): boolean {
  const c = getCall();
  return !!c && c.status !== "error" && !c.muted && !speakingNow;
}

function startListening(): void {
  window.clearTimeout(restartTimer);
  if (!rec || recRunning || !shouldListen()) return;
  try {
    rec.start();
    recRunning = true;
  } catch {
    restartTimer = window.setTimeout(startListening, 400);
  }
}

function stopListening(): void {
  window.clearTimeout(restartTimer);
  if (rec && recRunning) {
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  }
}

/** `voiceSettings`: the browser's speech cannot work here; the call bar offers Settings → Voice (server voice). */
function fail(message: string, voiceSettings = false): void {
  queue = [];
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  endTrace();
  patch({ status: "error", error: message, listening: false, speaking: false, voiceSettings });
  stopListening();
}

function utteranceSaved(botId: string, row: Row): void {
  useStore.getState().addRows(botId, [row]);
  if (getCall()?.botId === botId && spokenUpTo === null) spokenUpTo = row.seq;
}

async function sendUtterance(botId: string, text: string): Promise<void> {
  const key = newKey();
  const item = { id: `say:${key}`, path: `/bots/${botId}/messages`, body: { text, origin: "voice", clientKey: key }, kind: "utterance" as const };
  // Something said earlier still waits: this one goes after it, in order.
  if (outbox.pending().length) { outbox.queue(item); flushOutbox(); return; }
  const r = await outbox.send(item);
  if (r === "retry") { useStore.getState().showToast(t("call.kept")); flushLater(); }
  else if (r === "drop") useStore.getState().showToast(t("call.sendFailed", { error: t("call.refused") }));
}

function onFinal(text: string): void {
  const c = getCall();
  if (!c || !text) return;
  setLines((lines) => [...lines.filter((l) => l.final), { id: ++lineId, role: "user", text, final: true }]);
  void sendUtterance(c.botId, text);
}

function onPartial(text: string): void {
  setLines((lines) => {
    const finals = lines.filter((l) => l.final);
    return text ? [...finals, { id: ++lineId, role: "user", text, final: false }] : finals;
  });
}

function speakNext(): void {
  const c = getCall();
  if (!c || c.status === "error") return;
  const text = queue.shift();
  if (text === undefined) {
    speakingNow = false;
    currentUtterance = null;
    voiceStopped();
    patch({ speaking: false });
    startListening();
    return;
  }
  speakingNow = true;
  patch({ speaking: true });
  stopListening();
  setLines((lines) => [...lines.filter((l) => l.final), { id: ++lineId, role: "assistant", text, final: true }]);
  const bot = useStore.getState().bots[c.botId];
  const u = makeUtterance(text, bot?.voice ?? { name: "", rate: 1, lang: "auto" });
  currentUtterance = u;
  const done = () => {
    if (currentUtterance !== u) return;
    currentUtterance = null;
    speakNext();
  };
  u.onend = done;
  u.onerror = done;
  u.onstart = voiceStarted;
  u.onboundary = voiceWord;
  window.speechSynthesis.speak(u);
}

function checkReplies(): void {
  const c = getCall();
  if (!c) return;
  // The call belongs to the open conversation: opening another bot hangs up.
  const open = useStore.getState().selectedId;
  if (open !== c.botId) {
    endCall();
    return;
  }
  const thread = useStore.getState().threads[c.botId];
  if (thread === lastThread) return;
  lastThread = thread;
  if (!thread) return;
  if (thread.generation !== generation) {
    // A new conversation started mid-call: sequence numbers start over.
    if (generation !== -1 && spokenUpTo !== null) spokenUpTo = -1;
    generation = thread.generation;
  }
  if (spokenUpTo === null) return;
  let added = false;
  for (const row of thread.rows) {
    if (row.seq <= spokenUpTo) continue;
    const b = row.body;
    if (b.kind !== "message" || b.role !== "assistant") continue;
    if (b.streaming) break; // wait until it is finished; keeps replies in order
    spokenUpTo = row.seq;
    const text = speakable(b.text);
    if (text) {
      queue.push(text);
      added = true;
    }
  }
  if (added && !speakingNow) speakNext();
}

/**
 * Starts a call. Wave 6: when the bot's owner has speech services on the server (whisper.cpp + Piper, or OpenAI), the
 * call goes through the server (natural barge-in); otherwise the browser's own recognition and synthesis, as before.
 */
export function startCall(botId: string): void {
  const store = useStore.getState();
  const bot = store.bots[botId];
  if (!bot) return;
  endCall();
  useStore.setState({
    call: { botId, status: "connecting", error: null, muted: false, speaking: false, listening: false, startedAt: null, lines: [], pipeline: "browser", bargedAt: null },
  });
  void store.loadRows(botId);
  // Still inside the click: unlock audio now (phones refuse to start it after the network round-trips below).
  if (typeof AudioWorkletNode !== "undefined") primeCallAudio();
  // The server's voice stopped answering between the check and the call: the browser's own speech, when it has one.
  const fallBack = () => {
    if (getCall()?.botId !== botId || !canCall()) return false;
    useStore.setState((s) => (s.call ? { call: { ...s.call, status: "connecting", pipeline: "browser", providers: undefined } } : {}));
    unsubscribe?.();
    unsubscribe = null;
    startBrowserCall(botId);
    return true;
  };
  void api<{ status: VoiceStatus }>("GET", `/bots/${botId}/voice`).then(
    async (r) => {
      if (getCall()?.botId !== botId) { dropPrimedAudio(); return; }
      if (r.status.mode === "server" && typeof AudioWorkletNode !== "undefined" && (await startServerCall(botId, recognitionLang(bot.voice), fallBack))) {
        unsubscribe = useStore.subscribe(() => { if (useStore.getState().selectedId !== botId) endCall(); });
        return;
      }
      dropPrimedAudio();
      startBrowserCall(botId);
    },
    () => { dropPrimedAudio(); startBrowserCall(botId); },
  );
}

/** Whether a call is possible at all: the browser's speech, or a server pipeline (checked when the call starts). */
export const callPossible = (): boolean => canCall() || (typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices);

function startBrowserCall(botId: string): void {
  const bot = useStore.getState().bots[botId];
  if (!bot || getCall()?.botId !== botId) return;
  // No server voice for this bot's owner and no speech in this browser (iOS Safari, Firefox, Brave…): say where to turn
  // the server's voice on.
  if (!canCall()) {
    fail(useStore.getState().call ? t("call.unavailable") : "", true);
    return;
  }

  const r = createRecognition(recognitionLang(bot.voice));
  if (!r) {
    fail(t("call.unavailable"), true);
    return;
  }
  rec = r;
  beginTrace(botId);
  r.continuous = true;
  r.interimResults = true;
  r.onstart = () => {
    if (rec !== r) return;
    recRunning = true;
    const c = getCall();
    patch({ status: "live", listening: true, startedAt: c?.startedAt ?? Date.now() });
  };
  r.onresult = (e) => {
    if (rec !== r || speakingNow) return;
    let partial = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = (res[0]?.transcript ?? "").trim();
      if (res.isFinal) onFinal(text);
      else partial = (partial + " " + text).trim();
    }
    onPartial(partial);
  };
  r.onerror = (e) => {
    if (rec !== r) return;
    if (fallbackError(e.error)) { fail(t("call.unavailable"), true); return; }
    const message = micErrorText(e.error);
    if (message) fail(message);
  };
  r.onend = () => {
    if (rec !== r) return;
    recRunning = false;
    patch({ listening: false });
    if (shouldListen()) restartTimer = window.setTimeout(startListening, 250);
  };

  spokenUpTo = null;
  generation = useStore.getState().threads[botId]?.generation ?? -1;
  lastThread = useStore.getState().threads[botId];
  unsubscribe = useStore.subscribe(checkReplies);
  startListening();
}

/** Stop the bot talking and go straight back to listening. */
export function bargeIn(): void {
  if (serverCallActive()) { serverBargeIn(); patch({ bargedAt: Date.now() }); return; }
  queue = [];
  if (speakingNow) {
    const had = currentUtterance;
    window.speechSynthesis.cancel();
    // Some browsers don't fire "end" after cancel(); make sure listening resumes.
    window.setTimeout(() => {
      if (currentUtterance === had && speakingNow) {
        currentUtterance = null;
        speakNext();
      }
    }, 150);
  }
}

export function setMuted(muted: boolean): void {
  if (!getCall()) return;
  patch({ muted });
  if (serverCallActive()) { serverMute(muted); return; }
  if (muted) {
    stopListening();
    onPartial("");
  } else {
    startListening();
  }
}

export function endCall(): void {
  endServerCall();
  dropPrimedAudio();
  endTrace();
  window.clearTimeout(restartTimer);
  unsubscribe?.();
  unsubscribe = null;
  queue = [];
  speakingNow = false;
  currentUtterance = null;
  voiceStopped();
  if (rec) {
    const r = rec;
    rec = null;
    r.onstart = r.onend = r.onerror = r.onresult = null;
    try {
      r.abort();
    } catch {
      /* not running */
    }
  }
  recRunning = false;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  lastThread = undefined;
  if (useStore.getState().call) useStore.setState({ call: null });
}
