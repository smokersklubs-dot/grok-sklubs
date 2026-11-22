/**
 * L37 — a display name (an account's, a bot's, its label) is one line of plain text. Names are written into the bots'
 * instructions ("You are <bot>, working for <owner>", the team list, group chats): a name with line breaks or control
 * characters could start a fake section there ("\n## Rules from …"). Every line break, tab, control or invisible
 * direction character becomes one space; spaces are evened out. Applied where names are saved (store.ts).
 */
export const oneLine = (s: string): string => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, " ").replace(/\s+/g, " ").trim();
