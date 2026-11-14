import { removeWorkspace, screen } from "../computer.js";
import { routines } from "../routines.js";
import { unschedule } from "../scheduler.js";
import { syncSlackSockets } from "../native/triggers.js";
import { audit, bots, type BotRecord } from "../store.js";
import { releaseControl } from "../takeover.js";
import { dropRecording } from "../teach.js";
import { retireEngine } from "./engine.js";
import { expireAllApprovals, interrupt } from "./loop.js";

/**
 * Deleting a bot (U-003), in this order: stop its turn (its approvals lapse), take its routines off the schedule and
 * drop their triggers, retire its helpers, stop its engine and forget its sessions, free its screen (the computer and
 * its home, with the browser profile, are deleted), delete its library — then the record. Each failure is logged and
 * never stops the following steps, nor the deletion itself.
 */
export interface RetireStep { id: string; run: (bot: BotRecord) => Promise<void> | void }
/** Bot ids that are safe as folder names: only those get their files deleted. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export const retireSteps: RetireStep[] = [
  { id: "turn", run: (b) => { interrupt(b.id); expireAllApprovals(b.id); releaseControl(b.id); } },
  {
    id: "routines",
    run: (b) => {
      for (const r of routines.forBot(b.id)) { unschedule(r.id); routines.remove(r.id); }
      // A Slack account whose last routine just went away closes its live connection.
      syncSlackSockets();
      dropRecording(b.id);
    },
  },
  { id: "helpers", run: async (b) => { for (const child of bots.children(b.id)) if (child.id !== b.id) await retireBot(child); } },
  { id: "engine", run: (b) => (b.kind === "agent" ? retireEngine(b.id) : undefined) },
  { id: "screen", run: async (b) => { if (b.kind === "agent") await screen.reset(b.id); } },
  { id: "files", run: (b) => { if (SAFE_ID.test(b.id)) removeWorkspace(b.id); } },
  { id: "record", run: (b) => { bots.remove(b.id); } },
];

export async function retireBot(b: BotRecord): Promise<{ step: string; ok: boolean; error?: string }[]> {
  const report: { step: string; ok: boolean; error?: string }[] = [];
  for (const step of retireSteps) {
    try {
      await step.run(b);
      report.push({ step: step.id, ok: true });
    } catch (err) {
      const error = String((err as Error)?.message ?? err).slice(0, 300);
      report.push({ step: step.id, ok: false, error });
      console.error(`[delete ${b.id}] ${step.id}:`, error);
      try { audit(b.userId, "system", `${b.name}: deletion step "${step.id}" failed (${error}); carried on`, null); } catch { /* the log itself must not stop the deletion */ }
    }
  }
  return report;
}
