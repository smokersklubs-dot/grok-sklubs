import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import { t, useT } from "../i18n";
import { useStore, type Upload } from "../store";
import type { Bot, Live, Row } from "../types";
import { botTitle, fileSize } from "../lib/format";
import { endCall, startCall } from "../lib/call";
import { canCall, canRecognize, createRecognition, micErrorText, recognitionLang, type Recognition } from "../lib/speech";
import { Icon, Spinner } from "./Icon";
import { ErrorNote, Menu, MenuItem, useEscape } from "./ui";

type DictationState = "idle" | "recording" | "transcribing";

/** Dictation with the browser's speech recognition. Text is delivered once, when recording stops. */
function useDictation(lang: string, onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const rec = useRef<Recognition | null>(null);
  const finals = useRef("");
  const cancelled = useRef(false);
  const cb = useRef({ onText, onError });
  useEffect(() => {
    cb.current = { onText, onError };
  });

  const start = useCallback(() => {
    if (rec.current) return;
    const r = createRecognition(lang);
    if (!r) return;
    finals.current = "";
    cancelled.current = false;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals.current = `${finals.current} ${(res[0]?.transcript ?? "").trim()}`.trim();
      }
    };
    r.onerror = (e) => {
      const message = micErrorText(e.error);
      if (message) cb.current.onError(message);
    };
    r.onend = () => {
      rec.current = null;
      setState("idle");
      if (!cancelled.current && finals.current) cb.current.onText(finals.current);
    };
    rec.current = r;
    try {
      r.start();
      setState("recording");
    } catch {
      rec.current = null;
      cb.current.onError(t("composer.micFailed"));
    }
  }, [lang]);

  const stop = useCallback(() => {
    if (!rec.current) return;
    setState("transcribing");
    try {
      rec.current.stop();
    } catch {
      rec.current = null;
      setState("idle");
    }
  }, []);

  const cancel = useCallback(() => {
    if (!rec.current) return;
    cancelled.current = true;
    try {
      rec.current.abort();
    } catch {
      rec.current = null;
      setState("idle");
    }
  }, []);

  useEffect(() => cancel, [cancel]);
  return { state, start, stop, cancel };
}

const NO_UPLOADS: Upload[] = [];

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}

/** One file waiting to go out with the next message. */
function UploadChip({ upload, onRemove }: { upload: Upload; onRemove: () => void }) {
  const t = useT();
  const sub = upload.status === "uploading" ? t("composer.uploading") : upload.status === "error" ? upload.error || t("composer.uploadFailed") : fileSize(upload.size);
  return (
    <li className={`upload is-${upload.status}`} title={upload.status === "error" ? (upload.error ?? undefined) : upload.name}>
      <span className="upload-thumb">
        {upload.preview ? <img src={upload.preview} alt="" /> : <Icon name="file" size={18} />}
        {upload.status === "uploading" && (
          <span className="upload-busy">
            <Spinner size={16} />
          </span>
        )}
      </span>
      <span className="upload-text">
        <span className="upload-name truncate">{upload.name}</span>
        <span className="upload-sub truncate" role={upload.status === "error" ? "alert" : undefined}>{sub}</span>
      </span>
      <button type="button" className="upload-x" aria-label={t("composer.removeFile", { name: upload.name })} title={t("composer.removeFile", { name: upload.name })} onClick={onRemove}>
        <Icon name="close" size={13} />
      </button>
    </li>
  );
}

