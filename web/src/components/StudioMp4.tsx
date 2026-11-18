import { useEffect, useState } from "react";
import { api, errText } from "../api";
import type { Attachment } from "../types";
import { ErrorNote } from "./ui";

type Export = { id: string; state: "working" | "ready" | "failed"; file?: Attachment; error?: string };

export function StudioMp4({
  bot,
  name,
  version,
  fr,
  dirty, thread,
}: {
  bot: string;
  name: string;
  version: number;
  fr: boolean;
  dirty: boolean; thread?: number;
}) {
  const [voice, setVoice] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [job, setJob] = useState<Export | null>(null);
  const [error, setError] = useState("");
  const base = "/bots/" + encodeURIComponent(bot) + "/studio-mp4";
  useEffect(() => {
    if (job?.state !== "working") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<Export>("GET", base + "/" + job.id);
        if (!active) return;
        setJob(next);
        if (next.state === "working") timer = setTimeout(refresh, 2500);
      } catch (e) {
        if (active) {
          setError(errText(e));
          setJob(null);
        }
      }
    };
    timer = setTimeout(refresh, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job?.id, job?.state, base]);
  const start = async () => {
    setError("");
    setRequesting(true);
    try {
      setJob(await api<Export>("POST", base, { name, version, narration: voice, thread }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setRequesting(false);
    }
  };
  const busy = requesting || job?.state === "working";
  return (
    <div className="studio-mp4">
      <label>
        <input
          type="checkbox"
          checked={voice}
          disabled={busy}
          onChange={(e) => {
            setVoice(e.target.checked);
            setJob(null);
            setError("");
          }}
        />{" "}
        {fr ? "Lire les titres en voix off" : "Narrate the captions"}
      </label>
      {job?.file && !dirty ? (
        <a
          className="btn btn-small"
          href={
            "/api/bots/" + encodeURIComponent(bot) + "/files/download?path=" + encodeURIComponent(job.file.path)
          }
          download
        >
          {fr ? "Télécharger le MP4" : "Download MP4"}
        </a>
      ) : (
        <button type="button" className="btn btn-small" disabled={dirty || busy} onClick={start}>
          {busy ? (fr ? "Rendu MP4 en cours…" : "Rendering MP4…") : fr ? "Créer le MP4" : "Create MP4"}
        </button>
      )}
      {dirty && (
        <small>
          {fr ? "Enregistre le montage pour exporter cette version." : "Save the timeline to export this version."}
        </small>
      )}
      {(error || job?.error) && <ErrorNote>{error || job?.error}</ErrorNote>}
    </div>
  );
}
