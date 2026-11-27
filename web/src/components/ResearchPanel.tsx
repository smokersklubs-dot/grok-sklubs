import { intlLocale, t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import "./research.css";
import { FindingMeta, ResearchOptions, SourceStates } from "./ResearchExtras";
import { ReportWatch, ResearchArchive } from "./ResearchWatch";
import { ReportExport } from "./ReportExport";
import type { ResearchExtra, ResearchWindow, SourceState } from "../types";

interface Report {
  id: string;
  state: string;
  brief: { subject: string; plan: string[] };
  sections: {
    question: string;
    read: number;
    findings: { url: string; title: string; claim: string; quote: string; published?: string; engagement?: string }[];
    notes: string[];
    sources?: SourceState[];
    at: number;
  }[];
}
interface XAccount {
  provider: "x" | "xai" | null;
  personal: boolean;
}
export function ResearchPanel({ bot, fr, active }: { bot: string; fr: boolean; active: boolean }) {
  const [reports, setReports] = useState<Report[]>([]),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(""),
    [plan, setPlan] = useState(""),
    [seeds, setSeeds] = useState("");
  const [discover, setDiscover] = useState(true),
    [model, setModel] = useState(true),
    [includeX, setIncludeX] = useState(false);
  const [period, setPeriod] = useState<ResearchWindow | "auto">("auto"),
    [extras, setExtras] = useState<ResearchExtra[]>(["hn"]);
  const [account, setAccount] = useState<XAccount>({ provider: null, personal: false }),
    [token, setToken] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const requestId = useRef(crypto.randomUUID()),
    pending = useRef(false);
  const base = "/bots/" + encodeURIComponent(bot) + "/research";
  const open = reports.find((r) => r.id === selected) ?? reports[0];
  useEffect(() => {
    if (!active) return;
    const ctl = new AbortController();
    let timer: number | undefined;
    async function read() {
      try {
        const { reports: latest } = await api<{ reports: Report[] }>("GET", base, undefined, ctl.signal);
        if (ctl.signal.aborted) return;
        setReports(latest);
        if (latest.some((r) => r.state === "queued")) timer = window.setTimeout(() => void read(), 2000);
      } catch (e) {
        if (!ctl.signal.aborted) {
          setError(errText(e));
          timer = window.setTimeout(() => void read(), 6000);
        }
      }
    }
    void read();
    void api<XAccount>("GET", "/research/x-account", undefined, ctl.signal)
      .then((v) => {
        if (!ctl.signal.aborted) setAccount(v);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(errText(e));
      });
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [base, active, refresh]);
  const lines = (s: string) =>
    s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const newReport = () => {
    setSubject("");
    setPlan("");
    setSeeds("");
    setDiscover(true);
    setModel(true);
    setIncludeX(false);
    setError("");
    setEditing(true);
    requestId.current = crypto.randomUUID();
  };
  const covered = open?.sections.filter((s) => s.findings.length).length ?? 0;
  return (
    <section className="dock-reader research-panel">
      <header className="studio-actions">
        <h2>{tr("research.deepResearch")}</h2>
        {reports.length > 0 && (
          <button className="btn btn-small" onClick={newReport}>
            {tr("research.newReport")}
          </button>
        )}
      </header>
      {reports.length > 0 && (
        <label>
          {tr("research.botReports")}
          <select
            className="input"
            value={editing ? "" : (open?.id ?? "")}
            onChange={(e) => {
              setSelected(e.target.value);
              setEditing(false);
            }}
          >
            {editing && <option value="">{tr("research.chooseReport")}</option>}
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.brief.subject}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {editing || !open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const report = await api<Report>("POST", base, {
                subject,
                plan: lines(plan),
                seeds: lines(seeds),
                model,
                discover,
                includeX,
                ...(period === "auto" ? {} : { window: period }),
                extras,
                requestId: requestId.current,
              });
              setReports((prev) => [report, ...prev.filter((r) => r.id !== report.id)]);
              setSelected(report.id);
              setEditing(false);
            });
          }}
        >
          <label>
            {tr("dj.topicLabel")}
            <input
              className="input"
              required
              maxLength={350}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            {tr("research.planQuestionsOnePer")}
            <textarea
              className="input"
              rows={4}
              required
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={tr("research.whatDoWeKnow")}
            />
          </label>
          <label>
            {tr("research.startingSourcesOneUrl")}
            <textarea
              className="input"
              rows={2}
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="research-check">
            <input type="checkbox" checked={discover} onChange={(e) => setDiscover(e.target.checked)} />
            {tr("research.alsoSearchWeb")}
          </label>
          <ResearchOptions fr={fr} window={period} setWindow={setPeriod} extras={extras} setExtras={setExtras} />
          <label className="research-check">
            <input type="checkbox" checked={model} onChange={(e) => setModel(e.target.checked)} />
            {tr("research.summarizeBotSModel")}
          </label>
          <label className="research-check">
            <input
              type="checkbox"
              disabled={!account.provider}
              checked={!!account.provider && includeX}
              onChange={(e) => setIncludeX(e.target.checked)}
            />
            {tr("research.includeXProviderCharges")}
          </label>
          <button className="btn" disabled={busy}>
            {tr("research.startResearch")}
          </button>
        </form>
      ) : (
        <>
          <h3>{open.brief.subject}</h3>
          <p role="status">
            {open.state === "queued"
              ? tr("tasks.filter.open")
              : open.state === "done"
                ? tr("research.completed")
                : tr("stop.cause.interrupted")}{" "}
            · {open.sections.length}/{open.brief.plan.length}{" "}
            {tr("research.questionsProcessed")} · {covered}{" "}
            {tr("research.evidence")}
          </p>
          <ReportExport report={open} fr={fr} />
          {open.state === "interrupted" && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("POST", base + "/" + open.id + "/continue");
                })
              }
            >
              {tr("research.resumeFromCheckpoint")}
            </button>
          )}
          {open.state === "done" && <ReportWatch base={base} report={open.id} fr={fr} />}
          <ol className="research-sections">
            {open.brief.plan.map((question, i) => {
              const step = open.sections[i];
              return (
                <li key={question}>
                  <h4>{question}</h4>
                  {step ? (
                    <>
                      <small>
                        {step.read} {tr("research.sourcesRead")} ·{" "}
                        {new Date(step.at).toLocaleDateString(intlLocale())}
                      </small>
                      {step.findings.map((f, j) => (
                        <div className="research-finding" key={j}>
                          {f.claim && <p>{f.claim}</p>}
                          <blockquote>{f.quote}</blockquote>
                          <a href={f.url} target="_blank" rel="noopener noreferrer">
                            {f.title || f.url}
                          </a>
                          <FindingMeta published={f.published} engagement={f.engagement} fr={fr} />
                        </div>
                      ))}
                      <SourceStates states={step.sources} fr={fr} />
                      {step.notes.map((n) => (
                        <p className="muted" key={n}>
                          {n}
                        </p>
                      ))}
                    </>
                  ) : (
                    <small>{tr("research.pending")}</small>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <ResearchArchive fr={fr} />
      <details>
        <summary>
          {tr("research.xSource")} ·{" "}
          {account.personal
            ? tr("research.personalTokenSaved")
            : account.provider
              ? tr("research.configuredServer")
              : tr("research.notConfigured")}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api("PUT", "/research/x-account", { token });
              setToken("");
            });
          }}
        >
          <label>
            {tr("research.xApiBearerToken")}
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <div className="studio-actions">
            <button className="btn btn-small" disabled={busy || !token.trim()}>
              {tr("common.save")}
            </button>
            {account.personal && (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api("DELETE", "/research/x-account");
                    setToken("");
                    setIncludeX(false);
                  })
                }
              >
                {tr("native.disconnect")}
              </button>
            )}
          </div>
        </form>
      </details>
    </section>
  );
}
