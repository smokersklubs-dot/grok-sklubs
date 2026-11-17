import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import { useLocale, type Locale } from "../i18n";
import { useStore } from "../store";
import type { Bot, BotVoiceChoice, BotVoiceRow, FishVoice, KokoroVoice, PiperVoiceInfo, VoiceStatus } from "../types";
import { Icon, Spinner } from "./Icon";
import { ErrorNote, Modal } from "./ui";
import "./VoicePicker.css";

/**
 * A voice per bot (server/src/voice/botvoice.ts): the bot's own voice, chosen from Fish Audio's public library (the
 * account's own key) or the self-hosted Kokoro. "Listen" generates a short sample in the bot's language on the server.
 * Strings are kept here (French and English) so this file stands on its own.
 */
const TX = {
  fr: {
    heading: "Voix du bot (appels serveur)",
    current: "Voix : {name}",
    by: "par {author}",
    accountDefault: "Voix par défaut du compte ({provider})",
    none: "Aucune voix serveur pour l'instant : le bot parle avec la voix par défaut du compte.",
    change: "Choisir une voix",
    reset: "Voix par défaut",
    listen: "Écouter",
    listening: "Lecture…",
    choose: "Choisir",
    chosen: "Choisie",
    pickTitle: "Choisir la voix de {name}",
    tabFish: "Fish Audio",
    tabKokoro: "Kokoro (gratuit)",
    search: "Chercher une voix (nom)",
    anyLang: "Toutes les langues",
    mine: "Mes voix",
    licensed: "Sous licence Fish Audio",
    paste: "Coller un identifiant de voix",
    pastePh: "Identifiant de voix Fish Audio",
    pastePhKokoro: "Ex. ff_siwis ou af_bella(2)+af_sky(1)",
    use: "Utiliser",
    more: "Voir plus",
    empty: "Aucune voix trouvée.",
    likes: "{n} j'aime",
    uses: "{n} utilisations",
    noKey: "Pour chercher dans la bibliothèque de Fish Audio, colle d'abord ta clé d'API Fish Audio dans Réglages → Voix.",
    openSettings: "Ouvrir Réglages → Voix",
    noKokoro: "Kokoro n'est pas installé sur ce serveur (profil « kokoro », voir le guide d'installation).",
    rights: "Les voix de Fish Audio appartiennent à leurs auteurs. En choisissant une voix, tu t'engages à respecter les conditions d'utilisation de Fish Audio et les droits de la voix (usage commercial, imitation d'une personne réelle…). Ne clone jamais la voix de quelqu'un sans son accord.",
    rightsKokoro: "Voix Kokoro-82M, sous licence Apache-2.0, servies par ton propre serveur : rien ne sort.",
    cost: "Chaque phrase lue par Fish Audio est facturée sur ton compte Fish Audio (gratuit avec le modèle s2.1-pro-free) et apparaît dans Usage.",
    female: "voix féminine",
    male: "voix masculine",
    mix: "Mélange de voix Kokoro",
    licensedChip: "sous licence",
    statusOff: "Les appels de ce bot passent par le navigateur : {reason}",
    providerFishStt: "Fish Audio (payant, ta clé)",
    providerFishTts: "Fish Audio (payant, ta clé)",
    providerKokoro: "Kokoro (auto-hébergé, gratuit)",
    fishKey: "Clé d'API Fish Audio",
    fishKeySaved: "Clé Fish Audio enregistrée (scellée) — tape pour remplacer",
    fishModel: "Modèle Fish Audio",
    fishModelFree: "s2.1-pro-free (gratuit)",
    fishVoicePh: "Identifiant de voix par défaut (facultatif)",
    kokoroUrlPh: "Adresse de Kokoro (vide = celle du serveur)",
    kokoroVoicePh: "Voix par défaut, ex. ff_siwis",
    hintFish: "API officielle de Fish Audio avec ta propre clé (fish.audio → API Keys). La clé est scellée sur le serveur et jamais renvoyée au navigateur. Choisis la voix de chaque bot dans ses réglages.",
    hintKokoro: "Kokoro tourne sur ton serveur (profil « kokoro »), sans clé ni coût. Choisis la voix de chaque bot dans ses réglages.",
    tabPiper: "Piper (gratuit)",
    rightsPiper: "Voix Piper libres (licences CC BY / CC BY-SA, usage commercial permis), servies par ton propre serveur : rien ne sort, rien n'est payé.",
    noPiper: "Les voix gratuites (Piper) ne tournent pas sur ce serveur pour l'instant.",
    autoVoice: "Voix : {name}",
    autoChip: "automatique · gratuite",
    freeChip: "gratuite",
    callWith: "Appeler {name}",
    hangUp: "Raccrocher",
    callVoice: "Appeler {name} — voix : {voice}",
    botsHeading: "Voix des bots : automatique (gratuite)",
    botsIntro: "Chaque bot parle avec sa propre voix, donnée automatiquement parmi les voix gratuites du serveur. Rien à régler ; change celle d'un bot si tu veux.",
    botsBrowser: "Les appels passent pour l'instant par la voix du navigateur : les voix des bots s'appliquent dès que la voix du serveur répond.",
    accountVoice: "voix du compte ({provider})",
    changeShort: "Changer",
    noBots: "Aucun bot pour l'instant.",
    fishAll: "Donner une voix Fish à tous mes bots",
    fishAllIntro: "Une voix Fish Audio populaire et différente pour chaque bot, dans sa langue. Rien n'est dépensé ni enregistré avant ta confirmation ; « Écouter » fabrique un court échantillon facturé sur ton compte Fish Audio.",
    fishAllSearching: "Recherche de voix dans la bibliothèque Fish Audio…",
    fishAllConfirm: "Confirmer ces {n} voix",
    fishAllCancel: "Annuler",
    fishAllDone: "{n} bot(s) parlent maintenant avec une voix Fish Audio.",
    fishAllNone: "Aucune voix à proposer : tes bots ont déjà une voix Fish Audio, ou la bibliothèque n'a rien trouvé.",
    fishAllFiltered: "Les voix qui imitent une personne réelle ou un personnage sont écartées.",
  },
  en: {
    heading: "Bot's voice (server calls)",
    current: "Voice: {name}",
    by: "by {author}",
    accountDefault: "Account's default voice ({provider})",
    none: "No server voice yet: the bot speaks with the account's default voice.",
    change: "Choose a voice",
    reset: "Default voice",
    listen: "Listen",
    listening: "Playing…",
    choose: "Choose",
    chosen: "Chosen",
    pickTitle: "Choose {name}'s voice",
    tabFish: "Fish Audio",
    tabKokoro: "Kokoro (free)",
    search: "Search a voice (name)",
    anyLang: "All languages",
    mine: "My voices",
    licensed: "Licensed by Fish Audio",
    paste: "Paste a voice id",
    pastePh: "Fish Audio voice id",
    pastePhKokoro: "E.g. ff_siwis or af_bella(2)+af_sky(1)",
    use: "Use",
    more: "Show more",
    empty: "No voice found.",
    likes: "{n} likes",
    uses: "{n} uses",
    noKey: "To search Fish Audio's library, first paste your Fish Audio API key in Settings → Voice.",
    openSettings: "Open Settings → Voice",
    noKokoro: "Kokoro is not installed on this server (profile \"kokoro\", see the installation guide).",
    rights: "Fish Audio voices belong to their authors. By choosing one you agree to respect Fish Audio's terms of use and the voice's rights (commercial use, imitating a real person…). Never clone someone's voice without their consent.",
    rightsKokoro: "Kokoro-82M voices, Apache-2.0 licensed, served by your own server: nothing leaves it.",
    cost: "Every sentence Fish Audio reads is billed to your Fish Audio account (free with the s2.1-pro-free model) and shows in Usage.",
    female: "female voice",
    male: "male voice",
    mix: "Kokoro voice mix",
    licensedChip: "licensed",
    statusOff: "This bot's calls use the browser: {reason}",
    providerFishStt: "Fish Audio (paid, your key)",
    providerFishTts: "Fish Audio (paid, your key)",
    providerKokoro: "Kokoro (self-hosted, free)",
    fishKey: "Fish Audio API key",
    fishKeySaved: "Fish Audio key saved (sealed) — type to replace",
    fishModel: "Fish Audio model",
    fishModelFree: "s2.1-pro-free (free)",
    fishVoicePh: "Default voice id (optional)",
    kokoroUrlPh: "Kokoro address (empty = the server's)",
    kokoroVoicePh: "Default voice, e.g. af_heart",
    hintFish: "Fish Audio's official API with your own key (fish.audio → API Keys). The key is sealed on the server and never sent back to the browser. Choose each bot's voice in its settings.",
    hintKokoro: "Kokoro runs on your server (profile \"kokoro\"), no key, no cost. Choose each bot's voice in its settings.",
    tabPiper: "Piper (free)",
    rightsPiper: "Free Piper voices (CC BY / CC BY-SA licences, commercial use allowed), served by your own server: nothing leaves it, nothing is paid.",
    noPiper: "The free voices (Piper) are not running on this server yet.",
    autoVoice: "Voice: {name}",
    autoChip: "automatic · free",
    freeChip: "free",
    callWith: "Call {name}",
    hangUp: "Hang up",
    callVoice: "Call {name} — voice: {voice}",
    botsHeading: "Bots' voices: automatic (free)",
    botsIntro: "Each bot speaks with its own voice, given automatically from the server's free voices. Nothing to set up; change a bot's voice if you like.",
    botsBrowser: "Calls use the browser's voice for now: the bots' voices apply as soon as the server's voice answers.",
    accountVoice: "account's voice ({provider})",
    changeShort: "Change",
    noBots: "No bot yet.",
    fishAll: "Give all my bots a Fish voice",
    fishAllIntro: "A popular, different Fish Audio voice for each bot, in its language. Nothing is spent or saved before you confirm; \"Listen\" makes a short sample billed to your Fish Audio account.",
    fishAllSearching: "Searching Fish Audio's library…",
    fishAllConfirm: "Confirm these {n} voices",
    fishAllCancel: "Cancel",
    fishAllDone: "{n} bot(s) now speak with a Fish Audio voice.",
    fishAllNone: "No voice to propose: your bots already have a Fish Audio voice, or the library found nothing.",
    fishAllFiltered: "Voices imitating a real person or a character are left out.",
  },
} as const;
export type VoiceText = keyof typeof TX.fr;
export function useVT() {
  const loc: Locale = useLocale();
  return (k: VoiceText, vars?: Record<string, string | number>) => {
    const s: string = (TX[loc] ?? TX.en)[k] ?? TX.en[k];
    return vars ? s.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : s;
  };
}

