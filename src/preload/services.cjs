const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['audio', 'status', 'clip', 'speech', 'wake']);
const RECV = new Set(['start', 'stop', 'inject', 'inject-end', 'pcm', 'pcm-end', 'capture', 'speak', 'play', 'shush', 'wake-start', 'wake-stop', 'wake-pause']);

contextBridge.exposeInMainWorld('services', {
  send: (ch, data) => {
    if (SEND.has(ch)) ipcRenderer.send(`svc:${ch}`, data);
  },
  on: (ch, fn) => {
    if (RECV.has(ch)) ipcRenderer.on(`svc:${ch}`, (_e, data) => fn(data));
  },
});
