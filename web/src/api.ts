/** Small fetch helper for the JSON API under /api. */
import { t } from "./i18n";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
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
    throw new ApiError(serverMessage ?? t("api.failed", { status: res.status }), res.status);
  }
  return data as T;
}

export function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** POST one file as multipart form data (field `file`). The browser sets the multipart boundary itself. */
export function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file, file.name);
  return request<T>(path, { method: "POST", body: form });
}

/** POST raw bytes (an audio recording) with their own content type. */
export function apiBlob<T = unknown>(path: string, blob: Blob): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
}

export const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : t("api.generic"));

export const enc = encodeURIComponent;
