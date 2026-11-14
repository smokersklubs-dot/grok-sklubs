/** OAuth sign-in for connected apps: the provider's page opens in a popup; the server's callback page tells us when it is done. */
import { api } from "../api";
import type { Connector } from "../types";

export type SignInResult = { kind: "opened" } | { kind: "done" } | { kind: "needsClientId"; redirectUri: string };

/**
 * Must be called synchronously from the click, before any await, or the browser blocks the popup.
 * The popup loses its link to this page, so the provider's page can never steer the app.
 */
export function openSignInWindow(): Window | null {
  const w = window.open("", "sklubot-oauth", "popup=yes,width=520,height=720");
  if (w) {
    try {
      w.opener = null;
    } catch {
      /* some browsers do not allow it: fine */
    }
  }
  return w;
}

/** Asks the server for the provider's page and sends the popup there (or this tab when pop-ups are blocked). */
export async function startSignIn(
  connectorId: string,
  win: Window | null,
  extra: { clientId?: string; clientSecret?: string; botId?: string; seq?: number } = {},
): Promise<SignInResult> {
  let r: { authorizeUrl?: string; connector?: Connector; needsClientId?: boolean; redirectUri?: string };
  try {
    r = await api("POST", `/connectors/${connectorId}/oauth/start`, extra);
  } catch (e) {
    win?.close();
    throw e;
  }
  if (r.needsClientId) {
    win?.close();
    return { kind: "needsClientId", redirectUri: r.redirectUri ?? "" };
  }
  if (r.authorizeUrl) {
    if (win && !win.closed) win.location.href = r.authorizeUrl;
    else window.location.assign(r.authorizeUrl);
    return { kind: "opened" };
  }
  win?.close();
  return { kind: "done" };
}

/** Calls `fn` when a sign-in finishes in another window or tab of this app. */
export function onSignInDone(fn: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel("sklubot-oauth");
    channel.onmessage = () => fn();
  } catch {
    /* old browser: the live "connectors" event still refreshes the list */
  }
  const onMessage = (e: MessageEvent) => {
    if (e.origin === window.location.origin && (e.data as { type?: string } | null)?.type === "sklubot-oauth") fn();
  };
  window.addEventListener("message", onMessage);
  return () => {
    channel?.close();
    window.removeEventListener("message", onMessage);
  };
}
