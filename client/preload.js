const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  hideControllerWindow: () => ipcRenderer.send('hide-controller-window'),
  injectMouseMove: (x, y) => ipcRenderer.send('inject-mouse-move', { x, y }),
  injectMouseClick: (button, action) => ipcRenderer.send('inject-mouse-click', { button, action }),
  injectKey: (key, action) => ipcRenderer.send('inject-key', { key, action }),
});
