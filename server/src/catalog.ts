import type { CatalogApp } from "./shared.js";

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
