import { useEffect, useRef, useState } from "react";
import { drawFrame, duration, visualSources, visualTimes, mediaUrl, type Story, type Visual } from "../lib/studioStory";
import { timelineAudio } from "../lib/studioAudio";
import { ErrorNote } from "./ui";

export function StudioPlayback({
  story,
  bot,
  time,
  onTime,
  fr,
  solo = "",
}: {
  story: Story;
  bot: string;
  time: number;
  onTime: (n: number) => void;
  fr: boolean;
  solo?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    assets = useRef(new Map<string, Visual>()),
    audio = useRef<HTMLAudioElement | null>(null);
  const stop = useRef<() => void>(() => {}),
    playing = useRef(false),
    refreshed = useRef(() => {}),
    frame = useRef(0);
  const [ready, setReady] = useState(false),
    [mode, setMode] = useState(""),
    [error, setError] = useState("");
  const sources = JSON.stringify(visualSources(story));
  const total = duration(story),
    width = story.aspect === "vertical" ? 720 : 1280,
    height = story.aspect === "wide" ? 720 : story.aspect === "square" ? 1280 : 1280;
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    const all = new Map<string, Visual>();
    assets.current = all;
    function load(el: HTMLImageElement | HTMLMediaElement, path: string) {
      return new Promise<void>((resolve, reject) => {
        const done = () => resolve();
        el.addEventListener(el instanceof HTMLImageElement ? "load" : "loadeddata", done, { once: true });
        el.addEventListener(
          "error",
          () => reject(new Error((fr ? "Média illisible : " : "Cannot read media: ") + path.split("/").pop())),
          { once: true },
        );
        if (el instanceof HTMLMediaElement) el.preload = "auto";
        el.src = mediaUrl(bot, path);
      });
    }
    const jobs = (JSON.parse(sources) as [string,string][]).map(([key,path]) => {
      const el = /\.(mp4|webm|mov)$/i.test(path) ? document.createElement("video") : new Image();
      if (el instanceof HTMLVideoElement) {
        el.muted = true;
        el.playsInline = true;
        el.addEventListener("seeked", () => {
          if (active) refreshed.current();
        });
      }
      all.set(key, el);
      return load(el, path);
    });
    const song = story.audio ? new Audio() : null;
    audio.current = song;
    if (song) jobs.push(load(song, story.audio));
    Promise.all(jobs)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      });
    return () => {
      active = false;
      stop.current();
      for (const el of [...all.values(), song])
        if (el instanceof HTMLMediaElement) {
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
      audio.current = null;
    };
  }, [sources, story.audio, bot, fr]);
  function paint(t: number, running: boolean) {
    if (!canvas.current) return;
    const target = visualTimes(story, t);
    for (const [path, el] of assets.current)
      if (el instanceof HTMLVideoElement) {
        const wanted = target.get(path);
        if (wanted === undefined) {
          if (!el.paused) el.pause();
          continue;
        }
        const point = Math.min(wanted, Math.max(0, (el.duration || 0) - 0.04));
        if (Math.abs(point - el.currentTime) > (running ? 0.22 : 0.035)) el.currentTime = point;
        if (running && el.paused && wanted < el.duration) void el.play().catch(() => {});
        else if (!running) el.pause();
      }
    drawFrame(canvas.current, story, assets.current, t);
  }
  refreshed.current = () => {
    if (!playing.current && canvas.current) drawFrame(canvas.current, story, assets.current, time);
  };
  useEffect(() => {
    if (ready && !playing.current) paint(time, false);
  }, [time, story, ready]);
  useEffect(() => () => stop.current(), []);
  useEffect(() => {
    stop.current();
  }, [story, solo]);
  async function start(exporting: boolean) {
    if (!ready || !canvas.current || playing.current) return;
    setError("");
    playing.current = true;
    setMode(exporting ? "export" : "play");
    let recorder: MediaRecorder | undefined,
      stream: MediaStream | undefined,
      mixer: Awaited<ReturnType<typeof timelineAudio>> | undefined;
    const controller = new AbortController();
    let finished = false,
      keep = false,
      current = exporting || time >= total - 0.05 ? 0 : time;
    const reset = () => {
      finished = true;
      controller.abort();
      playing.current = false;
      cancelAnimationFrame(frame.current);
      mixer?.close();
      for (const e of assets.current.values()) if (e instanceof HTMLVideoElement) e.pause();
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());

      setMode("");
      stop.current = () => {};
    };
    stop.current = reset;
    try {
      let mime = "";
      if (exporting) {
        if (typeof MediaRecorder === "undefined" || !canvas.current.captureStream)
          throw Error(fr ? "Ce navigateur ne permet pas l’export vidéo." : "This browser cannot export video.");
        mime =
          ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"].find((s) =>
            MediaRecorder.isTypeSupported(s),
          ) ?? "";
        stream = canvas.current.captureStream(25);
      }
      mixer = await timelineAudio(
        bot,
        story,
        stream,
        exporting ? "" : solo,
        () => {
          if (!finished) {
            setError(fr ? "Lecture de la piste audio impossible." : "Cannot play audio.");
            reset();
          }
        },
        controller.signal,
      );
      if (finished) {
        mixer.close();
        return;
      }
      if (exporting && stream) {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        recorder.onstop = () => {
          if (!keep || !chunks.length) return;
          const kind = recorder!.mimeType,
            url = URL.createObjectURL(new Blob(chunks, { type: kind }));
          const a = document.createElement("a");
          a.href = url;
          a.download =
            (story.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 72) || "montage") +
            (kind.includes("mp4") ? ".mp4" : ".webm");
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        };
        recorder.onerror = () => {
          setError(fr ? "L’export a été interrompu." : "Export interrupted.");
          reset();
        };
      }
      paint(current, true);
      onTime(current);
      recorder?.start(250);
      const startAt = performance.now() - current * 1000;
      let lastUi = -1;
      const tick = (now: number) => {
        if (finished) return;
        current = Math.min(total, (now - startAt) / 1000);
        mixer?.tick(current);
        paint(current, true);
        if (current - lastUi >= 0.08 || current >= total) {
          onTime(current);
          lastUi = current;
        }
        if (current >= total) {
          keep = true;
          reset();
        } else frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch (e) {
      if (!finished) {
        setError((e as Error).message);
        reset();
      }
    }
  }
  return (
    <div className="studio-player">
      <canvas ref={canvas} width={width} height={height} aria-label={story.title} />
      <div className="studio-transport">
        <button
          className="btn btn-small"
          disabled={!ready || mode === "export"}
          onClick={() => (mode ? stop.current() : void start(false))}
        >
          {mode === "play" ? (fr ? "Pause" : "Pause") : fr ? "Lire" : "Play"}
        </button>
        <input
          type="range"
          min="0"
          max={total}
          step=".05"
          value={Math.min(time, total)}
          aria-label={fr ? "Tête de lecture" : "Playhead"}
          onChange={(e) => {
            stop.current();
            onTime(+e.target.value);
          }}
          disabled={mode === "export"}
        />
        <output>
          {time.toFixed(1)} / {total.toFixed(1)} s
        </output>
        <button
          className="btn btn-primary btn-small"
          disabled={!ready || mode === "play"}
          onClick={() => (mode === "export" ? stop.current() : void start(true))}
        >
          {mode === "export"
            ? fr
              ? "Annuler l’export"
              : "Cancel export"
            : fr
              ? "Exporter la vidéo"
              : "Export video"}
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
