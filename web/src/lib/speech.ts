import { useEffect, useState } from "react";
import type { Bot } from "../types";

/** Minimal typings for the Web Speech recognition API (not part of lib.dom). */
export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canRecognize(): boolean {
  return recognitionCtor() !== null;
}
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}
export function canCall(): boolean {
  return canRecognize() && canSpeak();
}

export function createRecognition(lang: string): Recognition | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  return rec;
}

export function recognitionLang(voice: Bot["voice"]): string {
  if (voice.lang && voice.lang !== "auto") return voice.lang;
  return navigator.language || "en-US";
}

export function micErrorText(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser's site settings and try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection and couldn't reach its service.";
    case "language-not-supported":
      return "This language isn't supported for speech recognition in your browser.";
    default:
      return null; // "no-speech", "aborted": not worth surfacing
  }
}

/** Strip Markdown so it reads naturally when spoken aloud. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeUtterance(text: string, voice: Bot["voice"]): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const wantLang = voice.lang && voice.lang !== "auto" ? voice.lang : "";
  let v = voice.name ? voices.find((x) => x.name === voice.name) : undefined;
  if (!v && wantLang) v = voices.find((x) => x.lang === wantLang) ?? voices.find((x) => x.lang.startsWith(wantLang.split("-")[0]));
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  if (wantLang && !v) u.lang = wantLang;
  u.rate = voice.rate > 0 ? voice.rate : 1;
  return u;
}

/** The browser's speech voices; the list often arrives asynchronously. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (canSpeak() ? window.speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!canSpeak()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}
