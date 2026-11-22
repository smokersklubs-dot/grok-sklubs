/**
 * L142: the stop-cause chips of the sidebar (server stopcauseroutes.ts, GET /bots/stop-causes). Loaded once signed in,
 * then again a moment after any bot stops working (its live state goes from running to idle).
 */
import { create } from "zustand";
import { api } from "../api";
import type { StopCauseView } from "../../../server/src/stopcause";

export const useStopCauses = create<{ causes: Record<string, StopCauseView> }>(() => ({ causes: {} }));

let timer: ReturnType<typeof setTimeout> | null = null;
export function refreshStopCauses(delay = 0): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    api<{ causes: Record<string, StopCauseView> }>("GET", "/bots/stop-causes").then((r) => useStopCauses.setState({ causes: r.causes ?? {} }), () => undefined);
  }, delay);
}

export { endedRuns, startedRuns } from "./runchanges";
