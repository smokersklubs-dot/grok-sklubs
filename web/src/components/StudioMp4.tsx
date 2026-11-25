import { useEffect, useState } from "react";
import { t as tr } from "../i18n";
import { api, errText } from "../api";
import type { Attachment } from "../types";
import { ErrorNote } from "./ui";

type Export = {
  id: string;
  state: "queued" | "working" | "ready" | "failed";
  file?: Attachment;
  error?: string;
  narration: boolean;
  language: string;
};

export function StudioMp4({
  bot,
  name,
  version,
  fr,
  dirty,
  thread,
}: {
  bot: string;
  name: string;
  version: number;
  fr: boolean;
  dirty: boolean;
  thread?: number;
}) {
  const [choice, setVoice] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [job, setJob] = useState<Export | null>(null);
  const voice = choice ?? job?.narration ?? false;
  const [error, setError] = useState("");
  const base = "/bots/" + encodeURIComponent(bot) + "/studio-mp4";
  useEffect(() => {
    const abort = new AbortController();
    setJob(null);
    const query = new URLSearchParams({ name, version: String(version), thread: String(thread ?? 0) });
    if (choice !== null) query.set("narration", String(choice));
    api<{ job: Export | null }>("GET", base + "?" + query, undefined, abort.signal)
      .then((r) => {
        if (!abort.signal.aborted) setJob((current) => current ?? r.job);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errText(e));
      });
    return () => abort.abort();
  }, [base, name, version, thread, choice]);
  useEffect(() => {
    if (job?.state !== "working" && job?.state !== "queued") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<Export>("GET", base + "/" + job.id);
        if (!active) return;
        setError("");
        setJob(next);
        if (next.state === "working" || next.state === "queued") timer = setTimeout(refresh, 2500);
      } catch (e) {
        if (active) {
          setError(errText(e));
          timer = setTimeout(refresh, 5000);
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
      setJob(
        await api<Export>("POST", base, { name, version, narration: voice, language: job?.language, thread }),
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setRequesting(false);
    }
  };
  const busy = requesting || job?.state === "working" || job?.state === "queued";
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
        {tr("studio.narrateCaptions")}
      </label>
      {job?.file && !dirty ? (
        <a
          className="btn btn-small"
          href={
            "/api/bots/" + encodeURIComponent(bot) + "/files/download?path=" + encodeURIComponent(job.file.path)
          }
          download
        >
          {tr("studio.downloadMp")}
        </a>
      ) : (
        <button type="button" className="btn btn-small" disabled={dirty || busy} onClick={start}>
          {job?.state === "queued"
            ? tr("studio.queued")
            : busy
              ? tr("studio.renderingMp")
              : job?.state === "failed"
                ? tr("studio.retryMp")
                : tr("studio.createMp")}
        </button>
      )}
      {dirty && (
        <small>
          {tr("studio.saveTimelineExportVersion")}
        </small>
      )}
      {(error || job?.error) && <ErrorNote>{error || job?.error}</ErrorNote>}
    </div>
  );
}
