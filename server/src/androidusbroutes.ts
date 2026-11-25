import type { Hono } from "hono";
import { listPhones, offersAndroid, phonesView, stopPhone } from "./androidusb.js";
import { tr } from "./i18n.js";
import { devices, labelOf, liveDevice } from "./relay.js";
import { body, fail } from "./routeinput.js";
import { audit, type UserRecord } from "./store.js";

/**
 * Settings → Computers, « Téléphones Android (USB) » of one linked computer (androidusb.ts, protocol 1.9). Behind the
 * session like every /api route; another account's computer is a 404, whatever its state.
 *
 *  GET  /relay/devices/:id/android        { online, supported, adb: { found, version? }, devices: [...], checkedAt }
 *                                          (?fresh=1 asks the computer again instead of the 15 s cache)
 *  POST /relay/devices/:id/android/stop   { serial?: string } « Arrêter »: the Relais releases the phone and forgets
 *                                          every yes for it; the bot may not take it again on its own for 10 minutes.
 */
type Env = { Variables: { user: UserRecord } };

export function registerAndroidUsbRoutes(api: Hono<Env>) {
  const own = (user: UserRecord, id: string) => {
    const row = devices.owned(user.id, id);
    if (!row) fail(404, tr(user.locale, "That computer is not linked to your account."));
    return row!;
  };
  api.get("/relay/devices/:id/android", async (c) => {
    const user = c.get("user");
    const row = own(user, c.req.param("id"));
    if (!liveDevice(user.id, row.id)) return c.json({ online: false, supported: false, adb: { found: false }, devices: [], checkedAt: null });
    if (!offersAndroid(user.id, row.id)) return c.json({ online: true, supported: false, adb: { found: false }, devices: [], checkedAt: null });
    const r = await listPhones(user.id, row.id, { fresh: c.req.query("fresh") === "1" });
    if (!r) fail(404, tr(user.locale, "That computer is not linked to your account."));
    if ("ok" in r! && r.ok === false) {
      if (r.code === "locked") fail(409, tr(user.locale, "Stop was pressed on {device}: allow control again on that computer first.", { device: labelOf(row) }));
      fail(502, tr(user.locale, "{device} did not answer about its phones ({code}).", { device: labelOf(row), code: r.code }));
    }
    return c.json({ online: true, supported: true, ...phonesView(row.id, r as Parameters<typeof phonesView>[1]) });
  });
  api.post("/relay/devices/:id/android/stop", async (c) => {
    const user = c.get("user");
    const row = own(user, c.req.param("id"));
    const raw = (await body(c)).serial;
    if (raw !== undefined && (typeof raw !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(raw))) fail(400, "serial must be a phone serial.");
    if (!liveDevice(user.id, row.id)) fail(409, tr(user.locale, "{device} is not connected.", { device: labelOf(row) }));
    const ok = await stopPhone(user.id, row.id, typeof raw === "string" ? raw : null);
    if (!ok) fail(502, tr(user.locale, "{device} did not answer about its phones ({code}).", { device: labelOf(row), code: "release" }));
    audit(user.id, "computer", tr(user.locale, "You stopped the bots on the phones plugged into {device}.", { device: labelOf(row) }));
    return c.json({ stopped: true });
  });
}
