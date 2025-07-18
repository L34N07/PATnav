const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  runPython: (cmd, params) => ipcRenderer.invoke('run-python', cmd, params)
})