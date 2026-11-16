// @ts-check
'use strict';
/** Preload of the local first-launch screen (server address). Sandboxed and context-isolated. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sklubotSetup', {
  get: () => ipcRenderer.invoke('setup:get'),
  submit: (/** @type {string} */ url) => ipcRenderer.invoke('setup:submit', url),
  cancel: () => ipcRenderer.invoke('setup:cancel'),
});
