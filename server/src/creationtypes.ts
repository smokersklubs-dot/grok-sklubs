/**
 * L158 « Créations » (backlog A-FAIRE L158; idea from CLI-Anything's preview trajectory, docs/audits/AUDIT-CLI-ANYTHING.md
 * #3 and « À faire » 7 — our own code): the wire type of a "trajectory" card — the successive renders of one long creative
 * work (a page, an image, a video, a file the bot produces), each tagged with a named stage, so the owner follows it and
 * compares two renders side by side. Server: agent/creations.ts, creationroutes.ts; web: components/TrajectoryCard.tsx.
 */
export const CREATION_STAGES = ["study", "build", "check", "ready"] as const;
export type CreationStage = (typeof CREATION_STAGES)[number];
export type RenderKind = "page" | "image" | "video" | "file";

/**
 * One render. `unchanged`: byte for byte the same as the render before it (nothing moved since). `preview`: false when
 * the file was too big to keep a copy (the render is still counted and compared by its fingerprint).
 */
export interface TrajectoryRender { id: number; n: number; stage: CreationStage; kind: RenderKind; name: string; note: string; at: number; bytes: number; unchanged: boolean; preview: boolean }

/**
 * `renders`: the latest ones (at most TRAJECTORY_SHOWN), oldest first; `total`: how many there are in all.
 * `stalled`: the last STALL_AFTER renders brought no change at all (« aucun progrès »).
 */
export interface TrajectoryCard { type: "trajectory"; creationId: string; title: string; stage: CreationStage; renders: TrajectoryRender[]; total: number; stalled: boolean }

export const TRAJECTORY_SHOWN = 12;
/** Two renders in a row identical to the one before them = no progress. */
export const STALL_AFTER = 2;
