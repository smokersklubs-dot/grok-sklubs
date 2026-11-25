'use strict';
/* Always-on-top banner shown during a control session. Stop ends the session and locks the relay. */
async function main() {
  await loadI18n();
  // A control session of this computer first; else an Android phone used by a bot (protocol 1.9).
  const update = (botName, testMode, phones) => {
    const phone = !botName && phones && phones[0];
    $('txt').textContent = (testMode ? '[' + t('banner.test') + '] ' : '') + (phone ? t('banner.phone', { bot: phone.botName, phone: phone.model }) : t('banner.text', { bot: botName || '?' }));
    $('stop').title = window.I18N.hotkey;
  };
  const b = await window.relais.getBanner();
  update(b.botName, b.testMode, b.phones);
  window.relais.onState((s) => { if (s.session) update(s.session.botName, s.testMode); else if (s.phones && s.phones.length) update('', s.testMode, s.phones); });
  $('stop').onclick = () => window.relais.stopSession();
}
main();
