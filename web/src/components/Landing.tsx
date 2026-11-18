/**
 * The public landing page (OPEN_SIGNUP=1, server publicsignup.ts): what a signed-out visitor sees at "/" on a server open
 * to sign-ups. Loaded lazily (App.tsx), so the app's own bundle does not carry its code (its texts are in i18n, "lp.*").
 * Everything shown is real: the template gallery and the plans come from GET /api/public/landing, the downloads from
 * GET /api/downloads (LandingApps.tsx), the characters are Sklubot's own (Character.tsx), and no number, logo or
 * testimonial is made up; illustrations say « Exemple ». French first, English second; light and dark; 390 px first.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { LOCALES, tn, useLocale, useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { HostedPlan, TeamFileLook } from "../types";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { AppsGrid, HeroDownload, useDownloads, visitorOs } from "./LandingApps";
import { MediaVideo } from "./MediaVideo";
import { AskCard, Bot, CallCard, ComputerScene, FALLBACK, JobsScene, MemoryScene, TeamWindow, type DeskBot } from "./LandingVisuals";
import "../styles/landing.css";

export interface LandingTemplate { id: string; title: string; description: string; icon: string; category: string; bots: { name: string; role: string; look: TeamFileLook }[] }
export interface LandingData {
  templates: LandingTemplate[];
  hosted: { plans: HostedPlan[]; credits?: { packs: { id: string; amountEur: number }[]; payments: boolean; forSale?: boolean }; trialDays: number; freeComputers: "pool" | "personal" | "none"; links: { pricing: string; terms: string; legal: string; privacy: string } } | null;
  verification: boolean;
  turnstile: boolean;
}
type OnAuth = (mode: "login" | "signup", opts?: { plan?: string }) => void;

const TRUST_ICONS: IconName[] = ["users", "lock", "globe", "pause"];
const TPL_ICONS = new Set<string>(["sun", "star", "target", "image", "calendar", "search", "chat", "chart", "book", "users", "mail", "bolt"]);
const MORE: Key[] = ["lp.more.routines", "lp.more.goals", "lp.more.group", "lp.more.apps", "lp.more.pause"];
const FAQ: [Key, Key][] = [["lp.faq.q1", "lp.faq.a1"], ["lp.faq.q2", "lp.faq.a2"], ["lp.faq.q3", "lp.faq.a3"], ["lp.faq.q4", "lp.faq.a4"], ["lp.faq.q5", "lp.faq.a5"], ["lp.faq.q6", "lp.faq.a6"], ["lp.faq.q7", "lp.faq.a7"], ["lp.faq.q8", "lp.faq.a8"]];
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sections fade in as they scroll into view (at once under reduced motion or without IntersectionObserver). */
function useReveal(): void {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".lp-reveal:not(.is-in)")];
    if (!("IntersectionObserver" in window) || reducedMotion()) { for (const e of els) e.classList.add("is-in"); return; }
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px -8% 0px" });
    for (const e of els) io.observe(e);
    return () => io.disconnect();
  });
}

