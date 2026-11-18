/** Decimal MB, as displayed in the chat and by the public reverse proxy. */
export const MAX_UPLOAD_MB = 96;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1_000_000;
export const MAX_UPLOAD_BODY = MAX_UPLOAD_BYTES + 1_000_000; // multipart headers and boundary
export const MAX_ATTACHMENTS = 10;
