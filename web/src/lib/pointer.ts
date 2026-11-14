/**
 * One shared pointer listener for the whole app. Characters whose eyes follow the pointer subscribe
 * here; a single requestAnimationFrame loop runs only while someone listens and something moves.
 * Each frame first lets every subscriber read (measure), then write (apply), so layout is never thrashed.
 */

export interface PointerFollower {
  /** Measure (getBoundingClientRect…) — no DOM writes here. Return false once settled. */
  read(x: number, y: number): boolean;
  /** Apply styles — no DOM reads here. */
  write(): void;
}

const followers = new Set<PointerFollower>();
let px = Number.NaN;
let py = Number.NaN;
let frame = 0;
let listening = false;
let movedAt = 0;

/** When the pointer last moved (ms since epoch; 0 = not yet, or nobody follows it). */
export function pointerMovedAt(): number {
  return movedAt;
}

function onMove(e: PointerEvent): void {
  movedAt = Date.now();
  px = e.clientX;
  py = e.clientY;
  wake();
}

function tick(): void {
  frame = 0;
  if (Number.isNaN(px)) return;
  let busy = false;
  for (const f of followers) if (f.read(px, py)) busy = true;
  for (const f of followers) f.write();
  if (busy) wake();
}

function wake(): void {
  if (!frame && followers.size > 0) frame = requestAnimationFrame(tick);
}

export function followPointer(f: PointerFollower): () => void {
  followers.add(f);
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", wake, { passive: true, capture: true });
    listening = true;
  }
  wake();
  return () => {
    followers.delete(f);
    if (followers.size === 0 && listening) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", wake, { capture: true });
      listening = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/** Whether the user asked the system for less motion (read live). */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
