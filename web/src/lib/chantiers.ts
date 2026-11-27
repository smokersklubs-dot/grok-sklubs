/**
 * « Chantier » (server chantiers.ts, docs/CHANTIER.md): the page's small store (which chantier is open) and its pure
 * helpers — the graph's levels and geometry, the colour of each state. Erasable TypeScript only, so
 * web/scripts/chantier.test.mjs runs it in plain Node.
 */
import { create } from "zustand";
import type { ChantierPlan, PlanEdge, TaskState } from "../../../server/src/chantiertypes";

export type ChantierOpen = { kind: "list" } | { kind: "new"; botId?: string; brief?: string } | { kind: "page"; id: string } | null;
interface ChantierStore { open: ChantierOpen; setOpen: (o: ChantierOpen) => void }
export const useChantiers = create<ChantierStore>((set) => ({ open: null, setOpen: (open) => set({ open }) }));
export const openChantiers = (o: ChantierOpen) => useChantiers.getState().setOpen(o);

/** How each state looks on the graph: waiting grey, running blue, accepted green, repairing orange, blocked red. */
export const STATE_TONE: Record<TaskState, "muted" | "info" | "ok" | "warn" | "danger"> = {
  waiting: "muted", running: "info", checking: "info", accepted: "ok", repairing: "warn", blocked: "danger", stopped: "muted",
};

/** Each task's level: 0 for tasks that wait on nobody, else one more than the deepest task it waits on. */
export function levels(keys: string[], edges: Pick<PlanEdge, "from" | "to">[]): Map<string, number> {
  const out = new Map<string, number>();
  const visiting = new Set<string>();
  const level = (k: string): number => {
    const known = out.get(k);
    if (known !== undefined) return known;
    if (visiting.has(k)) return 0; // a cycle (the server refuses those): stop here
    visiting.add(k);
    const ups = edges.filter((e) => e.to === k && keys.includes(e.from)).map((e) => level(e.from));
    visiting.delete(k);
    const v = ups.length ? Math.max(...ups) + 1 : 0;
    out.set(k, v);
    return v;
  };
  for (const k of keys) level(k);
  return out;
}

export interface GraphNode { key: string; x: number; y: number; level: number }
export interface GraphEdge { from: string; to: string; artifact: string; path: string; lx: number; ly: number }
export const NODE_W = 176;
export const NODE_H = 58;
const GAP_X = 28;
const GAP_Y = 92;

/**
 * Top-to-bottom layout: one row per level, nodes of a row centred; edges as curves, each label near its source so the
 * labels of links that meet at one task do not cover each other.
 */
export function graphLayout(plan: Pick<ChantierPlan, "tasks" | "edges">): { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number } {
  const keys = plan.tasks.map((t) => t.key);
  const lv = levels(keys, plan.edges);
  const rows: string[][] = [];
  for (const k of keys) (rows[lv.get(k) ?? 0] ??= []).push(k);
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  const width = widest * NODE_W + (widest - 1) * GAP_X + 16;
  const nodes: GraphNode[] = [];
  rows.forEach((row, level) => {
    if (!row) return;
    const used = row.length * NODE_W + (row.length - 1) * GAP_X;
    row.forEach((key, i) => nodes.push({ key, level, x: (width - used) / 2 + i * (NODE_W + GAP_X), y: 8 + level * (NODE_H + GAP_Y) }));
  });
  const at = new Map(nodes.map((n) => [n.key, n]));
  const edges: GraphEdge[] = plan.edges.flatMap((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return [];
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
    const my = (y1 + y2) / 2;
    return [{ from: e.from, to: e.to, artifact: e.artifact, path: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, lx: x1 + (x2 - x1) * 0.2, ly: y1 + (y2 - y1) * 0.32 }];
  });
  const height = rows.length * NODE_H + (rows.length - 1) * GAP_Y + 16;
  return { nodes, edges, width, height };
}

/** « 1 h 05 », « 12 min », « 40 s ». */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Text lines ⇄ a list (empty lines dropped). */
export const toLines = (list: string[]) => list.join("\n");
export const fromLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
