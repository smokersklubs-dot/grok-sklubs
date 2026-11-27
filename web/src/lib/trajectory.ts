/** L158 « Créations »: the compare picks of the trajectory card (components/TrajectoryCard.tsx), without React (tested). */

/** The two renders compared by default: the last two (or the only one). */
export function defaultPair(renders: { id: number }[]): number[] {
  return renders.slice(-2).map((r) => r.id);
}

/** Picking a render for the compare: toggles it; a third pick replaces the oldest pick. */
export function pick(current: number[], id: number): number[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  return [...current, id].slice(-2);
}

/** True when the two compared renders are consecutive and the second is identical to the first. */
export function sameAsPrevious(shown: { n: number; unchanged: boolean }[]): boolean {
  return shown.length === 2 && shown[1].unchanged && shown[1].n === shown[0].n + 1;
}
