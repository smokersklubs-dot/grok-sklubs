import { randomBytes } from "node:crypto"; import { localize } from "./lang/index.js";
import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { emit } from "./bus.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { setProviderGate, type LlmProvider, type TurnResult } from "./llm/index.js";
import type {
  AdminAuditEntry, AdminCustomer, HostedAccountView, HostedEstimates, HostedLegal, HostedNoticeAction, HostedPlan, HostedSettings,
  HostedStopReason, Locale, PlanInviteView, PlanKind, PlanLimitKind, RowBody, SubscriptionStatus,
} from "./shared.js";
import { audit, bots, clip, newId, now, rows, sha256, users, type BotRecord } from "./store.js";
import { recordEstimate, setPayerHook } from "./usage.js";
import { setBotGuard } from "./store.js";
import { setRoutineGuard } from "./routines.js";
import { setLibraryWriteGuard } from "./computer.js";
import { linuxMachines, setAwakeLimit } from "./linux.js";

/**
 * The commercial "hosted mode" (docs/MODE-HEBERGE.md): plans, customer accounts and their statuses, metering of what the
 * operator's keys pay for, the hard stop at the end of a plan's AI budget, plan limits, and the operator's administration.
 *
 * Everything here is behind HOSTED_MODE=1. With it off, every hook below answers "nothing to say" and the server behaves
 * exactly as a self-hosted Sklubot (server/test/hosted-off.test.ts proves it).
 *
 * Who is who:
 *  - Operators: the instance owner (the oldest account, as in googlelogin.ts) and accounts the owner made operators
 *    (users.server_role = 'operator'). They have no plan, no limit, and are never metered against a budget.
 *  - Customers: every other account. Each has one subscription row (plan + status). An account that existed before
 *    hosted mode was turned on gets the "free" plan the first time it is looked at; the operator can change it.
 *
 * Money: usage lines say who pays (usage.payer). "operator" lines — the server's .env providers, an operator's own
 * provider lent to hosted accounts, the image / video / voice services and paid third-party tools on the server's keys —
 * count against the plan's monthly AI budget, converted from USD with the operator's rate. "own" lines (the customer's
 * own keys) and "subscription" lines (their own Claude / ChatGPT sign-in) never do. Unknown prices count at their
 * conservative estimate (est_cost_usd), as everywhere else in Sklubot.
 */

export const hostedMode = () => process.env.HOSTED_MODE === "1" || process.env.HOSTED_MODE === "true";

// ── Texts (English is the key; French below) ─────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "This month's AI budget of your plan ({budget} €) is used up on the service's AI keys. Top up your budget, switch this bot to your own API key (Settings → Models), or wait until {date}, when it starts again.":
    "Le budget IA du mois de ton offre ({budget} €) est épuisé sur les clés d'IA du service. Recharge ton budget, passe ce bot sur ta propre clé d'API (Réglages → Modèles), ou attends le {date}, quand il repart à zéro.",
  "Your account is suspended, so your bots are paused and nothing runs. You can still sign in, look at and export your data, or delete your account. To reactivate it, settle your subscription (Settings → Credits).":
    "Ton compte est suspendu : tes bots sont en pause et rien ne tourne. Tu peux toujours te connecter, consulter et exporter tes données, ou supprimer ton compte. Pour le réactiver, règle ton abonnement (Réglages → Crédits).",
  "Your plan uses your own API keys only, and this bot's model runs on the service's keys. Add your key in Settings → Models (API providers), then choose one of its models for this bot.":
    "Ton offre utilise uniquement tes propres clés d'API, et le modèle de ce bot tourne sur les clés du service. Ajoute ta clé dans Réglages → Modèles (fournisseurs d'API), puis choisis un de ses modèles pour ce bot.",
  "This bot runs on its owner's personal Claude or ChatGPT subscription, which only its owner may use. Ask its owner to give it an API model to share it.":
    "Ce bot tourne sur l'abonnement Claude ou ChatGPT personnel de son propriétaire, que lui seul peut utiliser. Demande-lui de lui donner un modèle d'API pour le partager.",
  "Claude Code and Codex subscriptions are not available on this service. Choose an API model for this bot (its settings → Brain).":
    "Les abonnements Claude Code et Codex ne sont pas disponibles sur ce service. Choisis un modèle d'API pour ce bot (ses réglages → Cerveau).",
  "Your plan allows {n} bots. Remove one, or change plan (Settings → Credits), to create another.":
    "Ton offre permet {n} bots. Supprimes-en un, ou change d'offre (Réglages → Crédits), pour en créer un autre.",
  "Your plan allows {n} active routines. Pause or remove one, or change plan (Settings → Credits), to add another.":
    "Ton offre permet {n} routines actives. Mets-en une en pause ou supprime-la, ou change d'offre (Réglages → Crédits), pour en ajouter une.",
  "Your plan allows {n} computer(s) awake at once, and they are all busy. Wait a moment and try again, put one to sleep (Settings → Computers), or change plan (Settings → Credits).":
    "Ton offre permet {n} ordinateur(s) allumé(s) en même temps, et ils sont tous occupés. Attends un peu puis réessaie, mets-en un en veille (Réglages → Ordinateurs), ou change d'offre (Réglages → Crédits).",
  "Your plan's storage ({limit}) is full ({used} used). Delete files from your bots' libraries, or change plan (Settings → Credits).":
    "Le stockage de ton offre ({limit}) est plein ({used} utilisés). Supprime des fichiers des bibliothèques de tes bots, ou change d'offre (Réglages → Crédits).",
  "Your account is suspended: it is read-only. You can sign in, look at and export your data, or delete your account. To reactivate it, settle your subscription (Settings → Credits).":
    "Ton compte est suspendu : il est en lecture seule. Tu peux te connecter, consulter et exporter tes données, ou supprimer ton compte. Pour le réactiver, règle ton abonnement (Réglages → Crédits).",
  "You must accept the terms of service (CGU) to create an account.": "Tu dois accepter les conditions générales (CGU) pour créer un compte.",
  "This plan does not exist or is no longer offered.": "Cette offre n'existe pas ou n'est plus proposée.",
  "This invitation has expired or was already used. Ask for a new one.": "Cette invitation a expiré ou a déjà servi. Demandes-en une nouvelle.",
  "This invitation is for another e-mail address.": "Cette invitation est pour une autre adresse e-mail.",
  "Only an operator of this server can do this.": "Seul un opérateur de ce serveur peut faire ça.",
  "Only the owner of this server can do this.": "Seule la personne propriétaire de ce serveur peut faire ça.",
  "That account does not exist.": "Ce compte n'existe pas.",
  "This account is an operator of the server: it has no plan.": "Ce compte est un opérateur du serveur : il n'a pas d'offre.",
  "Choose a status: trial, active, past_due or suspended.": "Choisis un statut : trial, active, past_due ou suspended.",
  "Enter an amount in euros (more than 0, at most 10000).": "Indique un montant en euros (plus de 0, 10 000 au maximum).",
  "Enter a number of days between 1 and 365.": "Indique un nombre de jours entre 1 et 365.",
  "Enter a date in the future.": "Indique une date dans le futur.",
  "Give the plan a name in French and in English.": "Donne un nom à l'offre en français et en anglais.",
  "The plan id: lowercase letters, digits and dashes (2 to 40).": "L'identifiant de l'offre : minuscules, chiffres et tirets (2 à 40).",
  "A plan with this id already exists.": "Une offre avec cet identifiant existe déjà.",
  "A plan's kind is free, included or byok.": "Le type d'une offre est free, included ou byok.",
  "That plan does not exist.": "Cette offre n'existe pas.",
  "The contact address must be an https:// or mailto: address.": "L'adresse de contact doit commencer par https:// ou mailto:.",
  "That provider does not exist.": "Ce fournisseur n'existe pas.",
  "The owner is always an operator.": "La personne propriétaire est toujours opératrice.",
  "Payments by {provider} are not connected on this server yet: the operator marks payments by hand (manual). See docs/MODE-HEBERGE.md.":
    "Les paiements par {provider} ne sont pas encore branchés sur ce serveur : l'opérateur enregistre les paiements à la main (manuel). Voir docs/MODE-HEBERGE.md.",
  "Your trial or your paid period is over. Settle your subscription (Settings → Credits) to keep your bots running.":
    "Ton essai ou ta période payée est terminé(e). Règle ton abonnement (Réglages → Crédits) pour que tes bots continuent de tourner.",
  "Your free trial ends on {date}.": "Ton essai gratuit se termine le {date}.",
  "Your account moved from {from} to {to}.": "Ton compte est passé de {from} à {to}.",
  "{amount} € of credits added to your account. Your bots can use the service's AI models again.": "{amount} € de crédits ajoutés à ton compte. Tes bots peuvent de nouveau utiliser les modèles d'IA du service.",
  "A payment was refunded: {amount} € of credits removed from your account.": "Un paiement a été remboursé : {amount} € de crédits retirés de ton compte.",
  "You have no credits left on the service's AI keys ({budget} € this month). Buy credits (Settings → Credits), connect your Claude or ChatGPT subscription, or add your own API key (Settings → Models).":
    "Tu n'as plus de crédits sur les clés d'IA du service ({budget} € ce mois-ci). Achète des crédits (Réglages → Crédits), connecte ton abonnement Claude ou ChatGPT, ou ajoute ta propre clé d'API (Réglages → Modèles).",
  "Connect your OpenRouter, ChatGPT or Claude account so your bots can think (Settings → My AI accounts). It bills you directly; nothing is paid here.":
    "Connecte ton compte OpenRouter, ChatGPT ou Claude pour que tes bots puissent réfléchir (Réglages → Mes comptes IA). Il te facture directement ; rien n'est payé ici.",
  trial: "essai", active: "actif", past_due: "paiement en retard", suspended: "suspendu",
};
export const hm = (locale: Locale | undefined, english: string, vars: Record<string, string | number> = {}) =>
  localize(locale, english, FR).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

