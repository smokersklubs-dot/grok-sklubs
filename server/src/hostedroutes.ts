import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { apiProviders } from "./apimodels.js";
import { PLANNED_PROVIDERS, PROVIDERS } from "./billing/provider.js";
import { config } from "./config.js";
import { paddleKeys } from "./billing/paddle.js";
import { creditPacks, paddleLegacyWebhook, PAY_PATH, paymentsInfo, paymentsOn, registerCreditsPrivate, registerCreditsPublic } from "./credits.js";
import {
  accountView, adminActions, adminLog, adminLogList, customers, hm, HostedError, hostedMode, hostedSettings, isOperator, ownerAccountId,
  planInvites, plans,
} from "./hosted.js";
import { legalNoticePage, PAGE_CSP, payPage, payPageCsp, pricingPage, termsPage } from "./hostedpages.js";
import { pickLocale } from "./i18n.js";
import type { Locale } from "./shared.js";
import { users, type UserRecord } from "./store.js";
import { amountText, caps as usageCaps, cleanCapInput, operatorCapsOf } from "./usagecaps.js";

/**
 * The hosted mode's routes (hosted.ts). They are always registered — so the route table, and the isolation suite that
 * walks it, is the same with the mode on or off — and answer exactly like an unknown address while HOSTED_MODE is off:
 * the API ones 404 ("No such endpoint."), the public pages fall through to the web app as any other path would.
 *
 * Administration: operators only (the owner and the accounts the owner made operators). Anyone else gets the same 404 as
 * for an unknown address, so the routes do not even admit they exist. Every change is written to the administration log.
 */

const NOT_FOUND = { error: "No such endpoint." };
const json = async (c: Context): Promise<Record<string, any>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b : {}; };
const userOf = (c: Context) => c.get("user") as UserRecord;
const actorOf = (u: UserRecord) => ({ id: u.id, label: u.email });

function handle(fn: (c: Context) => Promise<Response> | Response, opts: { admin?: boolean } = {}) {
  return async (c: Context) => {
    if (!hostedMode()) return c.json(NOT_FOUND, 404);
    const user = c.get("user") as UserRecord | undefined;
    if (opts.admin && (!user || !isOperator(user.id))) return c.json(NOT_FOUND, 404);
    try { return await fn(c); } catch (err) {
      if (err instanceof HostedError) {
        const loc: Locale = user?.locale ?? pickLocale(undefined, c.req.header("accept-language"));
        return c.json({ error: err.text(loc), ...(err.code ? { code: err.code } : {}) }, err.status);
      }
      throw err;
    }
  };
}

const publicLinks = (loc: Locale) => (loc === "fr"
  ? { pricing: "/tarifs", terms: "/cgu", legal: "/mentions-legales", privacy: "/confidentialite" }
  : { pricing: "/pricing", terms: "/terms", legal: "/legal-notice", privacy: "/privacy" });

/** Routes without a session: the offered plans (sign-up form), a plan invitation, and the payment webhooks. */
export function registerHostedPublic(api: Hono<any>) {
  api.get("/plans", handle((c) => {
    const s = hostedSettings.get();
    const loc = pickLocale(c.req.query("locale"), c.req.header("accept-language"));
    return c.json({ plans: plans.offered(), trialDays: s.trialDays, defaultPlan: s.signupDefaultPlan, contactUrl: s.contactUrl, links: publicLinks(loc), credits: { packs: creditPacks(), payments: paymentsOn() } });
  }));
  api.get("/plan-invites/:token", handle((c) => {
    const inv = planInvites.peek(c.req.param("token") ?? "");
    if (!inv) throw new HostedError(404, "This invitation has expired or was already used. Ask for a new one.");
    return c.json({ invite: { plan: inv.plan, email: inv.email } });
  }));
  // Payment webhooks. Paddle's (credits.ts) at /billing/paddle/webhook; the older /billing/webhook/:provider address
  // (billing/provider.ts): Paddle once configured, else 501 "not connected" for the providers it names; nothing changes.
  registerCreditsPublic(api);
  api.post("/billing/webhook/:provider", handle(async (c) => {
    const id = c.req.param("provider") ?? "";
    if (id === "paddle") { const r = await paddleLegacyWebhook(c); if (r) return r; }
    if ((PLANNED_PROVIDERS as readonly string[]).includes(id) && !PROVIDERS[id])
      throw new HostedError(501, "Payments by {provider} are not connected on this server yet: the operator marks payments by hand (manual). See docs/MODE-HEBERGE.md.", { provider: id }, "not_implemented");
    return c.json(NOT_FOUND, 404);
  }));
}

