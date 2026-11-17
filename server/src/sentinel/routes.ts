import type { Context, Hono } from "hono";
import { mailConfigured } from "../accountmail.js";
import { q } from "../db.js";
import { healthReport } from "../monitor.js";
import type { SentinelOverview, SentinelSettingsView } from "../shared.js";
import { audit, users, type UserRecord } from "../store.js";
import { acknowledge, scan, scanState, severityCounts } from "./index.js";
import { activeRows, canWatch, historyRows, incidentRow, SentinelError, sentinelSettings, views } from "./view.js";

/**
 * Page « Surveillance » and Réglages → Surveillance (server side). Only for the server's owner and, in hosted mode, its
 * operators (view.ts canWatch); anyone else gets 404 on every route, like /api/health/deep — the page does not exist
 * for them. Registered after the session check.
 *
 *   GET  /surveillance                               incidents (active, then history), counts, last scan, health checks
 *   POST /surveillance/scan                          a scan now (at most one every 30 s per person)
 *   POST /surveillance/incidents/:incidentId/ack     "Acquitter": still shown, no more alerts for it
 *   GET  /surveillance/settings, PUT /surveillance/settings   the caller's own alert settings
 */
const FR: Record<string, string> = {
  "No such endpoint.": "Cette adresse n'existe pas.",
  "That incident does not exist or is already resolved.": "Cet incident n'existe pas ou est déjà résolu.",
  "Invalid value.": "Valeur invalide.", "Unknown severity.": "Gravité inconnue.", "Choose an hour between 0 and 23.": "Choisis une heure entre 0 et 23.",
  "Unknown time zone.": "Fuseau horaire inconnu.", "Quiet hours are written HH:MM.": "Les heures calmes s'écrivent HH:MM.",
  "A scan just ran. Wait a few seconds.": "Un passage vient d'avoir lieu. Attends quelques secondes.",
};
const m = (loc: string, en: string) => (loc === "fr" ? FR[en] ?? en : en);

export async function overview(userId: string): Promise<SentinelOverview> {
  const st = scanState();
  let health: SentinelOverview["health"] = null;
  try {
    const r = await healthReport(5000);
    health = { status: r.status, code: r.code, at: r.at, checks: Object.entries(r.checks).map(([name, c]) => ({ name, state: c.state, code: c.code, detail: c.detail })) };
  } catch { /* shown as unknown */ }
  return { incidents: views(activeRows(), userId), history: views(historyRows(50), userId), health, counts: severityCounts(), lastScan: st.lastScan, nextScanAt: st.nextScanAt, everyMin: st.everyMin };
}

const settingsView = (userId: string): SentinelSettingsView => ({
  settings: sentinelSettings.get(userId), mailConfigured: mailConfigured(), email: users.byId(userId)?.email ?? "",
  pushDevices: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND enabled = 1", userId)?.n ?? 0,
});

const lastManual = new Map<string, number>();

export function registerSentinelRoutes(api: Hono<any>) {
  const handle = (fn: (c: Context, user: UserRecord) => Promise<Response> | Response) => async (c: Context) => {
    const user = c.get("user") as UserRecord;
    try {
      if (!canWatch(user.id)) throw new SentinelError(404, "No such endpoint.");
      return await fn(c, user);
    } catch (err) {
      if (err instanceof SentinelError) return c.json({ error: m(user.locale, err.message) }, err.status);
      throw err;
    }
  };
  api.get("/surveillance", handle(async (c, user) => c.json(await overview(user.id), 200, { "cache-control": "no-store" })));
  api.post("/surveillance/scan", handle(async (c, user) => {
    const t = Date.now();
    if ((lastManual.get(user.id) ?? 0) > t - 30_000) throw new SentinelError(429, "A scan just ran. Wait a few seconds.");
    lastManual.set(user.id, t);
    await scan();
    return c.json(await overview(user.id));
  }));
  api.post("/surveillance/incidents/:incidentId/ack", handle(async (c, user) => {
    const id = c.req.param("incidentId") ?? "";
    const row = incidentRow(id);
    if (!row || row.status === "resolved") throw new SentinelError(404, "That incident does not exist or is already resolved.");
    if (acknowledge(id, user.id)) audit(user.id, "account", `Surveillance: incident acknowledged (${row.kind})`);
    return c.json(await overview(user.id));
  }));
  api.get("/surveillance/settings", handle((c, user) => c.json(settingsView(user.id))));
  api.put("/surveillance/settings", handle(async (c, user) => {
    const b = await c.req.json().catch(() => ({}));
    sentinelSettings.save(user.id, b);
    return c.json(settingsView(user.id));
  }));
}
