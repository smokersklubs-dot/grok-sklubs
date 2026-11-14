import type { CatalogApp, Locale } from "./shared.js";

/**
 * Apps that can be added in one step. Each entry is a public tool server whose address and sign-in
 * method come from the vendor's own documentation (cited next to each entry). "oauth" apps are signed
 * into in the browser; "manual" ones need a client ID the user creates in their account first.
 */
export const CATALOG: CatalogApp[] = [
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
  github: { category: "Développement", description: "Dépôts, tickets, demandes de fusion, recherche de code et actions.", tokenHelp: "Crée un jeton d'accès personnel dans GitHub → Settings → Developer settings → Personal access tokens, limité aux dépôts et aux droits que tu veux donner aux bots." },
  stripe: { category: "Activité", description: "Clients, paiements, factures, produits et abonnements.", tokenHelp: "Utilise une clé d'API restreinte depuis le tableau de bord Stripe → Développeurs → Clés API, avec seulement les droits nécessaires aux bots." },
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
  notion: { category: "Productivité", description: "Pages et bases de données de ton espace. Pépites : idées et projets laissés en plan, notes qui éclairent les chiffres du jour ; les bots peuvent y écrire leurs trouvailles.", tokenHelp: "" },
  higgsfield: { category: "Création", description: "Vidéos, images et sons avec ton compte Higgsfield. Une fois connecté, les bots font leurs vidéos ici. Chaque génération utilise tes crédits Higgsfield.", tokenHelp: "Nécessite un abonnement Higgsfield payant. Chaque vidéo ou image créée par un bot utilise tes crédits Higgsfield, sans plafond côté Higgsfield : demande à tes bots de te consulter avant d'en faire plusieurs." },
  context7: { category: "Développement", description: "Documentation et exemples de code à jour pour les bibliothèques de programmation.", tokenHelp: "" },
  deepwiki: { category: "Développement", description: "Pose des questions sur n'importe quel dépôt de code public et lis sa documentation générée.", tokenHelp: "" },
  "cloudflare-docs": { category: "Développement", description: "Recherche dans la documentation développeur de Cloudflare.", tokenHelp: "" },
};

export const catalogFor = (locale: Locale): CatalogApp[] => (locale === "fr" ? CATALOG.map((a) => ({ ...a, ...FR[a.id] })) : CATALOG);
