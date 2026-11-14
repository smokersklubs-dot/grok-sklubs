'use strict';
/* Consent dialog. Buttons are enabled after a short delay so a stray click or Enter cannot answer it. */
async function main() {
  await loadI18n();
  const id = new URLSearchParams(location.search).get('id');
  const p = await window.relais.getPrompt(id);
  if (!p) { window.close(); return; }
  const bot = p.bot.name;
  $('avatar').textContent = (bot.trim()[0] || '?').toUpperCase();
  const actions = $('actions');
  const buttons = [];
  const add = (label, cls, decision) => {
    const b = document.createElement('button');
    b.textContent = t(label);
    if (cls) b.className = cls;
    b.disabled = true;
    b.dataset.decision = decision;
    b.onclick = () => {
      const extra = { alwaysForBot: $('always').checked };
      window.relais.answerPrompt(id, decision, extra);
    };
    actions.append(b);
    buttons.push(b);
  };
  if (p.kind === 'session') {
    $('title').textContent = t('consent.session.title', { bot });
    $('text').textContent = t('consent.session.text', { key: window.I18N.hotkey });
    if (p.data.reason) { $('reason').textContent = t('consent.reason', { reason: p.data.reason }); show($('reason'), true); }
    add('consent.refuse', '', 'refuse');
    add('consent.always', '', 'always');
    add('consent.once', 'primary', 'once');
  } else {
    $('title').textContent = t('consent.command.title', { bot });
    $('text').textContent = t('consent.command.text');
    $('command').textContent = p.data.command;
    show($('command'), true);
    if (p.data.cwd) { $('cwd').textContent = t('consent.command.cwd', { cwd: p.data.cwd }); show($('cwd'), true); }
    show($('always-wrap'), true);
    add('consent.refuse', '', 'refuse');
    add('consent.command.run', 'primary', 'run');
  }
  setTimeout(() => buttons.forEach((b) => { b.disabled = false; }), 900);
  const tick = () => {
    const left = Math.max(0, Math.round((p.deadline - Date.now()) / 1000));
    $('timer').textContent = t('consent.expires', { s: left });
  };
  tick();
  setInterval(tick, 1000);
}
main();
