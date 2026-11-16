/**
 * The privacy policy of the Sklubot apps (phone app, website), served at /confidentialite (French) and /privacy
 * (English) without a session, so that app stores and visitors can read it. Plain HTML, no script.
 * Keep it in step with mobile/STORE.md (data safety answers): it describes what the code really does.
 */

const css = "body{font-family:system-ui,-apple-system,sans-serif;background:#f4f2ee;color:#1e2024;margin:0;padding:24px 16px;line-height:1.6}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e4e0d8;border-radius:14px;padding:24px 28px}h1{font-size:1.6rem;margin-top:0}h2{font-size:1.15rem;margin-top:1.6em}a{color:#2a6fb8}.muted{color:#5a5f67;font-size:.95rem}@media(prefers-color-scheme:dark){body{background:#131416;color:#eceef1}main{background:#1a1c1f;border-color:#2b2e32}.muted{color:#a7adb5}a{color:#79b0ee}}";

const FR = `<h1>Politique de confidentialité de Sklubot</h1>
<p class="muted">Applis Sklubot (Android, iPhone) et site web Sklubot. Dernière mise à jour : 16 novembre 2026.</p>
<h2>En bref</h2>
<p>Sklubot est un logiciel libre que chacun héberge sur son propre serveur. L’appli est un client de <strong>ton</strong> serveur Sklubot : elle ne parle qu’à l’adresse que tu saisis, et tes données restent sur ce serveur. Il n’y a ni publicité, ni mesure d’audience, ni traceur, et aucune donnée n’est vendue ni partagée à des fins commerciales.</p>
<h2>Qui est responsable de tes données</h2>
<p>La personne ou l’organisation qui gère le serveur Sklubot auquel tu te connectes (son adresse est affichée dans l’appli, Réglages → Serveur). C’est à elle que tu t’adresses pour toute question ou demande sur tes données.</p>
<h2>Ce que l’appli traite</h2>
<ul>
<li><strong>Compte</strong> : ton adresse e-mail, ton nom et ton mot de passe, envoyés à ton serveur pour créer ton compte ou te connecter. Le mot de passe n’est jamais enregistré sur le téléphone.</li>
<li><strong>Session</strong> : après la connexion, un jeton de session est gardé sur le téléphone dans le stockage sécurisé du système (Android Keystore, trousseau iOS) et n’est envoyé qu’à ton serveur.</li>
<li><strong>Messages et fichiers</strong> : ce que tu écris à tes bots, et les photos ou fichiers que tu choisis de joindre, sont envoyés à ton serveur. L’appli n’accède à tes photos, à l’appareil photo ou à tes fichiers que lorsque tu le demandes, pour une pièce jointe.</li>
<li><strong>Notifications</strong> : l’appli affiche des notifications locales (un bot t’attend, une réponse est arrivée). Elles sont créées sur le téléphone à partir de ton serveur ; aucun service de notification tiers n’est utilisé.</li>
<li><strong>Préférences</strong> : langue, thème et choix de notifications restent sur le téléphone.</li>
</ul>
<p>L’appli ne collecte ni ta position, ni tes contacts, ni ton micro, ni d’identifiant publicitaire.</p>
<h2>Ce que fait ton serveur</h2>
<p>Ton serveur garde tes conversations, les fichiers de tes bots, leurs souvenirs et routines. Selon sa configuration, il peut envoyer le texte de tes conversations à un fournisseur de modèle d’IA choisi par la personne qui le gère (par exemple une API de modèle de langage) pour que les bots répondent, et utiliser les applis que tu as connectées toi-même. Ces envois partent du serveur, pas du téléphone.</p>
<h2>Version « complète » (installée hors des boutiques) : contrôle du téléphone</h2>
<p>La version complète de l’appli, installée depuis un fichier, contient en plus le « contrôle du téléphone ». Il n’est jamais activé sans toi : tu dois l’allumer, l’associer à ton serveur et activer toi-même le service d’accessibilité de Sklubot dans les réglages d’Android. Un bot ne peut alors voir l’écran (captures et texte affiché) et agir (toucher, écrire, ouvrir une appli) qu’après ton accord sur le téléphone, pendant une session signalée par une bannière et une notification avec un bouton Stop. Les applis que tu bloques (banque, paiement…) restent inaccessibles. Ces captures et actions vont uniquement à ton serveur. La version publiée sur les boutiques d’applications ne contient pas cette fonction.</p>
<h2>Sécurité</h2>
<p>Les échanges avec ton serveur sont chiffrés (HTTPS). Le jeton de session est stocké chiffré sur le téléphone.</p>
<h2>Durée de conservation et suppression</h2>
<p>Tes données sont gardées sur ton serveur tant que ton compte existe. Tu peux supprimer ton compte et tout ce qu’il contient depuis l’appli (Réglages → Supprimer mon compte) ou depuis le site (Réglages → Compte). Se déconnecter efface le jeton de session du téléphone ; désinstaller l’appli efface tout ce qu’elle gardait sur le téléphone.</p>
<h2>Enfants</h2>
<p>Sklubot n’est pas destiné aux enfants de moins de 13 ans.</p>
<h2>Contact</h2>
<p>Pour toute question sur tes données, contacte la personne qui gère ton serveur Sklubot.</p>`;

