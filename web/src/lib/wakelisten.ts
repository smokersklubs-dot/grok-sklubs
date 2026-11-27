import { useEffect } from "react";
import { useStore } from "../store";
import type { Bot } from "../types";
import { startCall } from "./call";
import { createRecognition, recognitionLang, type Recognition } from "./speech";
import { heardWake, localStatus, wakeEnabled } from "./wakeword";

/**
 * L154 « mot de réveil »: listens for « Salut <bot> » while the app is open on this bot's chat, the page is visible, no
 * call runs, and the owner turned it on for this device — only with on-device recognition (wakeword.ts). Hearing it
 * starts a call with the bot (the same as pressing the call button). Stops as soon as any of these is no longer true.
 */
export function useWakeWord(bot: Bot): void {
  const inCall = useStore((s) => !!s.call);
  useEffect(() => {
    if (bot.kind !== "agent" || inCall || typeof window === "undefined") return;
    let rec: (Recognition & { processLocally?: boolean }) | null = null;
    let alive = true;
    let timer: number | undefined;
    const lang = recognitionLang(bot.voice);
    const stop = () => { window.clearTimeout(timer); const r = rec; rec = null; if (r) { r.onend = r.onresult = r.onerror = null; try { r.abort(); } catch { /* not running */ } } };
    const start = async () => {
      stop();
      if (!alive || !wakeEnabled() || document.visibilityState !== "visible") return;
      if ((await localStatus(lang)) !== "available" || !alive) return;
      const r = createRecognition(lang) as (Recognition & { processLocally?: boolean }) | null;
      if (!r) return;
      r.processLocally = true; // never an online service (wakeword.ts)
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (heardWake(e.results[i][0]?.transcript ?? "", bot.name)) { stop(); startCall(bot.id); return; }
        }
      };
      r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") { alive = false; stop(); } };
      r.onend = () => { if (alive && rec === r) timer = window.setTimeout(() => void start(), 800); };
      rec = r;
      try { r.start(); } catch { timer = window.setTimeout(() => void start(), 2000); }
    };
    const again = () => void start();
    void start();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("sklubot:wakeword", again);
    return () => { alive = false; stop(); document.removeEventListener("visibilitychange", again); window.removeEventListener("sklubot:wakeword", again); };
  }, [bot.id, bot.kind, bot.name, bot.voice, inCall]);
}
