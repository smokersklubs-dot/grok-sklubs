import type { CatalogApp, Locale } from "./shared.js";
import { appsFor } from "./native/vendors.js";

/**
 * Apps that can be added in one step. Each entry is a public tool server whose address and sign-in
 * method come from the vendor's own documentation (cited next to each entry). "oauth" apps are signed
 * into in the browser; "manual" ones need a client ID the user creates in their account first.
 */
export const CATALOG: CatalogApp[] = [
  {
    id: "agentphone", name: "AgentPhone", category: "Communication", url: "https://mcp.agentphone.ai/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Choose a phone number, read incoming messages, send texts and place calls from your AgentPhone account.",
    tokenHelp: "Sign in to AgentPhone to see your numbers. Calls, messages and number rental use your AgentPhone plan. Incoming messages can be read from the conversation history.",
  },
  {
    id: "agentmail", name: "AgentMail", category: "Communication", url: "https://mcp.agentmail.to/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Give your bots access to dedicated mailboxes, conversations, attachments and drafts.",
    tokenHelp: "Sign in to AgentMail and choose the organization whose inboxes you want to use.",
  },
  {
    id: "composio-connect", name: "Composio Connect", category: "Tools", url: "https://connect.composio.dev/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Find actions across your apps and use the accounts you connect through Composio.",
    tokenHelp: "Sign in to Composio. The first time an app needs access, follow its sign-in link to choose the account.",
  },
  {
    id: "voicestudio", name: "VoiceStudio", category: "Audio", url: "", instanceUrl: true, auth: "token",
    description: "Narrate a script, list voices and transcribe audio through your own VoiceStudio instance.",
    tokenHelp: "Use the HTTPS /mcp/ address of your VoiceStudio server behind an authenticated gateway, and its bearer token. A localhost address on your PC is only reachable from that PC.",
  },
  {
    id: "github-repositories", name: "GitHub Repositories", category: "Development", url: "https://api.githubcopilot.com/mcp/readonly", auth: "oauth",
    description: "Search and read selected repositories, files, issues and pull requests with your GitHub account.",
    tokenHelp: "Continue on GitHub and select the repositories your bots may read. On first setup, GitHub offers to create your private Sklubot app.",
  },
  {
    id: "github-code", name: "GitHub Code", category: "Development", url: "https://api.githubcopilot.com/mcp/", auth: "oauth",
    description: "Assign an issue, review the change, open a draft pull request and receive test results.",
    tokenHelp: "Install your private GitHub App on selected repositories, then authorize it with your account.",
  },
  {
    id: "github", name: "GitHub", category: "Development", url: "https://api.githubcopilot.com/mcp/", auth: "token",
    description: "Repositories, issues, pull requests, code search and actions.",
    tokenHelp: "Create a personal access token in GitHub → Settings → Developer settings → Personal access tokens, with the repositories and permissions you want the bots to have.",
  },
  {
    id: "stripe", name: "Stripe", category: "Business", url: "https://mcp.stripe.com", auth: "token",
    description: "Customers, payments, invoices, products and subscriptions.",
    tokenHelp: "Use a restricted API key from the Stripe dashboard → Developers → API keys. Give it only the permissions the bots need.",
  },
  {
    // https://scribiz.com/docs/mcp.md and https://scribiz.com/mcp (Streamable HTTP at https://scribiz.com/mcp;
    // key sent as "Authorization: Bearer sbz_live_…", created in the Scribiz dashboard). Media goes to Scribiz then
    // to Google for processing. Its delete_jobs tool deletes the account's recordings: it goes through the usual approval.
    id: "scribiz", name: "Scribiz", category: "Creation", url: "https://scribiz.com/mcp", auth: "token",
    description: "Video and audio links: transcript with speakers and timestamps, summary, chapters, search inside a video, on-screen text. Works when the bot's computer cannot download the video.",
    tokenHelp: "Sign in at scribiz.com with your email, then create an API key (scope \"mcp\") in the dashboard and paste it here. Links and audio are sent to Scribiz and Google for processing.",
  },
  {
    id: "huggingface", name: "Hugging Face", category: "AI", url: "https://huggingface.co/mcp", auth: "token",
    description: "Search models, datasets, papers and Spaces; run community tools.",
    tokenHelp: "Create an access token in Hugging Face → Settings → Access Tokens.",
  },
  // ── Business data: what the daily gem hunt digs through ──
  {
    // https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server
    // (URL https://mcp.hubspot.com, OAuth with PKCE; no dynamic registration: a connector created in the user's account)
    id: "hubspot", name: "HubSpot", category: "CRM & marketing", url: "https://mcp.hubspot.com", auth: "oauth", oauthClient: "manual",
    description: "Contacts, companies, deals and tickets. Gems: stalled deals worth a nudge, hot leads nobody followed up, customers ready to buy more.",
    tokenHelp: "In HubSpot, open Development → MCP Connectors (or go to app.hubspot.com/l/mcp-auth-apps/) and click “Create MCP connector”. Give it a name, paste the redirect URL shown below as its Redirect URL, then click Create. Copy the client ID and client secret from the connector's details page into the fields below.",
  },
  {
    // https://developers.klaviyo.com/en/docs/connect_to_the_klaviyo_mcp_server (URL https://mcp.klaviyo.com/mcp, OAuth with dynamic client registration)
    id: "klaviyo", name: "Klaviyo", category: "CRM & marketing", url: "https://mcp.klaviyo.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Email and SMS campaigns, flows, segments and their results. Gems: best-performing subject lines, flows that leak revenue, segments ready for a campaign.",
    tokenHelp: "",
  },
  {
    // https://developers.intercom.com/docs/guides/mcp (Streamable HTTP https://mcp.intercom.com/mcp; OAuth needs Intercom to allowlist the
    // redirect URI, bearer token works without it) and https://developers.intercom.com/docs/build-an-integration/learn-more/authentication
    id: "intercom", name: "Intercom", category: "CRM & marketing", url: "https://mcp.intercom.com/mcp", auth: "token",
    description: "Customer conversations, contacts and help articles. Gems: recurring questions worth an article, unhappy customers to win back, feature requests.",
    tokenHelp: "Create an app in Intercom's Developer Hub, then copy its access token from Configure → Authentication. It needs: read users and companies, read conversations, write conversations, read and write articles. EU workspaces: add the app by its address with https://mcp.eu.intercom.com/mcp instead.",
  },
  {
    // https://amplitude.com/docs/amplitude-ai/amplitude-mcp/other-clients (https://mcp.amplitude.com/mcp, EU https://mcp.eu.amplitude.com/mcp, OAuth 2.0)
    id: "amplitude", name: "Amplitude", category: "Analytics & SEO", url: "https://mcp.amplitude.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Product analytics: events, funnels, retention and cohorts. Gems: drop-off steps to fix, features that drive retention, segments growing fast.",
    tokenHelp: "EU data residency: add the app by its address with https://mcp.eu.amplitude.com/mcp instead.",
  },
  {
    // https://docs.mixpanel.com/docs/mcp (US https://mcp.mixpanel.com/mcp, EU mcp-eu, IN mcp-in; OAuth; an org admin enables MCP first)
    id: "mixpanel", name: "Mixpanel", category: "Analytics & SEO", url: "https://mcp.mixpanel.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Product analytics: events, funnels, retention and reports. Gems: conversion leaks, sudden changes in usage, the actions that make users stay.",
    tokenHelp: "An organization admin must first turn MCP on in Mixpanel → Settings → Org → AI Settings (it can take up to 15 minutes). EU or India projects: add the app by its address with https://mcp-eu.mixpanel.com/mcp or https://mcp-in.mixpanel.com/mcp.",
  },
  {
    // https://developer.semrush.com/api/basics/semrush-mcp/ (https://mcp.semrush.com/v2/mcp, OAuth by default)
    id: "semrush", name: "Semrush", category: "Analytics & SEO", url: "https://mcp.semrush.com/v2/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Keywords, rankings, backlinks, competitors and traffic estimates. Gems: keywords you almost rank for, competitors' winning pages, content gaps.",
    tokenHelp: "",
  },
  {
    // https://docs.ahrefs.com/docs/mcp/introduction (Streamable HTTP https://api.ahrefs.com/mcp/mcp, OAuth; paid plans from Lite)
    id: "ahrefs", name: "Ahrefs", category: "Analytics & SEO", url: "https://api.ahrefs.com/mcp/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Backlinks, organic keywords, top pages and site audits. Gems: lost backlinks to recover, pages slipping in rankings, link opportunities.",
    tokenHelp: "Needs a paid Ahrefs plan (Lite or higher).",
  },
  {
    // https://mcp.supermetrics.com/docs (endpoint POST /mcp, OAuth or API key) and https://docs.supermetrics.com/docs/supermetrics-mcp-server
    id: "supermetrics", name: "Supermetrics", category: "Analytics & SEO", url: "https://mcp.supermetrics.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "One connection to your marketing data: Google Ads, Meta, LinkedIn, GA4, Search Console and more. Gems: campaigns wasting budget, best ROAS, sudden drops.",
    tokenHelp: "Needs a Supermetrics subscription with API access (a 14-day trial is created on the first sign-in).",
  },
  {
    // https://mcp.windsor.ai/docs (https://mcp.windsor.ai/, Streamable HTTP, OAuth 2.0 with dynamic client registration)
    id: "windsor", name: "Windsor.ai", category: "Analytics & SEO", url: "https://mcp.windsor.ai/", auth: "oauth", oauthClient: "dynamic",
    description: "GA4, Search Console, Google/Meta/TikTok Ads, Shopify, HubSpot and 300+ sources through one app. Gems: queries close to page one, channels with rising ROI.",
    tokenHelp: "Connect your sources (Google Analytics, Search Console, ads…) in Windsor.ai first: the bots see what you connected there.",
  },
  {
    // https://developers.notion.com/guides/mcp/get-started-with-mcp (Streamable HTTP https://mcp.notion.com/mcp, OAuth)
    id: "notion", name: "Notion", category: "Productivity", url: "https://mcp.notion.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Pages and databases of your workspace. Gems: ideas and plans left unfinished, notes that connect with today's numbers; bots can write their findings there.",
    tokenHelp: "",
  },
  {
    // L175. https://linear.app/docs/mcp — "https://mcp.linear.app/mcp", Streamable HTTP, "OAuth 2.1 with dynamic client
    // registration" (a Linear API key as bearer also works). Live metadata (22 Nov 2026): https://mcp.linear.app/.well-known/oauth-authorization-server
    // lists registration_endpoint /register and PKCE. Creating or changing issues goes through the usual connector approval.
    id: "linear", name: "Linear", category: "Productivity", url: "https://mcp.linear.app/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Your backlog in Linear: read and search issues, projects and cycles; create or update an issue and comment (with your approval).",
    tokenHelp: "Sign in to Linear and choose the workspace. For reading only, add the app by its address with https://mcp.linear.app/mcp/readonly instead.",
  },
  {
    // L175. https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/ — remote server "https://mcp.netlify.com/mcp"
    // (read 22 Nov 2026). Live metadata (22 Nov 2026): https://mcp.netlify.com/.well-known/oauth-protected-resource names the
    // authorization server https://mcp.netlify.com/, whose /.well-known/oauth-authorization-server lists registration_endpoint
    // /oauth-server/reg and PKCE S256. A deploy is a write: it asks the owner like any connector write.
    id: "netlify", name: "Netlify", category: "Development", url: "https://mcp.netlify.com/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Your Netlify sites: list sites and deploys, read build logs, and deploy a site or change its settings (each deploy with your approval).",
    tokenHelp: "Sign in to Netlify and choose the team. Deploys use your Netlify plan's build minutes.",
  },
  // ── Creation ──
  {
    // https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent (remote MCP
    // server https://mcp.higgsfield.ai/mcp, sign-in with the Higgsfield account; "An active paid subscription is required";
    // "Every generation through a connected agent deducts credits"). Dynamic client registration checked on the live
    // metadata (14 Nov 2026): https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp names the authorization
    // server https://clerk.higgsfield.ai, whose /.well-known/oauth-authorization-server lists a registration_endpoint, PKCE S256.
    id: "higgsfield", name: "Higgsfield", category: "Creation", url: "https://mcp.higgsfield.ai/mcp", auth: "oauth", oauthClient: "dynamic",
    description: "Videos, images and sound with your Higgsfield account. Once connected, bots make their videos here. Every generation spends your Higgsfield credits.",
    tokenHelp: "Needs a paid Higgsfield subscription. Each video or image a bot makes uses your Higgsfield credits, and Higgsfield sets no cap of its own: ask your bots to check with you before making several.",
  },
  {
    // https://github.com/superdesigndev/treg (README, 14 Nov 2026): hosted at https://treg.to, "Point an agent at one base URL
    // with one token"; the /mcp/ surface carries catalog endpoints (incl. image, video and audio generation), team-owned tools
    // and imported skills, while /mcp/v2/ (Claude Connectors Directory) excludes generation. Live metadata (14 Nov 2026):
    // https://treg.to/.well-known/oauth-protected-resource names the authorization server https://treg.to, whose
    // /.well-known/oauth-authorization-server lists registration_endpoint /oauth/register, PKCE S256, auth method "none".
    // We only call the hosted service as a client; treg's own code is source-available and is not reused here.
    id: "treg", name: "Treg", category: "Tools", url: "https://treg.to/mcp/", auth: "oauth", oauthClient: "dynamic",
    description: "One account for thousands of paid tool APIs: SEO and backlinks, social media data, company and people search, page extraction, ads, image, video and voice generation. Bots find the right tool and call it through Treg.",
    tokenHelp: "Needs a Treg account (treg.to). Calls are paid from your Treg balance, per call: ask your bots to tell you the price before expensive or repeated calls, and set a spending checkpoint in Sklubot.",
  },
  {
    // https://docs.slack.dev/ai/slack-mcp-server/ — Streamable HTTP at https://mcp.slack.com/mcp; no dynamic client registration;
    // confidential OAuth with the client ID and secret of a Slack app ("Only directory-published apps or internal apps may
    // use MCP"); user-token scopes per tool. Live metadata (14 Nov 2026): https://mcp.slack.com/.well-known/oauth-authorization-server
    // lists client_secret_post and PKCE S256.
    id: "slack-mcp", name: "Slack (MCP)", category: "Communication", url: "https://mcp.slack.com/mcp", auth: "oauth", oauthClient: "manual",
    description: "Slack's own tool server: search messages and files, read channels and threads, send messages and manage canvases, as you. No triggers: for routines on new messages, use the built-in Slack app.",
    tokenHelp: "Create an app at api.slack.com/apps (From scratch, in your workspace; it stays an internal app — Slack refuses unlisted distributed apps). Under OAuth & Permissions, add the redirect URL shown below and the User Token Scopes for what the bots may do (e.g. search:read.public, channels:history, chat:write, users:read). Then copy the Client ID and Client Secret from Basic Information → App Credentials into the fields below. Your workspace admin may need to approve the app.",
  },
  {
    id: "context7", name: "Context7", category: "Development", url: "https://mcp.context7.com/mcp", auth: "none",
    description: "Up-to-date documentation and code examples for programming libraries.", tokenHelp: "",
  },
  {
    id: "deepwiki", name: "DeepWiki", category: "Development", url: "https://mcp.deepwiki.com/mcp", auth: "none",
    description: "Ask questions about any public code repository and read its generated documentation.", tokenHelp: "",
  },
  {
    id: "cloudflare-docs", name: "Cloudflare Docs", category: "Development", url: "https://docs.mcp.cloudflare.com/mcp", auth: "none",
    description: "Search the Cloudflare developer documentation.", tokenHelp: "",
  },
];