const dateText = (locale: Locale, ms: number) => new Date(ms).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const eur = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
export const bytesText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} kB`);

/** An error a route turns into JSON in the caller's language (status + English text + its variables). */
export class HostedError extends Error {
  constructor(public status: 400 | 402 | 403 | 404 | 409 | 429 | 501 | 502 | 503, public english: string, public vars: Record<string, string | number> = {}, public code?: string) { super(english); this.name = "HostedError"; }
  text(locale: Locale | undefined) { return hm(locale, this.english, this.vars); }
}
/** Work that may not run on this account's plan right now (budget, suspension, own keys only, subscription tools). */
export class HostedStopError extends Error {
  constructor(public reason: Exclude<HostedStopReason, "limit">, public userId: string) { super(stopEnglish(reason, userId).text); this.name = "HostedStopError"; }
}
/** A plan limit reached (bots, routines, computers awake, storage). */
export class PlanLimitError extends Error {
  constructor(public kind: PlanLimitKind, public english: string, public vars: Record<string, string | number>) { super(hm("en", english, vars)); this.name = "PlanLimitError"; }
  text(locale: Locale | undefined) { return hm(locale, this.english, this.vars); }
}
export const isHostedStop = (e: unknown): e is HostedStopError => (e as Error)?.name === "HostedStopError";
export const isPlanLimit = (e: unknown): e is PlanLimitError => (e as Error)?.name === "PlanLimitError";

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────────────────
const LEGAL_KEYS: (keyof HostedLegal)[] = ["company", "legalForm", "capital", "address", "siret", "vat", "director", "email", "phone", "host", "mediator"];
/**
 * Defaults. The exchange rate and the estimates are the OPERATOR's settings, not facts: the rate changes every day and the
 * estimates stand for services that report no price per call; both are shown and editable in Settings → Administration.
 */
export const DEFAULT_SETTINGS: HostedSettings = {
  usdToEur: 0.92, trialDays: 14, graceDays: 7, trialBudgetEur: 2, contactUrl: "", signupDefaultPlan: "free", subscriptionEngines: true, creditPacksEur: [5, 10, 20], creditsForSale: false,
  estimates: { imageUsd: 0.2, videoUsd: 2, sttUsdPerMinute: 0.02, ttsUsdPer1kChars: 0.03 },
  legal: Object.fromEntries(LEGAL_KEYS.map((k) => [k, ""])) as unknown as HostedLegal,
};
const num = (v: unknown, min: number, max: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : dflt; };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\0-\x08\x0b-\x1f]/g, "").trim().slice(0, max) : "");

export function cleanSettings(raw: any, base: HostedSettings = DEFAULT_SETTINGS): HostedSettings {
  const r = raw && typeof raw === "object" ? raw : {};
  const e = r.estimates && typeof r.estimates === "object" ? r.estimates : {};
  const l = r.legal && typeof r.legal === "object" ? r.legal : {};
  const contact = r.contactUrl === undefined ? base.contactUrl : text(r.contactUrl, 300);
  return {
    usdToEur: num(r.usdToEur, 0.01, 100, base.usdToEur),
    trialDays: Math.round(num(r.trialDays, 0, 365, base.trialDays)),
    graceDays: Math.round(num(r.graceDays, 0, 365, base.graceDays)),
    trialBudgetEur: num(r.trialBudgetEur, 0, 100_000, base.trialBudgetEur),
    contactUrl: contact === "" || /^(https:\/\/|mailto:)[^\s<>"']+$/i.test(contact) ? contact : base.contactUrl,
    signupDefaultPlan: typeof r.signupDefaultPlan === "string" && /^[a-z0-9-]{2,40}$/.test(r.signupDefaultPlan) ? r.signupDefaultPlan : base.signupDefaultPlan,
    subscriptionEngines: typeof r.subscriptionEngines === "boolean" ? r.subscriptionEngines : base.subscriptionEngines,
    estimates: {
      imageUsd: num(e.imageUsd, 0, 1000, base.estimates.imageUsd), videoUsd: num(e.videoUsd, 0, 1000, base.estimates.videoUsd),
      sttUsdPerMinute: num(e.sttUsdPerMinute, 0, 1000, base.estimates.sttUsdPerMinute), ttsUsdPer1kChars: num(e.ttsUsdPer1kChars, 0, 1000, base.estimates.ttsUsdPer1kChars),
    } satisfies HostedEstimates,
    legal: Object.fromEntries(LEGAL_KEYS.map((k) => [k, l[k] === undefined ? base.legal[k] : text(l[k], 400)])) as unknown as HostedLegal,
    creditPacksEur: cleanPacks(r.creditPacksEur, base.creditPacksEur),
    creditsForSale: typeof r.creditsForSale === "boolean" ? r.creditsForSale : base.creditsForSale,
  };
}
/** Credit packs (€): 1 to 6 distinct amounts between 1 and 1000, at most 2 decimals, sorted. Anything else keeps the old list. */
function cleanPacks(v: unknown, dflt: number[]): number[] {
  const list = typeof v === "string" ? v.split(/[;,\s]+/).filter(Boolean) : v;
  if (!Array.isArray(list)) return dflt;
  const out = [...new Set(list.map((x) => Math.round(Number(String(x).replace(",", ".")) * 100) / 100))].filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000).sort((a, b) => a - b);
  return out.length >= 1 && out.length <= 6 && out.length === list.length ? out : dflt;
}
export const hostedSettings = {
  get(): HostedSettings {
    const r = q.get<{ value: string }>("SELECT value FROM hosted_settings WHERE id = 1");
    let parsed: unknown = {};
    try { parsed = r ? JSON.parse(r.value) : {}; } catch { parsed = {}; }
    return cleanSettings(parsed);
  },
  save(raw: unknown, by: string): HostedSettings {
    if (raw && typeof raw === "object" && typeof (raw as any).contactUrl === "string") {
      const c = (raw as any).contactUrl.trim();
      if (c && !/^(https:\/\/|mailto:)[^\s<>"']+$/i.test(c)) throw new HostedError(400, "The contact address must be an https:// or mailto: address.");
    }
    const next = cleanSettings(raw, hostedSettings.get());
    q.run("INSERT INTO hosted_settings (id, value, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by", JSON.stringify(next), now(), by);
    return next;
  },
};

// ── Operators ────────────────────────────────────────────────────────────────────────────────────────────────────
/** The instance owner: the oldest account (same rule as googlelogin.ts ownerId). */
export const ownerAccountId = (): string | null => q.get<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1")?.id ?? null;
export function isOperator(userId: string): boolean {
  if (userId === ownerAccountId()) return true;
  return q.get<{ server_role: string }>("SELECT server_role FROM users WHERE id = ?", userId)?.server_role === "operator";
}

// ── Plans ────────────────────────────────────────────────────────────────────────────────────────────────────────
const toPlan = (r: any): HostedPlan => ({
  id: r.id, kind: (["free", "included", "byok"].includes(r.kind) ? r.kind : "included") as PlanKind, nameFr: r.name_fr, nameEn: r.name_en,
  descriptionFr: r.description_fr, descriptionEn: r.description_en, priceEur: r.price_eur, aiBudgetEur: r.ai_budget_eur,
  maxBots: r.max_bots ?? null, maxAwakeComputers: r.max_awake_computers ?? null, storageGb: r.storage_gb ?? null, maxRoutines: r.max_routines ?? null,
  public: !!r.public, position: r.position, archived: !!r.archived,
});
const limitOrNull = (v: unknown, max: number, integer: boolean): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return integer ? Math.floor(n) : Math.round(n * 100) / 100;
};
export const plans = {
  list: (includeArchived = true): HostedPlan[] => q.all(`SELECT * FROM plans ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY position, created_at`).map(toPlan),
  offered: (): HostedPlan[] => plans.list(false).filter((p) => p.public),
  get: (id: string): HostedPlan | null => { const r = q.get("SELECT * FROM plans WHERE id = ?", id); return r ? toPlan(r) : null; },
  save(f: Record<string, unknown>, by: string, id?: string): HostedPlan {
    const cur = id ? plans.get(id) : null;
    if (id && !cur) throw new HostedError(404, "That plan does not exist.");
    const pid = cur ? cur.id : text(f.id, 40);
    if (!cur && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(pid)) throw new HostedError(400, "The plan id: lowercase letters, digits and dashes (2 to 40).");
    if (!cur && plans.get(pid)) throw new HostedError(409, "A plan with this id already exists.");
    const kind = f.kind === undefined && cur ? cur.kind : f.kind;
    if (kind !== "free" && kind !== "included" && kind !== "byok") throw new HostedError(400, "A plan's kind is free, included or byok.");
    const pick = <K extends keyof HostedPlan>(k: K, conv: (v: unknown) => HostedPlan[K], dflt: HostedPlan[K]): HostedPlan[K] => (f[k] === undefined ? (cur ? cur[k] : dflt) : conv(f[k]));
    const p: HostedPlan = {
      id: pid, kind,
      nameFr: pick("nameFr", (v) => text(v, 60), ""), nameEn: pick("nameEn", (v) => text(v, 60), ""),
      descriptionFr: pick("descriptionFr", (v) => text(v, 400), ""), descriptionEn: pick("descriptionEn", (v) => text(v, 400), ""),
      priceEur: pick("priceEur", (v) => num(v, 0, 100_000, 0), 0), aiBudgetEur: pick("aiBudgetEur", (v) => num(v, 0, 100_000, 0), 0),
      maxBots: pick("maxBots", (v) => limitOrNull(v, 10_000, true), null), maxAwakeComputers: pick("maxAwakeComputers", (v) => limitOrNull(v, 1000, true), null),
      storageGb: pick("storageGb", (v) => limitOrNull(v, 100_000, false), null), maxRoutines: pick("maxRoutines", (v) => limitOrNull(v, 100_000, true), null),
      public: pick("public", (v) => !!v, true), position: pick("position", (v) => Math.round(num(v, 0, 1000, 0)), 0), archived: pick("archived", (v) => !!v, false),
    };
    if (!p.nameFr || !p.nameEn) throw new HostedError(400, "Give the plan a name in French and in English.");
    const t = now();
    q.run(`INSERT INTO plans (id, kind, name_fr, name_en, description_fr, description_en, price_eur, ai_budget_eur, max_bots, max_awake_computers, storage_gb, max_routines, public, position, archived, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name_fr = excluded.name_fr, name_en = excluded.name_en,
      description_fr = excluded.description_fr, description_en = excluded.description_en, price_eur = excluded.price_eur, ai_budget_eur = excluded.ai_budget_eur,
      max_bots = excluded.max_bots, max_awake_computers = excluded.max_awake_computers, storage_gb = excluded.storage_gb, max_routines = excluded.max_routines,
      public = excluded.public, position = excluded.position, archived = excluded.archived, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      p.id, p.kind, p.nameFr, p.nameEn, p.descriptionFr, p.descriptionEn, p.priceEur, p.aiBudgetEur, p.maxBots, p.maxAwakeComputers, p.storageGb, p.maxRoutines,
      p.public ? 1 : 0, p.position, p.archived ? 1 : 0, t, t, by);
    return plans.get(p.id)!;
  },
};
export const planName = (p: HostedPlan | null, locale: Locale) => (p ? (locale === "fr" ? p.nameFr : p.nameEn) : "—");

