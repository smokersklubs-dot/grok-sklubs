/**
 * The voice module (modules/sklubot-voice, Kotlin, in both builds). Absent in unit tests and on iOS for now: calls are
 * then reported as unavailable. Events: native modules are event emitters since Expo SDK 52
 * (https://docs.expo.dev/modules/module-api/#events, `addListener`).
 */
import { requireOptionalNativeModule } from "expo";

export interface Sub { remove(): void }
export interface VoiceEvents {
  onPcm: (e: { data: string; level: number }) => void;
  onPlayed: (e: { id: number }) => void;
  onFocus: (e: { state: "gain" | "loss" | "transient" }) => void;
  onError: (e: { where: string; message: string }) => void;
  onSpeech: (e: { type: "ready" | "start" | "stop" | "partial" | "final" | "error"; text: string | null; code: number | null }) => void;
  onTts: (e: { type: "start" | "done" | "error"; id: string }) => void;
  onHangUp: (e: Record<string, never>) => void;
}

export interface VoiceNative {
  begin(speaker: boolean, title: string, text: string, hangUp: string): void;
  end(): void;
  setSpeaker(on: boolean): void;
  startCapture(): boolean;
  stopCapture(): void;
  play(id: number, wavBase64: string): void;
  stopPlayback(): void;
  setVolume(v: number): void;
  recognitionAvailable(): boolean;
  listen(lang: string): void;
  stopListening(): void;
  speak(id: string, text: string, lang: string, rate: number): void;
  stopSpeaking(): void;
  addListener<K extends keyof VoiceEvents>(name: K, fn: VoiceEvents[K]): Sub;
}

export const voiceNative = requireOptionalNativeModule<VoiceNative>("SklubotVoice");
