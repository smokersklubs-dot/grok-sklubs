/**
 * Pure state updates for the live channel and the conversation lists. No React, no network: unit-tested.
 * Same rules as the web app (web/src/store.ts): rows merge by seq, a higher-or-equal rev wins, a newer generation
 * (the conversation was reset) replaces the list.
 */
import type { Bot, Live, Row, ServerEvent } from "../api/types";

export interface Thread {
  generation: number;
  rows: Row[];
  loaded: boolean;
  loading: boolean;
  loadingEarlier: boolean;
  hasMore: boolean;
  error: string | null;
}

export interface LiveState {
  bots: Record<string, Bot>;
  live: Record<string, Live>;
  threads: Record<string, Thread>;
}

export const IDLE_LIVE: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
export const PAGE = 200;

export const emptyThread = (generation: number): Thread => ({ generation, rows: [], loaded: false, loading: false, loadingEarlier: false, hasMore: false, error: null });

/** Merge rows by seq; an incoming row replaces a stored one when its rev is higher or equal. Main chat only. */
export function mergeRows(existing: Row[], incoming: Row[]): Row[] {
  const fresh = incoming.filter((r) => !r.thread);
  if (fresh.length === 0) return existing;
  const bySeq = new Map<number, Row>();
  for (const r of existing) bySeq.set(r.seq, r);
  for (const r of fresh) {
    const cur = bySeq.get(r.seq);
    if (!cur || r.rev >= cur.rev) bySeq.set(r.seq, r);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The answer of GET /bots/:id/rows folded into what is already shown. */
export function applyRowsPage(cur: Thread, page: { generation: number; rows: Row[] }, earlier = false): Thread {
  if (page.generation > cur.generation) return { ...cur, generation: page.generation, rows: mergeRows([], page.rows), loaded: true, loading: false, loadingEarlier: false, hasMore: page.rows.length >= PAGE, error: null };
  if (page.generation < cur.generation) return { ...cur, loading: false, loadingEarlier: false };
  const hasMore = earlier || !cur.loaded ? page.rows.length >= PAGE : cur.hasMore;
  return { ...cur, rows: mergeRows(cur.rows, page.rows), loaded: true, loading: false, loadingEarlier: false, hasMore, error: null };
}

/** Something the app should tell the person about (a local notification when they are not looking at that chat). */
export type Alert = { kind: "reply"; botId: string; text: string } | { kind: "waiting"; botId: string; text: string };

/**
 * Applies one live event. Returns the new state (the same object when nothing changed), whether the bot list must be
 * reloaded, and what is worth a notification.
 */
export function applyEvent(s: LiveState, ev: ServerEvent): { state: LiveState; reloadBots: boolean; reloadTasks: boolean; bundleOf: string | null; alerts: Alert[] } {
  const out = { state: s, reloadBots: false, reloadTasks: false, bundleOf: null as string | null, alerts: [] as Alert[] };
  switch (ev.type) {
    case "rows": {
      const t = s.threads[ev.botId];
      // A finished reply that was not already shown finished: worth telling.
      for (let i = ev.rows.length - 1; i >= 0; i--) {
        const row = ev.rows[i];
        const b = row.body;
        if (row.thread || b.kind !== "message" || b.role !== "assistant" || b.streaming || !b.text.trim()) continue;
        const old = t && t.generation === ev.generation ? t.rows.find((r) => r.seq === row.seq) : undefined;
        if (old && old.body.kind === "message" && !old.body.streaming) continue;
        out.alerts.push({ kind: "reply", botId: ev.botId, text: b.text });
        break;
      }
      if (!t || ev.generation < t.generation) return out;
      const next: Thread = ev.generation > t.generation
        ? { ...t, generation: ev.generation, rows: mergeRows([], ev.rows), hasMore: false }
        : { ...t, rows: mergeRows(t.rows, ev.rows) };
      out.state = { ...s, threads: { ...s.threads, [ev.botId]: next } };
      return out;
    }
    case "reset": {
      const t = s.threads[ev.botId];
      if (!t || ev.generation <= t.generation) return out;
      out.state = { ...s, threads: { ...s.threads, [ev.botId]: { ...t, generation: ev.generation, rows: [], hasMore: false } } };
      return out;
    }
    case "live": {
      const was = s.live[ev.botId]?.awaiting ?? null;
      out.state = { ...s, live: { ...s.live, [ev.botId]: ev.live } };
      if (!was && ev.live.awaiting) out.alerts.push({ kind: "waiting", botId: ev.botId, text: ev.live.awaiting.reason });
      return out;
    }
    case "bot":
      out.state = { ...s, bots: { ...s.bots, [ev.bot.id]: ev.bot } };
      return out;
    case "roster":
    case "sections":
      out.reloadBots = true;
      return out;
    case "tasks":
      out.reloadTasks = true;
      out.bundleOf = ev.botId;
      return out;
    case "routines":
    case "memories":
      out.bundleOf = ev.botId;
      return out;
    default:
      return out;
  }
}

/** Bots in the order of the list: the main contact first, then the most recent activity. Rooms apart. */
export function sortBots(bots: Bot[]): { team: Bot[]; rooms: Bot[]; shared: Bot[] } {
  const visible = bots.filter((b) => !b.listHidden);
  const byRecent = (a: Bot, b: Bot) => Number(b.primary) - Number(a.primary) || Number(b.pinned) - Number(a.pinned) || b.lastActivityAt - a.lastActivityAt;
  return {
    team: visible.filter((b) => b.kind === "agent" && !b.access).sort(byRecent),
    rooms: visible.filter((b) => b.kind === "room" && !b.access).sort(byRecent),
    shared: visible.filter((b) => !!b.access).sort(byRecent),
  };
}

/** First words of a message for a notification or a list preview: markdown marks removed, one line. */
export function firstWords(text: string, max = 140): string {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>~]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
