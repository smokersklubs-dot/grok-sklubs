import { useStore } from "../store";
import { t as tr } from "../i18n";
import { useScreen } from "../lib/screen";
import { ArtifactPanel } from "./ArtifactPanel";
import { SignInSite } from "./SignInSite";
import { Icon } from "./Icon";
import { WebWorkspace } from "./WebWorkspace";
import { ResearchPanel } from "./ResearchPanel";

type Tab = NonNullable<ReturnType<typeof useStore.getState>["artifact"]>;
function Desktop({ bot, active, fr }: { bot: string; active: boolean; fr: boolean }) {
  const shot = useScreen(bot, 1800, active),
    open = useStore((s) => s.openViewer);
  return (
    <section className="dock-reader">
      {shot.url && <img className="dock-screen" src={shot.url} alt={tr("webws.botDesktop")} />}
      <div className="studio-actions">
        <button className="btn" onClick={() => open(bot)}>
          {tr("webws.openDesktop")}
        </button>
        <button className="btn" onClick={() => open(bot, { control: true })}>
          {tr("viewer.take")}
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
      title: kind === "web" ? "Web" : tr("webws.desktop"),
      kind,
    });
  return (
    <aside className="artifact-dock" aria-label={tr("webws.workspace")}>
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
          title={tr("webws.newWebTab")}
          aria-label={tr("webws.newWebTab")}
          onClick={() => open("web")}
        >
          <Icon name="globe" size={15} />
        </button>
        {!useStore.getState().bots[active.botId]?.access && (
          <button
            className="btn btn-small"
            aria-label={tr("webws.desktopTab")}
            onClick={() => open("desktop")}
          >
            <Icon name="monitor" size={15} />
          </button>
        )}
        <button
          className="btn btn-small"
          aria-label={tr("webws.closeActiveTab")}
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
            <WebWorkspace bot={t.botId} fr={fr} initialUrl={t.url} />
          ) : t.kind === "research" ? (
            <ResearchPanel bot={t.botId} fr={fr} active={t.token === active.token} />
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
