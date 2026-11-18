import { lazy, Suspense, useEffect, useState } from "react";
import { useT } from "./i18n";
import { errText } from "./api";
import { applyTheme, useStore, type Toast } from "./store";
import { AppSettings } from "./components/AppSettings";
import { BotSettings } from "./components/BotSettings";
import { ChatView } from "./components/ChatView";
import { ComputerViewer } from "./components/ComputerViewer";
import { RelayViewer } from "./components/MyComputer";
import { HistoryViewer } from "./components/HistoryViewer";
import { DetailsPanel } from "./components/DetailsPanel";
import { ConnectorsModal, CreateBotModal, CreateRoomModal } from "./components/Modals";
import { CommandPalette } from "./components/CommandPalette";
import { DuplicateBotModal } from "./components/DuplicateBotModal";
import { ExportTemplateModal, TemplatesModal } from "./components/TeamTemplates";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { EmailConfirmPage, ResetPasswordPage, takeLinkAction } from "./components/AccountRecovery";
import { TasksView } from "./components/TasksView";
import { TodayView } from "./components/TodayView";
import { SurveillanceView } from "./components/SurveillanceView";
import { AnnouncementsView } from "./components/AnnouncementsView";
import { SiteAnnouncementBanner } from "./components/AnnouncementCard";
import { useAnnouncements } from "./lib/announcements";
import { ThreadPanel } from "./components/ThreadPanel";
import { isDownloadPath } from "./lib/platform";
import { useDesktopBadge } from "./lib/desktop";
import { takeVerifyLink, VerifyEmailGate, VerifyEmailPage } from "./components/VerifyEmail";
import { Onboarding } from "./components/Onboarding";
import { EmailLinkPage, GoogleSignupPage, takeEmailLink, takeGoogleSignup } from "./components/AuthLinks";

// The public landing page (OPEN_SIGNUP): its own chunk, loaded only for signed-out visitors of an open server.
const Landing = lazy(() => import("./components/Landing"));
// The public download page (/telecharger): its own chunk too, it shares the landing page's styles and videos.
const DownloadPage = lazy(() => import("./components/DownloadPage"));
type Entry = "landing" | "login" | "signup";
/** Where a signed-out visitor starts: ?auth=login|signup, or a link that needs the form (invitation, plan, expired link). */
function entryFromUrl(): Entry {
  const p = new URLSearchParams(location.search);
  const auth = p.get("auth");
  if (auth === "login" || auth === "signup") return auth;
  if (p.get("invite") || p.get("plan_invite")) return "signup";
  // ?second=1: back from Google, a sign-in link or a reset with two-factor on (the code is asked on the sign-in page).
  if (p.get("link") || p.get("plan") || p.get("second")) return p.get("plan") ? "signup" : "login";
  return "landing";
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const s = useStore.getState();
      if (s.boot !== "ready" || s.viewerBotId || s.relayViewerId || s.history) return;
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
  const relayViewerId = useStore((s) => s.relayViewerId);
  const toast = useStore((s) => s.toast);
  const history = useStore((s) => s.history);
  const sentinel = useStore((s) => s.sentinel);
  const author = useAnnouncements((s) => !!s.state?.canAuthor);
  const siteBanner = useAnnouncements((s) => !!s.state?.site);
  const openModal = useStore((s) => s.openModal);
  const close = () => openModal(null);
  const openThread = useStore((s) => (s.openThread && s.openThread.botId === s.selectedId ? s.openThread : null));
  const showThread = view === "chat" && hasBot && !!openThread;
  const showDetails = view === "chat" && hasBot && detailsOpen && !showThread;

  return (
    <div className={`shell ${showDetails || showThread ? "has-details" : ""} ${siteBanner ? "has-site-banner" : ""}`}>
      <SiteAnnouncementBanner />
      <Sidebar />
      {view === "tasks" ? <TasksView /> : view === "today" ? <TodayView /> : view === "surveillance" && sentinel ? <SurveillanceView /> : view === "announcements" && author ? <AnnouncementsView /> : <ChatView />}
      {showDetails && <DetailsPanel />}
      {showThread && openThread && <ThreadPanel key={`${openThread.botId}:${openThread.seq}`} botId={openThread.botId} seq={openThread.seq} />}

      {appSettings && <AppSettings section={appSettings} />}
      {botSettings && <BotSettings botId={botSettings.botId} tab={botSettings.tab} />}
      {modal?.kind === "createBot" && <CreateBotModal onClose={close} />}
      {modal?.kind === "createRoom" && <CreateRoomModal onClose={close} />}
      {modal?.kind === "search" && <CommandPalette onClose={close} />}
      {modal?.kind === "templates" && <TemplatesModal onClose={close} tab={modal.tab} />}
      {modal?.kind === "exportTemplate" && <ExportTemplateModal onClose={close} sectionId={modal.sectionId} botIds={modal.botIds} />}
      {modal?.kind === "duplicate" && <DuplicateBotModal key={modal.botId} botId={modal.botId} onClose={close} />}
      {modal?.kind === "connectors" && <ConnectorsModal key={modal.prefill ? `${modal.prefill.botId}:${modal.prefill.seq}` : "all"} onClose={close} prefill={modal.prefill} />}
      {viewerBotId && <ComputerViewer key={viewerBotId} botId={viewerBotId} />}
      {relayViewerId && <RelayViewer key={relayViewerId} deviceId={relayViewerId} />}

      {history && <HistoryViewer key={`${history.botId}:${history.generation}:${history.seq}`} target={history} />}

      <Onboarding />
      <ToastView toast={toast} />
    </div>
  );
}

