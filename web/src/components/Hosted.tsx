/**
 * Hosted mode (server/src/hosted.ts, only with HOSTED_MODE=1): "Mon abonnement" for customers, the operators'
 * Administration page, the plan picker and the terms checkbox of the sign-up form, the links to the public pages, and the
 * buttons under a notice that the plan stopped some work. Texts live here (French and English), like GoogleLogin.tsx.
 */
import { AdminCapsEditor } from "./UsageCaps";
import { useEffect, useId, useState, type ReactNode } from "react";
import { api, enc, errText } from "../api";
import { useStore } from "../store";
import type { AdminAuditEntry, AdminCustomer, HostedAccountView, HostedNoticeAction, HostedPlan, HostedSettings, PlanInviteView, SubscriptionStatus } from "../types";
import { Icon } from "./Icon";
import { CopyButton, ErrorNote, Loading, Toggle } from "./ui";
import "./Hosted.css";

const TEXT = {
  fr: {
    loading: "Chargement…",
    operatorTitle: "Tu gères ce service",
    operatorBody: "Ton compte est opérateur : il n'a ni offre ni limite, et ses dépenses ne sont pas comptées dans un budget. Les clients, les offres et les réglages sont dans Administration.",
    openAdmin: "Ouvrir l'administration",
    plan: "Offre", status: "Statut", perMonth: "/ mois", free: "Gratuit",
    st_trial: "Essai", st_active: "Actif", st_past_due: "Paiement en retard", st_suspended: "Suspendu",
    trialEnds: "Fin de l'essai : {date}", paidUntil: "Payé jusqu'au {date}", graceEnds: "À régler avant le {date}, sinon le compte sera suspendu.",
    suspendedNote: "Ton compte est suspendu : il est en lecture seule. Tu peux consulter et exporter tes données, ou supprimer ton compte. Règle ton abonnement pour le réactiver.",
    budgetTitle: "Budget IA du mois ({month})",
    budgetLine: "{spent} € utilisés sur {budget} €",
    budgetCredit: "dont {credit} € ajoutés ce mois-ci",
    budgetReset: "Repart à zéro le {date}.",
    budgetOver: "Le budget du mois est épuisé : tes bots s'arrêtent sur les clés du service jusqu'au {date}. Recharge ton budget, passe sur ta propre clé ou attends.",
    byokBudget: "Ton offre utilise tes propres clés d'API : ton fournisseur te facture directement, aucun budget du service n'est compté.",
    limits: "Limites de ton offre",
    lBots: "Bots", lRoutines: "Routines actives", lAwake: "Ordinateurs allumés en même temps", lStorage: "Stockage",
    unlimited: "sans limite",
    upgrade: "Changer d'offre", topUp: "Recharger mon budget", keys: "Gérer mes clés d'API",
    noContact: "Pour changer d'offre ou recharger ton budget, contacte la personne qui gère ce service.",
    offered: "Offres disponibles",
    linksTitle: "Documents",
    pricing: "Tarifs", terms: "CGU / CGV", legal: "Mentions légales", privacy: "Confidentialité",
    // Admin
    adminIntro: "Tous les comptes de ce serveur, leurs offres et leurs dépenses du mois sur les clés du service. Chaque action est notée dans le journal.",
    tabCustomers: "Clients", tabPlans: "Offres", tabInvites: "Invitations", tabProviders: "Clés prêtées", tabSettings: "Réglages", tabAudit: "Journal",
    cName: "Compte", cPlan: "Offre", cStatus: "Statut", cSpend: "Ce mois", cActivity: "Activité", cBots: "Bots", cComputers: "Ordinateurs allumés",
    operator: "Opérateur", owner: "Propriétaire", never: "jamais",
    manage: "Gérer", close: "Fermer",
    aPlan: "Changer d'offre", apply: "Appliquer", aStatus: "Changer le statut", periodEnd: "Payé jusqu'au (facultatif)",
    aPaid: "Paiement reçu", until: "Actif jusqu'au", reference: "Référence (facultatif)", markPaid: "Enregistrer le paiement",
    aCredit: "Recharger le budget IA de ce mois", amount: "Montant (€)", note: "Note (facultatif)", addCredit: "Ajouter",
    aTrial: "Prolonger l'essai", days: "Jours", extend: "Prolonger",
    aOperator: "Opérateur du serveur", operatorHint: "Un opérateur voit cette page et gère les clients. Seule la personne propriétaire peut nommer des opérateurs.",
    done: "C'est fait.",
    newPlan: "Nouvelle offre", planId: "Identifiant (ex. pro)", kind: "Type", kFree: "Gratuit · clés du service", kIncluded: "Payant · clés du service", kByok: "Payant · clés du client",
    nameFr: "Nom (français)", nameEn: "Nom (anglais)", descFr: "Description (français)", descEn: "Description (anglais)",
    price: "Prix par mois (€)", aiBudget: "Budget IA par mois (€)", maxBots: "Bots max", maxAwake: "Ordinateurs allumés max", storageGb: "Stockage (Go)", maxRoutines: "Routines actives max",
    emptyNoLimit: "vide = sans limite", publicPlan: "Proposée à l'inscription et sur la page Tarifs", archived: "Archivée (n'est plus proposée ; les comptes qui l'ont la gardent)", position: "Ordre",
    savePlan: "Enregistrer l'offre", createPlan: "Créer l'offre",
    invIntro: "Un lien d'invitation crée un compte directement sur une offre (même quand les inscriptions sont fermées). Il ne sert qu'une fois. Lié à une adresse, seule cette adresse peut l'utiliser.",
    invEmail: "Adresse e-mail (facultatif)", invDays: "Valable (jours)", invCreate: "Créer le lien", invLink: "Lien (affiché une seule fois) :", invUsed: "utilisé", invExpires: "expire le {date}", invAny: "n'importe quelle adresse", invRemove: "Supprimer",
    provIntro: "Tes propres fournisseurs d'API (Réglages → Modèles) peuvent être prêtés aux comptes dont l'offre utilise les clés du service (Gratuit, Tout inclus) — jamais à « J'apporte ma clé ». Leur clé et leur adresse ne sont jamais montrées aux clients ; leur usage est compté dans le budget de chaque client.",
    provNone: "Tu n'as pas encore de fournisseur d'API. Ajoute-en un dans Réglages → Modèles (par exemple DeepSeek).",
    lend: "Prêter aux comptes hébergés", noKey: "sans clé",
    sMoney: "Argent", rate: "Taux USD → EUR (1 $ = … €)", rateHint: "Les prix des modèles sont en dollars ; ce taux convertit en euros. Mets-le à jour toi-même.",
    trialDays: "Jours d'essai (offres payantes)", graceDays: "Jours de grâce après un impayé", trialBudget: "Budget IA maximal pendant l'essai (€)", contactUrl: "Contact pour changer d'offre / recharger (https:// ou mailto:)", defaultPlan: "Offre par défaut à l'inscription",
    engines: "Les clients peuvent utiliser leur propre abonnement Claude Code / Codex (connexion sur l'ordinateur de leur bot)", enginesHint: "Ton propre abonnement n'est jamais utilisé par les bots des autres comptes, quoi qu'il arrive.",
    sEstimates: "Estimations pour les services sans prix par appel (USD)", estHint: "Ce sont tes estimations, pas des prix de fournisseur : elles servent à compter les images, vidéos et la voix faites avec les clés du service.",
    imageUsd: "Image", videoUsd: "Vidéo (si le service ne donne pas son prix)", sttUsd: "Voix → texte, par minute", ttsUsd: "Texte → voix, pour 1000 caractères",
    sLegal: "Informations légales (pages CGU et mentions légales)", legalHint: "Les champs vides apparaissent comme [À COMPLÉTER]. Ces pages sont des modèles à faire valider par un professionnel.",
    lCompany: "Raison sociale ou nom", lLegalForm: "Forme juridique", lCapital: "Capital social", lAddress: "Adresse du siège", lSiret: "SIREN / SIRET, RCS", lVat: "N° de TVA", lDirector: "Directeur·rice de la publication", lEmail: "E-mail de contact", lPhone: "Téléphone", lHost: "Hébergeur (nom, adresse, téléphone)", lMediator: "Médiateur de la consommation",
    saveSettings: "Enregistrer les réglages",
    auditEmpty: "Rien pour l'instant.", system: "planificateur",
    // Sign-up
    choosePlan: "Choisis ton offre", trial: "{days} jours d'essai", budgetIncluded: "{budget} € de budget IA / mois", ownKeys: "Tes propres clés d'API",
    accept: "J'accepte les {terms} et j'ai lu la {privacy}.", acceptTerms: "CGU / CGV", acceptPrivacy: "politique de confidentialité",
    mustAccept: "Coche la case pour accepter les CGU.",
    invitedPlan: "Invitation : ton compte sera créé avec l'offre « {plan} ».",
    // Notices
    nTopUp: "Recharger / changer d'offre", nOwnKey: "Utiliser ma propre clé", nWait: "ou attendre le {date}", nSubscription: "Mon abonnement", nAddKey: "Ajouter ma clé", nBrain: "Choisir un modèle d'API",
  },
  en: {
    loading: "Loading…",
    operatorTitle: "You run this service",
    operatorBody: "Your account is an operator: it has no plan and no limit, and its spending is not counted against a budget. Customers, plans and settings are in Administration.",
    openAdmin: "Open administration",
    plan: "Plan", status: "Status", perMonth: "/ month", free: "Free",
    st_trial: "Trial", st_active: "Active", st_past_due: "Payment overdue", st_suspended: "Suspended",
    trialEnds: "Trial ends: {date}", paidUntil: "Paid until {date}", graceEnds: "Settle before {date}, or the account will be suspended.",
    suspendedNote: "Your account is suspended: it is read-only. You can look at and export your data, or delete your account. Settle your subscription to reactivate it.",
    budgetTitle: "This month's AI budget ({month})",
    budgetLine: "€{spent} used of €{budget}",
    budgetCredit: "including €{credit} added this month",
    budgetReset: "Starts again on {date}.",
    budgetOver: "This month's budget is used up: your bots stop on the service's keys until {date}. Top up, switch to your own key, or wait.",
    byokBudget: "Your plan uses your own API keys: your provider bills you directly, no budget of the service is counted.",
    limits: "Your plan's limits",
    lBots: "Bots", lRoutines: "Active routines", lAwake: "Computers awake at once", lStorage: "Storage",
    unlimited: "no limit",
    upgrade: "Change plan", topUp: "Top up my budget", keys: "Manage my API keys",
    noContact: "To change plan or top up your budget, contact whoever runs this service.",
    offered: "Available plans",
    linksTitle: "Documents",
    pricing: "Pricing", terms: "Terms", legal: "Legal notice", privacy: "Privacy",
    adminIntro: "Every account of this server, its plan and this month's spending on the service's keys. Every action is written to the log.",
    tabCustomers: "Customers", tabPlans: "Plans", tabInvites: "Invitations", tabProviders: "Lent keys", tabSettings: "Settings", tabAudit: "Log",
    cName: "Account", cPlan: "Plan", cStatus: "Status", cSpend: "This month", cActivity: "Activity", cBots: "Bots", cComputers: "Computers awake",
    operator: "Operator", owner: "Owner", never: "never",
    manage: "Manage", close: "Close",
    aPlan: "Change plan", apply: "Apply", aStatus: "Change status", periodEnd: "Paid until (optional)",
    aPaid: "Payment received", until: "Active until", reference: "Reference (optional)", markPaid: "Record the payment",
    aCredit: "Top up this month's AI budget", amount: "Amount (€)", note: "Note (optional)", addCredit: "Add",
    aTrial: "Extend the trial", days: "Days", extend: "Extend",
    aOperator: "Server operator", operatorHint: "An operator sees this page and manages customers. Only the owner can make operators.",
    done: "Done.",
    newPlan: "New plan", planId: "Id (e.g. pro)", kind: "Kind", kFree: "Free · the service's keys", kIncluded: "Paid · the service's keys", kByok: "Paid · the customer's keys",
    nameFr: "Name (French)", nameEn: "Name (English)", descFr: "Description (French)", descEn: "Description (English)",
    price: "Price per month (€)", aiBudget: "AI budget per month (€)", maxBots: "Max bots", maxAwake: "Max computers awake", storageGb: "Storage (GB)", maxRoutines: "Max active routines",
    emptyNoLimit: "empty = no limit", publicPlan: "Offered at sign-up and on the pricing page", archived: "Archived (no longer offered; accounts that have it keep it)", position: "Order",
    savePlan: "Save the plan", createPlan: "Create the plan",
    invIntro: "An invitation link creates an account directly on a plan (even when sign-ups are closed). It works once. Bound to an address, only that address can use it.",
    invEmail: "E-mail address (optional)", invDays: "Valid (days)", invCreate: "Create the link", invLink: "Link (shown only once):", invUsed: "used", invExpires: "expires on {date}", invAny: "any address", invRemove: "Remove",
    provIntro: "Your own API providers (Settings → Models) can be lent to accounts whose plan uses the service's keys (Free, All included) — never to \"Bring your own key\". Their key and address are never shown to customers; their use counts against each customer's budget.",
    provNone: "You have no API provider yet. Add one in Settings → Models (DeepSeek, for example).",
    lend: "Lend to hosted accounts", noKey: "no key",
    sMoney: "Money", rate: "USD → EUR rate ($1 = … €)", rateHint: "Model prices are in dollars; this rate converts them to euros. Keep it up to date yourself.",
    trialDays: "Trial days (paid plans)", graceDays: "Grace days after a missed payment", trialBudget: "Maximum AI budget during the trial (€)", contactUrl: "Contact to change plan / top up (https:// or mailto:)", defaultPlan: "Default plan at sign-up",
    engines: "Customers may use their own Claude Code / Codex subscription (signed in on their bot's computer)", enginesHint: "Your own subscription is never used by other accounts' bots, whatever happens.",
    sEstimates: "Estimates for services without a price per call (USD)", estHint: "These are your estimates, not provider prices: they count the pictures, videos and voice made with the service's keys.",
    imageUsd: "Picture", videoUsd: "Video (when the service gives no price)", sttUsd: "Speech → text, per minute", ttsUsd: "Text → speech, per 1000 characters",
    sLegal: "Legal details (terms and legal notice pages)", legalHint: "Empty fields show as [À COMPLÉTER]. These pages are templates to be checked by a professional.",
    lCompany: "Company or name", lLegalForm: "Legal form", lCapital: "Share capital", lAddress: "Registered address", lSiret: "Registration (SIREN / SIRET, RCS)", lVat: "VAT number", lDirector: "Publication director", lEmail: "Contact e-mail", lPhone: "Phone", lHost: "Host (name, address, phone)", lMediator: "Consumer mediator",
    saveSettings: "Save the settings",
    auditEmpty: "Nothing yet.", system: "scheduler",
    choosePlan: "Choose your plan", trial: "{days}-day trial", budgetIncluded: "€{budget} AI budget / month", ownKeys: "Your own API keys",
    accept: "I accept the {terms} and have read the {privacy}.", acceptTerms: "terms of service", acceptPrivacy: "privacy policy",
    mustAccept: "Tick the box to accept the terms of service.",
    invitedPlan: "Invitation: your account will be created on the \"{plan}\" plan.",
    nTopUp: "Top up / change plan", nOwnKey: "Use my own key", nWait: "or wait until {date}", nSubscription: "My subscription", nAddKey: "Add my key", nBrain: "Choose an API model",
  },
} as const;
type TextKey = keyof typeof TEXT.fr;
function useH() {
  const locale = useStore((s) => s.locale);
  return (k: TextKey, vars: Record<string, string | number> = {}) => (TEXT[locale === "fr" ? "fr" : "en"][k] as string).replace(/\{(\w+)\}/g, (_m, n) => String(vars[n] ?? ""));
}
const useLoc = () => (useStore((s) => s.locale) === "fr" ? "fr" : "en");
const eur = (n: number, loc: "fr" | "en") => n.toLocaleString(loc === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (ts: number, loc: "fr" | "en") => new Date(ts).toLocaleDateString(loc === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(0, Math.round(bytes / 1e3))} kB`);
const planName = (p: HostedPlan | null | undefined, loc: "fr" | "en") => (p ? (loc === "fr" ? p.nameFr : p.nameEn) : "—");
const pct = (a: number, b: number | null) => (b === null || b <= 0 ? null : Math.min(100, Math.round((a / b) * 100)));

function StatusBadge({ status }: { status: SubscriptionStatus | null }) {
  const h = useH();
  if (!status) return null;
  return <span className={`hosted-status is-${status}`}>{h(`st_${status}` as TextKey)}</span>;
}

function Meter({ label, used, max, text }: { label: string; used: number; max: number | null; text: string }) {
  const p = pct(used, max);
  return (
    <div className="meter-box hosted-meter">
      <div className="meter-head"><span>{label}</span><span className="muted small">{text}</span></div>
      {p !== null && <div className={`meter ${p >= 100 ? "is-over" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}><span style={{ width: `${p}%` }} /></div>}
    </div>
  );
}

