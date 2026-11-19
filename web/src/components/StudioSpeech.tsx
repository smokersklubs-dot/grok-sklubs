import { useEffect, useId, useRef, useState } from "react";
import { api, apiUpload, errText } from "../api";
import { mediaUrl, type Scene, type SpeechTake } from "../lib/studioStory";
import type { Attachment, PiperVoiceInfo } from "../types";
import { StudioLibraryAudio } from "./StudioLibraryAudio";
import { ErrorNote } from "./ui";

export function StudioSpeech({
  bot,
  scene,
  cast,
  fr,
  onChange,
}: {
  bot: string;
  scene: Scene;
  cast: SpeechTake[];
  fr: boolean;
  onChange: (take?: SpeechTake) => void;
}) {
  const [speaker, setSpeaker] = useState(scene.speech?.speaker ?? "");
  const [text, setText] = useState(scene.speech?.text ?? scene.text);
  const [voice, setVoice] = useState(scene.speech?.voice ?? "");
  const [voices, setVoices] = useState<PiperVoiceInfo[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const list = useId(),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    api<{ available: boolean; voices: PiperVoiceInfo[] }>("GET", "/voice/piper/voices", undefined, abort.signal)
      .then((r) => {
        if (r.available && !abort.signal.aborted) setVoices(r.voices);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errText(e));
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, []);
  const selected = voice || voices.find((v) => v.language === (fr ? "fr" : "en"))?.id || voices[0]?.id || "";
  const name = speaker.trim() || (fr ? "Narrateur" : "Narrator");
  const attach = (path: string, id: string) => onChange({ speaker: name, text, voice: id, path });
  async function record(file?: File) {
    setError("");
    setBusy(true);
    try {
      const path = file
        ? (await apiUpload<{ attachment: Attachment }>("/bots/" + bot + "/uploads", file)).attachment.path
        : (
            await api<{ path: string }>("POST", "/bots/" + bot + "/voice/studio-take", {
              voice: selected,
              text,
            })
          ).path;
      if (alive.current) attach(path, file ? "" : selected);
    } catch (e) {
      if (alive.current) setError(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="studio-speech">
      <summary>{fr ? "Réplique de ce plan" : "Shot dialogue"}</summary>
      <fieldset disabled={busy} className="studio-controls">
        <label>
          {fr ? "Intervenant" : "Speaker"}
          <input
            className="input"
            maxLength={64}
            list={list}
            value={speaker}
            placeholder={fr ? "Narrateur" : "Narrator"}
            onChange={(e) => {
              const value = e.target.value;
              setSpeaker(value);
              const known = cast.find((s) => s.speaker === value);
              if (known?.voice) setVoice(known.voice);
            }}
          />
        </label>
        <datalist id={list}>
          {Array.from(new Set(cast.map((s) => s.speaker))).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <label>
          {fr ? "Texte de la réplique" : "Dialogue text"}
          <textarea className="input" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {voices.length > 0 && (
          <label>
            {fr ? "Voix de synthèse" : "Speech voice"}
            <select className="input" value={selected} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.language}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="studio-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={!selected || !text.trim()}
            onClick={() => void record()}
          >
            {busy
              ? fr
                ? "En cours…"
                : "Working…"
              : scene.speech
                ? fr
                  ? "Refaire cette réplique"
                  : "Regenerate line"
                : fr
                  ? "Générer cette réplique"
                  : "Generate line"}
          </button>
          {scene.speech && (
            <button type="button" className="btn btn-small" onClick={() => onChange(undefined)}>
              {fr ? "Retirer la prise" : "Remove take"}
            </button>
          )}
        </div>
        <label>
          {fr ? "Importer une prise" : "Import a take"}
          <input
            type="file"
            accept=".wav,.mp3,.m4a,.aac,.ogg,.flac,.opus"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void record(f);
            }}
          />
        </label>
        <StudioLibraryAudio
          bot={bot}
          fr={fr}
          value={scene.speech?.path ?? ""}
          onPick={(path) => attach(path, "")}
        />
        {scene.speech && (
          <audio
            aria-label={scene.speech.speaker}
            controls
            preload="none"
            src={mediaUrl(bot, scene.speech.path)}
          />
        )}
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
    </details>
  );
}
