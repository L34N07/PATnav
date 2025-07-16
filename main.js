const { app, BrowserWindow, ipcMain } = require('electron')
const { execFile } = require('child_process')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, 'dist/index.html')}`


ipcMain.handle('run-python', () => {
  return new Promise((resolve, reject) => {
    execFile('python3', [path.join(__dirname, 'script.py')], (error, stdout, stderr) => {
      if (error) {
        console.error(stderr)
        reject(stderr)
      } else {
        resolve(stdout)
      }
    })
  })
})


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
app.on('window-all-closed', () => { app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
