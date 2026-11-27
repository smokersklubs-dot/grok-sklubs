import { config } from "../config.js"; import { localize } from "../lang/index.js";
import type { Locale, NativeApp, NativeAppId, NativeVendor } from "../shared.js";

/**
 * Built-in apps: Gmail, Google Calendar, Google Drive, Outlook (Microsoft 365) and Slack, reached through the vendors'
 * own REST APIs with an OAuth client the user creates in their own console.
 *
 * Why not the vendors' hosted tool (MCP) servers (checked 14 Nov 2026):
 *  - Google's Workspace MCP servers (gmailmcp/calendarmcp/drivemcp.googleapis.com) are a Developer Preview, only for members
 *    of the Google Workspace Developer Preview Program: https://developers.google.com/workspace/guides/configure-mcp-servers
 *  - Microsoft's Work IQ MCP needs a work or school (Entra ID) tenant where Work IQ is enabled, and is paid in Copilot
 *    Credits; personal Outlook.com accounts are not covered: https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/api-overview
 *    and https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview
 *  - Slack's MCP server (https://mcp.slack.com/mcp) does work from a self-hosted client with an internal app of the user's
 *    own: it is in the catalogue (catalog.ts). It has no triggers, so Slack is also built in here for "new message" routines.
 *
 * Every address can be pointed at a local fake for tests: GOOGLE_API_URL, MICROSOFT_API_URL and SLACK_API_URL replace the
 * scheme and host of every URL of that vendor (the paths of each vendor's hosts never collide).
 */

const OVERRIDE: Record<NativeVendor, string> = { google: "GOOGLE_API_URL", microsoft: "MICROSOFT_API_URL", slack: "SLACK_API_URL" };

/** The real URL, or the same path on the override base when one is set. */
export function vendorUrl(vendor: NativeVendor, real: string): string {
  const base = (process.env[OVERRIDE[vendor]] ?? "").replace(/\/$/, "");
  if (!base) return real;
  const u = new URL(real);
  return `${base}${u.pathname}${u.search}`;
}
/** Whether a URL a vendor handed back (a delta link, a page link) points at that vendor's API, so our token can follow it. */
export function isVendorUrl(vendor: NativeVendor, url: string, realOrigin: string): boolean {
  const base = (process.env[OVERRIDE[vendor]] ?? "").replace(/\/$/, "");
  return url.startsWith(`${base || realOrigin}/`);
}

export const nativeRedirectUri = (vendor: NativeVendor) => `${config.publicUrl}/api/native/${vendor}/callback`;

