import type { CatalogApp, Locale } from "./shared.js";

/**
 * Apps that can be added in one step. Each entry is a public tool server whose address was checked
 * to answer the open tool protocol. Apps that only accept a browser sign-in flow are not listed yet.
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
  context7: { category: "Développement", description: "Documentation et exemples de code à jour pour les bibliothèques de programmation.", tokenHelp: "" },
  deepwiki: { category: "Développement", description: "Pose des questions sur n'importe quel dépôt de code public et lis sa documentation générée.", tokenHelp: "" },
  "cloudflare-docs": { category: "Développement", description: "Recherche dans la documentation développeur de Cloudflare.", tokenHelp: "" },
};

export const catalogFor = (locale: Locale): CatalogApp[] => (locale === "fr" ? CATALOG.map((a) => ({ ...a, ...FR[a.id] })) : CATALOG);
