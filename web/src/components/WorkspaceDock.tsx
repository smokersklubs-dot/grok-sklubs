import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import { useScreen } from "../lib/screen";
import { ArtifactPanel } from "./ArtifactPanel";
import { SignInSite } from "./SignInSite";
import { Icon } from "./Icon";
import { ErrorNote } from "./ui";

type Tab = NonNullable<ReturnType<typeof useStore.getState>["artifact"]>;
interface Page {
  url: string;
  title: string;
  text: string;
  links: { url: string; label: string }[];
}
function Reader({ bot, fr }: { bot: string; fr: boolean }) {
  const [url, setUrl] = useState(""),
    [history, setHistory] = useState<Page[]>([]),
    [index, setIndex] = useState(-1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const page = history[index],
    sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function go(raw: string) {
    const id = ++sequence.current;
    setError("");
    setBusy(true);
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw Error("URL");
      const r = await api<Page>("POST", "/workspace/web/read", { url: u.href });
      if (sequence.current === id) {
        const next = [...history.slice(0, index + 1), r].slice(-20);
        setHistory(next);
        setIndex(next.length - 1);
        setUrl(r.url);
      }
    } catch (e) {
      if (sequence.current === id) setError(errText(e));
    } finally {
      if (sequence.current === id) setBusy(false);
    }
  }
  const nav = (n: number) => {
    setIndex(n);
    setUrl(history[n].url);
    setError("");
  };
  return (
    <section className="dock-reader">
      <form
        className="studio-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void go(url.trim());
        }}
      >
        <button
          type="button"
          className="btn btn-small"
          aria-label={fr ? "Précédent" : "Back"}
          disabled={busy || index < 1}
          onClick={() => nav(index - 1)}
        >
          ←
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-label={fr ? "Suivant" : "Forward"}
          disabled={busy || index >= history.length - 1}
          onClick={() => nav(index + 1)}
        >
          →
        </button>
        <input
          className="input"
          aria-label="URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoCapitalize="off"
        />
        <button className="btn btn-small" disabled={busy || !url.trim()}>
          {busy ? "…" : fr ? "Lire" : "Read"}
        </button>
      </form>
      <SignInSite botId={bot} name={useStore.getState().bots[bot]?.name ?? ""} />
      <ErrorNote>{error}</ErrorNote>
      {page && (
        <article>
          <h3>{page.title}</h3>
          <a href={page.url} target="_blank" rel="noopener noreferrer">
            {fr ? "Ouvrir le site original" : "Open original site"}
          </a>
          <p>{page.text}</p>
          {page.links.map((l) => (
            <button className="btn btn-small" key={l.url} disabled={busy} onClick={() => void go(l.url)}>
              {l.label}
            </button>
          ))}
        </article>
      )}
    </section>
  );
}
function Desktop({ bot, active, fr }: { bot: string; active: boolean; fr: boolean }) {
  const shot = useScreen(bot, 1800, active),
    open = useStore((s) => s.openViewer);
  return (
    <section className="dock-reader">
      {shot.url && <img className="dock-screen" src={shot.url} alt={fr ? "Bureau du bot" : "Bot desktop"} />}
      <div className="studio-actions">
        <button className="btn" onClick={() => open(bot)}>
          {fr ? "Ouvrir le bureau" : "Open desktop"}
        </button>
        <button className="btn" onClick={() => open(bot, { control: true })}>
          {fr ? "Prendre la main" : "Take control"}
        </button>
      </div>
      <SignInSite botId={bot} name={useStore.getState().bots[bot]?.name ?? ""} />
    </section>
  );
}
export function WorkspaceDock({ active }: { active: Tab }) {
  const all = useStore((s) => s.artifactTabs),
    show = useStore((s) => s.showArtifact),
    fr = useStore((s) => s.locale === "fr"),
    tabs = all.filter((t) => t.botId === active.botId);
  const open = (kind: "web" | "desktop") =>
    show({
      botId: active.botId,
      token: kind === "web" ? crypto.randomUUID() : "desktop-" + active.botId,
      title: kind === "web" ? "Web" : fr ? "Bureau" : "Desktop",
      kind,
    });
  return (
    <aside className="artifact-dock" aria-label={fr ? "Espace de travail" : "Workspace"}>
      <div className="dock-bar">
        <div role="tablist" className="dock-tabs">
          {tabs.map((t, i) => (
            <button
              role="tab"
              id={"tab-" + t.token}
              aria-controls={"pane-" + t.token}
              aria-selected={t.token === active.token}
              className="btn btn-small"
              key={t.token}
              onClick={() => show(t)}
              onKeyDown={(e) => {
                const n =
                  e.key === "ArrowRight"
                    ? (i + 1) % tabs.length
                    : e.key === "ArrowLeft"
                      ? (i + tabs.length - 1) % tabs.length
                      : -1;
                if (n >= 0) {
                  e.preventDefault();
                  show(tabs[n]);
                  document.getElementById("tab-" + tabs[n].token)?.focus();
                }
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
        <button
          className="btn btn-small"
          title={fr ? "Nouvel onglet web" : "New web tab"}
          aria-label={fr ? "Nouvel onglet web" : "New web tab"}
          onClick={() => open("web")}
        >
          <Icon name="globe" size={15} />
        </button>
        {!useStore.getState().bots[active.botId]?.access && (
          <button
            className="btn btn-small"
            aria-label={fr ? "Onglet bureau" : "Desktop tab"}
            onClick={() => open("desktop")}
          >
            <Icon name="monitor" size={15} />
          </button>
        )}
        <button
          className="btn btn-small"
          aria-label={fr ? "Fermer l’onglet actif" : "Close active tab"}
          onClick={() => show(null)}
        >
          <Icon name="close" size={15} />
        </button>
      </div>
      {tabs.map((t) => (
        <div
          role="tabpanel"
          aria-labelledby={"tab-" + t.token}
          id={"pane-" + t.token}
          className="dock-pane"
          hidden={t.token !== active.token}
          key={t.token}
        >
          {t.kind === "web" ? (
            <Reader bot={t.botId} fr={fr} />
          ) : t.kind === "desktop" ? (
            <Desktop bot={t.botId} active={t.token === active.token} fr={fr} />
          ) : (
            <ArtifactPanel {...t} />
          )}
        </div>
      ))}
    </aside>
  );
}
