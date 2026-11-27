import { maskSecrets } from "../shared.js";
import { redactSecrets } from "../store.js";

/**
 * L46: what one bot hands to another (a bot_message, a room hand-off, a failure hand-off) is a copy of words that may
 * hold a key the owner pasted earlier, or a vault value a tool brought back. Before it is written into the other bot's
 * chat and turn, every vault value of the owner (exact match) and every secret-looking value (shared.ts findSecrets,
 * enriched by secretformats.ts) is replaced by "[secret]". The receiving bot can still ask its owner; it never gets the value.
 */
export const SCRUBBED = "[secret]";
export function scrubHandoff(userId: string, text: string): string {
  return maskSecrets(redactSecrets(userId, text), SCRUBBED).text;
}
