/**
 * The public landing page (OPEN_SIGNUP=1, server publicsignup.ts): what a signed-out visitor sees at "/" on a server open
 * to sign-ups. Loaded lazily (App.tsx), so the app's own bundle does not carry it. Everything shown is real: the
 * template gallery and the plans come from GET /api/public/landing, the characters are Sklubot's own (Character.tsx),
 * and no number, logo or testimonial is made up. French first, English second; light and dark; 390 px first.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { LOCALES, useLocale } from "../i18n";
import { useStore } from "../store";
import { DEFAULT_CHARACTER } from "../types";
import type { AvatarColor, AvatarShape, Character as CharacterLook, HostedPlan, TeamFileLook } from "../types";
import { Avatar } from "./Avatar";
import { Character, type CharacterState } from "./Character";
import { Icon, type IconName } from "./Icon";
import "../styles/landing.css";

export interface LandingTemplate { id: string; title: string; description: string; icon: string; category: string; bots: { name: string; role: string; look: TeamFileLook }[] }
export interface LandingData {
  templates: LandingTemplate[];
  hosted: { plans: HostedPlan[]; trialDays: number; freeComputers: "pool" | "personal" | "none"; links: { pricing: string; terms: string; legal: string; privacy: string } } | null;
  verification: boolean;
  turnstile: boolean;
}

type Loc = "fr" | "en";
const L = {
  fr: {
    navWhat: "Ce qu'ils font", navHow: "Fonctionnement", navTemplates: "Modèles", navPricing: "Tarifs", navFaq: "Questions",
    signIn: "Se connecter", signUpFree: "Créer un compte gratuit", signUp: "Créer un compte", menu: "Menu", language: "Langue",
    eyebrow: "Des assistants IA qui travaillent vraiment",
    h1a: "Une équipe de bots qui ", h1em: "travaille", h1b: " pour toi.",
    sub: "Donne à chaque bot un métier, une mémoire et un ordinateur. Ils avancent sur tes tâches, même quand tu n'es pas là, et te demandent toujours avant une action qu'on ne peut pas défaire.",
    reassure: "Tu gardes la main : chaque action importante attend ton accord.",
    stageLabel: "Illustration : quatre bots au travail et une demande d'accord.",
    askTitle: "{name} demande ton accord", askText: "Envoyer le récapitulatif de la semaine à Claire ?", irreversible: "Action irréversible",
    askWhy: "Un e-mail envoyé ne se reprend pas.", refuse: "Refuser", allowOnce: "Autoriser une fois",
    states: { idle: "Disponible", thinking: "Réfléchit", working: "Au travail", happy: "Terminé", waiting: "T'attend" } as Record<string, string>,
    whatKicker: "Ce qu'ils font", whatTitle: "Pas un chatbot de plus : des collègues avec un vrai poste.",
    f1t: "Un métier", f1: "Chaque bot a un rôle, des consignes et des compétences. Écris son métier en quelques lignes, ou pars d'un modèle.",
    f2t: "Une mémoire", f2: "Il retient ce que tu lui apprends : tes préférences, tes clients, ta façon d'écrire. Tu peux relire et effacer ce qu'il garde.",
    f3t: "Son propre ordinateur", f3: "Un ordinateur Linux isolé, avec un navigateur, pour chercher, remplir des formulaires et préparer des fichiers. Tu peux regarder son écran en direct.",
    f3pool: "Avec l'offre gratuite, l'ordinateur est prêté le temps d'une tâche, puis effacé.",
    f4t: "Ton accord avant l'irréversible", f4: "Envoyer, payer, supprimer, publier : le bot s'arrête, te montre ce qu'il va faire, et attend. Tu autorises une fois, ou tu refuses.",
    extras: ["Routines programmées", "Discussions de groupe entre bots", "Applis connectées", "Pause à tout moment"],
    howKicker: "Fonctionnement", howTitle: "Trois étapes, et ton équipe est au travail.",
    s1t: "Crée ton compte", s1: "Une adresse e-mail et un mot de passe suffisent.",
    s1v: "Une adresse e-mail et un mot de passe suffisent. Tu confirmes ton adresse d'un clic.",
    s2t: "Choisis ton équipe", s2: "Pars d'un modèle prêt à l'emploi ou d'un seul assistant, et donne-lui un nom.",
    s3t: "Confie une première tâche", s3: "Écris comme à un collègue. Le bot s'y met, te tient au courant et te sollicite quand il a besoin de toi.",
    tplKicker: "Modèles", tplTitle: "Des équipes prêtes à démarrer.",
    tplSub: "Chaque modèle crée des bots prudents : leurs compétences arrivent en brouillon et leurs routines en pause, jusqu'à ce que tu les valides.",
    tplBots: (n: number) => (n > 1 ? `${n} bots` : "1 bot"), tplUse: "Démarrer avec ce modèle",
    priceKicker: "Tarifs", priceTitle: "Des offres simples, en euros.", priceSub: "Le budget IA couvre les modèles d'IA du service. Tu peux changer d'offre quand tu veux.",
    perMonth: "/ mois", trial: (n: number) => `Essai de ${n} jours`, budget: (n: string) => `Budget IA : ${n} € par mois`,
    ownKeys: "Avec tes propres clés d'API", bots: (n: number) => (n > 1 ? `Jusqu'à ${n} bots` : "1 bot"), routines: (n: number) => `${n} routines actives`,
    storage: (n: number) => `${n} Go de fichiers`, pcPool: "Ordinateur prêté pour chaque tâche", pcNone: "Sans ordinateur (outils web)",
    pcOwn: (n: number) => (n > 1 ? `${n} ordinateurs allumés en même temps` : "Son propre ordinateur"), choose: "Choisir cette offre", allPrices: "Détail des tarifs",
    trustKicker: "Confiance", trustTitle: "Pensé pour qu'on puisse lui confier du travail.",
    t1t: "Comptes cloisonnés", t1: "Chaque compte ne voit que ses bots, ses fichiers et ses conversations. Les ordinateurs des bots sont des conteneurs séparés, sur un réseau où ils ne se voient pas.",
    t2t: "Secrets chiffrés", t2: "Les connexions aux applis et les mots de passe enregistrés sont chiffrés sur le serveur (AES-256-GCM).",
    t3t: "Logiciel libre, hébergeable en Europe", t3: "Sklubot est publié sous licence libre MIT et tourne sur le serveur que l'on choisit, en France ou ailleurs en Europe.",
    t4t: "Tu gardes la main", t4: "Journal de chaque action, bouton Pause, plafonds de dépenses, et ton accord avant tout ce qui ne se défait pas.",
    faqKicker: "Questions", faqTitle: "Les questions qu'on nous pose.",
    faq: [
      ["C'est quoi, un bot sur Sklubot ?", "Un assistant IA avec un rôle, une mémoire, des outils et, selon l'offre, un ordinateur. Tu lui parles comme à un collègue ; il peut aussi travailler seul, sur une routine programmée ou sur un objectif."],
      ["Un bot peut-il faire une bêtise ?", "Un nouveau bot est prudent : il demande avant d'agir. Pour tout ce qui ne se défait pas (envoi, paiement, suppression, publication), il s'arrête et attend ton accord, sans option « toujours autoriser ». Tu peux le mettre en pause à tout moment."],
      ["Quelles IA sont utilisées ?", "Les modèles d'IA proposés par ce service, ou ta propre clé d'API si tu préfères. Chaque bot peut avoir son modèle et des modèles de secours."],
      ["Où sont mes données ?", "Sur le serveur de ce service. Depuis les réglages, tu peux exporter tes données ou supprimer ton compte à tout moment."],
      ["Faut-il installer quelque chose ?", "Non : tout se passe dans le navigateur, sur ordinateur comme sur téléphone. Des applications existent aussi."],
      ["Pourquoi confirmer mon adresse e-mail ?", "Pour être sûr que c'est bien toi, et pouvoir t'aider si tu oublies ton mot de passe. Tu peux visiter tout de suite ; tes bots se mettent au travail dès la confirmation."],
    ] as [string, string][],
    ctaTitle: "Ton équipe t'attend.", ctaSub: "Crée ton compte, choisis un modèle, confie une première tâche.",
    footTag: "Une équipe de bots IA, avec leur mémoire, leurs outils et leur ordinateur.",
    terms: "CGU", legal: "Mentions légales", privacy: "Confidentialité", pricing: "Tarifs", apps: "Applications",
  },
  en: {
    navWhat: "What they do", navHow: "How it works", navTemplates: "Templates", navPricing: "Pricing", navFaq: "FAQ",
    signIn: "Sign in", signUpFree: "Create a free account", signUp: "Create an account", menu: "Menu", language: "Language",
    eyebrow: "AI assistants that actually get work done",
    h1a: "A team of bots that ", h1em: "works", h1b: " for you.",
    sub: "Give each bot a job, a memory and a computer. They move your tasks forward, even while you are away, and always ask before an action that cannot be undone.",
    reassure: "You stay in charge: every important action waits for your go-ahead.",
    stageLabel: "Illustration: four bots at work and a request for approval.",
    askTitle: "{name} asks for your go-ahead", askText: "Send the weekly summary to Claire?", irreversible: "Irreversible action",
    askWhy: "A sent e-mail cannot be taken back.", refuse: "Decline", allowOnce: "Allow once",
    states: { idle: "Available", thinking: "Thinking", working: "Working", happy: "Done", waiting: "Waiting for you" } as Record<string, string>,
    whatKicker: "What they do", whatTitle: "Not another chatbot: teammates with a real job.",
    f1t: "A job", f1: "Each bot has a role, instructions and skills. Write its job in a few lines, or start from a template.",
    f2t: "A memory", f2: "It remembers what you teach it: your preferences, your customers, the way you write. You can read and erase what it keeps.",
    f3t: "Its own computer", f3: "An isolated Linux computer with a browser, to search, fill in forms and prepare files. You can watch its screen live.",
    f3pool: "On the free plan, the computer is lent for a task, then wiped.",
    f4t: "Your go-ahead before anything irreversible", f4: "Sending, paying, deleting, publishing: the bot stops, shows you what it is about to do, and waits. You allow it once, or decline.",
    extras: ["Scheduled routines", "Group chats between bots", "Connected apps", "Pause any time"],
    howKicker: "How it works", howTitle: "Three steps, and your team is at work.",
    s1t: "Create your account", s1: "An e-mail address and a password are all it takes.",
    s1v: "An e-mail address and a password are all it takes. You confirm your address in one click.",
    s2t: "Pick your team", s2: "Start from a ready-made template or a single assistant, and give it a name.",
    s3t: "Hand over a first task", s3: "Write as you would to a colleague. The bot gets going, keeps you posted and asks when it needs you.",
    tplKicker: "Templates", tplTitle: "Teams ready to start.",
    tplSub: "Every template creates careful bots: their skills arrive as drafts and their routines paused, until you approve them.",
    tplBots: (n: number) => (n > 1 ? `${n} bots` : "1 bot"), tplUse: "Start with this template",
    priceKicker: "Pricing", priceTitle: "Simple plans, in euros.", priceSub: "The AI budget covers the service's AI models. Change plan whenever you like.",
    perMonth: "/ month", trial: (n: number) => `${n}-day trial`, budget: (n: string) => `AI budget: €${n} a month`,
    ownKeys: "With your own API keys", bots: (n: number) => (n > 1 ? `Up to ${n} bots` : "1 bot"), routines: (n: number) => `${n} active routines`,
    storage: (n: number) => `${n} GB of files`, pcPool: "A computer lent for each task", pcNone: "No computer (web tools)",
    pcOwn: (n: number) => (n > 1 ? `${n} computers awake at once` : "Its own computer"), choose: "Choose this plan", allPrices: "Pricing details",
    trustKicker: "Trust", trustTitle: "Built so you can hand it real work.",
    t1t: "Separate accounts", t1: "Each account only sees its own bots, files and conversations. The bots' computers are separate containers, on a network where they cannot see each other.",
    t2t: "Encrypted secrets", t2: "App connections and saved passwords are encrypted on the server (AES-256-GCM).",
    t3t: "Free software, hostable in Europe", t3: "Sklubot is released under the MIT licence and runs on the server you choose, in France or elsewhere in Europe.",
    t4t: "You stay in charge", t4: "A log of every action, a Pause button, spending caps, and your go-ahead before anything that cannot be undone.",
    faqKicker: "FAQ", faqTitle: "Questions people ask us.",
    faq: [
      ["What is a bot on Sklubot?", "An AI assistant with a role, a memory, tools and, depending on the plan, a computer. You talk to it like a colleague; it can also work on its own, on a scheduled routine or towards a goal."],
      ["Can a bot make a mess?", "A new bot is careful: it asks before acting. For anything that cannot be undone (sending, paying, deleting, publishing) it stops and waits for your go-ahead, with no “always allow”. You can pause it at any time."],
      ["Which AI models are used?", "The AI models this service offers, or your own API key if you prefer. Each bot can have its own model and backup models."],
      ["Where is my data?", "On this service's server. From the settings you can export your data or delete your account at any time."],
      ["Do I need to install anything?", "No: everything happens in the browser, on a computer or a phone. Apps exist too."],
      ["Why confirm my e-mail address?", "To make sure it is really you, and to help you if you forget your password. You can look around straight away; your bots start working once it is confirmed."],
    ] as [string, string][],
    ctaTitle: "Your team is waiting.", ctaSub: "Create your account, pick a template, hand over a first task.",
    footTag: "A team of AI bots, with their memory, their tools and their computer.",
    terms: "Terms", legal: "Legal notice", privacy: "Privacy", pricing: "Pricing", apps: "Apps",
  },
};

/** The desk of the hero when the gallery has not loaded yet: the looks of the real templates' first bots. */
const look = (shape: AvatarShape, color: AvatarColor, character: Partial<CharacterLook>): TeamFileLook => ({ shape, color, character: { ...DEFAULT_CHARACTER, ...character } });
const FALLBACK: { name: string; role: string; look: TeamFileLook }[] = [
  { name: "Paloma", role: "", look: look("egg", "amber", { type: "muse" }) },
  { name: "Lino", role: "", look: look("star", "ember", { accessory: "sprout", eyes: "googly", cheeks: true }) },
  { name: "Sacha", role: "", look: look("squircle", "sky", { accessory: "headset", eyes: "round" }) },
  { name: "Noé", role: "", look: look("octagon", "ink", { type: "dots" }) },
];
const STATE_CYCLE: CharacterState[] = ["idle", "thinking", "working", "happy"];
const FEATURE_ICONS: IconName[] = ["user", "brain", "monitor", "shield"];
const TRUST_ICONS: IconName[] = ["users", "lock", "globe", "pause"];
const ICONS = new Set<string>(["sun", "star", "target", "image", "calendar", "search", "chat", "chart", "book", "users", "mail", "bolt"]);

