import { useEffect, useState } from "react";
import { api, enc, errText } from "../api";
import { useT } from "../i18n";
import { applyCustomTheme, themeRescue } from "../lib/customtheme";
import type { BotThemeView, BotThemesView, ThemeColors } from "../types";
import { ConfirmButton, ErrorNote } from "./ui";
import "../styles/finishing.css";

/**
 * L161 « thèmes créés par le bot » (Réglages → Général): the colour themes the bots proposed (tool theme_propose,
 * server botthemes.ts). Each shows its colours in light and dark and its weakest contrast; the owner applies one,
 * goes back to the app's own colours, or removes it. A bot never applies one itself.
 */
const SWATCH: (keyof ThemeColors)[] = ["--bg", "--surface", "--text", "--accent", "--brand"];
const BASE: Record<"light" | "dark", Record<string, string>> = {
  light: { "--bg": "#f4f2ee", "--surface": "#ffffff", "--text": "#1e2024", "--accent": "#23262b", "--brand": "#b23f1b" },
  dark: { "--bg": "#131416", "--surface": "#1a1c1f", "--text": "#eceef1", "--accent": "#e8eaee", "--brand": "#ff8d66" },
};

function Swatches({ colors, mode }: { colors: ThemeColors; mode: "light" | "dark" }) {
  const t = useT();
  return (
    <span className="theme-swatches" aria-label={t(mode === "light" ? "botThemes.light" : "botThemes.dark")}>
      <span className="theme-swatches-label" aria-hidden="true">{t(mode === "light" ? "botThemes.light" : "botThemes.dark")}</span>
      {SWATCH.map((k) => <i key={k} style={{ background: colors[k] ?? (k === "--accent" ? colors["--ink"] : undefined) ?? BASE[mode][k] }} />)}
    </span>
  );
}

export function BotThemes({ initial }: { initial?: BotThemesView }) {
  const t = useT();
  const [view, setView] = useState<BotThemesView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!initial) api<BotThemesView>("GET", "/themes").then((v) => setView(Array.isArray(v?.themes) ? v : { themes: [], applied: null, tokens: [], max: 30 }), (e: unknown) => setError(errText(e))); }, [initial]);
  const act = async (method: string, path: string) => {
    setError(null);
    try { const v = await api<BotThemesView>(method, path); setView(v); applyCustomTheme(v.applied); } catch (e) { setError(errText(e)); }
  };
  if (!view) return <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>;
  const row = (th: BotThemeView) => {
    const worst = Math.min(th.check.light.ratio, th.check.dark.ratio);
    return (
      <li key={th.id} className="list-row is-card bot-theme-row">
        <div className="list-row-text">
          <span className="list-row-title">
            {th.name}
            {th.applied && <span className="chip state-working">{t("botThemes.applied")}</span>}
          </span>
          <span className="list-row-sub">{t("botThemes.by", { bot: th.botName })}{th.note ? ` · ${th.note}` : ""}</span>
          <span className="bot-theme-swatches"><Swatches colors={th.light} mode="light" /><Swatches colors={th.dark} mode="dark" /></span>
          <span className={`small ${th.check.ok ? "muted" : "bot-theme-bad"}`}>{th.check.ok ? t("botThemes.contrastOk", { ratio: worst.toFixed(1) }) : t("botThemes.contrastBad")}</span>
        </div>
        <div className="bot-theme-actions">
          {!th.applied && <button type="button" className="btn btn-small" disabled={!th.check.ok} onClick={() => void act("POST", `/themes/${enc(th.id)}/apply`)}>{t("botThemes.apply")}</button>}
          <ConfirmButton className="btn btn-small" label={t("botThemes.remove")} confirmLabel={t("botThemes.removeConfirm")} onConfirm={() => act("DELETE", `/themes/${enc(th.id)}`)} />
        </div>
      </li>
    );
  };
  return (
    <div className="bot-themes">
      <h3 className="pane-heading">{t("botThemes.title")}</h3>
      <p className="muted small">{t("botThemes.intro")}</p>
      {view.themes.length === 0 ? <p className="muted small">{t("botThemes.empty")}</p> : <ul className="list">{view.themes.map(row)}</ul>}
      {view.applied && (
        <div className="row-gap">
          <button type="button" className="btn btn-small" onClick={() => void act("POST", "/themes/reset")}>{t("botThemes.reset")}</button>
        </div>
      )}
      {view.themes.length > 0 && <p className="muted small">{t(themeRescue() ? "botThemes.rescueOn" : "botThemes.rescue")}</p>}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </div>
  );
}
