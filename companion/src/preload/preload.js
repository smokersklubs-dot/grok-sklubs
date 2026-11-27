// @ts-check
'use strict';
/**
 * Preload (sandboxed, context-isolated). Exposes a narrow API to the local UI pages.
 * https://www.electronjs.org/docs/latest/tutorial/context-isolation
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relais', {
  i18n: () => ipcRenderer.invoke('i18n'),
  state: () => ipcRenderer.invoke('state'),
  onState: (/** @type {(s: any) => void} */ cb) => { ipcRenderer.on('state', (_e, s) => cb(s)); },
  setServer: (/** @type {string} */ url) => ipcRenderer.invoke('server:set', url),
  cancelPairing: () => ipcRenderer.invoke('pairing:cancel'),
  pause: () => ipcRenderer.invoke('relay:pause'),
  resume: () => ipcRenderer.invoke('relay:resume'),
  repair: () => ipcRenderer.invoke('relay:repair'),
  forget: () => ipcRenderer.invoke('relay:forget'),
  unlock: () => ipcRenderer.invoke('relay:unlock'),
  setBot: (/** @type {string} */ id, /** @type {string} */ key, /** @type {boolean} */ value) => ipcRenderer.invoke('bot:set', id, key, value),
  removeBot: (/** @type {string} */ id) => ipcRenderer.invoke('bot:remove', id),
  setAllBots: (/** @type {boolean} */ value) => ipcRenderer.invoke('relay:allbots', value),
  setAutostart: (/** @type {boolean} */ on) => ipcRenderer.invoke('autostart:set', on),
  addFolder: () => ipcRenderer.invoke('folder:add'),
  setFolderWrite: (/** @type {string} */ id, /** @type {boolean} */ on) => ipcRenderer.invoke('folder:write', id, on),
  removeFolder: (/** @type {string} */ id) => ipcRenderer.invoke('folder:remove', id),
  openLog: () => ipcRenderer.invoke('log:open'),
  requestPermission: (/** @type {string} */ which) => ipcRenderer.invoke('perm:request', which),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  getPrompt: (/** @type {string} */ id) => ipcRenderer.invoke('prompt:get', id),
  answerPrompt: (/** @type {string} */ id, /** @type {string} */ decision, /** @type {any} */ extra) => ipcRenderer.invoke('prompt:answer', id, decision, extra),
  getBanner: () => ipcRenderer.invoke('banner:get'),
});
