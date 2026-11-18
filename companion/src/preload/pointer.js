// @ts-check
'use strict';
const { ipcRenderer } = require('electron');
window.addEventListener('DOMContentLoaded', () => {
  const tip = document.getElementById('tip');
  const name = document.getElementById('name');
  name.textContent = new URLSearchParams(location.search).get('name') || 'Sklubot';
  ipcRenderer.on('pointer:paint', (_event, { x, y, action }) => {
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.toggle('left', x > innerWidth / 2);
    tip.classList.toggle('above', y > innerHeight / 2);
    tip.classList.toggle('pressed', action === 'click' || action === 'drag');
  });
});
