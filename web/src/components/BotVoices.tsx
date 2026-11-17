import { useCallback, useEffect, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { BotVoiceRow, FishBulkProposal } from "../types";
import { Icon, Spinner } from "./Icon";
import { ErrorNote } from "./ui";
import { BotVoiceChangeModal, providerName, usePreview, useVT } from "./VoicePicker";

/**
 * Settings → Voice: "Bots' voices: automatic (free)". Every bot with the voice it speaks with in calls (its own choice,
 * or the free one given automatically — server/src/voice/autovoice.ts), "Listen" and "Change"; and, with a Fish Audio
 * key, "Give all my bots a Fish voice": a proposal first (free), samples on click, saved only on confirmation.
 */
export function BotVoicesSection({ serverMode }: { serverMode: boolean }) {
  const vt = useVT();
  const storeBots = useStore((s) => s.bots);
  const [rows, setRows] = useState<BotVoiceRow[] | null>(null);
  const [fishKey, setFishKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [proposals, setProposals] = useState<FishBulkProposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => {
    void api<{ bots: BotVoiceRow[]; fish: { hasKey: boolean } }>("GET", "/voice/bots").then((r) => { setRows(r.bots); setFishKey(r.fish.hasKey); }, (e) => setError(errText(e)));
  }, []);
  useEffect(load, [load]);
  // One sample at a time for the whole list; "Listen" without a voice id plays the bot's current voice.
  const [previewBot, setPreviewBot] = useState<string>("");
  const preview = usePreview(previewBot);
  const listen = (botId: string, provider: "fish" | "piper" | "kokoro", voiceId: string) => {
    setPreviewBot(botId);
    void preview.play(provider, voiceId, "", botId);
  };

  const propose = async () => {
    setBusy(true); setError(null); setDone(null); setProposals(null);
    try { setProposals((await api<{ proposals: FishBulkProposal[] }>("POST", "/voice/fish/bulk/propose")).proposals); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!proposals?.length) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ applied: number; bots: BotVoiceRow[] }>("POST", "/voice/fish/bulk/apply", { items: proposals.map((p) => ({ botId: p.botId, voiceId: p.voice.id, name: p.voice.title, author: p.voice.author, language: p.voice.languages[0] ?? "" })) });
      setRows(r.bots); setProposals(null); setDone(vt("fishAllDone", { n: r.applied }));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const changingBot = changing ? storeBots[changing] : null;
  return (
    <section className="bot-voices" aria-labelledby="bot-voices-h">
      <h3 id="bot-voices-h" className="pane-heading"><Icon name="volume" size={15} /> {vt("botsHeading")}</h3>
      <p className="muted small">{vt("botsIntro")}</p>
      {!serverMode && <p className="muted small" role="status">{vt("botsBrowser")}</p>}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <ErrorNote onDismiss={preview.clearError}>{preview.error}</ErrorNote>
      {!rows && !error && <Spinner />}
      {rows && !rows.length && <p className="muted">{vt("noBots")}</p>}
      {rows && rows.length > 0 && (
        <ul className="bot-voices-list">
          {rows.map((r) => (
            <li key={r.botId} className="bot-voices-item">
              <div className="bot-voices-main">
                <p className="bot-voices-name truncate">{r.name}</p>
                <p className="bot-voices-voice small">
                  <span className="truncate">{r.voiceName || vt("accountVoice", { provider: providerName(r.provider) })}</span>
                  {r.auto ? <span className="chip chip-soft">{vt("autoChip")}</span> : r.voiceName ? <span className="chip">{providerName(r.provider)}{r.provider === "piper" ? ` · ${vt("freeChip")}` : ""}</span> : null}
                  {r.gender && <span className="muted"> · {vt(r.gender)}</span>}
                </p>
              </div>
              <div className="bot-voices-actions">
                <button type="button" className="btn btn-small" disabled={!!preview.playing || !serverMode} onClick={() => listen(r.botId, r.provider === "fish" || r.provider === "kokoro" ? r.provider : "piper", r.auto ? "" : r.voiceId)} aria-label={`${vt("listen")} — ${r.name}`}>
                  <Icon name="play" size={12} /> {vt(preview.playing && previewBot === r.botId ? "listening" : "listen")}
                </button>
                <button type="button" className="btn btn-small" disabled={!storeBots[r.botId]} onClick={() => setChanging(r.botId)} aria-label={`${vt("changeShort")} — ${r.name}`}>{vt("changeShort")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {fishKey && (
        <div className="bot-voices-fish">
          <p className="muted small">{vt("fishAllIntro")} {vt("fishAllFiltered")}</p>
          {!proposals && <button type="button" className="btn btn-small" disabled={busy || !rows?.length} onClick={() => void propose()}><Icon name="wave" size={12} /> {vt("fishAll")}</button>}
          {busy && !proposals && <p className="muted small" role="status"><Spinner /> {vt("fishAllSearching")}</p>}
          {proposals && !proposals.length && <p className="muted small" role="status">{vt("fishAllNone")}</p>}
          {proposals && proposals.length > 0 && (
            <>
              <ul className="bot-voices-list">
                {proposals.map((p) => (
                  <li key={p.botId} className="bot-voices-item">
                    <div className="bot-voices-main">
                      <p className="bot-voices-name truncate">{p.botName}</p>
                      <p className="bot-voices-voice small"><span className="truncate">{p.voice.title || p.voice.id}</span>{p.voice.author ? <span className="muted"> · {vt("by", { author: p.voice.author })}</span> : null}</p>
                    </div>
                    <div className="bot-voices-actions">
                      <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => listen(p.botId, "fish", p.voice.id)} aria-label={`${vt("listen")} — ${p.botName}`}>
                        <Icon name="play" size={12} /> {vt(preview.playing === `fish:${p.voice.id}` ? "listening" : "listen")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="voice-rights small">{vt("rights")} {vt("cost")}</p>
              <div className="row-gap">
                <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={() => void apply()}>{vt("fishAllConfirm", { n: proposals.length })}</button>
                <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => setProposals(null)}>{vt("fishAllCancel")}</button>
              </div>
            </>
          )}
          {done && <p className="muted small" role="status">{done}</p>}
        </div>
      )}
      {changingBot && <BotVoiceChangeModal bot={changingBot} onClose={() => { preview.stop(); setChanging(null); }} onSaved={load} />}
    </section>
  );
}