// ── Subscriptions and statuses ───────────────────────────────────────────────────────────────────────────────────
export interface SubRecord {
  userId: string; planId: string; status: SubscriptionStatus; trialEndsAt: number | null; periodEnd: number | null; graceEndsAt: number | null;
  provider: string; externalRef: string; statusChangedAt: number; createdAt: number;
}
const STATUSES: SubscriptionStatus[] = ["trial", "active", "past_due", "suspended"];
const toSub = (r: any): SubRecord => ({
  userId: r.user_id, planId: r.plan_id, status: (STATUSES.includes(r.status) ? r.status : "active") as SubscriptionStatus, trialEndsAt: r.trial_ends_at ?? null,
  periodEnd: r.period_end ?? null, graceEndsAt: r.grace_ends_at ?? null, provider: r.provider, externalRef: r.external_ref, statusChangedAt: r.status_changed_at, createdAt: r.created_at,
});
const DAY = 86_400_000;
export const subscriptions = {
  get: (userId: string): SubRecord | null => { const r = q.get("SELECT * FROM subscriptions WHERE user_id = ?", userId); return r ? toSub(r) : null; },
  all: (): SubRecord[] => q.all("SELECT * FROM subscriptions").map(toSub),
  /** Starts an account on a plan: a free plan is active at once, another starts with the trial (if trial days > 0). */
  start(userId: string, planId: string, t = now()): SubRecord {
    const plan = plans.get(planId) ?? plans.get("free") ?? plans.list(false)[0];
    if (!plan) throw new HostedError(409, "That plan does not exist.");
    const s = hostedSettings.get();
    const trial = plan.kind !== "free" && s.trialDays > 0;
    q.run(`INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at, period_end, grace_ends_at, provider, external_ref, status_changed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, 'manual', '', ?, ?, ?) ON CONFLICT(user_id) DO NOTHING`, userId, plan.id, trial ? "trial" : "active", trial ? t + s.trialDays * DAY : null, t, t, t);
    return subscriptions.get(userId)!;
  },
  /** The account's subscription; one that has none yet (made before hosted mode) starts on the free plan. */
  ensure(userId: string): SubRecord | null {
    if (isOperator(userId)) return null;
    return subscriptions.get(userId) ?? subscriptions.start(userId, "free");
  },
  update(userId: string, f: Partial<Pick<SubRecord, "planId" | "status" | "trialEndsAt" | "periodEnd" | "graceEndsAt" | "provider" | "externalRef">>) {
    const cur = subscriptions.get(userId);
    if (!cur) return null;
    const next = { ...cur, ...f };
    q.run("UPDATE subscriptions SET plan_id = ?, status = ?, trial_ends_at = ?, period_end = ?, grace_ends_at = ?, provider = ?, external_ref = ?, status_changed_at = ?, updated_at = ? WHERE user_id = ?",
      next.planId, next.status, next.trialEndsAt, next.periodEnd, next.graceEndsAt, next.provider, next.externalRef, next.status !== cur.status ? now() : cur.statusChangedAt, now(), userId);
    return subscriptions.get(userId);
  },
};

/**
 * The status the scheduler moves a subscription to at time `t`, or null when it stays. A free plan never expires.
 *  trial → (trial ended) active if paid until later, else past_due with `graceDays` of grace from the end of the trial;
 *  active with a paid period → (period ended) past_due with grace from the period's end;
 *  past_due → active if paid meanwhile; suspended once the grace is over;
 *  suspended → only the operator (or a payment) brings it back.
 */
