/**
 * L177 — what the meeting bot reads and finds on a meeting page, as one plain DOM function run inside the page (CDP
 * Runtime.evaluate on the bot's computer, Playwright's page.evaluate in the tests on a fake meeting page).
 *
 * Only standard, stable browser behaviour: element roles, accessible labels (aria-label, <label>, placeholder, title)
 * and visible text, getBoundingClientRect for where to click, document.body.innerText for what is written. No service
 * SDK, no private API, no network request: the bot uses the page the way a guest does, with the mouse and keyboard
 * events the Chrome DevTools Protocol sends (Input domain, helper.ts). Labels are matched in French and English, the
 * two languages of the bot's browser.
 *
 * MEETING_PAGE_JS is a function expression: call it as `(${MEETING_PAGE_JS})(request)`.
 *  - { op: "look" } → the page's state: login wall, lobby, in the meeting, ended, the chat's text.
 *  - { op: "find", what } → the centre of one control to click or type into (it is scrolled into view and, for a text
 *    field, focused), or { found: false }. what: "name" | "join" | "browser" | "leave" | "chat_toggle" | "chat_input"
 *    | "mic_off" | "cam_off".
 */
export const FIND_TARGETS = ["name", "join", "browser", "leave", "chat_toggle", "chat_input", "mic_off", "cam_off"] as const;
export type FindTarget = (typeof FIND_TARGETS)[number];
export interface PageLook { url: string; title: string; login: boolean; lobby: boolean; inMeeting: boolean; ended: boolean; nameField: boolean; joinButton: string | null; chatInput: boolean; chat: string }
export interface PageFind { found: boolean; x?: number; y?: number; label?: string; field?: boolean }

