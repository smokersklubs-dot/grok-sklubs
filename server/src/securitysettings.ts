import { q } from "./db.js";
import { audit, now } from "./store.js";

/**
 * Settings → Security, the account's own switches for Lot 1 security (docs/SECURITE.md):
 *
 *  - `floorSecondFactor` (L44, owner decision still open, so an OPTION, off by default): approving a card for an action
 *    of the deterministic floor or one that cannot be undone (a payment, a deletion for good, a message to someone never
 *    named…) needs the code of the approver's two-factor app, typed on the card. A stolen session alone then cannot
 *    approve those. It can only be turned on once two-factor sign-in is on (twofactor.ts).
 *  - `netAlerts` (L39): a line in a bot's chat the first time it reaches a site it never reached (netjournal.ts). Off by
 *    default; a site reached by a click after outside content is always reported.
 *
 * Additive table created here (house pattern).
 */
q.run(`CREATE TABLE IF NOT EXISTS security_settings (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, floor_2fa INTEGER NOT NULL DEFAULT 0, net_alerts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`);

export interface SecuritySettings { floorSecondFactor: boolean; netAlerts: boolean }

export const securitySettings = {
  get(userId: string): SecuritySettings {
    const r = q.get<{ floor_2fa: number; net_alerts: number }>("SELECT floor_2fa, net_alerts FROM security_settings WHERE user_id = ?", userId);
    return { floorSecondFactor: !!r?.floor_2fa, netAlerts: !!r?.net_alerts };
  },
  set(userId: string, patch: Partial<SecuritySettings>): SecuritySettings {
    const cur = securitySettings.get(userId);
    const next = { floorSecondFactor: typeof patch.floorSecondFactor === "boolean" ? patch.floorSecondFactor : cur.floorSecondFactor, netAlerts: typeof patch.netAlerts === "boolean" ? patch.netAlerts : cur.netAlerts };
    q.run("INSERT INTO security_settings (user_id, floor_2fa, net_alerts, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET floor_2fa = excluded.floor_2fa, net_alerts = excluded.net_alerts, updated_at = excluded.updated_at",
      userId, next.floorSecondFactor ? 1 : 0, next.netAlerts ? 1 : 0, now());
    if (next.floorSecondFactor !== cur.floorSecondFactor) audit(userId, "account", `Second factor before floor approvals ${next.floorSecondFactor ? "on" : "off"}`);
    if (next.netAlerts !== cur.netAlerts) audit(userId, "account", `New-site alerts ${next.netAlerts ? "on" : "off"}`);
    return next;
  },
};
