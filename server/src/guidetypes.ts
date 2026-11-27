/**
 * The wire types of the « pas à pas » card (L153) and of the « ce qui reste à installer » list (L145), shared by the
 * server (stepguide.ts) and the web app (StepGuide.tsx). Kept apart so shared.ts does not grow: the card is the
 * "stepguide" member of shared.ts Card.
 *
 * A guide is a short list of steps. Each step says what to do in simple words and HOW WE KNOW IT WORKED:
 *  - `check`: the name of a read-only check the server runs when the owner presses « Vérifier » (guidechecks.ts) —
 *    "models.available", "two_factor.on", "doctor:<checkId>"… The step turns « OK » only when that check passes;
 *  - `check: "self"`: nothing the server can see (an app installed on the phone…): the owner says « C'est fait ».
 * `open`: the Settings page that does it (the web opens it; secrets and keys are typed there, never in the chat).
 * State: "todo" (not checked yet), "ok" (checked and true, or confirmed by the owner for a "self" step), "notyet"
 * (checked, still false: `hint` says what the check saw). The card is "done" once every step is "ok".
 */
export type GuideStepState = "todo" | "ok" | "notyet";
export interface GuideStep {
  id: string;
  title: string;
  detail: string;
  /** A command to type, shown as code (never a secret, never a path of this server). */
  command?: string;
  check: string;
  open?: string;
  state: GuideStepState;
  hint?: string;
  checkedAt?: number;
}
export type StepGuideStatus = "pending" | "done" | "dismissed";
export interface StepGuideCard {
  type: "stepguide";
  /** "setup" (L145, what remains to install) or a Docteur line ("doctor:<checkId>", L153). */
  guideId: string;
  title: string;
  intro: string;
  steps: GuideStep[];
  status: StepGuideStatus;
  /** Setup list only: how many items were already fine when it was made (shown as « déjà prêt : N »). */
  ready?: number;
  /** Docteur guides: the Docteur line's own title (a key of the web dictionaries, e.g. "doctor.twoFactor"). */
  doctorKey?: string;
}

/** Engine warm-up after a restart (L145; enginewarmup.ts). */
export type WarmState = "cold" | "warming" | "ready" | "failed" | "off";
export interface EngineWarmup { botId: string; engine: "claude-code" | "codex" | null; state: WarmState; ms: number | null; at: number | null; reason: string | null }
