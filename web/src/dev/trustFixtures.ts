/**
 * Fake data for the gallery's « Webhooks et signalements » (section=confiance, GalleryTrust.tsx; answered by fakeApi.ts):
 * a webhook's protection (L20, HookSecurity.tsx) and the reported replies (L31, ReportsSection.tsx). Development only.
 */
import type { HookView } from "../components/HookSecurity";
import type { ReportView } from "../components/ReportsSection";
import { NOW, type FixtureOptions } from "./fixtures";

const MIN = 60_000;

export function hookUnsignedFixture(o: FixtureOptions): HookView {
  return {
    signed: false, secretSetAt: null, previousUntil: null, groupSec: 0, pending: 0,
    refusals: [
      { at: NOW - 4 * MIN, reason: "duplicate", detail: "72d3162e-cc78-11e3-81ab-4c9367dc0958", ip: "140.82.x.x" },
      { at: NOW - 55 * MIN, reason: "rate_limited", detail: "", ip: "203.0.x.x" },
      ...(o.long ? [{ at: NOW - 3 * 60 * MIN, reason: "too_large" as const, detail: "412 330 bytes — ".repeat(4), ip: "2001:db8:…" }] : []),
    ],
  };
}

export function hookSignedFixture(o: FixtureOptions): HookView {
  return {
    signed: true, secretSetAt: NOW - 2 * MIN, previousUntil: NOW + 23 * 60 * MIN, groupSec: 30, pending: 2,
    secret: "whsec_galleryFakeSecretNotARealKey0000000000",
    refusals: [
      { at: NOW - 6 * MIN, reason: "bad_signature", detail: "", ip: "198.51.x.x" },
      { at: NOW - 9 * MIN, reason: "no_signature", detail: "", ip: "198.51.x.x" },
      { at: NOW - 70 * MIN, reason: "stale_timestamp", detail: "", ip: "54.187.x.x" },
    ].slice(0, o.long ? 3 : 2) as HookView["refusals"],
  };
}

export const hookTestFixture = (grouped = 30) => ({
  wouldRun: true, grouped,
  checks: [{ id: "address", ok: true }, { id: "active", ok: true }, { id: "signature", ok: true }, { id: "bot", ok: true }],
});

export function reportsFixture(o: FixtureOptions, empty: boolean): { reports: ReportView[]; open: number } {
  if (empty) return { reports: [], open: 0 };
  const fr = o.lang === "fr";
  const long = o.long ? (fr ? " Le reste de la réponse continue longtemps pour vérifier que le texte passe à la ligne sans déborder de l'écran du téléphone." : " The rest of the reply goes on for a long time to check that the text wraps without leaving the phone's screen.").repeat(3) : "";
  const reports: ReportView[] = [
    {
      id: "rep_1", botName: "Jiren", account: "Camille <[e-mail]>", reason: "wrong", status: "open", createdAt: NOW - 12 * MIN, handledAt: null,
      note: fr ? "Il invente un horaire d'ouverture qui n'existe pas." : "It makes up opening hours that do not exist.",
      text: (fr ? "La boutique https://shop.example.com/… ouvre le dimanche de 8 h à 22 h. Appelle le [téléphone] pour réserver." : "The shop https://shop.example.com/… opens on Sundays from 8 am to 10 pm. Call [phone] to book.") + long,
      context: [
        { who: "user", name: "", text: fr ? "Quels sont les horaires de la boutique ?" : "What are the shop's opening hours?" },
        { who: "bot", name: "Jiren", text: fr ? "Je regarde sur leur site." : "Let me check their site." },
      ],
    },
    {
      id: "rep_2", botName: "Bulma", account: "Sam <[e-mail]>", reason: "private", status: "done", createdAt: NOW - 26 * 60 * MIN, handledAt: NOW - 20 * 60 * MIN,
      note: "", text: fr ? "Voici l'adresse e-mail de ton client : [e-mail]." : "Here is your client's e-mail address: [e-mail].", context: [],
    },
  ];
  return { reports, open: reports.filter((r) => r.status === "open").length };
}
