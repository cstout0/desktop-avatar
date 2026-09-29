// Bridge between an overlay window and the main process. Only whitelisted
// channels are exposed; the page never gets Node or raw ipcRenderer access.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set([
  'ignore',
  'snapshot',
  'handoff',
  'claim',
  'armed',
  'key',
  'blurred',
  'control-changed',
  'release-focus',
  'open-chat',
  'context-menu',
  'bubble-action',
  'report',
  'bounce',
  'said',
  'game',
]);
const RECV = new Set([
  'world',
  'become-brain',
  'become-viewer',
  'snapshot',
  'request-handoff',
  'evacuate',
  'say',
  'hide-bubble',
  'do',
  'cursor',
  'key',
  'control',
  'audio',
  'settings',
  'speaking',
  'focus',
]);
const INVOKE = new Set(['ready']);

contextBridge.exposeInMainWorld('overlay', {
  invoke: (ch, data) => (INVOKE.has(ch) ? ipcRenderer.invoke(`ov:${ch}`, data) : Promise.reject(new Error(`blocked: ${ch}`))),
  send: (ch, data) => {
    if (SEND.has(ch)) ipcRenderer.send(`ov:${ch}`, data);
  },
  on: (ch, fn) => {
    if (RECV.has(ch)) ipcRenderer.on(`ov:${ch}`, (_e, data) => fn(data));
  },
});
