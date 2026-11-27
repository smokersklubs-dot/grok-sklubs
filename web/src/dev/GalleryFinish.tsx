/**
 * Gallery « finitions » (section=finitions): L161 second half on the real components, from fixtures.
 *   Réglages → Général: « Thèmes proposés par tes bots » (one applied, one proposal, one that no longer passes)
 *   Aujourd'hui: « Récap de toute l'équipe » (a bot left aside first, one with work waiting, one quiet)
 *   Réglages → Ordinateurs: the queue line of a shared computer
 *   view=applied  the same page with the applied theme laid over the app (lib/customtheme.ts)
 *   empty=1    no theme proposed, nothing to sum up
 */
import { useEffect } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import type { Bot, BotThemeView, BotThemesView, GlobalRecap } from "../types";
import { BotThemes } from "../components/BotThemes";
import { GlobalRecapBlock } from "../components/GlobalRecap";
import { applyCustomTheme } from "../lib/customtheme";
import { NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";

const DAY = 86_400_000;
const fr = (o: FixtureOptions) => o.lang === "fr";

function themes(o: FixtureOptions, empty: boolean): BotThemesView {
  const worst = (ratio: number) => ({ fg: "--text-3", bg: "--surface-2", ratio, min: 4.5 });
  const base = { botId: "bot_fin_lea", botName: o.long ? "Léa, décoratrice de l'interface et des couleurs" : "Léa", createdAt: NOW - DAY, appliedAt: null, note: "", applied: false };
  const list: BotThemeView[] = empty ? [] : [
    { ...base, id: "thm_sable", name: fr(o) ? "Sable" : "Sand", note: fr(o) ? (o.long ? "Tons chauds et doux pour les longues journées, avec un accent brun profond lisible partout" : "Tons chauds") : "Warm tones", applied: true, appliedAt: NOW - 3600_000,
      light: { "--bg": "#f6efe3", "--surface": "#fffaf2", "--accent": "#7a3d12", "--accent-fg": "#ffffff" }, dark: { "--bg": "#17130e", "--surface": "#201a13" }, check: { ok: true, light: worst(4.62), dark: worst(5.1), failures: [] } },
    { ...base, id: "thm_foret", name: fr(o) ? "Forêt" : "Forest", light: { "--bg": "#eef3ee", "--accent": "#1f5137", "--accent-fg": "#ffffff" }, dark: { "--bg": "#0f1511", "--accent": "#9fd5b4", "--accent-fg": "#0f1511" }, check: { ok: true, light: worst(4.55), dark: worst(5.3), failures: [] } },
    { ...base, id: "thm_brume", name: fr(o) ? "Brume (ancien)" : "Mist (old)", light: { "--text-2": "#9a9a9a" }, dark: {}, check: { ok: false, light: worst(2.7), dark: worst(5.3), failures: ["light: --text-2 on --surface is 2.70:1, needs 4.5:1"] } },
  ];
  return { themes: list, applied: list.find((x) => x.applied) ?? null, tokens: [], max: 30 };
}

function recap(o: FixtureOptions, empty: boolean): GlobalRecap {
  const b = (id: string, botName: string, rest: Partial<GlobalRecap["bots"][number]>) => ({ botId: id, botName, shared: false, finished: 0, minutes: 0, kinds: {}, highlights: [], lastActiveAt: NOW - 2 * 3600_000, openGoals: [], waiting: 0, dormant: false, ...rest });
  const bots = empty ? [] : [
    b("bot_fin_max", o.long ? "Max, comptable et gardien des factures fournisseurs" : "Max", { dormant: true, lastActiveAt: NOW - 21 * DAY, openGoals: [fr(o) ? (o.long ? "Clôturer les comptes 2025 avec toutes les pièces justificatives rangées par mois" : "Clôturer les comptes 2025") : "Close the 2025 accounts"] }),
    b("bot_fin_lea", "Léa", { finished: 6, minutes: 140, waiting: 2, highlights: [fr(o) ? "Newsletter de novembre envoyée" : "November newsletter sent"], openGoals: [fr(o) ? "Préparer le salon de mars" : "Prepare the March fair"] }),
    b("bot_fin_jiren", "jiren", { finished: 3, minutes: 45, highlights: [fr(o) ? "Rapport SEO de la semaine" : "Weekly SEO report"] }),
    b("bot_fin_hugo", "Hugo", { shared: true, finished: 1, highlights: [fr(o) ? "Devis Martin relu" : "Martin quote reviewed"] }),
  ];
  const totals = { finished: bots.reduce((a, x) => a + x.finished, 0), minutes: 185, waiting: 2, bots: empty ? 0 : 4, dormant: empty ? 0 : 1 };
  return { days: 7, start: NOW - 7 * DAY, end: NOW, generatedAt: NOW, totals, bots, text: "Récapitulatif de tes bots, 7 derniers jours — 10 choses finies" };
}

export function GalleryFinish({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const t = useT();
  useEffect(() => {
    const main = chatBot(o);
    const mk = (id: string, name: string, color: string) => ({ ...main, id, name, primary: false, color } as unknown as Bot);
    useStore.setState({ bots: { [main.id]: main, bot_fin_lea: mk("bot_fin_lea", "Léa", "rose"), bot_fin_max: mk("bot_fin_max", "Max", "moss"), bot_fin_jiren: { ...main, id: "bot_fin_jiren" } as Bot } } as never);
  }, [o]);
  const applied = new URLSearchParams(location.search).get("view") === "applied";
  useEffect(() => { applyCustomTheme(applied && !empty ? themes(o, false).applied : null); return () => applyCustomTheme(null); }, [applied, empty, o]);
  return (
    <div className="gallery-finish" style={{ display: "grid", gap: 24, padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <section className="settings-pane"><BotThemes initial={themes(o, empty)} /></section>
      <div className="today-view"><div className="today-grid"><GlobalRecapBlock initial={recap(o, empty)} /></div></div>
      <section className="settings-pane shared-computers">
        <h3 className="pane-heading">{t("shared.heading")}</h3>
        <p className="muted small" role="status">{t("shared.queue", { names: o.long ? "Léa, décoratrice de l'interface et des couleurs, Max" : "Léa, Max" })}</p>
      </section>
    </div>
  );
}
