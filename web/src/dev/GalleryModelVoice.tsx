/**
 * The gallery's L150 / L154 states (inside « écran et appels », section=ecran): the wake word (on-device recognition
 * available, to download, not possible), the reminder calls (not set up, set up), the OpenRouter credit alert (amount
 * known, not told), a project's model preset and a bot's voice note in the chat. Development only, fake data.
 */
import { AudioAttachment } from "../components/AudioAttachment";
import { CreditAlertField } from "../components/CreditAlertField";
import { ProjectModelPresetField } from "../components/ProjectModelPreset";
import { ReminderCallSetting, WakeWordSetting } from "../components/VoicePlus";
import type { FixtureOptions } from "./fixtures";

const SID = "AC" + "0".repeat(32);
const MODELS = [
  { ref: "up-or:deepseek/deepseek-v4.1-flash", provider: "OpenRouter", model: "deepseek/deepseek-v4.1-flash", kind: "api" as const },
  { ref: "up-or:anthropic/claude-sonnet-5.5", provider: "OpenRouter", model: "anthropic/claude-sonnet-5.5", kind: "api" as const },
];

export function GalleryModelVoice({ o }: { o: FixtureOptions }) {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const none = { configured: false, enabled: false, accountSid: "", username: "", from: "", to: "", hasSecret: false, callsToday: 0 };
  const set = { configured: true, enabled: true, accountSid: SID, username: SID, from: "+33100000000", to: o.long ? "+447700900123" : "+33612345678", hasSecret: true, callsToday: 2 };
  const wav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  return (
    <div className="gallery-page is-auto gallery-modelvoice" aria-label={L("Voix et modèles (L150, L154)", "Voice and models (L150, L154)")}>
      <WakeWordSetting initialStatus="available" />
      <WakeWordSetting initialStatus="downloadable" />
      <WakeWordSetting initialStatus="unavailable" />
      <ReminderCallSetting initial={none} />
      <ReminderCallSetting initial={set} />
      <CreditAlertField initial={{ thresholdUsd: 2, lastLeftUsd: 1.37, checkedAt: Date.now(), hasOpenRouter: true }} />
      <CreditAlertField initial={{ thresholdUsd: 0, lastLeftUsd: null, checkedAt: Date.now(), hasOpenRouter: true }} />
      <ProjectModelPresetField sectionId="sec_gallery" initial={{ preset: { model: MODELS[0].ref, effort: "high" }, models: MODELS }} />
      <div className="attachments"><AudioAttachment file={{ path: "audio/note.wav", name: o.long ? "note-vocale-202611251030-rappel-du-devis-pour-la-boulangerie.wav" : "note-vocale-202611251030.wav", mime: "audio/wav", size: 48_000 } as never} src={wav} download={wav} /></div>
    </div>
  );
}
