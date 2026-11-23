import { findSecrets } from "../../../server/src/shared";
import { printableHtml } from "../lib/chatexport";
import { renderMarkdown } from "../lib/markdown";
import { downloadText, reportFileName, reportMarkdown, type ExportableReport } from "../lib/reportexport";
import { useStore } from "../store";

/** L156: « Exporter en Markdown » and « … en PDF » (the browser's print box) for the research report on screen. */
export function ReportExport({ report, fr }: { report: ExportableReport; fr: boolean }) {
  const loc = (f: string, e: string) => (fr ? f : e);
  const markdown = () => reportMarkdown(report, fr, (t) => findSecrets(t));
  return (
    <div className="studio-actions report-export">
      <button type="button" className="btn btn-small" onClick={() => downloadText(reportFileName(report, "md"), markdown(), "text/markdown;charset=utf-8")}>
        {loc("Exporter en Markdown", "Export as Markdown")}
      </button>
      <button type="button" className="btn btn-small" onClick={() => {
        const w = window.open("", "_blank");
        if (!w) { useStore.getState().showToast(loc("La fenêtre a été bloquée : autorise les fenêtres pour ce site.", "The window was blocked: allow pop-ups for this site.")); return; }
        w.document.open(); w.document.write(printableHtml(report.brief.subject, renderMarkdown(markdown()), fr ? "fr" : "en")); w.document.close();
        w.focus(); setTimeout(() => w.print(), 300);
      }}>
        {loc("Exporter en PDF", "Export as PDF")}
      </button>
    </div>
  );
}
