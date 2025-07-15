const { app, BrowserWindow, nativeImage } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, 'dist/index.html')}`

function createIcon() {
  const color = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${color}"/></svg>`
  return nativeImage.createFromDataURL('data:image/svg+xml;utf8,' + encodeURIComponent(svg))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Naviera App',
    icon: createIcon(),
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