/** The public pages, for the sign-in page's footer and "Mon abonnement". */
export function HostedLinks({ className = "signin-links" }: { className?: string }) {
  const hosted = useStore((s) => s.hosted);
  const h = useH();
  if (!hosted) return null;
  return (
    <p className={`${className} hosted-links`}>
      <a href={hosted.links.pricing}>{h("pricing")}</a>
      <a href={hosted.links.terms}>{h("terms")}</a>
      <a href={hosted.links.legal}>{h("legal")}</a>
      <a href={hosted.links.privacy}>{h("privacy")}</a>
    </p>
  );
}

/* ---------- Mon abonnement ---------- */

export function SubscriptionSection({ title }: { title: string }) {
  const h = useH();
  const loc = useLoc();
  const tick = useStore((s) => s.usageTick);
  const openAppSettings = useStore((s) => s.openAppSettings);
  const [view, setView] = useState<HostedAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    api<HostedAccountView>("GET", "/billing").then((v) => !dead && setView(v), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [tick]);
  return (
    <>
      <h2>{title}</h2>
      <ErrorNote>{error}</ErrorNote>
      {!view && !error && <Loading />}
      {view?.operator && (
        <div className="hosted-card">
          <p className="action-title"><Icon name="shield" size={15} /> {h("operatorTitle")}</p>
          <p className="muted small">{h("operatorBody")}</p>
          <div><button type="button" className="btn btn-small" onClick={() => openAppSettings("admin")}>{h("openAdmin")}</button></div>
        </div>
      )}
      {view && !view.operator && view.plan && <CustomerView view={view} />}
      <h3 className="pane-heading">{h("linksTitle")}</h3>
      <HostedLinks className="hosted-doc-links" />
    </>
  );
}