const FR: Record<string, { category: string; description: string; tokenHelp: string }> = {
  agentphone: { category: "Communication", description: "Choisis un numéro, consulte les messages reçus, envoie des SMS et passe des appels depuis ton compte AgentPhone.", tokenHelp: "Connecte-toi à AgentPhone pour retrouver tes numéros. Les numéros, appels et SMS utilisent ton forfait AgentPhone. Ton bot peut consulter l’historique des messages reçus." },
  agentmail: { category: "Communication", description: "Donne à tes bots accès à des boîtes e-mail dédiées, aux conversations, aux pièces jointes et aux brouillons.", tokenHelp: "Connecte-toi à AgentMail et choisis l’organisation dont tu veux utiliser les boîtes e-mail." },
  "composio-connect": { category: "Outils", description: "Trouve des actions dans tes applications et utilise les comptes que tu connectes dans Composio.", tokenHelp: "Connecte-toi à Composio. Au premier accès à une application, son lien de connexion te permet de choisir le compte." },
  voicestudio: { category: "Audio", description: "Faire lire un texte, choisir une voix et transcrire un enregistrement avec ton instance VoiceStudio.", tokenHelp: "Saisis l’adresse HTTPS /mcp/ de ton instance VoiceStudio protégée par une passerelle et son jeton d’accès. Une adresse localhost sur ton PC est accessible uniquement depuis ce PC." },
  "github-code": { category: "Développement", description: "Confie un ticket à un bot, relis le correctif et reçois les résultats de la pull request.", tokenHelp: "Installe ton application GitHub privée sur les dépôts de ton choix, puis autorise-la avec ton compte." },
  "github-repositories": { category: "Développement", description: "Recherche et lecture des dépôts, fichiers, tickets et pull requests que tu autorises.", tokenHelp: "Continue sur GitHub et choisis les dépôts accessibles à tes bots. À la première connexion, GitHub te propose de créer ton application Sklubot privée." },
  github: { category: "Développement", description: "Dépôts, tickets, demandes de fusion, recherche de code et actions.", tokenHelp: "Crée un jeton d'accès personnel dans GitHub → Settings → Developer settings → Personal access tokens, limité aux dépôts et aux droits que tu veux donner aux bots." },
  stripe: { category: "Activité", description: "Clients, paiements, factures, produits et abonnements.", tokenHelp: "Utilise une clé d'API restreinte depuis le tableau de bord Stripe → Développeurs → Clés API, avec seulement les droits nécessaires aux bots." },
  scribiz: { category: "Création", description: "Liens vidéo et audio : transcription avec qui parle et à quel moment, résumé, chapitres, recherche dans une vidéo, texte affiché à l'écran. Marche même quand l'ordinateur du bot ne peut pas télécharger la vidéo.", tokenHelp: "Connecte-toi sur scribiz.com avec ton e-mail, crée une clé d'API (droit « mcp ») dans le tableau de bord, puis colle-la ici. Les liens et le son sont envoyés à Scribiz et à Google pour être traités." },
  huggingface: { category: "IA", description: "Recherche de modèles, de jeux de données, d'articles et de Spaces ; outils de la communauté.", tokenHelp: "Crée un jeton d'accès dans Hugging Face → Settings → Access Tokens." },
  hubspot: { category: "CRM & marketing", description: "Contacts, entreprises, transactions et tickets. Pépites : affaires au point mort à relancer, prospects chauds oubliés, clients prêts à acheter plus.", tokenHelp: "Dans HubSpot, ouvre Development → MCP Connectors (ou va sur app.hubspot.com/l/mcp-auth-apps/) et clique sur « Create MCP connector ». Donne-lui un nom, colle l'adresse de retour affichée ci-dessous comme Redirect URL, puis clique sur Create. Copie l'identifiant client (client ID) et le secret client (client secret) depuis la page de détails du connecteur dans les champs ci-dessous." },
  klaviyo: { category: "CRM & marketing", description: "Campagnes e-mail et SMS, flux, segments et leurs résultats. Pépites : objets d'e-mail les plus performants, flux qui perdent du chiffre, segments prêts pour une campagne.", tokenHelp: "" },
  intercom: { category: "CRM & marketing", description: "Conversations clients, contacts et articles d'aide. Pépites : questions récurrentes qui méritent un article, clients mécontents à reconquérir, demandes de fonctionnalités.", tokenHelp: "Crée une app dans le Developer Hub d'Intercom, puis copie son jeton d'accès dans Configure → Authentication. Droits nécessaires : lecture des utilisateurs et entreprises, lecture des conversations, écriture des conversations, lecture et écriture des articles. Espace hébergé en Europe : ajoute l'app par son adresse avec https://mcp.eu.intercom.com/mcp." },
  amplitude: { category: "Analytique & SEO", description: "Analytique produit : événements, entonnoirs, rétention et cohortes. Pépites : étapes où l'on perd des gens, fonctionnalités qui fidélisent, segments en forte croissance.", tokenHelp: "Données hébergées en Europe : ajoute l'app par son adresse avec https://mcp.eu.amplitude.com/mcp." },
  mixpanel: { category: "Analytique & SEO", description: "Analytique produit : événements, entonnoirs, rétention et rapports. Pépites : fuites de conversion, changements brusques d'usage, actions qui font rester les utilisateurs.", tokenHelp: "Un administrateur de l'organisation doit d'abord activer MCP dans Mixpanel → Settings → Org → AI Settings (jusqu'à 15 minutes). Projets en Europe ou en Inde : ajoute l'app par son adresse avec https://mcp-eu.mixpanel.com/mcp ou https://mcp-in.mixpanel.com/mcp." },
  semrush: { category: "Analytique & SEO", description: "Mots-clés, positions, liens entrants, concurrents et estimations de trafic. Pépites : mots-clés presque en première page, pages gagnantes des concurrents, sujets manquants.", tokenHelp: "" },
  ahrefs: { category: "Analytique & SEO", description: "Liens entrants, mots-clés organiques, meilleures pages et audits de site. Pépites : liens perdus à récupérer, pages qui reculent, occasions de liens.", tokenHelp: "Nécessite un abonnement Ahrefs payant (Lite ou plus)." },
  supermetrics: { category: "Analytique & SEO", description: "Une seule connexion pour tes données marketing : Google Ads, Meta, LinkedIn, GA4, Search Console et plus. Pépites : campagnes qui gaspillent du budget, meilleur ROAS, chutes soudaines.", tokenHelp: "Nécessite un abonnement Supermetrics avec accès API (un essai de 14 jours est créé à la première connexion)." },
  windsor: { category: "Analytique & SEO", description: "GA4, Search Console, Google/Meta/TikTok Ads, Shopify, HubSpot et plus de 300 sources via une seule app. Pépites : requêtes proches de la première page, canaux dont le ROI monte.", tokenHelp: "Connecte d'abord tes sources (Google Analytics, Search Console, publicités…) dans Windsor.ai : les bots voient ce que tu y as connecté." },
  linear: { category: "Productivité", description: "Ton backlog dans Linear : lire et chercher les tickets, projets et cycles ; créer ou modifier un ticket et commenter (avec ton accord).", tokenHelp: "Connecte-toi à Linear et choisis l'espace de travail. Pour la lecture seule, ajoute plutôt l'app par son adresse avec https://mcp.linear.app/mcp/readonly." },
  netlify: { category: "Développement", description: "Tes sites Netlify : lister les sites et les déploiements, lire les journaux de construction, et déployer un site ou changer ses réglages (chaque déploiement avec ton accord).", tokenHelp: "Connecte-toi à Netlify et choisis l'équipe. Les déploiements utilisent les minutes de construction de ton forfait Netlify." },
  notion: { category: "Productivité", description: "Pages et bases de données de ton espace. Pépites : idées et projets laissés en plan, notes qui éclairent les chiffres du jour ; les bots peuvent y écrire leurs trouvailles.", tokenHelp: "" },
  higgsfield: { category: "Création", description: "Vidéos, images et sons avec ton compte Higgsfield. Une fois connecté, les bots font leurs vidéos ici. Chaque génération utilise tes crédits Higgsfield.", tokenHelp: "Nécessite un abonnement Higgsfield payant. Chaque vidéo ou image créée par un bot utilise tes crédits Higgsfield, sans plafond côté Higgsfield : demande à tes bots de te consulter avant d'en faire plusieurs." },
  treg: { category: "Outils", description: "Un seul compte pour des milliers d'API d'outils payants : SEO et liens entrants, données des réseaux sociaux, recherche d'entreprises et de personnes, extraction de pages, publicité, génération d'images, de vidéos et de voix. Les bots trouvent le bon outil et l'appellent via Treg.", tokenHelp: "Nécessite un compte Treg (treg.to). Les appels sont payés sur ton solde Treg, à l'appel : demande à tes bots de t'annoncer le prix avant les appels chers ou répétés, et règle un plafond de dépense dans Sklubot." },
  context7: { category: "Développement", description: "Documentation et exemples de code à jour pour les bibliothèques de programmation.", tokenHelp: "" },
  deepwiki: { category: "Développement", description: "Pose des questions sur n'importe quel dépôt de code public et lis sa documentation générée.", tokenHelp: "" },
  "slack-mcp": { category: "Communication", description: "Le serveur d'outils de Slack : chercher des messages et fichiers, lire canaux et fils, envoyer des messages et gérer des canevas, en ton nom. Pas de déclencheurs : pour des routines sur les nouveaux messages, utilise l'app Slack intégrée.", tokenHelp: "Crée une app sur api.slack.com/apps (From scratch, dans ton espace ; elle reste une app interne — Slack refuse les apps distribuées non listées). Dans OAuth & Permissions, ajoute l'adresse de retour affichée ci-dessous et les User Token Scopes correspondant à ce que les bots pourront faire (par ex. search:read.public, channels:history, chat:write, users:read). Copie ensuite le Client ID et le Client Secret depuis Basic Information → App Credentials dans les champs ci-dessous. L'administrateur de ton espace devra peut-être approuver l'app." },
  "cloudflare-docs": { category: "Développement", description: "Recherche dans la documentation développeur de Cloudflare.", tokenHelp: "" },
};

/** Built-in apps come first: they are connected through their own setup (an OAuth client of the user's), not by an address. */
const builtIn = (locale: Locale): CatalogApp[] => appsFor(locale).map((a) => ({ id: `native-${a.id}`, name: a.name, category: a.category, description: a.description, url: "", auth: "oauth", tokenHelp: "", native: a.id }));
export const catalogFor = (locale: Locale): CatalogApp[] => [...builtIn(locale), ...(locale === "fr" ? CATALOG.map((a) => ({ ...a, ...FR[a.id] })) : CATALOG)];
