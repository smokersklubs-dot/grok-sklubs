/** Small fetch helper for the JSON API under /api. */
import { t } from "./i18n";
import { MAX_UPLOAD_BYTES } from "../../server/src/uploadlimits";
import { sendFileParts } from "../../mobile/shared/uploadParts";
import type { Attachment } from "./types";

/** A file picked for the next message, sent by its attachment path after upload. */
export interface Upload {
  id: string;
  name: string;
  size: number;
  mime: string;
  percent?: number;
  status: "uploading" | "ready" | "error";
  preview: string | null;
  attachment: Attachment | null;
  error: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, { credentials: "same-origin", ...init });
  } catch {
    if (init.signal?.aborted) throw init.signal.reason;
    throw new ApiError(t("api.unreachable"), 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const serverMessage =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null;
    // A wrong password on the account routes also answers 401; that is not a lost session.
    if (res.status === 401 && !path.startsWith("/auth/") && !path.startsWith("/account") && path !== "/me") unauthorizedHandler?.();
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined;
    throw new ApiError(serverMessage ?? t("api.failed", { status: res.status }), res.status, code);
  }
  return data as T;
}

/** The browser's IANA time zone ("" when the browser does not say). */
export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

export function api<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    signal,
    // L92: the browser's time zone rides along, so "tomorrow" means tomorrow where the user is (agent/turnstamp.ts).
    headers: body !== undefined ? { "Content-Type": "application/json", "X-Time-Zone": browserZone() } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** POST one file as multipart form data (field `file`). The browser sets the multipart boundary itself. */
export async function apiUpload<T = unknown>(path: string, file: File, progress?: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  if (/^\/bots\/[^/]+\/uploads$/.test(path)) {
    if (file.size > MAX_UPLOAD_BYTES) return Promise.reject(new ApiError(t("composer.tooBig", { name: file.name }), 413));
    if (file.size > 25_000_000) {
      const session = await api<{ id: string; partBytes: number }>("POST", path + "/start", { name: file.name, size: file.size });
      return sendFileParts<T, Blob>(file.size, session, {
        read: (start, end) => file.slice(start, end),
        send: (id, offset, chunk) => request(path + "/" + enc(id) + "?offset=" + offset, { method: "POST", signal, headers: { "Content-Type": "application/octet-stream" }, body: chunk }),
        cancel: id => api("DELETE", path + "/" + enc(id)),
        progress,
      });
    }
  }
  const form = new FormData();
  form.append("file", file, file.name);
  return request<T>(path, { method: "POST", body: form, signal });
}

/** POST raw bytes (an audio recording) with their own content type. */
export function apiBlob<T = unknown>(path: string, blob: Blob): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
}

export const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : t("api.generic"));

export const enc = encodeURIComponent;
