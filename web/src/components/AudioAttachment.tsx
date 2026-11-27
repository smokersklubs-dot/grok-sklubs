import { useT } from "../i18n";
import type { Attachment } from "../types";
import { Icon } from "./Icon";
import "./VoicePlus.css";

/** L154 « note vocale envoyée par le bot »: an audio file in the chat plays right there, with its download link. */
export function AudioAttachment({ file, src, download }: { file: Attachment; src: string; download: string }) {
  const t = useT();
  return (
    <figure className="attach-audio">
      <audio src={src} controls preload="metadata" aria-label={t("attach.audio", { name: file.name })} />
      <figcaption>
        <Icon name="volume" size={13} />
        <span className="truncate">{file.name}</span>
        <a href={download} download={file.name} title={t("attach.downloadName", { name: file.name })} aria-label={t("attach.downloadName", { name: file.name })}><Icon name="download" size={14} /></a>
      </figcaption>
    </figure>
  );
}
