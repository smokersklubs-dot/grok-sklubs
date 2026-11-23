/**
 * The gallery's « chat » page (section=chat): the real app shell — sidebar (a drawer on a phone), chat header, transcript,
 * composer, thread panel — on a fake conversation (fixtures.ts chatRows), at the page's real size, so phone layouts
 * (390 px, iOS safe areas) can be looked at and checked (web/scripts/responsive-check.mjs).
 *
 *   ?dev=gallery&section=chat              the chat
 *   &panel=thread                          with the thread panel open
 *   &nav=1                                 with the phone drawer open
 *   &running=1                             the bot still at work (thinking block, Stop button)
 *   &running=tasks                         three tasks at once (lanes): the header's « 3 tâches en cours » chip
 *   &listen=playing|paused|loading|browser|error   « Écouter »: the last reply in the player, in that state
 *                                          (with « Lire les réponses à voix haute » on: the header's mute button)
 *   &retired=1                             L150: the bot's model is no longer offered (greyed in the model menu)
 *   &math=1                                L136 / L147: a reply with formulas, a 30-line code block and a 16-row table
 *   &test=1                                L176: the store on window.__galleryStore, for the browser tests of the chat
 *                                          (web/scripts/chat-ui.test.mjs) to play server events into the real chat
 */
import { useEffect } from "react";
import { useStore } from "../store";
import { listenKey, useListen, type ListenStatus } from "../lib/listen";
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
  const running = p.get("running") === "1" || p.get("running") === "asked" || p.get("running") === "tasks";
  // running=asked: a request just sent, nothing done yet: the activity line shows its one-line summary (nod item 3).
  const asked = p.get("running") === "asked";
  const listenAs = p.get("listen");
  const base = chatRows(o);
  const last = base[base.length - 1];
  const rows: typeof base = asked && last ? [...base, { ...last, seq: last.seq + 1, thread: undefined, body: { kind: "message", role: "user", text: o.long ? "Peux-tu comparer les trois devis de plomberie reçus cette semaine et me dire lequel est le plus intéressant pour la salle de bains ?\nMerci" : "Résume mes mails de la semaine" } } as typeof last] : base;
  if (p.get("math") === "1" && last) rows.push({ ...last, seq: last.seq + 2, thread: undefined, body: { kind: "message", role: "assistant", text: mathReply(o) } } as typeof last); // L136 / L147
  const parent = rows.find((r) => r.body.kind === "message" && r.body.replies);
  useEffect(() => {
    const bot = { ...(listenAs ? { ...chatBot(o), voice: { name: "", rate: 1, lang: "auto", readAloud: true } } : chatBot(o)), ...(p.get("retired") === "1" ? { model: "anthropic:claude-3-opus-20240229" } : {}) } as Bot;
    if (listenAs) {
      // The last reply of the conversation, as the player shows it while it reads (no sound in the gallery).
      const last = [...rows].reverse().find((r) => !r.thread && r.body.kind === "message" && r.body.role === "assistant" && r.body.text.trim());
      const status = listenAs === "browser" ? "playing" : ((["playing", "paused", "loading", "error"].includes(listenAs) ? listenAs : "playing") as ListenStatus);
      if (last) useListen.setState({ key: listenKey(bot.id, last.seq), status, progress: status === "loading" ? 0 : 0.42, engine: listenAs === "browser" ? "browser" : "server", voice: listenAs === "browser" ? "" : "Camille", error: status === "error" ? (o.lang === "fr" ? "Le service de voix n'a pas répondu. Réessaie dans un instant." : "The voice service did not answer. Try again in a moment.") : null });
    }
    const live: Live = running ? { running: true, activity: { kind: "thinking", since: NOW - 40_000 }, awaiting: null, startedAt: NOW - 40_000, queued: asked ? 0 : 2, steps: asked ? 0 : 2 } : { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
    if (p.get("running") === "tasks") live.tasks = [
      { thread: 0, running: true, activity: live.activity, awaiting: null, startedAt: NOW - 40_000 },
      ...(parent ? [{ thread: parent.seq, running: true, activity: { kind: "browsing" as const, since: NOW - 90_000 }, awaiting: null, startedAt: NOW - 90_000 }] : []),
      { thread: 9999, running: true, activity: { kind: "waiting" as const, detail: o.lang === "fr" ? "Attend l'autre tâche" : "Waits for the other task", since: NOW - 5_000 }, awaiting: null, startedAt: NOW - 120_000 },
    ];
    useStore.setState({
      bots: { [bot.id]: bot }, selectedId: bot.id, view: "chat", detailsOpen: false, boot: "ready",
      mobileNav: p.get("nav") === "1",
      threads: { [bot.id]: { generation: 1, rows, loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null } },
      live: { [bot.id]: live },
      openThread: panel === "thread" && parent ? { botId: bot.id, seq: parent.seq } : null,
    } as never);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // L176: the chat's browser tests drive the real store (gallery only, development only).
  if (p.get("test") === "1") (window as unknown as { __galleryStore?: typeof useStore }).__galleryStore = useStore;
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

/** L136 / L147 in the gallery: inline and block formulas, money that stays text, a long code block and a long table. */
function mathReply(o: FixtureOptions): string {
  const fr = o.lang === "fr";
  const code = Array.from({ length: 30 }, (_, i) => `ligne_${i + 1} = calcule(${i + 1})  # ${fr ? "étape" : "step"} ${i + 1}`).join("\n");
  const table = ["| " + (fr ? "Mois | Coût" : "Month | Cost") + " |", "|---|---|", ...Array.from({ length: 16 }, (_, i) => `| ${i + 1} | ${(i * 3.5).toFixed(2)} $ |`)].join("\n");
  return [
    fr ? "La surface d'un disque de rayon $r$ vaut $A = \\pi r^2$ ; pour 5 $ et 10 $ rien ne change." : "A disc of radius $r$ has area $A = \\pi r^2$; with $5 and $10 nothing changes.",
    "$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$$",
    "```python\n" + code + "\n```",
    table,
  ].join("\n\n");
}
