import { useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES } from "../../../server/src/uploadlimits";
import { pickRecorderType } from "../lib/dictationPlan";
import { appendChunk, deleteRecording, listRecordings, recordingBlob, saveRecording, updateRecording, type SavedRecording } from "../lib/meetingRecordings";
import { useStore } from "../store";
import { Modal } from "./ui";
import "./meeting.css";

export function MeetingRecorder({ botId, close }: { botId: string; close: () => void }) {
  const owner = useStore(s => s.user?.id);
  const fr = useStore(s => s.locale === "fr");
  const scope = owner + "/" + botId;
  const [saved, setSaved] = useState<SavedRecording[]>([]);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "saving">("idle");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const mounted = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const supported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const refresh = async () => {
    const list = await listRecordings(scope);
    if (mounted.current) setSaved(list.filter(r => r.bytes > 0));
  };
  const showError = (err: unknown) => { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(showError);
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, [scope]);
  useEffect(() => {
    if (phase !== "recording") return;
    const start = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [phase]);

  async function start() {
    setError(""); setPhase("starting");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderType(type => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const release = () => rec.stream.getTracks().forEach(track => track.stop());
      if (!mounted.current) { release(); return; }
      const now = Date.now();
      const record: SavedRecording = { id: scope + "/" + crypto.randomUUID(), title: (fr ? "Réunion " : "Meeting ") + new Date(now).toLocaleString(fr ? "fr-FR" : "en-US"), mime: rec.mimeType, startedAt: now, savedAt: now, state: "recording", chunks: 0, bytes: 0 };
      await saveRecording(record);
      if (!mounted.current) { release(); return; }
      let writes = Promise.resolve(), seq = 0, bytes = 0;
      rec.ondataavailable = event => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_UPLOAD_BYTES) {
          showError(fr ? "Limite de 1 Go atteinte. La partie enregistrée peut être jointe." : "1 GB limit reached. You can attach the saved portion.");
          if (rec.state === "recording") rec.stop();
          return;
        }
        const part = seq++;
        writes = writes.then(() => appendChunk(record.id, part, event.data)).catch(err => {
          showError(err); if (rec.state === "recording") rec.stop();
        });
      };
      rec.onerror = () => { showError(fr ? "Le micro a été interrompu." : "Microphone interrupted."); if (rec.state === "recording") rec.stop(); };
      rec.onstop = () => {
        release(); recorder.current = null;
        if (mounted.current) setPhase("saving");
        void writes.then(() => updateRecording(record.id, { state: "finished" })).then(refresh).catch(showError)
          .finally(() => { if (mounted.current) setPhase("idle"); });
      };
      recorder.current = rec;
      rec.start(2000);
      setSeconds(0); setPhase("recording");
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop());
      showError(err); if (mounted.current) setPhase("idle");
    }
  }
  function attach(file: File) {
    const state = useStore.getState();
    if (state.user?.id !== owner || state.selectedId !== botId) return;
    const problem = state.attachFiles(botId, [file]);
    if (problem) { setError(problem); return; }
    const brief = fr ? "Transcris cette réunion, puis prépare un compte rendu avec les décisions et les actions. Indique le responsable et l’échéance quand ils sont mentionnés." : "Transcribe this meeting, then prepare minutes with the decisions and action items. Include owners and deadlines when stated.";
    const draft = state.drafts[botId]?.trimEnd();
    state.setDraft(botId, draft ? draft + "\n\n" + brief : brief);
    close();
  }
  async function attachRecording(r: SavedRecording) {
    setBusy(true);
    try {
      const blob = await recordingBlob(r);
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("aac") ? "aac" : "webm";
      if (mounted.current) attach(new File([blob], `meeting-${new Date(r.startedAt).toISOString().replace(/[:.]/g, "-")}.${ext}`, { type: blob.type }));
    } catch (err) { showError(err); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Modal title={fr ? "Réunion" : "Meeting"} onClose={close} size="sm">
    <div className="meeting-body">
      <p>{fr ? "Enregistre les échanges captés par ton micro ou importe un fichier audio ou vidéo. Tu pourras relire la demande avant de l’envoyer au bot." : "Record what your microphone hears or import an audio or video file. Review the request before sending it to your bot."}</p>
      {phase === "recording" ? <button className="btn" onClick={() => recorder.current?.stop()}>{fr ? "Arrêter et conserver" : "Stop and save"} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2,"0")}</button> :
        <button className="btn" disabled={!supported || phase !== "idle" || busy} onClick={() => void start()}>{phase === "saving" ? (fr ? "Enregistrement…" : "Saving…") : (fr ? "Enregistrer au micro" : "Record microphone")}</button>}
      <button className="btn" disabled={phase !== "idle" || busy} onClick={() => picker.current?.click()}>{fr ? "Importer un enregistrement" : "Import a recording"}</button>
      <input ref={picker} type="file" accept="audio/*,video/*,.m4a,.webm,.mkv" hidden onChange={e => { const file = e.target.files?.[0]; if (file) attach(file); e.target.value = ""; }} />
      {error && <p role="alert">{error}</p>}
      {saved.length > 0 && <h3>{fr ? "Enregistrements sur cet appareil" : "Recordings on this device"}</h3>}
      {saved.map(r => <div className="meeting-saved" key={r.id}><span>{r.title}</span>
        <button className="btn" disabled={phase !== "idle" || busy} onClick={() => void attachRecording(r)}>{fr ? "Joindre" : "Attach"}</button>
        <button className="btn" disabled={phase !== "idle" || busy} onClick={() => { if (window.confirm(fr ? "Effacer cet enregistrement de cet appareil ?" : "Remove this recording from this device?")) void deleteRecording(r.id).then(refresh).catch(showError); }}>{fr ? "Effacer" : "Remove"}</button></div>)}
    </div>
  </Modal>;
}