/** The public pages (no session, no script). With the mode off they fall through to the web app, like any other path. */
export function registerHostedPages(site: Hono<any>) {
  const headers = { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": PAGE_CSP };
  const pages: [string, (loc: "fr" | "en") => string, "fr" | "en"][] = [
    ["/tarifs", (l) => pricingPage(l, plans.offered(), hostedSettings.get()), "fr"],
    ["/pricing", (l) => pricingPage(l, plans.offered(), hostedSettings.get()), "en"],
    ["/cgu", (l) => termsPage(l, hostedSettings.get().legal, hostedSettings.get()), "fr"],
    ["/terms", (l) => termsPage(l, hostedSettings.get().legal, hostedSettings.get()), "en"],
    ["/mentions-legales", (l) => legalNoticePage(l, hostedSettings.get().legal), "fr"],
    ["/legal-notice", (l) => legalNoticePage(l, hostedSettings.get().legal), "en"],
  ];
  for (const [p, render, loc] of pages) site.get(p, async (c, next) => (hostedMode() ? c.html(render(loc), 200, headers) : next()));
  // Paddle's checkout links land here (credits.ts PAY_PATH): Paddle.js opens the checkout. Only once Paddle is configured.
  site.get(PAY_PATH, async (c, next) => {
    const keys = hostedMode() ? paddleKeys() : null;
    if (!keys) return next();
    const nonce = randomBytes(16).toString("base64");
    const loc = pickLocale(undefined, c.req.header("accept-language")) === "fr" ? "fr" : "en";
    return c.html(payPage(loc, { env: keys.env, clientToken: keys.clientToken, publicUrl: config.publicUrl, nonce }), 200, {
      "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "content-security-policy": payPageCsp(nonce),
    });
  });
}

/** Routes for signed-in people (after the session middleware). */
export function registerHostedPrivate(api: Hono<any>) {
  // "Mon abonnement": the caller's own plan, status and usage.
  api.get("/billing", handle((c) => c.json(accountView(userOf(c).id))));
  // Settings → Credits: balance, packs, history, Paddle checkout (credits.ts).
  registerCreditsPrivate(api);

  // ── Administration (operators only) ──
  const admin = (fn: (c: Context) => Promise<Response> | Response) => handle(fn, { admin: true });
  const overview = (u: UserRecord) => ({
    customers: customers(), plans: plans.list(), settings: hostedSettings.get(), invites: planInvites.list(), audit: adminLogList(100),
    providers: apiProviders.list(u.id).map((p) => ({ id: p.id, name: p.name, models: p.models.map((m) => m.id), hasKey: p.hasKey, lent: !!apiProviders.lentFlags(u.id)[p.id] })),
    owner: ownerAccountId() === u.id, me: u.id, payments: paymentsOn(), paymentsInfo: paymentsInfo(),
  });
  api.get("/admin/overview", admin((c) => c.json(overview(userOf(c)))));
  api.get("/admin/customers", admin((c) => c.json({ customers: customers() })));
  api.get("/admin/customers/:uid/audit", admin((c) => c.json({ audit: adminLogList(200, c.req.param("uid")) })));
  const onCustomer = (fn: (actor: { id: string; label: string }, uid: string, b: Record<string, any>) => void) => admin(async (c) => {
    const b = await json(c);
    fn(actorOf(userOf(c)), c.req.param("uid") ?? "", b);
    return c.json({ customers: customers(), audit: adminLogList(100) });
  });
  api.put("/admin/customers/:uid/plan", onCustomer((a, uid, b) => adminActions.setPlan(a, uid, String(b.planId ?? ""))));
  api.put("/admin/customers/:uid/status", onCustomer((a, uid, b) => adminActions.setStatus(a, uid, b.status, b.periodEnd)));
  api.post("/admin/customers/:uid/paid", onCustomer((a, uid, b) => adminActions.markPaid(a, uid, b.until, b.reference)));
  api.post("/admin/customers/:uid/credit", onCustomer((a, uid, b) => adminActions.credit(a, uid, b.amountEur, b.note, b.lasting === true)));
  api.post("/admin/customers/:uid/trial", onCustomer((a, uid, b) => adminActions.extendTrial(a, uid, b.days)));
  api.put("/admin/customers/:uid/operator", onCustomer((a, uid, b) => adminActions.setOperator(a, uid, b.on === true)));
  // Usage caps the operator sets on a customer's account (usagecaps.ts, set_by 'operator'): they count what the service's
  // keys pay for, the customer sees them and cannot change them. Not on an operator's account (they have no plan).
  const capCustomer = (uid: string) => {
    if (!users.byId(uid)) throw new HostedError(404, "That account does not exist.");
    if (isOperator(uid)) throw new HostedError(409, "This account is an operator of the server: it has no plan.");
    return uid;
  };
  api.get("/admin/customers/:uid/caps", admin((c) => c.json({ caps: operatorCapsOf(capCustomer(c.req.param("uid") ?? "")) })));
  api.put("/admin/customers/:uid/caps", admin(async (c) => {
    const u = userOf(c);
    const uid = capCustomer(c.req.param("uid") ?? "");
    const f = cleanCapInput({ ...(await json(c)), botId: null });
    if (usageCaps.set(uid, f, "operator", u.id)) {
      const what = `${f.period === "day" ? "daily" : "monthly"} ${f.unit === "usd" ? "spending" : "token"} cap`;
      adminLog(actorOf(u), uid, "cap", f.limit === null ? `${what} removed` : `${what}: ${amountText(f.unit, f.limit, "en")}, stops ${f.mode === "everything" ? "everything" : "unattended work"}, warning at ${f.warnPercent}%`);
    }
    return c.json({ caps: operatorCapsOf(uid), audit: adminLogList(100) });
  }));

  api.get("/admin/plans", admin((c) => c.json({ plans: plans.list() })));
  api.post("/admin/plans", admin(async (c) => {
    const u = userOf(c);
    const p = plans.save(await json(c), u.id);
    adminLog(actorOf(u), null, "plan-create", `${p.id} (${p.kind}, ${p.priceEur} €/month, AI budget ${p.aiBudgetEur} €)`);
    return c.json({ plan: p, plans: plans.list() });
  }));
  api.put("/admin/plans/:planId", admin(async (c) => {
    const u = userOf(c);
    const p = plans.save(await json(c), u.id, c.req.param("planId"));
    adminLog(actorOf(u), null, "plan-edit", `${p.id} (${p.kind}, ${p.priceEur} €/month, AI budget ${p.aiBudgetEur} €, bots ${p.maxBots ?? "∞"}, computers ${p.maxAwakeComputers ?? "∞"}, storage ${p.storageGb ?? "∞"} GB, routines ${p.maxRoutines ?? "∞"}${p.archived ? ", archived" : ""})`);
    return c.json({ plan: p, plans: plans.list() });
  }));

  api.get("/admin/settings", admin((c) => c.json({ settings: hostedSettings.get() })));
  api.put("/admin/settings", admin(async (c) => {
    const u = userOf(c);
    const before = hostedSettings.get();
    const s = hostedSettings.save(await json(c), u.id);
    const changed = (Object.keys(s) as (keyof typeof s)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(before[k]));
    adminLog(actorOf(u), null, "settings", changed.length ? `changed: ${changed.join(", ")}` : "saved (no change)");
    return c.json({ settings: s });
  }));

  api.get("/admin/invites", admin((c) => c.json({ invites: planInvites.list() })));
  api.post("/admin/invites", admin(async (c) => {
    const u = userOf(c);
    const b = await json(c);
    const email = String(b.email ?? "").trim().slice(0, 200);
    if (email && !/^[^@\s]+@[^@\s]+$/.test(email)) throw new HostedError(400, "This invitation is for another e-mail address.");
    const { invite, token } = planInvites.create(String(b.planId ?? ""), email, b.days === undefined ? 14 : Number(b.days), u.id);
    adminLog(actorOf(u), null, "invite", `plan ${invite.planId}${email ? ` for ${email}` : ""}, valid until ${new Date(invite.expiresAt).toISOString().slice(0, 10)}`);
    // The link is shown once, to the operator who made it; only a hash of the token is kept.
    return c.json({ invite: { ...invite, link: `${config.publicUrl}/?plan_invite=${encodeURIComponent(token)}` }, invites: planInvites.list() });
  }));
  api.delete("/admin/invites/:inviteId", admin((c) => {
    const u = userOf(c);
    const inv = planInvites.view(c.req.param("inviteId") ?? "");
    if (inv) { planInvites.remove(inv.id); adminLog(actorOf(u), null, "invite-remove", `plan ${inv.planId}${inv.email ? ` for ${inv.email}` : ""}`); }
    return c.json({ invites: planInvites.list() });
  }));

  api.get("/admin/audit", admin((c) => c.json({ audit: adminLogList(Number(c.req.query("limit")) || 200) })));

  // An operator's own API provider (Settings → Models) lent to hosted accounts whose plan uses operator keys.
  api.put("/admin/providers/:pid/lend", admin(async (c) => {
    const u = userOf(c);
    const b = await json(c);
    const id = c.req.param("pid") ?? "";
    if (!apiProviders.setLent(u.id, id, b.on === true)) throw new HostedError(404, "That provider does not exist.");
    adminLog(actorOf(u), null, "provider-lend", `${apiProviders.get(u.id, id)?.name ?? id}: ${b.on === true ? "lent to hosted accounts" : "no longer lent"}`);
    return c.json(overview(u));
  }));
}

/** The text of a 403 for a suspended (read-only) account, in its language. */
export const suspendedText = (loc: Locale) => hm(loc, "Your account is suspended: it is read-only. You can sign in, look at and export your data, or delete your account. To reactivate it, settle your subscription (Settings → My subscription).");