export function nextState(sub: Pick<SubRecord, "status" | "trialEndsAt" | "periodEnd" | "graceEndsAt">, plan: Pick<HostedPlan, "kind"> | null, t: number, graceDays: number):
  { status: SubscriptionStatus; graceEndsAt?: number | null } | null {
  const paid = sub.periodEnd !== null && sub.periodEnd > t;
  if (plan?.kind === "free") return sub.status === "trial" || sub.status === "past_due" ? { status: "active", graceEndsAt: null } : null;
  switch (sub.status) {
    case "trial":
      if (sub.trialEndsAt === null || t < sub.trialEndsAt) return null;
      return paid ? { status: "active", graceEndsAt: null } : { status: "past_due", graceEndsAt: sub.trialEndsAt + graceDays * DAY };
    case "active":
      if (sub.periodEnd === null || t < sub.periodEnd) return null;
      return { status: "past_due", graceEndsAt: sub.periodEnd + graceDays * DAY };
    case "past_due":
      if (paid) return { status: "active", graceEndsAt: null };
      if (sub.graceEndsAt !== null && t >= sub.graceEndsAt) return { status: "suspended" };
      return null;
    default:
      return null;
  }
}

/** One pass of the scheduler (every 10 minutes): moves statuses by date, with a line in both logs and a notice. */
export function hostedTick(t = now()): number {
  if (!hostedMode()) return 0;
  const s = hostedSettings.get();
  let changed = 0;
  for (const sub of subscriptions.all()) {
    if (isOperator(sub.userId)) continue;
    const next = nextState(sub, plans.get(sub.planId), t, s.graceDays);
    if (!next || next.status === sub.status) continue;
    subscriptions.update(sub.userId, { status: next.status, ...(next.graceEndsAt !== undefined ? { graceEndsAt: next.graceEndsAt } : {}) });
    statusChanged(sub.userId, sub.status, next.status, null);
    changed++;
  }
  return changed;
}

function statusChanged(userId: string, from: SubscriptionStatus, to: SubscriptionStatus, actor: { id: string; label: string } | null) {
  adminLog(actor, userId, "status", `${from} → ${to}`);
  audit(userId, "account", `Subscription status: ${from} → ${to}`);
  const loc = users.localeOf(userId);
  const main = bots.primary(userId);
  const action: HostedNoticeAction | undefined = to === "suspended" || to === "past_due" ? { kind: "plan", reason: to === "suspended" ? "suspended" : "payment", contactUrl: hostedSettings.get().contactUrl || undefined } : undefined;
  if (main) rows.append(main, { kind: "notice", tone: to === "active" || to === "trial" ? "info" : "warn", text: hm(loc, "Your account moved from {from} to {to}.", { from: hm(loc, from), to: hm(loc, to) }), ...(action ? { action } : {}) });
  emit(userId, { type: "usage" });
}

// ── The administration log ───────────────────────────────────────────────────────────────────────────────────────
export function adminLog(actor: { id: string; label: string } | null, targetId: string | null, action: string, detail: string) {
  try { q.run("INSERT INTO admin_audit (at, actor_id, actor_label, target_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)", now(), actor?.id ?? "system", actor?.label ?? "scheduler", targetId, action, clip(detail, 500)); }
  catch { /* the log never breaks the action it records */ }
}
export function adminLogList(limit = 200, targetId?: string): AdminAuditEntry[] {
  const lim = Math.min(Math.max(1, limit), 500);
  const found = targetId
    ? q.all<any>("SELECT a.*, u.email FROM admin_audit a LEFT JOIN users u ON u.id = a.target_id WHERE a.target_id = ? ORDER BY a.id DESC LIMIT ?", targetId, lim)
    : q.all<any>("SELECT a.*, u.email FROM admin_audit a LEFT JOIN users u ON u.id = a.target_id ORDER BY a.id DESC LIMIT ?", lim);
  return found.map((r) => ({ id: r.id, at: r.at, actorLabel: r.actor_label, targetId: r.target_id, targetEmail: r.email ?? null, action: r.action, detail: r.detail }));
}