const G = "https://www.googleapis.com/auth/";
/** Apps, their scopes (the narrowest that cover the tools) and the triggers they feed. */
export const NATIVE_APPS: NativeApp[] = [
  {
    // Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes — gmail.modify covers search, read,
    // drafts, send and labels (users.messages.send lists it: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).
    // "openid email": who signed in (https://developers.google.com/identity/openid-connect/openid-connect#obtaininguserprofileinformation).
    id: "gmail", vendor: "google", name: "Gmail", category: "Mail & calendar",
    description: "Search and read mail, write drafts, send (with your approval), label and archive. Triggers: new email matching a search.",
    scopes: [`${G}gmail.modify`, "openid", "email"], capabilities: ["mail"], triggers: ["email"],
  },
  {
    // calendar.events: list/insert/patch/delete events (https://developers.google.com/workspace/calendar/api/v3/reference/events/insert);
    // calendar.events.freebusy: freeBusy.query (https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).
    id: "gcalendar", vendor: "google", name: "Google Calendar", category: "Mail & calendar",
    description: "See your agenda and free/busy times; create, move or cancel events (with your approval). Triggers: an event starting soon.",
    scopes: [`${G}calendar.events`, `${G}calendar.events.freebusy`, "openid", "email"], capabilities: ["calendar"], triggers: ["calendar"],
  },
  {
    // drive.readonly: search and read every file; drive.file: upload new files (https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
    id: "gdrive", vendor: "google", name: "Google Drive", category: "Files",
    description: "Search your Drive, read documents as text (Google Docs, Sheets and Slides exported), upload files from a bot's library (with your approval).",
    scopes: [`${G}drive.readonly`, `${G}drive.file`, "openid", "email"], capabilities: ["drive"], triggers: [],
  },
  {
    // L166 (native/searchconsole.ts): webmasters.readonly covers sites, search analytics, sitemaps and URL inspection
    // (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing). PageSpeed needs no scope; IndexNow is not Google.
    id: "searchconsole", vendor: "google", name: "Search Console", category: "Analytics & SEO",
    description: "Your real Google Search data: clicks, impressions, positions by query and page, sitemaps, why a page is not indexed. Also PageSpeed for any page, and IndexNow to tell search engines a page changed (with your approval).",
    scopes: [`${G}webmasters.readonly`, "openid", "email"], capabilities: ["seo"], triggers: [],
  },
  {
    // Microsoft Graph delegated permissions (work, school and personal accounts): https://learn.microsoft.com/en-us/graph/permissions-reference
    // offline_access gives the refresh token: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
    id: "outlook", vendor: "microsoft", name: "Outlook", category: "Mail & calendar",
    description: "Microsoft 365 or Outlook.com mail and calendar: search, read, drafts, send, archive; agenda, free/busy and events. Triggers: new email, event starting soon.",
    scopes: ["offline_access", "openid", "email", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"], capabilities: ["mail", "calendar"], triggers: ["email", "calendar"],
  },
  {
    // Bot token scopes, one per Web API method used: conversations.list (*:read), conversations.history (*:history),
    // chat.postMessage (chat:write), reactions.add (reactions:write), users.info (users:read), app_mention events
    // (app_mentions:read). https://docs.slack.dev/reference/scopes
    id: "slack", vendor: "slack", name: "Slack", category: "Communication",
    description: "Read channels and direct messages, post (with your approval) and react, as your own Slack app. Triggers: new message in a channel or DM, or a mention.",
    scopes: ["app_mentions:read", "channels:history", "channels:read", "chat:write", "groups:history", "groups:read", "im:history", "im:read", "mpim:history", "mpim:read", "reactions:write", "users:read"],
    capabilities: ["slack"], triggers: ["slack"],
  },
];

export const appOf = (id: string): NativeApp | undefined => NATIVE_APPS.find((a) => a.id === id);
export const VENDORS: NativeVendor[] = ["google", "microsoft", "slack"];
export const VENDOR_NAMES: Record<NativeVendor, string> = { google: "Google", microsoft: "Microsoft", slack: "Slack" };

export const appsFor = (locale: Locale): NativeApp[] =>
  NATIVE_APPS.map((a) => ({ ...a, category: localize(locale, a.category, VENDOR_FR), description: localize(locale, a.description, VENDOR_FR) }));

/**
 * How to create each vendor's OAuth client, step by step. Wording follows the vendors' own pages (linked in `docs`).
 * `{redirect}` and `{scopes}` are filled in by the caller.
 */
const STEPS: Record<NativeVendor, { en: string[] }> = {
  google: {
    en: [
      "Open the Google Cloud console (console.cloud.google.com) and create a project, or pick an existing one.",
      "Menu → APIs & Services → Library: enable the Gmail API, the Google Calendar API, the Google Drive API and/or the Google Search Console API — only those you will connect.",
      "Menu → Google Auth platform → Branding: enter an app name (e.g. Sklubot) and your support email. Then Audience: choose External (or Internal on Google Workspace) and, under Test users, click Add users and add every Google address you will connect.",
      "Google Auth platform → Data Access → Add or Remove Scopes: add the scopes listed below, then Save.",
      "Google Auth platform → Clients → Create Client → Application type: Web application. Under Authorized redirect URIs, add exactly the address below, then click Create.",
      "Copy the client ID and the client secret shown for this client into the fields below.",
    ],
  },
  microsoft: {
    en: [
      "Sign in to the Microsoft Entra admin center (entra.microsoft.com) with an account that may register applications.",
      "Entra ID → App registrations → New registration. Give it a name (e.g. Sklubot). Supported account types: “Any Entra ID Tenant + Personal Microsoft accounts” to connect both Outlook.com and work accounts (or “Single tenant only” for your organisation: then enter its tenant ID in the Directory field below). Click Register.",
      "Manage → Authentication → Add Redirect URI → Web: paste exactly the address below, then Configure.",
      "Manage → Certificates & secrets → New client secret. Copy its Value right away (it is shown only once).",
      "Manage → API permissions → Add a permission → Microsoft Graph → Delegated permissions: add the permissions listed below.",
      "Copy the Application (client) ID from the Overview page and the secret value into the fields below.",
    ],
  },
  slack: {
    en: [
      "Open api.slack.com/apps → Create New App → From scratch. Name it (e.g. Sklubot) and pick your workspace.",
      "OAuth & Permissions → Redirect URLs: add exactly the address below (Slack requires https) and click Save URLs.",
      "OAuth & Permissions → Scopes → Bot Token Scopes: add the scopes listed below.",
      "For instant triggers without a public address (optional): Socket Mode → Enable Socket Mode; Basic Information → App-Level Tokens → Generate Token and Scopes with the connections:write scope, and paste the xapp-… token below. Then Event Subscriptions → Subscribe to bot events: message.channels, message.groups, message.im and app_mention. Without it, triggers check Slack every few minutes.",
      "Basic Information → App Credentials: copy the Client ID and the Client Secret into the fields below.",
      "After signing in, invite the app into each channel it should read or post in (/invite @your-app).",
    ],
  },
};

const DOCS: Record<NativeVendor, { label: string; url: string }[]> = {
  google: [
    { label: "Create access credentials", url: "https://developers.google.com/workspace/guides/create-credentials" },
    { label: "Configure the OAuth consent screen", url: "https://developers.google.com/workspace/guides/configure-oauth-consent" },
    { label: "Enable Google Workspace APIs", url: "https://developers.google.com/workspace/guides/enable-apis" },
    { label: "OAuth 2.0 for web server applications", url: "https://developers.google.com/identity/protocols/oauth2/web-server" },
  ],
  microsoft: [
    { label: "Register an app in Microsoft Entra ID", url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app" },
    { label: "Add a redirect URI", url: "https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri" },
    { label: "Add credentials (client secret)", url: "https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials" },
    { label: "OAuth 2.0 authorization code flow", url: "https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow" },
  ],
  slack: [
    { label: "Installing with OAuth", url: "https://docs.slack.dev/authentication/installing-with-oauth/" },
    { label: "Using Socket Mode", url: "https://docs.slack.dev/apis/events-api/using-socket-mode/" },
    { label: "connections:write (app-level token)", url: "https://api.slack.com/scopes/connections:write" },
  ],
};

/**
 * French for the app texts and the OAuth setup steps above, keyed by the English text (other languages: server/src/lang/<code>.ts,
 * docs/LANGUES.md). The vendors' own menu names (APIs & Services, Create Client…) stay in English: their consoles show them so.
 */
const VENDOR_FR: Record<string, string> = {
  "Open the Google Cloud console (console.cloud.google.com) and create a project, or pick an existing one.": "Ouvre la console Google Cloud (console.cloud.google.com) et crée un projet, ou choisis-en un existant.",
  "Menu → APIs & Services → Library: enable the Gmail API, the Google Calendar API, the Google Drive API and/or the Google Search Console API — only those you will connect.": "Menu → APIs & Services → Library : active Gmail API, Google Calendar API, Google Drive API et/ou Google Search Console API — seulement celles que tu vas connecter.",
  "Menu → Google Auth platform → Branding: enter an app name (e.g. Sklubot) and your support email. Then Audience: choose External (or Internal on Google Workspace) and, under Test users, click Add users and add every Google address you will connect.": "Menu → Google Auth platform → Branding : indique un nom d'app (par ex. Sklubot) et ton e-mail d'assistance. Puis Audience : choisis External (ou Internal sur Google Workspace) et, sous Test users, clique sur Add users et ajoute chaque adresse Google que tu vas connecter.",
  "Google Auth platform → Data Access → Add or Remove Scopes: add the scopes listed below, then Save.": "Google Auth platform → Data Access → Add or Remove Scopes : ajoute les autorisations (scopes) listées ci-dessous, puis Save.",
  "Google Auth platform → Clients → Create Client → Application type: Web application. Under Authorized redirect URIs, add exactly the address below, then click Create.": "Google Auth platform → Clients → Create Client → Application type : Web application. Sous Authorized redirect URIs, ajoute exactement l'adresse ci-dessous, puis clique sur Create.",
  "Copy the client ID and the client secret shown for this client into the fields below.": "Copie l'identifiant client (client ID) et le secret client (client secret) de ce client dans les champs ci-dessous.",
  "Sign in to the Microsoft Entra admin center (entra.microsoft.com) with an account that may register applications.": "Connecte-toi au centre d'administration Microsoft Entra (entra.microsoft.com) avec un compte autorisé à inscrire des applications.",
  "Entra ID → App registrations → New registration. Give it a name (e.g. Sklubot). Supported account types: “Any Entra ID Tenant + Personal Microsoft accounts” to connect both Outlook.com and work accounts (or “Single tenant only” for your organisation: then enter its tenant ID in the Directory field below). Click Register.": "Entra ID → App registrations → New registration. Donne-lui un nom (par ex. Sklubot). Supported account types : « Any Entra ID Tenant + Personal Microsoft accounts » pour connecter Outlook.com et des comptes professionnels (ou « Single tenant only » pour ton organisation : indique alors son ID de locataire dans le champ Annuaire ci-dessous). Clique sur Register.",
  "Manage → Authentication → Add Redirect URI → Web: paste exactly the address below, then Configure.": "Manage → Authentication → Add Redirect URI → Web : colle exactement l'adresse ci-dessous, puis Configure.",
  "Manage → Certificates & secrets → New client secret. Copy its Value right away (it is shown only once).": "Manage → Certificates & secrets → New client secret. Copie tout de suite sa Value (elle n'est affichée qu'une fois).",
  "Manage → API permissions → Add a permission → Microsoft Graph → Delegated permissions: add the permissions listed below.": "Manage → API permissions → Add a permission → Microsoft Graph → Delegated permissions : ajoute les autorisations listées ci-dessous.",
  "Copy the Application (client) ID from the Overview page and the secret value into the fields below.": "Copie l'Application (client) ID depuis la page Overview et la valeur du secret dans les champs ci-dessous.",
  "Open api.slack.com/apps → Create New App → From scratch. Name it (e.g. Sklubot) and pick your workspace.": "Ouvre api.slack.com/apps → Create New App → From scratch. Donne-lui un nom (par ex. Sklubot) et choisis ton espace de travail.",
  "OAuth & Permissions → Redirect URLs: add exactly the address below (Slack requires https) and click Save URLs.": "OAuth & Permissions → Redirect URLs : ajoute exactement l'adresse ci-dessous (Slack exige https) et clique sur Save URLs.",
  "OAuth & Permissions → Scopes → Bot Token Scopes: add the scopes listed below.": "OAuth & Permissions → Scopes → Bot Token Scopes : ajoute les autorisations listées ci-dessous.",
  "For instant triggers without a public address (optional): Socket Mode → Enable Socket Mode; Basic Information → App-Level Tokens → Generate Token and Scopes with the connections:write scope, and paste the xapp-… token below. Then Event Subscriptions → Subscribe to bot events: message.channels, message.groups, message.im and app_mention. Without it, triggers check Slack every few minutes.": "Pour des déclencheurs instantanés sans adresse publique (facultatif) : Socket Mode → Enable Socket Mode ; Basic Information → App-Level Tokens → Generate Token and Scopes avec l'autorisation connections:write, puis colle le jeton xapp-… ci-dessous. Ensuite Event Subscriptions → Subscribe to bot events : message.channels, message.groups, message.im et app_mention. Sans cela, les déclencheurs vérifient Slack toutes les quelques minutes.",
  "Basic Information → App Credentials: copy the Client ID and the Client Secret into the fields below.": "Basic Information → App Credentials : copie le Client ID et le Client Secret dans les champs ci-dessous.",
  "After signing in, invite the app into each channel it should read or post in (/invite @your-app).": "Après la connexion, invite l'app dans chaque canal qu'elle doit lire ou où elle doit écrire (/invite @ton-app).",
  "Mail & calendar": "Mail & agenda",
  "Search and read mail, write drafts, send (with your approval), label and archive. Triggers: new email matching a search.": "Chercher et lire les e-mails, écrire des brouillons, envoyer (avec ton accord), étiqueter et archiver. Déclencheur : nouvel e-mail correspondant à une recherche.",
  "See your agenda and free/busy times; create, move or cancel events (with your approval). Triggers: an event starting soon.": "Voir ton agenda et tes disponibilités ; créer, déplacer ou annuler des événements (avec ton accord). Déclencheur : un événement qui commence bientôt.",
  "Files": "Fichiers",
  "Search your Drive, read documents as text (Google Docs, Sheets and Slides exported), upload files from a bot's library (with your approval).": "Chercher dans ton Drive, lire les documents en texte (Docs, Sheets et Slides exportés), envoyer des fichiers depuis la bibliothèque d'un bot (avec ton accord).",
  "Analytics & SEO": "Analytique & SEO",
  "Your real Google Search data: clicks, impressions, positions by query and page, sitemaps, why a page is not indexed. Also PageSpeed for any page, and IndexNow to tell search engines a page changed (with your approval).": "Tes vraies données de recherche Google : clics, impressions, positions par requête et par page, plans de site, pourquoi une page n'est pas indexée. Aussi PageSpeed pour n'importe quelle page, et IndexNow pour signaler aux moteurs qu'une page a changé (avec ton accord).",
  "Microsoft 365 or Outlook.com mail and calendar: search, read, drafts, send, archive; agenda, free/busy and events. Triggers: new email, event starting soon.": "Mail et agenda Microsoft 365 ou Outlook.com : recherche, lecture, brouillons, envoi, archivage ; agenda, disponibilités et événements. Déclencheurs : nouvel e-mail, événement qui commence bientôt.",
  "Communication": "Communication",
  "Read channels and direct messages, post (with your approval) and react, as your own Slack app. Triggers: new message in a channel or DM, or a mention.": "Lire les canaux et messages directs, publier (avec ton accord) et réagir, avec ta propre app Slack. Déclencheurs : nouveau message dans un canal ou en privé, ou une mention.",
};
export const setupSteps = (vendor: NativeVendor, locale: Locale) => STEPS[vendor].en.map((step) => localize(locale, step, VENDOR_FR));
export const setupDocs = (vendor: NativeVendor) => DOCS[vendor];
