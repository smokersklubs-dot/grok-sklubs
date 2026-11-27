/**
 * Gallery « reunion » (section=reunion): L177 « Envoyer le bot dans une réunion » on the real dialog, with its own fake
 * answers for /api/bots/:id/meeting-bots… (installed while the page is shown).
 *   (no view)     the form, one past meeting
 *   view=review   the review card the owner approves
 *   view=live     the bot is in a meeting (« Faire partir le bot »), past meetings below
 *   empty=1       nothing yet; long=1 long names and links
 */
import { useEffect, useState } from "react";
import { MeetingBotDialog, MeetingReviewCard, type MeetingInfo, type MeetingSessionView } from "../components/MeetingBotDialog";
import { NOW, type FixtureOptions } from "./fixtures";

export function meetingFixture(o: FixtureOptions, view: string | null, empty: boolean): MeetingInfo {
  const fr = o.lang === "fr";
  const bot = o.long ? "jiren le très grand organisateur" : "jiren";
  const name = fr ? `${bot} (assistant de Léa) — prend des notes` : `${bot} (Léa's assistant) — taking notes`;
  const s = (x: Partial<MeetingSessionView>): MeetingSessionView => ({ id: "mtg_" + Math.random().toString(36).slice(2), platform: "meet", url: "https://meet.google.com/abc-defg-hij", guestName: name, status: "ended", reason: "ended", maxMinutes: 60, allowPaid: false, transcriptFile: null, notesFile: null, createdAt: NOW - 86_400_000, startedAt: NOW - 86_400_000, endedAt: NOW - 84_000_000, ...x });
  const past = [
    s({ platform: "zoom", reason: "refused", notesFile: o.long ? "meetings/2026-11-24-14-02-zoom-a1b2c3-point-hebdomadaire-equipe-commerciale/notes.md" : "meetings/2026-11-24-14-02-zoom-a1b2c3/notes.md" }),
    s({ platform: "teams", status: "failed", reason: "login", createdAt: NOW - 3 * 86_400_000, startedAt: null }),
  ];
  const live = s({ platform: "jitsi", status: "live", reason: null, startedAt: NOW - 12 * 60_000, createdAt: NOW - 13 * 60_000, maxMinutes: 90 });
  return { available: true, sessions: empty ? [] : view === "live" ? [live, ...past] : past.slice(0, 1), settings: { maxMinutes: 60, words: empty ? [] : ["carton rouge"] }, defaults: { words: ["je refuse", "refus", "pas d'enregistrement", "pas de notes", "pas de bot", "bot dehors", "stop bot", "i refuse"], min: 5, max: 240 }, name };
}

export function GalleryMeetingBot({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const view = new URLSearchParams(location.search).get("view");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!/^\/api\/bots\/[^/]+\/meeting-bot/.test(url.pathname)) return real(input, init);
      const body = (x: unknown) => new Response(JSON.stringify(x), { headers: { "content-type": "application/json" } });
      if ((init?.method ?? "GET") === "GET") return body(meetingFixture(o, view, empty));
      return body({ ok: true });
    };
    setReady(true);
    return () => { window.fetch = real; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;
  if (view === "review") {
    const fx = meetingFixture(o, view, empty);
    const url = o.long ? "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ2ZTFmYTEtYjg4Ny00ZDg5LWE0ZjMtNmQ2ZWM5ZjA4YmE1%40thread.v2/0?context=%7b%22Tid%22%3a%22abc%22%7d" : "https://us02web.zoom.us/wc/81234567890/join?pwd=AbC12";
    return <div className="modal-gallery" style={{ maxWidth: 640, margin: "0 auto", padding: 16 }}><div className="mb-body" style={{ background: "var(--surface)", borderRadius: 14 }}>
      <MeetingReviewCard review={{ platform: o.long ? "teams" : "zoom", label: o.long ? "Microsoft Teams" : "Zoom", url, name: fx.name, maxMinutes: 45 }} allowPaid={o.long} busy={false} onSend={() => undefined} onBack={() => undefined} />
    </div></div>;
  }
  return <MeetingBotDialog botId="b_gallery" close={() => undefined} />;
}
