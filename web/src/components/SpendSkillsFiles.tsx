import { Fragment, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { OFFICE_FILE, OfficeView, SheetTable } from "./OfficeView";
import { JournalWhy, WhyButton } from "./JournalWhy"; // L137
import { create } from "zustand";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { relTime, shortDate } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import type { Attachment, Bot, Card, JournalEntry, Payment, Routine, Rule, RulesState, SharedPage, TaskIdea, VaultItem } from "../types";
import { Icon } from "./Icon";
import { TextScan } from "./SkillScan";
import { ErrorNote, IconButton, Loading, Toggle } from "./ui";

/* Wave 5b: spend checkpoints, learned skills, API connectors, memory questions, the usage journal, first-task ideas,
   file preview, card payments in the vault, routine costs and rules scoped to a routine. */

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return { busy, error, run };
}
const usd = (n: number) => `${n.toFixed(2)} $`;

/* ---------- Cards ---------- */

export function SpendCardView({ card }: { card: Extract<Card, { type: "spend" }> }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const act = (action: "continue" | "raise" | "stop") => run(action, () => api("POST", `/spend/${enc(card.checkpointId)}`, { action }));
  return (
    <div className="card spend-card">
      <div className="card-head">
        <span className="logo-tile is-spend" aria-hidden="true"><Icon name="chart" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("spend.title", { spent: usd(card.spentUsd) })}</p>
          <p className="card-sub">{card.title} · {t(`spend.scope.${card.scope}` as Key)}</p>
        </div>
      </div>
      <div className="spend-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((card.spentUsd / Math.max(0.01, card.thresholdUsd)) * 100))}%` }} /></div>
      <p className="card-reason">{t("spend.body", { threshold: usd(card.thresholdUsd) })}</p>
      {card.status === "pending" ? (
        <>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void act("stop")}>{t("spend.stop")}</button>
            <span className="spacer" />
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void act("raise")}>{t("spend.raise", { next: usd(card.thresholdUsd * 2) })}</button>
            <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => void act("continue")}>{t(busy === "continue" ? "common.working" : "spend.continue")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <p className={`card-outcome is-${card.status === "stopped" ? "denied" : "allowed"}`}>
          <Icon name={card.status === "stopped" ? "stop" : "check"} size={14} /> {t(`spend.status.${card.status}` as Key, { threshold: usd(card.thresholdUsd) })}
        </p>
      )}
    </div>
  );
}

export function SkillCardView({ card, botId, seq }: { card: Extract<Card, { type: "skill" }>; botId: string; seq: number }) {
  const t = useT();
  const [name, setName] = useState(card.name);
  const [steps, setSteps] = useState(card.steps);
  const { busy, error, run } = useBusy();
  const pending = card.status === "pending";
  return (
    <div className="card skill-card">
      <div className="card-head">
        <span className="logo-tile is-skill" aria-hidden="true"><Icon name="book" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("skillCard.title")}</p>
          <p className="card-sub">{t("skillCard.sub")}</p>
        </div>
      </div>
      {card.outside && <p className="card-note note-line"><Icon name="alert" size={13} /> <span>{t("skillCard.outside")}</span></p>}
      {pending ? (
        <>
          <label className="field-label" htmlFor={`sk-n-${seq}`}>{t("skillCard.name")}</label>
          <input id={`sk-n-${seq}`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {card.when && <p className="card-sub">{t("skillCard.when", { when: card.when })}</p>}
          {card.evidence && card.evidence.length > 0 && (
            <div className="card-sub skill-evidence">
              <p className="note-line"><Icon name="history" size={13} /> <span>{t("skillCard.evidence", { n: card.evidence.length })}</span></p>
              <ul>{card.evidence.map((e) => <li key={e.at}><span className="muted">{shortDate(e.at)} · {e.where}</span> — « {e.quote} »</li>)}</ul>
            </div>
          )}
          <label className="field-label" htmlFor={`sk-s-${seq}`}>{t("skillCard.steps")}</label>
          <textarea id={`sk-s-${seq}`} className="input skill-steps" rows={6} value={steps} onChange={(e) => setSteps(e.target.value)} />
          <TextScan name={name} when={card.when} steps={steps} />
          <p className="card-sub note-line"><Icon name="shield" size={13} /> <span>{t("skillCard.anonymised")}</span></p>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run("no", () => api("POST", `/bots/${botId}/cards/${seq}/skill`, { action: "dismiss" }))}>{t("skillCard.dismiss")}</button>
            <span className="spacer" />
            <button type="button" className="btn btn-accent" disabled={busy !== null || !name.trim() || !steps.trim()} onClick={() => void run("save", () => api("POST", `/bots/${botId}/cards/${seq}/skill`, { action: "save", name, steps }))}>{t(busy === "save" ? "common.saving" : "skillCard.save")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <p className="card-reason"><b>{card.name}</b></p>
          <p className={`card-outcome is-${card.status === "saved" ? "allowed" : "denied"}`}><Icon name={card.status === "saved" ? "check" : "close"} size={14} /> {t(card.status === "saved" ? "skillCard.saved" : "skillCard.dismissed")}</p>
        </>
      )}
    </div>
  );
}