function Section({ id, kicker, title, sub, children, className = "" }: { id: string; kicker: string; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`lp-section ${className}`} aria-labelledby={`${id}-title`}>
      <div className="lp-section-in">
        <div className="lp-section-head lp-reveal">
          <p className="lp-kicker">{kicker}</p>
          <h2 id={`${id}-title`} className="lp-h2">{title}</h2>
          {sub && <p className="lp-lead">{sub}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Tile({ title, text, children, className = "", delay = 0 }: { title: string; text: string; children: ReactNode; className?: string; delay?: number }) {
  return (
    <article className={`lp-tile lp-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      <div className="lp-tile-art">{children}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function Ways({ packs, forSale, loc, onStart }: { packs: { amountEur: number }[]; forSale: boolean; loc: "fr" | "en"; onStart: () => void }) {
  const t = useT();
  const from = packs.length ? Math.min(...packs.map((p) => p.amountEur)) : null;
  // No Sklubot credits for sale (the default): free, on the person's own OpenRouter, ChatGPT or Claude account.
  const items: { icon: "star" | "brain" | "key" | "bolt" | "globe"; title: Key; text: Key; featured?: boolean }[] = !forSale ? [
    { icon: "star", title: "lp.ways.freeOwnT", text: "lp.ways.freeOwn", featured: true },
    { icon: "globe", title: "lp.ways.orT", text: "lp.ways.or" },
    { icon: "brain", title: "lp.ways.subT", text: "lp.ways.sub" },
  ] : [
    { icon: "star", title: "lp.ways.freeT", text: "lp.ways.free", featured: true },
    { icon: "brain", title: "lp.ways.subT", text: "lp.ways.sub" },
    { icon: "key", title: "lp.ways.keyT", text: "lp.ways.key" },
    { icon: "bolt", title: "lp.ways.creditsT", text: "lp.ways.credits" },
  ];
  return (
    <>
      <div className="lp-ways">
        {items.map((w, i) => (
          <article key={w.title} className={`lp-way lp-reveal ${w.featured ? "is-featured" : ""}`} style={{ transitionDelay: `${i * 60}ms` }}>
            <span className="lp-way-icon" aria-hidden="true"><Icon name={w.icon} size={18} /></span>
            <h3>{t(w.title)}</h3>
            <p>{t(w.text)}</p>
            {w.icon === "bolt" && from !== null && <p className="lp-chip">{t("lp.ways.from", { n: loc === "fr" ? `${String(from).replace(".", ",")} €` : `€${from}` })}</p>}
          </article>
        ))}
      </div>
      <div className="lp-center lp-reveal"><button type="button" className="btn btn-primary lp-big" onClick={onStart}>{t("lp.price.chooseFree")}</button></div>
    </>
  );
}

export default function Landing({ onAuth }: { onAuth: OnAuth }) {
  const t = useT();
  const locale = useLocale();
  const loc = locale === "fr" ? "fr" : "en";
  const setLocale = useStore((s) => s.setLocale);
  const [data, setData] = useState<LandingData | null>(null);
  const [menu, setMenu] = useState(false);
  const downloads = useDownloads();
  const os = useMemo(visitorOs, []);
  useEffect(() => { api<LandingData>("GET", `/public/landing?locale=${loc}`).then(setData, () => setData(null)); }, [loc]);
  useEffect(() => {
    document.title = t("lp.title");
    return () => { document.title = "Sklubot"; };
  }, [t]);
  useReveal();

  const plans = data?.hosted?.plans ?? [];
  const freeOffered = !data?.hosted || plans.some((p) => p.kind === "free" && p.priceEur === 0);
  const signUpLabel = t(freeOffered ? "lp.signUpFree" : "lp.signUp");
  const team: DeskBot[] = useMemo(() => {
    const real = (data?.templates ?? []).filter((tp) => tp.bots[0]).map((tp) => ({ name: tp.bots[0].name, job: tp.title, look: tp.bots[0].look }));
    return real.length >= 4 ? real.slice(0, 4) : FALLBACK.map((b) => ({ name: b.name, job: t(b.job), look: b.look }));
  }, [data, t]);
  const jobs = data?.templates.length ? data.templates.map((tp) => tp.title) : FALLBACK.map((b) => t(b.job));
  const pool = data?.hosted?.freeComputers === "pool" && plans.some((p) => p.kind === "free");
  const links = data?.hosted?.links ?? ({ privacy: loc === "fr" ? "/confidentialite" : "/privacy" } as Partial<NonNullable<LandingData["hosted"]>["links"]>);
  const go = (id: string) => { setMenu(false); document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); };
  const nav: [string, string][] = [["what", t("lp.nav.what")], ["how", t("lp.nav.how")], ...(data?.templates.length ? [["templates", t("lp.nav.templates")] as [string, string]] : []), ["apps", t("lp.nav.apps")], ...(plans.length ? [["pricing", t("lp.nav.pricing")] as [string, string]] : []), ["faq", t("lp.nav.faq")]];
  const navLinks = nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>);
  const online = () => onAuth("login");
  const hasFile = !!downloads && (os === "windows" || os === "linux" || os === "android") && (os === "android" ? !!downloads.android : downloads.desktop.some((f) => f.os === os));
  const showsDownload = downloads === undefined ? os === "windows" || os === "linux" || os === "android" : hasFile;

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">{t("lp.skip")}</a>
      <header className={`lp-nav ${menu ? "is-open" : ""}`}>
        <div className="lp-nav-inner">
          <a className="lp-brand" href="/" aria-label="Sklubot"><Avatar shape="squircle" color="ember" name="S" size={32} /><span>Sklubot</span></a>
          <nav className="lp-nav-links" aria-label={t("lp.menu")}>{navLinks}</nav>
          <div className="lp-nav-actions">
            <div className="segmented lp-lang" role="radiogroup" aria-label={t("lp.language")}>
              {LOCALES.map((l) => <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>{l.id.toUpperCase()}</button>)}
            </div>
            <button type="button" className="btn btn-ghost lp-signin" onClick={() => onAuth("login")}>{t("lp.signIn")}</button>
            <button type="button" className="btn btn-primary lp-nav-cta" onClick={() => onAuth("signup")}>{t("lp.signUp")}</button>
            <button type="button" className="icon-btn lp-burger" aria-expanded={menu} aria-label={t("lp.menu")} onClick={() => setMenu((v) => !v)}><Icon name={menu ? "close" : "menu"} size={18} /></button>
          </div>
        </div>
        {menu && (
          <nav className="lp-drawer" aria-label={t("lp.menu")}>
            {navLinks}
            <div className="lp-drawer-actions">
              <button type="button" className="btn btn-block" onClick={() => onAuth("login")}>{t("lp.signIn")}</button>
              <button type="button" className="btn btn-primary btn-block" onClick={() => onAuth("signup")}>{signUpLabel}</button>
            </div>
          </nav>
        )}
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-hero-bg" aria-hidden="true" />
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-in"><span className="lp-dot" aria-hidden="true" />{t("lp.eyebrow")}</p>
            <h1 id="lp-h1" className="lp-h1 lp-in" style={{ animationDelay: "80ms" }}>
              <span className="lp-h1-a">{t("lp.h1a")}</span> <span className="lp-h1-b">{t("lp.h1b")}<em>{t("lp.h1em")}</em></span>
            </h1>
            <p className="lp-sub lp-in" style={{ animationDelay: "180ms" }}>{t("lp.sub")}</p>
            <div className="lp-cta lp-in" style={{ animationDelay: "260ms" }}>
              <button type="button" className="btn btn-primary lp-cta-main" onClick={() => onAuth("signup")}>{signUpLabel}<span aria-hidden="true">→</span></button>
              <HeroDownload data={downloads} os={os} onOnline={online} />
            </div>
            <div className="lp-hero-notes lp-in" style={{ animationDelay: "340ms" }}>
              {showsDownload ? (
                <p>{t("lp.hero.online")} <span className="lp-nowrap">{t("lp.hero.haveAccount")} <button type="button" className="link" onClick={() => onAuth("login")}>{t("lp.signIn")}</button></span></p>
              ) : (
                <p>{t("lp.hero.haveAccount")} <button type="button" className="link" onClick={() => onAuth("login")}>{t("lp.signIn")}</button> · <a href="/telecharger">{t("lp.dl.all")}</a></p>
              )}
              {os === "windows" && showsDownload && <p className="lp-hero-warn"><Icon name="shield" size={14} /><span>{t("lp.smartscreen")}</span></p>}
            </div>
          </div>
          <div className="lp-hero-art lp-in" style={{ animationDelay: "300ms" }}>
            <TeamWindow bots={team} />
          </div>
        </section>

        <section className="lp-cinema" aria-labelledby="film-title">
          <div className="lp-cinema-in">
            <div className="lp-section-head lp-reveal">
              <p className="lp-kicker">{t("lp.film.kicker")}</p>
              <h2 id="film-title" className="lp-h2">{t("lp.film.title")}</h2>
              <p className="lp-lead">{t("lp.film.sub")}</p>
            </div>
            <div className="lp-reveal"><MediaVideo kind="film" /></div>
          </div>
        </section>

        <Section id="what" kicker={t("lp.what.kicker")} title={t("lp.what.title")} sub={t("lp.what.sub")}>
          <div className="lp-bento">
            <Tile className="is-job" title={t("lp.f.job.t")} text={t("lp.f.job")}><JobsScene jobs={jobs} /></Tile>
            <Tile className="is-memory" title={t("lp.f.memory.t")} text={t("lp.f.memory")} delay={60}><MemoryScene /></Tile>
            <Tile className="is-voice" title={t("lp.f.voice.t")} text={t("lp.f.voice")} delay={120}><div className="lp-scene lp-voice" aria-hidden="true"><CallCard b={team[2] ?? team[0]} /></div></Tile>
            <Tile className="is-pc" title={t("lp.f.pc.t")} text={pool ? `${t("lp.f.pc")} ${t("lp.f.pc.pool")}` : t("lp.f.pc")}><ComputerScene b={team[3] ?? team[0]} /></Tile>
            <Tile className="is-ok" title={t("lp.f.ok.t")} text={t("lp.f.ok")} delay={60}><div className="lp-scene lp-okscene" aria-hidden="true"><span className="lp-okbot"><Bot b={team[0]} size={56} state="waiting" /></span><AskCard name={team[0].name} /></div></Tile>
          </div>
          <div className="lp-more lp-reveal">
            <span className="lp-more-label">{t("lp.more")}</span>
            <ul aria-label={t("lp.more")}>{MORE.map((k) => <li key={k}>{t(k)}</li>)}</ul>
          </div>
        </Section>

        <Section id="how" kicker={t("lp.usage.kicker")} title={t("lp.usage.title")} sub={t("lp.usage.sub")} className="is-band">
          <div className="lp-usage lp-reveal">
            <MediaVideo kind="usage" />
            <p className="lp-video-note">{t("lp.usage.note")}</p>
          </div>
          <ol className="lp-steps">
            {([["lp.how.s1t", data?.verification ? "lp.how.s1v" : "lp.how.s1"], ["lp.how.s2t", "lp.how.s2"], ["lp.how.s3t", "lp.how.s3"]] as [Key, Key][]).map(([title, text], i) => (
              <li key={title} className="lp-step lp-reveal" style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="lp-step-n" aria-hidden="true">{i + 1}</span>
                <h3>{t(title)}</h3>
                <p>{t(text)}</p>
              </li>
            ))}
          </ol>
        </Section>

        {data && data.templates.length > 0 && (
          <Section id="templates" kicker={t("lp.tpl.kicker")} title={t("lp.tpl.title")} sub={t("lp.tpl.sub")}>
            <div className="lp-templates">
              {data.templates.map((tp, i) => (
                <article key={tp.id} className="lp-tpl lp-reveal" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                  <div className="lp-tpl-cast" aria-hidden="true">
                    {tp.bots.slice(0, 3).map((b, j) => <Bot key={j} b={{ name: b.name, job: "", look: b.look }} size={48} />)}
                  </div>
                  <div className="lp-tpl-head">
                    <span className="lp-tpl-icon" aria-hidden="true"><Icon name={(TPL_ICONS.has(tp.icon) ? tp.icon : "star") as IconName} size={15} /></span>
                    <h3>{tp.title}</h3>
                  </div>
                  <p className="lp-tpl-desc">{tp.description}</p>
                  <p className="lp-tpl-names">{tp.bots.map((b) => b.name).join(" · ")} <span>({tn("lp.tpl.bots", tp.bots.length)})</span></p>
                </article>
              ))}
            </div>
            <div className="lp-center lp-reveal"><button type="button" className="btn btn-primary lp-big" onClick={() => onAuth("signup")}>{signUpLabel}</button></div>
          </Section>
        )}

        <Section id="apps" kicker={t("lp.apps.kicker")} title={t("lp.apps.title")} sub={t("lp.apps.sub")} className="is-band">
          <AppsGrid data={downloads} os={os} onOnline={online} />
        </Section>

        {plans.length > 0 && data?.hosted && (
          <Section id="pricing" kicker={t("lp.price.kicker")} title={t("lp.ways.title")} sub={t(data.hosted.credits?.forSale ? "lp.ways.sub2" : "lp.ways.sub2Own")}>
            {/* Hosted mode: every account is free; the bots run on the person's subscription, their key, or credits. */}
            <Ways packs={data.hosted.credits?.packs ?? []} forSale={data.hosted.credits?.forSale === true} loc={loc} onStart={() => onAuth("signup")} />
            <p className="lp-center lp-small"><a href={data.hosted.links.pricing}>{t("lp.price.all")}</a></p>
          </Section>
        )}

        <Section id="trust" kicker={t("lp.trust.kicker")} title={t("lp.trust.title")} className={plans.length ? "is-band" : ""}>
          <div className="lp-trust">
            {([1, 2, 3, 4] as const).map((n, i) => (
              <div key={n} className="lp-trust-item lp-reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-trust-icon" aria-hidden="true"><Icon name={TRUST_ICONS[i]} size={18} /></span>
                <div><h3>{t(`lp.trust.t${n}t` as Key)}</h3><p>{t(`lp.trust.t${n}` as Key)}</p></div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="faq" kicker={t("lp.faq.kicker")} title={t("lp.faq.title")} className={plans.length ? "" : "is-band"}>
          <div className="lp-faq lp-reveal">
            {FAQ.map(([q, a]) => (
              <details key={q} className="lp-faq-item">
                <summary><span>{t(q)}</span><Icon name="plus" size={16} /></summary>
                <p>{t(a)}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="lp-final" aria-labelledby="lp-final-title">
          <div className="lp-final-card lp-reveal">
            <div className="lp-final-cast" aria-hidden="true">{team.slice(0, 4).map((b, i) => <Bot key={i} b={b} size={i === 1 || i === 2 ? 64 : 52} state="happy" />)}</div>
            <h2 id="lp-final-title" className="lp-h2">{t("lp.final.title")}</h2>
            <p className="lp-lead">{t("lp.final.sub")}</p>
            <div className="lp-cta is-center">
              <button type="button" className="btn btn-primary lp-cta-main" onClick={() => onAuth("signup")}>{signUpLabel}<span aria-hidden="true">→</span></button>
              <HeroDownload data={downloads} os={os} onOnline={online} />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-inner">
          <div className="lp-foot-brand">
            <span className="lp-brand"><Avatar shape="squircle" color="ember" name="S" size={28} /><span>Sklubot</span></span>
            <p>{t("lp.foot.tag")}</p>
          </div>
          <nav className="lp-foot-links" aria-label={t("lp.links")}>
            {links.pricing && <a href={links.pricing}>{t("lp.foot.pricing")}</a>}
            <a href="/telecharger">{t("lp.foot.apps")}</a>
            {links.terms && <a href={links.terms}>{t("lp.foot.terms")}</a>}
            {links.legal && <a href={links.legal}>{t("lp.foot.legal")}</a>}
            <a href={links.privacy ?? "/confidentialite"}>{t("lp.foot.privacy")}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
