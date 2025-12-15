const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { pathToFileURL } = require('url')

const getResourcesRoot = () => (app.isPackaged ? process.resourcesPath : path.resolve(__dirname))
const resolveResourcePath = (...segments) => path.join(getResourcesRoot(), ...segments)

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5173'
const PROD_URL = `file://${path.join(__dirname, 'dist/index.html')}`
const DEFAULT_URL = isDev ? DEV_URL : PROD_URL
const UPLOADS_DIR = resolveResourcePath('uploads')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  }
}

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
    const resourcesRoot = getResourcesRoot()
    this.process = spawn(executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: resourcesRoot,
      env: {
        ...process.env,
        ELECTRON_RESOURCES_PATH: resourcesRoot
      }
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
  const scriptNames = process.platform === 'win32' ? ['script.exe'] : ['script', 'script.exe']
  const candidates = []

  const addCandidates = basePath => {
    scriptNames.forEach(name => {
      candidates.push(path.join(basePath, name))
    })
  }

  if (app.isPackaged) {
    addCandidates(process.resourcesPath)
  }

  addCandidates(path.join(__dirname, 'release'))
  addCandidates(__dirname)

  const match = candidates.find(candidate => fs.existsSync(candidate))
  if (!match) {
    throw new Error(`Unable to locate bridge executable (${scriptNames.join(', ')})`)
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

const registerPythonHandler = (channel, command, options = {}) => {
  const { mapPayload, validate } = options

  ipcMain.handle(channel, async (_event, payload) => {
    const safePayload = payload ?? {}

    if (validate) {
      const validationError = validate(safePayload)
      if (validationError) {
        return validationError
      }
    }

    const rawParams = mapPayload ? mapPayload(safePayload) : []
    const params = Array.isArray(rawParams)
      ? rawParams
      : rawParams === undefined || rawParams === null
        ? []
        : [rawParams]

    return getPythonBridge().call(command, params)
  })
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

ipcMain.handle('uploads:list_images', async () => {
  try {
    ensureUploadsDir()
    const entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter(entry => entry.isFile())
        .filter(entry => /\.jpe?g$/i.test(entry.name))
        .map(async entry => {
          const filePath = path.join(UPLOADS_DIR, entry.name)
          const [stats, buffer] = await Promise.all([
            fs.promises.stat(filePath),
            fs.promises.readFile(filePath)
          ])
          return {
            fileName: entry.name,
            filePath,
            fileUrl: pathToFileURL(filePath).href,
            dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
            modifiedTime: stats.mtimeMs,
            size: stats.size
          }
        })
    )

    files.sort((a, b) => b.modifiedTime - a.modifiedTime)
    return { files }
  } catch (error) {
    console.error('Failed to list upload images:', error)
    return {
      error: 'read_failed',
      details: error instanceof Error ? error.message : 'No se pudieron leer las imagenes.'
    }
  }
})

registerPythonHandler('python:get_app_user', 'get_app_user', {
  mapPayload: payload => [payload.username]
})

registerPythonHandler('python:get_app_users', 'get_app_users', {
  mapPayload: payload => (payload.userType ? [payload.userType] : [])
})

registerPythonHandler('python:get_clientes', 'get_clientes')

registerPythonHandler('python:traer_incongruencias', 'traer_incongruencias')

registerPythonHandler('python:update_cliente', 'update_cliente', {
  mapPayload: payload => [
    payload.codCliente,
    payload.razonSocial,
    payload.domFiscal,
    payload.cuit
  ]
})

registerPythonHandler('python:modificar_cobros_impagos', 'modificar_cobros_impagos')

registerPythonHandler('python:resumen_remitos', 'resumen_remitos')

registerPythonHandler('python:traer_resumen_prestamos', 'traer_resumen_prestamos')

registerPythonHandler('python:traer_movimientos_cliente', 'traer_movimientos_cliente', {
  validate: payload => {
    if (payload.codCliente === undefined || payload.codCliente === null) {
      return {
        error: 'invalid_params',
        details: 'codCliente is required to traer_movimientos_cliente'
      }
    }
    return undefined
  },
  mapPayload: payload => [payload.codCliente, payload.subcodigo ?? '']
})

registerPythonHandler(
  'python:actualizar_infoextra_por_registro',
  'actualizar_infoextra_por_registro',
  {
    mapPayload: payload => [
      payload.numeroRemito,
      payload.prefijoRemito,
      payload.tipoComprobante,
      payload.nroOrden,
      payload.infoExtra
    ]
  }
)

registerPythonHandler('python:actualizar_nuevo_stock', 'actualizar_nuevo_stock', {
  mapPayload: payload => [
    payload.tipoComprobante,
    payload.prefijoRemito,
    payload.numeroRemito,
    payload.nroOrden,
    payload.nuevoStock
  ]
})

registerPythonHandler('python:update_user_permissions', 'update_user_permissions', {
  mapPayload: payload => [payload.userId, payload.permissions]
})

registerPythonHandler(
  'python:ingresar_registro_hoja_de_ruta',
  'ingresar_registro_hoja_de_ruta',
  {
    validate: payload => {
      if (!payload?.motivo || !payload?.detalle || !payload?.recorrido || !payload?.fechaRecorrido) {
        return {
          error: 'invalid_params',
          details: 'motivo, detalle, recorrido and fechaRecorrido are required'
        }
      }
      return undefined
    },
    mapPayload: payload => [
      payload.motivo,
      payload.detalle,
      payload.recorrido,
      payload.fechaRecorrido
    ]
  }
)

registerPythonHandler('python:analyze_upload_image', 'analyze_upload_image', {
  validate: payload => {
    if (!payload?.filePath) {
      return { error: 'invalid_params', details: 'filePath is required to analyze an image' }
    }
    return undefined
  },
  mapPayload: payload => [payload.filePath]
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
