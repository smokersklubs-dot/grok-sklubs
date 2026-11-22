import { tr } from "../i18n.js";
import type { Locale } from "../shared.js";

/**
 * Texts written by the wave-6 turn and routine work (routinepacing / scheduler, receipt.ts, turnbudget.ts, askrules.ts,
 * goalcriteria.ts, routinecondition.ts). English is the key; French here, so the shared dictionary (i18n.ts) stays as it is.
 */
export const LOOP_FR: Record<string, string> = {
  // L62 routine failures (scheduler.ts, routinepacing.ts).
  "The routine “{name}” failed: {detail}. I will try again in {min} min.": "La routine « {name} » a échoué : {detail}. Je réessaie dans {min} min.",
  "New try {n}/{max} of the routine “{name}” after a failure.": "Nouvel essai {n}/{max} de la routine « {name} » après un échec.",
  "The routine “{name}” keeps failing ({n} times in a row): I will run it less often — at most once every {hours} h, then longer — until a run works again. Fix it, or pause it yourself.": "La routine « {name} » échoue encore ({n} fois de suite) : je la lance moins souvent — au plus une fois toutes les {hours} h, puis plus espacé — jusqu'à ce qu'une exécution marche. Corrige-la, ou mets-la en pause toi-même.",
  "Still failing {n} times in a row: {detail}": "Toujours en échec {n} fois de suite : {detail}",
  // L85 receipt (receipt.ts).
  "Receipt": "Reçu",
  "said but not done: {list}": "dit mais pas fait : {list}",
  "done but not said: {list}": "fait mais pas dit : {list}",
  "sent": "envoyé", "saved": "enregistré", "scheduled": "programmé", "created": "créé", "deleted": "supprimé", "paid": "payé", "published": "publié",
  // Audit DS-Bot #63 claims (claims.ts, receipt.ts).
  "links a file that is not there: {list}": "lien vers un fichier absent : {list}",
  "says work is under way, but nothing is running": "annonce un travail en cours, mais rien ne tourne",
  // Audit DS-Bot #81–#84 memory (memorymarks.ts, memorytidy.ts, roommemory.ts).
  "Memory updated: “{old}” is now “{text}”.": "Mémoire mise à jour : « {old} » devient « {text} ».",
  "I tidied my memory: {merged} merged, {retired} set aside.": "J'ai rangé ma mémoire : {merged} fusionnée(s), {retired} mise(s) de côté.",
  "{n} change(s) touch a sensitive note: I ask you first.": "{n} changement(s) touchent une note sensible : je te demande d'abord.",
  // L90 turn time budget (turnbudget.ts).
  "I stopped this turn after {min} minutes: that is the time budget for one turn. What I did so far is kept. Press Continue, or just tell me to continue, to pick it back up.": "J'ai arrêté ce tour après {min} minutes : c'est le temps prévu pour un tour. Ce que j'ai fait est gardé. Appuie sur Continuer, ou dis-moi simplement de continuer, pour reprendre.",
  // L96 helpers queued (askrules.ts).
  "Helper queued: {label} (starts when one of the {max} running helpers finishes)": "Assistant en file : {label} (il démarre quand l'un des {max} assistants en cours a fini)",
  // L89 goals (goalcriteria.ts).
  "waiting for your approval": "attend ton accord",
  "Goal done, waiting for your approval: {objective}": "Objectif terminé, il attend ton accord : {objective}",
  // L86 conditions (routinecondition.ts).
  "Condition not met: {why}": "Condition non remplie : {why}",
};

export function lt(locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}): string {
  return locale === "fr" && LOOP_FR[en] ? tr("en", LOOP_FR[en], vars) : tr(locale, en, vars);
}
