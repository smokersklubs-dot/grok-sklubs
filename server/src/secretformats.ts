/*
 * Portions adapted from affaan-m/ECC (https://github.com/affaan-m/ECC, commit 4adeee6732a12d1540f49a4d50a38ce8c97f9a53),
 * Copyright (c) 2026 Affaan Mustafa, MIT License; modified for Sklubot: the "CRITICAL" secret patterns of
 * agents/opensource-sanitizer.md (generic API-key assignment, AWS secret access key, database URL with a password,
 * Google OAuth client secret, Slack incoming webhook, SendGrid and Mailgun keys) rewritten as JavaScript RegExps with a
 * capture group for the value only, word boundaries, and the same "kind" vocabulary as shared.ts SECRET_FORMATS. The
 * patterns already in shared.ts (AWS key id, JWT, PEM private keys, GitHub tokens) are not repeated here.
 *
 * L46 (« détection de secrets collés enrichie », docs/audits/A-FAIRE.md). No import on purpose: shared.ts (which the
 * web composer also loads) spreads this list into its own, so the server and the composer warn about the same things.
 */
export interface ExtraSecretFormat { kind: "key" | "token" | "password" | "private-key"; re: RegExp; group?: number }

export const EXTRA_SECRET_FORMATS: ExtraSecretFormat[] = [
  // ECC: [A-Za-z0-9_]*(api[_-]?key|apikey|api[_-]?secret)[A-Za-z0-9_]*\s*[=:]\s*['"]?[A-Za-z0-9+/=_-]{16,}
  { kind: "key", group: 1, re: /\b[A-Za-z0-9_]*(?:api[_-]?key|apikey|api[_-]?secret)[A-Za-z0-9_]*\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{16,})/gi },
  // ECC: (aws_secret_access_key|aws_secret)\s*[=:]\s*['"]?[A-Za-z0-9+/=]{20,}
  { kind: "key", group: 1, re: /\b(?:aws_secret_access_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9+/=]{20,})/gi },
  // ECC: (postgres|mysql|mongodb|redis)://[^:]+:[^@]+@[^\s'"]+ — only the password part is the secret.
  { kind: "password", group: 1, re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^:\s/@'"]+:([^@\s'"]{3,200})@[^\s'"]+/gi },
  // ECC: GOCSPX-[A-Za-z0-9_-]+ (Google OAuth client secret)
  { kind: "key", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/g },
  // ECC: https://hooks.slack.com/services/T…/B…/… (a Slack incoming webhook posts as its owner)
  { kind: "token", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },
  // ECC: SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43} (SendGrid)
  { kind: "key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  // ECC: key-[A-Za-z0-9]{32} (Mailgun)
  { kind: "key", re: /\bkey-[A-Za-z0-9]{32}\b/g },
];