function CustomerView({ view }: { view: HostedAccountView }) {
  const h = useH();
  const loc = useLoc();
  const openAppSettings = useStore((s) => s.openAppSettings);
  const plan = view.plan!;
  const byok = plan.kind === "byok";
  const over = !byok && view.budgetEur > 0 && view.spentEur >= view.budgetEur;
  const u = view.usage;
  const contact = view.contactUrl;
  return (
    <>
      {view.status === "suspended" && <div className="callout is-danger" role="status"><Icon name="alert" size={16} /><span>{h("suspendedNote")}</span></div>}
      {view.status === "past_due" && view.graceEndsAt && <div className="callout is-warn" role="status"><Icon name="alert" size={16} /><span>{h("graceEnds", { date: day(view.graceEndsAt, loc) })}</span></div>}
      <div className="hosted-card hosted-plan-card">
        <div className="hosted-plan-head">
          <div>
            <p className="muted small">{h("plan")}</p>
            <p className="hosted-plan-name">{planName(plan, loc)}</p>
          </div>
          <div className="hosted-plan-price">{loc === "fr" ? `${eur(plan.priceEur, loc)} €` : `€${eur(plan.priceEur, loc)}`} <span className="muted small">{h("perMonth")}</span></div>
        </div>
        <div className="hosted-plan-meta">
          <StatusBadge status={view.status} />
          {view.status === "trial" && view.trialEndsAt && <span className="muted small">{h("trialEnds", { date: day(view.trialEndsAt, loc) })}</span>}
          {view.periodEnd && view.status !== "trial" && <span className="muted small">{h("paidUntil", { date: day(view.periodEnd, loc) })}</span>}
        </div>
      </div>

      <h3 className="pane-heading">{h("budgetTitle", { month: view.month })}</h3>
      {byok ? <p className="muted small">{h("byokBudget")}</p> : (
        <>
          <Meter label={h("budgetLine", { spent: eur(view.spentEur, loc), budget: eur(view.budgetEur, loc) })} used={view.spentEur} max={view.budgetEur}
            text={view.creditEur ? h("budgetCredit", { credit: eur(view.creditEur, loc) }) : ""} />
          <p className={over ? "callout is-warn hosted-over" : "muted small"} role={over ? "status" : undefined}>{over ? h("budgetOver", { date: day(view.resetAt, loc) }) : h("budgetReset", { date: day(view.resetAt, loc) })}</p>
        </>
      )}

      <h3 className="pane-heading">{h("limits")}</h3>
      <div className="hosted-limits">
        <Meter label={h("lBots")} used={u.bots} max={u.maxBots} text={u.maxBots === null ? `${u.bots} · ${h("unlimited")}` : `${u.bots} / ${u.maxBots}`} />
        <Meter label={h("lRoutines")} used={u.routines} max={u.maxRoutines} text={u.maxRoutines === null ? `${u.routines} · ${h("unlimited")}` : `${u.routines} / ${u.maxRoutines}`} />
        <Meter label={h("lAwake")} used={u.awake} max={u.maxAwake} text={u.maxAwake === null ? `${u.awake} · ${h("unlimited")}` : `${u.awake} / ${u.maxAwake}`} />
        <Meter label={h("lStorage")} used={u.storageBytes} max={u.storageLimitBytes} text={u.storageLimitBytes === null ? `${gb(u.storageBytes)} · ${h("unlimited")}` : `${gb(u.storageBytes)} / ${gb(u.storageLimitBytes)}`} />
      </div>

      <div className="hosted-actions">
        {contact ? <a className="btn btn-primary btn-small" href={contact} target="_blank" rel="noopener noreferrer"><Icon name="star" size={14} /> {h("upgrade")}</a> : null}
        {contact && !byok ? <a className="btn btn-small" href={contact} target="_blank" rel="noopener noreferrer"><Icon name="bolt" size={14} /> {h("topUp")}</a> : null}
        <button type="button" className="btn btn-small" onClick={() => openAppSettings("models")}><Icon name="key" size={14} /> {h("keys")}</button>
      </div>
      {!contact && <p className="muted small">{h("noContact")}</p>}

      {view.plans.length > 0 && (
        <>
          <h3 className="pane-heading">{h("offered")}</h3>
          <PlanCards plans={view.plans} current={plan.id} />
        </>
      )}
    </>
  );
}