export function ApiConnectorCardView({ card, botId, seq }: { card: Extract<Card, { type: "apiconnector" }>; botId: string; seq: number }) {
  const t = useT();
  const [token, setToken] = useState("");
  const { busy, error, run } = useBusy();
  return (
    <div className="card api-card">
      <div className="card-head">
        <span className="logo-tile is-vault" aria-hidden="true"><Icon name="plug" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("apiCard.title", { name: card.name })}</p>
          <p className="card-sub"><code>{card.baseUrl}</code></p>
        </div>
      </div>
      <ul className="api-endpoints">
        {card.endpoints.map((e) => (
          <li key={`${e.method} ${e.path}`}><span className={`chip method is-${e.method.toLowerCase()}`}>{e.method}</span> <code>{e.path}</code>{e.description ? <span className="muted"> — {e.description}</span> : null}</li>
        ))}
      </ul>
      <p className="card-sub note-line"><Icon name="key" size={13} /> <span>{t("apiCard.secret", { secret: card.secret, host: card.host })}</span></p>
      {card.preset && ["x", "instagram", "trello"].includes(card.preset) ? <p className="card-sub note-line"><Icon name="info" size={13} /> <span>{t(`apiCard.preset.${card.preset as "x" | "instagram" | "trello"}`)}</span></p> : null}
      {card.status === "pending" ? (
        <form className="secret-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void run("ok", () => api("POST", `/bots/${botId}/cards/${seq}/apiconnector`, { action: "approve", token: token || undefined })); }}>
          {!card.secretSaved && (
            <>
              <label className="sr-only" htmlFor={`api-${seq}`}>{t("apiCard.token")}</label>
              <input id={`api-${seq}`} className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("apiCard.token")} autoComplete="off" data-1p-ignore="" data-lpignore="true" />
            </>
          )}
          <p className="card-sub note-line"><Icon name="shield" size={13} /> <span>{t("apiCard.never")}</span></p>
          <div className="card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void run("no", () => api("POST", `/bots/${botId}/cards/${seq}/apiconnector`, { action: "dismiss" }))}>{t("apiCard.dismiss")}</button>
            <span className="spacer" />
            <button type="submit" className="btn btn-accent" disabled={busy !== null || (!card.secretSaved && !token.trim())}>{t(busy === "ok" ? "common.saving" : "apiCard.approve")}</button>
          </div>
          {error && <p className="card-error" role="alert">{error}</p>}
        </form>
      ) : (
        <p className={`card-outcome is-${card.status === "approved" ? "allowed" : "denied"}`}><Icon name={card.status === "approved" ? "check" : "close"} size={14} /> {t(card.status === "approved" ? "apiCard.approved" : "apiCard.dismissed")}</p>
      )}
    </div>
  );
}

export function MemoryCardView({ card, botId, seq }: { card: Extract<Card, { type: "memory" }>; botId: string; seq: number }) {
  const t = useT();
  const { busy, error, run } = useBusy();
  const choose = (choice: "old" | "new") => run(choice, () => api("POST", `/bots/${botId}/cards/${seq}/memory`, { choice }));
  return (
    <div className="card memory-card">
      <div className="card-head">
        <span className="logo-tile is-skill" aria-hidden="true"><Icon name="brain" size={18} /></span>
        <div className="card-head-text">
          <p className="card-title">{t("memCard.title")}</p>
          <p className="card-sub">{t("memCard.sub", { quote: card.quote })}</p>
        </div>
      </div>
      <div className="memory-choice">
        <button type="button" className={`memory-option ${card.status === "kept" ? "is-chosen" : ""}`} disabled={card.status !== "pending" || busy !== null} onClick={() => void choose("old")}>
          <span className="muted small">{t("memCard.old")}</span><span>{card.oldText}</span>
        </button>
        <button type="button" className={`memory-option ${card.status === "replaced" ? "is-chosen" : ""}`} disabled={card.status !== "pending" || busy !== null} onClick={() => void choose("new")}>
          <span className="muted small">{t("memCard.new")}</span><span>{card.newText}</span>
        </button>
      </div>
      {error && <p className="card-error" role="alert">{error}</p>}
    </div>
  );
}

