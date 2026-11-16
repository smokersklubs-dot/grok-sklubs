import type { t as T } from "../i18n";
import type { Connector } from "../types";

/** Why an app connector failed, in the user's language when the app answered with an HTTP status. */
export function connectorError(c: Connector, t: typeof T, fallback: string): string {
  const s = c.errorStatus;
  if (!s) return c.error || fallback;
  if (s === 401 || s === 403 || s === 404 || s === 405 || s === 429) return t(`connector.http${s}`);
  if (s >= 500) return t("connector.http5xx", { status: s });
  return t("connector.httpOther", { status: s });
}
