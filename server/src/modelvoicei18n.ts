/** French texts of L150 (reasoning per conversation, presets per project, credit checks) and L154 (voice), merged into i18n.ts FR. */
export const MODELVOICE_FR: Record<string, string> = {
  // L150 convs.ts, projectpresets.ts, providercredit.ts, modelplusroutes.ts
  "Choose a reasoning level: light, normal, deep or maximum.": "Choisis un niveau de réflexion : légère, normale, poussée ou maximale.",
  "This key has no credit left: top it up on the provider's site, then paste it again.": "Cette clé n'a plus de crédit : recharge-la sur le site du fournisseur, puis colle-la de nouveau.",
  "Your OpenRouter credit is low: {left} $ left (alert below {threshold} $). Top up on {url} so your bots do not stop.": "Ton crédit OpenRouter baisse : il reste {left} $ (alerte sous {threshold} $). Recharge sur {url} pour que tes bots ne s'arrêtent pas.",
  "The provider refused this key.": "Le fournisseur a refusé cette clé.",
  "Too many tries. Wait a little and try again.": "Trop d'essais. Attends un peu et réessaie.",
  "Choose an amount between 0.5 and 1000 $, or 0 to turn the alert off.": "Choisis un montant entre 0,5 et 1000 $, ou 0 pour couper l'alerte.",
  // L154 calls.ts
  "(the server restarted)": "(le serveur a redémarré)",
  // L154 voice/remindercall.ts
  "Reminder calls are not set up: the owner can set them up in Settings → Voice.": "Les appels de rappel ne sont pas réglés : tu peux les régler dans Réglages → Voix.",
  "Reminder calls are turned off in Settings → Voice.": "Les appels de rappel sont coupés dans Réglages → Voix.",
  "Write the reminder first.": "Écris d'abord le rappel.",
  "A reminder call was placed less than 10 minutes ago: wait before calling again.": "Un appel de rappel a eu lieu il y a moins de 10 minutes : attends avant de rappeler.",
  "5 reminder calls were already placed in the last 24 hours: no more today.": "5 appels de rappel ont déjà eu lieu ces dernières 24 heures : plus d'appel aujourd'hui.",
  "The saved Twilio secret can no longer be read: paste it again in Settings → Voice.": "Le secret Twilio enregistré ne se lit plus : colle-le de nouveau dans Réglages → Voix.",
  "Twilio refused the account or the key.": "Twilio a refusé le compte ou la clé.",
  "Twilio could not be reached. Try again in a moment.": "Twilio ne répond pas. Réessaie dans un moment.",
  "The Account SID starts with AC followed by 32 letters and digits (Twilio console).": "L'Account SID commence par AC suivi de 32 lettres et chiffres (console Twilio).",
  "The key SID starts with AC or SK followed by 32 letters and digits.": "L'identifiant de clé commence par AC ou SK suivi de 32 lettres et chiffres.",
  "Write the phone numbers in international form, for example +33612345678.": "Écris les numéros au format international, par exemple +33612345678.",
  "The Twilio number and your own number must be different.": "Le numéro Twilio et ton propre numéro doivent être différents.",
  "Paste the Auth Token (or the API key's secret).": "Colle l'Auth Token (ou le secret de la clé d'API).",
  "This is a test of your reminder calls. Everything works.": "Ceci est un essai de tes appels de rappel. Tout fonctionne.",
  // L23 agent/creative-tools.ts
  "Answer passed to Craft Anything": "Réponse transmise à Craft Anything",
};
