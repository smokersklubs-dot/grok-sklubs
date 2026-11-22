/**
 * « Canaux » (L162) in the dev gallery (section=canaux): a bot's settings tab with Slack linked, Discord waiting for the
 * link code, a mailbox read over IMAP with one held sender, two access requests, two allowed people and one blocked,
 * and four group chats (one waiting, two on, one refused).
 * « Vide »: nothing connected yet. « Long »: long names. Buttons answer with the same view (fakeApi.ts).
 */
import { BotChannelsTab } from "../components/BotChannels";
import type { BotChannels } from "../types";
import { fakeBot, NOW, type FixtureOptions } from "./fixtures";

const MIN = 60_000;

export function channelsFixture(o: FixtureOptions, empty: boolean): BotChannels {
  const fr = o.lang === "fr";
  if (empty) {
    return {
      slack: { connected: false, team: null, botUser: null, linked: false, linkCode: null, online: false, error: null },
      discord: { connected: false, botUser: null, linked: false, linkCode: null, online: false, error: null, inviteUrl: null },
      imap: { connected: false, host: null, port: null, username: null, mailbox: null, allowedSenders: [], autoReply: false, everyMinutes: 5, lastCheckAt: null, error: null, held: [] },
      contacts: [],
      groups: [],
    };
  }
  const long = (s: string) => (o.long ? `${s} — ${fr ? "responsable des achats et de la logistique, site de Villeurbanne" : "head of purchasing and logistics, Villeurbanne site"}` : s);
  return {
    slack: { connected: true, team: "Atelier Sklubs", botUser: "juno", linked: true, linkCode: null, online: true, error: null },
    discord: { connected: true, botUser: "Juno#4821", linked: false, linkCode: "K7PX3MQA", online: true, error: null, inviteUrl: "https://discord.com/oauth2/authorize?client_id=800000000000000001&scope=bot" },
    imap: {
      connected: true, host: "imap.exemple.fr", port: 993, username: "contact@atelier.example", mailbox: "INBOX", allowedSenders: ["camille@atelier.example", "@partenaire.example"], autoReply: true, everyMinutes: 5,
      lastCheckAt: NOW - 3 * MIN, error: null, held: [{ from: long("Nadia Benali <nadia@fournisseur.example>"), subject: fr ? "Devis pour la commande de mars" : "Quote for the March order", at: NOW - 40 * MIN }],
    },
    contacts: [
      { id: "ctc_1", channel: "slack", externalId: "U02ABCDEF", name: long("Camille Martin"), status: "pending", code: "H4TQ9ZRM", expiresAt: NOW + 52 * MIN, createdAt: NOW - 8 * MIN, lastSeenAt: NOW - 8 * MIN },
      { id: "ctc_2", channel: "telegram", externalId: "551234567", name: "Léo Durand", status: "pending", code: "W8NC2KPE", expiresAt: NOW + 21 * MIN, createdAt: NOW - 39 * MIN, lastSeenAt: NOW - 39 * MIN },
      { id: "ctc_3", channel: "discord", externalId: "200000000000000002", name: long("Léa Morel"), status: "allowed", code: null, expiresAt: null, createdAt: NOW - 3 * 86_400_000, lastSeenAt: NOW - 2 * 3_600_000 },
      { id: "ctc_4", channel: "slack", externalId: "U03GHIJKL", name: "Sam Petit", status: "allowed", code: null, expiresAt: null, createdAt: NOW - 86_400_000, lastSeenAt: null },
      { id: "ctc_5", channel: "telegram", externalId: "559999999", name: fr ? "Inconnu (publicité)" : "Unknown (advert)", status: "blocked", code: null, expiresAt: null, createdAt: NOW - 5 * 86_400_000, lastSeenAt: NOW - 5 * 86_400_000 },
    ],
    groups: [
      { id: "grp_1", channel: "discord", chatId: "600000000000000001", name: long("#atelier-commandes"), status: "pending", trigger: "mention", who: "approved", createdAt: NOW - 12 * MIN, lastSeenAt: NOW - 12 * MIN },
      { id: "grp_2", channel: "slack", chatId: "C0GENERAL1", name: "#general", status: "allowed", trigger: "mention", who: "approved", createdAt: NOW - 2 * 86_400_000, lastSeenAt: NOW - 30 * MIN },
      { id: "grp_3", channel: "telegram", chatId: "-1001234567", name: fr ? "Famille Martin" : "Martin family", status: "allowed", trigger: "all", who: "everyone", createdAt: NOW - 6 * 86_400_000, lastSeenAt: NOW - 3 * MIN },
      { id: "grp_4", channel: "discord", chatId: "600000000000000099", name: "#pub-et-spam", status: "blocked", trigger: "mention", who: "approved", createdAt: NOW - 9 * 86_400_000, lastSeenAt: null },
    ],
  };
}

export function GalleryChannels({ o }: { o: FixtureOptions }) {
  const fr = o.lang === "fr";
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Canaux">
        <h2>{fr ? "Réglages du bot → Canaux" : "Bot settings → Channels"}</h2>
        <div className="gallery-page is-auto"><BotChannelsTab bot={fakeBot(o)} /></div>
      </section>
    </main>
  );
}
