/*
 * Portions adapted from n8n-io/nod (https://github.com/n8n-io/nod, commit 0f9de28af967ad6f7be12a3181edcef860216328),
 * Copyright 2026 n8n GmbH, Apache License 2.0; modified for Sklubot: the attachment picking and the getFile download of
 * src/providers/chat-sdk/telegram.ts (largest photo first, default names and types, 20 MB limit checked before, during
 * and after the download, file path segments checked, no redirects) rewritten without zod and the chat SDK, on
 * Sklubot's Telegram client (config.telegramApi), storing the file in the bot's library; message splitting, approval
 * buttons, file sending and "typing" are Sklubot's own code.
 *
 * nod audit item 5 / row 68 — Telegram: approval buttons in the user's language, files and voice notes sent, photos /
 * voice notes / files received, long replies split cleanly, "typing…" while the bot works.
 *
 * Telegram Bot API (https://core.telegram.org/bots/api), methods and limits used here:
 *   sendMessage (text 1-4096 characters, reply_markup InlineKeyboardMarkup), callback_query updates with
 *   answerCallbackQuery and editMessageReplyMarkup (InlineKeyboardButton.callback_data: 1-64 bytes), getFile + the file
 *   address https://api.telegram.org/file/bot<token>/<file_path> ("bots can download files of up to 20 MB"),
 *   sendPhoto (photos up to 10 MB), sendVoice (OGG/Opus, MP3 or M4A), sendAudio, sendDocument ("files of any type of up
 *   to 50 MB"), sendChatAction (action "typing" / "upload_document", shown for 5 seconds or less).
 */
import { config } from "./config.js";
import type { Attachment, Locale } from "./shared.js";

export const TG_TEXT_MAX = 4096;
export const TG_DOWNLOAD_MAX = 20 * 1024 * 1024;
export const TG_UPLOAD_MAX = 50 * 1024 * 1024;
export const TG_PHOTO_MAX = 10 * 1024 * 1024;

const FR: Record<string, string> = {
  "Yes": "Oui", "No": "Non",
  "✅ Allowed": "✅ Autorisé", "❌ Refused": "❌ Refusé",
  "This request was already answered.": "Cette demande a déjà une réponse.",
  "🔒 This one must be answered in the app.": "🔒 Celle-ci se valide dans l'appli.",
  "This file is over 20 MB: Telegram does not let bots download it. Send it from the app instead.": "Ce fichier dépasse 20 Mo : Telegram ne laisse pas les bots le télécharger. Envoie-le depuis l'appli.",
  "I could not get this file from Telegram. Try again, or send it from the app.": "Je n'ai pas pu récupérer ce fichier depuis Telegram. Réessaie, ou envoie-le depuis l'appli.",
  "(voice message: {name})": "(message vocal : {name})",
  "(file: {name})": "(fichier : {name})",
  "🎤 Voice message (written out): {text}": "🎤 Message vocal (transcrit) : {text}",
  "“{name}” is over 50 MB: Telegram refuses it. It is in the app.": "« {name} » dépasse 50 Mo : Telegram le refuse. Il est dans l'appli.",
};
export const tgText = (locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}) =>
  (locale === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));

// ── Long replies ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Splits a reply into Telegram messages of at most `max` characters: at a paragraph break, else a line break, else a
 * space, else hard; never inside a surrogate pair. A code block cut in two is closed at the end of one part and opened
 * again at the start of the next, so each part reads on its own.
 */
