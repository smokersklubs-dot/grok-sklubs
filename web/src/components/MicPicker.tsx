import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { listMics, preferredMic, type Mic } from "../lib/micchoice";
import { changeCallMic } from "../lib/voice";
import "./MicPicker.css";

/** L154 « choix du micro »: shown in the call bar when the browser offers more than one microphone. */
export function MicPicker() {
  const t = useT();
  const [mics, setMics] = useState<Mic[]>([]);
  const [chosen, setChosen] = useState(preferredMic());
  useEffect(() => {
    const read = () => void listMics().then(setMics);
    read();
    navigator.mediaDevices?.addEventListener?.("devicechange", read);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", read);
  }, []);
  if (mics.length < 2) return null;
  return (
    <select className="input input-small call-mic" aria-label={t("call.micPick")} title={t("call.micPick")} value={mics.some((m) => m.id === chosen) ? chosen : ""}
      onChange={(e) => { setChosen(e.target.value); void changeCallMic(e.target.value); }}>
      <option value="">{t("call.micDefault")}</option>
      {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  );
}
