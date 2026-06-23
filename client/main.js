const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

let robot = null;
try {
  robot = require('robotjs');
  console.log('[Main] robotjs loaded OK');
} catch (e) {
  robot = null;
  console.error('[Main] robotjs failed:', e.message);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    title: 'UltraViewer Lite',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(indexPath).catch((err) => {
    console.error('[Client Main] loadFile failed:', err);
    mainWindow.loadURL(`file://${indexPath}`).catch((err2) => {
      console.error('[Client Main] fallback loadURL failed:', err2);
    });
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Client Main] did-fail-load', errorCode, errorDescription, validatedURL);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (error) => {
  console.error('[Client Main] uncaughtException:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Client Main] unhandledRejection:', reason);
});

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 150, height: 150 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
    }));
  } catch (error) {
    console.error('[Main] get-sources failed:', error);
    return [];
  }
});

ipcMain.on('hide-controller-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('inject-mouse-move', (event, { x, y }) => {
  if (!robot) {
    console.error('[Main] robot not loaded');
    return;
  }
  try {
    robot.moveMouse(x, y);
  } catch (error) {
    console.error('[Main] moveMouse error:', error.message, 'x:', x, 'y:', y);
  }
});

ipcMain.on('inject-mouse-click', (event, { button, action }) => {
  if (!robot) {
    console.error('[Main] robot not loaded');
    return;
  }
  try {
    if (action === 'down') {
      robot.mouseToggle('down', button);
    } else if (action === 'up') {
      robot.mouseToggle('up', button);
    } else if (action === 'double') {
      robot.mouseClick(button, true);
    } else {
      robot.mouseClick(button);
    }
  } catch (error) {
    console.error('[Main] mouseClick error:', error.message, 'button:', button, 'action:', action);
  }
});

ipcMain.on('inject-key', (event, { key, action }) => {
  if (!robot) {
    console.error('[Main] robot not loaded');
    return;
  }

  const keyMap = {
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    enter: 'enter',
    backspace: 'backspace',
    delete: 'delete',
    escape: 'escape',
    esc: 'escape',
    tab: 'tab',
    ' ': 'space',
    space: 'space',
    control: 'control',
    ctrl: 'control',
    alt: 'alt',
    shift: 'shift',
    meta: 'command',
    command: 'command',
    capslock: 'caps_lock',
    home: 'home',
    end: 'end',
    pageup: 'page_up',
    pagedown: 'page_down',
    f1: 'f1',
    f2: 'f2',
    f3: 'f3',
    f4: 'f4',
    f5: 'f5',
    f6: 'f6',
    f7: 'f7',
    f8: 'f8',
    f9: 'f9',
    f10: 'f10',
    f11: 'f11',
    f12: 'f12',
  };

  try {
    const normalized = String(key || '').toLowerCase();
    const mappedKey = keyMap[normalized] || normalized;
    if (mappedKey.length === 1 || Object.prototype.hasOwnProperty.call(keyMap, normalized)) {
      robot.keyToggle(mappedKey, action);
    } else {
      console.warn('[Main] Unsupported key:', key);
    }
  } catch (error) {
    console.error('[Main] keyToggle error:', error.message, 'key:', key, 'action:', action);
  }
});
