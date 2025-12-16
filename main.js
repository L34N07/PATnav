const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
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

const RECORRIDO_DAY_ORDER = Object.freeze({ L: 0, M: 1, X: 2, J: 3, V: 4, S: 5 })

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const normalizeDiaRecorrido = value => String(value ?? '').trim().toUpperCase()

const parseRecorrido = value => {
  const raw = String(value ?? '').trim().toUpperCase()
  const match = /^(\d+)\s*([A-Z])$/.exec(raw)
  if (!match) {
    return { key: raw, numero: Number.POSITIVE_INFINITY, dia: raw.slice(-1) }
  }

  return { key: `${match[1]}${match[2]}`, numero: Number(match[1]), dia: match[2] }
}

const chunkArray = (items, size) => {
  if (!Array.isArray(items) || size <= 0) {
    return []
  }

  const chunks = []
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size))
  }
  return chunks
}

const pickRowValue = (row, key) => {
  if (!row || typeof row !== 'object') {
    return undefined
  }
  return row[key] ?? row[key?.toUpperCase?.()] ?? row[key?.toLowerCase?.()]
}

const sanitizePdfBaseName = value => {
  const raw = String(value ?? '').replace(/\.pdf$/i, '').trim() || 'documento'
  const sanitized = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized.slice(0, 80) || 'documento'
}

const normalizeHojaDeRutaRow = row => ({
  motivo: pickRowValue(row, 'Motivo') ?? '',
  detalle: pickRowValue(row, 'DetallesRecorrido') ?? '',
  recorrido: pickRowValue(row, 'Recorrido') ?? '',
  fecha: pickRowValue(row, 'FechasRecorrido') ?? ''
})

const buildHojaDeRutaSlots = rows => {
  const grouped = new Map()

  for (const row of rows ?? []) {
    const normalized = normalizeHojaDeRutaRow(row)
    const parsed = parseRecorrido(normalized.recorrido)
    if (!parsed.key) {
      continue
    }

    const hasContent = [normalized.motivo, normalized.detalle, normalized.fecha].some(
      value => String(value ?? '').trim().length > 0
    )
    if (!hasContent) {
      continue
    }

    const existing = grouped.get(parsed.key) ?? []
    existing.push({ ...normalized, recorrido: parsed.key })
    grouped.set(parsed.key, existing)
  }

  const sortedKeys = [...grouped.keys()].sort((left, right) => {
    const a = parseRecorrido(left)
    const b = parseRecorrido(right)
    if (a.numero !== b.numero) {
      return a.numero - b.numero
    }
    const dayDiff = (RECORRIDO_DAY_ORDER[a.dia] ?? 99) - (RECORRIDO_DAY_ORDER[b.dia] ?? 99)
    if (dayDiff !== 0) {
      return dayDiff
    }
    return left.localeCompare(right)
  })

  const slots = []
  for (const key of sortedKeys) {
    const groupRows = grouped.get(key) ?? []
    const chunks = chunkArray(groupRows, 15)
    chunks.forEach((chunk, index) => {
      const totalParts = chunks.length
      const suffix = totalParts > 1 ? ` (${index + 1}/${totalParts})` : ''
      slots.push({
        recorrido: key,
        title: `${key}${suffix}`,
        rows: chunk
      })
    })
  }

  return slots
}

const paginateHojaDeRutaSlots = slots => {
  const remaining = Array.isArray(slots) ? [...slots] : []
  const pages = []

  while (remaining.length > 0) {
    const remainingCount = remaining.length
    const shouldUseFour =
      remainingCount === 4 || (remainingCount % 3 === 1 && remainingCount > 4)
    const layout = shouldUseFour ? 4 : 3
    const take = shouldUseFour ? 4 : 3
    pages.push({ layout, slots: remaining.splice(0, take) })
  }

  if (pages.length === 0) {
    pages.push({ layout: 3, slots: [] })
  }

  return pages
}

