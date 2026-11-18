/**
 * « Centre de commandement »: the page's pure helpers — filters, counts, and the geometry of the connectors drawn
 * between two cards. Type-only imports and erasable TypeScript, so web/scripts/command.test.mjs runs it in plain Node.
 */
import type { CommandCard, CommandLink, CommandState } from "../types";

/** "all", a section id, "none" (bots in no section), or "shared" (bots shared with you through a workspace). */
export type TeamFilter = string;
export interface CommandFilter { query: string; state: CommandState | "all"; team: TeamFilter }

/** Lower-case, without accents: « Équipe » matches « equipe ». */
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function teamOf(card: Pick<CommandCard, "shared" | "sectionId">): string {
  return card.shared ? "shared" : card.sectionId ?? "none";
}

export function filterCards<C extends Pick<CommandCard, "name" | "label" | "state" | "shared" | "sectionId">>(cards: C[], f: CommandFilter): C[] {
  const q = fold(f.query.trim());
  return cards.filter((c) =>
    (f.state === "all" || c.state === f.state) &&
    (f.team === "all" || teamOf(c) === f.team) &&
    (!q || fold(c.name).includes(q) || fold(c.label).includes(q)));
}

export function stateCounts(cards: Pick<CommandCard, "state">[]): Record<CommandState | "all", number> {
  const out: Record<CommandState | "all", number> = { all: cards.length, working: 0, waiting: 0, error: 0, paused: 0, idle: 0 };
  for (const c of cards) out[c.state]++;
  return out;
}

/** The order of the cards: who needs you first, then who works, then the rest; newest activity first within each. */
const RANK: Record<CommandState, number> = { waiting: 0, error: 1, working: 2, paused: 3, idle: 4 };
export function sortCards<C extends Pick<CommandCard, "state" | "lastActivityAt" | "name">>(cards: C[]): C[] {
  return [...cards].sort((a, b) => RANK[a.state] - RANK[b.state] || b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
}

/** Links whose two ends are both among the cards shown. */
export function visibleLinks(links: CommandLink[], shown: Set<string>): CommandLink[] {
  return links.filter((l) => shown.has(l.from) && shown.has(l.to));
}

/** A link is "live" (its dashes flow) when something passed over it lately. */
export const LIVE_LINK_MS = 15 * 60_000;
export const isLiveLink = (l: Pick<CommandLink, "lastAt">, now: number) => now - l.lastAt < LIVE_LINK_MS;

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

/**
 * The connector between two cards: a cubic curve from the edge of `a` that faces `b` to the edge of `b` that faces `a`
 * (sides when they sit side by side, top/bottom when one is above the other). `mid`: where its label goes — the point
 * of the curve nearest its middle that is not over any card (`obstacles`), or null when every point is covered.
 */
export function connector(a: Box, b: Box, obstacles: Box[] = []): { d: string; from: Pt; to: Pt; mid: Pt | null } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  // Side by side unless one is clearly above the other (the boxes overlap horizontally).
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const horizontal = overlapX < Math.min(a.w, b.w) * 0.3 && Math.abs(dx) >= 1;
  let from: Pt, to: Pt, c1: Pt, c2: Pt;
  if (horizontal) {
    const sx = Math.sign(dx);
    from = { x: sx > 0 ? a.x + a.w : a.x, y: ca.y };
    to = { x: sx > 0 ? b.x : b.x + b.w, y: cb.y };
    const k = Math.max(36, Math.abs(to.x - from.x) / 2);
    c1 = { x: from.x + sx * k, y: from.y };
    c2 = { x: to.x - sx * k, y: to.y };
  } else {
    const sy = Math.sign(dy) || 1;
    from = { x: ca.x, y: sy > 0 ? a.y + a.h : a.y };
    to = { x: cb.x, y: sy > 0 ? b.y : b.y + b.h };
    const k = Math.max(28, Math.abs(to.y - from.y) / 2);
    c1 = { x: from.x, y: from.y + sy * k };
    c2 = { x: to.x, y: to.y - sy * k };
  }
  const at = (t: number): Pt => {
    const u = 1 - t;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    };
  };
  const PAD = 6;
  const covered = (p: Pt) => obstacles.some((o) => p.x > o.x - PAD && p.x < o.x + o.w + PAD && p.y > o.y - PAD && p.y < o.y + o.h + PAD);
  let mid: Pt | null = null;
  // From the middle outwards, both ways, down to near the ends (a label right by a card still reads as its link).
  for (let i = 0; i <= 46; i++) {
    const t = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.02;
    const p = at(t);
    if (!covered(p)) { mid = { x: Math.round(p.x), y: Math.round(p.y) }; break; }
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = `M${r(from.x)},${r(from.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(to.x)},${r(to.y)}`;
  return { d, from, to, mid };
}
