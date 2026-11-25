/**
 * The gallery's « écran et appels » section (section=ecran): L149 states of the large screen view — the bot using its
 * screen, a dropped stream retrying, given up with « Reconnecter », the tools while driving — and L167 « Modèle vocal temps
 * réel » (off, on without a key, on and ready); L149 « où le bot a cliqué » (two marks, drawn still); L83 the signature of a
 * mail account (open, filled or empty). Development only, fake data.
 */
import { LiveWait, ViewerTools } from "../components/ComputerViewer";
import { RealtimeVoice } from "../components/RealtimeVoice";
import { ClickMarks } from "../components/ClickTrail";
import { MailSignature } from "../components/MailSignature";
import { GalleryModelVoice } from "./GalleryModelVoice"; // L150, L154
import "../components/ComputerViewer.css";
import type { FixtureOptions } from "./fixtures";

const MODELS = ["gpt-realtime-2.1-mini", "gpt-realtime-2.1", "gpt-realtime-mini", "gpt-realtime"];
const VOICES = ["marin", "cedar", "alloy"];

function Stage({ children, foot }: { children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="gallery-viewer">
      <div className="viewer-stage"><div className="gallery-viewer-screen">{children}</div></div>
      {foot && <footer className="viewer-foot">{foot}</footer>}
    </div>
  );
}

export function GalleryScreen({ o }: { o: FixtureOptions }) {
  const name = o.long ? "Léa › Comptabilité et relances clients" : "Léa";
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  return (
    <section className="gallery-section" id="g-ecran" aria-labelledby="g-ecran-h">
      <h2 id="g-ecran-h" className="gallery-h">{L("Écran du bot et appels", "Bot screen and calls")}</h2>
      <div className="gallery-screens">
        <Stage foot={<ViewerTools control={false} note={null} onPaste={() => undefined} onCtrlAltDel={() => undefined} onCapture={() => undefined} />}>
          <div className="viewer-bot-driving" role="status"><span className="dot-inline dot-pulse" /> {L(`${name} utilise son écran en ce moment`, `${name} is using its screen right now`)}</div>
        </Stage>
        <Stage foot={<ViewerTools control note={L("Collé.", "Pasted.")} onPaste={() => undefined} onCtrlAltDel={() => undefined} onCapture={() => undefined} />}>
          <LiveWait name={name} waiting={{ attempt: 2, dueAt: Date.now() + 2000 }} gaveUp={false} onRetry={() => undefined} />
        </Stage>
        <Stage><LiveWait name={name} waiting={null} gaveUp onRetry={() => undefined} /></Stage>
        <Stage>
          <div className="gallery-fake-desktop" aria-label={L("Écran du bot (exemple)", "Bot screen (example)")}><span>{L("Payer 10 €", "Pay €10")}</span></div>
          <ClickMarks still marks={[{ key: 1, left: "38%", top: "46%" }, { key: 2, left: "70%", top: "30%" }]} />
        </Stage>
      </div>
      <div className="gallery-page is-auto gallery-realtime">
        <RealtimeVoice initial={{ realtime: { enabled: false, model: MODELS[0], voice: "marin", available: false, reason: "off" }, models: MODELS, voices: VOICES }} />
        <RealtimeVoice initial={{ realtime: { enabled: true, model: MODELS[0], voice: "marin", available: false, reason: "no key" }, models: MODELS, voices: VOICES }} />
        <RealtimeVoice initial={{ realtime: { enabled: true, model: MODELS[1], voice: "cedar", available: true, reason: "" }, models: MODELS, voices: VOICES }} />
      </div>
      <GalleryModelVoice o={o} />
      <div className="gallery-page is-auto"><ul className="list"><li className="connector"><MailSignature accountId="acc_gallery" initial={o.long ? "Léa Martin — Responsable comptabilité et relances clients, Sklubs Distribution Europe\n06 00 00 00 00 · lea.martin@sklubs-distribution-europe.example" : "Léa Martin — Sklubs\n06 00 00 00 00"} /></li></ul></div>
    </section>
  );
}
