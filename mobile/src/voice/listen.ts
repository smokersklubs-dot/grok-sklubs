/**
 * « Écouter les réponses » in the app, like the web (web/src/lib/listen.ts): the 🔊 under a reply reads it in the
 * bot's own voice through the server (POST /bots/:id/rows/:seq/speak, server/src/voice/speak.ts), part by part — part
 * 0 plays while part 1 is fetched. Without a server voice (409) the phone's own text-to-speech reads it. One reply at a
 * time; a call starting stops it. Played by the voice module (modules/sklubot-voice: play(id, wav) → onPlayed(id));
 * without it (iOS for now, unit tests) the button is not shown.
 */
import { create } from "zustand";
import type { Bot } from "../api/types";
import { getLocale } from "../i18n";
import { useStore } from "../state/store";
import { useCall } from "./call";
import { voiceNative } from "./native";
import { ReplyListener, type ListenStatus } from "./replyListener";
import { recognitionLang } from "./text";

export const useListen = create<{ key: string | null; status: ListenStatus; part: number; parts: number }>(() => ({ key: null, status: "idle", part: 0, parts: 0 }));
export const listenKey = (botId: string, seq: number) => `${botId}:${seq}`;
export const listenAvailable = !!voiceNative;

let current: ReplyListener | null = null;

export function stopListening(): void {
  current?.stop();
  current = null;
  useListen.setState({ key: null, status: "idle", part: 0, parts: 0 });
  releaseAudio();
}
function releaseAudio(): void {
  // The audio route set for the reading goes back as it was, unless a call has the speakers now.
  if (voiceNative && !useCall.getState().call) { try { voiceNative.end(); } catch { /* not started */ } }
}

/** Reads one reply (the 🔊 button); tapping it again stops. */
export function listenReply(botId: string, seq: number, text: string, voice: Bot["voice"] | undefined): void {
  stopListening();
  const native = voiceNative;
  const client = useStore.getState().client;
  if (!native || !client || useCall.getState().call) return;
  const key = listenKey(botId, seq);
  const lang = recognitionLang(voice, getLocale());
  try { native.setSpeaker(true); } catch { /* engine starting */ }
  const l: ReplyListener = new ReplyListener({
    async fetchPart(n) {
      try {
        const r = await client.postBytes(`/bots/${encodeURIComponent(botId)}/rows/${seq}/speak`, { part: n });
        if (r.status === 409) return { kind: "device" };
        if (!r.bytes) return { kind: "error", message: r.error };
        return { kind: "audio", wav: r.bytes, parts: Math.max(1, Number(r.header("x-speak-parts")) || 1) };
      } catch { return { kind: "error", message: null }; }
    },
    play: (id, b64) => native.play(id, b64),
    stopPlayback: () => native.stopPlayback(),
    onPlayed: (fn) => { const s = native.addListener("onPlayed", (e) => fn(e.id)); return () => s.remove(); },
    speak: (id, text) => native.speak(id, text, lang, voice?.rate && voice.rate > 0 ? voice.rate : 1),
    stopSpeaking: () => native.stopSpeaking(),
    onTts: (fn) => { const s = native.addListener("onTts", (e) => fn(e.type, e.id)); return () => s.remove(); },
    set: (p) => { if (current === l) useListen.setState({ key, ...p }); },
    done: () => { if (current === l) { current = null; useListen.setState({ key: null, status: "idle", part: 0, parts: 0 }); releaseAudio(); } },
  }, text);
  current = l;
  void l.start();
}

// A call takes the speakers: the reading stops.
useCall.subscribe((s, prev) => { if (s.call && !prev.call && current) { current.stop(); current = null; useListen.setState({ key: null, status: "idle", part: 0, parts: 0 }); } });
