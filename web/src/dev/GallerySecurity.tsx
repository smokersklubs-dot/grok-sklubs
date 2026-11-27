/**
 * « Sécurité » (Lot 1) in the dev gallery (section=securite): the switches of Settings → Permissions → Sécurité (code
 * before sensitive approvals, new-site alert, the bots' browser behind), a bot's « Sécurité » tab (network journal,
 * hosts it may test), its allowed e-mail recipients, a vault item's rules and history, and an approval card that asks
 * for the two-factor code. « Vide »: nothing yet, options off.
 */
import { BotRecipientsBlock, BotSecurityTab, SecuritySettingsBlock, VaultAccessBlock } from "../components/SecurityLot1";
import { CardView } from "../components/Cards";
import { fakeBot, GALLERY_BOT_ID, type FixtureOptions } from "./fixtures";
import { BotEgressBlock } from "../components/BotEgress";
import { egressFixture } from "./fakeApi";

export function GallerySecurity({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const fr = o.lang === "fr";
  const bot = fakeBot(o);
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Sécurité">
        <h2>{fr ? "Réglages → Autorisations → Sécurité" : "Settings → Permissions → Security"}</h2>
        <div className="gallery-page is-auto"><SecuritySettingsBlock /></div>
      </section>
      <section className="gallery-section" aria-label="Bot">
        <h2>{fr ? "Réglages du bot → Sécurité, et ses destinataires" : "Bot settings → Security, and its recipients"}</h2>
        <div className="gallery-page is-auto"><BotSecurityTab bot={bot} /><BotRecipientsBlock bot={bot} /></div>
      </section>
      <section className="gallery-section" aria-label="Sortie">
        <h2>{fr ? "Sortie Internet : par la maison (Relais)" : "Internet exit: through home (Relais)"}</h2>
        <div className="gallery-page is-auto"><BotEgressBlock bot={bot} initial={{ ...egressFixture(empty, empty ? "direct" : "relay"), devices: [...egressFixture(empty).devices] }} /></div>
      </section>
      <section className="gallery-section" aria-label="Coffre">
        <h2>{fr ? "Coffre : un élément en modification" : "Vault: an item being edited"}</h2>
        <div className="gallery-page is-auto"><VaultAccessBlock item={{ id: "vlt_gallery", kind: "secret", name: "Stripe", site: "", username: "", hasPassword: true, note: "", createdAt: 0, hosts: ["api.stripe.com"], header: "Authorization", prefix: "Bearer ", checkUrl: "", digits: 6, period: 30, card: null }} /></div>
      </section>
      <section className="gallery-section" aria-label="Carte">
        <h2>{fr ? "Carte d'accord qui demande le code" : "Approval card asking for the code"}</h2>
        <div className="gallery-cards">
          <CardView botId={GALLERY_BOT_ID} seq={1} card={{ type: "approval", approvalId: "apr_gallery_floor", title: fr ? "Autoriser Juno à payer 49,00 € chez boutique.example avec la carte Visa ••4242 ?" : "Allow Juno to pay €49.00 at boutique.example with the Visa ••4242 card?", detail: "amount: 49.00\ncurrency: EUR", tool: "card_fill", source: fr ? "Coffre" : "Vault", status: "pending", once: true, irreversible: true, irreversibleReason: fr ? "un paiement ne peut pas être annulé d'ici." : "a payment cannot be undone from here." }} />
        </div>
      </section>
    </main>
  );
}
