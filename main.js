const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const shouldOpenDevTools = isDev || process.env.PATNAV_OPEN_DEVTOOLS === '1'
const enableBridgeLogs = process.env.PATNAV_LOG_BRIDGE !== '0'

const URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(__dirname, 'dist/index.html')}`

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

let pythonProc

function logBridge(message, level = 'log') {
  const prefix = '[python-bridge]'
  switch (level) {
    case 'error':
      console.error(`${prefix} ${message}`)
      break
    case 'warn':
      console.warn(`${prefix} ${message}`)
      break
    case 'info':
      console.info(`${prefix} ${message}`)
      break
    case 'debug':
      console.debug(`${prefix} ${message}`)
      break
    default:
      console.log(`${prefix} ${message}`)
  }
}

function resolvePythonScript() {
  const candidates = [
    path.join(__dirname, 'script.py'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'script.py') : undefined,
    app.isReady() ? path.join(app.getAppPath(), 'script.py') : undefined,
    process.resourcesPath ? path.join(process.resourcesPath, 'script.py') : undefined
  ].filter(Boolean)

  const scriptPath = candidates.find((candidate) => {
    if (candidate.includes('.asar') && !candidate.includes('.asar.unpacked')) {
      return false
    }
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  })

  if (!scriptPath) {
    logBridge(`Could not find script.py. Checked: ${candidates.join(', ')}`, 'error')
    return undefined
  }

  if (enableBridgeLogs) {
    logBridge(`using script at ${scriptPath}`, 'info')
  }

  return scriptPath
}

function startPython() {
  const script = resolvePythonScript()
  if (!script) {
    return
  }

  const env = {
    ...process.env,
    PATNAV_LOG_DIR: process.env.PATNAV_LOG_DIR || app.getPath('logs')
  }

  pythonProc = spawn(pythonCmd, [script], { stdio: ['pipe', 'pipe', 'pipe'], env })
  pythonProc.stdout.setEncoding('utf8')
  pythonProc.stderr.setEncoding('utf8')

  pythonProc.on('spawn', () => {
    logBridge(`started (pid=${pythonProc.pid})`, 'info')
  })

  pythonProc.on('exit', (code, signal) => {
    logBridge(`exited (code=${code}, signal=${signal ?? 'none'})`, code === 0 ? 'info' : 'warn')
  })

  pythonProc.on('error', (error) => {
    logBridge(`process error: ${error.message}`, 'error')
  })

  if (enableBridgeLogs) {
    pythonProc.stdout.on('data', (data) => {
      const text = data.toString().trimEnd()
      if (text) {
        logBridge(`stdout: ${text}`, 'debug')
      }
    })

    pythonProc.stderr.on('data', (data) => {
      const text = data.toString().trimEnd()
      if (text) {
        logBridge(`stderr: ${text}`, 'error')
      }
    })
  }
}

function stopPython() {
  if (pythonProc) {
    try {
      pythonProc.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n')
    } catch (error) {
      logBridge(`failed to send exit command: ${error.message}`, 'warn')
    }
    pythonProc.kill()
    pythonProc = undefined
    logBridge('stopped', 'info')
  }
}

ipcMain.handle('run-python', (_event, cmd, params = []) => {
  if (!pythonProc) {
    return Promise.reject(new Error('python not running'))
  }

  const message = JSON.stringify({ cmd, params }) + '\n'
  if (enableBridgeLogs) {
    logBridge(`sending: ${message.trim()}`, 'info')
  }

  return new Promise((resolve, reject) => {
    let stdoutBuffer = ''
    let stderrBuffer = ''

    const onData = (data) => {
      stdoutBuffer += data.toString()
      if (!stdoutBuffer.includes('\n')) {
        return
      }

      cleanup()
      const response = stdoutBuffer.trim()
      if (stderrBuffer.trim()) {
        const error = new Error(stderrBuffer.trim())
        error.payload = response
        reject(error)
        return
      }

      if (enableBridgeLogs) {
        logBridge(`received: ${response}`, 'info')
      }
      resolve(response)
    }

    const onErr = (data) => {
      stderrBuffer += data.toString()
    }

    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`python exited before responding (code=${code}, signal=${signal ?? 'none'})`))
    }

    function cleanup() {
      pythonProc.stdout.off('data', onData)
      pythonProc.stderr.off('data', onErr)
      pythonProc.off('exit', onExit)
    }

    pythonProc.stdout.on('data', onData)
    pythonProc.stderr.on('data', onErr)
    pythonProc.once('exit', onExit)
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

  if (shouldOpenDevTools) {
    win.webContents.once('dom-ready', () => {
      win.webContents.openDevTools({ mode: 'detach' })
    })
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    logBridge(`renderer crashed: ${details.reason}`, 'error')
  })
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
