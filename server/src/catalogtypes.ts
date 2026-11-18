import type { ConnectorAuth, NativeAppId } from "./shared.js";

export interface CatalogApp {
  id: string; name: string; category: string; description: string; url: string;
  /** The owner supplies an HTTPS endpoint for their own instance. */
  instanceUrl?: boolean;
  auth: ConnectorAuth;
  /** Native apps use their own setup in Settings. */
  native?: NativeAppId;
  oauthClient?: "dynamic" | "manual";
  tokenHelp: string;
}