const EN = `<h1>Sklubot privacy policy</h1>
<p class="muted">Sklubot apps (Android, iPhone) and the Sklubot website. Last updated: November 16, 2026.</p>
<h2>In short</h2>
<p>Sklubot is free software that people host on their own server. The app is a client of <strong>your</strong> Sklubot server: it only talks to the address you enter, and your data stays on that server. There are no ads, no analytics, no trackers, and no data is sold or shared for commercial purposes.</p>
<h2>Who is responsible for your data</h2>
<p>The person or organisation that runs the Sklubot server you connect to (its address is shown in the app, Settings → Server). Contact them with any question or request about your data.</p>
<h2>What the app handles</h2>
<ul>
<li><strong>Account</strong>: your email address, name and password, sent to your server to create your account or sign in. The password is never stored on the phone.</li>
<li><strong>Session</strong>: after signing in, a session token is kept on the phone in the system’s secure storage (Android Keystore, iOS Keychain) and is only ever sent to your server.</li>
<li><strong>Messages and files</strong>: what you write to your bots, and the photos or files you choose to attach, are sent to your server. The app only opens your photos, camera or files when you ask, for an attachment.</li>
<li><strong>Notifications</strong>: the app shows local notifications (a bot needs you, a reply arrived). They are created on the phone from your server; no third-party notification service is used.</li>
<li><strong>Preferences</strong>: language, theme and notification choices stay on the phone.</li>
</ul>
<p>The app does not collect your location, contacts, microphone or any advertising identifier.</p>
<h2>What your server does</h2>
<p>Your server keeps your conversations, your bots’ files, memories and routines. Depending on how it is set up, it may send the text of your conversations to an AI model provider chosen by the person who runs it (for example a language model API) so the bots can answer, and use the apps you connected yourself. Those requests leave from the server, not from the phone.</p>
<h2>“Complete” edition (installed outside app stores): phone control</h2>
<p>The complete edition of the app, installed from a file, also contains “phone control”. It is never on without you: you must turn it on, pair it with your server and enable Sklubot’s accessibility service yourself in Android’s settings. A bot can then see the screen (screenshots and on-screen text) and act (tap, type, open an app) only after you agree on the phone, during a session shown by a banner and a notification with a Stop button. Apps you block (banking, payment…) stay out of reach. Those screenshots and actions only go to your server. The edition published on app stores does not contain this feature.</p>
<h2>Security</h2>
<p>Traffic with your server is encrypted (HTTPS). The session token is stored encrypted on the phone.</p>
<h2>Retention and deletion</h2>
<p>Your data is kept on your server as long as your account exists. You can delete your account and everything in it from the app (Settings → Delete my account) or from the website (Settings → Account). Signing out erases the session token from the phone; uninstalling the app erases everything it kept on the phone.</p>
<h2>Children</h2>
<p>Sklubot is not intended for children under 13.</p>
<h2>Contact</h2>
<p>For any question about your data, contact the person who runs your Sklubot server.</p>`;

export function privacyPage(locale: "fr" | "en"): string {
  const other = locale === "fr" ? `<p class="muted"><a href="/privacy">English version</a></p>` : `<p class="muted"><a href="/confidentialite">Version française</a></p>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${locale === "fr" ? "Confidentialité" : "Privacy"} — Sklubot</title><style>${css}</style></head><body><main>${locale === "fr" ? FR : EN}${other}</main></body></html>`;
}
