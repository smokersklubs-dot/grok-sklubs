import type { Context } from "hono";

export class HttpError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502, message: string) { super(message); } }
export const fail = (status: HttpError["status"], message: string): never => { throw new HttpError(status, message); };

export const body = async (c: Context): Promise<Record<string, any>> => {
  const parsed = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? parsed : {};
};
