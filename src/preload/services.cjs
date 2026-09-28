const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['audio', 'status', 'clip']);
const RECV = new Set(['start', 'stop', 'inject', 'inject-end', 'capture']);

contextBridge.exposeInMainWorld('services', {
  send: (ch, data) => {
    if (SEND.has(ch)) ipcRenderer.send(`svc:${ch}`, data);
  },
  on: (ch, fn) => {
    if (RECV.has(ch)) ipcRenderer.on(`svc:${ch}`, (_e, data) => fn(data));
  },
});
