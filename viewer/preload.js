const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('viewerAPI', {
  platform: process.platform
})
