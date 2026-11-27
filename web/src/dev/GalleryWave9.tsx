/**
 * The gallery's wave-9 sections (development only), with fake data:
 *  - section=acces (L159): an app « pour tous mes bots » with one bot unticked, the verified sites (connected, to check,
 *    sign in again), the « Coordonnées » cards of the vault.
 *  - section=plus (L184): a poll (open, with votes and reasons; closed), the pinned dashboard, a link preview under a
 *    message, the apps' notices of a bot, the metrics panel.
 * `empty` shows each panel with nothing in it (most hide themselves then).
 */
import { useEffect } from "react";
import { useStore } from "../store";
import type { Bot, PollCard, ViewCard } from "../types";
import { ConnectedSites, ConnectorBots, ContactCards } from "../components/AccessPanels";
import { AppEventsSection, LinkPreview, PinnedDashboard, PollCardView, UsageMetricsPanel } from "../components/ChatPlus";
import { NOW, type FixtureOptions } from "./fixtures";

const member = (id: string, name: string, color: string, shape: string): Bot =>
  ({ id, kind: "agent", name, label: "", description: "", instructions: "", shape, color, pause: null, access: null, memberIds: [], disabledTools: [] } as unknown as Bot);
const TEAM = [member("bot_lea", "Léa", "moss", "pebble"), member("bot_marc", "Marc", "ember", "bean"), member("bot_zoe", "Zoé", "sky", "cloud")];

function useTeam() {
  useEffect(() => {
    const before = useStore.getState().bots;
    const user = useStore.getState().user;
    useStore.setState({ bots: { ...before, ...Object.fromEntries(TEAM.map((b) => [b.id, b])) }, user: user ?? ({ id: "u_gallery", name: "Camille", email: "camille@example.com" } as never) });
    return () => useStore.setState({ bots: before });
  }, []);
}

