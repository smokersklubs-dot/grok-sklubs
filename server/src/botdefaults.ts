import type { Autonomy } from "./shared.js";

/**
 * Owner decision (22/11/2026): a bot created from now on is "balanced" by default — it does safe actions alone (with
 * Undo where an undo exists) and asks for the rest; the deterministic floor (authorize.ts) is unchanged. The creation
 * form offers the choice plainly. Existing bots keep their setting (nothing stored is rewritten).
 */
export const NEW_BOT_AUTONOMY: Autonomy = "balanced";
const CHOOSABLE: readonly Autonomy[] = ["careful", "balanced", "trusted"];

/** The autonomy a new bot gets: the creator's choice when it is one of the three offered, else the default. */
export function newBotAutonomy(choice: unknown): Autonomy {
  return (CHOOSABLE as readonly unknown[]).includes(choice) ? (choice as Autonomy) : NEW_BOT_AUTONOMY;
}
