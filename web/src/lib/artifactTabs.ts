import type { Row } from "../types";
export interface ArtifactTab {
  token: string;
  title: string;
  botId: string;
  thread?: number;
  readOnly?: boolean;
  url?: string;
  kind?: "web" | "desktop";
}
export function changeTab(
  tabs: ArtifactTab[],
  current: ArtifactTab | null,
  open: ArtifactTab | null,
  botId: string | null,
) {
  if (open)
    return { artifact: open, artifactTabs: tabs.some((t) => t.token === open.token) ? tabs : [...tabs, open] };
  const remaining = tabs.filter((t) => t.token !== current?.token);
  return { artifactTabs: remaining, artifact: [...remaining].reverse().find((t) => t.botId === botId) ?? null };
}
export function newArtifact(rows: Row[], seen: Row[], botId: string): ArtifactTab | undefined {
  const row = [...rows]
    .reverse()
    .find(
      (r) =>
        r.body.kind === "message" &&
        r.body.page?.open &&
        r.createdAt >= Date.now() - 30000 &&
        !seen.some((old) => old.seq === r.seq),
    );
  if (row?.body.kind === "message" && row.body.page) return { ...row.body.page, botId, thread: row.thread };
}

export function handleArtifactRows(
  state: {
    view: string;
    selectedId: string | null;
    modal: unknown;
    threads: Record<string, { loaded: boolean; rows: Row[] }>;
    showArtifact: (tab: ArtifactTab) => void;
  },
  event: { botId: string; rows: Row[] },
  hidden: boolean,
) {
  const thread = state.threads[event.botId];
  if (hidden || state.view !== "chat" || state.selectedId !== event.botId || state.modal || !thread?.loaded) return;
  const tab = newArtifact(event.rows, thread.rows, event.botId);
  if (tab) state.showArtifact(tab);
}
