/**
 * The gallery's « chat » page (section=chat): the real app shell — sidebar (a drawer on a phone), chat header, transcript,
 * composer, thread panel — on a fake conversation (fixtures.ts chatRows), at the page's real size, so phone layouts
 * (390 px, iOS safe areas) can be looked at and checked (web/scripts/responsive-check.mjs).
 *
 *   ?dev=gallery&section=chat              the chat
 *   &panel=thread                          with the thread panel open
 *   &nav=1                                 with the phone drawer open
 *   &running=1                             the bot still at work (thinking block, Stop button)
 */
import { useEffect } from "react";
import { useStore } from "../store";
import { DEFAULT_CHARACTER, type Bot, type Live } from "../types";
import { ChatView } from "../components/ChatView";
import { Sidebar } from "../components/Sidebar";
import { ThreadPanel } from "../components/ThreadPanel";
import { chatRows, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";

export function chatBot(o: FixtureOptions): Bot {
  return {
    id: GALLERY_BOT_ID, kind: "agent", name: o.long ? "jiren le très grand organisateur" : "jiren", label: o.long ? (o.lang === "fr" ? "maître des campagnes et des rapports" : "master of campaigns and reports") : o.lang === "fr" ? "maître" : "master", description: "", instructions: "",
    shape: "circle", color: "indigo", pause: null, access: null, primary: true, mode: "personal", model: "codex:default",
    character: { ...DEFAULT_CHARACTER }, generation: 1, disabledTools: [], voice: { lang: "auto" },
  } as unknown as Bot;
}

export function GalleryChat({ o }: { o: FixtureOptions }) {
  const p = new URLSearchParams(location.search);
  const panel = p.get("panel");
  const running = p.get("running") === "1";
  const rows = chatRows(o);
  const parent = rows.find((r) => r.body.kind === "message" && r.body.replies);
  useEffect(() => {
    const bot = chatBot(o);
    const live: Live = running ? { running: true, activity: { kind: "thinking", since: NOW - 40_000 }, awaiting: null, startedAt: NOW - 40_000, queued: 0, steps: 2 } : { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    useStore.setState({
      bots: { [bot.id]: bot }, selectedId: bot.id, view: "chat", detailsOpen: false, boot: "ready",
      mobileNav: p.get("nav") === "1",
      threads: { [bot.id]: { generation: 1, rows, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null } },
      live: { [bot.id]: live },
      openThread: panel === "thread" && parent ? { botId: bot.id, seq: parent.seq } : null,
    } as never);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openThread = useStore((s) => s.openThread);
  const ready = useStore((s) => s.selectedId === GALLERY_BOT_ID && !!s.threads[GALLERY_BOT_ID]);
  if (!ready) return null;
  return (
    <div className={`shell gallery-app ${openThread ? "has-details" : ""}`}>
      <Sidebar />
      <ChatView />
      {openThread && <ThreadPanel key={openThread.seq} botId={openThread.botId} seq={openThread.seq} />}
    </div>
  );
}
