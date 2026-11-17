/**
 * The public "Télécharger Sklubot" page, at /telecharger (linked from the landing page, the sign-in page and Settings).
 * Its own chunk (App.tsx), in the landing page's look (landing.css): the visitor's system first with its file from
 * GET /api/downloads, what to do when Windows SmartScreen warns about the unsigned app, every file of every system with
 * its size, the usage video, and the way to an account. Nothing is invented: a system without a file says so.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { LOCALES, setLocale, useLocale, useT, type Key } from "../i18n";
import { applyTheme, useStore } from "../store";
import type { AppDownloads, DesktopDownload } from "../types";
import { desktopApp } from "../lib/desktop";
import { visitorOs, type Os } from "../lib/platform";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { DL_LABEL, mbOf, pickFile } from "./LandingApps";
import { MediaVideo } from "./MediaVideo";
import { Bot, FALLBACK } from "./LandingVisuals";
import "../styles/landing.css";

const DESKTOP_LABEL: Record<DesktopDownload["kind"], Key> = {
  exe: "dl.file.exe",
  zip: "dl.file.zip",
  dmg: "dl.file.dmg",
  AppImage: "dl.file.appimage",
  deb: "dl.file.deb",
};

const SECTIONS: { os: Os; icon: IconName; title: Key; hint: Key }[] = [
  { os: "windows", icon: "monitor", title: "dl.windows", hint: "dl.windows.hint" },
  { os: "mac", icon: "monitor", title: "dl.mac", hint: "dl.mac.hint" },
  { os: "linux", icon: "terminal", title: "dl.linux", hint: "dl.linux.hint" },
  { os: "android", icon: "smartphone", title: "dl.android", hint: "dl.android.hint" },
  { os: "ios", icon: "smartphone", title: "dl.ios", hint: "dl.ios.hint" },
];
const SS_STEPS: [Key, Key][] = [["dl.ss.s1t", "dl.ss.s1"], ["dl.ss.s2t", "dl.ss.s2"], ["dl.ss.s3t", "dl.ss.s3"]];

/** The SmartScreen warning, drawn plainly (not a copy of Windows): the message, the link, then the button. */
function SmartScreenScene() {
  const t = useT();
  return (
    <div className="dlp-ss-art" role="img" aria-label={t("dl.ss.mockLabel")}>
      <div className="dlp-ss-win" aria-hidden="true">
        <p className="dlp-ss-title">{t("dl.ss.mockTitle")}</p>
        <span className="dlp-ss-lines"><i /><i /></span>
        <span className="dlp-ss-link"><b>2</b>{t("dl.ss.mockMore")}</span>
        <span className="dlp-ss-actions"><span className="dlp-ss-key is-run"><b>3</b>{t("dl.ss.mockRun")}</span><span className="dlp-ss-key">{t("dl.ss.mockDont")}</span></span>
      </div>
    </div>
  );
}