const LANGS = ["fr", "en", "es", "de", "it", "pt", "ja", "zh", "ko", "ar", "hi", "ru", "nl", "pl"];

interface ChoiceInfo { choice: BotVoiceChoice | null; account: { provider: string; voice: string }; fish: { hasKey: boolean }; kokoro: { available: boolean }; piper?: { available: boolean }; current?: BotVoiceRow; status: VoiceStatus }
export type VoiceProvider = "fish" | "kokoro" | "piper";
export const providerName = (p: string) => (p === "fish" ? "Fish Audio" : p === "kokoro" ? "Kokoro" : p === "piper" ? "Piper" : p);

/** Plays the server-made sample of a voice (blob URL: the app's CSP allows blob: media). One at a time. */
export function usePreview(botId: string) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stop = useCallback(() => { audio.current?.pause(); audio.current = null; setPlaying(null); }, []);
  useEffect(() => stop, [stop]);
  const play = async (provider: VoiceProvider, voiceId: string, language = "", forBot = botId) => {
    stop();
    setError(null);
    setPlaying(`${provider}:${voiceId}`);
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(forBot)}/voice/preview`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, voiceId, language }) });
      if (!res.ok) { const j = await res.json().catch(() => null) as { error?: string } | null; throw new Error(j?.error ?? `HTTP ${res.status}`); }
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      audio.current = a;
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); if (audio.current === a) { audio.current = null; setPlaying(null); } };
      await a.play();
    } catch (e) { setPlaying(null); setError(e instanceof Error ? e.message : String(e)); }
  };
  return { playing, error, play, stop, clearError: () => setError(null) };
}

/** Under the bot's voice settings (details panel): its own voice, or the account's default, and the picker. */
export function BotVoicePicker({ bot, onChanged }: { bot: Bot; onChanged?: () => void }) {
  const vt = useVT();
  const [info, setInfo] = useState<ChoiceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const preview = usePreview(bot.id);
  const load = useCallback(() => { void api<ChoiceInfo>("GET", `/bots/${bot.id}/voice/choice`).then(setInfo, (e) => setError(errText(e))); }, [bot.id]);
  useEffect(load, [load]);
  const save = async (body: Record<string, unknown>) => {
    setError(null);
    try { await api("PUT", `/bots/${bot.id}/voice/choice`, body); load(); setOpen(false); onChanged?.(); } catch (e) { setError(errText(e)); }
  };
  if (!info) return error ? <ErrorNote>{error}</ErrorNote> : null;
  const c = info.choice;
  return (
    <div className="bot-voice">
      <p className="field-label">{vt("heading")}</p>
      <div className="bot-voice-current">
        <Icon name="volume" size={14} />
        <span>
          {c ? <>{vt("current", { name: c.name || c.voiceId })} <span className="chip">{providerName(c.provider)}</span>{c.author ? <span className="muted small"> · {vt("by", { author: c.author })}</span> : null}</>
            : info.current?.auto ? <>{vt("autoVoice", { name: info.current.voiceName })} <span className="chip chip-soft">{vt("autoChip")}</span>{info.current.gender ? <span className="muted small"> · {vt(info.current.gender)}</span> : null}</>
            : info.account.provider === "fish" || info.account.provider === "kokoro" || info.account.provider === "piper" || info.account.provider === "openai" ? vt("accountDefault", { provider: info.account.provider }) : vt("none")}
        </span>
      </div>
      {info.status.mode !== "server" && <p className="muted small">{vt("statusOff", { reason: info.status.reason })}</p>}
      <div className="row-gap">
        <button type="button" className="btn btn-small" onClick={() => setOpen(true)}><Icon name="search" size={12} /> {vt("change")}</button>
        {c ? <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => void preview.play(c.provider, c.voiceId, c.language)}><Icon name="play" size={12} /> {vt(preview.playing ? "listening" : "listen")}</button>
          : info.current?.auto && info.status.mode === "server" ? <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => void preview.play("piper", "")}><Icon name="play" size={12} /> {vt(preview.playing ? "listening" : "listen")}</button> : null}
        {c && <button type="button" className="btn btn-small btn-ghost" onClick={() => void save({ voiceId: null })}>{vt("reset")}</button>}
      </div>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <ErrorNote onDismiss={preview.clearError}>{preview.error}</ErrorNote>
      {open && <VoicePickerModal bot={bot} info={info} onClose={() => { preview.stop(); setOpen(false); }} onPick={(b) => void save(b)} />}
    </div>
  );
}

/** "Change" from Settings → Voice: the same picker, loaded for that bot, saved on pick. */
export function BotVoiceChangeModal({ bot, onClose, onSaved }: { bot: Bot; onClose: () => void; onSaved: () => void }) {
  const [info, setInfo] = useState<ChoiceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<ChoiceInfo>("GET", `/bots/${bot.id}/voice/choice`).then(setInfo, (e) => setError(errText(e))); }, [bot.id]);
  if (!info) return error ? <Modal title={bot.name} onClose={onClose}><div className="modal-body"><ErrorNote>{error}</ErrorNote></div></Modal> : null;
  const save = async (body: Record<string, unknown>) => {
    try { await api("PUT", `/bots/${bot.id}/voice/choice`, body); onSaved(); onClose(); } catch (e) { setError(errText(e)); }
  };
  return (
    <>
      <VoicePickerModal bot={bot} info={info} onClose={onClose} onPick={(b) => void save(b)} />
      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
    </>
  );
}

function VoicePickerModal({ bot, info, onClose, onPick }: { bot: Bot; info: ChoiceInfo; onClose: () => void; onPick: (body: Record<string, unknown>) => void }) {
  const vt = useVT();
  const [tab, setTab] = useState<VoiceProvider>(info.choice?.provider ?? (info.piper?.available ? "piper" : info.fish.hasKey || !info.kokoro.available ? "fish" : "kokoro"));
  const preview = usePreview(bot.id);
  const botLang = bot.voice.lang && bot.voice.lang !== "auto" ? bot.voice.lang.slice(0, 2).toLowerCase() : "";
  return (
    <Modal title={vt("pickTitle", { name: bot.name })} onClose={onClose} size="lg" className="voice-picker">
      <div className="modal-body">
        <div className="voice-tabs" role="tablist">
          {(["piper", "fish", "kokoro"] as const).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={tab === p} className={`voice-tab${tab === p ? " is-on" : ""}`} onClick={() => { preview.stop(); setTab(p); }}>{vt(p === "fish" ? "tabFish" : p === "piper" ? "tabPiper" : "tabKokoro")}</button>
          ))}
        </div>
        {tab === "fish"
          ? <FishTab bot={bot} info={info} botLang={botLang} preview={preview} onPick={onPick} />
          : tab === "piper" ? <PiperTab info={info} botLang={botLang} preview={preview} onPick={onPick} />
          : <KokoroTab info={info} botLang={botLang} preview={preview} onPick={onPick} />}
        <ErrorNote onDismiss={preview.clearError}>{preview.error}</ErrorNote>
      </div>
    </Modal>
  );
}

type Preview = ReturnType<typeof usePreview>;

function FishTab({ bot, info, botLang, preview, onPick }: { bot: Bot; info: ChoiceInfo; botLang: string; preview: Preview; onPick: (b: Record<string, unknown>) => void }) {
  const vt = useVT();
  const [q, setQ] = useState("");
  const [lang, setLang] = useState(botLang);
  const [mine, setMine] = useState(false);
  const [licensed, setLicensed] = useState(false);
  const [items, setItems] = useState<FishVoice[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const search = useCallback(async (p: number) => {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ q, language: lang, page: String(p), ...(mine ? { self: "1" } : {}), ...(licensed ? { licensed: "1" } : {}) });
      const r = await api<{ items: FishVoice[]; hasMore: boolean }>("GET", `/voice/fish/voices?${params}`);
      setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items])); setHasMore(r.hasMore); setPage(p);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }, [q, lang, mine, licensed]);
  // Searches while typing, a moment after the last key (the server caches the answers briefly too).
  useEffect(() => { if (!info.fish.hasKey) return; const h = setTimeout(() => void search(1), 350); return () => clearTimeout(h); }, [search, info.fish.hasKey]);
  const usePasted = async () => {
    setError(null);
    try {
      const r = await api<{ voice: FishVoice }>("GET", `/voice/fish/voice?id=${encodeURIComponent(pasted.trim())}`);
      onPick({ provider: "fish", voiceId: r.voice.id, name: r.voice.title, author: r.voice.author, language: botLang });
    } catch (e) { setError(errText(e)); }
  };
  if (!info.fish.hasKey) {
    return (
      <div className="voice-empty">
        <p>{vt("noKey")}</p>
        <button type="button" className="btn btn-small" onClick={() => useStore.getState().openAppSettings("voice")}><Icon name="settings" size={12} /> {vt("openSettings")}</button>
      </div>
    );
  }
  const chosen = info.choice?.provider === "fish" ? info.choice.voiceId : "";
  return (
    <>
      <div className="voice-filters">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={vt("search")} aria-label={vt("search")} />
        <select className="input input-small" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={vt("anyLang")}>
          <option value="">{vt("anyLang")}</option>
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className="voice-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {vt("mine")}</label>
        <label className="voice-check"><input type="checkbox" checked={licensed} disabled={mine} onChange={(e) => setLicensed(e.target.checked)} /> {vt("licensed")}</label>
      </div>
      <p className="voice-rights small">{vt("rights")} {vt("cost")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      <ul className="voice-list" aria-busy={busy}>
        {items.map((v) => (
          <li key={v.id} className={`voice-item${v.id === chosen ? " is-chosen" : ""}`}>
            <div className="voice-item-main">
              <p className="voice-item-title">{v.title || v.id}{v.licensed ? <span className="chip" title={vt("licensed")}><Icon name="shield" size={11} /> {vt("licensedChip")}</span> : null}</p>
              {v.author && <p className="muted small">{vt("by", { author: v.author })}</p>}
              {v.description && <p className="voice-item-desc small">{v.description}</p>}
              <p className="voice-item-meta">
                {v.languages.map((l) => <span key={`l${l}`} className="chip">{l}</span>)}
                {v.tags.slice(0, 5).map((tg) => <span key={`t${tg}`} className="chip chip-soft">{tg}</span>)}
                <span className="muted small">♥ {vt("likes", { n: v.likes })}</span>
              </p>
            </div>
            <div className="voice-item-actions">
              <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => void preview.play("fish", v.id, lang)}>
                <Icon name="play" size={12} /> {vt(preview.playing === `fish:${v.id}` ? "listening" : "listen")}
              </button>
              <button type="button" className="btn btn-small btn-primary" disabled={v.id === chosen} onClick={() => onPick({ provider: "fish", voiceId: v.id, name: v.title, author: v.author, language: lang || botLang })}>
                {vt(v.id === chosen ? "chosen" : "choose")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {busy && <Spinner />}
      {!busy && !items.length && !error && <p className="muted">{vt("empty")}</p>}
      {hasMore && !busy && <button type="button" className="btn btn-small btn-ghost" onClick={() => void search(page + 1)}>{vt("more")}</button>}
      <div className="voice-paste">
        <label className="field-label" htmlFor={`fishid-${bot.id}`}>{vt("paste")}</label>
        <div className="row-gap">
          <input id={`fishid-${bot.id}`} className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={vt("pastePh")} autoComplete="off" />
          <button type="button" className="btn btn-small" disabled={!pasted.trim()} onClick={() => void preview.play("fish", pasted.trim(), lang)}><Icon name="play" size={12} /> {vt("listen")}</button>
          <button type="button" className="btn btn-small btn-primary" disabled={!pasted.trim()} onClick={() => void usePasted()}>{vt("use")}</button>
        </div>
      </div>
    </>
  );
}

function PiperTab({ info, botLang, preview, onPick }: { info: ChoiceInfo; botLang: string; preview: Preview; onPick: (b: Record<string, unknown>) => void }) {
  const vt = useVT();
  const [voices, setVoices] = useState<PiperVoiceInfo[] | null>(null);
  const [lang, setLang] = useState(botLang === "en" ? "en" : botLang ? "fr" : "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<{ voices: PiperVoiceInfo[] }>("GET", "/voice/piper/voices").then((r) => setVoices(r.voices), (e) => setError(errText(e))); }, []);
  if (info.piper && !info.piper.available) return <div className="voice-empty"><p>{vt("noPiper")}</p></div>;
  const langs = [...new Set((voices ?? []).map((v) => v.language))].sort();
  const shown = (voices ?? []).filter((v) => !lang || v.language === lang);
  const chosen = info.choice?.provider === "piper" ? info.choice.voiceId : info.current?.auto ? info.current.voiceId : "";
  return (
    <>
      <div className="voice-filters">
        <select className="input input-small" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={vt("anyLang")}>
          <option value="">{vt("anyLang")}</option>
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <p className="voice-rights small">{vt("rightsPiper")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!voices && !error && <Spinner />}
      <ul className="voice-list">
        {shown.map((v) => (
          <li key={v.id} className={`voice-item${v.id === chosen ? " is-chosen" : ""}`}>
            <div className="voice-item-main">
              <p className="voice-item-title">{v.name} <span className="muted small mono">{v.id}</span></p>
              <p className="voice-item-meta">
                <span className="chip">{v.language}</span>
                <span className="chip chip-soft">{vt(v.gender)}</span>
                <span className="muted small">{v.licence}</span>
              </p>
            </div>
            <div className="voice-item-actions">
              <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => void preview.play("piper", v.id, v.language)}>
                <Icon name="play" size={12} /> {vt(preview.playing === `piper:${v.id}` ? "listening" : "listen")}
              </button>
              <button type="button" className="btn btn-small btn-primary" disabled={info.choice?.provider === "piper" && v.id === chosen} onClick={() => onPick({ provider: "piper", voiceId: v.id })}>
                {vt(info.choice?.provider === "piper" && v.id === chosen ? "chosen" : "choose")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {voices && !shown.length && <p className="muted">{vt("empty")}</p>}
    </>
  );
}

function KokoroTab({ info, botLang, preview, onPick }: { info: ChoiceInfo; botLang: string; preview: Preview; onPick: (b: Record<string, unknown>) => void }) {
  const vt = useVT();
  const [voices, setVoices] = useState<KokoroVoice[] | null>(null);
  const [lang, setLang] = useState(botLang);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  useEffect(() => { if (info.kokoro.available) void api<{ voices: KokoroVoice[] }>("GET", "/voice/kokoro/voices").then((r) => setVoices(r.voices), (e) => setError(errText(e))); }, [info.kokoro.available]);
  if (!info.kokoro.available) return <div className="voice-empty"><p>{vt("noKokoro")}</p></div>;
  const langs = [...new Set((voices ?? []).map((v) => v.language.slice(0, 2)).filter(Boolean))].sort();
  const shown = (voices ?? []).filter((v) => !lang || v.language.toLowerCase().startsWith(lang));
  const chosen = info.choice?.provider === "kokoro" ? info.choice.voiceId : "";
  return (
    <>
      <div className="voice-filters">
        <select className="input input-small" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={vt("anyLang")}>
          <option value="">{vt("anyLang")}</option>
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <p className="voice-rights small">{vt("rightsKokoro")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!voices && !error && <Spinner />}
      <ul className="voice-list">
        {shown.map((v) => (
          <li key={v.id} className={`voice-item${v.id === chosen ? " is-chosen" : ""}`}>
            <div className="voice-item-main">
              <p className="voice-item-title">{v.name} <span className="muted small mono">{v.id}</span></p>
              <p className="voice-item-meta">
                {v.language && <span className="chip">{v.language}</span>}
                {v.gender && <span className="chip chip-soft">{vt(v.gender)}</span>}
                {v.grade && <span className="muted small">{v.grade}</span>}
              </p>
            </div>
            <div className="voice-item-actions">
              <button type="button" className="btn btn-small" disabled={!!preview.playing} onClick={() => void preview.play("kokoro", v.id, v.language)}>
                <Icon name="play" size={12} /> {vt(preview.playing === `kokoro:${v.id}` ? "listening" : "listen")}
              </button>
              <button type="button" className="btn btn-small btn-primary" disabled={v.id === chosen} onClick={() => onPick({ provider: "kokoro", voiceId: v.id, name: v.name, author: "Kokoro-82M", language: v.language })}>
                {vt(v.id === chosen ? "chosen" : "choose")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {voices && !shown.length && <p className="muted">{vt("empty")}</p>}
      <div className="voice-paste">
        <label className="field-label" htmlFor="kokoro-id">{vt("paste")}</label>
        <div className="row-gap">
          <input id="kokoro-id" className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={vt("pastePhKokoro")} autoComplete="off" />
          <button type="button" className="btn btn-small" disabled={!pasted.trim()} onClick={() => void preview.play("kokoro", pasted.trim())}><Icon name="play" size={12} /> {vt("listen")}</button>
          <button type="button" className="btn btn-small btn-primary" disabled={!pasted.trim()} onClick={() => onPick({ provider: "kokoro", voiceId: pasted.trim(), name: pasted.includes("+") ? vt("mix") : pasted.trim(), author: "Kokoro-82M", language: "" })}>{vt("use")}</button>
        </div>
      </div>
    </>
  );
}
