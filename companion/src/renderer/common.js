'use strict';
/* Shared helpers for the local pages. Text is always inserted with textContent (never HTML). */
window.I18N = { dict: {}, lang: 'fr', hotkey: '' };
window.t = function t(key, vars) {
  const s = (window.I18N.dict[key] || key);
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? String(vars[k]) : '{' + k + '}'));
};
window.applyI18n = function applyI18n(root) {
  (root || document).querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = window.t(el.getAttribute('data-i18n')); });
  document.documentElement.lang = window.I18N.lang;
};
window.loadI18n = async function loadI18n() {
  const r = await window.relais.i18n();
  window.I18N = r;
  window.applyI18n();
};
window.$ = (id) => document.getElementById(id);
window.show = (el, on) => el.classList.toggle('hidden', !on);
