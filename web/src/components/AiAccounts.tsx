/**
 * « Mes comptes IA »: the three ways a person's bots think on their OWN account (onboarding, Settings → Credits / Mes
 * comptes IA, Settings → Models):
 *  - Mon compte OpenRouter: a three-step guide and the key field inline (server openrouterroutes.ts, openrouter.ts), then a
 *    searchable, priced picker of the tool-capable models, with a short "Recommandés" group;
 *  - Mon compte ChatGPT / Mon compte Claude: one click wakes the bot's computer, opens the provider's own sign-in in the
 *    bot's browser and shows that screen live here (server subscriptionconnect.ts); the status is polled until signed in.
 * Passwords are typed on the provider's page only, never in Sklubot; keys are write-only (never shown again).
 */
import { CreditAlertField } from "./CreditAlertField"; // L150 OpenRouter credit alert
import { useEffect, useMemo, useRef, useState } from "react";
import { api, enc, errText } from "../api";
import { useStore } from "../store"; import { intlLocale, sideText } from "../i18n";
import type { ApiProvider, Engine } from "../types";
import { Icon } from "./Icon";
import { LiveScreen } from "./LiveScreen";
import { ErrorNote, Loading, Modal } from "./ui";
import "../styles/aiaccounts.css";

const TEXT = {
  fr: {
    orTitle: "Mon compte OpenRouter",
    orText: "Des centaines de modèles (DeepSeek, Gemini, Claude, Mistral…) avec un seul compte. OpenRouter te facture directement.",
    orStep1: "Crée un compte sur", orStep2: "Achète des crédits chez OpenRouter", orStep3: "Crée une clé et colle-la ici",
    orKey: "Ta clé OpenRouter", orKeyPh: "sk-or-…", orKeySaved: "Clé enregistrée",
    orKeyHint: "Chiffrée sur le serveur, jamais réaffichée. Colle une nouvelle clé pour la remplacer.", orGetKey: "Créer une clé",
    orSave: "Enregistrer", orSaving: "Enregistrement…", orTest: "Tester", orTesting: "Test…",
    orLeft: "Crédit restant sur cette clé : {usd} $", orConnected: "OpenRouter est connecté",
    orUse: "Faire réfléchir {bot} avec OpenRouter", orUsed: "{bot} réfléchit avec {model}.",
    orModels: "Choisir les modèles", orModelsN: "{n} modèles choisis", orCredits: "Recharger mon crédit",
    pkSearch: "Chercher un modèle", pkRecommended: "Recommandés", pkAll: "Tous les modèles ({n})", pkPrice: "{in} $ / {out} $ par million de tokens (entrée / sortie)",
    pkFree: "gratuit, limité", pkCtx: "{n} de contexte", pkImages: "lit les images", pkNone: "Aucun modèle ne correspond.", pkSave: "Garder ces {n} modèles", pkMax: "30 modèles au plus.",
    pkTools: "Seuls les modèles qui savent utiliser des outils sont proposés (tes bots en ont besoin). Prix d'OpenRouter, relus toutes les 6 heures.", pkClose: "Fermer",
    gptTitle: "Mon compte ChatGPT", gptText: "Choisis le bot qui utilisera Codex avec ton abonnement ChatGPT.", gptBtn: "Connecter mon compte ChatGPT",
    clTitle: "Mon compte Claude", clText: "Ouvre Claude Code sur le bureau du bot et connecte ton abonnement Claude.", clBtn: "Connecter mon compte Claude",
    own: "Ton abonnement reste à toi : seuls tes bots l'utilisent.", otherKey: "Une autre clé d'API (DeepSeek, OpenAI…)",
    sharedTitle: "ChatGPT pour mes bots", sharedHint: "Autorise Sklubot une fois sur ton installation personnelle. Chaque bot utilise ensuite ce compte avec son propre modèle, son bureau et ses fichiers.",
    sharedButton: "Continuer avec ChatGPT", sharedDone: "Ton abonnement ChatGPT est connecté pour tes bots.", disconnect: "Déconnecter l’abonnement partagé",
    flowTitle: "Connexion à {provider}", whichBot: "Sur l'ordinateur de quel bot ?", start: "Ouvrir la page de connexion", starting: "Réveil de l'ordinateur et ouverture…",
    instr: "Connecte-toi sur la page qui s'ouvre, puis reviens ici.",
    instr2: "Tu tapes ton mot de passe sur la page de {provider} elle-même, dans le navigateur de ton bot : Sklubot ne le voit jamais.",
    waiting: "En attente de la connexion…", done: "C'est fait : {bot} est connecté à {provider}.", account: "Compte : {account}",
    useBrain: "Faire réfléchir {bot} avec {provider}", finish: "Terminer", big: "Agrandir l'écran", check: "Vérifier",
    stopped: "La connexion est toujours en attente. Si la page a expiré, tu peux la rouvrir.", screen: "Écran de l'ordinateur de {bot}",
    target: "Bureau de {bot}", currentUntilDone: "{bot} garde son modèle actuel jusqu’à la confirmation.", reopen: "Rouvrir la connexion", smallScreen: "Réduire l’écran",
  },
  en: {
    orTitle: "My OpenRouter account",
    orText: "Hundreds of models (DeepSeek, Gemini, Claude, Mistral…) with one account. OpenRouter bills you directly.",
    orStep1: "Create an account on", orStep2: "Buy credits from OpenRouter", orStep3: "Create a key and paste it here",
    orKey: "Your OpenRouter key", orKeyPh: "sk-or-…", orKeySaved: "Key saved",
    orKeyHint: "Encrypted on the server, never shown again. Paste a new key to replace it.", orGetKey: "Create a key",
    orSave: "Save", orSaving: "Saving…", orTest: "Test", orTesting: "Testing…",
    orLeft: "Credit left on this key: ${usd}", orConnected: "OpenRouter is connected",
    orUse: "Make {bot} think with OpenRouter", orUsed: "{bot} thinks with {model}.",
    orModels: "Choose the models", orModelsN: "{n} models chosen", orCredits: "Top up my credit",
    pkSearch: "Search a model", pkRecommended: "Recommended", pkAll: "All models ({n})", pkPrice: "${in} / ${out} per million tokens (input / output)",
    pkFree: "free, rate-limited", pkCtx: "{n} context", pkImages: "reads images", pkNone: "No model matches.", pkSave: "Keep these {n} models", pkMax: "30 models at most.",
    pkTools: "Only models that can use tools are offered (your bots need them). OpenRouter's prices, read again every 6 hours.", pkClose: "Close",
    gptTitle: "My ChatGPT account", gptText: "Choose the bot that will use Codex with your ChatGPT subscription.", gptBtn: "Connect my ChatGPT account",
    clTitle: "My Claude account", clText: "Open Claude Code on the bot’s desktop and sign in with your Claude subscription.", clBtn: "Connect my Claude account",
    own: "Your subscription stays yours: only your bots use it.", otherKey: "Another API key (DeepSeek, OpenAI…)",
    sharedTitle: "ChatGPT for my bots", sharedHint: "Authorize Sklubot once on your personal installation. Each bot then uses this account with its own model, desktop and files.",
    sharedButton: "Continue with ChatGPT", sharedDone: "Your ChatGPT plan is connected for your bots.", disconnect: "Disconnect the shared plan",
    flowTitle: "Signing in to {provider}", whichBot: "On which bot's computer?", start: "Open the sign-in page", starting: "Waking the computer and opening…",
    instr: "Sign in on the page that opens, then come back here.",
    instr2: "You type your password on {provider}'s own page, in your bot's browser: Sklubot never sees it.",
    waiting: "Waiting for the sign-in…", done: "Done: {bot} is signed in to {provider}.", account: "Account: {account}",
    useBrain: "Make {bot} think with {provider}", finish: "Finish", big: "Enlarge the screen", check: "Check",
    stopped: "Still waiting for sign-in. If the page expired, you can reopen it.", screen: "Screen of {bot}'s computer",
    target: "{bot}’s desktop", currentUntilDone: "{bot} keeps its current model until you confirm.", reopen: "Reopen sign-in", smallScreen: "Reduce screen size",
  },
} as const;
type K = keyof typeof TEXT.fr;
function useA() {
  const locale = useStore((s) => s.locale);
  return (k: K, vars: Record<string, string | number> = {}) => (sideText("aiAccounts", TEXT, locale)[k] as string).replace(/\{(\w+)\}/g, (_m, n) => String(vars[n] ?? ""));
}
const usePrimary = () => useStore((s) => Object.values(s.bots).find((b) => b.kind === "agent" && b.primary) ?? null);
const money = (n: number) => (n === 0 ? "0" : n < 0.01 ? n.toPrecision(2) : n < 10 ? n.toFixed(2).replace(/\.?0+$/, "") : String(Math.round(n * 10) / 10));

