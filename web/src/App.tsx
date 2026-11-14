import { useEffect } from "react";
import { useT } from "./i18n";
import { errText } from "./api";
import { applyTheme, useStore, type Toast } from "./store";
import { AppSettings } from "./components/AppSettings";
import { BotSettings } from "./components/BotSettings";
import { ChatView } from "./components/ChatView";
import { ComputerViewer } from "./components/ComputerViewer";
import { HistoryViewer } from "./components/HistoryViewer";
import { DetailsPanel } from "./components/DetailsPanel";
import { ConnectorsModal, CreateBotModal, CreateRoomModal, SearchModal } from "./components/Modals";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { TasksView } from "./components/TasksView";
import { ThreadPanel } from "./components/ThreadPanel";

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const s = useStore.getState();
      if (s.boot !== "ready" || s.viewerBotId || s.history) return;
      const key = e.key.toLowerCase();
      const comma = e.code === "Comma" || key === "," || key === "<";
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        s.openModal(s.modal?.kind === "search" ? null : { kind: "search" });
      } else if (key === "b" && !e.shiftKey) {
        e.preventDefault();
        s.toggleSidebar();
      } else if (comma && e.shiftKey) {
        e.preventDefault();
        if (s.view === "chat" && s.selectedId) s.toggleDetails();
      } else if (comma) {
        e.preventDefault();
        if (s.appSettings) s.closeAppSettings();
        else s.openAppSettings();
      } else if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        if (s.view !== "chat") s.setView("chat");
        s.focusComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useSystemTheme(): void {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}

/** The live region stays mounted so screen readers announce each new toast. */
function ToastView({ toast }: { toast: Toast | null }) {
  const { dismissToast, showToast } = useStore.getState();
  const action = toast?.action;
  return (
    <div className={`toast ${toast ? "" : "is-empty"} ${action ? "has-action" : ""}`} role="status" aria-live="polite">
      {toast && <span className="toast-text">{toast.text}</span>}
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            dismissToast();
            Promise.resolve()
              .then(() => action.run())
              .catch((e: unknown) => showToast(errText(e)));
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function Shell() {
  const view = useStore((s) => s.view);
  const hasBot = useStore((s) => !!(s.selectedId && s.bots[s.selectedId]));
  const detailsOpen = useStore((s) => s.detailsOpen);
  const modal = useStore((s) => s.modal);
  const botSettings = useStore((s) => s.botSettings);
  const appSettings = useStore((s) => s.appSettings);
  const viewerBotId = useStore((s) => s.viewerBotId);
  const toast = useStore((s) => s.toast);
  const history = useStore((s) => s.history);
  const openModal = useStore((s) => s.openModal);
  const close = () => openModal(null);
  const openThread = useStore((s) => (s.openThread && s.openThread.botId === s.selectedId ? s.openThread : null));
  const showThread = view === "chat" && hasBot && !!openThread;
  const showDetails = view === "chat" && hasBot && detailsOpen && !showThread;

  return (
    <div className={`shell ${showDetails || showThread ? "has-details" : ""}`}>
      <Sidebar />
      {view === "tasks" ? <TasksView /> : <ChatView />}
      {showDetails && <DetailsPanel />}
      {showThread && openThread && <ThreadPanel key={`${openThread.botId}:${openThread.seq}`} botId={openThread.botId} seq={openThread.seq} />}

      {appSettings && <AppSettings section={appSettings} />}
      {botSettings && <BotSettings botId={botSettings.botId} tab={botSettings.tab} />}
      {modal?.kind === "createBot" && <CreateBotModal onClose={close} />}
      {modal?.kind === "createRoom" && <CreateRoomModal onClose={close} />}
      {modal?.kind === "search" && <SearchModal onClose={close} />}
      {modal?.kind === "connectors" && <ConnectorsModal key={modal.prefill ? `${modal.prefill.botId}:${modal.prefill.seq}` : "all"} onClose={close} prefill={modal.prefill} />}
      {viewerBotId && <ComputerViewer key={viewerBotId} botId={viewerBotId} />}

      {history && <HistoryViewer key={`${history.botId}:${history.generation}:${history.seq}`} target={history} />}

      <ToastView toast={toast} />
    </div>
  );
}

export function App() {
  const boot = useStore((s) => s.boot);
  const init = useStore((s) => s.init);
  const t = useT();
  useEffect(() => {
    void init();
  }, [init]);
  useShortcuts();
  useSystemTheme();

  if (boot === "loading") return <div className="boot" aria-busy="true" aria-label={t("common.loading")} />;
  if (boot === "signedOut") return <SignIn />;
  return <Shell />;
}
