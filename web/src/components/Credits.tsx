/**
 * Settings → Credits (hosted mode, server credits.ts): the three ways bots work — the person's own Claude / ChatGPT
 * subscription (signed in on their bot's computer: its settings → Brain), their own API key (Settings → Models), or
 * prepaid credits on the service's AI keys: the balance in €, the owner's packs (Stripe Checkout when configured, else
 * "bientôt disponible" and the owner's contact), and the history of top-ups and spending.
 */
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, errText } from "../api";
import { useStore } from "../store";
import type { CreditsView } from "../types";
import { Icon, type IconName } from "./Icon";
import { ErrorNote, Loading } from "./ui";
import "./Credits.css";

const TEXT = {
  fr: {
    howTitle: "Comment tes bots travaillent",
    howLead: "Ton compte est gratuit. Pour réfléchir, tes bots utilisent un modèle d'IA : choisis une façon (ou plusieurs).",
    subTitle: "Mon abonnement Claude ou ChatGPT",
    subText: "Claude Pro/Max ou ChatGPT Plus/Pro : connecte-le sur l'ordinateur de ton bot. Rien de plus à payer ici.",
    subBtn: "Connecter mon abonnement",
    subHow: "Dans les réglages de {bot} → Cerveau : choisis Claude ou ChatGPT, puis « Se connecter ».",
    subOff: "Les abonnements ne sont pas disponibles sur ce service pour l'instant.",
    keyTitle: "Ma clé d'API",
    keyText: "DeepSeek, OpenAI, Anthropic… Ton fournisseur te facture directement, au prix coûtant.",
    keyBtn: "Ajouter ma clé d'API",
    creditsTitle: "Des crédits",
    creditsText: "Des crédits prépayés en euros, utilisés sur les modèles d'IA du service. Ils ne s'arrêtent pas à la fin du mois.",
    balance: "Solde",
    buy: "Acheter {amount}",
    buying: "Ouverture du paiement…",
    soon: "Paiement en ligne bientôt disponible.",
    soonContact: "En attendant, pour obtenir des crédits :",
    contact: "contacter le service",
    noContact: "En attendant, demande des crédits à la personne qui gère ce service.",
    byok: "Ton offre utilise uniquement tes propres clés : les crédits ne servent pas avec elle.",
    month: "Ce mois-ci ({month}) : {spent} utilisés sur les modèles du service.",
    monthBudget: "Ton offre inclut {budget} par mois, utilisés avant tes crédits.",
    history: "Historique",
    noHistory: "Aucun crédit pour l'instant.",
    hStripe: "Achat de crédits", hGift: "Crédits offerts", hMonth: "Budget ajouté pour le mois",
    spend: "Dépenses par mois",
    spendLine: "{spent} sur les modèles du service, dont {credits} payés par tes crédits",
    success: "Merci ! Ton paiement est reçu : les crédits apparaissent ici dans quelques secondes.",
    cancel: "Paiement annulé : rien n'a été débité.",
  },
  en: {
    howTitle: "How your bots work",
    howLead: "Your account is free. To think, your bots use an AI model: choose one way (or several).",
    subTitle: "My Claude or ChatGPT subscription",
    subText: "Claude Pro/Max or ChatGPT Plus/Pro: sign in on your bot's computer. Nothing more to pay here.",
    subBtn: "Connect my subscription",
    subHow: "In {bot}'s settings → Brain: choose Claude or ChatGPT, then “Sign in”.",
    subOff: "Subscriptions are not available on this service for now.",
    keyTitle: "My API key",
    keyText: "DeepSeek, OpenAI, Anthropic… Your provider bills you directly, at cost.",
    keyBtn: "Add my API key",
    creditsTitle: "Credits",
    creditsText: "Prepaid credits in euros, spent on the service's AI models. They do not end with the month.",
    balance: "Balance",
    buy: "Buy {amount}",
    buying: "Opening the payment…",
    soon: "Online payment coming soon.",
    soonContact: "Meanwhile, to get credits:",
    contact: "contact the service",
    noContact: "Meanwhile, ask whoever runs this service for credits.",
    byok: "Your plan uses your own keys only: credits do not apply to it.",
    month: "This month ({month}): {spent} used on the service's models.",
    monthBudget: "Your plan includes {budget} a month, used before your credits.",
    history: "History",
    noHistory: "No credits yet.",
    hStripe: "Credits bought", hGift: "Credits given", hMonth: "Budget added for the month",
    spend: "Spending by month",
    spendLine: "{spent} on the service's models, {credits} of it paid by your credits",
    success: "Thank you! Your payment is in: the credits show here within a few seconds.",
    cancel: "Payment cancelled: nothing was charged.",
  },
} as const;
type K = keyof typeof TEXT.fr;
function useC() {
  const locale = useStore((s) => s.locale);
  return (k: K, vars: Record<string, string | number> = {}) => (TEXT[locale === "fr" ? "fr" : "en"][k] as string).replace(/\{(\w+)\}/g, (_m, n) => String(vars[n] ?? ""));
}
const money = (n: number, loc: "fr" | "en") => n.toLocaleString(loc === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const date = (ts: number, loc: "fr" | "en") => new Date(ts).toLocaleDateString(loc === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthName = (m: string, loc: "fr" | "en") => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)).toLocaleDateString(loc === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** Back from Stripe (/?credits=success|cancel): read once, removed from the address. */
function takeReturn(): "success" | "cancel" | null {
  const url = new URL(location.href);
  const v = url.searchParams.get("credits");
  if (v !== "success" && v !== "cancel") return null;
  url.searchParams.delete("credits");
  url.searchParams.delete("session_id");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return v;
}
function WayCard({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ReactNode }) {
  return (
    <article className="credit-way">
      <div className="credit-way-head">
        <span className="credit-way-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
        <h4>{title}</h4>
      </div>
      <p className="muted small">{text}</p>
      {children}
    </article>
  );
}

export function CreditsSection() {
  const c = useC();
  const loc = useStore((s) => (s.locale === "fr" ? "fr" : "en"));
  const tick = useStore((s) => s.usageTick);
  const openAppSettings = useStore((s) => s.openAppSettings);
  const openBotSettings = useStore((s) => s.openBotSettings);
  const [view, setView] = useState<CreditsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [back] = useState(takeReturn);
  useEffect(() => {
    let dead = false;
    api<CreditsView>("GET", "/billing/credits").then((v) => !dead && setView(v), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [tick]);
  if (!view) return <>{error ? <ErrorNote>{error}</ErrorNote> : <Loading />}</>;
  if (view.operator) return null;
  const buy = async (pack: string) => {
    setBusy(pack); setError(null);
    try {
      const r = await api<{ url: string }>("POST", "/billing/credits/checkout", { pack });
      location.assign(r.url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errText(e));
      setBusy(null);
    }
  };
  const contact = view.contactUrl;
  return (
    <div className="credits">
      {back && <div className={`callout ${back === "success" ? "is-ok" : "is-info"}`} role="status"><Icon name={back === "success" ? "check" : "info"} size={16} /><span>{c(back)}</span></div>}
      <h3 className="pane-heading">{c("howTitle")}</h3>
      <p className="muted small">{c("howLead")}</p>
      <div className="credit-ways">
        <WayCard icon="brain" title={c("subTitle")} text={view.subscriptionEngines ? c("subText") : c("subOff")}>
          {view.subscriptionEngines && view.mainBot && (
            <>
              <button type="button" className="btn btn-small" onClick={() => openBotSettings(view.mainBot!.id, "general")}>{c("subBtn")}</button>
              <p className="muted small credit-way-hint">{c("subHow", { bot: view.mainBot.name })}</p>
            </>
          )}
        </WayCard>
        <WayCard icon="key" title={c("keyTitle")} text={c("keyText")}>
          <button type="button" className="btn btn-small" onClick={() => openAppSettings("models")}>{c("keyBtn")}</button>
        </WayCard>
        <WayCard icon="bolt" title={c("creditsTitle")} text={c("creditsText")}>
          <p className="credit-balance"><span className="muted small">{c("balance")}</span><b>{money(view.balanceEur, loc)}</b></p>
          {!view.operatorKeys ? <p className="muted small">{c("byok")}</p> : (
            <>
              <div className="credit-packs">
                {view.packs.map((p) => (
                  <button key={p.id} type="button" className="btn btn-small credit-pack" disabled={view.payments !== "stripe" || busy !== null} onClick={() => void buy(p.id)}>
                    {busy === p.id ? c("buying") : c("buy", { amount: money(p.amountEur, loc) })}
                  </button>
                ))}
              </div>
              {view.payments !== "stripe" && (
                <p className="muted small credit-soon">
                  <b>{c("soon")}</b>{" "}
                  {contact ? <>{c("soonContact")} <a href={contact} target="_blank" rel="noopener noreferrer">{c("contact")}</a>.</> : c("noContact")}
                </p>
              )}
            </>
          )}
        </WayCard>
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <p className="muted small">{c("month", { month: monthName(view.month, loc), spent: money(view.spentEur, loc) })}{view.planBudgetEur > 0 ? ` ${c("monthBudget", { budget: money(view.planBudgetEur, loc) })}` : ""}</p>

      <h3 className="pane-heading">{c("history")}</h3>
      {view.history.length === 0 ? <p className="muted small">{c("noHistory")}</p> : (
        <ul className="list credit-history">
          {view.history.map((h) => (
            <li key={h.id} className="list-row">
              <div className="list-row-text">
                <span className="list-row-title">{h.kind === "month" ? c("hMonth") : h.source === "stripe" ? c("hStripe") : c("hGift")}</span>
                <span className="list-row-sub">{date(h.at, loc)}{h.note && h.source !== "stripe" ? ` · ${h.note}` : ""}</span>
              </div>
              <span className="credit-amount">+{money(h.amountEur, loc)}</span>
            </li>
          ))}
        </ul>
      )}
      {view.spend.some((s) => s.spentEur > 0) && (
        <>
          <h3 className="pane-heading">{c("spend")}</h3>
          <ul className="list credit-history">
            {view.spend.filter((s) => s.spentEur > 0).map((s) => (
              <li key={s.month} className="list-row">
                <div className="list-row-text">
                  <span className="list-row-title">{monthName(s.month, loc)}</span>
                  <span className="list-row-sub">{c("spendLine", { spent: money(s.spentEur, loc), credits: money(s.fromCreditsEur, loc) })}</span>
                </div>
                <span className="credit-amount is-spend">−{money(s.fromCreditsEur, loc)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
