const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({}))
