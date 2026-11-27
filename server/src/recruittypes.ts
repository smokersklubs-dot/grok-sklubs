/**
 * « Bot recruteur » (agent/recruit.ts): the wire types of the proposal card, re-exported by shared.ts (kept apart so
 * shared.ts does not grow). The card is the "recruit" member of shared.ts Card.
 *
 * The main bot (primary) proposes ONE new specialist when a substantial or recurring request fits no teammate's role.
 * The card is the approval: nothing is created before the owner presses « Créer {name} ».
 *  `why`: one line on why a new teammate; `instructions`: its standing instructions (editable on the card);
 *  `skills`: skills of the Bibliothèque it will get (added as reviewed skills); `routines`: routines it would suggest,
 *  always created paused; `brain`: "same" (the main bot's model) or "default" (the account's default), `brainLabel` how
 *  it reads; `task`: the request handed to it once it exists.
 *  `limit`: why it cannot be created right now ("plan": the hosted plan's bot limit, "daily": bots created by bots in
 *  the last 24 hours, "team": the installation is full) — the card then shows the remedy instead of « Créer ».
 *  Status: "pending" (waits for the owner), "created" (`botId`, `botName`: the new teammate), "declined" (« Non merci »:
 *  nothing was created).
 */
export interface RecruitRoutine { name: string; schedule: string; /** How the schedule reads, in the owner's language. */ when: string; prompt: string }
export interface RecruitSkill { id: string; title: string }
export type RecruitLimit = "plan" | "daily" | "team";
export type RecruitStatus = "pending" | "created" | "declined";
export interface RecruitCard {
  type: "recruit"; name: string; role: string; why: string; instructions: string;
  skills: RecruitSkill[]; routines: RecruitRoutine[]; brain: "same" | "default"; brainLabel: string; task: string;
  status: RecruitStatus; limit?: RecruitLimit; /** The limit's number (plan bots, bots a day, team size). */ limitN?: number;
  botId?: string; botName?: string;
  /** L163 (boardplan.ts): proposed for this role of the work board, which it holds once created (no request handed over). */
  boardRole?: import("./workboardtypes.js").TaskKind;
}
