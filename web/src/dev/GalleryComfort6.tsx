/**
 * Gallery « confort6 » (section=confort6): wave 6 UI comfort on the real components.
 *   (no view)        the app shell: sidebar with the « qui travaille » bar and stop-cause chips, the chat with the
 *                    « NOUVEAU » line and « Explique plus simplement » under the replies (the passage bar is opened by the
 *                    screenshot script, which selects words in a reply: web/scripts/shots-confort6.mjs)
 *   view=doctor      Settings → « Docteur » (OK / À corriger), owner view
 *   view=commands    Settings → Raccourcis → « Mes commandes / », and the `/` picker over the composer (slash=1)
 */
import { useEffect } from "react";
import { useStore } from "../store";
import type { Bot, Live } from "../types";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { DoctorSection } from "../components/DoctorSection";
import { PersonalCommandsSection } from "../components/ComposerSlash";
import { useNewMark } from "../lib/chatreading";
import { useStopCauses } from "../lib/stopcauses";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";
import { chatBot } from "./GalleryChat";

const fr = (o: FixtureOptions) => o.lang === "fr";

export function GalleryComfort6({ o }: { o: FixtureOptions }) {
  const p = new URLSearchParams(location.search);
  const view = p.get("view");
  useEffect(() => {
    const main = chatBot(o);
    const mk = (id: string, name: string, label: string, color: string, extra: Partial<Bot> = {}) => ({ ...main, id, name, label, color, primary: false, unread: 0, preview: "", lastActivityAt: NOW - 60_000, ...extra }) as Bot;
    const bots: Record<string, Bot> = {
      [main.id]: main,
      b_compta: mk("b_compta", o.long ? "Comptabilité et factures fournisseurs" : "Compta", fr(o) ? "factures" : "invoices", "green", { preview: fr(o) ? "Je rapproche les relevés…" : "Matching the statements…" }),
      b_veille: mk("b_veille", "Veille", fr(o) ? "actualités" : "news", "orange", { preview: fr(o) ? "J'ai lu 40 pages sur 60." : "I read 40 pages of 60." }),
      b_site: mk("b_site", fr(o) ? "Site web" : "Website", fr(o) ? "pages" : "pages", "pink", { preview: fr(o) ? "Le modèle a refusé la demande." : "The model refused the request." }),
      b_mail: mk("b_mail", "Mails", fr(o) ? "boîte" : "inbox", "blue", { preview: fr(o) ? "3 mails à trier ce matin." : "3 mails to sort this morning." }),
    };
    const idle: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    const work = (since: number): Live => ({ running: true, activity: { kind: "browsing", since }, awaiting: null, startedAt: since, queued: 0, steps: 3 });
    useStore.setState({
      bots, selectedId: main.id, view: "chat", detailsOpen: false, boot: "ready", mobileNav: p.get("nav") === "1",
      threads: { [main.id]: { generation: 1, rows: chatRows(o), loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null } },
      live: { [main.id]: idle, b_compta: work(NOW - 120_000), b_veille: idle, b_site: idle, b_mail: idle, b_x: work(NOW - 30_000) },
      openThread: null,
    } as never);
    // After the sidebar's first load of the chips (the fake API answers the same).
    setTimeout(() => useStopCauses.setState({ causes: {
      b_veille: { cause: "steps", text: fr(o) ? "J'ai atteint ma limite d'étapes. Appuie sur Continuer." : "I reached my step limit. Press Continue.", at: NOW },
      b_site: { cause: "error", text: fr(o) ? "Le modèle a refusé la demande." : "The model refused the request.", at: NOW },
      b_mail: { cause: "stopped", text: fr(o) ? "Arrêté." : "Stopped.", at: NOW },
    } }), 50);
    useNewMark.setState({ mark: { botId: main.id, count: 2 } });
    if (p.get("slash") === "1") useStore.getState().setDraft(main.id, "/");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = useStore((s) => s.selectedId === GALLERY_BOT_ID && !!s.threads[GALLERY_BOT_ID]);
  if (!ready) return null;
  if (view === "doctor" || view === "commands") {
    return (
      <div className="app-settings-content settings-pane" style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
        {view === "doctor" ? <DoctorSection /> : <PersonalCommandsSection />}
      </div>
    );
  }
  return (
    <div className="shell gallery-app">
      <Sidebar />
      <ChatView />
    </div>
  );
}

/** What the fake API answers for the wave 6 routes (fakeApi.ts). */
export function comfort6Get(path: string, o: FixtureOptions & { empty: boolean }): unknown | undefined {
  const F = fr(o);
  if (path === "/bots/stop-causes") return { causes: {} };
  if (path === "/me/commands") return { commands: o.empty ? [] : [
    { name: "bilan", text: F ? "Fais-moi le bilan de la semaine : ce qui est fait, ce qui reste, ce qui bloque." : "Give me this week's report: done, left, blocked." },
    { name: "mails", text: F ? "Résume mes mails non lus en 5 lignes, les urgents d'abord." : "Sum up my unread mail in 5 lines, urgent ones first." },
    { name: o.long ? "relance-factures-impayees-clients" : "relance", text: F ? "Prépare les relances des factures impayées de plus de 30 jours (sans les envoyer)." : "Draft reminders for invoices unpaid for over 30 days (do not send them)." },
  ], limits: { count: 30, name: 24, text: 2000 } };
  if (path === "/models") return { models: o.empty ? [] : [{ ref: "codex:default", provider: "Codex", model: "default", kind: "subscription" }], defaultRef: "codex:default" };
  if (path === "/doctor") {
    const f = (checkId: string, severity: string, title: string, scope: string, detail = "", remediation?: string) => ({ checkId, severity, title, detail, scope, ...(remediation ? { remediation } : {}) });
    const findings = o.empty
      ? [f("runtime.node", "ok", "doctor.node.ok", "install"), f("auth.session_secret", "ok", "doctor.secret.ok", "install"), f("net.https", "ok", "doctor.https.ok", "install"), f("account.two_factor", "ok", "doctor.twoFactor.ok", "account")]
      : [
          f("fs.env.perms_world_readable", "critical", "doctor.fs.envWorldReadable", "install", "doctor.fs.fileReadable.detail", "chmod 600 .env"),
          f("backup.recent", "warn", "doctor.backupOff", "install", "doctor.backupOff.detail"),
          f("account.two_factor", "warn", "doctor.twoFactor", "account", "doctor.twoFactor.detail"),
          f("data.encryption_key", "info", "doctor.dataKey", "install", "doctor.dataKey.detail"),
          f("runtime.node", "ok", "doctor.node.ok", "install"), f("auth.session_secret", "ok", "doctor.secret.ok", "install"), f("net.https", "ok", "doctor.https.ok", "install"),
          f("disk.free", "ok", "doctor.disk.ok", "install"), f("vault.health", "ok", "doctor.vault.ok", "account"),
        ];
    return { findings, summary: {}, install: true, node: "v22.13.0" };
  }
  return undefined;
}