export function splitTelegram(text: string, max = TG_TEXT_MAX): string[] {
  const parts: string[] = [];
  let rest = text.replace(/\r\n/g, "\n");
  let reopen = "";
  while (rest.length) {
    const room = max - reopen.length;
    if (rest.length <= room) { parts.push((reopen + rest).replace(/\s+$/, "")); break; }
    const budget = room - 4; // room for a closing "\n```"
    const window = rest.slice(0, budget);
    let cut = window.lastIndexOf("\n\n");
    if (cut < budget * 0.5) cut = window.lastIndexOf("\n");
    if (cut < budget * 0.5) cut = window.lastIndexOf(" ");
    if (cut < budget * 0.3) cut = budget;
    // Never split a surrogate pair (an emoji).
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    let piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n+/, "").replace(/^ /, "");
    const fences = ((reopen + piece).match(/^```/gm) ?? []).length;
    const open = fences % 2 === 1;
    const lang = open ? ((reopen + piece).match(/^```([\w#+.-]*)/gm) ?? []).pop()?.slice(3) ?? "" : "";
    piece = reopen + piece.replace(/\s+$/, "") + (open ? "\n```" : "");
    parts.push(piece);
    reopen = open ? "```" + lang + "\n" : "";
  }
  return parts.filter((p) => p.trim().length);
}

// ── Approval buttons ─────────────────────────────────────────────────────────────────────────────────────────────
/** The two buttons under an approval question, in the user's language. callback_data stays within 64 bytes. */
export function approvalKeyboard(approvalId: string, locale: Locale | undefined) {
  return { inline_keyboard: [[
    { text: `✅ ${tgText(locale, "Yes")}`, callback_data: `ap:${approvalId}:y`.slice(0, 64) },
    { text: `❌ ${tgText(locale, "No")}`, callback_data: `ap:${approvalId}:n`.slice(0, 64) },
  ]] };
}
export function parseApprovalCallback(data: unknown): { approvalId: string; allow: boolean } | null {
  const m = /^ap:([\w-]{1,58}):([yn])$/.exec(String(data ?? ""));
  return m ? { approvalId: m[1], allow: m[2] === "y" } : null;
}

// ── Received files ───────────────────────────────────────────────────────────────────────────────────────────────
interface TgFile { file_id: string; file_size?: number; file_name?: string; mime_type?: string }
export interface TgMessageFiles {
  photo?: TgFile[]; document?: TgFile; video?: TgFile; audio?: TgFile; voice?: TgFile; animation?: TgFile; video_note?: TgFile; caption?: string;
}
export interface IncomingFile { fileId: string; name: string; mime: string; size: number; voice: boolean }

/** The file a message carries (the largest photo size), with a name and a type, or null (adapted from nod). */
export function incomingFile(m: TgMessageFiles): IncomingFile | null {
  const file = m.photo?.at(-1) ?? m.document ?? m.video ?? m.audio ?? m.voice ?? m.animation ?? m.video_note;
  if (!file?.file_id) return null;
  const image = !!m.photo?.length;
  const video = !!(m.video || m.video_note || m.animation);
  const voice = !!m.voice;
  const mime = image ? "image/jpeg" : file.mime_type ?? (voice ? "audio/ogg" : video ? "video/mp4" : "application/octet-stream");
  const name = (file.file_name ?? (image ? "photo.jpg" : voice ? "voice.ogg" : video ? "video.mp4" : "file")).replace(/[/\\\0]/g, "_").slice(0, 200);
  return { fileId: file.file_id, name, mime, size: file.file_size ?? 0, voice };
}

export class TooLargeError extends Error { constructor() { super("too large"); } }

/** Downloads a received file with getFile (adapted from nod): at most 20 MB, no redirects, a checked file path. */
export async function downloadFile(token: string, f: IncomingFile, request: typeof fetch = fetch): Promise<Buffer> {
  if (f.size > TG_DOWNLOAD_MAX) throw new TooLargeError();
  const signal = AbortSignal.timeout(60_000);
  const info = await request(`${config.telegramApi}/bot${token}/getFile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: f.fileId }), signal, redirect: "error" });
  const data = (await info.json().catch(() => ({}))) as { ok?: boolean; result?: { file_path?: string; file_size?: number }; description?: string };
  if (!info.ok || !data.ok) { if (/file is too big/i.test(data.description ?? "")) throw new TooLargeError(); throw new Error("getFile failed"); }
  const path = String(data.result?.file_path ?? "");
  const segments = path.split("/");
  if (!path || path.length > 2048 || segments.some((s) => !/^[A-Za-z0-9_.-]+$/.test(s) || s === "." || s === "..")) throw new Error("The Telegram file is unavailable.");
  if ((data.result?.file_size ?? 0) > TG_DOWNLOAD_MAX) throw new TooLargeError();
  const res = await request(`${config.telegramApi}/file/bot${token}/${segments.map(encodeURIComponent).join("/")}`, { signal, redirect: "error" });
  if (!res.ok || !res.body) throw new Error("The Telegram file is unavailable.");
  if (Number(res.headers.get("content-length") ?? 0) > TG_DOWNLOAD_MAX) { await res.body.cancel().catch(() => {}); throw new TooLargeError(); }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > TG_DOWNLOAD_MAX) throw new TooLargeError();
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}

// ── Sent files ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Which Bot API method sends this file: a picture as a photo, an OGG / MP3 / M4A as a voice note or audio, else a document. */
export function sendMethodFor(a: Pick<Attachment, "mime" | "size" | "name">): { method: "sendPhoto" | "sendVoice" | "sendAudio" | "sendDocument"; field: "photo" | "voice" | "audio" | "document" } | null {
  if (a.size > TG_UPLOAD_MAX) return null;
  if (/^image\/(jpeg|png|webp)$/.test(a.mime) && a.size <= TG_PHOTO_MAX) return { method: "sendPhoto", field: "photo" };
  if (a.mime === "audio/ogg" || /\.(ogg|oga|opus)$/i.test(a.name)) return { method: "sendVoice", field: "voice" };
  if (/^audio\/(mpeg|mp4|x-m4a|aac)$/.test(a.mime)) return { method: "sendAudio", field: "audio" };
  return { method: "sendDocument", field: "document" };
}

/** Sends one file (multipart, as the Bot API asks for new files). Returns the message id, or null. */
export async function sendFile(token: string, chatId: string, a: Pick<Attachment, "mime" | "size" | "name">, bytes: Buffer, caption?: string): Promise<number | null> {
  const how = sendMethodFor({ ...a, size: bytes.length });
  if (!how) return null;
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) form.set("caption", caption.slice(0, 1024));
  form.set(how.field, new Blob([new Uint8Array(bytes)], { type: a.mime || "application/octet-stream" }), a.name);
  const res = await fetch(`${config.telegramApi}/bot${token}/${how.method}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number } };
  return res.ok && data.ok ? data.result?.message_id ?? null : null;
}
