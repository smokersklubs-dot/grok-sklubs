/**
 * « Qui répond » in a group chat (agent/roomrouting.ts): the wire types, re-exported by shared.ts (kept apart so
 * shared.ts does not grow). Type-only.
 *
 * RoomRouting: the group's extra settings next to its rule (Bot.roomRule).
 *  `discreet` — « Discret » : the bots answer what they are asked and never chime in unasked (spec 09 V1-011,
 *               "mentions-only"); off, the automatic mode may let one other member add a short, clearly relevant point.
 *  `askFirst` — « Proposer avant de commencer » : when a message is a task, the chosen bot first offers to take it and
 *               starts only after a yes (a reply such as « oui », or a 👍 / 🎉 / ❤️ / 🙏 on its offer) (V1-012).
 */
export interface RoomRouting { discreet: boolean; askFirst: boolean }

/**
 * How the automatic mode picked who answers. "name": the message names the bot (no @); "keywords": its role or skills
 * match the message; "model": the small decision model chose; "lead": nothing better (no model, timeout, low confidence,
 * rate limit), so the group's lead; "none": chit-chat that needs no answer; "reroute": the owner chose « Plutôt demander à… »;
 * "accepted": a yes to a bot's offer.
 */
export type RouteBy = "name" | "keywords" | "model" | "lead" | "none" | "reroute" | "accepted";

/**
 * The light line under a message the automatic mode routed (« → Léa (Compta) a pris la question »), with the
 * « Plutôt demander à… » button. `messageSeq`: the message routed; `botId` / `botName`: who took it ("" with by "none");
 * `why`: one short reason, in the owner's language; `status`: "open" (can still be re-routed), "rerouted" (the owner
 * chose another member; botId is the new one), "archived" (L155: the owner archived the task; « Restaurer » brings it back).
 * L155: `botId` is the task's owner (« Responsable »): « Réassigner » hands it to another member (open or rerouted), as
 * many times as needed; `archivedFrom`: the status it had before being archived.
 */
export interface RouteNoticeAction { kind: "route"; messageSeq: number; thread: number; botId: string; botName: string; by: RouteBy; why: string; status: "open" | "rerouted" | "archived"; archivedFrom?: "open" | "rerouted" }

/** L155: GET/PUT /bots/:id/limits — each member's time limit in this group, in minutes (absent: none). */
export interface RoomMemberLimits { limits: Record<string, number>; min: number; max: number; held: string[] }
