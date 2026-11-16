import { useEffect, useState } from "react";
import { api } from "../api";
import { LOCALES, setLocale, useLocale, useT, type Key } from "../i18n";
import { applyTheme, useStore } from "../store";
import type { AppDownloads, DesktopDownload } from "../types";
import { desktopApp } from "../lib/desktop";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";

/** The public "Télécharger Sklubot" page, at /telecharger (linked from the sign-in page and from Settings). */
export const DOWNLOAD_PATH = "/telecharger";
export const isDownloadPath = (): boolean => typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === DOWNLOAD_PATH;

type Os = "windows" | "mac" | "linux" | "android" | "ios";

/** The visitor's system, from the browser's own description (only to put the right button first). */
export function detectOs(ua: string, platform: string, touchPoints: number): Os | null {
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && touchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua) || /^Win/.test(platform)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua) || /^Mac/.test(platform)) return "mac";
  if (/Linux|X11|CrOS/.test(ua) || /Linux/.test(platform)) return "linux";
  return null;
}


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
  { os: "linux", icon: "monitor", title: "dl.linux", hint: "dl.linux.hint" },
  { os: "android", icon: "smartphone", title: "dl.android", hint: "dl.android.hint" },
  { os: "ios", icon: "smartphone", title: "dl.ios", hint: "dl.ios.hint" },
];

export function DownloadPage() {
  const t = useT();
  const locale = useLocale();
  const [data, setData] = useState<AppDownloads | null>(null);
  const [failed, setFailed] = useState(false);
  const os = detectOs(navigator.userAgent, navigator.platform ?? "", navigator.maxTouchPoints ?? 0);
  const inDesktopApp = !!desktopApp();
  const mb = (bytes: number): string => t("dl.mb", { n: Math.max(1, Math.round(bytes / 1_000_000)) });

  useEffect(() => {
    applyTheme(useStore.getState().theme);
    document.title = t("dl.title");
    api<AppDownloads>("GET", "/downloads").then(setData, () => setFailed(true));
  }, [t]);

  const releases = data?.releasesUrl ?? "https://github.com/smokersklubs-dot/grok-sklubs/releases";
  const order = os ? [...SECTIONS.filter((s) => s.os === os), ...SECTIONS.filter((s) => s.os !== os)] : SECTIONS;

  const buttons = (target: Os) => {
    if (target === "ios") return null;
    if (target === "android") {
      if (!data?.android) return <a className="btn btn-small" href={releases} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> {t("dl.releases")}</a>;
      return <a className={`btn btn-small ${os === "android" ? "btn-accent" : ""}`} href={data.android.url} download={data.android.name ?? "sklubot.apk"}><Icon name="download" size={14} /> {t("dl.file.apk")}{data.android.version ? ` ${data.android.version}` : ""} · {mb(data.android.size)}</a>;
    }
    const files = (data?.desktop ?? []).filter((f) => f.os === target);
    return (
      <>
        {files.map((f, i) => (
          <a key={f.name} className={`btn btn-small ${os === target && i === 0 ? "btn-accent" : ""}`} href={f.url} download={f.name} title={f.name}>
            <Icon name="download" size={14} /> {t(DESKTOP_LABEL[f.kind])} · {mb(f.size)}
          </a>
        ))}
        <a className="btn btn-small btn-ghost" href={releases} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} /> {t(files.length ? "dl.allVersions" : "dl.releases")}</a>
      </>
    );
  };

  return (
    <main className="download-page">
      <header className="download-head">
        <a className="download-brand" href="/"><Avatar shape="squircle" color="ember" name="S" size={40} /><span>Sklubot</span></a>
        <div className="segmented" role="radiogroup" aria-label={t("signin.language")}>
          {LOCALES.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? "is-active" : ""} onClick={() => void setLocale(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </header>
      <h1>{t("dl.title")}</h1>
      <p className="download-intro">{t("dl.intro")}</p>
      {inDesktopApp && <p className="signin-notice" role="status">{t("dl.inApp")}</p>}
      {failed && <p className="signin-notice" role="status">{t("dl.failed")}</p>}
      <ul className="download-list">
        {order.map((s) => (
          <li key={s.os} className={`download-card ${s.os === os ? "is-mine" : ""}`}>
            <span className="logo-tile" aria-hidden="true"><Icon name={s.icon} size={18} /></span>
            <div className="download-text">
              <h2>
                {t(s.title)}
                {s.os === os && <span className="chip download-mine">{t("dl.yours")}</span>}
              </h2>
              <p className="muted small">{t(s.hint)}</p>
              <div className="download-actions">{buttons(s.os)}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="download-foot muted small">{t("dl.foot")}</p>
      <a className="btn btn-ghost btn-small" href="/">← {t("dl.back")}</a>
    </main>
  );
}
