/**
 * The landing page's downloads (Landing.tsx): the visitor's system, the best file for it from GET /api/downloads, the
 * hero's download button and the « Applications » section. Nothing is invented: a system without a file on this server
 * gets « Utiliser en ligne » and a link to the full download page (/telecharger, DownloadPage.tsx).
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useT, type Key } from "../i18n";
import { desktopApp } from "../lib/desktop";
import type { AppDownloads } from "../types";
import { DOWNLOAD_PATH, visitorOs, type Os } from "../lib/platform";
import { Icon, type IconName } from "./Icon";

export type { Os };
export { visitorOs };
export interface PickedFile { url: string; name: string; size: number; version: string }

/** The one file to offer for a system, or null: Windows installer before the .zip, .deb before the AppImage. */
export function pickFile(data: AppDownloads | null, os: Os | null): PickedFile | null {
  if (!data || !os || os === "ios") return null;
  if (os === "android") return data.android ? { url: data.android.url, name: data.android.name ?? "sklubot.apk", size: data.android.size, version: data.android.version ?? "" } : null;
  const order = { exe: 0, dmg: 0, deb: 0, AppImage: 1, zip: 1 } as const;
  const f = data.desktop.filter((d) => d.os === os).sort((a, b) => order[a.kind] - order[b.kind])[0];
  return f ? { url: f.url, name: f.name, size: f.size, version: f.version } : null;
}

/** GET /api/downloads once; `undefined` while it loads, `null` when it failed. */
export function useDownloads(): AppDownloads | null | undefined {
  const [data, setData] = useState<AppDownloads | null | undefined>(undefined);
  useEffect(() => { api<AppDownloads>("GET", "/downloads").then(setData, () => setData(null)); }, []);
  return data;
}

export const DL_LABEL: Partial<Record<Os, Key>> = { windows: "lp.dl.windows", linux: "lp.dl.linux", android: "lp.dl.android" };
export const mbOf = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000));

/** The hero's second button: a direct download for this system, or « Utiliser en ligne ». */
export function HeroDownload({ data, os, onOnline }: { data: AppDownloads | null | undefined; os: Os | null; onOnline: () => void }) {
  const t = useT();
  if (desktopApp()) return null;
  const file = pickFile(data ?? null, os);
  const label = os ? DL_LABEL[os] : undefined;
  // While the list loads, a Windows/Linux/Android visitor already sees the right words (they lead to /telecharger).
  if (label && (file || data === undefined)) {
    return (
      <a className="btn lp-cta-alt" href={file?.url ?? DOWNLOAD_PATH} download={file ? file.name : undefined} title={file ? t("lp.dl.meta", { v: file.version, mb: mbOf(file.size) }) : undefined}>
        <Icon name="download" size={16} />{t(label)}
      </a>
    );
  }
  return <button type="button" className="btn lp-cta-alt" onClick={onOnline}><Icon name="globe" size={16} />{t("lp.dl.online")}</button>;
}

const CARDS: { os: Os | "web"; icon: IconName; title: Key; text: Key }[] = [
  { os: "web", icon: "globe", title: "lp.apps.web.t", text: "lp.apps.web" },
  { os: "windows", icon: "monitor", title: "lp.apps.windows.t", text: "lp.apps.windows" },
  { os: "linux", icon: "terminal", title: "lp.apps.linux.t", text: "lp.apps.linux" },
  { os: "android", icon: "smartphone", title: "lp.apps.android.t", text: "lp.apps.android" },
];

/** « Applications »: the browser, then one card per system with its file from this server (the visitor's own first). */
export function AppsGrid({ data, os, onOnline }: { data: AppDownloads | null | undefined; os: Os | null; onOnline: () => void }) {
  const t = useT();
  const inApp = !!desktopApp();
  const mine = (c: (typeof CARDS)[number]) => c.os === os || (c.os === "web" && (os === "ios" || os === "mac"));
  const cards = [...CARDS].sort((a, b) => Number(mine(b)) - Number(mine(a)));
  return (
    <>
      {inApp && <p className="lp-apps-note" role="status">{t("lp.apps.inApp")}</p>}
      <div className="lp-apps">
        {cards.map((c, i) => {
          const file = c.os === "web" ? null : pickFile(data ?? null, c.os);
          return (
            <article key={c.os} className={`lp-app lp-reveal ${mine(c) ? "is-mine" : ""}`} style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="lp-app-head">
                <span className="lp-app-icon" aria-hidden="true"><Icon name={c.icon} size={20} /></span>
                <h3>{t(c.title)}</h3>
                {mine(c) && <span className="lp-chip">{t("lp.apps.yours")}</span>}
              </div>
              <p className="lp-app-text">{t(c.text)}</p>
              {c.os === "windows" && file && (
                <p className="lp-app-warn"><Icon name="shield" size={14} /><span><b>{t("lp.apps.warnTitle")}</b> {t("lp.smartscreen")}</span></p>
              )}
              <div className="lp-app-action">
                {c.os === "web" ? (
                  <>
                    <button type="button" className={`btn btn-block ${mine(c) ? "btn-primary" : ""}`} onClick={onOnline}><Icon name="globe" size={15} />{t("lp.dl.online")}</button>
                    <p className="lp-app-meta">{t("lp.apps.web.meta")}</p>
                  </>
                ) : file ? (
                  <>
                    <a className={`btn btn-block ${mine(c) ? "btn-primary" : ""}`} href={file.url} download={file.name}><Icon name="download" size={15} />{t(DL_LABEL[c.os] ?? "lp.dl.all")}</a>
                    <p className="lp-app-meta">{file.version ? t("lp.dl.meta", { v: file.version, mb: mbOf(file.size) }) : t("lp.dl.size", { mb: mbOf(file.size) })}</p>
                  </>
                ) : (
                  <>
                    <a className="btn btn-block" href={DOWNLOAD_PATH}>{t("lp.apps.see")}</a>
                    {data !== undefined && <p className="lp-app-meta">{t("lp.apps.none")}</p>}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="lp-apps-foot">
        <span>{t("lp.apps.other")}</span>
        <a href={DOWNLOAD_PATH}>{t("lp.dl.all")} →</a>
      </p>
    </>
  );
}
