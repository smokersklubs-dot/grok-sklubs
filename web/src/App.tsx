import { useEffect } from "react";
import { useT } from "./i18n";
import { applyTheme, useStore } from "./store";
import { AppSettings } from "./components/AppSettings";
import { BotSettings } from "./components/BotSettings";
import { ChatView } from "./components/ChatView";
import { ComputerViewer } from "./components/ComputerViewer";
import { DetailsPanel } from "./components/DetailsPanel";
import { ConnectorsModal, CreateBotModal, CreateRoomModal, SearchModal } from "./components/Modals";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { TasksView } from "./components/TasksView";

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const s = useStore.getState();
      if (s.boot !== "ready" || s.viewerBotId) return;
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

function Shell() {
  const view = useStore((s) => s.view);
  const hasBot = useStore((s) => !!(s.selectedId && s.bots[s.selectedId]));
  const detailsOpen = useStore((s) => s.detailsOpen);
  const modal = useStore((s) => s.modal);
  const botSettings = useStore((s) => s.botSettings);
  const appSettings = useStore((s) => s.appSettings);
  const viewerBotId = useStore((s) => s.viewerBotId);
  const toast = useStore((s) => s.toast);
  const openModal = useStore((s) => s.openModal);
  const close = () => openModal(null);
  const showDetails = view === "chat" && hasBot && detailsOpen;

  return (
    <div className={`shell ${showDetails ? "has-details" : ""}`}>
      <Sidebar />
      {view === "tasks" ? <TasksView /> : <ChatView />}
      {showDetails && <DetailsPanel />}

      {appSettings && <AppSettings section={appSettings} />}
      {botSettings && <BotSettings botId={botSettings.botId} tab={botSettings.tab} />}
      {modal?.kind === "createBot" && <CreateBotModal onClose={close} />}
      {modal?.kind === "createRoom" && <CreateRoomModal onClose={close} />}
      {modal?.kind === "search" && <SearchModal onClose={close} />}
      {modal?.kind === "connectors" && <ConnectorsModal key={modal.prefill ? `${modal.prefill.botId}:${modal.prefill.seq}` : "all"} onClose={close} prefill={modal.prefill} />}
      {viewerBotId && <ComputerViewer key={viewerBotId} botId={viewerBotId} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
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
