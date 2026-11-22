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
  } else if (p.kind === 'terminal' || p.kind === 'shortcut') {
    // guard.js: a terminal for this session, or a protected shortcut the owner approved in Sklubot.
    $('title').textContent = t(`consent.${p.kind}.title`, { bot });
    $('text').textContent = t(`consent.${p.kind}.text`);
    $('command').textContent = p.data.detail;
    show($('command'), true);
    add('consent.refuse', 'primary', 'refuse');
    add(`consent.${p.kind}.allow`, '', 'allow');
  } else {
    $('title').textContent = t('consent.command.title', { bot });
    $('text').textContent = t('consent.command.text');
    $('command').textContent = p.data.command;
    show($('command'), true);
    if (p.data.cwd) { $('cwd').textContent = t('consent.command.cwd', { cwd: p.data.cwd }); show($('cwd'), true); }
    // L32: each script the command launches, its first 40 lines and its fingerprint (refused if it changes before the click).
    const scripts = p.data.scripts || [];
    for (const sc of scripts) {
      const head = document.createElement('p');
      head.className = 'small';
      head.textContent = t('consent.script.head', { path: sc.path, hash: sc.sha256.slice(0, 16) });
      const pre = document.createElement('pre');
      pre.textContent = sc.binary ? t('consent.script.binary') : sc.lines.join('\n') + (sc.more ? `\n${t('consent.script.more', { n: sc.more })}` : '');
      $('scripts').append(head, pre);
    }
    if (scripts.length) { $('scripts-note').textContent = t('consent.script.note'); show($('scripts'), true); }
    // A command on the floor is asked every time; the first ordinary one also covers the rest of the session.
    $('reason').textContent = p.data.floor ? t('consent.command.floor', { why: t(`consent.floor.${p.data.floor}`) }) : scripts.length ? '' : t('consent.command.session');
    show($('reason'), !!$('reason').textContent);
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
