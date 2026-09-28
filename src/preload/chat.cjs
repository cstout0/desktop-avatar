const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['submit', 'cancel', 'mic', 'audio', 'voice-state']);
const RECV = new Set(['shown', 'hidden', 'status', 'listen', 'transcript']);

contextBridge.exposeInMainWorld('chat', {
  send: (ch, data) => {
    if (SEND.has(ch)) ipcRenderer.send(`chat:${ch}`, data);
  },
  on: (ch, fn) => {
    if (RECV.has(ch)) ipcRenderer.on(`chat:${ch}`, (_e, data) => fn(data));
  },
});
