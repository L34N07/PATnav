const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5173'
const PROD_URL = `file://${path.join(__dirname, 'dist/index.html')}`
const DEFAULT_URL = isDev ? DEV_URL : PROD_URL

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Polls the renderer dev server until it responds so Electron can load it without failing.
const waitForRenderer = async (targetUrl, { timeout = 30000, interval = 250 } = {}) => {
  const deadline = Date.now() + timeout
  const parsed = new URL(targetUrl)
  const client = parsed.protocol === 'https:' ? https : http

  const tryConnect = () =>
    new Promise((resolve, reject) => {
      const request = client.request(
        {
          method: 'HEAD',
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: `${parsed.pathname || '/'}${parsed.search || ''}`
        },
        response => {
          response.destroy()
          resolve()
        }
      )

      request.on('error', reject)
      request.setTimeout(interval, () => {
        request.destroy(new Error('timeout'))
      })
      request.end()
    })

  while (Date.now() < deadline) {
    try {
      await tryConnect()
      return
    } catch (error) {
      await sleep(interval)
    }
  }

  throw new Error(`Timed out waiting for renderer dev server at ${targetUrl}`)
}

class PythonBridge {
  constructor(executablePath) {
    this.executablePath = executablePath
    this.process = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.buffer = ''
    this.queue = []
    this.current = null
    this.exited = false

    if (this.process.stdout) {
      this.process.stdout.setEncoding('utf-8')
      this.process.stdout.on('data', chunk => this._handleStdout(chunk))
    }

    if (this.process.stderr) {
      this.process.stderr.setEncoding('utf-8')
      this.process.stderr.on('data', data => {
        console.error(`[python] ${data.trim()}`)
      })
    }

    this.process.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`
      this._abort(new Error(`Python bridge terminated (${reason})`))
    })

    this.process.on('error', err => {
      this._abort(err)
    })
  }

  isRunning() {
    return Boolean(this.process) && !this.exited
  }

  call(cmd, params = []) {
    if (!this.isRunning()) {
      return Promise.reject(new Error('Python bridge is not running'))
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, params, resolve, reject })
      this._flush()
    })
  }

  dispose() {
    if (!this.process || this.exited) {
      return
    }

    try {
      this.process.stdin?.write(`${JSON.stringify({ cmd: 'exit' })}\n`)
    } catch (err) {
      console.error('Failed to signal python bridge exit:', err)
    }

    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill()
      }
    }, 1000)
  }

  _flush() {
    if (!this.isRunning() || this.current || this.queue.length === 0) {
      return
    }

    const next = this.queue.shift()
    if (!next) {
      return
    }

    this.current = next

    try {
      const payload = JSON.stringify({ cmd: next.cmd, params: next.params })
      this.process.stdin?.write(`${payload}\n`)
    } catch (error) {
      const toReject = this.current
      this.current = null
      toReject?.reject(error)
      this._flush()
    }
  }

  _handleStdout(chunk) {
    this.buffer += chunk
    let newlineIndex = this.buffer.indexOf('\n')

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (line) {
        this._handleResponse(line)
      }

      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  _handleResponse(line) {
    const active = this.current
    this.current = null

    if (!active) {
      console.warn('Unexpected python response with no active request')
      return
    }

    try {
      const parsed = JSON.parse(line)
      active.resolve(parsed)
    } catch (error) {
      active.reject(new Error(`Invalid JSON from python: ${line}`))
    } finally {
      this._flush()
    }
  }

  _abort(error) {
    if (this.exited) {
      return
    }

    this.exited = true

    if (this.current) {
      this.current.reject(error)
      this.current = null
    }

    while (this.queue.length > 0) {
      const pending = this.queue.shift()
      pending?.reject(error)
    }

    if (this.process && !this.process.killed) {
      this.process.kill()
    }

    this.process = null
  }
}

let pythonBridge = null

const resolveScriptPath = () => {
  const scriptName = process.platform === 'win32' ? 'script.exe' : 'script.exe'
  const candidates = []

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, scriptName))
  }

  candidates.push(path.join(__dirname, 'release', scriptName))
  candidates.push(path.join(__dirname, scriptName))

  const match = candidates.find(candidate => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Unable to locate ${scriptName}`)
  }

  return match
}

