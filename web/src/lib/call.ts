/**
 * Browser-only voice calls: continuous speech recognition → each final utterance is sent as a
 * voice-origin message → the bot's next finished replies are read aloud with speech synthesis.
 */
import { api, errText } from "../api";
import { t } from "../i18n";
import { useStore, type CallLine, type CallState, type Thread } from "../store";
import type { Row } from "../types";
import { canCall, createRecognition, makeUtterance, micErrorText, recognitionLang, speakable, type Recognition } from "./speech";

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

function fail(message: string): void {
  queue = [];
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  patch({ status: "error", error: message, listening: false, speaking: false });
  stopListening();
}

async function sendUtterance(botId: string, text: string): Promise<void> {
  try {
    const r = await api<{ row: Row }>("POST", `/bots/${botId}/messages`, { text, origin: "voice" });
    useStore.getState().addRows(botId, [r.row]);
    if (getCall()?.botId === botId && spokenUpTo === null) spokenUpTo = r.row.seq;
  } catch (e) {
    useStore.getState().showToast(t("call.sendFailed", { error: errText(e) }));
  }
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
  window.speechSynthesis.speak(u);
}

function checkReplies(): void {
  const c = getCall();
  if (!c) return;
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

export function startCall(botId: string): void {
  const store = useStore.getState();
  const bot = store.bots[botId];
  if (!bot || !canCall()) return;
  endCall();
  useStore.setState({
    call: { botId, status: "connecting", error: null, muted: false, speaking: false, listening: false, startedAt: null, lines: [] },
  });
  void store.loadRows(botId);

  const r = createRecognition(recognitionLang(bot.voice));
  if (!r) {
    fail(t("composer.voiceUnsupported"));
    return;
  }
  rec = r;
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
  if (muted) {
    stopListening();
    onPartial("");
  } else {
    startListening();
  }
}

export function endCall(): void {
  window.clearTimeout(restartTimer);
  unsubscribe?.();
  unsubscribe = null;
  queue = [];
  speakingNow = false;
  currentUtterance = null;
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
