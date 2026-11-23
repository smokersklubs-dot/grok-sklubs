/**
 * « Tableau de travail » (server workboard.ts, flows.ts, automations.ts, teammemory.ts; docs/TABLEAU.md): which tab of
 * the window is open, and the pure helpers of the kanban. Erasable TypeScript only, so web/scripts/workboard.test.mjs
 * runs it in plain Node.
 */
import { create } from "zustand";
import type { BoardIdea, BoardState, BoardTask } from "../../../server/src/workboardtypes";

export const BOARD_TABS = ["board", "flows", "automations", "team", "lessons"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
interface BoardStore { open: BoardTab | null; setOpen: (t: BoardTab | null) => void }
export const useBoard = create<BoardStore>((set) => ({ open: null, setOpen: (open) => set({ open }) }));
export const openBoard = (t: BoardTab | null) => useBoard.getState().setOpen(t);

/** The kanban's columns, left to right; « à relire » shows with « en cours ». */
export const COLUMNS: { key: BoardState | "ideas"; states: string[] }[] = [
  { key: "ideas", states: [] },
  { key: "waiting", states: ["waiting"] },
  { key: "running", states: ["running", "review"] },
  { key: "blocked", states: ["blocked"] },
  { key: "done", states: ["done"] },
];

/** Tasks per column (the server's `column` already puts an unknown state in « done »), most urgent first. */
export function byColumn(tasks: BoardTask[]): Record<BoardState, BoardTask[]> {
  const out: Record<BoardState, BoardTask[]> = { waiting: [], running: [], review: [], blocked: [], done: [] };
  for (const t of tasks) out[t.column === "review" ? "running" : t.column].push(t);
  for (const k of Object.keys(out) as BoardState[]) out[k].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  return out;
}

/** Ideas still open first (by urgency), then the done ones. */
export function sortIdeas(ideas: BoardIdea[]): BoardIdea[] {
  const rank: Record<string, number> = { critical: 0, bug: 1, minor: 2, idea: 3 };
  return [...ideas].sort((a, b) => Number(a.progress === "done") - Number(b.progress === "done") || (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9) || b.number - a.number);
}

/**
 * The value of an <input type="datetime-local"> ("2026-11-23T09:00") as an ISO time WITH the browser's time zone
 * ("2026-11-23T09:00+01:00"): the server refuses a time without its zone. "" → null.
 */
export function withZone(local: string, offsetMinutes = new Date(local || 0).getTimezoneOffset()): string | null {
  if (!local) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const off = -offsetMinutes;
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** File sizes in words (Ko / Mo). */
export const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Files the browser refuses before sending (the server checks again, on the content). */
export const REFUSED_EXT = /\.(html?|xhtml|svg|mhtml?|xml|js|mjs|cjs|ts|sh|bash|py|rb|pl|php|bat|cmd|ps1|vbs|zip|rar|7z|tar|gz|tgz|exe|msi|dmg|pkg|apk|jar|deb|rpm|dll)$/i;
export const MAX_FILE = 15 * 1024 * 1024;

// ── Wire shapes of /api/flows, /api/triggers, /api/team-memory, /api/work-lessons (server flows.ts, automations.ts,
// teammemory.ts, agent/worklessons.ts; kept here so the web build never follows the server's Node modules).
export interface FlowStep { kind: string; url?: string; label?: string; text?: string; keys?: string; option?: string; why?: string; commit: boolean; expectText?: string }
export interface FlowView { id: string; botId: string; name: string; steps: FlowStep[]; recording: boolean; createdAt: number; updatedAt: number; lastRunAt: number | null; commitSteps: number; blockedSteps: number }
export interface StepEvidence { n: number; kind: string; ok: boolean; url: string; title: string; excerpt: string; hash: string; note: string; shot: boolean; diff?: { added: string[]; removed: string[] } }
export interface FlowRunView { id: string; flowId: string; startedAt: number; endedAt: number | null; status: "running" | "waiting_approval" | "done" | "failed" | "stopped"; atStep: number; evidence: StepEvidence[]; changed: boolean; note: string; cause: string }
export interface EventTrigger { id: string; event: string; subject: string; action: string; target: string; botId: string | null; enabled: boolean; fired: number; lastFiredAt: number | null; lastNote: string; createdAt: number }
export interface TeamNote { id: string; scope: { kind: string; id: string }; authorName: string; byGuest: boolean; text: string; status: "active" | "pending" | "archived"; links: { kind: string; ref: string; label: string }[]; linkedFrom: string[]; createdAt: number; updatedAt: number }
export interface GuestView { id: string; name: string; canWrite: boolean; expiresAt: number; createdAt: number; revoked: boolean }
export interface WeekReview { from: number; to: number; success: number; failure: number; perBot: { botId: string; name: string; success: number; failure: number }[]; proposals: { key: string; botId: string; botName: string; text: string; evidence: string[]; count: number }[] }