export function App() {
  // /telecharger is public (linked from the sign-in page): no session needed, no app shell.
  if (isDownloadPath()) return <Suspense fallback={<div className="boot" aria-busy="true" />}><DownloadPage /></Suspense>;
  return <MainApp />;
}

function MainApp() {
  const boot = useStore((s) => s.boot);
  const init = useStore((s) => s.init);
  const t = useT();
  // A "forgot password" or change-of-address link (/?reset=… or /?email_change=…), read once and removed from the address.
  const [link, setLink] = useState(takeLinkAction);
  // The e-mail verification link (/?verify_email=…, publicsignup.ts), read once and removed from the address.
  const [verifyToken, setVerifyToken] = useState(takeVerifyLink);
  // "Recevoir un lien de connexion par e-mail" (/?email_link=…) and the step after Google for a new hosted account.
  const [emailLink, setEmailLink] = useState(takeEmailLink);
  const [googleSignup, setGoogleSignup] = useState(takeGoogleSignup);
  const landing = useStore((s) => s.publicSignup.landing);
  // Mandatory e-mail verification (server publicsignup.ts): an unconfirmed account sees only the confirmation page.
  const unverified = useStore((s) => !!s.user?.emailUnverified);
  const [entry, setEntry] = useState<Entry>(entryFromUrl);
  useEffect(() => {
    const onPop = () => setEntry(entryFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const goAuth = (mode: "login" | "signup", opts: { plan?: string } = {}) => {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("auth", mode);
    if (opts.plan) url.searchParams.set("plan", opts.plan);
    history.pushState(null, "", `${url.pathname}${url.search}`);
    setEntry(mode);
    window.scrollTo(0, 0);
  };
  const goHome = () => { history.pushState(null, "", "/"); setEntry("landing"); };
  useEffect(() => {
    void init();
  }, [init]);
  // Back from Stripe Checkout (/?credits=success|cancel, server credits.ts): Settings → Credits says how it went.
  useEffect(() => {
    const v = new URLSearchParams(location.search).get("credits");
    if (boot === "ready" && (v === "success" || v === "cancel")) useStore.getState().openAppSettings("subscription");
  }, [boot]);
  useShortcuts();
  useSystemTheme();
  useDesktopBadge();

  if (boot === "loading") return <div className="boot" aria-busy="true" aria-label={t("common.loading")} />;
  if (link?.kind === "reset") return <ResetPasswordPage token={link.token} onDone={() => setLink(null)} />;
  if (link?.kind === "emailChange") return <EmailConfirmPage token={link.token} />;
  if (verifyToken) return <VerifyEmailPage token={verifyToken} onDone={() => setVerifyToken(null)} />;
  if (emailLink) return <EmailLinkPage token={emailLink} onDone={() => setEmailLink(null)} />;
  if (googleSignup) return <GoogleSignupPage token={googleSignup} onDone={() => setGoogleSignup(null)} />;
  if (boot === "signedOut" && landing && entry === "landing") {
    return (
      <Suspense fallback={<div className="boot" aria-busy="true" aria-label={t("common.loading")} />}>
        <Landing onAuth={goAuth} />
      </Suspense>
    );
  }
  if (boot === "signedOut") return landing ? <SignIn key={entry} initialMode={entry === "signup" ? "signup" : "login"} onBack={goHome} /> : <SignIn />;
  if (unverified) return <VerifyEmailGate />;
  return <Shell />;
}
