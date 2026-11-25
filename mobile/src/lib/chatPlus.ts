/**
 * L184 on the phone — the pure parts of components/ChatPlus.tsx, over the store's `call` (unit-tested in
 * __tests__/chatplus.test.ts): the quote waiting for a composer, link previews fetched once per address, the pinned
 * dashboard's calls (same routes as the web app, server chatplusroutes.ts) and the metrics tiles.
 */
import { create } from "zustand";
import type { ViewCard } from "../../../server/src/viewtypes";
import { quoteOf, replyDraft } from "../../shared/chatPlus";
import type { Key } from "../i18n/fr";

type Call = <T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;
const enc = encodeURIComponent;

/* Quote */
/** The quote waiting for the composer of a chat (the composer takes it and clears it). */
export const useQuote = create<{ pending: Record<string, string>; take(botId: string): string | null }>((set, get) => ({
  pending: {},
  take(botId) {
    const q = get().pending[botId];
    if (q === undefined) return null;
    const { [botId]: _, ...rest } = get().pending;
    set({ pending: rest });
    return q;
  },
}));
/** Quotes a message into that chat's draft (nothing for a message without words). */
export function quoteMessage(botId: string, text: string): boolean {
  const q = quoteOf(text);
  if (!q) return false;
  useQuote.setState((s) => ({ pending: { ...s.pending, [botId]: q } }));
  return true;
}
export const draftWithQuote = (quote: string, current: string) => replyDraft(quote, current);

/* Link preview */
export interface Preview { url: string; host: string; title: string; description: string; siteName: string }
const previews = new Map<string, Promise<Preview | null>>();
/** One server call per address for the app's life (at most 200 kept); a failure shows nothing. */
export function fetchPreview(call: Call, url: string): Promise<Preview | null> {
  let p = previews.get(url);
  if (!p) {
    p = call<{ preview?: Preview | null }>("GET", `/link-preview?url=${enc(url)}`).then((r) => (r?.preview && typeof r.preview.title === "string" ? r.preview : null), () => null);
    previews.set(url, p);
    if (previews.size > 200) previews.delete(previews.keys().next().value!);
  }
  return p;
}
export const forgetPreviews = () => previews.clear();

/* Pinned dashboard */
export interface Pin { id: string; botId: string; botName: string; title: string; seq: number; updatedAt: number; card: ViewCard | null }
const cleanPins = (r: { pins?: unknown } | null | undefined): Pin[] => (Array.isArray(r?.pins) ? (r!.pins as Pin[]).filter((p) => p && typeof p.id === "string" && typeof p.title === "string") : []);
export const dash = {
  list: async (call: Call) => cleanPins(await call<{ pins?: unknown }>("GET", "/dashboard/pins")),
  pin: (call: Call, botId: string, seq: number) => call("POST", `/bots/${enc(botId)}/cards/${seq}/pin`),
  move: async (call: Call, id: string, dir: -1 | 1) => cleanPins(await call<{ pins?: unknown }>("POST", `/dashboard/pins/${enc(id)}/move`, { dir })),
  unpin: async (call: Call, id: string) => cleanPins(await call<{ pins?: unknown }>("DELETE", `/dashboard/pins/${enc(id)}`)),
};

/* Metrics */
export interface Metrics { bots: number; rooms: number; connectors: number; messages: { user: number; assistant: number }; messages24h: number; tokens: { input: number; output: number; cached: number }; costUsd: number; costUsd30d: number; tokens24h: number; approvalsPending: number; routineRuns: { ok: number; failed: number; other: number } }
/** Dollars, as the cards show them (Cards.tsx usd). */
export const usd = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(2)} $`;
/** The tiles of the metrics panel, in order: label key, big value, small line (the same as the web panel). */
export function metricTiles(m: Metrics, n: (v: number) => string, t: (k: Key, vars?: Record<string, string | number>) => string): [Key, string, string][] {
  return [
    ["metrics.bots", n(m.bots), t("metrics.groups", { n: m.rooms })],
    ["metrics.messages", n(m.messages.user + m.messages.assistant), t("metrics.last24h", { n: n(m.messages24h) })],
    ["metrics.tokens", n(m.tokens.input + m.tokens.output), t("metrics.last24h", { n: n(m.tokens24h) })],
    ["metrics.cost", usd(m.costUsd), t("metrics.last30d", { v: usd(m.costUsd30d) })],
    ["metrics.routines", n(m.routineRuns.ok), t("metrics.runs", { ok: n(m.routineRuns.ok), failed: n(m.routineRuns.failed) })],
    ["metrics.waiting", n(m.approvalsPending), ""],
    ["metrics.apps", n(m.connectors), ""],
  ];
}
