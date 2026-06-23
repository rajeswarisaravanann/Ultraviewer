const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hostAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  minimizeWindow: () => ipcRenderer.send('minimize-for-capture'),
  restoreWindow: () => ipcRenderer.send('restore-window'),
  mouseMove: (x, y) => ipcRenderer.send('mouse-move', { x, y }),
  mouseClick: (button, action) => ipcRenderer.send('mouse-click', { button, action }),
  mouseScroll: (dx, dy) => ipcRenderer.send('mouse-scroll', { dx, dy }),
  keyPress: (key, action) => ipcRenderer.send('key-press', { key, action })
})
