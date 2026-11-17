/* The promo's timeline, in seconds. Shared by the animation (app.js) and the soundtrack (build/soundtrack.mjs),
   so every pop, tick and click in the music lands on the frame where it is seen. */
(function (root) {
  const TL = {
    fps: 30,
    duration: 45,
    bpm: 96,
    // Each scene starts with a circular reveal from `origin` (fractions of the frame), over the previous one.
    scenes: [
      { id: "hook", start: 0, end: 4.6, theme: "dark" },
      { id: "team", start: 4.0, end: 12.6, theme: "light", origin: [0.5, 0.55] },
      { id: "computer", start: 12.0, end: 22.6, theme: "light", origin: [0.5, 0.5] },
      { id: "safety", start: 22.0, end: 30.6, theme: "light", origin: [0.5, 0.5] },
      { id: "today", start: 30.0, end: 38.6, theme: "light", origin: [0.5, 0.5] },
      { id: "cta", start: 38.0, end: 45, theme: "dark", origin: [0.5, 0.45] },
    ],
    reveal: 0.6,
    hook: { words: 0.25, wake: 1.9 },
    team: { title: 4.3, pops: [5.0, 5.45, 5.9, 6.35, 6.8], caption: 8.2, speak: [9.3, 9.85, 10.4, 10.95, 11.5] },
    computer: { title: 12.3, open: 12.9, checks: [14.4, 15.7, 17.0], split: 18.0, miniChecks: [19.9, 20.5, 21.1] },
    safety: { title: 22.3, card: 22.9, cursor: 25.3, click: 26.9, after: 27.9 },
    today: { title: 30.3, panel: 30.8, rows: [32.2, 32.55, 32.9, 33.25, 33.6], total: 34.4, highlight: 35.2 },
    cta: { bots: 38.5, euphoric: 39.3, word: 39.6, line: 40.4, url: 41.0, platforms: 41.8 },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = TL;
  else root.TL = TL;
})(typeof window !== "undefined" ? window : globalThis);