export default function DownloadPage() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<AppDownloads | null | undefined>(undefined);
  const os = useMemo(visitorOs, []);
  const inDesktopApp = !!desktopApp();

  // The app shell is not mounted here, so the page applies the saved theme itself (once).
  useEffect(() => { applyTheme(useStore.getState().theme); }, []);
  useEffect(() => { api<AppDownloads>("GET", "/downloads").then(setData, () => setData(null)); }, []);
  useEffect(() => { document.title = t("dl.title"); }, [t]);

  const releases = data?.releasesUrl ?? "https://github.com/smokersklubs-dot/grok-sklubs/releases";
  const order = os ? [...SECTIONS.filter((s) => s.os === os), ...SECTIONS.filter((s) => s.os !== os)] : SECTIONS;
  const mine = pickFile(data ?? null, os);
  const myLabel = os ? DL_LABEL[os] : undefined;
  const osName = os ? t(`dl.os.${os}` as Key) : "";

  const files = (target: Os) => {
    if (target === "ios") return null;
    if (target === "android") {
      if (!data?.android) return <a className="btn btn-small" href={releases} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> {t("dl.releases")}</a>;
      return <a className={`btn ${os === "android" ? "btn-primary" : ""}`} href={data.android.url} download={data.android.name ?? "sklubot.apk"}><Icon name="download" size={15} /> {t("dl.file.apk")}{data.android.version ? ` ${data.android.version}` : ""} · {t("dl.mb", { n: mbOf(data.android.size) })}</a>;
    }
    const list = (data?.desktop ?? []).filter((f) => f.os === target);
    return (
      <>
        {list.map((f, i) => (
          <a key={f.name} className={`btn ${os === target && i === 0 ? "btn-primary" : ""}`} href={f.url} download={f.name} title={f.name}>
            <Icon name="download" size={15} /> {t(DESKTOP_LABEL[f.kind])} · {t("dl.mb", { n: mbOf(f.size) })}
          </a>
        ))}
        <a className="btn btn-ghost btn-small" href={releases} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> {t(list.length ? "dl.allVersions" : "dl.releases")}</a>
      </>
    );
  };

  const smartScreen = (
        <section className={`lp-section ${os === "windows" ? "is-band" : ""}`} id="smartscreen" aria-labelledby="ss-title">
          <div className="lp-section-in dlp-ss">
            <div className="dlp-ss-copy">
              <p className="lp-kicker">{t("dl.ss.kicker")}</p>
              <h2 id="ss-title" className="lp-h2">{t("dl.ss.title")}</h2>
              <p className="lp-lead">{t("dl.ss.sub")}</p>
              <ol className="dlp-ss-steps">
                {SS_STEPS.map(([title, text], i) => <li key={title}><span className="lp-step-n" aria-hidden="true">{i + 1}</span><div><h3>{t(title)}</h3><p>{t(text)}</p></div></li>)}
              </ol>
            </div>
            <SmartScreenScene />
          </div>
        </section>
  );

  return (
    <div className="lp dlp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="/" aria-label="Sklubot"><Avatar shape="squircle" color="ember" name="S" size={32} /><span>Sklubot</span></a>
          <div className="lp-nav-actions">
            <div className="segmented lp-lang" role="radiogroup" aria-label={t("signin.language")}>
              {LOCALES.map((l) => <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>{l.id.toUpperCase()}</button>)}
            </div>
            <a className="btn btn-ghost lp-signin" href="/?auth=login">{t("lp.signIn")}</a>
            <a className="btn btn-primary lp-nav-cta" href="/?auth=signup">{t("lp.signUp")}</a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero dlp-hero" aria-labelledby="dl-h1">
          <div className="lp-hero-bg" aria-hidden="true" />
          <div className="lp-hero-copy">
            <div className="dlp-cast lp-in" aria-hidden="true">{FALLBACK.map((b, i) => <Bot key={b.name} b={{ name: b.name, job: "", look: b.look }} size={i === 1 || i === 2 ? 72 : 58} state={i === 1 ? "happy" : "idle"} />)}</div>
            <p className="lp-eyebrow lp-in"><span className="lp-dot" aria-hidden="true" />{t("dl.eyebrow")}</p>
            <h1 id="dl-h1" className="lp-h1 dlp-h1 lp-in">{t("dl.h1a")}<em>{t("dl.h1em")}</em></h1>
            <p className="lp-sub lp-in">{t("dl.intro")}</p>
            {inDesktopApp && <p className="lp-apps-note" role="status">{t("dl.inApp")}</p>}
            {data === null && <p className="lp-apps-note" role="status">{t("dl.failed")}</p>}
            {!inDesktopApp && (
              <div className="dlp-pick lp-in">
                {os && <p className="dlp-pick-for"><Icon name={os === "android" || os === "ios" ? "smartphone" : "monitor"} size={15} />{t("dl.forYou")} · <b>{osName}</b></p>}
                <div className="lp-cta">
                  {mine && myLabel ? (
                    <a className="btn btn-primary lp-cta-main" href={mine.url} download={mine.name}><Icon name="download" size={17} />{t(myLabel)}</a>
                  ) : data === undefined && myLabel ? (
                    <a className="btn btn-primary lp-cta-main" href="#all"><Icon name="download" size={17} />{t(myLabel)}</a>
                  ) : null}
                  <a className={mine || (data === undefined && myLabel) ? "btn lp-cta-alt" : "btn btn-primary lp-cta-main"} href="/?auth=login"><Icon name="globe" size={16} />{t("lp.dl.online")}</a>
                </div>
                {mine && <p className="dlp-meta">{mine.name} · {mine.version ? t("lp.dl.meta", { v: mine.version, mb: mbOf(mine.size) }) : t("lp.dl.size", { mb: mbOf(mine.size) })}</p>}
                {!mine && data !== undefined && os && <p className="dlp-meta">{t("dl.noFile", { os: osName })}</p>}
                {mine && <p className="dlp-meta">{t("dl.onlineHint")}</p>}
              </div>
            )}
          </div>
        </section>

        {os === "windows" && smartScreen}
        <section className={`lp-section ${os === "windows" ? "" : "is-band"}`} id="all" aria-labelledby="all-title">
          <div className="lp-section-in">
            <div className="lp-section-head">
              <p className="lp-kicker">{t("dl.all.kicker")}</p>
              <h2 id="all-title" className="lp-h2">{t("dl.all.title")}</h2>
            </div>
            <ul className="dlp-list">
              {order.map((s) => (
                <li key={s.os} className={`lp-app ${s.os === os ? "is-mine" : ""}`}>
                  <div className="lp-app-head">
                    <span className="lp-app-icon" aria-hidden="true"><Icon name={s.icon} size={20} /></span>
                    <h3>{t(s.title)}</h3>
                    {s.os === os && <span className="lp-chip">{t("dl.yours")}</span>}
                  </div>
                  <p className="lp-app-text">{t(s.hint)}</p>
                  <div className="dlp-files">{files(s.os)}</div>
                </li>
              ))}
            </ul>
            <p className="lp-apps-foot">{t("dl.foot")}</p>
          </div>
        </section>

        {os !== "windows" && smartScreen}
        <section className="lp-section is-band" id="how" aria-labelledby="how-title">
          <div className="lp-section-in">
            <div className="lp-section-head">
              <p className="lp-kicker">{t("lp.usage.kicker")}</p>
              <h2 id="how-title" className="lp-h2">{t("lp.usage.title")}</h2>
              <p className="lp-lead">{t("lp.usage.sub")}</p>
            </div>
            <div className="lp-usage">
              <MediaVideo kind="usage" />
              <p className="lp-video-note">{t("lp.usage.note")}</p>
            </div>
          </div>
        </section>

        <section className="lp-final" aria-labelledby="dl-final-title">
          <div className="lp-final-card">
            <h2 id="dl-final-title" className="lp-h2">{t("dl.final.title")}</h2>
            <p className="lp-lead">{t("dl.final.sub")}</p>
            <div className="lp-cta is-center">
              <a className="btn btn-primary lp-cta-main" href="/?auth=signup">{t("lp.signUpFree")}<span aria-hidden="true">→</span></a>
              <a className="btn lp-cta-alt" href="/?auth=login">{t("lp.signIn")}</a>
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
            <a href="/">← {t("dl.back")}</a>
            <a href={locale === "fr" ? "/confidentialite" : "/privacy"}>{t("lp.foot.privacy")}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
