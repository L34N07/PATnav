const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, 'dist/index.html')}`

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

let pythonProc

function startPython() {
  pythonProc = spawn(pythonCmd, [path.join(__dirname, 'script.py')])
  pythonProc.stdout.setEncoding('utf8')
}

function stopPython() {
  if (pythonProc) {
    try {
      pythonProc.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n')
    } catch (e) {
      // ignore if stdin already closed
    }
    pythonProc.kill()
    pythonProc = undefined
  }
}

ipcMain.handle('run-python', (_event, cmd, params = []) => {
  if (!pythonProc) return Promise.reject(new Error('python not running'))
  const message = JSON.stringify({ cmd, params }) + '\n'
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (data) => {
      buffer += data.toString()
      if (buffer.includes('\n')) {
        cleanup()
        resolve(buffer.trim())
      }
    }
    const onErr = (err) => {
      cleanup()
      reject(err.toString())
    }
    function cleanup() {
      pythonProc.stdout.off('data', onData)
      pythonProc.stderr.off('data', onErr)
    }
    pythonProc.stdout.on('data', onData)
    pythonProc.stderr.once('data', onErr)
    pythonProc.stdin.write(message)
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

app.whenReady().then(() => {
  startPython()
  createWindow()
})

app.on('window-all-closed', () => {
  stopPython()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
