import { unseal } from "./auth.js";
import { q } from "./db.js";
import { guardedFetch } from "./net.js";
import { isOpenRouterUrl, OPENROUTER_HEADERS, OPENROUTER_PRESET, openRouterBase } from "./openrouter.js";
import { audit, bots, now, rows, users } from "./store.js";
import { tr } from "./i18n.js";

/**
 * L150 — a model provider key with no credit is refused when it is saved, and the owner is warned before their OpenRouter
 * credit runs out (backlog A-FAIRE; behaviour from the Timon / Rakazo audits, our own code).
 *
 * Only the providers' own documented, free checks are used (no tokens are spent to find out):
 * - OpenRouter: GET {base}/key with the key — `data.limit_remaining` ("remaining credits, or null if unlimited"), 401 for a
 *   refused key (https://openrouter.ai/docs/api-reference/limits, read 25 Nov 2026). The account's whole balance,
 *   GET {base}/credits (`data.total_credits`, `data.total_usage`), needs a management key: an ordinary key gets 403
 *   (https://openrouter.ai/docs/api-reference/get-credits); it is read only when it answers.
 * - DeepSeek: GET {base}/user/balance — `is_available` ("whether the balance is sufficient for API calls"),
 *   `balance_infos[].total_balance` (https://api-docs.deepseek.com/api/get-user-balance), with the Bearer key like every
 *   DeepSeek call (https://api-docs.deepseek.com/).
 * Any other provider has no documented free credit check: its key is kept (the call that fails later says why, and the
 * key ring moves on: providerkeys.ts). When the check itself cannot be done (network, timeout, unexpected answer), the key
 * is kept too: only a clear "no credit" or "refused" answer refuses it.
 */

export type CreditVerdict =
  | { ok: true; remainingUsd: number | null; known: boolean }
  | { ok: false; code: "no_credit" | "refused"; message: string };

const REFUSED = "The provider refused this key.";
const NO_CREDIT = "This key has no credit left: top it up on the provider's site, then paste it again.";

export type CreditKind = "openrouter" | "deepseek" | "other";
export function creditKindOf(baseUrl: string, preset?: string): CreditKind {
  if (preset === "openrouter" || isOpenRouterUrl(baseUrl)) return "openrouter";
  if (preset === "deepseek") return "deepseek";
  try { if (new URL(baseUrl).hostname === "api.deepseek.com") return "deepseek"; } catch { /* not an address */ }
  return "other";
}

const json = async (res: Response) => (await res.json().catch(() => null)) as any;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** OpenRouter: what is left on this key (its limit) and, with a management key, on the account. */
export async function openRouterCredit(key: string): Promise<{ status: number; keyLeft: number | null; accountLeft: number | null }> {
  const headers = { authorization: `Bearer ${key}`, ...OPENROUTER_HEADERS };
  const res = await guardedFetch(`${openRouterBase()}/key`, { headers, signal: AbortSignal.timeout(15_000) });
  const j = await json(res);
  if (!res.ok) return { status: res.status, keyLeft: null, accountLeft: null };
  let accountLeft: number | null = null;
  try {
    const c = await guardedFetch(`${openRouterBase()}/credits`, { headers, signal: AbortSignal.timeout(15_000) });
    const cj = await json(c);
    const total = num(cj?.data?.total_credits), used = num(cj?.data?.total_usage);
    if (c.ok && total !== null && used !== null) accountLeft = Math.round((total - used) * 100) / 100;
  } catch { /* an ordinary key: 403, or no answer */ }
  return { status: res.status, keyLeft: num(j?.data?.limit_remaining), accountLeft };
}

