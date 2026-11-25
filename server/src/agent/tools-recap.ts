import { globalRecap, RECAP_MAX_DAYS } from "../globalrecap.js";
import type { BuiltinTool } from "./tools.js";

/** L161 « récapitulatif global »: global_recap (globalrecap.ts), the owner's own bots only, no model call. */
export const recapTools: BuiltinTool[] = [{
  spec: {
    name: "global_recap",
    description: `Get one recap of all the user's bots over the last days: what each finished, what waits for the user, the goals still open and the bots left aside (open goals, nothing for 14 days). Use it when the user asks where things stand across their bots, or for a weekly review. No model call; at most 2 500 characters.`,
    inputSchema: { type: "object", properties: { days: { type: "integer", description: `How many days back, 1 to ${RECAP_MAX_DAYS} (default 7)` } }, required: [] },
  },
  activity: "reading", label: "Reading the recap of your bots", group: "team", parallel: true,
  run: async (a, c) => {
    const r = globalRecap(c.bot.userId, { days: a.days, ownOnly: true, locale: c.user.locale });
    return { content: r.text, summary: `${r.totals.finished} · ${r.days} d` };
  },
}];
