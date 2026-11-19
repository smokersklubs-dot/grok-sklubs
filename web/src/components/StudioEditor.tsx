import { useEffect, useState } from "react";
import { api, apiUpload, errText } from "../api";
import { duration, locate, shotDuration, styles, validStory, type Scene, type Story } from "../lib/studioStory";
import { techniqueLabels } from "../lib/studioTechniques";
import { studioTechniques } from "../../../server/src/studiotechniques";
import { useStore } from "../store";
import type { Attachment } from "../types";
import { StudioMp4 } from "./StudioMp4";
import { StudioSpeech } from "./StudioSpeech";
import { StudioPlayback } from "./StudioPlayback";
import { StudioClips } from "./StudioClips";
import { MAX_PROJECT_SECONDS, MAX_SHOTS, validClips } from "../../../server/src/studioclips";
import { StudioLibraryAudio } from "./StudioLibraryAudio";
import { StudioSubtitles } from "./StudioSubtitles";
import { ErrorNote, Loading } from "./ui";
import "./VideoStudio.css";

export function StudioEditor({
  bot,
  name,
  preview,
  version,
  editable, mp4, thread,
}: {
  bot: string;
  name: string;
  preview: string;
  version: number;
  editable: boolean; mp4?: boolean; thread?: number;
}) {
  const fr = useStore((s) => s.locale === "fr");
  const [solo,setSolo]=useState("");
  const [story, setStory] = useState<Story | null>(null),
    [time, setTime] = useState(0),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setError("");
    setDirty(false);
    setTime(0);
    setStory(null);
    fetch(preview + "studio.json", { credentials: "same-origin", signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error("Studio " + r.status);
        const s = await r.json();
        if (!validClips(s?.clips) || !validStory(s)) throw Error(fr ? "Projet illisible." : "Invalid project.");
        if (active) setStory(s);
      })
      .catch((e) => {
        if (active) setError(errText(e));
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [preview, version, fr]);
  if (!story) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const model = story,
    total = duration(story),
    baseSeconds = shotDuration(story),
    shot = locate(story, time),
    s = shot.scene;
  const cast=model.scenes.flatMap(c=>c.speech ? [c.speech] : []);
  const speakers=Array.from(new Set(cast.map(c=>c.speaker)));
  const update = (next: Story) => {
    setStory(next);
    setDirty(true);
    setTime((t) => Math.min(duration(next), t));
  };
  const patch = (patch: Partial<Scene>) =>
    update({ ...model, scenes: model.scenes.map((v, i) => (i === shot.index ? { ...v, ...patch } : v)) });
  const seek = (i: number) => setTime(model.scenes.slice(0, i).reduce((n, c) => n + c.seconds, 0));
  const move = (delta: number) => {
    const list = [...model.scenes],
      i = shot.index,
      j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ ...model, scenes: list });
    setTime(list.slice(0, j).reduce((n, c) => n + c.seconds, 0));
  };
  const save = async () => {
    if (!validClips(model.clips) || !validStory(model)) {
      setError(fr ? "Vérifie les durées et les plans." : "Check the shots and timings.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api("POST", "/bots/" + bot + "/video-studio", {
        key: name.slice("artifact-video-".length),
        version,
        story: model,
      });
      setDirty(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  async function replace(file: File, audio: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await apiUpload<{ attachment: Attachment }>("/bots/" + bot + "/uploads", file);
      if (audio) update({ ...model, audio: r.attachment.path });
      else patch({ media: r.attachment.path });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }
  const labels = fr
    ? ["Éditorial", "Capture produit", "Dessin progressif", "Schéma", "Titres animés"]
    : ["Editorial", "Product capture", "Drawing", "Diagram", "Kinetic type"];
  return (
    <section className="studio-editor">
      <StudioPlayback solo={speakers.includes(solo) ? solo : ""} story={story} bot={bot} time={time} onTime={setTime} fr={fr} />
      <StudioSubtitles story={story} fr={fr} />
      {mp4 && <StudioMp4 key={name + "/" + version} bot={bot} name={name} version={version} dirty={dirty || busy} fr={fr} thread={thread} />}
      <div className="studio-tracks" aria-label={fr ? "Pistes de montage" : "Timeline tracks"}>
        {(["Image", fr ? "Titres" : "Titles", "Audio"] as const).map((label, i) => (
          <div className="studio-track" key={label}>
            <strong>{label}</strong>
            <div className={"studio-clips track-" + i}>
              {i < 2 ? (
                model.scenes.map((c, j) => (
                  <button
                    key={j}
                    type="button"
                    style={{ flex: c.seconds }}
                    aria-pressed={j === shot.index}
                    title={i === 0 ? c.media || labels[styles.indexOf(c.style)] : c.text}
                    onClick={() => seek(j)}
                  >
                    {i === 0 ? c.media.split("/").pop() || labels[styles.indexOf(c.style)] : c.text || "—"}
                  </button>
                ))
              ) : (
                <span style={{ marginLeft: Math.min(85, (100 * model.offset) / total) + "%" }}>
                  {model.audio
                    ? (model.muted ? "◦ " : "♫ ") + model.audio.split("/").pop()
                    : fr
                      ? "Aucune bande-son"
                      : "No soundtrack"}
                </span>
              )}
              {i < 2 && total > baseSeconds && <span aria-hidden="true" style={{flex: total-baseSeconds,visibility:"hidden"}} />}
            </div>
          </div>
        ))}
        {speakers.map(speaker=><div className="studio-track" key={speaker}>
          <button type="button" className="btn btn-small" aria-pressed={solo===speaker} title={fr?"Écouter seulement cette voix":"Solo this voice"} onClick={()=>setSolo(solo===speaker?"":speaker)}>{speaker} · Solo</button>
          <div className="studio-clips track-1">{model.scenes.map((c,i)=>c.speech?.speaker===speaker ?
            <button type="button" key={i} style={{flex:c.seconds}} onClick={()=>seek(i)}>{c.speech.text || speaker}</button> :
            <span key={i} aria-hidden="true" style={{flex:c.seconds,visibility:"hidden"}}/>)}
            {total > baseSeconds && <span aria-hidden="true" style={{flex: total-baseSeconds,visibility:"hidden"}} />}</div></div>)}
      </div>
      <StudioClips bot={bot} story={model} time={time} fr={fr} editable={editable} busy={busy}
        onBusy={setBusy} onSeek={setTime} onChange={clips => update({...model, clips})} />
      {editable && (
        <fieldset className="studio-controls" disabled={busy}>
          <legend>
            {fr ? "Plan" : "Shot"} {shot.index + 1} / {model.scenes.length}
          </legend>
          <label>
            {fr ? "Titre affiché" : "Caption"}
            <input
              className="input"
              maxLength={300}
              value={s.text}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </label>
          <StudioSpeech key={bot+"/"+shot.index+"/"+version+"/"+(s.speech?.path ?? "")} bot={bot} fr={fr} scene={s} cast={cast} onChange={speech=>{
            setStory(current=>current && ({...current,scenes:current.scenes.map((scene,i)=>i===shot.index?{...scene,speech}:scene)}));
            setDirty(true);
          }}/>
          <div className="studio-pair">
            <label>
              {fr ? "Durée (s)" : "Duration (s)"}
              <input
                className="input"
                type="number"
                min=".5"
                max="60"
                step=".1"
                value={s.seconds}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (v >= 0.5 && v <= 60 && baseSeconds - s.seconds + v <= MAX_PROJECT_SECONDS) patch({ seconds: v });
                }}
              />
            </label>
            <label>
              Style
              <select
                className="input"
                disabled={!!s.technique}
                value={s.style}
                onChange={(e) => patch({ style: e.target.value as Scene["style"] })}
              >
                {styles.map((v, i) => (
                  <option key={v} value={v}>
                    {labels[i]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {fr ? "Animation du plan" : "Shot animation"}
            <select className="input" value={s.technique ?? ""}
              onChange={e => patch({technique: (e.target.value || undefined) as Scene["technique"]})}>
              <option value="">{fr ? "Utiliser le style du plan" : "Use shot style"}</option>
              {studioTechniques.map(id => <option key={id} value={id}>{techniqueLabels[id][fr ? 0 : 1]}</option>)}
            </select>
          </label>
          <div className="studio-actions">
            <button className="btn btn-small" disabled={!shot.index} onClick={() => move(-1)}>
              ← {fr ? "Avancer" : "Earlier"}
            </button>
            <button
              className="btn btn-small"
              disabled={shot.index === model.scenes.length - 1}
              onClick={() => move(1)}
            >
              {fr ? "Reculer" : "Later"} →
            </button>
            <button
              className="btn btn-small"
              disabled={model.scenes.length >= MAX_SHOTS || baseSeconds + 4 > MAX_PROJECT_SECONDS}
              onClick={() => {
                update({
                  ...model,
                  scenes: [...model.scenes, { text: "", seconds: 4, media: "", style: "editorial" }],
                });
                setTime(total);
              }}
            >
              {fr ? "Ajouter un plan" : "Add shot"}
            </button>
            <button
              className="btn btn-small"
              disabled={model.scenes.length === 1}
              onClick={() => update({ ...model, scenes: model.scenes.filter((_, i) => i !== shot.index) })}
            >
              {fr ? "Retirer le plan" : "Remove shot"}
            </button>
          </div>
          <div className="studio-pair">
            <label>
              {fr ? "Média du plan" : "Shot media"}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void replace(f, false);
                }}
              />
            </label>
            <label>
              {fr ? "Bande-son" : "Soundtrack"}
              <input
                key={model.audio}
                type="file"
                accept=".mp3,.m4a,.ogg,.wav,.aac,.flac,.opus"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void replace(f, true);
                }}
              />
            </label>
          </div>
          <StudioLibraryAudio key={bot} bot={bot} value={model.audio} fr={fr} onPick={audio => update({ ...model, audio })} />
          {model.audio && (
            <div className="studio-pair">
              <label>
                {fr ? "Début de la bande-son (s)" : "Soundtrack start (s)"}
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={total}
                  step=".1"
                  value={model.offset}
                  onChange={(e) => {
                    const v = e.target.valueAsNumber;
                    if (v >= 0 && v <= MAX_PROJECT_SECONDS) update({ ...model, offset: v });
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={model.muted}
                  onChange={(e) => update({ ...model, muted: e.target.checked })}
                />
                {fr ? "Couper le son" : "Mute soundtrack"}
              </label>
            </div>
          )}
          <button className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
            {fr ? "Enregistrer une version" : "Save version"}
          </button>
        </fieldset>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
