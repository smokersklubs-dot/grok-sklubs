import { duration, mediaUrl, type Story } from "./studioStory";

export function audioSchedule(story: Story, solo = "") {
  const clips: { path: string; start: number; end: number; volume: number; inPoint?: number }[] = [];
  let start = 0;
  for (const scene of story.scenes) {
    const end = start + scene.seconds;
    if (scene.speech && (!solo || scene.speech.speaker === solo))
      clips.push({ path: scene.speech.path, start, end, volume: 1 });
    start = end;
  }
  const total = duration(story);
  if (story.audio && !story.muted && !solo && story.offset < total)
    clips.push({ path: story.audio, start: story.offset, end: total, volume: clips.length ? 0.18 : 1 });
  for (const c of story.clips ?? [])
    if (c.kind === "audio" && (!solo || c.name === solo))
      clips.push({ path: c.path, start: c.start, end: c.start + (c.outPoint - c.inPoint), inPoint: c.inPoint, volume: c.volume ?? 1 });
  return clips;
}

export async function timelineAudio(
  bot: string,
  story: Story,
  stream: MediaStream | undefined,
  solo: string,
  failed: () => void,
  signal: AbortSignal,
) {
  const clips = audioSchedule(story, solo);
  const context = stream && clips.length ? new AudioContext() : null;
  const destination = context?.createMediaStreamDestination();
  const players = clips.map((c) => {
    const el = new Audio(mediaUrl(bot, c.path));
    el.preload = "auto";
    if (context && destination) {
      const src = context.createMediaElementSource(el),
        gain = context.createGain();
      gain.gain.value = c.volume;
      src.connect(gain).connect(destination);
    } else el.volume = c.volume;
    return { ...c, el, active: false };
  });
  let closed = false;
  function close() {
    closed = true;
    for (const p of players) {
      p.el.pause();
      p.el.removeAttribute("src");
      p.el.load();
    }
    if (context) void context.close();
  }
  try {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const loaded = players.map(
      ({ el }) =>
        new Promise<void>((resolve, reject) => {
          if (timeout.aborted) return reject(timeout.reason);
          if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve();
          function finish() {
            el.removeEventListener("loadeddata", ready);
            el.removeEventListener("error", failed);
            timeout.removeEventListener("abort", failed);
          }
          function ready() {
            finish();
            resolve();
          }
          function failed() {
            finish();
            reject(timeout.reason ?? new Error("Audio unavailable"));
          }
          el.addEventListener("loadeddata", ready, { once: true });
          el.addEventListener("error", failed, { once: true });
          timeout.addEventListener("abort", failed, { once: true });
        }),
    );
    await Promise.all([...loaded, ...(context ? [context.resume()] : [])]);
    if (context && destination && stream) {
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    }
  } catch (e) {
    close();
    throw e;
  }
  return {
    close,
    tick(t: number) {
      for (const p of players) {
        const inside = t >= p.start && t < p.end;
        if (inside === p.active) continue;
        p.active = inside;
        if (!inside) p.el.pause();
        else {
          p.el.currentTime = (p.inPoint ?? 0) + t - p.start;
          void p.el.play().catch(() => {
            if (!closed && p.active) failed();
          });
        }
      }
    },
  };
}
