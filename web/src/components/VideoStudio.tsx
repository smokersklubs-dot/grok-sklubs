import { useEffect, useRef, useState } from "react";
import { api, apiUpload, errText } from "../api";
import { MAX_UPLOAD_BYTES, useStore } from "../store";
import { scenesFrom, validStory, type Story } from "../lib/studioStory";
import type { Attachment } from "../types";
import { ErrorNote, Modal } from "./ui";
import { StudioLibraryAudio } from "./StudioLibraryAudio";
import "./VideoStudio.css";

export function VideoStudio({ onClose }: { onClose: () => void }) {
  const bots = useStore((s) => s.bots),
    selected = useStore((s) => s.selectedId),
    fr = useStore((s) => s.locale === "fr");
  const choices = Object.values(bots).filter((b) => b.kind === "agent" && !b.access);
  const [bot, setBot] = useState(() => choices.find((b) => b.id === selected)?.id ?? choices[0]?.id ?? "");
  const [title, setTitle] = useState(""),
    [lines, setLines] = useState(""),
    [aspect, setAspect] = useState<Story["aspect"]>("wide");
  const [files, setFiles] = useState<File[]>([]),
    [song, setSong] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID()),
    pending = useRef(false),
    uploaded = useRef(new WeakMap<File, { bot: string; path: string }>());
  const [libraryAudio, setLibraryAudio] = useState("");
  const songInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!bot && choices[0]) setBot(choices[0].id);
  }, [choices, bot]);
  async function upload(f: File) {
    const prior = uploaded.current.get(f);
    if (prior?.bot === bot) return prior.path;
    setProgress(f.name);
    const r = await apiUpload<{ attachment: Attachment }>("/bots/" + bot + "/uploads", f, percent => setProgress(`${f.name} · ${percent}%`));
    setProgress("");
    uploaded.current.set(f, { bot, path: r.attachment.path });
    return r.attachment.path;
  }
  async function create() {
    if (!title.trim() || !bot || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (files.length > 60 || [...files, ...(song ? [song] : [])].some((f) => f.size > MAX_UPLOAD_BYTES))
        throw Error(fr ? "Maximum 60 plans et 1 Go par fichier." : "Up to 60 shots and 1 GB per file.");
      const paths: string[] = [];
      for (const f of files) paths.push(await upload(f));
      const story: Story = {
        title: title.trim(),
        aspect,
        scenes: scenesFrom(lines, paths, title.trim()),
        audio: song ? await upload(song) : libraryAudio,
        offset: 0,
        muted: false,
      };
      if (!validStory(story))
        throw Error(
          fr
            ? "Vérifie les repères et les durées. Le montage accepte 0,5 à 60 s par plan et 5 minutes au total."
            : "Check the timings. Use 0.5–60 seconds per shot and up to 5 minutes overall.",
        );
      const result = await api<{ token: string; title: string }>("POST", "/bots/" + bot + "/video-studio", {
        key: key.current,
        story,
      });
      const s = useStore.getState();
      s.selectBot(bot);
      s.openModal(null);
      s.showArtifact({ token: result.token, title: result.title, botId: bot });
    } catch (e) {
      setError(errText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={fr ? "Studio vidéo" : "Video Studio"}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
    >
      <form
        className="modal-body studio-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          {fr ? "Titre du montage" : "Project title"}
          <input
            className="input"
            autoFocus
            required
            value={title}
            maxLength={110}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={fr ? "Ex. Présentation de la collection" : "e.g. Collection preview"}
          />
        </label>
        <div className="studio-pair">
          <label>
            {fr ? "Bureau du bot" : "Bot workspace"}
            <select className="input" value={bot} onChange={(e) => { setBot(e.target.value); setLibraryAudio(""); }}>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Format
            <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value as Story["aspect"])}>
              <option value="wide">16:9</option>
              <option value="vertical">9:16</option>
              <option value="square">1:1</option>
            </select>
          </label>
        </div>
        <label>
          {fr ? "Texte des plans" : "Shot captions"}
          <textarea
            className="input"
            rows={4}
            value={lines}
            maxLength={7500}
            onChange={(e) => setLines(e.target.value)}
            placeholder={
              fr
                ? "Une ligne par plan. Pour des paroles synchronisées, commence chaque ligne par [mm:ss.xx]."
                : "One line per shot. Start each line with [mm:ss.xx] for timed lyrics."
            }
          />
        </label>
        <div className="studio-pair">
          <label>
            {fr ? "Images et clips" : "Images and clips"}
            <input
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <label>
            {fr ? "Bande-son" : "Soundtrack"}
            <input
              type="file"
              accept=".mp3,.m4a,.wav,.ogg,.aac,.flac,.opus"
              ref={songInput}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) { setSong(file); setLibraryAudio(""); } }}
            />
          </label>
        </div>
        <StudioLibraryAudio key={bot} bot={bot} value={libraryAudio} fr={fr} onPick={path => {
          setLibraryAudio(path); setSong(null); if (songInput.current) songInput.current.value = "";
        }} />
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary" disabled={busy || !title.trim() || !bot}>
          {busy ? progress || (fr ? "Préparation…" : "Preparing…") : fr ? "Ouvrir le montage" : "Open timeline"}
        </button>
      </form>
    </Modal>
  );
}
