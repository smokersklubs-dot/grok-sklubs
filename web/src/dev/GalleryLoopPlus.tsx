/**
 * « Boucle et tours » in the dev gallery (section=boucle; wave of 23/11): the waiting notes with « Envoyer maintenant »
 * (L58), a plan card with « Relire mon plan contre ma demande » (L79), a bot's named model modes (L69) and Settings →
 * Team « Qui peut demander à qui » with the helpers' inheritance (L96). `empty=1`: no note, no section, modes with no
 * model to offer.
 */
import { useEffect } from "react";
import { useStore } from "../store";
import { QueuedNotes } from "../components/QueuedNotes";
import { RichQuestion } from "../components/TurnCards";
import { ModelModesField } from "../components/ModelModes";
import { TeamAskPolicy } from "../components/TeamAskPolicy";
import type { Card } from "../types";
type QuestionCard = Extract<Card, { type: "question" }>;
import { fakeBot, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";

export function GalleryLoopPlus({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const fr = o.lang === "fr";
  const L = (a: string, b: string) => (fr ? a : b);
  const bot = fakeBot(o);
  useEffect(() => {
    const sections = empty ? [] : [
      { id: "sec_sales", name: o.long ? L("Ventes, devis et relances des clients professionnels", "Sales, quotes and follow-ups of business customers") : L("Ventes", "Sales"), position: 0, createdAt: NOW, paused: false },
      { id: "sec_support", name: L("Service client", "Support"), position: 1, createdAt: NOW, paused: false },
    ];
    const bots = Object.fromEntries([
      fakeBot(o, { id: "bot_lea", name: "Léa", sectionId: "sec_sales" }),
      fakeBot(o, { id: "bot_max", name: o.long ? L("Maximilien, le chargé des grands comptes", "Maximilian, key accounts") : "Max", sectionId: "sec_sales" }),
      fakeBot(o, { id: "bot_sam", name: "Sam", sectionId: "sec_support" }),
    ].map((b) => [b.id, b]));
    useStore.setState({ sections, bots } as never);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plan: QuestionCard = {
    type: "question", status: "pending", question: L("Refaire le site", "Rebuild the site"), options: [L("Approuver", "Approve"), L("Approuver avec une note", "Approve with a note"), L("Le modifier", "Change it")], recommended: L("Approuver", "Approve"),
    plan: { version: 1, steps: [L("Page d'accueil", "Home page"), L("Page À propos", "About page"), o.long ? L("Page des tarifs avec le tableau comparatif des trois formules et la foire aux questions", "Pricing page with the comparison table of the three plans and the FAQ") : L("Page des tarifs", "Pricing page")] },
  };
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="L58">
        <h2>{L("Messages en attente : Envoyer maintenant", "Waiting messages: Send now")}</h2>
        <div className="gallery-page is-auto"><QueuedNotes botId={GALLERY_BOT_ID} queued={empty ? 0 : 2} /></div>
      </section>
      <section className="gallery-section" aria-label="L79">
        <h2>{L("Plan à approuver : relire contre la demande", "Plan to approve: check against the request")}</h2>
        <div className="gallery-page is-auto"><RichQuestion card={plan} botId={GALLERY_BOT_ID} seq={41} /></div>
      </section>
      <section className="gallery-section" aria-label="L69">
        <h2>{L("Mode du modèle d'un bot", "A bot's model mode")}</h2>
        <div className="gallery-page is-auto app-settings-content settings-pane"><ModelModesField bot={bot} /></div>
      </section>
      <section className="gallery-section" aria-label="L96">
        <h2>{L("Réglages → Équipe : qui peut demander à qui", "Settings → Team: who can ask whom")}</h2>
        <div className="gallery-page is-auto app-settings-content settings-pane"><TeamAskPolicy /></div>
      </section>
    </main>
  );
}
