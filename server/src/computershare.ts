import { q } from "./db.js";
import { devices } from "./relay.js";
import { now, policies } from "./store.js";

/**
 * One computer for all the bots of an account (owner request 25/11/2026: « quand je change de bot, ça me demande une
 * nouvelle connexion »). Linked computers belong to the account (relay_devices.user_id); what used to be per bot:
 *
 *  - the app's approval to take control (agent/mycomputer.ts controlCard, policy key per bot name). The owner may now
 *    answer the card « Pour tous mes bots »: the account policy ALL_BOTS_CONTROL_KEY, revocable in Settings →
 *    Computers. It never lifts a strict card (after outside content), a bot whose control the owner blocked, nor any
 *    command card: commands keep their own approvals, the deterministic floor and the computer's own questions;
 *  - which computer a bot uses when it names none: « Ordinateur de ce bot » (bot settings, shown when the account has
 *    two computers or more). Unset = « Celui qui est connecté » (the only one online), as before.
 *
 * The computer's own question (Sklubot Relais) has its own « Autoriser tous mes bots de ce compte » (protocol 1.7,
 * companion/src/main/relay-core.js); the hand-over between bots is in agent/computerqueue.ts.
 */

/** Not a bot name: bot-specific keys are "mycomputer: control: <name>", this one has no third part. */
export const ALL_BOTS_CONTROL_KEY = "mycomputer: control (all bots)";
const CONTROL_PREFIX = "mycomputer: control: ";

/** True when an approval card is the one for taking control of a computer (the only card offering « pour tous mes bots »). */
export const isControlCard = (tool: string) => tool.startsWith(CONTROL_PREFIX);

export const allBotsControl = {
  on: (userId: string) => policies.get(userId, ALL_BOTS_CONTROL_KEY) === "always_allow",
  set: (userId: string, on: boolean) => (on ? policies.set(userId, ALL_BOTS_CONTROL_KEY, "always_allow") : policies.remove(userId, ALL_BOTS_CONTROL_KEY)),
  /**
   * Does the account policy spare this bot the control card? Never after outside content (the card is strict then),
   * never for a bot whose control the owner set to "blocked".
   */
  covers: (userId: string, botName: string, tainted: boolean) =>
    !tainted && allBotsControl.on(userId) && policies.get(userId, CONTROL_PREFIX + botName) !== "blocked",
};

q.run(`CREATE TABLE IF NOT EXISTS bot_relay_device (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
)`);

export const botDevice = {
  /** The computer chosen for this bot, if it is still linked to the bot owner's account (else: none). */
  get(userId: string, botId: string): string | null {
    const r = q.get<{ device_id: string }>("SELECT device_id FROM bot_relay_device WHERE bot_id = ?", botId);
    return r && devices.owned(userId, r.device_id) ? r.device_id : null;
  },
  /** null = « Celui qui est connecté ». The caller checks that the bot and the computer are the user's. */
  set(botId: string, deviceId: string | null) {
    if (!deviceId) q.run("DELETE FROM bot_relay_device WHERE bot_id = ?", botId);
    else q.run("INSERT INTO bot_relay_device (bot_id, device_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET device_id = excluded.device_id, updated_at = excluded.updated_at", botId, deviceId, now());
  },
};
