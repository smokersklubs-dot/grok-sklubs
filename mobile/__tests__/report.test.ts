// L31: « Signaler cette réponse » on the phone (lib/report.ts, components/ReportSheet.tsx): only a finished reply of the person's own
// bot can be reported, and the request matches the server's route (server/src/reports.ts).
import { canReport, reportRequest, REPORT_REASONS } from "../src/lib/report";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";

describe("report a reply", () => {
  it("is offered on a finished reply of an owned bot only", () => {
    expect(canReport({ access: null } as never, { role: "assistant", text: "Bonjour", streaming: false })).toBe(true);
    expect(canReport({ access: null } as never, { role: "assistant", text: "Bon", streaming: true })).toBe(false);
    expect(canReport({ access: null } as never, { role: "user", text: "Moi", streaming: false })).toBe(false);
    expect(canReport({ access: { role: "viewer" } } as never, { role: "assistant", text: "Bonjour", streaming: false })).toBe(false);
  });
  it("posts the reason and a trimmed note to the row's report route", () => {
    expect(reportRequest({ botId: "bot a", seq: 12 }, "wrong", "  faux  ")).toEqual({ path: "/bots/bot%20a/rows/12/report", body: { reason: "wrong", note: "faux" } });
    expect(reportRequest({ botId: "b", seq: 1 }, "other", "x".repeat(900)).body.note).toHaveLength(500);
  });
  it("has a label for every reason in both languages", () => {
    for (const r of REPORT_REASONS) {
      expect((fr as Record<string, string>)[`report.reason.${r}`]).toBeTruthy();
      expect((en as Record<string, string>)[`report.reason.${r}`]).toBeTruthy();
    }
  });
});