// ── Money ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function monthBounds(t = now()): { start: number; end: number; label: string } {
  const d = new Date(t);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` };
}
/** What the operator's keys paid for this account this month (USD; unknown prices at their conservative estimate). */
export function operatorSpendUsd(userId: string, t = now()): number {
  return q.get<{ c: number | null }>("SELECT SUM(cost_usd + est_cost_usd) AS c FROM usage WHERE user_id = ? AND payer = 'operator' AND at >= ?", userId, monthBounds(t).start)?.c ?? 0;
}
/** The operator's top-ups for this calendar month only (they end with the month). */
export const creditEur = (userId: string, t = now()) => q.get<{ s: number | null }>("SELECT SUM(amount_eur) AS s FROM credit_topups WHERE user_id = ? AND month = ? AND kind = 'month'", userId, monthBounds(t).label)?.s ?? 0;
export function spentEur(userId: string, t = now()): number { return operatorSpendUsd(userId, t) * hostedSettings.get().usdToEur; }
/** The month's AI budget on operator keys: the plan's (capped at the trial budget during a trial) plus top-ups. */
export function budgetEur(userId: string, t = now()): number {
  const sub = subscriptions.ensure(userId);
  if (!sub) return Infinity;
  return planBaseEur(userId, t) + creditEur(userId, t) + prepaidAvailableEur(userId, t);
}
/** The plan's own AI budget this month (capped at the trial budget during a trial; none on "bring your own key"). */
export function planBaseEur(userId: string, _t = now()): number {
  const sub = subscriptions.ensure(userId);
  const plan = sub ? plans.get(sub.planId) : null;
  if (!sub || !plan || plan.kind === "byok") return 0;
  return sub.status === "trial" ? Math.min(plan.aiBudgetEur, hostedSettings.get().trialBudgetEur) : plan.aiBudgetEur;
}

// ── Prepaid credits (kind 'prepaid': bought through Paddle or given by the operator; they do not end with the month) ────
// Each month the service's keys are paid first by the plan's budget, then by that month's top-ups, then by the prepaid
// credits. What a closed month took from them is written once in credit_months (the plan's budget of that month is read
// as the account's current plan: plans rarely change, and a change only moves which month the credits were spent in).
const spendEurBetween = (userId: string, from: number, to: number) =>
  (q.get<{ c: number | null }>("SELECT SUM(cost_usd + est_cost_usd) AS c FROM usage WHERE user_id = ? AND payer = 'operator' AND at >= ? AND at < ?", userId, from, to)?.c ?? 0) * hostedSettings.get().usdToEur;
const prepaidBought = (userId: string, before = Infinity) =>
  q.get<{ s: number | null }>("SELECT SUM(amount_eur) AS s FROM credit_topups WHERE user_id = ? AND kind = 'prepaid' AND at < ?", userId, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER)?.s ?? 0;
const prepaidUsedClosed = (userId: string, beforeMonth = "9999-99") =>
  q.get<{ s: number | null }>("SELECT SUM(consumed_eur) AS s FROM credit_months WHERE user_id = ? AND month < ?", userId, beforeMonth)?.s ?? 0;
/** Prepaid credits that may pay this month (before what this month spent): bought so far minus what closed months used. */
export function prepaidAvailableEur(userId: string, t = now()): number {
  const first = q.get<{ at: number | null }>("SELECT MIN(at) AS at FROM credit_topups WHERE user_id = ? AND kind = 'prepaid'", userId)?.at;
  if (!first) return 0;
  const cur = monthBounds(t);
  const lastClosed = q.get<{ m: string | null }>("SELECT MAX(month) AS m FROM credit_months WHERE user_id = ?", userId)?.m ?? null;
  let m = monthBounds(first);
  while (lastClosed && m.label <= lastClosed) m = monthBounds(m.end);
  for (; m.start < cur.start; m = monthBounds(m.end)) {
    const avail = Math.max(0, prepaidBought(userId, m.end) - prepaidUsedClosed(userId, m.label));
    const over = spendEurBetween(userId, m.start, m.end) - planBaseEur(userId) - creditEur(userId, m.start);
    q.run("INSERT OR IGNORE INTO credit_months (user_id, month, consumed_eur, closed_at) VALUES (?, ?, ?, ?)", userId, m.label, round2(Math.min(avail, Math.max(0, over))), now());
  }
  return Math.max(0, prepaidBought(userId) - prepaidUsedClosed(userId));
}
/** Prepaid credits left right now: what may pay this month, minus what this month already took from them. */
export function prepaidLeftEur(userId: string, t = now()): number {
  const avail = prepaidAvailableEur(userId, t);
  if (avail <= 0) return 0;
  const over = spentEur(userId, t) - planBaseEur(userId, t) - creditEur(userId, t);
  return round2(Math.max(0, avail - Math.max(0, over)));
}
/** What closed months (and this one so far) took from the prepaid credits, newest first. */
export function prepaidUseByMonth(userId: string, t = now()): { month: string; spentEur: number; fromCreditsEur: number }[] {
  prepaidAvailableEur(userId, t);
  const closed = q.all<{ month: string; consumed_eur: number }>("SELECT month, consumed_eur FROM credit_months WHERE user_id = ? ORDER BY month DESC LIMIT 12", userId);
  const cur = monthBounds(t);
  const spent = spentEur(userId, t);
  const thisMonth = { month: cur.label, spentEur: round2(spent), fromCreditsEur: round2(Math.min(prepaidAvailableEur(userId, t), Math.max(0, spent - planBaseEur(userId, t) - creditEur(userId, t)))) };
  return [thisMonth, ...closed.map((r) => { const b = monthBounds(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)) - 1, 1)); return { month: r.month, spentEur: round2(spendEurBetween(userId, b.start, b.end)), fromCreditsEur: round2(r.consumed_eur) }; })];
}
/** Where prepaid credits come from: the operator by hand, or a payment (`paddle`; `stripe` only on rows from before). */
export type PrepaidSource = "manual" | "paddle";
/**
 * Adds prepaid credits. `ref` (the payment provider's transaction id) is unique: a second call with the same ref adds
 * nothing and returns false. Each addition is written to both logs and told in the account's main chat.
 */
export function addPrepaid(userId: string, amountEur: number, o: { source: PrepaidSource; ref?: string; note?: string; actor: { id: string; label: string } | null }): boolean {
  const a = round2(amountEur);
  try {
    q.run("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at, kind, source, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepaid', ?, ?)",
      newId("top"), userId, monthBounds().label, a, text(o.note, 200), o.actor?.id ?? null, now(), o.source, o.ref ?? "");
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return false;
    throw err;
  }
  adminLog(o.actor, userId, "credit", `+${eur(a)} € prepaid credits (${o.source}${o.ref ? ` ${o.ref}` : ""})${text(o.note, 200) ? ` — ${text(o.note, 200)}` : ""}`);
  audit(userId, "account", `Prepaid AI credits added: +${eur(a)} € (${o.source === "manual" ? "by the operator" : "payment"})`);
  const main = bots.primary(userId);
  const loc = users.localeOf(userId);
  if (main) rows.append(main, { kind: "notice", tone: "info", text: hm(loc, "{amount} € of credits added to your account. Your bots can use the service's AI models again.", { amount: eur(a) }) });
  emit(userId, { type: "usage" });
  return true;
}
/**
 * Removes prepaid credits after a refund (credits.ts): a negative 'prepaid' row, so the balance and the closed months stay
 * a plain sum. Never more than what is left right now (the balance never goes below 0); `ref` (the refund's id) is unique,
 * so a refund told twice removes once. Returns what was removed (0 when nothing was left, or when `ref` was seen before).
 */
export function removePrepaid(userId: string, amountEur: number, o: { source: PrepaidSource; ref: string; note?: string; actor: { id: string; label: string } | null }): number {
  const take = round2(Math.min(Math.max(0, amountEur), prepaidLeftEur(userId)));
  if (take <= 0) return 0;
  try {
    q.run("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at, kind, source, external_ref) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepaid', ?, ?)",
      newId("top"), userId, monthBounds().label, -take, text(o.note, 200), o.actor?.id ?? null, now(), o.source, o.ref);
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return 0;
    throw err;
  }
  adminLog(o.actor, userId, "credit-removed", `−${eur(take)} € prepaid credits (${o.source} ${o.ref})${text(o.note, 200) ? ` — ${text(o.note, 200)}` : ""}`);
  audit(userId, "account", `Prepaid AI credits removed after a refund: −${eur(take)} €`);
  const main = bots.primary(userId);
  if (main) rows.append(main, { kind: "notice", tone: "info", text: hm(users.localeOf(userId), "A payment was refunded: {amount} € of credits removed from your account.", { amount: eur(take) }) });
  emit(userId, { type: "usage" });
  return take;
}

export interface Access { operator: boolean; sub: SubRecord | null; plan: HostedPlan | null }
export function accessOf(userId: string): Access {
  if (isOperator(userId)) return { operator: true, sub: null, plan: null };
  const sub = subscriptions.ensure(userId);
  return { operator: false, sub, plan: sub ? plans.get(sub.planId) : null };
}
export const suspended = (userId: string) => hostedMode() && !isOperator(userId) && subscriptions.ensure(userId)?.status === "suspended";
/** Whether this account's bots may use the operator's keys at all (budget aside): never on a "bring your own key" plan. */
export function operatorKeysAllowed(userId: string): boolean {
  if (!hostedMode()) return true;
  const a = accessOf(userId);
  if (a.operator) return true;
  return a.sub?.status !== "suspended" && a.plan?.kind !== "byok";
}
/** Whether the month's budget on the operator's keys is used up (never for an operator). */
export function hostedOverBudget(userId: string, extraUsd = 0): boolean {
  if (!hostedMode() || isOperator(userId)) return false;
  return (operatorSpendUsd(userId) + extraUsd) * hostedSettings.get().usdToEur >= budgetEur(userId) - 1e-9;
}
/** Why the operator's keys may not pay for this account's next call, or null when they may. */
export function operatorBlock(userId: string, extraUsd = 0): "budget" | "suspended" | "byok" | null {
  if (!hostedMode() || isOperator(userId)) return null;
  if (suspended(userId)) return "suspended";
  if (!operatorKeysAllowed(userId)) return "byok";
  if (hostedOverBudget(userId, extraUsd)) return "budget";
  return null;
}

// ── Model providers: who pays, and the gate ──────────────────────────────────────────────────────────────────────
const providerOwner = (id: string) => q.get<{ user_id: string }>("SELECT user_id FROM user_providers WHERE id = ?", id)?.user_id ?? null;
/** A provider the operator pays for, as seen by `userId`: the server's own, or someone else's provider lent to hosted accounts. */
export const operatorPaid = (userId: string, providerId: string) => !providerId.startsWith("up-") || providerOwner(providerId) !== userId;

setProviderGate({
  allowed: (userId) => operatorKeysAllowed(userId),
  wrap(userId, p) {
    if (!hostedMode()) return p;
    const tagged: LlmProvider = {
      get id() { return p.id; }, get label() { return p.label; }, get models() { return p.models; },
      available: () => p.available(),
      async runTurn(req): Promise<TurnResult> {
        if (suspended(userId)) throw new HostedStopError("suspended", userId);
        if (operatorPaid(userId, p.id)) { const why = operatorBlock(userId); if (why) throw new HostedStopError(why, userId); }
        const res = await p.runTurn(req);
        return { ...res, usage: { ...res.usage, via: p.id } };
      },
    };
    return tagged;
  },
  none(userId) {
    if (!hostedMode() || isOperator(userId)) return null;
    if (suspended(userId)) return new HostedStopError("suspended", userId);
    return operatorKeysAllowed(userId) ? null : new HostedStopError("byok", userId);
  },
});

setPayerHook((userId, _model, u, status) => {
  if (!hostedMode()) return "";
  if (status === "subscription") return "subscription";
  if (u.via) return operatorPaid(userId, u.via) ? "operator" : "own";
  // No provider named: a paid service on the server's keys (third-party tools, video) — the operator pays.
  return "operator";
});

/**
 * The operator's providers (Settings → Models) lent to hosted accounts whose plan uses operator keys ("shared with hosted
 * accounts"). Their keys never leave the server; customers only see their name and models. apimodels.ts adds them to
 * the account's usable providers.
 */
export function lentProviderIds(userId: string): string[] {
  if (!hostedMode() || isOperator(userId) || !operatorKeysAllowed(userId)) return [];
  return q.all<{ id: string; user_id: string }>("SELECT id, user_id FROM user_providers WHERE shared_hosted = 1 AND key_enc IS NOT NULL ORDER BY created_at")
    .filter((r) => isOperator(r.user_id)).map((r) => r.id);
}

/** Paid services on the server's keys with no price per call: counted at the operator's estimate (hosted mode only). */
export function meterOperatorUse(userId: string, botId: string | null, label: string, estimateUsd: number) {
  if (!hostedMode() || estimateUsd <= 0) return;
  recordEstimate(userId, botId ?? bots.primary(userId)?.id ?? "", label, estimateUsd, "operator");
}
export const unitEstimate = (k: keyof HostedEstimates) => (hostedMode() ? hostedSettings.get().estimates[k] : 0);

/** What a paid tool on the server's keys (image, video, voice, third-party) tells the bot when the plan stops it. */
export function toolRefusal(reason: "budget" | "suspended" | "byok"): string {
  return reason === "budget"
    ? "Refused by the account's plan: this month's AI budget on the service's keys is used up, and this tool runs on them. Nothing was spent. Tell the user: they can top up or change plan (Settings → Credits), or wait until next month."
    : reason === "byok"
      ? "Refused by the account's plan: it uses the user's own API keys only, and this tool runs on the service's keys. Nothing was spent. Tell the user it is not included in their plan."
      : "Refused: the account is suspended. Nothing was spent.";
}

// ── Subscription tools (Claude Code / Codex) ─────────────────────────────────────────────────────────────────────
/**
 * Whether a turn of a bot on a subscription tool may run for whoever started it. The tool always runs with the sign-in
 * stored on the computer of the bot's OWN account (its own computer, or that account's shared computer — never another
 * account's): so a workspace member of another account may not start it (it would spend the owner's personal
 * subscription), and customer accounts may use their own sign-in only if the operator allows it.
 */
export function engineBlock(botOwnerId: string, startedByOther: boolean): "engines" | "suspended" | null {
  if (!hostedMode()) return null;
  if (suspended(botOwnerId)) return "suspended";
  if (startedByOther) return "engines";
  // A free computer (freecomputers.ts) keeps nothing between uses: no place for a Claude Code / Codex sign-in.
  if (freeComputerPlan(botOwnerId)) return "engines";
  if (!isOperator(botOwnerId) && !hostedSettings.get().subscriptionEngines) return "engines";
  return null;
}
/**
 * Hosted mode, plan of kind "free": the account's bots get no personal Linux computer but the server's pool of disposable
 * free computers (freecomputers.ts, FREE_COMPUTERS_MAX). FREE_PLAN_COMPUTER=personal keeps the earlier behaviour (a
 * personal computer, limited by the plan's computers awake). Operators are never on a plan.
 */
export function freeComputerPlan(userId: string): boolean {
  if (!hostedMode() || (process.env.FREE_PLAN_COMPUTER ?? "").trim().toLowerCase() === "personal") return false;
  const a = accessOf(userId);
  return !a.operator && a.plan?.kind === "free";
}
export const subscriptionEnginesFor = (userId: string) => !freeComputerPlan(userId) && (!hostedMode() || isOperator(userId) || hostedSettings.get().subscriptionEngines);

// ── Cards ────────────────────────────────────────────────────────────────────────────────────────────────────────
function stopEnglish(reason: HostedStopReason, userId: string): { text: string; vars: Record<string, string | number> } {
  switch (reason) {
    case "budget": return { text: "This month's AI budget of your plan ({budget} €) is used up on the service's AI keys. Top up your budget, switch this bot to your own API key (Settings → Models), or wait until {date}, when it starts again.", vars: { budget: eur(budgetEur(userId)), date: "" } };
    case "suspended": return { text: "Your account is suspended, so your bots are paused and nothing runs. You can still sign in, look at and export your data, or delete your account. To reactivate it, settle your subscription (Settings → Credits).", vars: {} };
    case "byok": return { text: "Your plan uses your own API keys only, and this bot's model runs on the service's keys. Add your key in Settings → Models (API providers), then choose one of its models for this bot.", vars: {} };
    case "payment": return { text: "Your trial or your paid period is over. Settle your subscription (Settings → Credits) to keep your bots running.", vars: {} };
    default: return { text: "Claude Code and Codex subscriptions are not available on this service. Choose an API model for this bot (its settings → Brain).", vars: {} };
  }
}
/** The notice (with its way forward) for work the plan stopped, in the account's language. */
export function stopNotice(userId: string, reason: HostedStopReason, opts: { member?: boolean; limit?: PlanLimitError } = {}): RowBody {
  const loc = users.localeOf(userId);
  const contactUrl = hostedSettings.get().contactUrl || undefined;
  if (reason === "limit" && opts.limit) return { kind: "notice", tone: "warn", text: opts.limit.text(loc), action: { kind: "plan", reason: "limit", limit: opts.limit.kind, contactUrl } };
  const resetAt = monthBounds().end;
  let body: string;
  const creditsOnly = reason === "budget" && planBaseEur(userId) === 0;
  const forSale = hostedSettings.get().creditsForSale;
  if (creditsOnly && !forSale) body = hm(loc, "Connect your OpenRouter, ChatGPT or Claude account so your bots can think (Settings → My AI accounts). It bills you directly; nothing is paid here.");
  else if (creditsOnly) body = hm(loc, "You have no credits left on the service's AI keys ({budget} € this month). Buy credits (Settings → Credits), connect your Claude or ChatGPT subscription, or add your own API key (Settings → Models).", { budget: eur(budgetEur(userId)) });
  else if (reason === "budget") body = hm(loc, stopEnglish("budget", userId).text, { budget: eur(budgetEur(userId)), date: dateText(loc, resetAt) });
  else if (reason === "engines" && opts.member) body = hm(loc, "This bot runs on its owner's personal Claude or ChatGPT subscription, which only its owner may use. Ask its owner to give it an API model to share it.");
  else body = hm(loc, stopEnglish(reason, userId).text);
  return { kind: "notice", tone: reason === "suspended" ? "error" : "warn", text: body, action: { kind: "plan", reason, ...(reason === "budget" && !creditsOnly ? { resetAt } : {}), ...(creditsOnly ? { credits: true, forSale } : {}), contactUrl } };
}
/** Background work (routines, check-ins, goals) is told once per account, reason and day, not at every attempt. */
const toldToday = new Set<string>();
export function postStopNotice(bot: Pick<BotRecord, "id" | "userId">, reason: HostedStopReason, opts: { background?: boolean; member?: boolean; limit?: PlanLimitError } = {}) {
  if (opts.background) {
    const key = `${bot.userId}|${reason}|${new Date().toISOString().slice(0, 10)}`;
    if (toldToday.has(key)) return;
    if (toldToday.size > 10_000) toldToday.clear();
    toldToday.add(key);
  }
  rows.append(bot, stopNotice(bot.userId, reason, opts));
}

// ── Limits ───────────────────────────────────────────────────────────────────────────────────────────────────────
const limited = (userId: string): HostedPlan | null => {
  if (!hostedMode() || isOperator(userId)) return null;
  return accessOf(userId).plan;
};
export const countBots = (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND kind = 'agent' AND hidden = 0", userId)!.n;
export const countRoutines = (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM routines r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND r.enabled = 1", userId)!.n;

setBotGuard((userId) => {
  const plan = limited(userId);
  if (plan?.maxBots !== null && plan?.maxBots !== undefined && countBots(userId) >= plan.maxBots)
    throw new PlanLimitError("bots", "Your plan allows {n} bots. Remove one, or change plan (Settings → Credits), to create another.", { n: plan.maxBots });
});
setRoutineGuard((botId) => {
  const owner = bots.byId(botId)?.userId;
  const plan = owner ? limited(owner) : null;
  if (owner && plan?.maxRoutines !== null && plan?.maxRoutines !== undefined && countRoutines(owner) >= plan.maxRoutines)
    throw new PlanLimitError("routines", "Your plan allows {n} active routines. Pause or remove one, or change plan (Settings → Credits), to add another.", { n: plan.maxRoutines });
});
/**
 * Room left on the account's plan before an import ("Importer depuis Grok Bot"): bots, and active routines (null: no
 * limit — not hosted mode, an operator, or a plan without that limit).
 */
export function planRoom(userId: string): { bots: number | null; maxBots: number | null; activeRoutines: number | null; maxRoutines: number | null } {
  const plan = limited(userId);
  const maxBots = plan?.maxBots ?? null, maxRoutines = plan?.maxRoutines ?? null;
  return {
    maxBots, bots: maxBots === null ? null : Math.max(0, maxBots - countBots(userId)),
    maxRoutines, activeRoutines: maxRoutines === null ? null : Math.max(0, maxRoutines - countRoutines(userId)),
  };
}
/** The plan's refusal for `kind`, as the guards above throw it (for a check made before anything is created). */
export const planLimitError = (kind: "bots" | "routines", n: number) => kind === "bots"
  ? new PlanLimitError("bots", "Your plan allows {n} bots. Remove one, or change plan (Settings → Credits), to create another.", { n })
  : new PlanLimitError("routines", "Your plan allows {n} active routines. Pause or remove one, or change plan (Settings → Credits), to add another.", { n });
/** How many computers this account may keep awake at once (null: only the server's own limit), and the error to give. */
export function awakeLimitFor(userId: string): { max: number; error: () => PlanLimitError } | null {
  const plan = limited(userId);
  if (plan?.maxAwakeComputers === null || plan?.maxAwakeComputers === undefined) return null;
  const max = plan.maxAwakeComputers;
  return { max, error: () => new PlanLimitError("computers", "Your plan allows {n} computer(s) awake at once, and they are all busy. Wait a moment and try again, put one to sleep (Settings → Computers), or change plan (Settings → Credits).", { n: max }) };
}
setAwakeLimit(awakeLimitFor);

// Storage: the account's bot libraries and team folder on the server (what its bots keep). Measured at most every five
// minutes per account (a walk of the folders), and kept up to date in between with what goes through the server.
const STORAGE_TTL_MS = 5 * 60_000;
const storageCache = new Map<string, { at: number; bytes: number }>();
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
function folderBytes(dir: string, budget: { left: number }): number {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (--budget.left < 0) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += folderBytes(full, budget);
    else if (e.isFile()) { try { total += lstatSync(full).size; } catch { /* gone meanwhile */ } }
  }
  return total;
}
export function storageBytes(userId: string, fresh = false): number {
  const c = storageCache.get(userId);
  if (c && !fresh && now() - c.at < STORAGE_TTL_MS) return c.bytes;
  const budget = { left: 500_000 };
  let bytes = 0;
  for (const b of bots.list(userId, true)) bytes += folderBytes(path.join(config.workspaceDir, safeId(b.id)), budget);
  bytes += folderBytes(path.join(config.dataDir, "team", safeId(userId)), budget);
  storageCache.set(userId, { at: now(), bytes });
  return bytes;
}
setLibraryWriteGuard((botId, size, checkOnly) => {
  const owner = bots.byId(botId)?.userId;
  const plan = owner ? limited(owner) : null;
  if (!owner || plan?.storageGb === null || plan?.storageGb === undefined) return;
  const limit = plan.storageGb * 1e9;
  const used = storageBytes(owner);
  if (used + size > limit) throw new PlanLimitError("storage", "Your plan's storage ({limit}) is full ({used} used). Delete files from your bots' libraries, or change plan (Settings → Credits).", { limit: bytesText(limit), used: bytesText(used) });
  if (!checkOnly) storageCache.set(owner, { at: storageCache.get(owner)?.at ?? now(), bytes: used + size });
});

// ── Plan invitations ─────────────────────────────────────────────────────────────────────────────────────────────
export const planInvites = {
  create(planId: string, email: string, days: number, by: string): { invite: PlanInviteView; token: string } {
    if (!plans.get(planId)) throw new HostedError(404, "That plan does not exist.");
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HostedError(400, "Enter a number of days between 1 and 365.");
    const token = randomBytes(24).toString("base64url");
    const id = newId("pinv");
    q.run("INSERT INTO plan_invites (id, token_hash, plan_id, email, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, sha256(token), planId, email.trim().toLowerCase(), by, now() + days * DAY, now());
    return { invite: planInvites.view(id)!, token };
  },
  view(id: string): PlanInviteView | null {
    const r = q.get<any>("SELECT * FROM plan_invites WHERE id = ?", id);
    return r ? { id: r.id, planId: r.plan_id, email: r.email, expiresAt: r.expires_at, usedAt: r.used_at ?? null, createdAt: r.created_at } : null;
  },
  list: (): PlanInviteView[] => q.all<{ id: string }>("SELECT id FROM plan_invites ORDER BY created_at DESC LIMIT 200").map((r) => planInvites.view(r.id)!),
  /** A valid, unused invitation for this token (and e-mail address, when it is bound to one). */
  peek(token: string): { id: string; plan: HostedPlan; email: string } | null {
    if (!token || token.length > 200) return null;
    const r = q.get<any>("SELECT * FROM plan_invites WHERE token_hash = ?", sha256(token));
    if (!r || r.used_at || r.expires_at < now()) return null;
    const plan = plans.get(r.plan_id);
    return plan ? { id: r.id, plan, email: r.email } : null;
  },
  use: (id: string, userId: string) => Number(q.run("UPDATE plan_invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL", now(), userId, id).changes) === 1,
  remove: (id: string) => q.run("DELETE FROM plan_invites WHERE id = ?", id),
};

// ── Sign-up ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SignupChoice { planId: string; inviteId: string | null }
/**
 * Hosted mode: what a new account starts on, checked BEFORE the account is created. `first`: the very first account
 * (the owner, an operator: no plan, no terms to accept — it writes them). A plan invitation fixes the plan (and the
 * address, when it is bound to one); otherwise the visitor's choice among the offered plans, else the default.
 */
export function signupChoice(f: { plan?: unknown; planInvite?: unknown; acceptTerms?: unknown; email: string; first: boolean }): SignupChoice | null {
  if (!hostedMode() || f.first) return null;
  if (f.acceptTerms !== true) throw new HostedError(400, "You must accept the terms of service (CGU) to create an account.", {}, "terms");
  if (typeof f.planInvite === "string" && f.planInvite) {
    const inv = planInvites.peek(f.planInvite);
    if (!inv) throw new HostedError(404, "This invitation has expired or was already used. Ask for a new one.");
    if (inv.email && inv.email !== f.email.trim().toLowerCase()) throw new HostedError(403, "This invitation is for another e-mail address.");
    return { planId: inv.plan.id, inviteId: inv.id };
  }
  const wanted = typeof f.plan === "string" && f.plan ? f.plan : hostedSettings.get().signupDefaultPlan;
  const plan = plans.offered().find((p) => p.id === wanted) ?? (typeof f.plan === "string" && f.plan ? null : plans.offered()[0] ?? null);
  if (!plan) throw new HostedError(400, "This plan does not exist or is no longer offered.");
  return { planId: plan.id, inviteId: null };
}
/** A valid plan invitation lets its addressee create an account even when sign-ups are closed (like a workspace one). */
export function planInviteOpens(token: unknown, email: string): boolean {
  if (!hostedMode() || typeof token !== "string" || !token) return false;
  const inv = planInvites.peek(token);
  return !!inv && (!inv.email || inv.email === email.trim().toLowerCase());
}
export function accountCreated(userId: string, choice: SignupChoice | null) {
  if (!choice) return;
  if (choice.inviteId) planInvites.use(choice.inviteId, userId);
  const sub = subscriptions.start(userId, choice.planId);
  adminLog({ id: userId, label: users.byId(userId)?.email ?? userId }, userId, "signup", `plan ${sub.planId}, ${sub.status}${choice.inviteId ? " (invitation)" : ""}`);
  audit(userId, "account", `Plan at sign-up: ${sub.planId} (${sub.status}); terms of service accepted`);
  if (sub.status === "trial" && sub.trialEndsAt) {
    const main = bots.primary(userId);
    if (main) rows.append(main, { kind: "notice", tone: "info", text: hm(users.localeOf(userId), "Your free trial ends on {date}.", { date: dateText(users.localeOf(userId), sub.trialEndsAt) }), action: { kind: "plan", reason: "payment", contactUrl: hostedSettings.get().contactUrl || undefined } });
  }
}

// ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The account's Linux computers this server knows of (its bots' own and its shared ones), and how many are awake. */
function awakeCount(userId: string): { awake: number; total: number } {
  const all = linuxMachines(userId);
  return { awake: all.filter((m) => m.power === "running").length, total: all.length };
}

export function accountView(userId: string): HostedAccountView {
  const a = accessOf(userId);
  const s = hostedSettings.get();
  const { label, end } = monthBounds();
  const plan = a.plan;
  return {
    operator: a.operator, plan, status: a.sub?.status ?? null,
    trialEndsAt: a.sub?.trialEndsAt ?? null, periodEnd: a.sub?.periodEnd ?? null, graceEndsAt: a.sub?.graceEndsAt ?? null,
    month: label, resetAt: end, spentEur: round2(spentEur(userId)), budgetEur: a.operator ? 0 : round2(budgetEur(userId)), creditEur: round2(creditEur(userId)),
    operatorKeys: operatorKeysAllowed(userId),
    usage: {
      bots: countBots(userId), maxBots: plan?.maxBots ?? null, routines: countRoutines(userId), maxRoutines: plan?.maxRoutines ?? null,
      awake: awakeCount(userId).awake, maxAwake: plan?.maxAwakeComputers ?? null,
      storageBytes: storageBytes(userId), storageLimitBytes: plan?.storageGb !== null && plan?.storageGb !== undefined ? plan.storageGb * 1e9 : null,
    },
    contactUrl: s.contactUrl, plans: plans.offered(), prepaidEur: a.operator ? 0 : prepaidLeftEur(userId),
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function customers(): AdminCustomer[] {
  const owner = ownerAccountId();
  const last = new Map(q.all<{ user_id: string; at: number }>("SELECT user_id, MAX(at) AS at FROM audit GROUP BY user_id").map((r) => [r.user_id, r.at]));
  const lastUse = new Map(q.all<{ user_id: string; at: number }>("SELECT user_id, MAX(at) AS at FROM usage GROUP BY user_id").map((r) => [r.user_id, r.at]));
  const created = new Map(q.all<{ id: string; created_at: number }>("SELECT id, created_at FROM users").map((r) => [r.id, r.created_at]));
  return users.all().map((u) => {
    const a = accessOf(u.id);
    const c = awakeCount(u.id);
    const la = Math.max(last.get(u.id) ?? 0, lastUse.get(u.id) ?? 0);
    return {
      id: u.id, name: u.name, email: u.email, createdAt: created.get(u.id) ?? 0, operator: a.operator, owner: u.id === owner,
      planId: a.sub?.planId ?? null, status: a.sub?.status ?? null, trialEndsAt: a.sub?.trialEndsAt ?? null, periodEnd: a.sub?.periodEnd ?? null, graceEndsAt: a.sub?.graceEndsAt ?? null,
      spentEur: round2(spentEur(u.id)), budgetEur: a.operator ? 0 : round2(budgetEur(u.id)), creditEur: round2(creditEur(u.id)), prepaidEur: a.operator ? 0 : prepaidLeftEur(u.id),
      lastActivity: la || null, bots: countBots(u.id), computers: c.total, awake: c.awake,
    };
  });
}

// ── Operator actions (each one logged) ───────────────────────────────────────────────────────────────────────────
type Actor = { id: string; label: string };
function customer(userId: string): SubRecord {
  if (!users.byId(userId)) throw new HostedError(404, "That account does not exist.");
  const sub = subscriptions.ensure(userId);
  if (!sub) throw new HostedError(409, "This account is an operator of the server: it has no plan.");
  return sub;
}
export const adminActions = {
  setPlan(actor: Actor, userId: string, planId: string) {
    const cur = customer(userId);
    const plan = plans.get(planId);
    if (!plan) throw new HostedError(404, "That plan does not exist.");
    // A move to the free plan makes the account active (the free plan never expires). A move from the free plan to a paid
    // one, with no paid period recorded, starts that plan's trial (then past_due if no payment is recorded). Otherwise the
    // status is kept.
    const fromFree = plans.get(cur.planId)?.kind === "free" && plan.kind !== "free" && cur.periodEnd === null && cur.status === "active";
    const days = hostedSettings.get().trialDays;
    subscriptions.update(userId, {
      planId: plan.id,
      ...(plan.kind === "free" && cur.status !== "suspended" ? { status: "active" as const } : {}),
      ...(fromFree ? (days > 0 ? { status: "trial" as const, trialEndsAt: now() + days * DAY } : { status: "past_due" as const, graceEndsAt: now() + hostedSettings.get().graceDays * DAY }) : {}),
    });
    adminLog(actor, userId, "plan", `${cur.planId} → ${plan.id}`);
    audit(userId, "account", `Plan changed by the operator: ${cur.planId} → ${plan.id}`);
    const next = subscriptions.get(userId)!;
    if (next.status !== cur.status) statusChanged(userId, cur.status, next.status, actor);
    emit(userId, { type: "usage" });
  },
  setStatus(actor: Actor, userId: string, status: unknown, periodEnd?: unknown) {
    const cur = customer(userId);
    if (!STATUSES.includes(status as SubscriptionStatus)) throw new HostedError(400, "Choose a status: trial, active, past_due or suspended.");
    const st = status as SubscriptionStatus;
    const s = hostedSettings.get();
    const f: Parameters<typeof subscriptions.update>[1] = { status: st };
    if (periodEnd !== undefined && periodEnd !== null && periodEnd !== "") {
      const t = Number(periodEnd);
      if (!Number.isFinite(t) || t <= now()) throw new HostedError(400, "Enter a date in the future.");
      f.periodEnd = t;
    }
    if (st === "past_due") f.graceEndsAt = now() + s.graceDays * DAY;
    if (st === "active" || st === "trial") f.graceEndsAt = null;
    if (st === "trial" && (cur.trialEndsAt === null || cur.trialEndsAt <= now())) f.trialEndsAt = now() + Math.max(1, s.trialDays) * DAY;
    subscriptions.update(userId, f);
    adminLog(actor, userId, "set-status", `${cur.status} → ${st}${f.periodEnd ? ` (paid until ${new Date(f.periodEnd).toISOString().slice(0, 10)})` : ""}`);
    if (st !== cur.status) statusChanged(userId, cur.status, st, actor);
    else emit(userId, { type: "usage" });
  },
  /** The manual payment provider: the operator records a payment, the account is active until `until`. */
  markPaid(actor: Actor, userId: string, until: unknown, ref?: unknown) {
    const cur = customer(userId);
    const t = Number(until);
    if (!Number.isFinite(t) || t <= now()) throw new HostedError(400, "Enter a date in the future.");
    subscriptions.update(userId, { status: "active", periodEnd: t, graceEndsAt: null, provider: "manual", externalRef: text(ref, 120) });
    adminLog(actor, userId, "paid", `paid until ${new Date(t).toISOString().slice(0, 10)}${text(ref, 120) ? ` — ${text(ref, 120)}` : ""}`);
    audit(userId, "account", `Payment recorded by the operator: active until ${new Date(t).toISOString().slice(0, 10)}`);
    if (cur.status !== "active") statusChanged(userId, cur.status, "active", actor);
    else emit(userId, { type: "usage" });
  },
  credit(actor: Actor, userId: string, amount: unknown, note?: unknown, lasting = false) {
    customer(userId);
    const a = Number(amount);
    if (!Number.isFinite(a) || a <= 0 || a > 10_000) throw new HostedError(400, "Enter an amount in euros (more than 0, at most 10000).");
    // Credits that carry over (Settings → Credits): the same ledger as a purchase, by the operator.
    if (lasting) { addPrepaid(userId, a, { source: "manual", note: text(note, 200), actor }); return; }
    q.run("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId("top"), userId, monthBounds().label, round2(a), text(note, 200), actor.id, now());
    adminLog(actor, userId, "credit", `+${eur(a)} € for ${monthBounds().label}${text(note, 200) ? ` — ${text(note, 200)}` : ""}`);
    audit(userId, "account", `AI budget topped up by the operator: +${eur(a)} € this month`);
    emit(userId, { type: "usage" });
  },
  extendTrial(actor: Actor, userId: string, days: unknown) {
    const cur = customer(userId);
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new HostedError(400, "Enter a number of days between 1 and 365.");
    const from = Math.max(now(), cur.trialEndsAt ?? 0);
    subscriptions.update(userId, { status: cur.status === "suspended" || cur.status === "past_due" || cur.status === "trial" ? "trial" : cur.status, trialEndsAt: from + d * DAY, graceEndsAt: null });
    adminLog(actor, userId, "trial", `+${d} days (until ${new Date(from + d * DAY).toISOString().slice(0, 10)})`);
    const next = subscriptions.get(userId)!;
    if (next.status !== cur.status) statusChanged(userId, cur.status, next.status, actor);
    else emit(userId, { type: "usage" });
  },
  setOperator(actor: Actor, userId: string, on: boolean) {
    if (actor.id !== ownerAccountId()) throw new HostedError(403, "Only the owner of this server can do this.");
    if (!users.byId(userId)) throw new HostedError(404, "That account does not exist.");
    if (userId === ownerAccountId()) throw new HostedError(409, "The owner is always an operator.");
    q.run("UPDATE users SET server_role = ? WHERE id = ?", on ? "operator" : "", userId);
    adminLog(actor, userId, "operator", on ? "made an operator" : "no longer an operator");
    audit(userId, "account", on ? "Made an operator of the server" : "No longer an operator of the server");
  },
};
