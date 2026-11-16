'use strict';
/* First-launch screen of the Sklubot desktop app: asks for the server address. Text is inserted with textContent only. */
(async () => {
  const $ = (id) => document.getElementById(id);
  const s = await window.sklubotSetup.get();
  if (!s) return;
  const t = (k) => s.dict[k] || k;
  document.documentElement.lang = s.lang;
  $('title').textContent = t(s.canCancel ? 'desk.setup.titleChange' : 'desk.setup.title');
  $('intro').textContent = t('desk.setup.intro');
  $('label').textContent = t('desk.setup.label');
  $('go').textContent = t('desk.setup.continue');
  $('cancel').textContent = t('desk.setup.cancel');
  $('hint').textContent = t('desk.setup.hint');
  $('cancel').hidden = !s.canCancel;
  const input = $('server');
  input.value = s.server || '';
  input.focus();
  input.select();
  const showError = (msg) => { $('error').textContent = msg || ''; $('error').hidden = !msg; };
  showError(s.error);
  $('cancel').addEventListener('click', () => window.sklubotSetup.cancel());
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('go').disabled = true;
    showError('');
    try {
      const r = await window.sklubotSetup.submit(input.value);
      if (r && !r.ok) showError(r.error || t('desk.setup.err.invalid'));
    } finally {
      $('go').disabled = false;
    }
  });
})();
