import type { Engine } from "../shared.js";
import { claudeLimitFrom, claudeLimitFromText, codexLimitFrom, engineBrand } from "./sublimit.js";

// A side call must not return an earlier assistant message when the CLI subsequently failed.
// Only return classifications to callers. CLI error details and stderr can contain private request data.
export function collectSideReply(engine: Engine) {
  let answer = "", terminal: "success" | "failed" | undefined, kind: string | undefined, warning: string | undefined;
  function classify(detail: unknown) {
    const msg = typeof detail === "string" ? detail : "";
    if ((engine === "codex" ? codexLimitFrom(msg) : claudeLimitFromText(msg)) || /insufficient_quota|usage_limit_reached/i.test(msg)) return "quota";
    if (/not logged in|please run \/login|login required|not authenticated|unauthorized|\b401\b|authentication_error/i.test(msg)) return "auth";
    if (/\b429\b|rate.limit|too many requests/i.test(msg)) return "rate";
    if (/unsupported.model|model.{0,50}(?:not found|does not exist|not supported)/i.test(msg)) return "model";
    return undefined;
  }
  return {
    line(line: string) {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (!event) return;
      if (engine === "codex") {
        if (event.type === "item.completed" && event.item?.type === "agent_message") answer = String(event.item.text ?? "");
        if (event.type === "error") warning = classify(event.message) ?? warning;
        if (event.type === "turn.failed") {
          terminal = "failed";
          kind = classify(event.error?.message ?? event.message) ?? warning;
        }
        if (event.type === "turn.completed" && terminal !== "failed") terminal = "success";
      } else {
        if (event.type === "rate_limit_event" && claudeLimitFrom(event.rate_limit_info)) warning = "quota";
        if (event.type === "result") {
          if (event.is_error || (event.subtype && event.subtype !== "success")) {
            terminal = "failed";
            const errors = Array.isArray(event.errors) ? event.errors.filter((e: unknown) => typeof e === "string").join(" ") : "";
            kind = classify(event.result) ?? classify(errors) ?? warning;
          } else {
            terminal = "success";
            answer = String(event.result ?? "");
          }
        }
      }
    },
    finish(process: { code: number | null; stderr: string }, timedOut: boolean) {
      const brand = engineBrand(engine);
      if (timedOut) throw Error("Le délai de réponse de " + brand + " est dépassé. Reprends la mission pour réessayer.");
      if (terminal === "success" && process.code === 0) return answer.trim();
      const failure = kind ?? classify(process.stderr) ?? warning;
      if (failure === "quota") throw Error("Quota de l’abonnement " + brand + " atteint. Reprends la mission après son renouvellement.");
      if (failure === "auth") throw Error("La connexion " + brand + " du bot doit être renouvelée. Reconnecte le compte puis reprends la mission.");
      if (failure === "rate") throw Error(brand + " reçoit trop de requêtes. Reprends la mission dans un moment.");
      if (failure === "model") throw Error("Le modèle sélectionné est indisponible pour ce compte " + brand + ".");
      throw Error(brand + " a interrompu la réponse" + (process.code ? " (code " + process.code + ")" : "") + ". Reprends la mission pour réessayer.");
    },
  };
}
