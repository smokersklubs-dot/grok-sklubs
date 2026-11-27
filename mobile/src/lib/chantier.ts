/** « Chantier » on the phone (screens/Chantiers.tsx): the colours of states and statuses, and what the phone may do. */
import type { ChantierStatus, TaskState } from "../../../server/src/chantiertypes";

type Tone = "neutral" | "ok" | "warn" | "info" | "danger";
export const TASK_TONE: Record<TaskState, Tone> = { waiting: "neutral", running: "info", checking: "info", accepted: "ok", repairing: "warn", blocked: "danger", stopped: "neutral" };
export const STATUS_TONE: Record<ChantierStatus, Tone> = { planning: "info", proposed: "warn", running: "info", waiting_owner: "warn", done: "ok", stopped: "neutral" };
/** What the phone may do on a chantier in this status. */
export function phoneActions(status: ChantierStatus): { approve: boolean; stop: boolean } {
  return { approve: status === "proposed", stop: status === "running" || status === "waiting_owner" };
}

