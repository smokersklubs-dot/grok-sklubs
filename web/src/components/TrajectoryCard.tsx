import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import type { CreationStage, TrajectoryCard as TrajectoryCardData, TrajectoryRender } from "../types";
import { Icon, type IconName } from "./Icon";
import { defaultPair, pick, sameAsPrevious } from "../lib/trajectory";
import "./TrajectoryCard.css";

/**
 * L158 « Créations »: the trajectory of a long creative work (server agent/creations.ts) — the named stages (study /
 * build / check / ready) with the one reached, the successive renders as thumbnails in order, « aucun changement » on a
 * render identical to the one before, « aucun progrès » when the last renders brought nothing, and a side-by-side compare
 * of two renders (by default the last two). Previews come from the owner-only route /bots/:id/creations/:cid/renders/:rid:
 * images and videos inline; a page in a sandboxed frame WITHOUT allow-same-origin (it can never reach the app); any other
 * file is only a link to download.
 */
const STAGES: CreationStage[] = ["study", "build", "check", "ready"];
const KIND_ICON: Record<TrajectoryRender["kind"], IconName> = { image: "image", video: "play", page: "globe", file: "file" };

let sourceOf = (botId: string, creationId: string, renderId: number) => `/api/bots/${encodeURIComponent(botId)}/creations/${encodeURIComponent(creationId)}/renders/${renderId}`;
/** The dev gallery shows sample pictures instead of asking the server. */
export const setRenderSource = (fn: typeof sourceOf) => { sourceOf = fn; };

function Preview({ r, src, big }: { r: TrajectoryRender; src: string; big?: boolean }) {
  const t = useT();
  if (!r.preview) return <span className="traj-noprev"><Icon name={KIND_ICON[r.kind]} size={big ? 22 : 16} />{big && <span>{t("trajectory.noPreview")}</span>}</span>;
  if (r.kind === "image") return <img src={src} alt={t("trajectory.renderAlt", { n: r.n, name: r.name })} loading="lazy" decoding="async" />;
  if (r.kind === "video") return big ? <video src={src} controls preload="metadata" aria-label={t("trajectory.renderAlt", { n: r.n, name: r.name })} /> : <span className="traj-noprev"><Icon name="play" size={16} /></span>;
  if (r.kind === "page") return big ? <iframe src={src} title={t("trajectory.renderAlt", { n: r.n, name: r.name })} sandbox="allow-scripts" loading="lazy" referrerPolicy="no-referrer" /> : <span className="traj-noprev"><Icon name="globe" size={16} /></span>;
  return <span className="traj-noprev"><Icon name="file" size={big ? 22 : 16} />{big && <span>{r.name}</span>}</span>;
}

export function TrajectoryCardView({ card, botId }: { card: TrajectoryCardData; botId: string }) {
  const t = useT();
  const [picked, setPicked] = useState<number[]>(() => defaultPair(card.renders));
  const [comparing, setComparing] = useState(false);
  const strip = useRef<HTMLUListElement>(null);
  const last = card.renders[card.renders.length - 1]?.id;
  // The newest render is the one that matters: the strip opens scrolled to it, and again when a new one arrives.
  useEffect(() => { const el = strip.current; if (el) el.scrollLeft = el.scrollWidth; }, [last]);
  const reached = STAGES.indexOf(card.stage);
  const byId = useMemo(() => new Map(card.renders.map((r) => [r.id, r])), [card.renders]);
  const shown = picked.map((id) => byId.get(id)).filter((r): r is TrajectoryRender => !!r).sort((a, b) => a.n - b.n);
  const src = (r: TrajectoryRender) => sourceOf(botId, card.creationId, r.id);
  const sameAsOther = sameAsPrevious(shown);
  return (
    <div className={`card traj-card${card.stalled ? " is-stalled" : ""}`} role="group" aria-label={t("trajectory.aria", { title: card.title })}>
      <div className="card-head">
        <span className="traj-icon" aria-hidden="true"><Icon name="image" size={16} /></span>
        <div className="card-head-text">
          <div className="card-title">{card.title}</div>
          <div className="card-sub">{t("trajectory.count", { n: card.total })}</div>
        </div>
      </div>
      <ol className="traj-stages" aria-label={t("trajectory.stagesAria")}>
        {STAGES.map((s, i) => (
          <li key={s} className={i < reached ? "is-done" : i === reached ? "is-current" : ""} aria-current={i === reached ? "step" : undefined}>
            <span className="traj-dot" aria-hidden="true">{i < reached ? <Icon name="check" size={11} /> : i + 1}</span>
            <span className="traj-stage-label">{t(`trajectory.stage.${s}`)}</span>
          </li>
        ))}
      </ol>
      {card.stalled && <p className="traj-stalled" role="status"><Icon name="alert" size={14} /> {t("trajectory.stalled")}</p>}
      <ul ref={strip} className="traj-strip" aria-label={t("trajectory.stripAria")}>
        {card.total > card.renders.length && <li className="traj-more muted">{t("trajectory.older", { n: card.total - card.renders.length })}</li>}
        {card.renders.map((r) => (
          <li key={r.id}>
            <button type="button" className={`traj-thumb${picked.includes(r.id) ? " is-picked" : ""}`} aria-pressed={picked.includes(r.id)}
              aria-label={t("trajectory.thumbAria", { n: r.n, stage: t(`trajectory.stage.${r.stage}`), name: r.name })} title={r.note || r.name}
              onClick={() => setPicked((p) => pick(p, r.id))}>
              <span className="traj-thumb-img"><Preview r={r} src={src(r)} /></span>
              <span className="traj-thumb-label">{r.n} · {t(`trajectory.stage.${r.stage}`)}</span>
              {r.unchanged && <span className="traj-same">{t("trajectory.unchanged")}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="card-actions">
        <span className="muted traj-hint">{t("trajectory.pickHint")}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-small" disabled={shown.length < 1} aria-expanded={comparing} onClick={() => setComparing((v) => !v)}>
          <Icon name="eye" size={14} /> {comparing ? t("trajectory.hideCompare") : shown.length === 2 ? t("trajectory.compare") : t("trajectory.view")}
        </button>
      </div>
      {comparing && shown.length > 0 && (
        <div className={`traj-compare is-${shown.length}`}>
          {sameAsOther && <p className="traj-same-note muted">{t("trajectory.sameNote", { a: shown[0].n, b: shown[1].n })}</p>}
          {shown.map((r) => (
            <figure key={r.id} className="traj-side">
              <div className={`traj-side-media is-${r.kind}`}><Preview r={r} src={src(r)} big /></div>
              <figcaption>
                <strong>{t("trajectory.renderN", { n: r.n })}</strong> · {t(`trajectory.stage.${r.stage}`)}
                {r.note && <span className="traj-note">{r.note}</span>}
                {r.preview && <a href={src(r)} target="_blank" rel="noopener noreferrer" className="traj-open">{r.kind === "file" ? t("trajectory.download") : t("trajectory.open")} <Icon name="external" size={12} /></a>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
