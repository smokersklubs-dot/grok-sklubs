/**
 * « Webhooks et signalements » in the dev gallery (section=confiance): a webhook routine's protection (L20) unsigned
 * with its refused calls, then signed with a just-created secret shown once and grouping on; the reported replies on the
 * Surveillance page (L31); with `view=report`, the « Signaler cette réponse » window open on a reply.
 */
import { HookSecurity } from "../components/HookSecurity";
import { ReportDialog } from "../components/ReportMessage";
import { ReportsSection } from "../components/ReportsSection";
import { GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { hookSignedFixture, hookUnsignedFixture, reportsFixture } from "./trustFixtures";

export function GalleryTrust({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const view = new URLSearchParams(location.search).get("view");
  const fr = o.lang === "fr";
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Webhooks">
        <h2>{fr ? "Webhook non signé (ancien) puis signé" : "Unsigned (old) then signed webhook"}</h2>
        <div className="gallery-page is-auto">
          <div className="hook"><code className="truncate">https://sklubot.example/api/hooks/gallery_token_0000000000000000</code></div>
          <HookSecurity routineId="rtn_gallery_unsigned" initial={hookUnsignedFixture(o)} />
          <HookSecurity routineId="rtn_gallery_signed" initial={hookSignedFixture(o)} />
        </div>
      </section>
      <section className="gallery-section" aria-label="Signalements">
        <h2>{fr ? "Réponses signalées (Surveillance)" : "Reported replies (Surveillance)"}</h2>
        <div className="gallery-page is-auto"><ReportsSection key={`${o.lang}:${o.long}:${empty}`} initial={reportsFixture(o, empty)} /></div>
      </section>
      {view === "report" && (
        <ReportDialog
          row={{ botId: GALLERY_BOT_ID, generation: 1, seq: 12, rev: 1, createdAt: NOW, body: { kind: "message", role: "assistant", text: fr ? "Une réponse du bot." : "A reply of the bot." } }}
          onClose={() => undefined}
        />
      )}
    </main>
  );
}