/** "mentioned once" / "confirmed" badge on a memory note. */
export function ConfidenceBadge({ confidence }: { confidence: "once" | "confirmed" }) {
  const t = useT();
  return <span className={`chip memory-confidence is-${confidence}`} title={t(`memory.confidence.${confidence}Hint` as Key)}><Icon name={confidence === "confirmed" ? "check" : "info"} size={11} /> {t(`memory.confidence.${confidence}` as Key)}</span>;
}

/* ---------- Settings → Activity: the detailed usage journal ---------- */

const DECISIONS: JournalEntry["decision"][] = ["words", "reviewer", "approval", "retry", "conversation", "policy", "free", "denied"];

export function JournalView() {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const [bot, setBot] = useState("");
  const [decision, setDecision] = useState("");
  const [tool, setTool] = useState("");
  const [days, setDays] = useState("7");
  const [data, setData] = useState<{ entries: JournalEntry[]; totals: { lines: number; costUsd: number; byDecision: Record<string, number> } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState<number | null>(null); // L137 « Pourquoi ? » (JournalWhy.tsx)
  const query = useMemo(() => new URLSearchParams({ ...(bot ? { bot } : {}), ...(decision ? { decision } : {}), ...(tool.trim() ? { tool: tool.trim() } : {}), ...(days ? { days } : {}) }).toString(), [bot, decision, tool, days]);
  useEffect(() => {
    let dead = false;
    api<NonNullable<typeof data>>("GET", `/journal?${query}`).then((r) => !dead && setData(r), (e) => !dead && setError(errText(e)));
    return () => { dead = true; };
  }, [query]);
  const agents = Object.values(bots).filter((b) => b.kind === "agent");
  return (
    <div className="journal">
      <div className="journal-filters">
        <select className="input input-small" value={bot} onChange={(e) => setBot(e.target.value)} aria-label={t("journal.bot")}>
          <option value="">{t("journal.allBots")}</option>
          {agents.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input input-small" value={decision} onChange={(e) => setDecision(e.target.value)} aria-label={t("journal.decision")}>
          <option value="">{t("journal.allDecisions")}</option>
          {DECISIONS.map((d) => <option key={d} value={d}>{t(`journal.d.${d}` as Key)}</option>)}
        </select>
        <input className="input input-small" value={tool} onChange={(e) => setTool(e.target.value)} placeholder={t("journal.tool")} aria-label={t("journal.tool")} />
        <select className="input input-small" value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("journal.period")}>
          {["1", "7", "30", "90"].map((d) => <option key={d} value={d}>{t("journal.days", { n: d })}</option>)}
        </select>
        <a className="btn btn-small" href={`/api/journal.csv?${query}`} download><Icon name="download" size={13} /> {t("journal.csv")}</a>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!data && !error && <Loading />}
      {data && (
        <>
          <p className="muted small">{t("journal.totals", { n: data.totals.lines, cost: data.totals.costUsd.toFixed(3), free: (data.totals.byDecision.words ?? 0) + (data.totals.byDecision.reviewer ?? 0) })}</p>
          {data.entries.length === 0 ? <p className="muted small">{t("journal.empty")}</p> : (
            <div className="journal-table" role="table" aria-label={t("journal.title")}>
              <div className="journal-row is-head" role="row">
                <span role="columnheader">{t("journal.when")}</span><span role="columnheader">{t("journal.bot")}</span><span role="columnheader">{t("journal.action")}</span><span role="columnheader">{t("journal.decision")}</span><span role="columnheader">{t("journal.cost")}</span>
              </div>
              {data.entries.map((e) => (<Fragment key={e.id}>
                <div className={`journal-row is-${e.status}`} role="row">
                  <span role="cell" className="muted">{relTime(e.at)}</span>
                  <span role="cell">{e.botName}</span>
                  <span role="cell" className="journal-action"><code>{e.tool}</code> <span className="truncate">{e.label}</span>{e.origin && e.origin !== "user" ? <span className="chip chip-quiet">{t(`journal.o.${e.origin}` as Key) || e.origin}</span> : null}</span>
                  <span role="cell"><span className={`chip journal-decision is-${e.decision}`}>{t(`journal.d.${e.decision}` as Key)}</span>{e.quote ? <span className="journal-quote"> « {e.quote} »</span> : e.reason ? <span className="journal-quote muted"> {e.reason}</span> : null} <WhyButton open={why === e.id} onToggle={() => setWhy(why === e.id ? null : e.id)} /></span>
                  <span role="cell" className="muted">{e.costUsd > 0 ? `${e.costUsd.toFixed(3)} $` : "—"}</span>
                </div>
                {why === e.id && <JournalWhy id={e.id} />}
              </Fragment>))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Settings → Usage: the spend checkpoint ---------- */

export function SpendSettingsBlock() {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  useEffect(() => { api<{ settings: { checkpointUsd: number } }>("GET", "/spend").then((r) => setValue(String(r.settings.checkpointUsd)), () => undefined); }, []);
  const save = (e: FormEvent) => { e.preventDefault(); void run("save", async () => { const r = await api<{ settings: { checkpointUsd: number } }>("PUT", "/spend", { checkpointUsd: Number(value) }); setValue(String(r.settings.checkpointUsd)); setNote(t("common.saved")); window.setTimeout(() => setNote(null), 1800); }); };
  return (
    <form className="field" onSubmit={save}>
      <label className="field-label" htmlFor={id}>{t("spend.setting")}</label>
      <p className="field-hint">{t("spend.settingHint")}</p>
      <div className="field-inline">
        <input id={id} className="input input-small input-narrow" type="number" min={0} step={0.5} value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="muted">$</span>
        <button type="submit" className="btn btn-small" disabled={busy !== null || value === ""}>{t("common.save")}</button>
        {note && <span className="chip state-ready" role="status">{note}</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

/** In a bot's settings: its own checkpoint, or the account's. */
export function BotSpendField({ bot }: { bot: Bot }) {
  const t = useT();
  const id = useId();
  const [value, setValue] = useState(bot.spendCheckpointUsd === null ? "" : String(bot.spendCheckpointUsd));
  const { error, run } = useBusy();
  const save = (v: string) => run("save", async () => {
    const r = await api<{ bot: Bot }>("PATCH", `/bots/${enc(bot.id)}`, { spendCheckpointUsd: v.trim() === "" ? null : Number(v) });
    useStore.getState().upsertBot(r.bot);
  });
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{t("spend.botSetting")}</label>
      <p className="field-hint">{t("spend.botHint")}</p>
      <div className="field-inline">
        <input id={id} className="input input-small input-narrow" type="number" min={0} step={0.5} placeholder={t("spend.accountDefault")} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => void save(value)} />
        <span className="muted">$</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

/* ---------- First-task ideas on an empty main chat ---------- */

export function FirstTaskIdeas({ bot }: { bot: Bot }) {
  const t = useT();
  const [ideas, setIdeas] = useState<TaskIdea[] | null>(null);
  const [source, setSource] = useState<"mail" | "default">("default");
  const [useMail, setUseMail] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const hasMail = useStore((s) => (s.native?.accounts ?? []).some((a) => (a.app === "gmail" || a.app === "outlook") && a.status === "ready"));
  useEffect(() => {
    let dead = false;
    api<{ ideas: TaskIdea[]; source: "mail" | "default" }>("GET", `/ideas${useMail ? "?mail=1" : ""}`).then((r) => { if (!dead) { setIdeas(r.ideas); setSource(r.source); } }, () => !dead && setIdeas([]));
    return () => { dead = true; };
  }, [useMail]);
  if (!ideas?.length) return null;
  const pick = async (idea: TaskIdea) => {
    setSending(idea.title);
    try { await api("POST", `/bots/${bot.id}/messages`, { text: idea.prompt }); } catch (e) { useStore.getState().showToast(errText(e)); } finally { setSending(null); }
  };
  return (
    <section className="ideas" aria-label={t("ideas.title")}>
      <p className="ideas-title"><Icon name="bulb" size={14} /> {t(source === "mail" ? "ideas.fromMail" : "ideas.title")}</p>
      <div className="ideas-grid">
        {ideas.map((i) => (
          <button key={i.title} type="button" className="idea" disabled={sending !== null} onClick={() => void pick(i)}>
            <span className="idea-kind chip">{t(i.kind === "once" ? "ideas.once" : "ideas.recurring")}</span>
            <span className="idea-title">{i.title}</span>
            <span className="idea-why muted small">{i.why}</span>
          </button>
        ))}
      </div>
      {hasMail && (
        <label className="ideas-mail toggle-line">
          <Toggle checked={useMail} label={t("ideas.useMail")} onChange={setUseMail} />
          <span className="small muted">{t("ideas.useMailHint")}</span>
        </label>
      )}
    </section>
  );
}

/* ---------- File preview panel ---------- */

interface PreviewState { file: { botId: string; file: Attachment } | null; open: (botId: string, file: Attachment) => void; close: () => void }
export const usePreview = create<PreviewState>((set) => ({ file: null, open: (botId, file) => set({ file: { botId, file } }), close: () => set({ file: null }) }));
const viewUrl = (botId: string, path: string) => `/api/bots/${encodeURIComponent(botId)}/files/view?path=${encodeURIComponent(path)}`;
const downloadUrl = (botId: string, path: string) => `/api/bots/${encodeURIComponent(botId)}/files/download?path=${encodeURIComponent(path)}`;

const EXT_MIME: Record<string, string> = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", log: "text/plain" };
export const previewable = (mime: string, name: string) => /^image\//.test(mime) || mime === "application/pdf" || /^text\//.test(mime) || mime === "application/json" || /\.(csv|txt|md|json|log|pdf)$/i.test(name) || OFFICE_FILE.test(name); // L148: Word / Excel / PowerPoint (OfficeView.tsx)

/** Library files a message mentions as ~/files/<path>, as attachments the panel can open. */
export function mentionedFiles(text: string): Attachment[] {
  const out: Attachment[] = [];
  for (const m of text.matchAll(/~\/files\/([\w./-]+?\.([a-z0-9]{2,5}))(?=[.!?]?(?:[\s)`"',;:]|$))/gi)) {
    const path = m[1].trim();
    const mime = EXT_MIME[m[2].toLowerCase()];
    if (!mime || out.some((a) => a.path === path)) continue;
    out.push({ name: path.split("/").pop() ?? path, path, mime, size: 0 });
  }
  return out.slice(0, 6);
}

/** CSV → rows (RFC 4180 quoting), up to `max` lines (L148: the whole file, capped at 5000). */
export function parseCsv(text: string, max = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"') quoted = true; else if (c === "," || c === ";") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** The side panel: images, PDFs, text, Markdown and CSV from the bot's library (fetched as the user, never run). */
export function FilePreviewPanel() {
  const t = useT();
  const preview = usePreview((s) => s.file);
  const close = usePreview((s) => s.close);
  const [text, setText] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const f = preview?.file;
  const kind = !f ? null : OFFICE_FILE.test(f.name) ? "office" : /^image\//.test(f.mime) ? "image" : f.mime === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : /\.csv$/i.test(f.name) || f.mime === "text/csv" ? "csv" : /\.md$/i.test(f.name) ? "md" : "text";
  useEffect(() => {
    setText(null); setError(null);
    if (!preview || !f || kind === "image" || kind === "office") return;
    let dead = false;
    let url: string | null = null;
    // Downloaded with the user's session and shown here: a PDF as a blob forced to application/pdf (the browser's viewer), text as text (never as a page).
    fetch(downloadUrl(preview.botId, f.path), { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      if (kind === "pdf") { const b = await r.blob(); url = URL.createObjectURL(new Blob([b], { type: "application/pdf" })); if (!dead) setBlobUrl(url); }
      else { const s = await r.text(); if (!dead) setText(s.slice(0, kind === "csv" ? 5_000_000 : 200_000)); }
    }).catch((e) => !dead && setError(String(e?.message ?? e)));
    return () => { dead = true; if (url) URL.revokeObjectURL(url); setBlobUrl(null); };
  }, [preview, f, kind]);
  if (!preview || !f) return null;
  return (
    <aside className="preview-panel" aria-label={t("preview.title", { name: f.name })}>
      <header className="preview-head">
        <Icon name={kind === "image" ? "image" : "file"} size={16} />
        <span className="truncate preview-name" title={f.path}>{f.name}</span>
        <a className="btn btn-small" href={downloadUrl(preview.botId, f.path)} download={f.name}><Icon name="download" size={13} /> {t("attach.download")}</a>
        <IconButton icon="close" label={t("common.close")} onClick={close} />
      </header>
      <div className="preview-body">
        {error && <p className="muted small">{t("preview.failed")}</p>}
        {kind === "image" && <img src={viewUrl(preview.botId, f.path)} alt={f.name} />}
        {/* An iframe rather than <object>: the app's Content-Security-Policy has object-src 'none'; frame-src allows blob: (our own PDF only). */}
        {kind === "pdf" && blobUrl && <iframe src={blobUrl} className="preview-pdf" title={f.name} />}
        {kind === "csv" && text !== null && (() => { const rows = parseCsv(text); return <><SheetTable rows={rows} label={f.name} /><p className="muted small">{t(rows.length >= 5000 ? "c7.office.csvCap" : "c7.office.rows", { n: rows.length })}</p></>; })()}
        {kind === "office" && <OfficeView botId={preview.botId} path={f.path} name={f.name} />}
        {kind === "md" && text !== null && <div className="md preview-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />}
        {kind === "text" && text !== null && <pre className="preview-text">{text}</pre>}
        {!error && text === null && kind !== "image" && kind !== "office" && !blobUrl && <Loading />}
      </div>
    </aside>
  );
}

/** Small "preview" chips under a message for the library files it mentions. */
export function MentionedFiles({ botId, text }: { botId: string; text: string }) {
  const t = useT();
  const open = usePreview((s) => s.open);
  const files = useMemo(() => mentionedFiles(text), [text]);
  if (!files.length) return null;
  return (
    <div className="mentioned-files">
      {files.map((f) => <button key={f.path} type="button" className="chip chip-button" onClick={() => open(botId, f)}><Icon name="eye" size={12} /> {t("preview.open", { name: f.name })}</button>)}
    </div>
  );
}

/* ---------- Vault: payment cards ---------- */

export function CardVaultEditor({ item, onSaved, onCancel }: { item: VaultItem | null; onSaved: (item: VaultItem) => void; onCancel: () => void }) {
  const t = useT();
  const uid = useId();
  const [f, setF] = useState({ name: item?.name ?? "", number: "", expiry: "", cvc: "", holder: "", daily: item?.card?.dailyCapUsd?.toString() ?? "", monthly: item?.card?.monthlyCapUsd?.toString() ?? "", note: item?.note ?? "" });
  const { busy, error, run } = useBusy();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run("save", async () => {
      const body = { kind: "card", name: f.name.trim(), note: f.note.trim(), dailyCapUsd: f.daily.trim() === "" ? null : Number(f.daily), monthlyCapUsd: f.monthly.trim() === "" ? null : Number(f.monthly), ...(f.number.trim() ? { number: f.number, expiry: f.expiry, cvc: f.cvc, holder: f.holder } : {}) };
      const r = item ? await api<{ item: VaultItem }>("PATCH", `/vault/${enc(item.id)}`, body) : await api<{ item: VaultItem }>("POST", "/vault", body);
      onSaved(r.item);
    });
  };
  const secret = { autoComplete: "off", "data-1p-ignore": "", "data-lpignore": "true", spellCheck: false } as const;
  return (
    <form className="editor" onSubmit={submit} autoComplete="off" aria-label={t("vault.new.card")}>
      <p className="editor-kind"><Icon name="lock" size={15} /> {t("vault.kind.card")}</p>
      <div className="field"><label className="field-label" htmlFor={`${uid}n`}>{t("vault.name")}</label><input id={`${uid}n`} className="input" value={f.name} required maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder={t("card.namePlaceholder")} /></div>
      <div className="field"><label className="field-label" htmlFor={`${uid}c`}>{t("card.number")}{item ? <span className="muted"> · {t("card.keep", { last4: item.card?.last4 ?? "" })}</span> : null}</label><input id={`${uid}c`} className="input" inputMode="numeric" value={f.number} required={!item} onChange={(e) => set("number", e.target.value)} placeholder="•••• •••• •••• ••••" {...secret} /></div>
      <div className="field-row">
        <div className="field"><label className="field-label" htmlFor={`${uid}e`}>{t("card.expiry")}</label><input id={`${uid}e`} className="input input-small" value={f.expiry} required={!!f.number} onChange={(e) => set("expiry", e.target.value)} placeholder="MM/AA" {...secret} /></div>
        <div className="field"><label className="field-label" htmlFor={`${uid}v`}>{t("card.cvc")}</label><input id={`${uid}v`} className="input input-small" type="password" value={f.cvc} required={!!f.number} onChange={(e) => set("cvc", e.target.value)} placeholder="123" {...secret} /></div>
        <div className="field"><label className="field-label" htmlFor={`${uid}h`}>{t("card.holder")}</label><input id={`${uid}h`} className="input" value={f.holder} onChange={(e) => set("holder", e.target.value)} {...secret} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label className="field-label" htmlFor={`${uid}d`}>{t("card.daily")}</label><input id={`${uid}d`} className="input input-small" type="number" min={0} value={f.daily} onChange={(e) => set("daily", e.target.value)} placeholder={t("card.noCap")} /></div>
        <div className="field"><label className="field-label" htmlFor={`${uid}m`}>{t("card.monthly")}</label><input id={`${uid}m`} className="input input-small" type="number" min={0} value={f.monthly} onChange={(e) => set("monthly", e.target.value)} placeholder={t("card.noCap")} /></div>
      </div>
      <p className="field-hint note-line"><Icon name="shield" size={13} /> <span>{t("card.never")}</span></p>
      <ErrorNote>{error}</ErrorNote>
      <div className="editor-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy !== null || !f.name.trim()}>{t(busy ? "common.saving" : item ? "common.save" : "vault.saveNew")}</button>
      </div>
    </form>
  );
}

export function cardSub(item: VaultItem, t: ReturnType<typeof useT>): string {
  const c = item.card;
  if (!c) return "";
  const caps = [c.dailyCapUsd !== null ? t("card.capDay", { spent: c.spentTodayUsd.toFixed(2), cap: c.dailyCapUsd.toFixed(2) }) : "", c.monthlyCapUsd !== null ? t("card.capMonth", { spent: c.spentMonthUsd.toFixed(2), cap: c.monthlyCapUsd.toFixed(2) }) : ""].filter(Boolean);
  return [`${c.brand || t("vault.kind.card")} •••• ${c.last4}`, ...caps].join(" · ");
}

export function PaymentsList() {
  const t = useT();
  const tick = useStore((s) => s.vaultTick);
  const [list, setList] = useState<Payment[] | null>(null);
  useEffect(() => { api<{ payments: Payment[] }>("GET", "/payments").then((r) => setList(r.payments), () => setList([])); }, [tick]);
  if (!list?.length) return null;
  return (
    <>
      <h3 className="pane-heading">{t("payments.title")}</h3>
      <ul className="list">
        {list.slice(0, 20).map((p) => (
          <li key={p.id} className="list-row is-card">
            <div className="list-row-text">
              <span className="list-row-title">{p.amount.toFixed(2)} {p.currency} · {p.merchant} <span className={`chip payment-status is-${p.status}`}>{t(`payments.status.${p.status}` as Key)}</span></span>
              <span className="list-row-sub">{p.cardName} · {p.host} · {shortDate(p.createdAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Routines: cost, failures, rules of a routine ---------- */

export function RoutineExtras({ r }: { r: Routine }) {
  const t = useT();
  return (
    <div className="routine-extras">
      {r.projectedMonthlyUsd !== null && r.projectedMonthlyUsd > 0 && <span className="chip chip-quiet"><Icon name="chart" size={11} /> {t("routine.projected", { usd: r.projectedMonthlyUsd.toFixed(2) })}</span>}
      {r.skipUnchanged && <span className="chip chip-quiet" title={t("routine.skipsHint", { inputs: r.inputs.join(", ") })}><Icon name="eye" size={11} /> {t("routine.skips")}</span>}
      {r.running && <span className="chip state-working">{t("routine.runningChip")}</span>}
      {r.failures > 0 && <span className="chip state-error">{t("routine.failures", { n: r.failures })}</span>}
      {r.pausedReason && <span className="chip state-error">{r.pausedReason}</span>}
      <RoutineRules r={r} />
    </div>
  );
}

/** Rules that apply only when this routine runs (shown and added from the routine's own panel). */
function RoutineRules({ r }: { r: Routine }) {
  const t = useT();
  const tick = useStore((s) => s.rulesTick);
  const [list, setList] = useState<Rule[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, error, run } = useBusy();
  const load = () => api<RulesState>("GET", "/rules").then((s) => setList(s.rules.filter((x) => x.routineId === r.id)), () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [tick, r.id]);
  return (
    <div className="routine-rules">
      <button type="button" className="link small" onClick={() => setOpen((v) => !v)} aria-expanded={open}><Icon name="shield" size={12} /> {t("routine.rules", { n: list.length })}</button>
      {open && (
        <div className="routine-rules-body">
          {list.map((x) => <p key={x.id} className="small rule-text">« {x.text} »</p>)}
          <form className="field-inline" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run("add", async () => { await api("POST", "/rules", { text: text.trim(), routineId: r.id }); setText(""); await load(); }); }}>
            <input className="input input-small" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("routine.rulePlaceholder")} aria-label={t("routine.ruleAdd")} maxLength={500} />
            <button type="submit" className="btn btn-small" disabled={busy !== null || !text.trim()}><Icon name="plus" size={12} /> {t("rules.add")}</button>
          </form>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </div>
  );
}

/* ---------- Settings → Pages: visibility ---------- */

export function PageVisibility({ page, onChanged }: { page: SharedPage; onChanged: (v: SharedPage["visibility"]) => void }) {
  const t = useT();
  const { error, run } = useBusy();
  return (
    <span className="page-visibility">
      <select className="input input-small" value={page.visibility} aria-label={t("pages.visibility")} onChange={(e) => { const v = e.target.value as SharedPage["visibility"]; void run("v", async () => { await api("PATCH", `/pages/${enc(page.token)}`, { visibility: v }); onChanged(v); }); }}>
        <option value="link">{t("pages.vis.link")}</option>
        <option value="private">{t("pages.vis.private")}</option>
      </select>
      {error && <span className="card-error">{error}</span>}
    </span>
  );
}

/* ---------- Settings → Rules: scope and changes from the chat ---------- */

export function RuleScopeChip({ rule }: { rule: Rule }) {
  const t = useT();
  const bots = useStore((s) => s.bots);
  const routines = useStore((s) => s.bundles);
  const routineName = rule.routineId ? Object.values(routines).flatMap((b) => b?.routines ?? []).find((r) => r.id === rule.routineId)?.name : null;
  return (
    <>
      {rule.routineId && <span className="chip chip-quiet"><Icon name="clock" size={11} /> {t("rules.scope.routineNamed", { name: routineName ?? "…" })}</span>}
      {rule.trigger && <span className="chip chip-quiet"><Icon name="bolt" size={11} /> {t("rules.scope.triggerNamed", { kind: t(`rules.trigger.${rule.trigger}` as Key) })}</span>}
      {rule.botId && !rule.routineId && <span className="chip chip-quiet">{bots[rule.botId]?.name ?? "—"}</span>}
      {rule.source === "chat" && <span className="chip rule-from-chat" title={rule.quote ? `« ${rule.quote} »` : undefined}><Icon name="chat" size={11} /> {t("rules.fromChat")}</span>}
    </>
  );
}

export function RuleChanges({ state, onChange }: { state: RulesState; onChange: (s: RulesState) => void }) {
  const t = useT();
  const { error, run } = useBusy();
  const recent = state.changes.slice(0, 8);
  if (!recent.length) return null;
  return (
    <>
      <h3 className="pane-heading">{t("rules.changes")}</h3>
      <ul className="list">
        {recent.map((c) => (
          <li key={c.id} className="list-row is-card">
            <div className="list-row-text">
              <span className={`rule-text ${c.undoneAt ? "is-off" : ""}`}>{t(`rules.change.${c.action}` as Key)} « {c.text} »</span>
              <span className="list-row-sub">{c.quote ? t("rules.changeQuote", { quote: c.quote }) : ""} · {relTime(c.createdAt)}</span>
            </div>
            {c.undoneAt ? <span className="chip">{t("rules.undone")}</span> : <button type="button" className="btn btn-small" onClick={() => void run(c.id, async () => onChange(await api<RulesState>("POST", `/rules/changes/${enc(c.id)}/undo`)))}><Icon name="arrowLeft" size={12} /> {t("rules.undo")}</button>}
          </li>
        ))}
      </ul>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}