export const MEETING_PAGE_JS = String.raw`function (req) {
  const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  const docs = () => {
    const out = [document];
    for (const f of document.querySelectorAll("iframe")) { try { if (f.contentDocument) out.push(f.contentDocument); } catch (e) { /* another site's frame */ } }
    return out;
  };
  const all = (sel) => docs().flatMap((d) => [...d.querySelectorAll(sel)]);
  const shown = (el) => {
    const r = el.getBoundingClientRect(); const s = el.ownerDocument.defaultView.getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const labelOf = (el) => {
    const parts = [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("placeholder"), el.getAttribute("data-tooltip")];
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) { const t = el.ownerDocument.getElementById(id); if (t) parts.push(t.textContent); }
    if (el.id) { const l = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) parts.push(l.textContent); }
    const wrap = el.closest("label"); if (wrap) parts.push(wrap.textContent);
    if (!/^(input|textarea)$/i.test(el.tagName)) parts.push(el.innerText || el.textContent);
    return fold(parts.filter(Boolean).join(" | "));
  };
  const enabled = (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true";
  const buttons = () => all('button, [role="button"], a[href], input[type="button"], input[type="submit"]').filter((el) => shown(el) && enabled(el));
  const fields = () => all('input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]').filter((el) => shown(el) && enabled(el) && !el.readOnly);
  const exact = (el, words) => { const l = labelOf(el).split(" | "); return words.some((w) => l.some((x) => x === w)); };
  const has = (el, re) => re.test(labelOf(el));
  const WORDS = {
    join: ["ask to join", "join now", "join", "join meeting", "join the meeting", "participer", "participer maintenant", "rejoindre", "rejoindre maintenant", "rejoindre la reunion", "demander a participer", "demander a rejoindre"],
    leave: ["leave", "leave call", "leave meeting", "leave the call", "hang up", "end call", "quitter", "quitter l'appel", "quitter la reunion", "raccrocher"],
  };
  const RE = {
    name: /(^|[^a-z])(your name|name|nom|ton nom|votre nom|display name|nom d'affichage|pseudo)([^a-z]|$)/,
    browser: /continue on this browser|continuer sur ce navigateur|join from (your )?browser|rejoindre (depuis|a partir de|avec) (votre |ton |le )?navigateur|use the web app instead|utiliser l'application web/,
    chatToggle: /(^|[^a-z])(chat|discussion|messages|conversation|chat with everyone|discuter avec tous|show everyone|afficher le chat|open chat|ouvrir le chat)([^a-z]|$)/,
    chatInput: /(send a message|type a message|message|chat|ecrire un message|envoyer un message|saisir un message|discussion|type message here)/,
    micOff: /(turn off microphone|mute microphone|mute|desactiver le micro|couper le micro|desactiver le microphone)/,
    camOff: /(turn off camera|stop video|stop camera|desactiver la camera|arreter la video|couper la camera)/,
    login: /sign in to join|sign in to continue|you must sign in|you need to sign in|only signed[- ]in users|connectez-vous pour (participer|rejoindre|continuer)|vous devez vous connecter|seuls les utilisateurs connectes|connexion requise|login required/,
    lobby: /asking to join|ask to be let in|waiting for (the host|the organizer|someone)|someone in the meeting should let you in|someone will let you in|you'll join (the meeting )?when someone lets you in|please wait|waiting room|lobby|en attente|salle d'attente|quelqu'un dans la reunion doit vous|attendez que l'organisateur|vous rejoindrez la reunion lorsque/,
    ended: /you left the meeting|you've left the meeting|you have left the meeting|the meeting has ended|this meeting has ended|meeting ended|the host has ended|you (have been|were) removed|you've been removed|call ended|vous avez quitte|la reunion est terminee|la reunion a pris fin|l'organisateur a mis fin|vous avez ete retire|appel termine/,
  };
  const LOGIN_HOSTS = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com)$/;
  const pick = (list, test) => list.find(test) || null;
  const finders = {
    name: () => pick(fields(), (el) => has(el, RE.name) || (el.getAttribute("autocomplete") || "") === "name"),
    join: () => { for (const w of WORDS.join) { const el = pick(buttons(), (b) => exact(b, [w])); if (el) return el; } return null; },
    browser: () => pick(buttons(), (b) => has(b, RE.browser)),
    leave: () => pick(buttons(), (b) => exact(b, WORDS.leave)),
    chat_toggle: () => pick(buttons(), (b) => has(b, RE.chatToggle) && b.getAttribute("aria-pressed") !== "true" && b.getAttribute("aria-expanded") !== "true"),
    chat_input: () => pick(fields(), (el) => has(el, RE.chatInput) && !has(el, RE.name)),
    mic_off: () => pick(buttons(), (b) => has(b, RE.micOff) && b.getAttribute("aria-pressed") !== "true"),
    cam_off: () => pick(buttons(), (b) => has(b, RE.camOff) && b.getAttribute("aria-pressed") !== "true"),
  };
  const centre = (el) => {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    let x = r.left + r.width / 2, y = r.top + r.height / 2;
    // A control inside a same-site frame: add the frame's own place in the page.
    let w = el.ownerDocument.defaultView;
    while (w && w.frameElement) { const f = w.frameElement.getBoundingClientRect(); x += f.left; y += f.top; w = w.parent; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const chatText = () => {
    const input = finders.chat_input();
    const logs = all('[role="log"], [aria-live="polite"], [aria-live="assertive"]').filter(shown).map((el) => el.innerText || "");
    let near = "";
    if (input) { let el = input.parentElement; for (let i = 0; el && i < 8; i++, el = el.parentElement) { const t = el.innerText || ""; if (t.length > 40) { near = t; break; } } }
    return (near ? [near, ...logs.filter((l) => !near.includes(l))] : logs).join("\n").slice(-20000);
  };
  if (req.op === "find") {
    const f = finders[req.what];
    const el = f ? f() : null;
    if (!el) return { found: false };
    const field = /^(input|textarea)$/i.test(el.tagName) || el.isContentEditable || el.getAttribute("role") === "textbox";
    const at = centre(el);
    if (field) { el.focus(); try { if (el.select) el.select(); } catch (e) { /* not selectable */ } }
    return { found: true, x: at.x, y: at.y, label: labelOf(el).slice(0, 120), field };
  }
  const text = fold(docs().map((d) => (d.body ? d.body.innerText : "")).join("\n")).slice(0, 40000);
  const host = location.hostname.toLowerCase();
  const leave = finders.leave();
  const join = finders.join();
  const hasPassword = all('input[type="password"]').some(shown);
  return {
    url: location.href, title: document.title,
    login: LOGIN_HOSTS.test(host) || RE.login.test(text) || (hasPassword && !leave),
    lobby: !leave && RE.lobby.test(text),
    inMeeting: !!leave,
    ended: RE.ended.test(text),
    nameField: !!finders.name(),
    joinButton: join ? labelOf(join).split(" | ")[0].slice(0, 60) : null,
    chatInput: !!finders.chat_input(),
    chat: leave ? chatText() : "",
  };
}`;