/* ---------- OpenRouter ---------- */

interface CatalogModel { id: string; name: string; contextWindow: number | null; input: number; output: number; cached: number | null; images: boolean; free: boolean }
interface Catalog { models: CatalogModel[]; recommended: string[]; fetchedAt: number }
interface OrState { provider: ApiProvider | null; links: { keys: string; credits: string; signup: string } }

/** The searchable, priced picker of OpenRouter's tool-capable models ("Recommandés" first). */
export function OpenRouterModels({ chosen, onSaved, onClose }: { chosen: string[]; onSaved: (p: ApiProvider) => void; onClose: () => void }) {
  const a = useA();
  const fr = useStore((s) => s.locale === "fr");
  const dec = (v: string | number) => String(v).replace(".", (1.5).toLocaleString(intlLocale()).charAt(1)); // the reader's decimal mark
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<string[]>(chosen);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Catalog>("GET", "/openrouter/catalog").then(setCat, (e) => setError(errText(e))); }, []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => (cat?.models ?? []).filter((m) => words.every((w) => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w))), [cat, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec = (cat?.recommended ?? []).map((id) => cat!.models.find((m) => m.id === id)).filter((m): m is CatalogModel => !!m && shown.includes(m));
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 30 ? p : [...p, id]));
  const save = async () => {
    setBusy(true); setError(null);
    try { const r = await api<{ provider: ApiProvider }>("PUT", "/openrouter", { models: pick }); onSaved(r.provider); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const row = (m: CatalogModel) => (
    <li key={m.id}>
      <label className={`or-model ${pick.includes(m.id) ? "is-on" : ""}`}>
        <input type="checkbox" checked={pick.includes(m.id)} onChange={() => toggle(m.id)} />
        <span className="or-model-text">
          <b>{m.name}</b>
          <span className="muted small or-model-id">{m.id}</span>
          <span className="small or-model-meta">
            {m.free ? a("pkFree") : a("pkPrice", { in: dec(money(m.input)), out: dec(money(m.output)) })}
            {m.contextWindow ? ` · ${a("pkCtx", { n: m.contextWindow >= 1e6 ? `${dec(Math.round(m.contextWindow / 1e5) / 10)} M` : `${Math.round(m.contextWindow / 1000)} k` })}` : ""}
            {m.images ? ` · ${a("pkImages")}` : ""}
          </span>
        </span>
      </label>
    </li>
  );
  return (
    <div className="or-picker">
      <div className="or-picker-head">
        <span className="or-search"><Icon name="search" size={15} /><input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={a("pkSearch")} aria-label={a("pkSearch")} /></span>
      </div>
      <p className="muted small">{a("pkTools")}</p>
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
      {!cat && !error && <Loading />}
      {cat && (
        <div className="or-picker-list">
          {rec.length > 0 && <><p className="or-group">{a("pkRecommended")}</p><ul className="or-models">{rec.map(row)}</ul></>}
          <p className="or-group">{a("pkAll", { n: shown.length })}</p>
          {shown.length ? <ul className="or-models">{shown.filter((m) => !rec.includes(m)).map(row)}</ul> : <p className="muted small">{a("pkNone")}</p>}
        </div>
      )}
      <div className="or-picker-foot">
        {pick.length >= 30 && <span className="muted small">{a("pkMax")}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>{a("pkClose")}</button>
        <button type="button" className="btn btn-primary btn-small" disabled={busy || !cat} onClick={() => void save()}>{a("pkSave", { n: pick.length })}</button>
      </div>
    </div>
  );
}

/** « Mon compte OpenRouter »: the three steps, the key (write-only), Test, and the model picker once connected. */
export function OpenRouterCard({ onChanged }: { onChanged?: () => void }) {
  const a = useA();
  const primary = usePrimary();
  const [st, setSt] = useState<OrState | null>(null);
  const [key, setKey] = useState("");
  const [useIt, setUseIt] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const load = () => api<OrState>("GET", "/openrouter").then(setSt, (e) => setError(errText(e)));
  useEffect(() => { void load(); }, []);
  if (!st) return error ? <ErrorNote>{error}</ErrorNote> : <Loading />;
  const p = st.provider;
  const connected = !!p?.hasKey;
  const test = async () => {
    setBusy("test"); setError(null); setCheck(null);
    try {
      const r = await api<{ ok: boolean; detail: string; remainingUsd?: number | null }>("POST", "/openrouter/test", key.trim() ? { key: key.trim() } : {});
      setCheck({ ok: r.ok, text: r.ok && typeof r.remainingUsd === "number" ? `${r.detail} ${a("orLeft", { usd: money(r.remainingUsd) })}` : r.detail });
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  const save = async () => {
    setBusy("save"); setError(null); setNote(null);
    try {
      const r = await api<{ provider: ApiProvider }>("PUT", "/openrouter", { key: key.trim() });
      setKey("");
      setSt({ ...st, provider: r.provider });
      const first = r.provider.models[0];
      if (useIt && primary && first) {
        await api("PATCH", `/bots/${enc(primary.id)}`, { model: `${r.provider.id}:${first.id}` });
        setNote(a("orUsed", { bot: primary.name, model: first.id }));
      }
      onChanged?.();
    } catch (e) { setError(errText(e)); }
    setBusy(null);
  };
  return (
    <article className={`ai-account ${connected ? "is-connected" : ""}`}>
      <div className="ai-account-head">
        <span className="ai-account-icon" aria-hidden="true"><Icon name="globe" size={18} /></span>
        <h4>{a("orTitle")}</h4>
        {connected && <span className="ai-account-ok"><Icon name="check" size={13} /> {a("orConnected")}</span>}
      </div>
      <p className="muted small">{a("orText")}</p>
      {!connected && (
        <ol className="ai-steps">
          <li>{a("orStep1")} <a href={st.links.signup} target="_blank" rel="noopener noreferrer">openrouter.ai</a></li>
          <li>{a("orStep2")}</li>
          <li>{a("orStep3")} — <a href={st.links.keys} target="_blank" rel="noopener noreferrer">{a("orGetKey")} <Icon name="external" size={12} /></a></li>
        </ol>
      )}
      <form className="ai-key" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(); }}>
        <label className="field">
          <span className="field-label">{a("orKey")}</span>
          <input className="input" type="password" value={key} onChange={(e) => { setKey(e.target.value); setCheck(null); }} placeholder={connected ? a("orKeySaved") : a("orKeyPh")}
            autoComplete="off" spellCheck={false} data-1p-ignore="" data-lpignore="true" />
          <span className="field-hint">{a("orKeyHint")}</span>
        </label>
        {!connected && primary && (
          <label className="check-row small"><input type="checkbox" checked={useIt} onChange={(e) => setUseIt(e.target.checked)} /><span>{a("orUse", { bot: primary.name })}</span></label>
        )}
        <div className="ai-actions">
          <button type="submit" className="btn btn-primary btn-small" disabled={busy !== null || !key.trim()}>{busy === "save" ? a("orSaving") : a("orSave")}</button>
          <button type="button" className="btn btn-small" disabled={busy !== null || (!key.trim() && !connected)} onClick={() => void test()}>{busy === "test" ? a("orTesting") : a("orTest")}</button>
          {connected && <button type="button" className="btn btn-small btn-ghost" onClick={() => setPicking((x) => !x)}><Icon name="brain" size={14} /> {a("orModels")}</button>}
          {connected && <a className="btn btn-small btn-ghost" href={st.links.credits} target="_blank" rel="noopener noreferrer">{a("orCredits")} <Icon name="external" size={12} /></a>}
        </div>
        {check && <p className={`provider-check ${check.ok ? "is-ok" : "is-bad"}`} role="status"><Icon name={check.ok ? "check" : "alert"} size={14} /> {check.text}</p>}
        {note && <p className="provider-check is-ok" role="status"><Icon name="check" size={14} /> {note}</p>}
        {connected && p && !picking && <p className="muted small">{a("orModelsN", { n: p.models.length })}{p.models.length ? ` : ${p.models.slice(0, 4).map((m) => m.id).join(", ")}${p.models.length > 4 ? "…" : ""}` : ""}</p>}
      </form>
      {connected && !picking && <CreditAlertField />}
      {picking && p && <OpenRouterModels chosen={p.models.map((m) => m.id)} onClose={() => setPicking(false)} onSaved={(np) => { setSt({ ...st, provider: np }); setPicking(false); onChanged?.(); }} />}
      <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
    </article>
  );
}

/* ---------- ChatGPT / Claude subscriptions ---------- */

interface ConnectInfo { allowed: boolean; why: string | null; whyText: string | null; personalChatGPT?: boolean; personalConnected?: boolean; bots: { id: string; name: string; primary: boolean }[]; mainBotId: string | null }
const BRAND: Record<Engine, string> = { codex: "ChatGPT", "claude-code": "Claude" };
const POLL_MS = 5000;
const WAIT_MAX_MS = 5 * 60_000;

export async function applySubscriptionModel(botId: string, engine: Engine, model?: string) {
  const saved = await api<{ model: string }>("POST", "/connect-subscription/use", { botId, engine, model });
  const state = useStore.getState();
  if (state.bots[botId]) state.upsertBot({ ...state.bots[botId], model: saved.model });
}

/** The sign-in flow: pick the bot (if several), open the provider's page on its screen, show it live, poll, then switch its brain. */
export function ConnectFlow({ engine, info, model, onClose }: { engine: Engine; info: ConnectInfo; model?: string; onClose: () => void }) {
  const a = useA();
  const provider = BRAND[engine];
  const shared = engine === "codex" && !!info.personalChatGPT;
  const [expanded, setExpanded] = useState(false);
  const selectedId = useStore.getState().selectedId;
  const [botId, setBotId] = useState(info.bots.find((b) => b.id === selectedId)?.id ?? info.mainBotId ?? info.bots[0]?.id ?? "");
  const [screenId, setScreenId] = useState("");
  const screenName = useStore((s) => s.bots[screenId]?.name);
  const [stage, setStage] = useState<"pick" | "starting" | "screen" | "done">("pick");
  const [since, setSince] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [useBrain, setUseBrain] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const checking = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bot = info.bots.find((b) => b.id === botId);
  const check = async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const r = await api<{ signedIn: boolean; account: string | null }>("GET", `/connect-subscription/status?bot=${enc(botId)}&engine=${engine}${shared ? "&personal=1&poll=1" : ""}`);
      if (alive.current && r.signedIn) { setAccount(r.account); setStage("done"); }
    } catch (e) { if (alive.current) setError(errText(e)); }
    finally { checking.current = false; }
  };
  // While the screen is shown: control is held (renewed every 25 s, as the viewer does) and the status polled.
  useEffect(() => {
    if (stage !== "screen") return;
    const hold = () => void api("POST", `/bots/${enc(screenId)}/desktop/control`, { on: true }).catch(() => undefined);
    hold();
    const h = window.setInterval(hold, 25_000);
    const p = window.setInterval(() => {
      if (Date.now() - since > WAIT_MAX_MS) { setStopped(true); return; }
      void check();
    }, POLL_MS);
    return () => { window.clearInterval(h); window.clearInterval(p); void api("POST", `/bots/${enc(screenId)}/desktop/control`, { on: false }).catch(() => undefined); };
  }, [stage, botId, screenId, since]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setStage("starting"); setError(null); setStopped(false);
    try {
      const status = await api<{ signedIn: boolean; account: string | null }>("GET", `/connect-subscription/status?bot=${enc(botId)}&engine=${engine}${shared ? "&personal=1" : ""}`);
      if (!alive.current) return;
      if (status.signedIn) { setAccount(status.account); setStage("done"); return; }
      const flow = await api<{botId: string}>("POST", "/connect-subscription/start", { engine, botId, personal: shared });
      if (!alive.current) return;
      setScreenId(flow.botId);
      setSince(Date.now());
      setStage("screen");
    } catch (e) { if (alive.current) { setError(errText(e)); setStage("pick"); } }
  };
  const finish = async () => {
    if (stage === "done" && useBrain) {
      try { await applySubscriptionModel(botId, engine, model); } catch (e) { setError(errText(e)); return; }
    }
    onClose();
  };
  return (
    <Modal title={a("flowTitle", { provider })} onClose={onClose} size="lg" className={expanded && stage === "screen" ? "ai-flow ai-flow-expanded" : "ai-flow"}>
      <div className="modal-body ai-flow-body">
        {stage === "pick" || stage === "starting" ? (
          <>
            {info.bots.length === 1 && <strong>{a("target", { bot: bot?.name ?? "" })}</strong>}
            <p>{a("instr")}</p>
            <p className="muted small">{a("instr2", { provider })}</p>
            {model && bot && <p className="muted small">{a("currentUntilDone", { bot: bot.name })}</p>}
            {info.bots.length > 1 && (
              <label className="field">
                <span className="field-label">{a("whichBot")}</span>
                <select className="input" disabled={stage === "starting"} value={botId} onChange={(e) => setBotId(e.target.value)}>{info.bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            )}
            <div className="ai-actions">
              <button type="button" className="btn btn-primary" disabled={stage === "starting" || !botId} onClick={() => void start()}><Icon name="key" size={15} /> {stage === "starting" ? a("starting") : a("start")}</button>
            </div>
          </>
        ) : stage === "screen" ? (
          <>
            <div className="ai-flow-hint" role="status"><Icon name="info" size={16} /><span><b>{a("instr")}</b> <span className="muted">{stopped ? a("stopped") : a("waiting")}</span></span></div>
            <div className="ai-flow-screen"><LiveScreen botId={screenId} control label={a("screen", { bot: screenName ?? bot?.name ?? "" })} /></div>
            <div className="ai-actions">
              <button type="button" className="btn btn-small" onClick={() => void check()}><Icon name="refresh" size={14} /> {a("check")}</button>
              {stopped && <button type="button" className="btn btn-small" onClick={() => void start()}>{a("reopen")}</button>}
              <button type="button" className="btn btn-small btn-ghost" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}><Icon name="fullscreen" size={14} /> {a(expanded ? "smallScreen" : "big")}</button>
            </div>
          </>
        ) : (
          <>
            <p className="ai-flow-done" role="status"><Icon name="check" size={18} /> {shared ? a("sharedDone") : a("done", { bot: bot?.name ?? "", provider })}</p>
            {account && <p className="muted small">{a("account", { account })}</p>}
            <label className="check-row"><input type="checkbox" checked={useBrain} onChange={(e) => setUseBrain(e.target.checked)} /><span>{a("useBrain", { bot: bot?.name ?? "", provider })}</span></label>
          </>
        )}
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        <p className="muted small">{a("own")}</p>
      </div>
      {stage === "done" && <div className="modal-foot"><button type="button" className="btn btn-primary" onClick={() => void finish()}>{a("finish")}</button></div>}
    </Modal>
  );
}

