const { app, BrowserWindow, ipcMain, desktopCapturer, dialog } = require('electron')
const path = require('path')

// Check if running as admin on Windows
if (process.platform === 'win32') {
  const { execSync } = require('child_process')
  try {
    execSync('net session', { stdio: 'ignore' })
    console.log('[Host Main] Running as Administrator ✓')
  } catch (e) {
    console.warn('[Host Main] NOT running as Administrator!')
    // Show warning after app is ready
    app.whenReady().then(() => {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Administrator Required',
        message: 'UltraViewer Host needs Administrator privileges for mouse/keyboard control.',
        detail: 'Please close this app and run it as Administrator:\n\nRight-click the terminal → "Run as administrator"\nThen run: npm start',
        buttons: ['OK']
      })
    })
  }
}

let win
let robot = null
let robotLoadAttempted = false
let robotLoadError = null
let robotMissingLogged = false

// Startup logging
console.log('[Host Main] Platform:', process.platform)
console.log('[Host Main] Node:', process.version)
console.log('[Host Main] Electron:', process.versions && process.versions.electron)

function tryLoadRobotJS() {
  if (robotLoadAttempted) return
  robotLoadAttempted = true
  const candidates = ['robotjs', '@jitsi/robotjs']
  for (const name of candidates) {
    try {
      robot = require(name)
      console.log('[Host Main] RobotJS Loaded from', name)
      return
    } catch (e) {
      robotLoadError = e
      console.warn('[Host Main] failed to load', name, e.message)
    }
  }
  robot = null
  console.error('[Host Main] RobotJS unavailable. Control features disabled.')
}

tryLoadRobotJS()

ipcMain.handle('is-robot-available', () => !!robot)


function reportRobotMissingOnce() {
  if (robotMissingLogged) return
  robotMissingLogged = true
  console.error('[Host Main] RobotJS not available; control events ignored.')
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 500,
    resizable: false,
    title: 'UltraViewer - Host',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  const indexPath = path.join(__dirname, 'renderer', 'index.html')
  win.loadFile(indexPath).catch((err) => {
    console.error('[Host Main] loadFile failed:', err)
    win.loadURL(`file://${indexPath}`).catch((err2) => {
      console.error('[Host Main] fallback loadURL failed:', err2)
    })
  })

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Host Main] did-fail-load', errorCode, errorDescription, validatedURL)
  })

  win.once('ready-to-show', () => {
    try {
      win.webContents.send('robot-status', { available: !!robot, error: robotLoadError ? robotLoadError.message : null })
    } catch (e) {
      console.warn('[Host Main] failed to send robot-status to renderer:', e && e.message)
    }
    win.show()
  })
  win.setMenu(null)
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

process.on('uncaughtException', (error) => {
  console.error('[Host Main] uncaughtException:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Host Main] unhandledRejection:', reason)
})

app.on('render-process-gone', (event, webContents, details) => {
  console.error('[Host Main] render-process-gone:', details)
})

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 150, height: 150 }
  })
  return sources.map((s) => ({ id: s.id, name: s.name }))
})

ipcMain.on('minimize-for-capture', () => {
  console.log('[Host Main] hiding window for capture')
  if (win) {
    win.minimize()
    win.hide()
  }
})

ipcMain.on('restore-window', () => {
  console.log('[Host Main] restoring window')
  if (win) {
    win.show()
    win.restore()
  }
})

ipcMain.on('mouse-move', (_, { x, y }) => {
  if (!robot) {
    reportRobotMissingOnce()
    return
  }
  try {
    robot.moveMouse(x, y)
  } catch (e) {
    console.error('[Host Main] moveMouse error:', e.message)
  }
})

ipcMain.on('mouse-click', (_, { button, action }) => {
  console.log('[Host Main] mouse-click:', button, action)
  if (!robot) {
    reportRobotMissingOnce()
    return
  }
  try {
    if (action === 'down') robot.mouseToggle('down', button)
    else if (action === 'up') robot.mouseToggle('up', button)
    else if (action === 'double') robot.mouseClick(button, true)
    else robot.mouseClick(button)
    console.log('[Host Main] mouse-click OK:', button, action)
  } catch (e) {
    console.error('[Host Main] mouse-click error:', e.message)
  }
})

ipcMain.on('mouse-scroll', (_, { dx, dy }) => {
  if (!robot) {
    reportRobotMissingOnce()
    return
  }
  try {
    robot.scrollMouse(dx, dy)
  } catch (e) {
    console.error('[Host Main] mouse-scroll error:', e.message)
  }
})

ipcMain.on('key-press', (_, { key, action }) => {
  console.log('[Host Main] key-press:', key, action)
  if (!robot) {
    reportRobotMissingOnce()
    return
  }
  try {
    const keyMap = {
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      'enter': 'enter',
      'backspace': 'backspace',
      'delete': 'delete',
      'escape': 'escape',
      'tab': 'tab',
      ' ': 'space',
      'control': 'control',
      'alt': 'alt',
      'shift': 'shift',
      'meta': 'command',
      'home': 'home',
      'end': 'end',
      'pageup': 'page_up',
      'pagedown': 'page_down',
      'f1': 'f1',
      'f2': 'f2',
      'f3': 'f3',
      'f4': 'f4',
      'f5': 'f5',
      'f6': 'f6',
      'f7': 'f7',
      'f8': 'f8',
      'f9': 'f9',
      'f10': 'f10',
      'f11': 'f11',
      'f12': 'f12',
      '!': '1',
      '@': '2',
      '#': '3',
      '$': '4',
      '%': '5',
      '^': '6',
      '&': '7',
      '*': '8',
      '(': '9',
      ')': '0',
      '_': 'minus',
      '+': 'equals',
      '?': 'slash',
      ':': 'semicolon',
      '"': 'quote',
      '<': 'comma',
      '>': 'period',
      '|': 'backslash',
      '{': 'open_bracket',
      '}': 'close_bracket',
      '~': 'grave'
    }
    const k = keyMap[key.toLowerCase()] || (key.length === 1 ? key.toLowerCase() : null)
    if (k) {
      if (action === 'down' || action === 'up') {
        robot.keyToggle(k, action)
        console.log('[Host Main] keyToggle OK:', k, action)
      } else {
        robot.keyTap(k)
        console.log('[Host Main] keyTap OK:', k)
      }
    } else {
      console.warn('[Host Main] unknown key:', key)
    }
  } catch (e) {
    console.error('[Host Main] key-press error:', e.message)
  }
})
