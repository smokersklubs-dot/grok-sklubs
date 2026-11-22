import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import "./research.css";
import { FindingMeta, ResearchOptions, SourceStates } from "./ResearchExtras";
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
  const loc = (f: string, e: string) => (fr ? f : e);
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
        <h2>{loc("Recherche approfondie", "Deep research")}</h2>
        {reports.length > 0 && (
          <button className="btn btn-small" onClick={newReport}>
            {loc("Nouveau rapport", "New report")}
          </button>
        )}
      </header>
      {reports.length > 0 && (
        <label>
          {loc("Rapports du bot", "Bot reports")}
          <select
            className="input"
            value={editing ? "" : (open?.id ?? "")}
            onChange={(e) => {
              setSelected(e.target.value);
              setEditing(false);
            }}
          >
            {editing && <option value="">{loc("Choisir un rapport", "Choose a report")}</option>}
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
            {loc("Sujet", "Topic")}
            <input
              className="input"
              required
              maxLength={350}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            {loc("Questions du plan, une par ligne", "Plan questions, one per line")}
            <textarea
              className="input"
              rows={4}
              required
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={loc(
                "Que sait-on ? Sur quelles données ? Quelles limites ?",
                "What do we know? What evidence supports it? What are its limits?",
              )}
            />
          </label>
          <label>
            {loc("Sources de départ, une adresse par ligne", "Starting sources, one URL per line")}
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
            {loc("Chercher aussi sur le web", "Also search the web")}
          </label>
          <ResearchOptions fr={fr} window={period} setWindow={setPeriod} extras={extras} setExtras={setExtras} />
          <label className="research-check">
            <input type="checkbox" checked={model} onChange={(e) => setModel(e.target.checked)} />
            {loc("Synthétiser avec le modèle du bot", "Summarize with the bot’s model")}
          </label>
          <label className="research-check">
            <input
              type="checkbox"
              disabled={!account.provider}
              checked={!!account.provider && includeX}
              onChange={(e) => setIncludeX(e.target.checked)}
            />
            {loc("Inclure X (tarif du fournisseur)", "Include X (provider charges may apply)")}
          </label>
          <button className="btn" disabled={busy}>
            {loc("Lancer la recherche", "Start research")}
          </button>
        </form>
      ) : (
        <>
          <h3>{open.brief.subject}</h3>
          <p role="status">
            {open.state === "queued"
              ? loc("En cours", "In progress")
              : open.state === "done"
                ? loc("Terminé", "Completed")
                : loc("Interrompu", "Interrupted")}{" "}
            · {open.sections.length}/{open.brief.plan.length}{" "}
            {loc("questions traitées", "questions processed")} · {covered}{" "}
            {loc("avec sources", "with evidence")}
          </p>
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
              {loc("Reprendre à la dernière étape", "Resume from checkpoint")}
            </button>
          )}
          <ol className="research-sections">
            {open.brief.plan.map((question, i) => {
              const step = open.sections[i];
              return (
                <li key={question}>
                  <h4>{question}</h4>
                  {step ? (
                    <>
                      <small>
                        {step.read} {loc("sources lues", "sources read")} ·{" "}
                        {new Date(step.at).toLocaleDateString(fr ? "fr-FR" : "en")}
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
                    <small>{loc("À traiter", "Pending")}</small>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <details>
        <summary>
          {loc("Source X", "X source")} ·{" "}
          {account.personal
            ? loc("jeton personnel enregistré", "personal token saved")
            : account.provider
              ? loc("configurée sur le serveur", "configured on server")
              : loc("non configurée", "not configured")}
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
            {loc("Jeton Bearer de l’API X", "X API bearer token")}
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
              {loc("Enregistrer", "Save")}
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
                {loc("Déconnecter", "Disconnect")}
              </button>
            )}
          </div>
        </form>
      </details>
    </section>
  );
}
