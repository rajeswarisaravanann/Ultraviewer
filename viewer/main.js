const { app, BrowserWindow } = require('electron')
const path = require('path')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'UltraViewer - Viewer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  const indexPath = path.join(__dirname, 'renderer', 'index.html')
  mainWindow.loadFile(indexPath).catch((err) => {
    console.error('[Viewer Main] loadFile failed:', err)
    mainWindow.loadURL(`file://${indexPath}`).catch((err2) => {
      console.error('[Viewer Main] fallback loadURL failed:', err2)
    })
  })

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Viewer Main] did-fail-load', errorCode, errorDescription, validatedURL)
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.setMenu(null)
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

process.on('uncaughtException', (error) => {
  console.error('[Viewer Main] uncaughtException:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Viewer Main] unhandledRejection:', reason)
})

app.on('render-process-gone', (event, webContents, details) => {
  console.error('[Viewer Main] render-process-gone:', details)
})
