const { app, BrowserWindow } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, 'dist/index.html')}`


function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 700,
    title: 'Naviera App',
    icon: path.join(__dirname, 'public', 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.removeMenu()
  win.loadURL(URL)
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