export function Composer({ bot, live }: { bot: Bot; live: Live }) {
  const draft = useStore((s) => s.drafts[bot.id] ?? "");
  const uploads = useStore((s) => s.uploads[bot.id]) ?? NO_UPLOADS;
  const focusTick = useStore((s) => s.focusTick);
  const callBotId = useStore((s) => s.call?.botId ?? null);
  const anyModal = useStore((s) => !!(s.modal || s.botSettings || s.appSettings || s.viewerBotId));
  const { setDraft, addRows, openModal, resetConversation, showToast, attachFiles, removeUpload, clearUploads } = useStore.getState();
  const t = useT();
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const pressStarted = useRef<{ at: number; started: boolean } | null>(null);

  const insertAtCaret = useCallback(
    (text: string) => {
      const el = area.current;
      const current = useStore.getState().drafts[bot.id] ?? "";
      const start = el ? el.selectionStart : current.length;
      const end = el ? el.selectionEnd : current.length;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const lead = before && !/\s$/.test(before) ? " " : "";
      const trail = after && !/^\s/.test(after) ? " " : "";
      const next = before + lead + text + trail + after;
      setDraft(bot.id, next);
      const caret = (before + lead + text).length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
    },
    [bot.id, setDraft],
  );

  const dictation = useDictation(recognitionLang(bot.voice), insertAtCaret, setError);
  useEscape(dictation.cancel, dictation.state === "recording");

  // Auto-grow up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft, bot.id]);

  useEffect(() => {
    if (!anyModal) area.current?.focus({ preventScroll: true });
    setError(null);
    setMenu(false);
    setDragging(false);
    dragDepth.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id, focusTick]);

  useEffect(() => {
    if (!menu) setConfirmNew(false);
  }, [menu]);

  const text = draft.trim();
  const ready = uploads.filter((u) => u.status === "ready" && u.attachment);
  const uploading = uploads.some((u) => u.status === "uploading");
  const inCall = callBotId === bot.id;
  const isRoom = bot.kind === "room";
  const voiceOk = canCall() && !isRoom;
  const canSend = (text.length > 0 || ready.length > 0) && !uploading && !sending;

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const problem = attachFiles(bot.id, files);
    setError(problem);
    area.current?.focus();
  };

  const send = async () => {
    if (!canSend) return;
    const sent = ready;
    setSending(true);
    setError(null);
    try {
      const paths = sent.map((u) => u.attachment?.path).filter((p): p is string => !!p);
      const r = await api<{ row: Row }>("POST", `/bots/${bot.id}/messages`, paths.length ? { text, attachments: paths } : { text });
      addRows(bot.id, [r.row]);
      clearUploads(bot.id, sent.map((u) => u.id));
      if ((useStore.getState().drafts[bot.id] ?? "").trim() === text) setDraft(bot.id, "");
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await api("POST", `/bots/${bot.id}/stop`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setStopping(false);
    }
  };

  const newConversation = async () => {
    if (!confirmNew) {
      setConfirmNew(true);
      return;
    }
    setMenu(false);
    try {
      await resetConversation(bot.id);
      showToast(t("chat.started"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const micToggle = () => {
    if (dictation.state === "idle") dictation.start();
    else if (dictation.state === "recording") dictation.stop();
  };

  const micLabel = !canRecognize()
    ? t("composer.micUnsupported")
    : dictation.state === "recording"
      ? t("composer.micStop")
      : dictation.state === "transcribing"
        ? t("composer.micTranscribing")
        : t("composer.micStart");

  let action: { label: string; icon: "arrowUp" | "phoneOff" | "stop" | "wave"; run: () => void; disabled: boolean; cls: string };
  if (text || uploads.length > 0) action = { label: uploading ? t("composer.waitUploads") : t("composer.send"), icon: "arrowUp", run: () => void send(), disabled: !canSend, cls: "is-send" };
  else if (inCall) action = { label: t("composer.endCall"), icon: "phoneOff", run: endCall, disabled: false, cls: "is-end" };
  else if (live.running) action = { label: t("composer.stop"), icon: "stop", run: () => void stop(), disabled: stopping, cls: "is-stop" };
  else if (isRoom) action = { label: t("composer.send"), icon: "arrowUp", run: () => undefined, disabled: true, cls: "is-send" };
  else
    action = {
      label: voiceOk ? t("composer.startCall") : t("composer.voiceUnsupported"),
      icon: "wave",
      run: () => startCall(bot.id),
      disabled: !voiceOk,
      cls: "is-voice",
    };

  const placeholder = t("composer.placeholder", { name: botTitle(bot) });

  return (
    <div
      className={`composer-wrap ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {uploads.length > 0 && (
        <ul className="uploads" aria-label={t("composer.attachments")}>
          {uploads.map((u) => (
            <UploadChip key={u.id} upload={u} onRemove={() => removeUpload(bot.id, u.id)} />
          ))}
        </ul>
      )}
      <div className="composer">
        <div className="menu-wrap">
          <button type="button" className="icon-btn composer-plus" aria-label={t("composer.more")} title={t("composer.more")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <Icon name="plus" size={20} />
          </button>
          <Menu open={menu} onClose={() => setMenu(false)} side="top" label={t("composer.more")}>
            <MenuItem
              icon="clip"
              onClick={() => {
                setMenu(false);
                picker.current?.click();
              }}
            >
              {t("composer.attach")}
            </MenuItem>
            <MenuItem icon="edit" danger={confirmNew} onClick={() => void newConversation()}>
              {t(confirmNew ? "chat.confirmNew" : "chat.newConversation")}
            </MenuItem>
            <MenuItem
              icon="plug"
              onClick={() => {
                setMenu(false);
                openModal({ kind: "connectors" });
              }}
            >
              {t("sidebar.connectApps")}
            </MenuItem>
          </Menu>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        <textarea
          ref={area}
          className="composer-input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setDraft(bot.id, e.target.value)}
          onPaste={(e) => {
            // Pasted images (screenshots, copied pictures) become attachments; pasted text stays text.
            const files = Array.from(e.clipboardData.files);
            if (files.length === 0 || e.clipboardData.getData("text/plain")) return;
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className={`icon-btn composer-mic is-${dictation.state}`}
          aria-label={micLabel}
          title={micLabel}
          aria-pressed={dictation.state === "recording"}
          disabled={!canRecognize() || dictation.state === "transcribing" || inCall}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const wasIdle = dictation.state === "idle";
            pressStarted.current = { at: Date.now(), started: wasIdle };
            if (wasIdle) dictation.start();
          }}
          onPointerUp={() => {
            const p = pressStarted.current;
            pressStarted.current = null;
            if (!p) return;
            if (!p.started || Date.now() - p.at > 500) dictation.stop();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              micToggle();
            }
          }}
        >
          {dictation.state === "transcribing" ? <Spinner size={18} /> : <Icon name="mic" size={19} />}
        </button>
        <button type="button" className={`composer-action ${action.cls}`} aria-label={action.label} title={action.label} onClick={action.run} disabled={action.disabled}>
          <Icon name={action.icon} size={19} />
        </button>
      </div>
      {dragging && (
        <div className="composer-drop" aria-hidden="true">
          <Icon name="clip" size={18} /> {t("composer.drop")}
        </div>
      )}
    </div>
  );
}
