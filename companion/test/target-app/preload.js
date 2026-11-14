'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('log', (ev) => ipcRenderer.send('ev', ev));
