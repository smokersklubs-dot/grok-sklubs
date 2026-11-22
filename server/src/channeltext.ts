/**
 * L162: what Sklubot says on Slack, Discord and Telegram to the owner and to the people who ask for access, in the
 * owner's language (English key, French text), like telegramplus.ts tgText.
 */
import type { Locale } from "./shared.js";

const FR: Record<string, string> = {
  "Yes": "Oui", "No": "Non",
  "✅ Allowed": "✅ Autorisé", "❌ Refused": "❌ Refusé",
  "This request was already answered.": "Cette demande a déjà une réponse.",
  "🔒 This one must be answered in the app.": "🔒 Celle-ci se valide dans l'appli.",
  "🔒 Only the owner of this bot can answer.": "🔒 Seul le propriétaire de ce bot peut répondre.",
  "✅ {bot} is linked to you here.": "✅ {bot} est relié à toi ici.",
  "🔒 To link this bot, send the code shown in Sklubot.": "🔒 Pour relier ce bot, envoie le code affiché dans Sklubot.",
  "🔒 {bot} only talks to people its owner approved. Your request code: {code} (valid 1 hour). Give it to the owner so they can approve you in Sklubot.":
    "🔒 {bot} ne parle qu'aux personnes que son propriétaire a acceptées. Ton code de demande : {code} (valable 1 heure). Donne-le au propriétaire pour qu'il t'accepte dans Sklubot.",
  "🔒 Your request is waiting for the owner. Your code: {code}.": "🔒 Ta demande attend le propriétaire. Ton code : {code}.",
  "🔒 Too many requests are waiting for the owner. Try again in an hour.": "🔒 Trop de demandes attendent le propriétaire. Réessaie dans une heure.",
  "🔒": "🔒",
  "✅ The owner approved you: you can now write to {bot}.": "✅ Le propriétaire t'a accepté : tu peux maintenant écrire à {bot}.",
  "🔒 Only the owner can send files to {bot}. Write your message as text.": "🔒 Seul le propriétaire peut envoyer des fichiers à {bot}. Écris ton message en texte.",
  "Slow down a little: too many messages in a minute.": "Doucement : trop de messages en une minute.",
  "That message is too long.": "Ce message est trop long.",
  "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.": "⏸ {bot} est en pause : ton message est gardé et sera traité à la reprise.",
  "Write to me in a direct message.": "Écris-moi en message privé.",
  "This file is over 20 MB: send it from the app instead.": "Ce fichier dépasse 20 Mo : envoie-le depuis l'appli.",
  "I could not get this file. Try again, or send it from the app.": "Je n'ai pas pu récupérer ce fichier. Réessaie, ou envoie-le depuis l'appli.",
  "(file: {name})": "(fichier : {name})",
  "“{name}” is too big for this channel. It is in the app.": "« {name} » est trop gros pour ce canal. Il est dans l'appli.",
  "👍 = yes · 👎 = no": "👍 = oui · 👎 = non",
  "🔒 Answer in the app.": "🔒 Réponds dans l'appli.",
  "“{name}” is in the app.": "« {name} » est dans l'appli.",
  "Group “{name}” on {channel}": "Groupe « {name} » sur {channel}",
  "{bot} was called in the group “{group}” on {channel}: turn it on in Sklubot if you want it to answer there.": "{bot} a été appelé dans le groupe « {group} » sur {channel} : active ce groupe dans Sklubot si tu veux qu'il y réponde.",
  "🔒 {bot} does not answer in this group yet: its owner must turn the group on in Sklubot.": "🔒 {bot} ne répond pas encore dans ce groupe : son propriétaire doit activer le groupe dans Sklubot.",
  "🔒 {name}, {bot} only answers people its owner approved. Write to it in a direct message to ask for access.": "🔒 {name}, {bot} ne répond qu'aux personnes que son propriétaire a acceptées. Écris-lui en message privé pour demander l'accès.",
  "🔒 Files are not taken in a group: send them to {bot} in a direct message.": "🔒 Les fichiers ne sont pas pris dans un groupe : envoie-les à {bot} en message privé.",
  "Conversation with {name} on {channel}": "Conversation avec {name} sur {channel}",
  "{name} asks to talk to {bot} on {channel} (code {code}).": "{name} demande à parler à {bot} sur {channel} (code {code}).",
};

export const chText = (locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}) =>
  (locale === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

export const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord", imap: "IMAP" };
