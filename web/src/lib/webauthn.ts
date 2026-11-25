/**
 * Passkeys in the browser (L44): turns the server's JSON options into navigator.credentials.create/get calls and the
 * answers back into JSON (server: passkeys.ts, webauthn.ts).
 *
 * Portions adapted from MasterKale/SimpleWebAuthn (https://github.com/MasterKale/SimpleWebAuthn, @simplewebauthn/browser
 * 14.0.0, commit 83f87addc67b652ff5b84e681669451648216ef6), Copyright (c) 2020 Matthew Miller, MIT License —
 * startRegistration, startAuthentication, base64URLStringToBuffer, bufferToBase64URLString, browserSupportsWebAuthn.
 * Modified for Sklubot: TypeScript, no autofill (conditional mediation) and no abort service, errors reduced to
 * "cancelled" / "unsupported" / other. Notices: THIRD_PARTY_NOTICES.md.
 * API: W3C Web Authentication Level 3 (https://www.w3.org/TR/webauthn-3/), §5.1.3 create(), §5.1.4 get().
 */

export const passkeysSupported = (): boolean =>
  typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function toB64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface Descriptor { id: string; type: "public-key"; transports?: string[] }
const descriptor = (d: Descriptor): PublicKeyCredentialDescriptor => ({ id: fromB64url(d.id), type: "public-key", transports: d.transports as AuthenticatorTransport[] | undefined });

/** "cancelled": the person closed the browser's window or took too long (NotAllowedError); "unsupported": no passkeys here. */
export class PasskeyCancelled extends Error {}
export class PasskeyUnsupported extends Error {}
function rethrow(err: unknown): never {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") throw new PasskeyCancelled("cancelled");
  if (name === "NotSupportedError" || name === "SecurityError") throw new PasskeyUnsupported("unsupported");
  if (name === "InvalidStateError") throw new Error("already-saved");
  throw err;
}

export async function createPasskey(options: any): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeyUnsupported("unsupported");
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: fromB64url(options.challenge),
    user: { ...options.user, id: fromB64url(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map(descriptor),
  };
  let cred: PublicKeyCredential | null;
  try { cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null; } catch (err) { rethrow(err); }
  if (!cred) throw new PasskeyCancelled("cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), attestationObject: toB64url(r.attestationObject), transports: typeof r.getTransports === "function" ? r.getTransports() : [] },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

export async function getPasskey(options: any): Promise<unknown> {
  if (!passkeysSupported()) throw new PasskeyUnsupported("unsupported");
  const allow = (options.allowCredentials ?? []) as Descriptor[];
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: fromB64url(options.challenge),
    // An empty list must be left out so the browser offers the passkeys saved for this site (discoverable credentials).
    allowCredentials: allow.length ? allow.map(descriptor) : undefined,
  };
  let cred: PublicKeyCredential | null;
  try { cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null; } catch (err) { rethrow(err); }
  if (!cred) throw new PasskeyCancelled("cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
    response: { clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature), userHandle: r.userHandle ? toB64url(r.userHandle) : undefined },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}