const getPythonBridge = () => {
  if (pythonBridge && pythonBridge.isRunning()) {
    return pythonBridge
  }

  const scriptPath = resolveScriptPath()
  pythonBridge = new PythonBridge(scriptPath)
  return pythonBridge
}

const createWindow = async () => {
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

  let targetUrl = DEFAULT_URL

  if (isDev) {
    try {
      await waitForRenderer(DEV_URL)
    } catch (error) {
      console.error('Renderer dev server not detected within timeout:', error)
      targetUrl = PROD_URL
    }
  }

  try {
    await win.loadURL(targetUrl)
  } catch (error) {
    console.error('Failed to load renderer URL:', error)
  }

  return win
}

ipcMain.handle('python:get_app_user', async (_event, payload) => {
  const bridge = getPythonBridge()
  const { username } = payload || {}
  return bridge.call('get_app_user', [username])
})

ipcMain.handle('python:get_app_users', async (_event, payload) => {
  const bridge = getPythonBridge()
  const { userType } = payload || {}
  const params = userType ? [userType] : []
  return bridge.call('get_app_users', params)
})

ipcMain.handle('python:get_clientes', async () => {
  const bridge = getPythonBridge()
  return bridge.call('get_clientes')
})

ipcMain.handle('python:traer_incongruencias', async () => {
  const bridge = getPythonBridge()
  return bridge.call('traer_incongruencias')
})

ipcMain.handle('python:update_cliente', async (_event, payload) => {
  const bridge = getPythonBridge()
  const { codCliente, razonSocial, domFiscal, cuit } = payload || {}
  return bridge.call('update_cliente', [codCliente, razonSocial, domFiscal, cuit])
})

ipcMain.handle('python:modificar_cobros_impagos', async () => {
  const bridge = getPythonBridge()
  return bridge.call('modificar_cobros_impagos')
})

ipcMain.handle('python:resumen_remitos', async () => {
  const bridge = getPythonBridge()
  return bridge.call('resumen_remitos')
})

ipcMain.handle('python:traer_resumen_prestamos', async () => {
  const bridge = getPythonBridge()
  return bridge.call('traer_resumen_prestamos')
})

ipcMain.handle('python:traer_movimientos_cliente', async (_event, payload) => {
  const bridge = getPythonBridge()
  const { codCliente, subcodigo = "" } = payload || {}
  if (codCliente === undefined || codCliente === null) {
    return {
      error: 'invalid_params',
      details: 'codCliente is required to traer_movimientos_cliente'
    }
  }
  return bridge.call('traer_movimientos_cliente', [codCliente, subcodigo ?? ""])
})

ipcMain.handle('python:actualizar_infoextra_por_registro', async (_event, payload) => {
  const bridge = getPythonBridge()
  const {
    numeroRemito,
    prefijoRemito,
    tipoComprobante,
    nroOrden,
    infoExtra
  } = payload || {}
  return bridge.call('actualizar_infoextra_por_registro', [
    numeroRemito,
    prefijoRemito,
    tipoComprobante,
    nroOrden,
    infoExtra
  ])
})

ipcMain.handle('python:update_user_permissions', async (_event, payload) => {
  const bridge = getPythonBridge()
  const { userId, permissions } = payload || {}
  return bridge.call('update_user_permissions', [userId, permissions])
})

app.whenReady().then(async () => {
  try {
    getPythonBridge()
  } catch (error) {
    console.error('Failed to start python bridge:', error)
  }

  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    pythonBridge?.dispose()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(error => {
      console.error('Failed to recreate window on activate:', error)
    })
  }
})

app.on('before-quit', () => {
  pythonBridge?.dispose()
})
