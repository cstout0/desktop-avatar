// Bridge for the Settings window: read/write settings and run named actions.
const { contextBridge, ipcRenderer } = require('electron');

const RECV = new Set(['changed', 'section', 'status']);

contextBridge.exposeInMainWorld('avatar', {
  get: () => ipcRenderer.invoke('set:get'),
  meta: () => ipcRenderer.invoke('set:meta'),
  set: (key, value) => ipcRenderer.invoke('set:set', key, value),
  action: (name, arg) => ipcRenderer.invoke('set:action', name, arg),
  on: (ch, fn) => {
    if (RECV.has(ch)) ipcRenderer.on(`set:${ch}`, (_e, data) => fn(data));
  },
});
