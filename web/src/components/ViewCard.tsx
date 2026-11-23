import { useId, useState, type FormEvent } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { ViewBlock, ViewCard as ViewCardData, ViewField } from "../types";
import { Icon } from "./Icon";
import "./ViewCard.css";
import { PinViewButton } from "./ChatPlus";

/**
 * DS-Bot item 8: a view card in the chat (server agent/viewcard.ts) — key figures, a table, a bar or line chart, a
 * progress bar, a short text and a small form. Drawn from checked data by our own components only: every string is
 * React text (escaped), the chart is our SVG, there is no HTML, script, image or link from the model. A form's answer goes
 * to POST /bots/:id/cards/:seq/view and reaches the bot as the owner's next message. The plain-text fallback the server
 * keeps is shown under "Voir en texte" (and is what the phone app and chat services get).
 */
const PALETTE = ["var(--brand)", "var(--info)", "var(--ok)", "var(--warn)"];
const lang = () => (typeof document !== "undefined" && document.documentElement.lang) || undefined;
const fmt = (n: number) => n.toLocaleString(lang(), { maximumFractionDigits: 2 });

export function ViewCardView({ card, botId, seq, pinned = false }: { card: ViewCardData; botId: string; seq: number; /** On the dashboard (L184): no « Épingler ». */ pinned?: boolean }) {
  const t = useT();
  const [asText, setAsText] = useState(false);
  return (
    <div className="card view-card" role="group" aria-label={card.title}>
      <div className="card-head">
        <span className="view-card-icon" aria-hidden="true"><Icon name="chart" size={16} /></span>
        <div className="card-head-text"><div className="card-title">{card.title}</div></div>
      </div>
      {asText ? <pre className="view-fallback">{card.fallback}</pre> : card.blocks.map((b, i) => <Block key={i} block={b} card={card} botId={botId} seq={seq} />)}
      <div className="card-actions">
        <button type="button" className="btn btn-small btn-ghost" aria-pressed={asText} onClick={() => setAsText((v) => !v)}>{asText ? t("view.asView") : t("view.asText")}</button>
        {!pinned && <PinViewButton botId={botId} seq={seq} />}
      </div>
    </div>
  );
}

function Block({ block, card, botId, seq }: { block: ViewBlock; card: ViewCardData; botId: string; seq: number }) {
  switch (block.kind) {
    case "text": return <p className="view-text">{block.text}</p>;
    case "stats": return (
      <dl className="view-stats">
        {block.items.map((x, i) => (
          <div key={i} className="view-stat"><dt>{x.label}</dt><dd>{x.value}</dd>{x.hint && <span className="view-stat-hint">{x.hint}</span>}</div>
        ))}
      </dl>
    );
    case "table": return (
      <div className="view-table-wrap" tabIndex={0} role="region" aria-label={block.columns.join(", ")}>
        <table className="view-table">
          <thead><tr>{block.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
          <tbody>{block.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    case "chart": return <Chart block={block} />;
    case "progress": {
      const pct = Math.round((block.value / block.max) * 100);
      return (
        <div className="view-progress">
          <div className="view-progress-top"><span>{block.label}</span><span>{fmt(block.value)} / {fmt(block.max)} · {pct} %</span></div>
          <div className="view-progress-bar" role="progressbar" aria-label={block.label || undefined} aria-valuemin={0} aria-valuemax={block.max} aria-valuenow={block.value}><span style={{ width: `${pct}%` }} /></div>
        </div>
      );
    }
    case "form": return <Form block={block} card={card} botId={botId} seq={seq} />;
  }
}

function Chart({ block }: { block: Extract<ViewBlock, { kind: "chart" }> }) {
  const W = 320, H = 150, P = { l: 36, r: 8, t: 10, b: 24 };
  const all = block.series.flatMap((s) => s.values);
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - min) / span);
  const n = block.labels.length;
  const step = (W - P.l - P.r) / n;
  const x = (i: number) => P.l + step * (i + 0.5);
  const summary = block.series.map((s) => `${s.name}: ${block.labels.map((l, i) => `${l} ${fmt(s.values[i])}${block.unit ?? ""}`).join(", ")}`).join(". ");
  const showEvery = Math.ceil(n / 8);
  return (
    <figure className="view-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="view-axis" />
        <text x={P.l - 4} y={y(max) + 4} className="view-tick" textAnchor="end">{fmt(max)}</text>
        {min < 0 && <text x={P.l - 4} y={y(min) + 4} className="view-tick" textAnchor="end">{fmt(min)}</text>}
        {block.labels.map((l, i) => (i % showEvery === 0 ? <text key={i} x={x(i)} y={H - 6} className="view-tick" textAnchor="middle">{l.slice(0, 8)}</text> : null))}
        {block.chart === "bar"
          ? block.series.map((s, si) => s.values.map((v, i) => {
              const w = (step * 0.7) / block.series.length;
              const left = x(i) - (step * 0.35) + si * w;
              return <rect key={`${si}-${i}`} x={left} width={Math.max(1, w - 1)} y={Math.min(y(v), y(0))} height={Math.abs(y(0) - y(v))} rx={2} fill={PALETTE[si % PALETTE.length]} />;
            }))
          : block.series.map((s, si) => <polyline key={si} fill="none" stroke={PALETTE[si % PALETTE.length]} strokeWidth={2} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />)}
      </svg>
      {block.series.length > 1 || block.unit ? (
        <figcaption className="view-legend">
          {block.series.map((s, i) => <span key={i}><i style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true" />{s.name}</span>)}
          {block.unit && <span className="muted">({block.unit})</span>}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Form({ block, card, botId, seq }: { block: Extract<ViewBlock, { kind: "form" }>; card: ViewCardData; botId: string; seq: number }) {
  const t = useT();
  const uid = useId();
  const own = useStore((s) => !s.bots[botId]?.access);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (card.status !== "pending") {
    return <p className={`card-outcome is-${card.status === "answered" ? "allowed" : "denied"}`}><Icon name={card.status === "answered" ? "check" : "close"} size={14} />{card.status === "answered" ? t("view.answered", { answer: card.answer ?? "" }) : t("view.closed")}</p>;
  }
  const set = (id: string, v: string | boolean) => setValues((cur) => ({ ...cur, [id]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/view`, { values }); } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const close = async () => { setBusy(true); try { await api("POST", `/bots/${enc(botId)}/cards/${seq}/view/dismiss`); } catch (err) { setError(errText(err)); } finally { setBusy(false); } };
  return (
    <form className="view-form" onSubmit={(e) => void submit(e)}>
      {block.fields.map((f) => <Field key={f.id} f={f} id={`${uid}${f.id}`} value={values[f.id]} onChange={(v) => set(f.id, v)} />)}
      {error && <p className="small channels-error" role="alert">{error}</p>}
      {own ? (
        <div className="card-actions">
          <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void close()}>{t("view.close")}</button>
          <button type="submit" className="btn btn-small btn-primary" disabled={busy}>{block.submit}</button>
        </div>
      ) : <p className="muted small">{t("view.ownerOnly")}</p>}
    </form>
  );
}

function Field({ f, id, value, onChange }: { f: ViewField; id: string; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  if (f.type === "checkbox") return <label className="view-check" htmlFor={id}><input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {f.label}</label>;
  return (
    <div className="view-field">
      <label className="field-label" htmlFor={id}>{f.label}{f.required ? " *" : ""}</label>
      {f.type === "choice"
        ? <select id={id} className="input" value={typeof value === "string" ? value : ""} required={f.required} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        : <input id={id} className="input" type={f.type === "number" ? "number" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} step="any" placeholder={f.placeholder} required={f.required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