const buildHojaDeRutaHtml = ({ pages }) => {
  const renderSlot = slot => {
    const title = escapeHtml(slot?.title ?? '')
    const rows = Array.isArray(slot?.rows)
      ? slot.rows.filter(row =>
          [row?.motivo, row?.detalle, row?.fecha].some(
            value => String(value ?? '').trim().length > 0
          )
        )
      : []

    const rowMarkup = rows
      .map(
        row => `
          <tr>
            <td class="cell cell--motivo">${escapeHtml(row.motivo ?? '')}</td>
            <td class="cell cell--detalle">${escapeHtml(row.detalle ?? '')}</td>
            <td class="cell cell--fecha">${escapeHtml(row.fecha ?? '')}</td>
          </tr>
        `
      )
      .join('')

    return `
      <section class="slot">
        <header class="slot__header">
          <div class="slot__title">ZONA ${title}</div>
        </header>
        <table class="slot__table" aria-label="Hoja de ruta ${title}">
          <colgroup>
            <col class="col-motivo" />
            <col class="col-detalle" />
            <col class="col-fecha" />
          </colgroup>
          <thead>
            <tr>
              <th>Motivo</th>
              <th>Detalles</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${rowMarkup}
          </tbody>
        </table>
      </section>
    `
  }

  const renderPage = (page, index) => {
    const layout = page.layout === 4 ? 4 : 3
    const slots = Array.isArray(page.slots) ? page.slots : []

    const slotMarkup = slots.map(slot => renderSlot(slot)).join('')

    return `
      <section class="page page--${layout}">
        <div class="page__grid page__grid--${layout}">
          ${
            slotMarkup
              ? slotMarkup
              : '<div class="page__empty">Sin registros para este día.</div>'
          }
        </div>
      </section>
    `
  }

  const pageMarkup = pages.map((page, index) => renderPage(page, index)).join('')

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hoja de Ruta</title>
    <style>
      :root {
        --page-width: 210mm;
        --page-height: 297mm;
        --page-margin: 10mm;
        --content-width: calc(var(--page-width) - (var(--page-margin) * 2));
        --content-height: calc(var(--page-height) - (var(--page-margin) * 2));
      }

      @page { size: A4; margin: var(--page-margin); }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
      * { box-sizing: border-box; }

      body { width: var(--content-width); }

      .page {
        break-after: page;
        width: var(--content-width);
        min-height: var(--content-height);
      }
      .page:last-child { break-after: auto; }

      .page__grid {
        display: grid;
        gap: 3mm;
        min-height: 0;
        height: 100%;
        width: 100%;
      }
      .page__grid--3 { grid-template-rows: repeat(3, minmax(0, 1fr)); }
      .page__grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); }

      .page__empty {
        font-size: 12pt;
        color: #444;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px dashed #666;
        border-radius: 2mm;
        padding: 6mm;
      }

      .slot {
        border: none;
        border-radius: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1.5mm;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      .slot__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .slot__title {
        font-size: 10pt;
        font-weight: 700;
        white-space: nowrap;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .slot__table {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 8pt;
      }
      .slot__table th, .slot__table td {
        border: 1px solid #111;
        padding: 0.8mm 1.2mm;
        vertical-align: middle;
      }
      .slot__table th {
        background: #f5f5f5;
        font-weight: 700;
        text-align: left;
      }
      .slot__table th, .slot__table td { max-width: 0; }
      .slot__table thead tr { height: 4.8mm; }
      .slot__table tbody tr { height: 4.8mm; }

      .cell {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .col-motivo { width: 22%; }
      .col-detalle { width: 58%; }
      .col-fecha { width: 20%; }

      .page--4 .slot__table { font-size: 7.6pt; }
      .page--4 .slot__title { font-size: 9.4pt; }
      .page--4 .col-motivo { width: 26%; }
      .page--4 .col-detalle { width: 54%; }
      .page--4 .col-fecha { width: 20%; }
    </style>
  </head>
  <body>
    ${pageMarkup}
  </body>
</html>`
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

const loadHtmlInWindow = async (win, html) => {
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  await win.loadURL(dataUrl)
}

const fetchHojaDeRutaRowsForDia = async diaRecorrido => {
  const diaValue = normalizeDiaRecorrido(diaRecorrido)
  const allowed = new Set(['L', 'M', 'X', 'J', 'V', 'S'])
  if (!allowed.has(diaValue)) {
    return {
      error: 'invalid_params',
      details: 'diaRecorrido must be one of L, M, X, J, V, S'
    }
  }

  const result = await getPythonBridge().call('traer_hoja_de_ruta_por_dia', [diaValue])
  if (result?.error) {
    return result
  }
  return { rows: Array.isArray(result?.rows) ? result.rows : [] }
}

const buildHojaDeRutaHtmlForDia = async diaRecorrido => {
  const fetchResult = await fetchHojaDeRutaRowsForDia(diaRecorrido)
  if (fetchResult?.error) {
    return fetchResult
  }

  const slots = buildHojaDeRutaSlots(fetchResult.rows ?? [])
  const pages = paginateHojaDeRutaSlots(slots)
  const html = buildHojaDeRutaHtml({ pages })
  return { html }
}

ipcMain.handle('pdf:preview_hoja_de_ruta', async (_event, payload) => {
  try {
    const diaRecorrido = payload?.diaRecorrido
    const htmlResult = await buildHojaDeRutaHtmlForDia(diaRecorrido)
    if (htmlResult?.error) {
      return htmlResult
    }

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    try {
      await loadHtmlInWindow(pdfWindow, htmlResult.html)
      const buffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        preferCSSPageSize: true
      })
      return { base64: buffer.toString('base64') }
    } finally {
      pdfWindow.destroy()
    }
  } catch (error) {
    console.error('Failed to generate Hoja de Ruta PDF preview:', error)
    return {
      error: 'pdf_generation_failed',
      details: error instanceof Error ? error.message : 'No se pudo generar el PDF.'
    }
  }
})

ipcMain.handle('pdf:print_hoja_de_ruta', async (_event, payload) => {
  try {
    const diaRecorrido = payload?.diaRecorrido
    const htmlResult = await buildHojaDeRutaHtmlForDia(diaRecorrido)
    if (htmlResult?.error) {
      return htmlResult
    }

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    try {
      await loadHtmlInWindow(printWindow, htmlResult.html)
      const printResult = await new Promise(resolve => {
        printWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          resolve({ success, reason })
        })
      })
      if (!printResult.success) {
        return {
          error: 'print_failed',
          details: printResult.reason || 'No se pudo imprimir el documento.'
        }
      }
      return { status: 'ok' }
    } finally {
      printWindow.destroy()
    }
  } catch (error) {
    console.error('Failed to print Hoja de Ruta:', error)
    return {
      error: 'print_failed',
      details: error instanceof Error ? error.message : 'No se pudo imprimir el documento.'
    }
  }
})

ipcMain.handle('pdf:save_pdf', async (_event, payload) => {
  try {
    const base64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
    if (!base64) {
      return { error: 'invalid_params', details: 'base64 is required' }
    }

    const suggestedFileName =
      typeof payload?.suggestedFileName === 'string' && payload.suggestedFileName.trim()
        ? payload.suggestedFileName.trim()
        : 'documento.pdf'

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Guardar PDF',
      defaultPath: suggestedFileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })

    if (canceled || !filePath) {
      return { status: 'canceled' }
    }

    const buffer = Buffer.from(base64, 'base64')
    await fs.promises.writeFile(filePath, buffer)
    return { status: 'ok', filePath }
  } catch (error) {
    console.error('Failed to save PDF:', error)
    return {
      error: 'save_failed',
      details: error instanceof Error ? error.message : 'No se pudo guardar el PDF.'
    }
  }
})

ipcMain.handle('pdf:open_pdf', async (_event, payload) => {
  try {
    const base64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
    if (!base64) {
      return { error: 'invalid_params', details: 'base64 is required' }
    }

    const suggestedFileName =
      typeof payload?.suggestedFileName === 'string' && payload.suggestedFileName.trim()
        ? payload.suggestedFileName.trim()
        : 'documento.pdf'

    const baseName = sanitizePdfBaseName(suggestedFileName)
    const fileName = `${baseName}_${Date.now()}.pdf`
    const filePath = path.join(app.getPath('temp'), fileName)

    const buffer = Buffer.from(base64, 'base64')
    await fs.promises.writeFile(filePath, buffer)

    const openResult = await shell.openPath(filePath)
    if (openResult) {
      return { error: 'open_failed', details: openResult }
    }

    return { status: 'ok', filePath }
  } catch (error) {
    console.error('Failed to open PDF:', error)
    return {
      error: 'open_failed',
      details: error instanceof Error ? error.message : 'No se pudo abrir el PDF.'
    }
  }
})

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
  'python:insertar_envases_en_hoja_de_ruta',
  'insertar_envases_en_hoja_de_ruta'
)

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

registerPythonHandler('python:traer_hoja_de_ruta', 'traer_hoja_de_ruta')

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
