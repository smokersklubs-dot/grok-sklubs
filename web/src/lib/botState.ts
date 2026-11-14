/**
 * What a bot's character is doing right now, derived from the live store:
 * waiting > speaking (voice call) > working/thinking > listening (voice call) > happy (just replied)
 * > sleeping (its Linux computer is asleep) > idle.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useStore } from "../store";
import type { Row } from "../types";

export const CHARACTER_STATES = ["idle", "thinking", "working", "waiting", "speaking", "happy", "sleeping", "listening"] as const;
export type CharacterState = (typeof CHARACTER_STATES)[number];

const HAPPY_MS = 1500;

/* ---------- "Just replied": a short happy moment after a turn ends with a new assistant message ---------- */

const useHappy = create<{ until: Record<string, number> }>(() => ({ until: {} }));

function lastAssistantSeq(rows: Row[] | undefined): number {
  if (!rows) return -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const b = rows[i].body;
    if (b.kind === "message") return b.role === "assistant" ? rows[i].seq : -1;
  }
  return -1;
}

interface RunMark { seq: number; at: number }
const runStart: Record<string, RunMark> = {};
const wasRunning: Record<string, boolean> = {};
let watching = false;

function watchTurns(): void {
  if (watching) return;
  watching = true;
  let prevLive = useStore.getState().live;
  for (const [id, l] of Object.entries(prevLive)) wasRunning[id] = l.running;
  useStore.subscribe((s) => {
    if (s.live === prevLive) return;
    prevLive = s.live;
    for (const [id, l] of Object.entries(s.live)) {
      const before = wasRunning[id] ?? false;
      wasRunning[id] = l.running;
      if (!before && l.running) {
        runStart[id] = { seq: lastAssistantSeq(s.threads[id]?.rows), at: s.bots[id]?.lastActivityAt ?? 0 };
      } else if (before && !l.running && !l.awaiting) {
        const mark = runStart[id];
        delete runStart[id];
        const thread = s.threads[id];
        const seq = lastAssistantSeq(thread?.rows);
        // The thread may not be loaded (another bot): then any new activity on the bot counts.
        const replied = thread?.loaded ? seq >= 0 && (!mark || seq > mark.seq) : (s.bots[id]?.lastActivityAt ?? 0) > (mark?.at ?? 0);
        if (replied) useHappy.setState((h) => ({ until: { ...h.until, [id]: Date.now() + HAPPY_MS } }));
      }
    }
  });
}

/* ---------- The derived state ---------- */

function baseState(s: ReturnType<typeof useStore.getState>, botId: string): CharacterState {
  const live = s.live[botId];
  if (live?.awaiting) return "waiting";
  const call = s.call;
  const inCall = !!call && call.botId === botId && call.status === "live";
  if (inCall && call.speaking) return "speaking";
  if (live?.running) return live.activity?.kind === "thinking" || !live.activity ? "thinking" : "working";
  if (inCall && !call.muted) return "listening";
  const c = s.computer;
  if (c && c.kind === "linux") {
    const d = c.desktops.find((x) => x.botId === botId);
    if (d && !d.open) return "sleeping";
  }
  return "idle";
}

/** The character state of a bot (re-renders only when that bot's state word changes). */
export function useBotState(botId: string | undefined): CharacterState {
  watchTurns();
  const base = useStore((s) => (botId ? baseState(s, botId) : "idle"));
  const happyUntil = useHappy((h) => (botId ? h.until[botId] ?? 0 : 0));
  const [, setNow] = useState(0);
  const happy = happyUntil > Date.now();
  useEffect(() => {
    if (!happy) return;
    const timer = window.setTimeout(() => setNow(Date.now()), happyUntil - Date.now() + 10);
    return () => window.clearTimeout(timer);
  }, [happy, happyUntil]);
  if (happy && (base === "idle" || base === "sleeping" || base === "listening")) return "happy";
  return base;
}
