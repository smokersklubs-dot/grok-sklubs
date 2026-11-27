import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useT, intlTag } from "../i18n";
import { money } from "../lib/format";
import { bars, busiest, type UsageDay } from "../lib/usagechart";
import { useStore } from "../store";
import "./UsageChart.css";

/** L142: the account's spending over the last 30 days, one bar a day (Settings → Usage). */
export function UsageChart({ initial }: { initial?: { days: UsageDay[]; totalUsd: number; estimatedUsd: number } }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [data, setData] = useState(initial ?? null), [error, setError] = useState("");
  useEffect(() => {
    if (initial) return;
    let dead = false;
    api<{ days: UsageDay[]; totalUsd: number; estimatedUsd: number }>("GET", "/usage/daily").then((d) => !dead && setData(d), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [initial]);
  if (error) return <p className="muted small" role="alert">{error}</p>;
  if (!data) return null;
  const H = 96, W = 300, gap = 2, bw = W / data.days.length - gap;
  const { top, bars: list } = bars(data.days, H);
  const peak = busiest(data.days);
  const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(intlTag(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const summary = t("usage.daily.summary", { total: money(data.totalUsd), estimate: money(data.estimatedUsd) });
  return (
    <figure className="usage-chart">
      <figcaption className="usage-chart-head">
        <span className="usage-chart-title">{t("usage.daily.title")}</span>
        <span className="muted small">{peak ? summary : t("usage.daily.empty")}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`${t("usage.daily.title")}. ${peak ? summary : t("usage.daily.empty")}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H} y2={H} className="usage-chart-axis" />
        {list.map((b, i) => {
          const x = i * (bw + gap);
          return (
            <g key={b.day}>
              <title>{t("usage.daily.bar", { day: dayLabel(b.day), cost: money(b.cost), turns: b.turns })}{b.estimate > 0 ? ` · ${t("usage.daily.estimate", { estimate: money(b.estimate) })}` : ""}</title>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              {b.costH > 0 && <rect className="usage-chart-bar" x={x} y={H - b.costH} width={bw} height={b.costH} rx="1" />}
              {b.estimateH > 0 && <rect className="usage-chart-est" x={x} y={H - b.costH - b.estimateH} width={bw} height={b.estimateH} rx="1" />}
            </g>
          );
        })}
      </svg>
      <div className="usage-chart-scale muted small">
        <span>{dayLabel(data.days[0].day)}</span>
        {peak && <span>{t("usage.daily.top", { top: money(top) })}</span>}
        <span>{dayLabel(data.days[data.days.length - 1].day)}</span>
      </div>
      {peak && <p className="muted small">{t("usage.daily.peak", { day: dayLabel(peak.day), cost: money(peak.costUsd + peak.estimatedUsd) })}{data.estimatedUsd > 0 ? ` ${t("usage.daily.legend")}` : ""}</p>}
    </figure>
  );
}