function SubscriptionCard({ engine, info, reload }: { engine: Engine; info: ConnectInfo | null; reload: () => void }) {
  const a = useA();
  const [open, setOpen] = useState(false);
  const gpt = engine === "codex";
  const personal = gpt && !!info?.personalChatGPT;
  const [disconnectError, setDisconnectError] = useState("");
  async function disconnect() {
    try { await api("DELETE", "/connect-subscription/personal"); setDisconnectError(""); reload(); }
    catch (e) { setDisconnectError(errText(e)); }
  }
  return (
    <article className="ai-account">
      <div className="ai-account-head">
        <span className="ai-account-icon" aria-hidden="true"><Icon name="brain" size={18} /></span>
        <h4>{a(personal ? "sharedTitle" : gpt ? "gptTitle" : "clTitle")}</h4>
      </div>
      <p className="muted small">{a(personal ? "sharedHint" : gpt ? "gptText" : "clText")}</p>
      {info && !info.allowed && <p className="muted small ai-blocked"><Icon name="info" size={13} /> {info.whyText}</p>}
      <button type="button" className="btn btn-small btn-primary" disabled={!info || !info.allowed || !info.bots.length} onClick={() => setOpen(true)}>{a(personal ? "sharedButton" : gpt ? "gptBtn" : "clBtn")}</button>
      {personal && info?.personalConnected && <button type="button" className="btn btn-ghost btn-small" onClick={() => void disconnect()}>{a("disconnect")}</button>}
      {disconnectError && <ErrorNote>{disconnectError}</ErrorNote>}
      <p className="muted small ai-own">{a("own")}</p>
      {open && info && <ConnectFlow engine={engine} info={info} onClose={() => { setOpen(false); reload(); }} />}
    </article>
  );
}

/** The three own-account cards, and "another API key" as a small link to Settings → Models. */
export function AiAccountCards({ onOtherKey, subscriptionsOnly = false }: { onOtherKey?: () => void; subscriptionsOnly?: boolean }) {
  const a = useA();
  const openAppSettings = useStore((s) => s.openAppSettings);
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<ConnectInfo>("GET", "/connect-subscription").then((r) => { if (active) setInfo(r); }, (e) => { if (active) setError(errText(e)); });
    return () => { active = false; };
  }, [attempt]);
  return (
    <div className="ai-accounts">
      {error && <><ErrorNote>{error}</ErrorNote><button type="button" className="btn btn-small" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>{a("check")}</button></>}
      <div className="ai-account-grid">
        <SubscriptionCard engine="codex" info={info} reload={() => setAttempt((n) => n + 1)} />
        <SubscriptionCard engine="claude-code" info={info} reload={() => setAttempt((n) => n + 1)} />
        {!subscriptionsOnly && <OpenRouterCard />}
      </div>
      {!subscriptionsOnly && <button type="button" className="btn btn-ghost btn-small ai-other" onClick={onOtherKey ?? (() => openAppSettings("models"))}><Icon name="key" size={13} /> {a("otherKey")}</button>}
    </div>
  );
}
