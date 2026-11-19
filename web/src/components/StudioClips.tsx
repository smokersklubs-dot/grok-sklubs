import { useState } from "react";
import { MAX_CLIPS, MAX_PROJECT_SECONDS, validClips, type StudioClip } from "../../../server/src/studioclips";
import { apiUpload, errText } from "../api";
import { duration, mediaUrl, type Story } from "../lib/studioStory";
import type { Attachment } from "../types";

type Props = { bot: string; story: Story; time: number; fr: boolean; editable: boolean; busy: boolean;
  onSeek: (time: number) => void; onChange: (clips: StudioClip[]) => void; onBusy: (busy: boolean) => void };
const rounded = (n: number) => Math.round(n * 1000) / 1000;
async function sourceSeconds(bot: string, path: string): Promise<number> {
  if (/\.(png|jpe?g|webp|gif)$/i.test(path)) return 4;
  const el = document.createElement(/\.(mp4|webm|mov)$/i.test(path) ? "video" : "audio");
  try {
    return await new Promise<number>((resolve,reject) => {
      const timeout = window.setTimeout(() => reject(Error("Media metadata unavailable")), 12000);
      el.onloadedmetadata = () => { clearTimeout(timeout); resolve(Number.isFinite(el.duration) ? el.duration : 4); };
      el.onerror = () => { clearTimeout(timeout); reject(Error("Media unreadable")); };
      el.preload = "metadata"; el.src = mediaUrl(bot, path);
    });
  } finally { el.onloadedmetadata=null; el.onerror=null; el.removeAttribute("src"); el.load(); }
}