function planFacts(p: HostedPlan, h: ReturnType<typeof useH>, loc: "fr" | "en", trialDays?: number): string[] {
  return [
    p.kind === "byok" ? h("ownKeys") : h("budgetIncluded", { budget: eur(p.aiBudgetEur, loc) }),
    `${h("lBots")} : ${p.maxBots ?? "∞"} · ${h("lRoutines")} : ${p.maxRoutines ?? "∞"}`.replace(" :", loc === "fr" ? " :" : ":"),
    `${h("lStorage")} : ${p.storageGb === null ? "∞" : `${eur(p.storageGb, loc)} ${loc === "fr" ? "Go" : "GB"}`}`.replace(" :", loc === "fr" ? " :" : ":"),
    ...(trialDays && p.kind !== "free" ? [h("trial", { days: trialDays })] : []),
  ];
}

function PlanCards({ plans, current, selected, onSelect, trialDays, name }: { plans: HostedPlan[]; current?: string; selected?: string; onSelect?: (id: string) => void; trialDays?: number; name?: string }) {
  const h = useH();
  const loc = useLoc();
  return (
    <div className={`hosted-plans ${onSelect ? "is-picker" : ""}`} role={onSelect ? "radiogroup" : undefined} aria-label={onSelect ? h("choosePlan") : undefined}>
      {plans.map((p) => {
        const body = (
          <>
            <span className="hosted-plans-name">{planName(p, loc)}{current === p.id && <Icon name="check" size={14} />}</span>
            <span className="hosted-plans-price">{loc === "fr" ? `${eur(p.priceEur, loc)} € ${h("perMonth")}` : `€${eur(p.priceEur, loc)} ${h("perMonth")}`}</span>
            <span className="hosted-plans-facts">{planFacts(p, h, loc, trialDays).map((f) => <span key={f}>{f}</span>)}</span>
          </>
        );
        return onSelect ? (
          <label key={p.id} className={`hosted-plans-item ${selected === p.id ? "is-selected" : ""}`}>
            <input type="radio" name={name} value={p.id} checked={selected === p.id} onChange={() => onSelect(p.id)} />
            {body}
          </label>
        ) : <div key={p.id} className={`hosted-plans-item ${current === p.id ? "is-selected" : ""}`}>{body}</div>;
      })}
    </div>
  );
}

/* ---------- Sign-up ---------- */

export interface HostedSignup { plan?: string; planInvite?: string; acceptTerms: boolean }

