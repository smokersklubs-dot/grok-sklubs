import { tr } from "../i18n.js";
import type { Locale } from "../shared.js";

/**
 * Texts written by the turn guards of this wave (sameaction.ts, promises.ts, restartguard.ts, delegatedask.ts,
 * workmodel.ts, routinethread.ts). English is the key; French here, so the shared dictionary (i18n.ts) stays as it is.
 */
export const GUARD_FR: Record<string, string> = {
  "already done": "déjà fait",
  "{bot} said it would do it, but did not (asked {n} times to do the work). Nothing is confirmed: ask again, or tell it how to go on.": "{bot} a dit qu'il allait le faire, mais ne l'a pas fait (relancé {n} fois pour faire le travail). Rien n'est confirmé : redemande-lui, ou dis-lui comment continuer.",
  "The server restarted while I was doing “{action}”. I am not redoing it on my own: it may already have gone through. Check it, then press Continue: I will look at what is done before redoing anything.": "Le serveur a redémarré pendant que je faisais « {action} ». Je ne le refais pas tout seul : c'est peut-être déjà passé. Vérifie, puis appuie sur Continuer : je regarderai ce qui est fait avant de refaire quoi que ce soit.",
  "The server restarted during my work, after I had done “{action}”. I am not picking it up on my own, so nothing is done twice. Check where things stand, then press Continue: I will look at what is done before redoing anything.": "Le serveur a redémarré pendant mon travail, après que j'ai fait « {action} ». Je ne reprends pas tout seul, pour que rien ne soit fait deux fois. Vérifie où on en est, puis appuie sur Continuer : je regarderai ce qui est fait avant de refaire quoi que ce soit.",
  "Interrupted by a server restart during “{action}”: not replayed.": "Interrompue par un redémarrage pendant « {action} » : pas rejouée.",
  "Question from {helper}, decided for you by {lead}: “{question}” → “{answer}”. Not what you want? Write the right answer here, or make it a rule.": "Question de {helper}, décidée pour toi par {lead} : « {question} » → « {answer} ». Ce n'est pas ce que tu veux ? Écris la bonne réponse ici, ou fais-en une règle.",
  "Routine “{name}”": "Routine « {name} »",
  "Routine “{name}”: running…": "Routine « {name} » : en cours…",
  "Routine “{name}”: {result}": "Routine « {name} » : {result}",
  "Routine “{name}”: waiting for your approval — open the thread.": "Routine « {name} » : attend ton accord — ouvre le fil.",
  "Routine “{name}”: done, nothing to report.": "Routine « {name} » : faite, rien à signaler.",
  "Routine “{name}”: stopped ({why}). Open the thread to see the steps.": "Routine « {name} » : arrêtée ({why}). Ouvre le fil pour voir les étapes.",
  "Loop between bots stopped: {from} kept sending work back and forth with {to}. Write to {to} to get it going again.": "Boucle entre bots arrêtée : {from} renvoyait sans fin du travail avec {to}. Écris à {to} pour relancer.",
  "{from} handed back a request {to} had already passed on: stopped, so they do not pass it around in circles.": "{from} a rendu une demande que {to} avait déjà transmise : arrêté, pour qu'elle ne tourne pas en rond.",
};

export function gt(locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}): string {
  return locale === "fr" && GUARD_FR[en] ? tr("en", GUARD_FR[en], vars) : tr(locale, en, vars);
}
