import type { Context, Hono } from "hono";
import { tr } from "./i18n.js";
import { deviceKindOf, devices, labelOf } from "./relay.js";
import { DANGEROUS_SHORTCUTS, DENIED_APPS, FLOOR_LABEL, GUARD_LIMIT, guards, pushGuard, TIMEOUT_MAX, TIMEOUT_MIN } from "./relayguard.js";
import { body, fail } from "./routeinput.js";
import { audit, type UserRecord } from "./store.js";
import { fileAccess } from "./fileaccess.js";

/**
 * « Règles de sécurité » of one linked computer (Settings → Computers), registered after the session check:
 *   GET /relay/devices/:id/guard   the owner's rules (keep-out apps and folders, terminals allowed or not) and the
 *                                  built-in lists (apps always refused, protected shortcuts), read-only
 *   PUT /relay/devices/:id/guard   { keepApps?, keepFolders?, projectFolders?, allowTerminal?, commandTimeout?, filesOn? } — saved, then sent to the computer
 * Only the account the computer is linked to; a phone has its own rules on the phone (404 here).
 */
export function registerRelayGuardRoutes(api: Hono<any>) {
  const device = (c: Context) => {
    const user = c.get("user") as UserRecord;
    const row = devices.owned(user.id, c.req.param("id") ?? "");
    if (!row || deviceKindOf(row) === "phone") fail(404, "That computer is not linked.");
    return { user, row: row! };
  };
  const view = (userId: string, deviceId: string) => ({
    guard: guards.get(userId, deviceId),
    /** nod 9: « Accès à mes fichiers » (fileaccess.ts), also switchable from the chat. */
    filesOn: fileAccess.on(userId, deviceId),
    limit: GUARD_LIMIT,
    timeout: { min: TIMEOUT_MIN, max: TIMEOUT_MAX },
    builtin: {
      apps: DENIED_APPS.map((g) => ({ group: g.group, names: g.names })),
      floor: Object.keys(FLOOR_LABEL),
      shortcuts: DANGEROUS_SHORTCUTS.filter((s) => !/^control\+alt\+f([2-9]|1[0-2])$/.test(s.combo)).map((s) => ({ combo: s.combo === "control+alt+f1" ? "control+alt+f1…f12" : s.combo, why: s.why, platforms: s.platforms ?? null, ownApp: !!s.ownApp })),
    },
  });
  api.get("/relay/devices/:id/guard", (c) => { const { user, row } = device(c); return c.json(view(user.id, row.id)); });
  api.put("/relay/devices/:id/guard", async (c) => {
    const { user, row } = device(c);
    const b = await body(c);
    for (const k of ["keepApps", "keepFolders", "projectFolders"] as const) {
      if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].length > GUARD_LIMIT)) fail(400, tr(user.locale, "At most {n} entries.", { n: GUARD_LIMIT }));
    }
    if (b.allowTerminal !== undefined && typeof b.allowTerminal !== "boolean") fail(400, "allowTerminal must be true or false.");
    if (b.commandTimeout !== undefined && (typeof b.commandTimeout !== "number" || !Number.isFinite(b.commandTimeout))) fail(400, "commandTimeout must be a number of seconds.");
    if (b.filesOn !== undefined && typeof b.filesOn !== "boolean") fail(400, "filesOn must be true or false.");
    if (typeof b.filesOn === "boolean" && b.filesOn !== fileAccess.on(user.id, row.id)) {
      fileAccess.set(user.id, row.id, b.filesOn);
      audit(user.id, "computer", tr(user.locale, b.filesOn ? "Access to your files on {device} turned on" : "Access to your files on {device} turned off", { device: labelOf(row) }));
    }
    const before = guards.get(user.id, row.id);
    const after = guards.set(user.id, row.id, { keepApps: b.keepApps, keepFolders: b.keepFolders, projectFolders: b.projectFolders, allowTerminal: b.allowTerminal, commandTimeout: b.commandTimeout });
    const label = labelOf(row);
    if (before.allowTerminal !== after.allowTerminal) audit(user.id, "computer", tr(user.locale, after.allowTerminal ? "Commands allowed on {device}" : "Commands turned off on {device}", { device: label }));
    if (JSON.stringify([before.projectFolders, before.commandTimeout]) !== JSON.stringify([after.projectFolders, after.commandTimeout])) audit(user.id, "computer", tr(user.locale, "Project folders or command time changed on {device}", { device: label }));
    if (JSON.stringify([before.keepApps, before.keepFolders]) !== JSON.stringify([after.keepApps, after.keepFolders])) audit(user.id, "computer", tr(user.locale, "Keep-out list changed on {device}", { device: label }));
    void pushGuard(user.id, row.id);
    return c.json(view(user.id, row.id));
  });
}
