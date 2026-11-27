// « Chantier » on the phone (src/lib/chantier.ts, used by src/screens/Chantiers.tsx): what may be done in each status, a colour for every state,
// and the same texts in both languages.
import { phoneActions, STATUS_TONE, TASK_TONE } from "../src/lib/chantier";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";


test("approve only a proposed plan; stop only a chantier under way", () => {
  expect(phoneActions("proposed")).toEqual({ approve: true, stop: false });
  expect(phoneActions("running")).toEqual({ approve: false, stop: true });
  expect(phoneActions("waiting_owner")).toEqual({ approve: false, stop: true });
  expect(phoneActions("done")).toEqual({ approve: false, stop: false });
  expect(phoneActions("stopped")).toEqual({ approve: false, stop: false });
});

test("every state and status has a colour and a text in both languages", () => {
  for (const s of Object.keys(TASK_TONE)) { expect((fr as Record<string, string>)[`chantier.state.${s}`]).toBeTruthy(); expect((en as Record<string, string>)[`chantier.state.${s}`]).toBeTruthy(); }
  for (const s of Object.keys(STATUS_TONE)) { expect((fr as Record<string, string>)[`chantier.status.${s}`]).toBeTruthy(); expect((en as Record<string, string>)[`chantier.status.${s}`]).toBeTruthy(); }
  for (const a of ["retry", "accept", "redo", "stop_branch", "resume"]) expect((fr as Record<string, string>)[`chantier.answer.${a}`]).toBeTruthy();
});
