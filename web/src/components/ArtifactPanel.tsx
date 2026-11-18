import { useEffect, useState, type FormEvent } from "react";
import { StudioEditor } from "./StudioEditor";
import { Icon } from "./Icon";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { ErrorNote, Loading } from "./ui";

interface Version {
  id: number;
  n: number;
  preview: string;
}
interface Project {
  title: string;
  botId: string;
  name: string;
  versions: Version[];
  files: string[];
}

export function ArtifactPanel({
  token,
  title,
  botId,
  thread,
  readOnly,
}: {
  token: string;
  title: string;
  botId?: string;
  thread?: number;
  readOnly?: boolean;
}) {
  const t = useT();
  const fr = useStore((s) => s.locale === "fr");
  const revision = useStore((s) => s.pageChanges[token] ?? 0);
  const live = useStore((s) => (botId ? s.live[botId] : undefined));
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState(0);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const base = `/pages/${token}`;
  useEffect(() => {
    let active = true;
    setLoadError("");
    api<Project>("GET", base + "/versions").then(
      (data) => {
        if (active) setProject(data);
      },
      (e) => {
        if (active) {
          setLoadError(errText(e));
          setProject(null);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [base, revision, retry]);
  const current = project?.versions[0];
  const version = project?.versions.find((v) => v.id === selected) ?? current;
  const canEdit = !readOnly && botId && botId === project?.botId && version?.id === current?.id;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !project || !request.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const text =
        project.name.startsWith("artifact-video-") && current
          ? (fr ? "Modifie le montage" : "Edit video project") +
            " " +
            project.name +
            " (version " +
            current.id +
            "). " +
            request.trim() +
            "\n" +
            (fr
              ? "Lis studio.json et applique la modification avec video_studio_update. Pour un rendu avancé, utilise les sources de production.md."
              : "Read studio.json and apply the change with video_studio_update. For advanced rendering use the sources in production.md.")
          : t("artifact.revisePrompt", { name: project.name, change: request.trim() });
      const { row } = await api<{ row: Row }>("POST", `/bots/${botId}/messages`, { text, thread });
      useStore.getState().addRows(botId, [row]);
      setRequest("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="artifact-content" aria-label={project?.title || title}>
      <header className="dock-head">
        <Icon name="panel" size={18} />
        <strong>{project?.title || title}</strong>
      </header>
      {loadError ? (
        <div className="artifact-tools">
          <ErrorNote>{loadError}</ErrorNote>
          <button className="btn" onClick={() => setRetry(retry + 1)}>
            {t("localTools.retry")}
          </button>
        </div>
      ) : !project ? (
        <Loading />
      ) : (
        <>
          <div className="artifact-tools">
            {version && (
              <label>
                {t("pagePreview.versions")}{" "}
                <select
                  className="input"
                  value={version.id}
                  onChange={(e) => setSelected(Number(e.target.value) === current?.id ? 0 : Number(e.target.value))}
                >
                  {project.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {t("pages.versionN", { n: v.n })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <a
              className="btn btn-small"
              href={`/api${base}/export${version ? "?version=" + version.id : ""}`}
              download
            >
              {t("artifact.export")}
            </a>
          </div>
          {version && /^artifact-video-[a-f0-9-]{36}$/.test(project.name) && project.files.includes("studio.json") ? (
            <StudioEditor
              bot={project.botId}
              name={project.name}
              preview={version.preview}
              version={version.id}
              editable={!!canEdit}
            />
          ) : (
            <iframe
              className="artifact-canvas"
              src={version?.preview ?? `/p/${token}`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={project.title}
            />
          )}
          {canEdit && (
            <form className="artifact-edit" onSubmit={send}>
              <textarea
                className="input"
                rows={2}
                maxLength={16000}
                aria-label={t("artifact.change")}
                placeholder={t("artifact.change")}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
              <button className="btn btn-primary" disabled={busy || !request.trim()}>
                {t("thread.send")}
              </button>
            </form>
          )}
          {live?.running && (
            <p className="artifact-state" role="status">
              {t("artifact.botWorking")}
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
        </>
      )}
    </aside>
  );
}
