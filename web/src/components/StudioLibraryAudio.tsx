import { useEffect, useState } from "react";
import { t as tr, intlLocale } from "../i18n";
import { api, errText } from "../api";
import type { FileEntry } from "../types";
import { ErrorNote } from "./ui";

/** Audio already in the selected bot's library can be used without a download/re-upload. */
export function StudioLibraryAudio({ bot, value, onPick, fr }: {
  bot: string; value: string; onPick: (path: string) => void; fr: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !bot) return;
    const request = new AbortController();
    setFiles(null); setError("");
    api<{ entries: FileEntry[] }>("GET", "/bots/" + encodeURIComponent(bot) + "/files?path=audio", undefined, request.signal)
      .then(r => { if (!request.signal.aborted) setFiles(r.entries.filter(f => !f.dir && /\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(f.name)).sort((a,b) => b.modifiedAt - a.modifiedAt)); })
      .catch(e => { if (!request.signal.aborted) setError(errText(e)); });
    return () => request.abort();
  }, [bot, open]);
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{tr("studio.botWorkspaceAudio")}</summary>
    {open && (error ? <ErrorNote>{error}</ErrorNote> : !files ? <p role="status">{tr("common.loading")}</p> :
      files.length === 0 ? <p className="muted">{tr("studio.recordingsAudioFolderWill")}</p> :
      <label>{tr("studio.chooseRecording")}
        <select className="input" value={value.startsWith("audio/") ? value : ""} onChange={e => onPick(e.target.value)}>
          <option value="" disabled>{tr("studio.recordings")}</option>
          {files.map(f => <option key={f.name} value={"audio/" + f.name}>{f.name} · {new Date(f.modifiedAt).toLocaleString(intlLocale())}</option>)}
        </select>
      </label>)}
  </details>;
}
