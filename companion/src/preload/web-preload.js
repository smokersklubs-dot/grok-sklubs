// @ts-check
'use strict';
/**
 * Preload of the Sklubot window (sandboxed, context-isolated: https://www.electronjs.org/docs/latest/tutorial/context-isolation).
 * The web app gets exactly two optional calls, and the main process only accepts them from the main window while it
 * shows the configured server origin:
 *   window.sklubotDesktop.setBadge(n)  — unread count for the tray / Dock / taskbar badge;
 *   window.sklubotDesktop.focus()      — bring the window back (a click on one of the app's notifications).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sklubotDesktop', {
  isDesktop: true,
  platform: process.platform,
  setBadge: (/** @type {number} */ n) => { if (typeof n === 'number') ipcRenderer.send('desktop:badge', n); },
  focus: () => ipcRenderer.send('desktop:focus'),
});
