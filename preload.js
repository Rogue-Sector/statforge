const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (data) => ipcRenderer.invoke('library:save', data),
  copy: (text, html) => ipcRenderer.invoke('clipboard:write', { text, html }),
  exportFile: (suggestedName, data) => ipcRenderer.invoke('file:export', { suggestedName, data }),
  importFile: () => ipcRenderer.invoke('file:import'),
});
