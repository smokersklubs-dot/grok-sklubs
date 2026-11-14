'use strict';
/* Test target: a window with a text area that records clicks, keys and its value to $TARGET_LOG (JSON lines). */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: 60, y: 120, width: 760, height: 520, title: 'Cible de test',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  ipcMain.on('ev', (_e, ev) => fs.appendFileSync(process.env.TARGET_LOG, JSON.stringify(ev) + '\n'));
  win.loadFile(path.join(__dirname, 'index.html'));
});
