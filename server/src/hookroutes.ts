import type { Context, Hono } from "hono"; import { localize } from "./lang/index.js";
import { isPaused } from "./agent/loop.js";
import { hookLimits } from "./hardening.js";
import { deliveryKeys, GROUP_CHOICES, GROUP_MAX_CALLS, hookTrust, newSecret, signSample, verifySignature, type HookSettings, type RefusalReason } from "./hooktrust.js";
import { fail } from "./routeinput.js";
import { routines, type RoutineRecord } from "./routines.js";
import { fireRoutine } from "./scheduler.js";
import { audit, bots, clip, type UserRecord } from "./store.js";

/**
 * Webhooks (L20, hooktrust.ts) — the routes.
 *
 * Public (no session; the address is the credential, plus the signature when the webhook has a secret):
 *   POST /hooks/:token                      a call: checked (size, signature, rate, repeat), then runs the routine — or
 *                                           waits for the end of its burst window. Answers:
 *                                           200 { ok } · { ok, duplicate: true } · { ok, grouped: true } ·
 *                                           { ok, skipped: "paused" | "usage_cap" } · 401 signature · 404 · 413 · 429
 * Behind the session (the routine's owner; anyone else 404):
 *   GET    /routines/:id/hook               { signed, secretSetAt, previousUntil, groupSec, refusals, pending }
 *   POST   /routines/:id/hook/secret        { secret? }  a pasted secret, or a new one — returned ONCE in { secret }
 *   DELETE /routines/:id/hook/secret        back to unsigned (the address alone)
 *   PUT    /routines/:id/hook               { groupSec }  0 (off), 10, 30, 60, 300 or 600
 *   POST   /routines/:id/hook/test          « Envoyer un exemple »: the whole check on a signed sample; nothing runs
 */
type Env = { Variables: { user: UserRecord } };

const FR: Record<string, string> = {
  "That routine does not exist.": "Cette routine n'existe pas.",
  "Only a routine started by a web address has these settings.": "Seule une routine lancée par une adresse web a ces réglages.",
  "A pasted secret must be 8 to 300 characters, without spaces.": "Une clé collée doit faire de 8 à 300 caractères, sans espace.",
  "Choose 0, 10, 30, 60, 300 or 600 seconds.": "Choisis 0, 10, 30, 60, 300 ou 600 secondes.",
};
const m = (c: Context<Env>, en: string) => localize(c.get("user").locale, en, FR);

/** Burst windows waiting to close, per routine. */
const windows = new Map<string, NodeJS.Timeout>();

function flush(routineId: string) {
  windows.delete(routineId);
  const r = routines.byId(routineId);
  const calls = hookTrust.takePending(routineId);
  if (!r || !calls.length) return;
  if (calls.length === 1) { fireRoutine(r, calls[0] ?? undefined, { outside: true }); return; }
  const kept = calls.slice(0, GROUP_MAX_CALLS);
  fireRoutine(r, { calls: calls.length, items: kept }, {
    outside: true,
    label: `[${calls.length} calls to this address arrived close together and are handled in this one run${calls.length > kept.length ? ` (the first ${kept.length} are shown)` : ""}; the data of each, in order]`,
  });
}
function openWindow(r: RoutineRecord, sec: number) {
  if (windows.has(r.id)) return;
  const timer = setTimeout(() => { try { flush(r.id); } catch (err) { console.error("[hooks] grouped run", err); } }, sec * 1000);
  timer.unref?.();
  windows.set(r.id, timer);
}

const parse = (raw: string): unknown => { if (!raw) return undefined; try { return JSON.parse(raw); } catch { return raw; } };

export function registerHookRoutes(api: Hono<Env>, clientIp: (c: Context) => string) {
  // Calls left waiting by a restart: their window closes shortly after start-up.
  for (const id of hookTrust.pendingRoutines()) { const r = routines.byId(id); if (r) openWindow(r, 5); }

  /** Outside systems call this address to set a webhook routine in motion. The token is the credential. */
  api.post("/hooks/:token", async (c) => {
    const ip = clientIp(c);
    // L7: a client trying addresses, or a sender flooding one hook (each call starts a turn of the bot), is slowed down.
    if (hookLimits.perAddress.over(ip)) fail(429, "Too many requests. Wait a minute and try again.");
    const r = routines.byHook(c.req.param("token") ?? "");
    if (!r) return fail(404, "Unknown or paused hook.");
    const refuse = (reason: RefusalReason, status: 401 | 404 | 413 | 429, message: string, detail = ""): never => { hookTrust.refuse(r.id, reason, detail, ip); return fail(status, message); };
    if (!r.enabled) refuse("paused", 404, "Unknown or paused hook.");
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length > 200_000) refuse("too_large", 413, "Payload too large.", `${bytes.length} bytes`);
    const header = (name: string) => c.req.header(name);
    // A signed webhook: an unsigned or wrongly signed call is refused before it uses the hook's rate budget.
    const secrets = hookTrust.secrets(r.id);
    if (secrets === null) refuse("secret_unreadable", 401, "This webhook's signing secret cannot be read on the server: its owner must set it again.");
    if (secrets!.length) {
      const v = verifySignature(secrets!, header, bytes);
      if (!v.ok) refuse(v.reason, 401, v.reason === "no_signature" ? "This webhook requires a signature." : v.reason === "stale_timestamp" ? "Signature timestamp out of range." : "Invalid signature.");
    }
    if (hookLimits.perHook.over(r.id)) refuse("rate_limited", 429, "Too many requests. Wait a minute and try again.");
    const raw = bytes.toString("utf8");
    const payload = parse(raw);
    // The same delivery sent again (a retry after a timeout): acknowledged, never run twice.
    const keys = deliveryKeys(header, payload);
    if (!hookTrust.claimDelivery(r.id, keys)) {
      hookTrust.refuse(r.id, "duplicate", keys[0]?.replace(/^(id|sig):/, "").slice(0, 80) ?? "", ip);
      return c.json({ ok: true, duplicate: true });
    }
    // Burst grouping: the call waits for its window to close, then one run handles every call of the window.
    const group = hookTrust.settings(r.id).groupSec;
    if (group > 0) { hookTrust.hold(r.id, payload); openWindow(r, group); return c.json({ ok: true, grouped: true }); }
    // Whoever holds the hook's address can send anything: the payload is outside content for the turn it starts.
    // "Pause": a paused bot's webhook is recorded as skipped (like any routine run), and the sender is told so — with a
    // 2xx, so senders that retry on errors do not pile calls up while it is paused.
    const fired = fireRoutine(r, payload, { outside: true });
    if (fired === "paused") return c.json({ ok: true, skipped: "paused" });
    // A usage cap stops the bot's unattended work: recorded as skipped (usagecaps.ts), told with a 2xx for the same reason.
    if (fired === "capped") return c.json({ ok: true, skipped: "usage_cap" });
    return c.json({ ok: true });
  });
}

