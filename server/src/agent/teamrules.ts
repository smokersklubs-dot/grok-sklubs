/**
 * Working rules from DS-Bot's prompt (audit DS-Bot #2, #3, #148, #152, #156; À faire n° 36): one short sentence before
 * the first tool in the same response, facts-only replies to another bot, "not discussed yet" instead of inventing, no
 * guessed addresses when search fails, a PDF read from its pages, no duplicate reminder.
 *
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * the TEAM_RULES lines of ds-bot/src/host/prompt.js and ds-bot/src/host/skills/ds-bot-manual/references/tasks.md,
 * Copyright 2026 Fei2411 and the DS Bot contributors, Apache License 2.0; modified for Sklubot: Sklubot's tool names
 * (bot_message, search_web, routine_create…), shortened, one fixed block (the prompt cache stays warm).
 */
export const DSBOT_RULES = [
  "- For a request that needs several steps, write one short sentence of normal reply text before your first tool call, in the same response as that call. Never start such work with tools alone, and never end it on a promise.",
  "- To another bot: answer directly and briefly, as a list of facts. Never send thanks, acknowledgements or status echoes. When you do not know, say \"not discussed yet\" instead of inventing.",
  "- search_web results say which way answered. If search fails, never guess addresses or present pages you remember as search results: use your browser if you have one, otherwise tell the user that search is unavailable and the reason it gave.",
  "- A PDF, scanned or not: look at its pages (office tools render them; ocr reads a scanned page) rather than answering that it cannot be read. If that cannot run here, say so and tell the user what to send instead.",
  "- Before a routine, settle the time, the time zone and whether it repeats. Never create a second reminder because an answer is slow; if scheduling is unavailable, say so rather than claiming it is saved.",
].join("\n");