export function StudioClips({ bot, story, time, fr, editable, busy, onSeek, onChange, onBusy }: Props) {
  const [selected, select] = useState(""), [error, setError] = useState("");
  const t = (local: string, en: string) => fr ? local : en;
  const clips = story.clips ?? [], current = clips.find(c => c.id === selected), total = duration(story);
  const sources = [...new Set([...story.scenes.flatMap(s => [s.media, s.speech?.path]), story.audio, ...clips.map(c => c.path)].filter((p): p is string => !!p))];
  const apply = (next: StudioClip[]) => {
    if (!validClips(next)) {
      setError(t("Vérifie le placement et les points d’entrée et de sortie. Un clip dure au moins 0,04 s et se termine avant 5 minutes.", "Check the placement and source points. Each clip must last at least 0.04 s and end within 5 minutes."));
      return false;
    }
    setError(""); onChange(next); return true;
  };
  const add = async (path: string) => {
    const kind = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(path) ? "audio" : "visual";
    const start = Math.min(rounded(time), MAX_PROJECT_SECONDS - .04);
    const clip: StudioClip = { id: crypto.randomUUID(), kind, name: path.split("/").pop()!.slice(0,100), path,
      start, inPoint: 0, outPoint: Math.max(.04, Math.min(rounded(await sourceSeconds(bot,path)), rounded(MAX_PROJECT_SECONDS - start))) };
    if (apply([...clips, clip])) select(clip.id);
  };
  async function upload(file: File) {
    onBusy(true); setError("");
    try { const { attachment } = await apiUpload<{ attachment: Attachment }>("/bots/" + bot + "/uploads", file); await add(attachment.path); }
    catch (err) { setError(errText(err)); }
    finally { onBusy(false); }
  }
  async function reuse(path: string) {
    onBusy(true); setError("");
    try { await add(path); } catch { setError(t("Impossible de lire la durée de ce média.", "Could not read the duration of this media.")); }
    finally { onBusy(false); }
  }
  const edit = (patch: Partial<StudioClip>) => apply(clips.map(c => c.id === selected ? {...c, ...patch} : c));
  const split = () => {
    if (!current) return;
    const cut = rounded(current.inPoint + time - current.start);
    const second = { ...current, id: crypto.randomUUID(), inPoint: cut, start: rounded(time) };
    if (apply(clips.flatMap(c => c.id === selected ? [{ ...c, outPoint: cut }, second] : [c]))) select(second.id);
  };
  const reorder = (delta: number) => {
    const next = [...clips], i = next.findIndex(c => c.id === selected), j = i + delta;
    if (i < 0 || j < 0 || j >= clips.length) return;
    [next[i], next[j]] = [next[j], next[i]]; apply(next);
  };
  const number = (key: "start" | "inPoint" | "outPoint" | "volume" | "opacity" | "scale" | "x" | "y",
    label: string, fallback: number, max: number, min = 0) => {
    if (!current) return null;
    const value = current[key] ?? fallback;
    return <label key={key}>{label}<input className="input" type="number" key={current.id + ":" + value}
      min={min} max={max} step=".01" defaultValue={value} onBlur={e => {
        const field = e.currentTarget, n = field.valueAsNumber;
        if (n === value) return;
        const patch: Partial<StudioClip> = { [key]: n };
        if (key === "inPoint" && n >= current.outPoint)
          patch.outPoint = rounded(n + current.outPoint - current.inPoint);
        if (!edit(patch)) field.value = String(value);
      }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
  };
  if (!editable && !clips.length) return null;
  return <section className="studio-free-clips" aria-label={t("Pistes libres", "Independent tracks")}>
    <h4>{t("Pistes libres", "Independent tracks")}</h4>
    {clips.map(c => <div className="studio-track" key={c.id}>
      <span title={c.name}>{c.kind === "audio" ? "♫" : "▣"} {c.name}</span>
      <div className="studio-layer-lane">
        <button type="button" title={c.name} aria-label={c.name} aria-pressed={selected === c.id}
          style={{left: 100*c.start/total + "%", width: 100*(c.outPoint-c.inPoint)/total + "%"}}
          onClick={() => { select(c.id); onSeek(c.start); }}>{c.name}</button>
      </div>
    </div>)}
    {editable && <fieldset disabled={busy} className="studio-free-fields">
      <div className="studio-layer-actions">
        <label className="btn btn-small">{t("Importer un clip", "Import a clip")}
          <input type="file" disabled={clips.length >= MAX_CLIPS} accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus"
            onChange={e => { const file=e.target.files?.[0]; e.target.value=""; if (file) void upload(file); }} /></label>
        {sources.length > 0 && <select className="input" aria-label={t("Réutiliser un média", "Reuse media")} value="" disabled={clips.length >= MAX_CLIPS}
          onChange={e => { if (e.target.value) void reuse(e.target.value); }}><option value="">{t("Réutiliser un média…", "Reuse media…")}</option>
          {sources.map(p => <option key={p} value={p}>{p.split("/").pop()}</option>)}</select>}
      </div>
      {current && <div>
        <label>{t("Nom de piste", "Track name")}<input className="input" key={current.id + current.name} defaultValue={current.name} maxLength={100}
          onBlur={e => { if (e.target.value !== current.name && !edit({name: e.target.value.trim()})) e.target.value=current.name; }} /></label>
        <div className="studio-layer-fields">
          {number("start", t("Début du clip (s)", "Timeline start (s)"), 0, MAX_PROJECT_SECONDS)}
          {number("inPoint", t("Entrée source (s)", "Source in (s)"), 0, 86400)}
          {number("outPoint", t("Sortie source (s)", "Source out (s)"), 4, 86400)}
          {current.kind === "audio" ? number("volume", t("Volume (0–1)", "Volume (0–1)"), 1, 1) : <>
            {number("x", t("Position X (0–1)", "X position (0–1)"), .5, 1)}
            {number("y", t("Position Y (0–1)", "Y position (0–1)"), .5, 1)}
            {number("scale", t("Échelle (0–1)", "Scale (0–1)"), .5, 1, .02)}
            {number("opacity", t("Opacité (0–1)", "Opacity (0–1)"), 1, 1)}</>}
        </div>
        <div className="studio-layer-actions">
          <button type="button" className="btn btn-small" disabled={clips.length >= MAX_CLIPS || time - current.start < .04 || current.start + current.outPoint - current.inPoint - time < .04}
            onClick={split}>{t("Scinder à la tête de lecture", "Split at playhead")}</button>
          {current.kind === "visual" && <>
            <button type="button" className="btn btn-small" disabled={clips.indexOf(current) === 0} onClick={() => reorder(-1)}>{t("Reculer", "Move back")}</button>
            <button type="button" className="btn btn-small" disabled={clips.indexOf(current) === clips.length-1} onClick={() => reorder(1)}>{t("Avancer", "Move forward")}</button></>}
          <button type="button" className="btn btn-small" onClick={() => { apply(clips.filter(c => c.id !== selected)); select(""); }}>{t("Retirer le clip", "Remove clip")}</button>
        </div>
      </div>}
    </fieldset>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