const lookOf = (b: { look: TeamFileLook }) => ({ shape: b.look.shape ?? "pebble", color: b.look.color ?? "indigo", character: b.look.character });

function useReveal(): void {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".lp-reveal")];
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { for (const e of els) e.classList.add("is-in"); return; }
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px -8% 0px" });
    for (const e of els) io.observe(e);
    return () => io.disconnect();
  });
}

function Section({ id, kicker, title, sub, children, className = "" }: { id: string; kicker: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`lp-section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="lp-section-head lp-reveal">
        <p className="lp-kicker">{kicker}</p>
        <h2 id={`${id}-title`} className="lp-h2">{title}</h2>
        {sub && <p className="lp-lead">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Stage({ t, bots }: { t: (typeof L)["fr"]; bots: { name: string; role: string; look: TeamFileLook }[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 2400);
    return () => window.clearInterval(id);
  }, []);
  const four = bots.slice(0, 4);
  const asker = four[0]?.name ?? "Paloma";
  return (
    <div className="lp-stage" role="img" aria-label={t.stageLabel}>
      <div className="lp-stage-glow" aria-hidden="true" />
      <div className="lp-desk" aria-hidden="true">
        {four.map((b, i) => {
          const state = i === 0 ? "waiting" : STATE_CYCLE[(tick + i) % STATE_CYCLE.length];
          const look = lookOf(b);
          return (
            <div key={`${b.name}-${i}`} className={`lp-bot lp-bot-${i}`}>
              <Character bot={{ shape: look.shape, color: look.color, name: b.name, character: look.character }} size={i === 0 ? 96 : 74} state={state} interactive={i === 0} label={null} />
              <span className="lp-bot-tag"><b>{b.name}</b><span className={`lp-bot-state is-${state}`}>{t.states[state]}</span></span>
            </div>
          );
        })}
      </div>
      <div className="lp-ask" aria-hidden="true">
        <div className="lp-ask-head"><Icon name="hand" size={15} /><span>{t.askTitle.replace("{name}", asker)}</span></div>
        <p className="lp-ask-text">{t.askText}</p>
        <p className="lp-ask-warn"><Icon name="alert" size={13} /><span><b>{t.irreversible}</b> · {t.askWhy}</span></p>
        <div className="lp-ask-actions"><span className="lp-fake-action">{t.refuse}</span><span className="lp-fake-action is-primary">{t.allowOnce}</span></div>
      </div>
    </div>
  );
}

function PlanCard({ p, t, loc, trialDays, freeComputers, onChoose }: { p: HostedPlan; t: (typeof L)["fr"]; loc: Loc; trialDays: number; freeComputers: "pool" | "personal" | "none"; onChoose: (id: string) => void }) {
  const name = loc === "fr" ? p.nameFr : p.nameEn;
  const desc = loc === "fr" ? p.descriptionFr : p.descriptionEn;
  const price = loc === "fr" ? `${String(p.priceEur).replace(".", ",")} €` : `€${p.priceEur}`;
  const items: string[] = [];
  if (p.kind === "byok") items.push(t.ownKeys);
  else if (p.aiBudgetEur > 0) items.push(t.budget(loc === "fr" ? String(p.aiBudgetEur).replace(".", ",") : String(p.aiBudgetEur)));
  if (p.maxBots !== null) items.push(t.bots(p.maxBots));
  if (p.kind === "free" && freeComputers !== "personal") items.push(freeComputers === "pool" ? t.pcPool : t.pcNone);
  else if (p.maxAwakeComputers !== null && p.maxAwakeComputers > 0) items.push(t.pcOwn(p.maxAwakeComputers));
  if (p.maxRoutines !== null) items.push(t.routines(p.maxRoutines));
  if (p.storageGb !== null) items.push(t.storage(p.storageGb));
  const featured = p.kind === "included";
  return (
    <article className={`lp-plan lp-reveal ${featured ? "is-featured" : ""}`}>
      <h3 className="lp-plan-name">{name}</h3>
      <p className="lp-plan-price"><span>{price}</span><small>{t.perMonth}</small></p>
      {p.priceEur > 0 && trialDays > 0 && <p className="lp-chip">{t.trial(trialDays)}</p>}
      {desc && <p className="lp-plan-desc">{desc}</p>}
      <ul className="lp-plan-list">{items.map((x) => <li key={x}><Icon name="check" size={15} />{x}</li>)}</ul>
      <button type="button" className={`btn ${featured ? "btn-primary" : ""} btn-block`} onClick={() => onChoose(p.id)}>{t.choose}</button>
    </article>
  );
}

export default function Landing({ onAuth }: { onAuth: (mode: "login" | "signup", opts?: { plan?: string }) => void }) {
  const locale = useLocale();
  const loc: Loc = locale === "fr" ? "fr" : "en";
  const t = L[loc];
  const setLocale = useStore((s) => s.setLocale);
  const [data, setData] = useState<LandingData | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    api<LandingData>("GET", `/public/landing?locale=${loc}`).then(setData, () => setData(null));
  }, [loc]);
  useEffect(() => {
    document.title = loc === "fr" ? "Sklubot — une équipe de bots qui travaille pour toi" : "Sklubot — a team of bots that works for you";
    return () => { document.title = "Sklubot"; };
  }, [loc]);
  useReveal();

  const plans = data?.hosted?.plans ?? [];
  const freeOffered = !data?.hosted || plans.some((p) => p.kind === "free" && p.priceEur === 0);
  const signUpLabel = freeOffered ? t.signUpFree : t.signUp;
  const deskBots = useMemo(() => {
    const fromTemplates = (data?.templates ?? []).map((tp) => tp.bots[0]).filter(Boolean);
    return fromTemplates.length >= 4 ? fromTemplates.slice(0, 4) : FALLBACK;
  }, [data]);
  const links = data?.hosted?.links ?? { privacy: loc === "fr" ? "/confidentialite" : "/privacy" } as Partial<NonNullable<LandingData["hosted"]>["links"]>;
  const go = (id: string) => { setMenu(false); document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); };
  const nav: [string, string][] = [["what", t.navWhat], ["how", t.navHow], ["templates", t.navTemplates], ...(plans.length ? [["pricing", t.navPricing] as [string, string]] : []), ["faq", t.navFaq]];

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">{loc === "fr" ? "Aller au contenu" : "Skip to content"}</a>
      <header className={`lp-nav ${menu ? "is-open" : ""}`}>
        <div className="lp-nav-inner">
          <a className="lp-brand" href="/" aria-label="Sklubot">
            <Avatar shape="squircle" color="ember" name="S" size={34} />
            <span>Sklubot</span>
          </a>
          <nav className="lp-nav-links" aria-label={t.menu}>
            {nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}
          </nav>
          <div className="lp-nav-actions">
            <div className="segmented lp-lang" role="radiogroup" aria-label={t.language}>
              {LOCALES.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>{l.id.toUpperCase()}</button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost lp-signin" onClick={() => onAuth("login")}>{t.signIn}</button>
            <button type="button" className="btn btn-primary lp-nav-cta" onClick={() => onAuth("signup")}>{t.signUp}</button>
            <button type="button" className="icon-btn lp-burger" aria-expanded={menu} aria-label={t.menu} onClick={() => setMenu((v) => !v)}><Icon name={menu ? "close" : "menu"} size={18} /></button>
          </div>
        </div>
        {menu && (
          <nav className="lp-drawer" aria-label={t.menu}>
            {nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}
            <button type="button" className="btn btn-block" onClick={() => onAuth("login")}>{t.signIn}</button>
          </nav>
        )}
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-in" style={{ animationDelay: "40ms" }}><span className="lp-dot" aria-hidden="true" />{t.eyebrow}</p>
            <h1 id="lp-h1" className="lp-h1 lp-in" style={{ animationDelay: "120ms" }}>{t.h1a}<em>{t.h1em}</em>{t.h1b}</h1>
            <p className="lp-sub lp-in" style={{ animationDelay: "220ms" }}>{t.sub}</p>
            <div className="lp-cta lp-in" style={{ animationDelay: "320ms" }}>
              <button type="button" className="btn btn-primary lp-cta-main" onClick={() => onAuth("signup")}>{signUpLabel}<Icon name="send" size={15} /></button>
              <button type="button" className="btn lp-cta-alt" onClick={() => onAuth("login")}>{t.signIn}</button>
            </div>
            <p className="lp-reassure lp-in" style={{ animationDelay: "420ms" }}><Icon name="shield" size={14} />{t.reassure}</p>
          </div>
          <Stage t={t} bots={deskBots} />
        </section>

        <Section id="what" kicker={t.whatKicker} title={t.whatTitle}>
          <div className="lp-features">
            {([[t.f1t, t.f1], [t.f2t, t.f2], [t.f3t, data?.hosted?.freeComputers === "pool" && plans.some((p) => p.kind === "free") ? `${t.f3} ${t.f3pool}` : t.f3], [t.f4t, t.f4]] as [string, string][]).map(([title, text], i) => (
              <article key={title} className={`lp-feature lp-reveal ${i === 3 ? "is-accent" : ""}`} style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="lp-feature-icon" aria-hidden="true"><Icon name={FEATURE_ICONS[i]} size={20} /></span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <ul className="lp-extras lp-reveal" aria-label={loc === "fr" ? "Et aussi" : "And also"}>{t.extras.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>

        <Section id="how" kicker={t.howKicker} title={t.howTitle} className="is-band">
          <ol className="lp-steps">
            {([[t.s1t, data?.verification ? t.s1v : t.s1], [t.s2t, t.s2], [t.s3t, t.s3]] as [string, string][]).map(([title, text], i) => (
              <li key={title} className="lp-step lp-reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {data && data.templates.length > 0 && (
          <Section id="templates" kicker={t.tplKicker} title={t.tplTitle} sub={t.tplSub}>
            <div className="lp-templates">
              {data.templates.map((tp, i) => (
                <article key={tp.id} className="lp-tpl lp-reveal" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                  <div className="lp-tpl-cast" aria-hidden="true">
                    {tp.bots.slice(0, 3).map((b, j) => { const look = lookOf(b); return <Character key={j} bot={{ shape: look.shape, color: look.color, name: b.name, character: look.character }} size={46} label={null} />; })}
                  </div>
                  <div className="lp-tpl-head">
                    <span className="lp-tpl-icon" aria-hidden="true"><Icon name={(ICONS.has(tp.icon) ? tp.icon : "star") as IconName} size={15} /></span>
                    <h3>{tp.title}</h3>
                  </div>
                  <p className="lp-tpl-desc">{tp.description}</p>
                  <p className="lp-tpl-names">{tp.bots.map((b) => b.name).join(" · ")} <span>({t.tplBots(tp.bots.length)})</span></p>
                </article>
              ))}
            </div>
            <div className="lp-center lp-reveal"><button type="button" className="btn btn-primary" onClick={() => onAuth("signup")}>{signUpLabel}</button></div>
          </Section>
        )}

        {plans.length > 0 && data?.hosted && (
          <Section id="pricing" kicker={t.priceKicker} title={t.priceTitle} sub={t.priceSub} className="is-band">
            <div className={`lp-plans is-${Math.min(plans.length, 3)}`}>
              {plans.map((p) => <PlanCard key={p.id} p={p} t={t} loc={loc} trialDays={data.hosted!.trialDays} freeComputers={data.hosted!.freeComputers} onChoose={(id) => onAuth("signup", { plan: id })} />)}
            </div>
            <p className="lp-center lp-small"><a href={data.hosted.links.pricing}>{t.allPrices}</a></p>
          </Section>
        )}

        <Section id="trust" kicker={t.trustKicker} title={t.trustTitle}>
          <div className="lp-trust">
            {([[t.t1t, t.t1], [t.t2t, t.t2], [t.t3t, t.t3], [t.t4t, t.t4]] as [string, string][]).map(([title, text], i) => (
              <div key={title} className="lp-trust-item lp-reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-trust-icon" aria-hidden="true"><Icon name={TRUST_ICONS[i]} size={18} /></span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="faq" kicker={t.faqKicker} title={t.faqTitle} className="is-band">
          <div className="lp-faq lp-reveal">
            {t.faq.map(([q, a]) => (
              <details key={q} className="lp-faq-item">
                <summary><span>{q}</span><Icon name="plus" size={16} /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="lp-final lp-reveal" aria-labelledby="lp-final-title">
          <div className="lp-final-cast" aria-hidden="true">
            {deskBots.slice(0, 3).map((b, i) => { const look = lookOf(b); return <Character key={i} bot={{ shape: look.shape, color: look.color, name: b.name, character: look.character }} size={52} state="happy" label={null} />; })}
          </div>
          <h2 id="lp-final-title" className="lp-h2">{t.ctaTitle}</h2>
          <p className="lp-lead">{t.ctaSub}</p>
          <div className="lp-cta is-center">
            <button type="button" className="btn btn-primary lp-cta-main" onClick={() => onAuth("signup")}>{signUpLabel}</button>
            <button type="button" className="btn lp-cta-alt" onClick={() => onAuth("login")}>{t.signIn}</button>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-inner">
          <div className="lp-foot-brand">
            <span className="lp-brand"><Avatar shape="squircle" color="ember" name="S" size={28} /><span>Sklubot</span></span>
            <p>{t.footTag}</p>
          </div>
          <nav className="lp-foot-links" aria-label={loc === "fr" ? "Liens" : "Links"}>
            {links.pricing && <a href={links.pricing}>{t.pricing}</a>}
            {links.terms && <a href={links.terms}>{t.terms}</a>}
            {links.legal && <a href={links.legal}>{t.legal}</a>}
            <a href={links.privacy ?? "/confidentialite"}>{t.privacy}</a>
            <a href="/telecharger">{t.apps}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
