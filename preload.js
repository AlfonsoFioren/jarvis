const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, fn) => { const h = (_e, p) => fn(p); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('jarvis', {
  getState: () => ipcRenderer.invoke('state:get'),
  send: text => ipcRenderer.invoke('chat:send', text),
  stop: () => ipcRenderer.invoke('chat:stop'),
  answerConfirm: (id, ok) => ipcRenderer.invoke('confirm:answer', { id, ok }),
  forget: id => ipcRenderer.invoke('memory:forget', id),
  addMemory: text => ipcRenderer.invoke('memory:add', text),
  cancelReminder: id => ipcRenderer.invoke('reminder:cancel', id),
  clearUpgrades: () => ipcRenderer.invoke('upgrades:clear'),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  wipe: () => ipcRenderer.invoke('state:wipe'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: url => ipcRenderer.invoke('open:external', url),
  openDataFolder: () => ipcRenderer.invoke('open:dataFolder'),
  onDelta: fn => on('chat:delta', fn),
  onNote: fn => on('chat:note', fn),
  onChanged: fn => on('state:changed', fn),
  onConfirm: fn => on('confirm:ask', fn),
  onReminder: fn => on('reminder:fire', fn),
  onUpdate: fn => on('update:status', fn),
  onFocus: fn => on('ui:focus', fn)
});
