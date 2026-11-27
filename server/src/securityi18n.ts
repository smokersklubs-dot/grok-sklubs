/**
 * French texts of the Lot 1 security modules (consent.ts, privatejudge.ts, native/mailproof.ts, netjournal.ts,
 * vaultaccess.ts), merged into i18n.ts's dictionary. English is the key, as there. No import: i18n.ts loads it first.
 */
export const SECURITY_FR: Record<string, string> = {
  // L30 — consent before copying a voice or a face (agent/consent.ts).
  "copy a voice or a face ({what})": "copier une voix ou un visage ({what})",
  "{bot} wants to copy a voice or a face ({what}). Is it you, or did the person give their written consent?": "{bot} veut copier une voix ou un visage ({what}). C'est toi, ou la personne a donné son accord écrit ?",
  "No copy of a voice or a face without consent: allow only if it is your own voice or face, or if the person gave you their written agreement. Otherwise refuse: nothing will be copied.": "Pas de copie de voix ou de visage sans accord : autorise seulement si c'est ta propre voix ou ton propre visage, ou si la personne t'a donné son accord écrit. Sinon refuse : rien ne sera copié.",
  // L36 — private reads after outside content (agent/privatejudge.ts).
  "notes (memory)": "notes (mémoire)", "other conversations": "autres conversations", "vault": "coffre", "files on your computer": "fichiers de ton ordinateur",
  "{bot} has read outside content and now wants to look in your {what}. Allow it?": "{bot} a lu du contenu extérieur et veut maintenant regarder dans tes {what}. L'autoriser ?",
  "look in your {what}": "regarder dans tes {what}",
  "A page or a message may be trying to make the bot search your private things. Allow only if you asked for it.": "Une page ou un message essaie peut-être de faire fouiller tes affaires privées par le bot. Autorise seulement si tu l'as demandé.",
  "Looking for: {q}": "Recherche : {q}",
  // L29 — sent mail checked afterwards (native/mailproof.ts).
  "Email check: the email {bot} sent from {account} is not in its sent mail. Look in the mailbox before sending it again (fingerprint {fp}).": "Vérification d'e-mail : le message envoyé par {bot} depuis {account} n'est pas dans ses « Envoyés ». Regarde la boîte avant de le renvoyer (empreinte {fp}).",
  "Email check: the email {bot} sent from {account} is not exactly the approved text (approved {fp}, sent {sent}). Look at it in the sent mail.": "Vérification d'e-mail : le message envoyé par {bot} depuis {account} n'est pas exactement le texte validé (validé {fp}, envoyé {sent}). Regarde-le dans les « Envoyés ».",
  // L33 / L39 — network journal (netjournal.ts).
  "{bot} followed a link to a new site, {host}, after reading outside content. Check that you expected it.": "{bot} a suivi un lien vers un nouveau site, {host}, après avoir lu du contenu extérieur. Vérifie que tu t'y attendais.",
  "{bot} reached a new site for the first time: {host} ({via}). Its network journal is in its settings (Security).": "{bot} a contacté un nouveau site pour la première fois : {host} ({via}). Son journal réseau est dans ses réglages (Sécurité).",
  "page opened": "page ouverte", "page read": "page lue", "click": "clic", "API call": "appel d'API", "call with a secret": "appel avec un secret", "program on its computer": "programme de son ordinateur", "file downloaded": "fichier téléchargé", "app": "appli",
  // L41 — "ask every time" (vaultaccess.ts).
  "Allow {bot} to use {item} from the vault?": "Autoriser {bot} à utiliser {item} du coffre ?", "use {item} from the vault": "utiliser {item} du coffre",
  "Set to \"ask every time\" in the vault.": "Réglé sur « demander à chaque fois » dans le coffre.",
};
