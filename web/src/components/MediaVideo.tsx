/**
 * The two videos of the public pages (Landing.tsx, DownloadPage.tsx), served from web/public/media/ (same origin: the
 * CSP's media-src 'self' allows them; the server answers byte ranges, so players can seek):
 *  - "film": the 45-second presentation film (marketing/promo), 16:9, or 9:16 on a phone held upright;
 *  - "usage": a real walkthrough of the app recorded in demo mode (sign-up, template, chat, approval, Today, call).
 * Native player only: nothing loads before a click (preload="none"), never autoplay with sound, French captions on.
 */
import { useMemo } from "react";
import { useT, type Key } from "../i18n";

const MEDIA = {
  film: { src: "/media/sklubot-film-16x9.mp4", poster: "/media/sklubot-film-poster.jpg", tall: { src: "/media/sklubot-film-9x16.mp4", poster: "/media/sklubot-film-poster-9x16.jpg" }, vtt: "/media/sklubot-film.fr.vtt", label: "lp.video.filmLabel" },
  usage: { src: "/media/sklubot-utilisation.mp4", poster: "/media/sklubot-utilisation-poster.jpg", tall: null, vtt: "/media/sklubot-utilisation.fr.vtt", label: "lp.video.usageLabel" },
} as const;

export function MediaVideo({ kind, className = "" }: { kind: keyof typeof MEDIA; className?: string }) {
  const t = useT();
  const m = MEDIA[kind];
  // A phone held upright gets the vertical cut of the film (chosen once: a <source media> is not read by every browser).
  const tall = useMemo(() => !!m.tall && typeof window !== "undefined" && window.matchMedia("(max-width: 600px) and (orientation: portrait)").matches, [m]);
  const src = tall && m.tall ? m.tall.src : m.src;
  const poster = tall && m.tall ? m.tall.poster : m.poster;
  return (
    <figure className={`lp-video ${tall ? "is-tall" : ""} ${className}`}>
      <video controls playsInline preload="none" poster={poster} aria-label={t(m.label as Key)}>
        <source src={src} type="video/mp4" />
        <track kind="captions" srcLang="fr" label={t("lp.video.captions")} src={m.vtt} default />
        <a href={src}>{t("lp.video.fallback")}</a>
      </video>
    </figure>
  );
}