export function GalleryAccess({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  useTeam();
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const long = o.long ? L(" — boutique-en-ligne-avec-un-nom-tres-long", "-online-shop-with-a-very-long-name") : "";
  return (
    <div className="gallery-page is-auto">
      <ul className="connector-list">
        <li className="connector">
          <div className="connector-main"><span className="logo-tile" aria-hidden="true">N</span><div className="list-row-text"><span className="list-row-title">Notion <span className="chip state-ready">{L("Connectée", "Connected")}</span></span></div></div>
          <ConnectorBots connectorId="con_g" name="Notion" start={empty ? { allBots: true, bots: {}, allowed: TEAM.map((b) => b.id) } : { allBots: true, bots: { bot_zoe: false }, allowed: ["bot_lea", "bot_marc"] }} />
        </li>
      </ul>
      {!empty && <ConnectedSites start={[
        { botId: "bot_lea", botName: "Léa", host: `compta.example${long}`, item: "Compta", status: "connected", typedAt: NOW - 3_600_000, verifiedAt: NOW - 3_500_000, updatedAt: NOW - 3_500_000 },
        { botId: "bot_marc", botName: "Marc", host: "linkedin.com", item: "LinkedIn Marc", status: "checking", typedAt: NOW - 60_000, verifiedAt: null, updatedAt: NOW - 60_000 },
        { botId: "bot_zoe", botName: "Zoé", host: "support.example", item: "Support", status: "reconnect", typedAt: NOW - 86_400_000, verifiedAt: NOW - 80_000_000, updatedAt: NOW - 600_000 },
      ]} />}
      <ContactCards start={empty ? [] : [
        { id: "ctc_1", label: L("Maison", "Home"), fields: { fullName: "Camille Martin", company: "", address1: "3 rue des Lilas", address2: "", postalCode: "69001", city: `Lyon${long}`, country: "France", phone: "+33 6 00 00 00 00", email: "camille@example.com" }, bots: [] },
        { id: "ctc_2", label: L("Bureau", "Office"), fields: { fullName: "", company: "Atelier Martin", address1: "1 quai Rambaud", address2: "", postalCode: "69002", city: "Lyon", country: "France", phone: "", email: "" }, bots: ["bot_lea"] },
      ]} />
    </div>
  );
}

const view = (o: FixtureOptions, n: number): ViewCard => ({
  type: "view", title: o.lang === "fr" ? "Ventes de la semaine" : "Sales this week", status: "shown", fallback: "",
  blocks: [{ kind: "stats", items: [{ label: o.lang === "fr" ? "Total" : "Total", value: `${n} €` }, { label: o.lang === "fr" ? "Commandes" : "Orders", value: "38" }] }, { kind: "chart", chart: "bar", labels: ["L", "M", "M", "J", "V"], series: [{ name: "€", values: [120, 340, 210, 410, 380] }] }],
});

export function GalleryPlus({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  useTeam();
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const me = useStore((s) => s.user?.id ?? "u_gallery");
  const q = o.long ? L("Où déjeune-t-on vendredi avec toute l'équipe, sachant que deux personnes ne mangent pas de viande et qu'on a une heure ?", "Where do we have lunch on Friday with the whole team, knowing two people eat no meat and we have one hour?") : L("Où déjeuner vendredi ?", "Where to have lunch on Friday?");
  const poll: PollCard = { type: "poll", pollId: "poll_g", question: q, options: [L("Pizzeria du coin", "Corner pizzeria"), "Sushi", L("Salades", "Salads")], multi: false, status: "open", createdBy: `user:${me}`,
    votes: empty ? [] : [{ by: `user:${me}`, name: "Camille", choices: [0] }, { by: "bot:bot_lea", name: "Léa", choices: [0], reason: L("Rapide, et des options sans viande.", "Quick, with meat-free options.") }, { by: "bot:bot_marc", name: "Marc", choices: [2], reason: L("Léger avant la réunion.", "Light before the meeting.") }] };
  return (
    <div className="gallery-page is-auto">
      <div className="gallery-cards">
        <figure className="gallery-figure"><figcaption><code>poll · open</code></figcaption><PollCardView card={poll} /></figure>
        <figure className="gallery-figure"><figcaption><code>poll · closed</code></figcaption><PollCardView card={{ ...poll, pollId: "poll_g2", multi: true, status: "closed" }} /></figure>
      </div>
      {!empty && <PinnedDashboard start={[{ id: "pin_1", botId: "bot_lea", botName: "Léa", title: view(o, 1460).title, seq: 4, updatedAt: NOW - 7_200_000, card: view(o, 1460) }, { id: "pin_2", botId: "bot_marc", botName: "Marc", title: "Newsletter", seq: 9, updatedAt: NOW - 86_400_000, card: { type: "view", title: "Newsletter", status: "shown", fallback: "", blocks: [{ kind: "progress", label: L("Ouvertures", "Opens"), value: 412, max: 1000 }] } }]} />}
      <div className="msg"><div className="md"><p>{L("Regarde ce modèle : https://velo.example/modele-3", "Look at this model: https://velo.example/modele-3")}</p></div>
        {!empty && <LinkPreview text="" start={{ url: "https://velo.example/modele-3", host: "velo.example", siteName: "Vélos Martin", title: o.long ? L("Vélo électrique Modèle 3 — autonomie 120 km, cadre bas, garantie 5 ans, livraison offerte partout en France", "Electric bike Model 3 — 120 km range, step-through frame, 5-year warranty, free delivery") : L("Vélo électrique Modèle 3", "Electric bike Model 3"), description: L("Autonomie 120 km, cadre bas, garantie 5 ans.", "120 km range, step-through frame, 5-year warranty.") }} />}
      </div>
      {!empty && <AppEventsSection bot={TEAM[0]} start={[
        { id: 3, connectorId: "con_g", name: "Notion", kind: "resource", level: "", text: "notion://page/factures-novembre", at: NOW - 300_000 },
        { id: 2, connectorId: "con_g", name: "Notion", kind: "tools", level: "", text: "tools changed", at: NOW - 3_600_000 },
        { id: 1, connectorId: "con_h", name: "Agenda", kind: "log", level: "warning", text: L("sync : quota bientôt atteint", "sync: quota almost reached"), at: NOW - 7_200_000 },
      ]} />}
      <UsageMetricsPanel start={{ bots: empty ? 0 : 4, rooms: empty ? 0 : 1, connectors: empty ? 0 : 3, messages: { user: empty ? 0 : 812, assistant: empty ? 0 : 1290 }, messages24h: empty ? 0 : 46, tokens: { input: empty ? 0 : 4_210_000, output: empty ? 0 : 380_000, cached: 0 }, costUsd: empty ? 0 : 18.4, costUsd30d: empty ? 0 : 6.2, tokens24h: empty ? 0 : 120_000, approvalsPending: empty ? 0 : 2, routineRuns: { ok: empty ? 0 : 61, failed: empty ? 0 : 3, other: 0 } }} />
    </div>
  );
}
