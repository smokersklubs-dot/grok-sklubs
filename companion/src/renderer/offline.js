'use strict';
/* Shown in the Sklubot window when the server cannot be reached. "Réessayer" goes back to the server address. */
(() => {
  const q = new URLSearchParams(location.search);
  const T = {
    fr: { title: 'Sklubot est injoignable', text: "Impossible d'ouvrir {server} ({error}). Vérifie ta connexion à Internet.", retry: 'Réessayer', hint: "Pour changer d'adresse : menu Sklubot › Changer de serveur." },
    en: { title: 'Sklubot cannot be reached', text: 'Could not open {server} ({error}). Check your Internet connection.', retry: 'Try again', hint: 'To use another address: Sklubot menu › Change server.' },
  };
  const lang = q.get('lang') === 'en' ? 'en' : 'fr';
  const d = T[lang];
  const server = q.get('server') || '';
  document.documentElement.lang = lang;
  document.getElementById('title').textContent = d.title;
  document.getElementById('text').textContent = d.text.replace('{server}', server).replace('{error}', q.get('error') || '?');
  document.getElementById('hint').textContent = d.hint;
  const retry = document.getElementById('retry');
  retry.textContent = d.retry;
  if (/^https?:\/\//.test(server)) retry.href = server + '/';
})();
