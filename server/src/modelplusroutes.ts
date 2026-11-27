import type { Context, Hono } from "hono";
import { isEngineRef } from "./agent/engine.js";
import { RateWindow } from "./hardening.js";
import { tr } from "./i18n.js";
import { modelAvailable } from "./llm/index.js";
import { checkKeyCredit, checkOpenRouterCredit, creditAlertView, creditKindOf, setCreditAlert } from "./providercredit.js";
import { PresetError, projectPreset, setProjectPreset } from "./projectpresets.js";
import { fail } from "./routeinput.js";
import { sections, type UserRecord } from "./store.js";
import { placeReminderCall, reminderView, ReminderError, removeReminderSettings, saveReminderSettings } from "./voice/remindercall.js";

/**
 * L150 routes (backlog A-FAIRE), behind the session; each account sees and changes only its own things.
 *   GET  /sections/:id/model-preset          a project's model preset ({ model, effort }, "" = none)
 *   PUT  /sections/:id/model-preset          { model?, effort? } (an offered model only; levels low|medium|high|xhigh)
 *   GET  /openrouter/credit-alert            the alert threshold and the last reading
 *   PUT  /openrouter/credit-alert            { thresholdUsd } (0 = off)
 *   POST /openrouter/credit-alert/check      read the credit now (at most 10 a minute)
 * L154 reminder calls to the owner's own phone (voice/remindercall.ts):
 *   GET /reminder-call · PUT /reminder-call { accountSid, username?, secret?, from, to, enabled? } · DELETE /reminder-call
 *   POST /reminder-call/test   rings the owner's number now (the owner pressed « Essayer »)
 * The conversation's own reasoning level goes through PATCH /bots/:id/conversations/:gen { effort } (chatcomfortroutes.ts).
 */
type E = { Variables: { user: UserRecord } };
const checks = new RateWindow(10, 60_000);

/** Refuses (400, in the owner's language) a key the provider says has no credit or refuses; any doubt keeps it. */
export async function refuseCreditless(c: Context, baseUrl: string | undefined, key: string | null | undefined, preset?: string): Promise<void> {
  if (!baseUrl || !key) return;
  const v = await checkKeyCredit(creditKindOf(baseUrl, preset), baseUrl, key);
  if (!v.ok) fail(400, tr((c.get("user") as UserRecord).locale, v.message));
}

export function registerModelPlusRoutes(api: Hono<E>) {
  const user = (c: Context<E>) => c.get("user");
  const json = async (c: Context<E>) => { const b = await c.req.json().catch(() => ({})); return (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>; };

  api.get("/sections/:id/model-preset", (c) => {
    const s = sections.owned(user(c).id, c.req.param("id")) ?? fail(404, tr(user(c).locale, "That section does not exist."));
    return c.json(projectPreset(user(c).id, s.id));
  });
  api.put("/sections/:id/model-preset", async (c) => {
    const u = user(c);
    const s = sections.owned(u.id, c.req.param("id")) ?? fail(404, tr(u.locale, "That section does not exist."));
    const b = await json(c);
    try { return c.json(setProjectPreset(u.id, s.id, b, (ref) => isEngineRef(ref) || modelAvailable(ref, u.id))); }
    catch (err) { if (err instanceof PresetError) fail(err.status, tr(u.locale, err.message)); throw err; }
  });

  const reminderFail = (c: Context<E>, err: unknown): never => { if (err instanceof ReminderError) fail(err.status, tr(user(c).locale, err.message)); throw err; };
  api.get("/reminder-call", (c) => c.json(reminderView(user(c).id)));
  api.put("/reminder-call", async (c) => { try { return c.json(saveReminderSettings(user(c).id, await json(c))); } catch (err) { return reminderFail(c, err); } });
  api.delete("/reminder-call", (c) => c.json({ removed: removeReminderSettings(user(c).id) }));
  api.post("/reminder-call/test", async (c) => {
    const u = user(c);
    try { await placeReminderCall(u.id, { botId: null, botName: "Sklubot" }, tr(u.locale, "This is a test of your reminder calls. Everything works.")); return c.json(reminderView(u.id)); }
    catch (err) { return reminderFail(c, err); }
  });

  api.get("/openrouter/credit-alert", (c) => c.json(creditAlertView(user(c).id)));
  api.put("/openrouter/credit-alert", async (c) => {
    const u = user(c);
    try { return c.json(setCreditAlert(u.id, (await json(c)).thresholdUsd)); } catch (err) { return fail(400, tr(u.locale, (err as Error).message)); }
  });
  api.post("/openrouter/credit-alert/check", async (c) => {
    const u = user(c);
    if (checks.over(u.id)) fail(429, tr(u.locale, "Too many tries. Wait a little and try again."));
    const r = await checkOpenRouterCredit(u.id);
    return c.json({ ...creditAlertView(u.id), alerted: r.alerted });
  });
}