/** The plan picker and the terms checkbox of the sign-up form (hosted mode only). */
export function HostedSignupFields({ value, onChange }: { value: HostedSignup; onChange: (v: HostedSignup) => void }) {
  const hosted = useStore((s) => s.hosted);
  const h = useH();
  const loc = useLoc();
  const name = useId();
  const [plans, setPlans] = useState<{ plans: HostedPlan[]; trialDays: number; defaultPlan: string } | null>(null);
  const [invitePlan, setInvitePlan] = useState<HostedPlan | null>(null);
  useEffect(() => {
    if (!hosted) return;
    api<{ plans: HostedPlan[]; trialDays: number; defaultPlan: string }>("GET", `/plans?locale=${loc}`).then((r) => {
      setPlans(r);
      if (!value.plan && !value.planInvite) {
        const wanted = new URLSearchParams(location.search).get("plan");
        const pick = r.plans.find((p) => p.id === wanted) ?? r.plans.find((p) => p.id === r.defaultPlan) ?? r.plans[0];
        if (pick) onChange({ ...value, plan: pick.id });
      }
    }, () => setPlans(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted]);
  useEffect(() => {
    if (!value.planInvite) return;
    api<{ invite: { plan: HostedPlan } }>("GET", `/plan-invites/${enc(value.planInvite)}`).then((r) => setInvitePlan(r.invite.plan), () => setInvitePlan(null));
  }, [value.planInvite]);
  if (!hosted) return null;
  return (
    <div className="hosted-signup">
      {invitePlan ? (
        <p className="signin-notice is-invite" role="status"><Icon name="star" size={16} /><span>{h("invitedPlan", { plan: planName(invitePlan, loc) })}</span></p>
      ) : plans && plans.plans.length > 0 ? (
        <fieldset className="hosted-signup-plans">
          <legend>{h("choosePlan")}</legend>
          <PlanCards plans={plans.plans} selected={value.plan} onSelect={(id) => onChange({ ...value, plan: id })} trialDays={plans.trialDays} name={name} />
        </fieldset>
      ) : null}
      <label className="hosted-terms">
        <input type="checkbox" checked={value.acceptTerms} onChange={(e) => onChange({ ...value, acceptTerms: e.target.checked })} required />
        <span>{splitAccept(h("accept", { terms: "\u0001", privacy: "\u0002" }), <a href={hosted.links.terms} target="_blank" rel="noopener noreferrer">{h("acceptTerms")}</a>, <a href={hosted.links.privacy} target="_blank" rel="noopener noreferrer">{h("acceptPrivacy")}</a>)}</span>
      </label>
    </div>
  );
}
function splitAccept(text: string, terms: ReactNode, privacy: ReactNode): ReactNode[] {
  return text.split(/(\u0001|\u0002)/).map((part, i) => (part === "\u0001" ? <span key={i}>{terms}</span> : part === "\u0002" ? <span key={i}>{privacy}</span> : part));
}
export function useHostedMustAccept(): string { const h = useH(); return h("mustAccept"); }

/* ---------- Notice buttons ---------- */

/** The way forward under a notice the plan stopped some work with (Transcript.tsx). */
export function PlanNoticeActions({ action }: { action: HostedNoticeAction }) {
  const h = useH();
  const loc = useLoc();
  const openAppSettings = useStore((s) => s.openAppSettings);
  const contact = action.contactUrl;
  const sub = <button type="button" className="btn btn-small notice-action" onClick={() => openAppSettings("subscription")}><Icon name="chart" size={13} /> {h("nSubscription")}</button>;
  return (
    <div className="hosted-notice-actions">
      {action.reason === "budget" && (
        <>
          {contact ? <a className="btn btn-small notice-action" href={contact} target="_blank" rel="noopener noreferrer"><Icon name="bolt" size={13} /> {h("nTopUp")}</a> : sub}
          <button type="button" className="btn btn-small notice-action" onClick={() => openAppSettings("models")}><Icon name="key" size={13} /> {h("nOwnKey")}</button>
          {action.resetAt && <em className="notice-done">{h("nWait", { date: day(action.resetAt, loc) })}</em>}
        </>
      )}
      {action.reason === "byok" && <button type="button" className="btn btn-small notice-action" onClick={() => openAppSettings("models")}><Icon name="key" size={13} /> {h("nAddKey")}</button>}
      {(action.reason === "suspended" || action.reason === "payment" || action.reason === "limit") && (contact && action.reason !== "limit" ? <><a className="btn btn-small notice-action" href={contact} target="_blank" rel="noopener noreferrer"><Icon name="star" size={13} /> {h("upgrade")}</a>{sub}</> : sub)}
      {action.reason === "engines" && <button type="button" className="btn btn-small notice-action" onClick={() => openAppSettings("models")}><Icon name="brain" size={13} /> {h("nBrain")}</button>}
    </div>
  );
}

/* ---------- Administration ---------- */

interface Overview {
  customers: AdminCustomer[]; plans: HostedPlan[]; settings: HostedSettings; invites: PlanInviteView[]; audit: AdminAuditEntry[];
  providers: { id: string; name: string; models: string[]; hasKey: boolean; lent: boolean }[]; owner: boolean; me: string;
}
type AdminTab = "customers" | "plans" | "invites" | "providers" | "settings" | "audit";

export function AdminSection({ title }: { title: string }) {
  const h = useH();
  const tick = useStore((s) => s.usageTick);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("customers");
  const reload = () => api<Overview>("GET", "/admin/overview").then(setData, (e) => setError(errText(e)));
  useEffect(() => { void reload(); }, [tick]);
  const tabs: { id: AdminTab; label: TextKey; icon: "users" | "star" | "send" | "key" | "settings" | "history" }[] = [
    { id: "customers", label: "tabCustomers", icon: "users" }, { id: "plans", label: "tabPlans", icon: "star" }, { id: "invites", label: "tabInvites", icon: "send" },
    { id: "providers", label: "tabProviders", icon: "key" }, { id: "settings", label: "tabSettings", icon: "settings" }, { id: "audit", label: "tabAudit", icon: "history" },
  ];
  return (
    <>
      <h2>{title}</h2>
      <p className="muted">{h("adminIntro")}</p>
      <div className="seg-tabs hosted-tabs" role="tablist" aria-label={title}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`seg-tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}><Icon name={t.icon} size={13} /> {h(t.label)}</button>
        ))}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!data && !error && <Loading />}
      {data && tab === "customers" && <CustomersTab data={data} onChange={(d) => setData({ ...data, ...d })} onError={setError} />}
      {data && tab === "plans" && <PlansTab plans={data.plans} onChange={(plans) => setData({ ...data, plans })} onError={setError} />}
      {data && tab === "invites" && <InvitesTab data={data} onChange={(invites) => setData({ ...data, invites })} onError={setError} />}
      {data && tab === "providers" && <ProvidersTab data={data} onChange={setData} onError={setError} />}
      {data && tab === "settings" && <SettingsTab data={data} onChange={(settings) => setData({ ...data, settings })} onError={setError} />}
      {data && tab === "audit" && <AuditList entries={data.audit} />}
    </>
  );
}

function CustomersTab({ data, onChange, onError }: { data: Overview; onChange: (d: Partial<Overview>) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const loc = useLoc();
  const [open, setOpen] = useState<string | null>(null);
  const plan = (id: string | null) => data.plans.find((p) => p.id === id);
  return (
    <div className="table-wrap">
      <table className="table hosted-table">
        <thead><tr><th scope="col">{h("cName")}</th><th scope="col">{h("cPlan")}</th><th scope="col" className="num">{h("cSpend")}</th><th scope="col" className="num">{h("cBots")}</th><th scope="col" className="num">{h("cComputers")}</th><th scope="col"><span className="sr-only">{h("manage")}</span></th></tr></thead>
        <tbody>
          {data.customers.map((c) => (
            <CustomerRows key={c.id} c={c} plan={plan(c.planId)} data={data} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onChange={onChange} onError={onError} loc={loc} h={h} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerRows({ c, plan, data, open, onToggle, onChange, onError, loc, h }: { c: AdminCustomer; plan: HostedPlan | undefined; data: Overview; open: boolean; onToggle: () => void; onChange: (d: Partial<Overview>) => void; onError: (e: string | null) => void; loc: "fr" | "en"; h: ReturnType<typeof useH> }) {
  const over = !c.operator && c.budgetEur > 0 && c.spentEur >= c.budgetEur;
  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <th scope="row"><span className="hosted-who"><span className="hosted-who-name">{c.name || c.email}</span><span className="muted small">{c.email}</span>
          <span className="muted small">{h("cActivity")} : {c.lastActivity ? day(c.lastActivity, loc) : h("never")}</span></span></th>
        <td>{c.operator ? <span className="pill is-shared">{c.owner ? h("owner") : h("operator")}</span> : <span className="hosted-cell-stack">{planName(plan, loc)}<StatusBadge status={c.status} /></span>}</td>
        <td className={`num ${over ? "hosted-over-text" : ""}`}>{c.operator || plan?.kind === "byok" ? `${eur(c.spentEur, loc)} €` : `${eur(c.spentEur, loc)} / ${eur(c.budgetEur, loc)} €`}</td>
        <td className="num">{c.bots}</td>
        <td className="num">{c.awake} / {c.computers}</td>
        <td><button type="button" className="btn btn-small" aria-expanded={open} onClick={onToggle}>{open ? h("close") : h("manage")}</button></td>
      </tr>
      {open && (
        <tr className="hosted-manage-row"><td colSpan={6}><CustomerActions c={c} data={data} onChange={onChange} onError={onError} /></td></tr>
      )}
    </>
  );
}

const dateInput = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const endOfDay = (v: string) => (v ? new Date(`${v}T23:59:59`).getTime() : NaN);

function CustomerActions({ c, data, onChange, onError }: { c: AdminCustomer; data: Overview; onChange: (d: Partial<Overview>) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const loc = useLoc();
  const ids = { plan: useId(), status: useId(), period: useId(), until: useId(), ref: useId(), amount: useId(), note: useId(), days: useId() };
  const [planId, setPlanId] = useState(c.planId ?? "");
  const [status, setStatus] = useState<SubscriptionStatus>(c.status ?? "active");
  const [period, setPeriod] = useState("");
  const [until, setUntil] = useState(dateInput(Date.now() + 31 * 86_400_000));
  const [ref, setRef] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const run = async (method: string, path: string, body: unknown) => {
    setBusy(true); onError(null); setDone(false);
    try { const r = await api<{ customers: AdminCustomer[]; audit: AdminAuditEntry[] }>(method, `/admin/customers/${enc(c.id)}${path}`, body); onChange({ customers: r.customers, audit: r.audit }); setDone(true); }
    catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  if (c.operator) {
    return (
      <div className="hosted-manage">
        {data.owner && !c.owner ? (
          <div className="action-row"><div><p className="action-title">{h("aOperator")}</p><p className="muted small">{h("operatorHint")}</p></div>
            <Toggle checked label={h("aOperator")} disabled={busy} onChange={(on) => void run("PUT", "/operator", { on })} /></div>
        ) : <p className="muted small">{h("operatorHint")}</p>}
      </div>
    );
  }
  return (
    <div className="hosted-manage">
      <div className="hosted-manage-grid">
        <div className="hosted-box">
          <label className="field-label" htmlFor={ids.plan}>{h("aPlan")}</label>
          <div className="row-gap">
            <select id={ids.plan} className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {data.plans.map((p) => <option key={p.id} value={p.id}>{planName(p, loc)}{p.archived ? " (archivée)" : ""}</option>)}
            </select>
            <button type="button" className="btn btn-small" disabled={busy || planId === c.planId} onClick={() => void run("PUT", "/plan", { planId })}>{h("apply")}</button>
          </div>
        </div>
        <div className="hosted-box">
          <label className="field-label" htmlFor={ids.status}>{h("aStatus")}</label>
          <div className="row-gap">
            <select id={ids.status} className="input" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
              {(["trial", "active", "past_due", "suspended"] as SubscriptionStatus[]).map((s) => <option key={s} value={s}>{h(`st_${s}` as TextKey)}</option>)}
            </select>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("PUT", "/status", { status, periodEnd: period ? endOfDay(period) : undefined })}>{h("apply")}</button>
          </div>
          <label className="field-label small" htmlFor={ids.period}>{h("periodEnd")}</label>
          <input id={ids.period} className="input" type="date" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <div className="hosted-box">
          <p className="field-label">{h("aPaid")}</p>
          <label className="field-label small" htmlFor={ids.until}>{h("until")}</label>
          <input id={ids.until} className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          <label className="field-label small" htmlFor={ids.ref}>{h("reference")}</label>
          <input id={ids.ref} className="input" value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} />
          <button type="button" className="btn btn-primary btn-small" disabled={busy || !until} onClick={() => void run("POST", "/paid", { until: endOfDay(until), reference: ref })}>{h("markPaid")}</button>
        </div>
        <div className="hosted-box">
          <p className="field-label">{h("aCredit")}</p>
          <label className="field-label small" htmlFor={ids.amount}>{h("amount")}</label>
          <input id={ids.amount} className="input" type="number" min="0" step="1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="field-label small" htmlFor={ids.note}>{h("note")}</label>
          <input id={ids.note} className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn btn-small" disabled={busy || !(Number(amount) > 0)} onClick={() => void run("POST", "/credit", { amountEur: Number(amount), note })}>{h("addCredit")}</button>
        </div>
        <div className="hosted-box">
          <label className="field-label" htmlFor={ids.days}>{h("aTrial")}</label>
          <div className="row-gap">
            <input id={ids.days} className="input input-narrow" type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} />
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run("POST", "/trial", { days: Number(days) })}>{h("extend")}</button>
          </div>
          {c.trialEndsAt && <p className="muted small">{h("trialEnds", { date: day(c.trialEndsAt, loc) })}</p>}
          {c.periodEnd && <p className="muted small">{h("paidUntil", { date: day(c.periodEnd, loc) })}</p>}
        </div>
        <AdminCapsEditor uid={c.id} />
        {data.owner && (
          <div className="hosted-box">
            <div className="action-row"><p className="field-label">{h("aOperator")}</p><Toggle checked={false} label={h("aOperator")} disabled={busy} onChange={(on) => void run("PUT", "/operator", { on })} /></div>
            <p className="muted small">{h("operatorHint")}</p>
          </div>
        )}
      </div>
      {done && <p className="muted small" role="status">{h("done")}</p>}
    </div>
  );
}

const PLAN_NUMBERS: { key: "priceEur" | "aiBudgetEur" | "maxBots" | "maxAwakeComputers" | "storageGb" | "maxRoutines"; label: TextKey; nullable: boolean }[] = [
  { key: "priceEur", label: "price", nullable: false }, { key: "aiBudgetEur", label: "aiBudget", nullable: false }, { key: "maxBots", label: "maxBots", nullable: true },
  { key: "maxAwakeComputers", label: "maxAwake", nullable: true }, { key: "storageGb", label: "storageGb", nullable: true }, { key: "maxRoutines", label: "maxRoutines", nullable: true },
];

function PlansTab({ plans, onChange, onError }: { plans: HostedPlan[]; onChange: (p: HostedPlan[]) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const blank: HostedPlan = { id: "", kind: "included", nameFr: "", nameEn: "", descriptionFr: "", descriptionEn: "", priceEur: 0, aiBudgetEur: 0, maxBots: null, maxAwakeComputers: null, storageGb: null, maxRoutines: null, public: true, position: plans.length, archived: false };
  return (
    <div className="hosted-plan-editors">
      {plans.map((p) => <PlanEditor key={p.id} plan={p} onSaved={onChange} onError={onError} />)}
      <details className="hosted-card hosted-new-plan">
        <summary>{h("newPlan")}</summary>
        <PlanEditor plan={blank} create onSaved={onChange} onError={onError} />
      </details>
    </div>
  );
}

function PlanEditor({ plan, create, onSaved, onError }: { plan: HostedPlan; create?: boolean; onSaved: (p: HostedPlan[]) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const loc = useLoc();
  const base = useId();
  const [f, setF] = useState<Record<string, string | boolean>>(() => ({
    id: plan.id, kind: plan.kind, nameFr: plan.nameFr, nameEn: plan.nameEn, descriptionFr: plan.descriptionFr, descriptionEn: plan.descriptionEn,
    ...Object.fromEntries(PLAN_NUMBERS.map((n) => [n.key, plan[n.key] === null ? "" : String(plan[n.key])])), public: plan.public, archived: plan.archived, position: String(plan.position),
  }));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string | boolean) => { setF({ ...f, [k]: v }); setSaved(false); };
  const save = async () => {
    setBusy(true); onError(null);
    const body: Record<string, unknown> = { ...f, position: Number(f.position) || 0 };
    for (const n of PLAN_NUMBERS) body[n.key] = f[n.key] === "" ? (n.nullable ? null : 0) : Number(f[n.key]);
    try { const r = await api<{ plans: HostedPlan[] }>(create ? "POST" : "PUT", create ? "/admin/plans" : `/admin/plans/${enc(plan.id)}`, body); onSaved(r.plans); setSaved(true); }
    catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  const text = (k: string, label: TextKey, max = 60, area = false) => (
    <div className="field">
      <label className="field-label" htmlFor={`${base}-${k}`}>{h(label)}</label>
      {area ? <textarea id={`${base}-${k}`} className="input" rows={2} maxLength={max} value={String(f[k])} onChange={(e) => set(k, e.target.value)} />
        : <input id={`${base}-${k}`} className="input" maxLength={max} value={String(f[k])} onChange={(e) => set(k, e.target.value)} />}
    </div>
  );
  return (
    <section className={create ? "hosted-plan-editor" : "hosted-card hosted-plan-editor"} aria-label={create ? h("newPlan") : planName(plan, loc)}>
      {!create && <div className="hosted-plan-editor-head"><p className="action-title">{planName(plan, loc)} <code className="muted small">{plan.id}</code></p>{plan.archived && <span className="pill">{h("archived").split(" (")[0]}</span>}</div>}
      <div className="hosted-form-grid">
        {create && text("id", "planId", 40)}
        <div className="field">
          <label className="field-label" htmlFor={`${base}-kind`}>{h("kind")}</label>
          <select id={`${base}-kind`} className="input" value={String(f.kind)} onChange={(e) => set("kind", e.target.value)}>
            <option value="free">{h("kFree")}</option><option value="included">{h("kIncluded")}</option><option value="byok">{h("kByok")}</option>
          </select>
        </div>
        {text("nameFr", "nameFr")}{text("nameEn", "nameEn")}
      </div>
      <div className="hosted-form-grid">{text("descriptionFr", "descFr", 400, true)}{text("descriptionEn", "descEn", 400, true)}</div>
      <div className="hosted-form-grid is-numbers">
        {PLAN_NUMBERS.map((n) => (
          <div key={n.key} className="field">
            <label className="field-label" htmlFor={`${base}-${n.key}`}>{h(n.label)}</label>
            <input id={`${base}-${n.key}`} className="input" type="number" min="0" step="any" inputMode="decimal" value={String(f[n.key])} placeholder={n.nullable ? "∞" : "0"} onChange={(e) => set(n.key, e.target.value)} />
          </div>
        ))}
        <div className="field">
          <label className="field-label" htmlFor={`${base}-position`}>{h("position")}</label>
          <input id={`${base}-position`} className="input" type="number" min="0" value={String(f.position)} onChange={(e) => set("position", e.target.value)} />
        </div>
      </div>
      <p className="field-hint">{h("emptyNoLimit")}</p>
      <label className="hosted-check"><input type="checkbox" checked={!!f.public} onChange={(e) => set("public", e.target.checked)} /> {h("publicPlan")}</label>
      {!create && <label className="hosted-check"><input type="checkbox" checked={!!f.archived} onChange={(e) => set("archived", e.target.checked)} /> {h("archived")}</label>}
      <div className="hosted-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>{h(create ? "createPlan" : "savePlan")}</button>
        {saved && <span className="muted small" role="status">{h("done")}</span>}
      </div>
    </section>
  );
}

function InvitesTab({ data, onChange, onError }: { data: Overview; onChange: (i: PlanInviteView[]) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const loc = useLoc();
  const ids = { plan: useId(), email: useId(), days: useId() };
  const [planId, setPlanId] = useState(data.plans.find((p) => !p.archived)?.id ?? "");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("14");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true); onError(null); setLink(null);
    try { const r = await api<{ invite: PlanInviteView; invites: PlanInviteView[] }>("POST", "/admin/invites", { planId, email: email.trim(), days: Number(days) }); onChange(r.invites); setLink(r.invite.link ?? null); setEmail(""); }
    catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { onChange((await api<{ invites: PlanInviteView[] }>("DELETE", `/admin/invites/${enc(id)}`)).invites); } catch (e) { onError(errText(e)); }
  };
  const plan = (id: string) => data.plans.find((p) => p.id === id);
  return (
    <>
      <p className="muted small">{h("invIntro")}</p>
      <div className="hosted-card">
        <div className="hosted-form-grid">
          <div className="field"><label className="field-label" htmlFor={ids.plan}>{h("cPlan")}</label>
            <select id={ids.plan} className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>{data.plans.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{planName(p, loc)}</option>)}</select></div>
          <div className="field"><label className="field-label" htmlFor={ids.email}>{h("invEmail")}</label><input id={ids.email} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label className="field-label" htmlFor={ids.days}>{h("invDays")}</label><input id={ids.days} className="input" type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        </div>
        <div className="hosted-actions"><button type="button" className="btn btn-primary btn-small" disabled={busy || !planId} onClick={() => void create()}><Icon name="send" size={14} /> {h("invCreate")}</button></div>
        {link && <div className="hosted-link"><span className="muted small">{h("invLink")}</span><code>{link}</code><CopyButton text={link} /></div>}
      </div>
      {data.invites.length > 0 && (
        <ul className="hosted-list">
          {data.invites.map((i) => (
            <li key={i.id} className="list-row">
              <div className="list-row-text"><span className="list-row-title">{planName(plan(i.planId), loc)} · {i.email || h("invAny")}</span>
                <span className="list-row-sub">{i.usedAt ? h("invUsed") : h("invExpires", { date: day(i.expiresAt, loc) })}</span></div>
              <button type="button" className="btn btn-small" onClick={() => void remove(i.id)}>{h("invRemove")}</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ProvidersTab({ data, onChange, onError }: { data: Overview; onChange: (d: Overview) => void; onError: (e: string | null) => void }) {
  const h = useH();
  return (
    <>
      <p className="muted small">{h("provIntro")}</p>
      {data.providers.length === 0 ? <p className="muted small">{h("provNone")}</p> : (
        <ul className="hosted-list">
          {data.providers.map((p) => (
            <li key={p.id} className="list-row">
              <div className="list-row-text"><span className="list-row-title">{p.name}{!p.hasKey && <span className="pill">{h("noKey")}</span>}</span><span className="list-row-sub">{p.models.join(", ") || "—"}</span></div>
              <Toggle checked={p.lent} label={h("lend")} disabled={!p.hasKey} onChange={async (on) => {
                try { onChange(await api<Overview>("PUT", `/admin/providers/${enc(p.id)}/lend`, { on })); } catch (e) { onError(errText(e)); }
              }} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SettingsTab({ data, onChange, onError }: { data: Overview; onChange: (s: HostedSettings) => void; onError: (e: string | null) => void }) {
  const h = useH();
  const loc = useLoc();
  const base = useId();
  const [s, setS] = useState<HostedSettings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const upd = (patch: Partial<HostedSettings>) => { setS({ ...s, ...patch }); setSaved(false); };
  const save = async () => {
    setBusy(true); onError(null);
    try { const r = await api<{ settings: HostedSettings }>("PUT", "/admin/settings", s); onChange(r.settings); setS(r.settings); setSaved(true); }
    catch (e) { onError(errText(e)); } finally { setBusy(false); }
  };
  const num = (label: TextKey, value: number, on: (n: number) => void, step = "any", hint?: TextKey) => (
    <div className="field">
      <label className="field-label" htmlFor={`${base}-${label}`}>{h(label)}</label>
      <input id={`${base}-${label}`} className="input" type="number" min="0" step={step} inputMode="decimal" value={String(value)} onChange={(e) => on(Number(e.target.value))} />
      {hint && <p className="field-hint">{h(hint)}</p>}
    </div>
  );
  const LEGAL: [keyof HostedSettings["legal"], TextKey][] = [["company", "lCompany"], ["legalForm", "lLegalForm"], ["capital", "lCapital"], ["address", "lAddress"], ["siret", "lSiret"], ["vat", "lVat"], ["director", "lDirector"], ["email", "lEmail"], ["phone", "lPhone"], ["host", "lHost"], ["mediator", "lMediator"]];
  return (
    <div className="hosted-settings">
      <h3 className="pane-heading">{h("sMoney")}</h3>
      <div className="hosted-form-grid is-numbers">
        {num("rate", s.usdToEur, (n) => upd({ usdToEur: n }), "0.01")}
        {num("trialDays", s.trialDays, (n) => upd({ trialDays: n }), "1")}
        {num("graceDays", s.graceDays, (n) => upd({ graceDays: n }), "1")}
        {num("trialBudget", s.trialBudgetEur, (n) => upd({ trialBudgetEur: n }))}
      </div>
      <p className="field-hint">{h("rateHint")}</p>
      <div className="hosted-form-grid">
        <div className="field"><label className="field-label" htmlFor={`${base}-contact`}>{h("contactUrl")}</label><input id={`${base}-contact`} className="input" value={s.contactUrl} placeholder="mailto:contact@example.com" onChange={(e) => upd({ contactUrl: e.target.value })} /></div>
        <div className="field"><label className="field-label" htmlFor={`${base}-default`}>{h("defaultPlan")}</label>
          <select id={`${base}-default`} className="input" value={s.signupDefaultPlan} onChange={(e) => upd({ signupDefaultPlan: e.target.value })}>{data.plans.filter((p) => !p.archived && p.public).map((p) => <option key={p.id} value={p.id}>{planName(p, loc)}</option>)}</select></div>
      </div>
      <div className="action-row hosted-engines"><div><p className="action-title">{h("engines")}</p><p className="muted small">{h("enginesHint")}</p></div><Toggle checked={s.subscriptionEngines} label={h("engines")} onChange={(on) => upd({ subscriptionEngines: on })} /></div>
      <h3 className="pane-heading">{h("sEstimates")}</h3>
      <p className="field-hint">{h("estHint")}</p>
      <div className="hosted-form-grid is-numbers">
        {num("imageUsd", s.estimates.imageUsd, (n) => upd({ estimates: { ...s.estimates, imageUsd: n } }))}
        {num("videoUsd", s.estimates.videoUsd, (n) => upd({ estimates: { ...s.estimates, videoUsd: n } }))}
        {num("sttUsd", s.estimates.sttUsdPerMinute, (n) => upd({ estimates: { ...s.estimates, sttUsdPerMinute: n } }))}
        {num("ttsUsd", s.estimates.ttsUsdPer1kChars, (n) => upd({ estimates: { ...s.estimates, ttsUsdPer1kChars: n } }))}
      </div>
      <h3 className="pane-heading">{h("sLegal")}</h3>
      <p className="field-hint">{h("legalHint")}</p>
      <div className="hosted-form-grid">
        {LEGAL.map(([k, label]) => (
          <div key={k} className="field"><label className="field-label" htmlFor={`${base}-l-${k}`}>{h(label)}</label><input id={`${base}-l-${k}`} className="input" maxLength={400} value={s.legal[k]} placeholder="[À COMPLÉTER]" onChange={(e) => upd({ legal: { ...s.legal, [k]: e.target.value } })} /></div>
        ))}
      </div>
      <div className="hosted-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>{h("saveSettings")}</button>
        {saved && <span className="muted small" role="status">{h("done")}</span>}
      </div>
    </div>
  );
}

function AuditList({ entries }: { entries: AdminAuditEntry[] }) {
  const h = useH();
  const loc = useLoc();
  if (!entries.length) return <p className="muted small">{h("auditEmpty")}</p>;
  return (
    <div className="table-wrap">
      <table className="table hosted-audit">
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="muted small">{new Date(e.at).toLocaleString(loc === "fr" ? "fr-FR" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
              <td className="small">{e.actorLabel === "scheduler" ? h("system") : e.actorLabel}</td>
              <td><code className="small">{e.action}</code></td>
              <td className="small">{e.targetEmail ?? ""}</td>
              <td className="small hosted-audit-detail">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
