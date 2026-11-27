/**
 * L163 « plan créé depuis la discussion » (boardplan.ts): the wire types of the plan card, shared by the server and the
 * web app (BoardPlan.tsx). Kept apart so shared.ts does not grow: the card is the "boardplan" member of shared.ts Card.
 *
 * Clean room: built from docs/cleanroom/10-timon.md T9 (the lead plans, the owner chooses before anything runs) and T12
 * (a role nobody holds) only; none of the studied product's code was read.
 *
 * The bot proposes a plan (board_plan_propose): tasks with a kind (a project role), an optional bot, a priority and the
 * earlier tasks of the plan they wait on (`after`: 0-based positions). Nothing is created until the owner presses
 * « Mettre sur le tableau » (with the tasks they keep ticked, and « lancer tout de suite » or not). `missingRoles`: kinds
 * of the plan that no bot holds and no task names a bot for — the owner may ask for a proposal card per role (a bot is
 * never created silently). Status: "pending", "created" (`taskIds`, in plan order, "" for a task left out), "dismissed".
 */
import type { TaskKind } from "./workboardtypes.js";

export interface PlanTask { title: string; description: string; kind: TaskKind | ""; botId: string | null; botName: string; priority: number; after: number[] }
export interface BoardPlanCard {
  type: "boardplan"; planId: string; title: string; why: string; tasks: PlanTask[];
  status: "pending" | "created" | "dismissed"; missingRoles: TaskKind[];
  taskIds?: string[]; launched?: boolean; proposedRoles?: TaskKind[];
}