export function registerHookSettingsRoutes(api: Hono<Env>) {
  const own = (c: Context<Env>): RoutineRecord => {
    const r = routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, m(c, "That routine does not exist."));
    if (r.trigger !== "webhook") fail(400, m(c, "Only a routine started by a web address has these settings."));
    return r;
  };
  const view = (r: RoutineRecord): HookSettings => hookTrust.settings(r.id);

  api.get("/routines/:id/hook", (c) => c.json(view(own(c)), 200, { "cache-control": "no-store" }));

  api.post("/routines/:id/hook/secret", async (c) => {
    const r = own(c);
    const b = await c.req.json().catch(() => ({})) as { secret?: unknown };
    const pasted = typeof b?.secret === "string" ? b.secret.trim() : "";
    if (pasted && (pasted.length < 8 || pasted.length > 300 || /\s/.test(pasted))) fail(400, m(c, "A pasted secret must be 8 to 300 characters, without spaces."));
    const secret = pasted || newSecret();
    hookTrust.setSecret(r.id, secret);
    audit(c.get("user").id, "routine", `${r.name}: webhook signing secret ${pasted ? "pasted" : "created"}`, r.botId);
    // Shown once: a created secret is returned this one time; a pasted one is never sent back.
    return c.json({ ...view(r), ...(pasted ? {} : { secret }) }, 200, { "cache-control": "no-store" });
  });

  api.delete("/routines/:id/hook/secret", (c) => {
    const r = own(c);
    hookTrust.clearSecret(r.id);
    audit(c.get("user").id, "routine", `${r.name}: webhook signature turned off (unsigned)`, r.botId);
    return c.json(view(r));
  });

  api.put("/routines/:id/hook", async (c) => {
    const r = own(c);
    const b = await c.req.json().catch(() => ({})) as { groupSec?: unknown };
    const sec = Number(b?.groupSec);
    if (!(GROUP_CHOICES as readonly number[]).includes(sec)) fail(400, m(c, "Choose 0, 10, 30, 60, 300 or 600 seconds."));
    hookTrust.setGroup(r.id, sec);
    // Turned off while calls waited: they run now.
    if (sec === 0 && hookTrust.settings(r.id).pending) { const t = windows.get(r.id); if (t) clearTimeout(t); flush(r.id); }
    return c.json(view(r));
  });

  // « Envoyer un exemple »: a sample call goes through every check a real call meets (signed with the stored secret),
  // without recording it, using the rate budget, or running the routine. The answer says what a real call would do.
  api.post("/routines/:id/hook/test", (c) => {
    const r = own(c);
    const fr = c.get("user").locale === "fr";
    const sample = { exemple: true, message: fr ? "Appel d'essai envoyé par Sklubot depuis la page de la routine." : "Test call sent by Sklubot from the routine's page.", at: new Date().toISOString() };
    const raw = Buffer.from(JSON.stringify(sample), "utf8");
    const secrets = hookTrust.secrets(r.id);
    const headers = secrets?.length ? signSample(secrets[0], raw, `test_${Date.now()}`) : {};
    const verdict = secrets?.length ? verifySignature(secrets, (n) => headers[n.toLowerCase()], raw) : null;
    const bot = bots.byId(r.botId);
    const checks = [
      { id: "address", ok: true },
      { id: "active", ok: r.enabled },
      { id: "signature", ok: secrets === null ? false : verdict ? verdict.ok : true, unsigned: !!secrets && !secrets.length, unreadable: secrets === null },
      { id: "bot", ok: !!bot && !isPaused(bot) },
    ];
    const group = hookTrust.settings(r.id).groupSec;
    const wouldRun = checks.every((x) => x.ok);
    return c.json({
      wouldRun, grouped: wouldRun && group > 0 ? group : 0, checks, sample,
      headers: Object.keys(headers),
      preview: clip(`${r.prompt}\n\n[Data received with this call]\n${JSON.stringify(sample, null, 2)}`, 1200),
    });
  });
}
