'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  mpvAvailable: () => ipcRenderer.invoke('mpv:available'),
  playInMpv: (opts) => ipcRenderer.invoke('mpv:play', opts),
  stopMpv: () => ipcRenderer.invoke('mpv:stop'),
  mpvState: () => ipcRenderer.invoke('mpv:state'),
  setFullScreen: (full) => ipcRenderer.invoke('window:setFullScreen', full),
  onMpvClosed: (cb) => ipcRenderer.on('mpv:closed', (_e, data) => cb(data)),
  onMpvStarted: (cb) => ipcRenderer.on('mpv:started', (_e, data) => cb(data)),
  onFullscreenChanged: (cb) => ipcRenderer.on('window:fullscreen-changed', (_e, fs) => cb(fs)),
});
