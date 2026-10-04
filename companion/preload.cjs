// The window's only bridge to the main process: receive state, send a few fixed actions.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, data) => fn(data));

contextBridge.exposeInMainWorld('medley', {
  onState: on('state'),
  onStatus: on('status'),
  onPresence: on('presence'),
  onPinned: on('pinned'),
  command: (cmd) => ipcRenderer.invoke('command', cmd),
  connect: (code) => ipcRenderer.invoke('connect', code),
  window: (action) => ipcRenderer.send('window', action),
});
