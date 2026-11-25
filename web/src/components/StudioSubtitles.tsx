import { useEffect, useState } from "react";
import { t as tr } from "../i18n";
import type { Story } from "../lib/studioStory";
import { studioSubtitles } from "../lib/studioSubtitles";

export function StudioSubtitles({ story, fr }: { story: Story; fr: boolean }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<{ srt: string; vtt: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    const build = (format: "srt" | "vtt", type: string) => URL.createObjectURL(new Blob([studioSubtitles(story, format)], { type }));
    const urls = { srt: build("srt", "application/x-subrip;charset=utf-8"), vtt: build("vtt", "text/vtt;charset=utf-8") };
    setLinks(urls);
    return () => { URL.revokeObjectURL(urls.srt); URL.revokeObjectURL(urls.vtt); };
  }, [story, open]);
  if (!story.scenes.some(s => s.text.trim())) return null;
  const name = story.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "studio";
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{tr("studio.shotSubtitles")}</summary>
    {open && links && <div className="studio-actions">
      {(["srt", "vtt"] as const).map(format => <a className="btn btn-small" key={format}
        href={links[format]} download={name + "." + format}>
        {tr("studio.downloadFormat", { format: format.toUpperCase() })}
      </a>)}
    </div>}
  </details>;
}
