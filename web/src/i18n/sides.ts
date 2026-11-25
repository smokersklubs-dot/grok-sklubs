/**
 * Component-local text tables (`const TEXT = { fr: {…}, en: {…} }` read through `sideText(name, …)`): their name and
 * file, so the language check (scripts/i18n/check-languages.mjs) finds their English keys. A language file gives their
 * texts in `side.<name>` (see es.ts). docs/LANGUES.md.
 */
export const SIDE_TABLES = {
  auth: "web/src/components/authText.ts",
  google: "web/src/components/GoogleLogin.tsx",
  hosted: "web/src/components/Hosted.tsx",
  credits: "web/src/components/Credits.tsx",
  aiAccounts: "web/src/components/AiAccounts.tsx",
  turnstile: "web/src/components/Turnstile.tsx",
  voice: "web/src/components/VoicePicker.tsx",
  gloss: "web/src/lib/glossary.ts",
  work: "web/src/components/WorkContext.tsx",
};
