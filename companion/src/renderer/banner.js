'use strict';
/* Always-on-top banner shown during a control session. Stop ends the session and locks the relay. */
async function main() {
  await loadI18n();
  const update = (botName, testMode) => {
    $('txt').textContent = (testMode ? '[' + t('banner.test') + '] ' : '') + t('banner.text', { bot: botName || '?' });
    $('stop').title = window.I18N.hotkey;
  };
  const b = await window.relais.getBanner();
  update(b.botName, b.testMode);
  window.relais.onState((s) => { if (s.session) update(s.session.botName, s.testMode); });
  $('stop').onclick = () => window.relais.stopSession();
}
main();