/** Whether a key may be saved (see above). */
export async function checkKeyCredit(kind: CreditKind, baseUrl: string, key: string): Promise<CreditVerdict> {
  try {
    if (kind === "openrouter") {
      const r = await openRouterCredit(key);
      if (r.status === 401 || r.status === 403) return { ok: false, code: "refused", message: REFUSED };
      if (r.status !== 200) return { ok: true, remainingUsd: null, known: false };
      const left = r.accountLeft ?? r.keyLeft;
      if ((r.keyLeft !== null && r.keyLeft <= 0) || (r.accountLeft !== null && r.accountLeft <= 0)) return { ok: false, code: "no_credit", message: NO_CREDIT };
      return { ok: true, remainingUsd: left, known: left !== null };
    }
    if (kind === "deepseek") {
      const res = await guardedFetch(`${baseUrl.replace(/\/+$/, "")}/user/balance`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      const j = await json(res);
      if (res.status === 401 || res.status === 403) return { ok: false, code: "refused", message: REFUSED };
      if (!res.ok || typeof j?.is_available !== "boolean") return { ok: true, remainingUsd: null, known: false };
      if (!j.is_available) return { ok: false, code: "no_credit", message: NO_CREDIT };
      const usd = Array.isArray(j.balance_infos) ? j.balance_infos.find((b: any) => b?.currency === "USD") : null;
      return { ok: true, remainingUsd: usd ? num(usd.total_balance) : null, known: true };
    }
  } catch { /* the check could not be done: the key is kept */ }
  return { ok: true, remainingUsd: null, known: false };
}

// ── OpenRouter credit alert ─────────────────────────────────────────────────
q.run(`CREATE TABLE IF NOT EXISTS openrouter_credit_alerts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, threshold_usd REAL NOT NULL DEFAULT 1,
  last_left REAL, checked_at INTEGER, alerted_at INTEGER)`);

export const DEFAULT_ALERT_USD = 1;
export const ALERT_EVERY_MS = 24 * 3_600_000;
export const CHECK_EVERY_MS = 3_600_000;
export interface CreditAlertView { thresholdUsd: number; lastLeftUsd: number | null; checkedAt: number | null; alertedAt: number | null; hasOpenRouter: boolean }

const ownKeyRow = (userId: string) => q.get<{ id: string; key_enc: string | null }>("SELECT id, key_enc FROM user_providers WHERE user_id = ? AND preset = 'openrouter' ORDER BY created_at LIMIT 1", userId);
const alertRow = (userId: string) => q.get<{ threshold_usd: number; last_left: number | null; checked_at: number | null; alerted_at: number | null }>("SELECT * FROM openrouter_credit_alerts WHERE user_id = ?", userId);

export function creditAlertView(userId: string): CreditAlertView {
  const r = alertRow(userId);
  return { thresholdUsd: r?.threshold_usd ?? DEFAULT_ALERT_USD, lastLeftUsd: r?.last_left ?? null, checkedAt: r?.checked_at ?? null, alertedAt: r?.alerted_at ?? null, hasOpenRouter: !!ownKeyRow(userId)?.key_enc };
}

/** 0 turns the alert off; otherwise between 0.5 and 1000 $. */
export function setCreditAlert(userId: string, raw: unknown): CreditAlertView {
  const n = Number(raw);
  if (!Number.isFinite(n) || (n !== 0 && (n < 0.5 || n > 1000))) throw new Error("Choose an amount between 0.5 and 1000 $, or 0 to turn the alert off.");
  q.run(`INSERT INTO openrouter_credit_alerts (user_id, threshold_usd) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET threshold_usd = excluded.threshold_usd, alerted_at = NULL`, userId, Math.round(n * 100) / 100);
  return creditAlertView(userId);
}

/**
 * One look at an account's OpenRouter credit. Below the threshold: one notice on the owner's main bot (at most once a day),
 * with the link to top up. Returns what is left (null: OpenRouter does not tell, e.g. a key with no limit and no
 * management key) and whether the owner was told now.
 */
export async function checkOpenRouterCredit(userId: string, t = now()): Promise<{ leftUsd: number | null; alerted: boolean }> {
  const row = ownKeyRow(userId);
  const key = row?.key_enc ? unseal(row.key_enc) : null;
  if (!key) return { leftUsd: null, alerted: false };
  const view = creditAlertView(userId);
  let left: number | null = null;
  try {
    const r = await openRouterCredit(key);
    if (r.status === 200) left = r.accountLeft ?? r.keyLeft;
  } catch { /* OpenRouter not reachable: try again next time */ }
  q.run(`INSERT INTO openrouter_credit_alerts (user_id, threshold_usd, last_left, checked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET last_left = excluded.last_left, checked_at = excluded.checked_at`, userId, view.thresholdUsd, left, t);
  if (left === null || view.thresholdUsd <= 0 || left >= view.thresholdUsd) return { leftUsd: left, alerted: false };
  if (view.alertedAt && t - view.alertedAt < ALERT_EVERY_MS) return { leftUsd: left, alerted: false };
  const main = bots.primary(userId);
  if (!main) return { leftUsd: left, alerted: false };
  const loc = users.localeOf(userId);
  rows.append(main, { kind: "notice", tone: "warn", text: tr(loc, "Your OpenRouter credit is low: {left} $ left (alert below {threshold} $). Top up on {url} so your bots do not stop.", { left: left.toFixed(2), threshold: String(view.thresholdUsd), url: OPENROUTER_PRESET.creditsUrl }), action: { kind: "settings", section: "models" } });
  q.run("UPDATE openrouter_credit_alerts SET alerted_at = ? WHERE user_id = ?", t, userId);
  audit(userId, "system", `OpenRouter: credit low (${left.toFixed(2)} $)`);
  return { leftUsd: left, alerted: true };
}

/** Every hour: each account with its own OpenRouter key and an alert on. Not under NO_SCHEDULER (tests). */
export function startCreditAlerts() {
  if (process.env.NO_SCHEDULER === "1") return;
  const pass = async () => {
    const users = q.all<{ user_id: string }>(`SELECT DISTINCT p.user_id FROM user_providers p LEFT JOIN openrouter_credit_alerts a ON a.user_id = p.user_id
      WHERE p.preset = 'openrouter' AND p.key_enc IS NOT NULL AND COALESCE(a.threshold_usd, ${DEFAULT_ALERT_USD}) > 0`);
    for (const { user_id } of users) { try { await checkOpenRouterCredit(user_id); } catch (err) { console.error("[openrouter-credit]", (err as Error)?.message ?? err); } }
  };
  setTimeout(() => void pass(), 5 * 60_000).unref();
  setInterval(() => void pass(), CHECK_EVERY_MS).unref();
}
startCreditAlerts();
