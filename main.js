const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { pathToFileURL } = require('url')

const getResourcesRoot = () => (app.isPackaged ? process.resourcesPath : path.resolve(__dirname))
const resolveResourcePath = (...segments) => path.join(getResourcesRoot(), ...segments)
const resolveBundledResourcePath = (...segments) => {
  const candidates = [
    path.join(app.getAppPath(), ...segments),
    path.join(__dirname, ...segments),
    resolveResourcePath(...segments)
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]
}

const isDev = process.env.NODE_ENV === 'development'
const DEV_URL = 'http://localhost:5173'
const PROD_URL = `file://${path.join(__dirname, 'dist/index.html')}`
const DEFAULT_URL = isDev ? DEV_URL : PROD_URL
const UPLOADS_DIR = resolveResourcePath('uploads')
const UPLOAD_IMAGE_MIME_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
})

if (process.platform === 'linux' && process.env.PATNAV_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ensureUploadsDir = () => {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  }
}

const getUploadImageMimeType = fileName =>
  UPLOAD_IMAGE_MIME_TYPES[path.extname(fileName).toLowerCase()] ?? null

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
      .cell--detalle {
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        text-overflow: clip;
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

const FACULTAD_TIPO_COMPROBANTE = 'FB'
const FACULTAD_PREFIJO = 7

const formatFacultadDate = value => {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
  }

  const date = new Date(raw)
  if (!Number.isNaN(date.getTime())) {
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = String(date.getFullYear())
    return `${day}/${month}/${year}`
  }

  return raw
}

const formatFacultadNumber = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return String(value ?? '')
  }
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(number)
}

const formatFacultadMoney = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return ''
  }
  return `$ ${formatFacultadMoneyAmount(number)}`
}

const formatFacultadMoneyAmount = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return ''
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number)
}

const renderFacultadItemMoney = value => {
  const amount = formatFacultadMoneyAmount(value)
  if (!amount) {
    return ''
  }

  return `<span class="money-symbol">$</span><span class="money-value">${escapeHtml(amount)}</span>`
}

const toFacultadNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const formatFacultadBillNumber = (prefijo, numero) =>
  `${String(Number(prefijo) || 0).padStart(4, '0')}-${String(Number(numero) || 0).padStart(8, '0')}`

const formatFacultadInvoiceFileBaseName = invoice => {
  const tipo = String(invoice?.tipo_comprobante ?? FACULTAD_TIPO_COMPROBANTE).trim() || FACULTAD_TIPO_COMPROBANTE
  return `${tipo} ${formatFacultadBillNumber(invoice?.prefijo ?? FACULTAD_PREFIJO, invoice?.numero)}_FACULTAD`
}

const formatFacultadRemitos = value => {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }
  return raw.replace(/^remitos:\s*/i, '')
}

const getFacultadTemplateDataUrl = () => {
  const templatePath = resolveBundledResourcePath('src', 'assets', 'facultad', 'fb-template.png')
  const template = fs.readFileSync(templatePath)
  return `data:image/png;base64,${template.toString('base64')}`
}

const buildFacultadFacturasHtml = ({ invoices }) => {
  const templateDataUrl = getFacultadTemplateDataUrl()

  const renderItemRows = invoice => {
    const items = Array.isArray(invoice?.items) ? invoice.items : []
    const visibleItems = items.length > 0 ? items : [{}]
    return visibleItems
      .map(item => {
        const description = String(item.denominacion ?? item.cod_item ?? '').trim()
        return `
            <div class="item-row">
              <div class="item-qty">${escapeHtml(formatFacultadNumber(item.cantidad ?? ''))}</div>
              <div class="item-description">${escapeHtml(description)}</div>
              <div class="item-price">${renderFacultadItemMoney(item.precio)}</div>
              <div class="item-total">${renderFacultadItemMoney(item.importe)}</div>
            </div>
        `
      })
      .join('')
  }

  const renderInvoice = invoice => {
    const items = Array.isArray(invoice?.items) ? invoice.items : []
    const total = items.reduce((sum, item) => sum + toFacultadNumber(item?.importe), 0)
    return `
      <section class="invoice-page">
        <img class="template" src="${templateDataUrl}" alt="" />
        <div class="erase bill-number-erase"></div>
        <div class="erase date-erase"></div>
        <div class="erase client-name-erase"></div>
        <div class="erase client-address-erase"></div>
        <div class="erase client-iva-erase"></div>
        <div class="erase client-cuit-erase"></div>
        <div class="erase payment-condition-erase"></div>
        <div class="erase item-price-currency-erase"></div>
        <div class="erase item-total-currency-erase"></div>
        <div class="erase total-erase"></div>

        <div class="field bill-number">${escapeHtml(formatFacultadBillNumber(invoice.prefijo, invoice.numero))}</div>
        <div class="field date">${escapeHtml(formatFacultadDate(invoice.fecha_operacion))}</div>
        <div class="field client-name">${escapeHtml(invoice.razon_social ?? '')}</div>
        <div class="field client-address">${escapeHtml(invoice.dom_fiscal1 ?? '')}</div>
        <div class="field client-address-extra">-</div>
        <div class="field client-iva">${escapeHtml(invoice.categoria ?? '')}</div>
        <div class="field client-cuit">${escapeHtml(invoice.cuit ?? '')}</div>
        <div class="field payment-condition">Contado</div>
        <div class="items">${renderItemRows(invoice)}</div>
        <div class="field remitos">${escapeHtml(formatFacultadRemitos(invoice.remitos_facturados))}</div>
        <div class="field total">${escapeHtml(formatFacultadMoney(total).replace('$ ', ''))}</div>
        <div class="field cae-number">${escapeHtml(invoice.cae ?? '')}</div>
        <div class="field cae-date">${escapeHtml(formatFacultadDate(invoice.fecha_vencimiento_cae))}</div>
      </section>
    `
  }

  const pageMarkup = (Array.isArray(invoices) ? invoices : []).map(renderInvoice).join('')

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Facultad FB ${FACULTAD_PREFIJO}</title>
    <style>
      @page { size: A5 landscape; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; }
      body { font-family: Arial, Helvetica, sans-serif; }
      * { box-sizing: border-box; }
      .invoice-page {
        position: relative;
        width: 210mm;
        height: 148mm;
        page-break-after: always;
        overflow: hidden;
        background: #fff;
        font-size: 8.6pt;
      }
      .invoice-page:last-child { page-break-after: auto; }
      .template {
        position: absolute;
        inset: 0;
        width: 210mm;
        height: 148mm;
        display: block;
      }
      .erase { position: absolute; background: #fff; }
      .field {
        position: absolute;
        font-size: 8.8pt;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bill-number-erase { left: 153.9mm; top: 15.8mm; width: 25.8mm; height: 4.3mm; }
      .date-erase { left: 153.9mm; top: 21.3mm; width: 18.6mm; height: 4.3mm; }
      .client-name-erase { left: 30.6mm; top: 44.2mm; width: 54.6mm; height: 3.8mm; }
      .client-address-erase { left: 30.6mm; top: 48.5mm; width: 22.2mm; height: 3.8mm; }
      .client-iva-erase { left: 156.4mm; top: 44.2mm; width: 9.8mm; height: 3.8mm; }
      .client-cuit-erase { left: 156.4mm; top: 48.2mm; width: 20mm; height: 3.8mm; }
      .payment-condition-erase { left: 156.4mm; top: 52.35mm; width: 22.5mm; height: 3.8mm; }
      .total-erase { left: 172.8mm; top: 130.1mm; width: 17mm; height: 4.4mm; }
      .bill-number { left: 154.33mm; top: 16.09mm; width: 25mm; font-size: 10.1pt; font-weight: 400; }
      .date { left: 154.33mm; top: 21.58mm; width: 18mm; font-size: 10.1pt; font-weight: 400; }
      .client-name { left: 31mm; top: 44.29mm; width: 54mm; font-size: 7.6pt; font-weight: 400; }
      .client-address { left: 31mm; top: 48.82mm; width: 22mm; font-size: 7.6pt; font-weight: 400; }
      .client-address-extra { left: 31mm; top: 53.08mm; width: 4mm; font-size: 7.6pt; font-weight: 400; }
      .client-iva { left: 156.96mm; top: 44.22mm; width: 10mm; font-size: 7.6pt; font-weight: 400; }
      .client-cuit { left: 156.96mm; top: 48.19mm; width: 20mm; font-size: 7.6pt; font-weight: 400; }
      .payment-condition { left: 156.96mm; top: 52.37mm; width: 18mm; font-size: 7.6pt; font-weight: 400; }
      .item-price-currency-erase { left: 150.4mm; top: 65.9mm; width: 15.6mm; height: 4.2mm; }
      .item-total-currency-erase { left: 172.5mm; top: 65.9mm; width: 18.8mm; height: 4.2mm; }
      .items { position: absolute; left: 0; top: 66.45mm; width: 210mm; font-size: 7.6pt; }
      .item-row { position: relative; height: 5.2mm; }
      .item-row > div { position: absolute; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item-qty { left: 21.35mm; width: 3.4mm; text-align: right; }
      .item-description { left: 25.41mm; width: 115mm; }
      .item-price { left: 150.95mm; width: 15mm; text-align: left; }
      .item-total { left: 173.05mm; width: 18mm; text-align: left; }
      .money-symbol, .money-value { display: inline-block; }
      .money-value { margin-left: 2.26mm; }
      .remitos { left: 12.67mm; top: 114.15mm; width: 132mm; font-size: 5.85pt; white-space: normal; overflow-wrap: anywhere; }
      .total { left: 173.14mm; top: 130.5mm; width: 17mm; text-align: left; font-size: 9pt; font-weight: 700; }
      .cae-number { left: 52.3mm; top: 140.22mm; width: 50mm; font-size: 9.8pt; font-weight: 700; }
      .cae-date { left: 146.9mm; top: 140.22mm; width: 32mm; font-size: 9.8pt; font-weight: 700; }
    </style>
  </head>
  <body>${pageMarkup}</body>
</html>`
}

const printFacultadHtmlToPdfBuffer = async html => {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  try {
    await loadHtmlInWindow(pdfWindow, html)
    return await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A5',
      landscape: true,
      preferCSSPageSize: true
    })
  } finally {
    pdfWindow.destroy()
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
  constructor(executablePath, args = []) {
    this.executablePath = executablePath
    this.args = args
    const resourcesRoot = getResourcesRoot()
    this.process = spawn(executablePath, args, {
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

const resolveDevPythonBridge = () => {
  if (!isDev || process.platform === 'win32') {
    return null
  }

  const scriptPath = path.join(__dirname, 'script.py')
  if (!fs.existsSync(scriptPath)) {
    return null
  }

  return {
    executablePath: process.env.PATNAV_PYTHON || 'python3',
    args: [scriptPath]
  }
}

const resolveScriptPath = () => {
  const scriptNames = process.platform === 'win32' ? ['script.exe'] : ['script']
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

const resolveBridgeCommand = () => {
  const devPythonBridge = resolveDevPythonBridge()
  if (devPythonBridge && process.env.PATNAV_USE_BINARY_BRIDGE !== '1') {
    return devPythonBridge
  }

  return {
    executablePath: resolveScriptPath(),
    args: []
  }
}

const getPythonBridge = () => {
  if (pythonBridge && pythonBridge.isRunning()) {
    return pythonBridge
  }

  const bridgeCommand = resolveBridgeCommand()
  pythonBridge = new PythonBridge(bridgeCommand.executablePath, bridgeCommand.args)
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
    width: 1680,
    height: 1050,
    title: 'Naviera App',
    icon: path.join(__dirname, 'public', 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.removeMenu()
  win.center()

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

const parseFacultadRange = payload => {
  const desde = Number(payload?.desde)
  const hasta = Number(payload?.hasta)
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde <= 0 || hasta <= 0) {
    return {
      error: 'invalid_params',
      details: 'Desde y Hasta deben ser numeros enteros positivos.'
    }
  }
  if (desde > hasta) {
    return {
      error: 'invalid_params',
      details: 'Desde debe ser menor o igual a Hasta.'
    }
  }
  return { desde, hasta }
}

const fetchFacultadFacturas = async payload => {
  const range = parseFacultadRange(payload)
  if (range.error) {
    return range
  }

  const result = await getPythonBridge().call('traer_facultad_facturas', [
    range.desde,
    range.hasta
  ])
  if (result?.error) {
    return result
  }
  return {
    ...result,
    rows: Array.isArray(result?.rows) ? result.rows : []
  }
}

const buildFacultadFacturasHtmlForRange = async payload => {
  const fetchResult = await fetchFacultadFacturas(payload)
  if (fetchResult?.error) {
    return fetchResult
  }

  const invoices = fetchResult.rows ?? []
  if (invoices.length === 0) {
    return {
      error: 'not_found',
      details: 'No se encontraron facturas FB prefijo 7 en el rango indicado.'
    }
  }

  return { html: buildFacultadFacturasHtml({ invoices }), rows: invoices }
}

ipcMain.handle('facultad:list_facturas', async (_event, payload) => {
  try {
    return await fetchFacultadFacturas(payload)
  } catch (error) {
    console.error('Failed to fetch Facultad facturas:', error)
    return {
      error: 'fetch_failed',
      details: error instanceof Error ? error.message : 'No se pudieron consultar las facturas.'
    }
  }
})

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

ipcMain.handle('pdf:preview_facultad_facturas', async (_event, payload) => {
  try {
    const htmlResult = await buildFacultadFacturasHtmlForRange(payload)
    if (htmlResult?.error) {
      return htmlResult
    }

    const buffer = await printFacultadHtmlToPdfBuffer(htmlResult.html)
    return {
      base64: buffer.toString('base64'),
      rows: htmlResult.rows
    }
  } catch (error) {
    console.error('Failed to generate Facultad PDF preview:', error)
    return {
      error: 'pdf_generation_failed',
      details: error instanceof Error ? error.message : 'No se pudo generar el PDF.'
    }
  }
})

ipcMain.handle('dialog:select_directory', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Guardar en',
      properties: ['openDirectory', 'createDirectory']
    })

    if (canceled || !filePaths?.[0]) {
      return { status: 'canceled' }
    }

    return { status: 'ok', directoryPath: filePaths[0] }
  } catch (error) {
    console.error('Failed to select directory:', error)
    return {
      error: 'select_directory_failed',
      details: error instanceof Error ? error.message : 'No se pudo seleccionar la carpeta.'
    }
  }
})

ipcMain.handle('pdf:save_facultad_facturas_to_directory', async (_event, payload) => {
  try {
    const invoices = Array.isArray(payload?.invoices) ? payload.invoices : []
    if (invoices.length === 0) {
      return { error: 'invalid_params', details: 'invoices is required' }
    }

    const directoryPath =
      typeof payload?.directoryPath === 'string' && payload.directoryPath.trim()
        ? payload.directoryPath.trim()
        : ''
    if (!directoryPath) {
      return { error: 'invalid_params', details: 'directoryPath is required' }
    }

    const stats = await fs.promises.stat(directoryPath)
    if (!stats.isDirectory()) {
      return { error: 'invalid_params', details: 'directoryPath must be a directory' }
    }

    const filePaths = []
    for (const invoice of invoices) {
      const html = buildFacultadFacturasHtml({ invoices: [invoice] })
      const buffer = await printFacultadHtmlToPdfBuffer(html)
      const fileName = `${sanitizePdfBaseName(formatFacultadInvoiceFileBaseName(invoice))}.pdf`
      const filePath = path.join(directoryPath, fileName)
      await fs.promises.writeFile(filePath, buffer)
      filePaths.push(filePath)
    }

    return {
      status: 'ok',
      saved: filePaths.length,
      filePaths
    }
  } catch (error) {
    console.error('Failed to save Facultad PDFs:', error)
    return {
      error: 'save_failed',
      details: error instanceof Error ? error.message : 'No se pudieron guardar los PDFs.'
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

ipcMain.handle('pdf:save_pdf_to_directory', async (_event, payload) => {
  try {
    const base64 = typeof payload?.base64 === 'string' ? payload.base64 : ''
    if (!base64) {
      return { error: 'invalid_params', details: 'base64 is required' }
    }

    const directoryPath =
      typeof payload?.directoryPath === 'string' && payload.directoryPath.trim()
        ? payload.directoryPath.trim()
        : ''
    if (!directoryPath) {
      return { error: 'invalid_params', details: 'directoryPath is required' }
    }

    const stats = await fs.promises.stat(directoryPath)
    if (!stats.isDirectory()) {
      return { error: 'invalid_params', details: 'directoryPath must be a directory' }
    }

    const suggestedFileName =
      typeof payload?.suggestedFileName === 'string' && payload.suggestedFileName.trim()
        ? payload.suggestedFileName.trim()
        : 'documento.pdf'
    const fileName = `${sanitizePdfBaseName(suggestedFileName)}.pdf`
    const filePath = path.join(directoryPath, fileName)

    const buffer = Buffer.from(base64, 'base64')
    await fs.promises.writeFile(filePath, buffer)
    return { status: 'ok', filePath }
  } catch (error) {
    console.error('Failed to save PDF to directory:', error)
    return {
      error: 'save_failed',
      details: error instanceof Error ? error.message : 'No se pudo guardar el PDF.'
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
        .filter(entry => Boolean(getUploadImageMimeType(entry.name)))
        .map(async entry => {
          const filePath = path.join(UPLOADS_DIR, entry.name)
          const mimeType = getUploadImageMimeType(entry.name) || 'image/jpeg'
          const [stats, buffer] = await Promise.all([
            fs.promises.stat(filePath),
            fs.promises.readFile(filePath)
          ])
          return {
            fileName: entry.name,
            filePath,
            fileUrl: pathToFileURL(filePath).href,
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
            modifiedTime: stats.mtimeMs,
            size: stats.size,
            processed: /^Procesada_(?:\d+_)?/i.test(entry.name)
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

ipcMain.handle('uploads:delete_processed_images', async () => {
  try {
    ensureUploadsDir()
    const entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true })
    const processedEntries = entries
      .filter(entry => entry.isFile())
      .filter(entry => Boolean(getUploadImageMimeType(entry.name)))
      .filter(entry => /^Procesada_(?:\d+_)?/i.test(entry.name))

    const deletedFiles = []
    for (const entry of processedEntries) {
      const filePath = path.join(UPLOADS_DIR, entry.name)
      await fs.promises.unlink(filePath)
      deletedFiles.push({ fileName: entry.name, filePath })
    }

    return { deleted: deletedFiles.length, files: deletedFiles }
  } catch (error) {
    console.error('Failed to delete processed upload images:', error)
    return {
      error: 'delete_failed',
      details: error instanceof Error ? error.message : 'No se pudieron eliminar las imagenes procesadas.'
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

registerPythonHandler('python:traer_facturas_atrasadas', 'traer_facturas_atrasadas')

registerPythonHandler('python:traer_ignorar', 'traer_ignorar')

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
  'python:insertar_mensajes_lote_por_lote',
  'insertar_mensajes_lote_por_lote',
  {
    validate: payload => {
      if (payload.nroLote === undefined || payload.nroLote === null || payload.nroLote === '') {
        return {
          error: 'invalid_params',
          details: 'nroLote is required'
        }
      }
      const nroValue = Number(payload.nroLote)
      if (!Number.isInteger(nroValue)) {
        return {
          error: 'invalid_params',
          details: 'nroLote must be an integer'
        }
      }
      return undefined
    },
    mapPayload: payload => [Number(payload.nroLote)]
  }
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

registerPythonHandler('python:editar_registro_hdr', 'editar_registro_hdr', {
  validate: payload => {
    if (
      !payload?.motivo ||
      payload?.detalle === undefined ||
      payload?.nuevoDetalle === undefined ||
      !payload?.recorrido ||
      !payload?.fechasRecorrido
    ) {
      return {
        error: 'invalid_params',
        details: 'motivo, detalle, nuevoDetalle, recorrido and fechasRecorrido are required'
      }
    }
    return undefined
  },
  mapPayload: payload => [
    payload.motivo,
    payload.detalle,
    payload.nuevoDetalle,
    payload.recorrido,
    payload.fechasRecorrido
  ]
})

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

registerPythonHandler('python:process_upload_image', 'process_upload_image', {
  validate: payload => {
    if (!payload?.filePath) {
      return { error: 'invalid_params', details: 'filePath is required to process an image' }
    }
    return undefined
  },
  mapPayload: payload => [payload.filePath, payload.allowDuplicate === true]
})

registerPythonHandler('python:mark_upload_processed', 'mark_upload_processed', {
  validate: payload => {
    if (!payload?.filePath) {
      return { error: 'invalid_params', details: 'filePath is required to mark an image' }
    }
    return undefined
  },
  mapPayload: payload => [payload.filePath]
})

registerPythonHandler('python:list_transfer_table', 'list_transfer_table', {
  validate: payload => {
    if (!payload?.tableName) {
      return { error: 'invalid_params', details: 'tableName is required' }
    }
    return undefined
  },
  mapPayload: payload => [payload.tableName]
})

registerPythonHandler('python:delete_transfer_table_row', 'delete_transfer_table_row', {
  validate: payload => {
    if (!payload?.tableName || payload.rowId === undefined || payload.rowId === null) {
      return { error: 'invalid_params', details: 'tableName and rowId are required' }
    }
    return undefined
  },
  mapPayload: payload => [payload.tableName, payload.rowId]
})

registerPythonHandler(
  'python:list_unidentified_transferencias',
  'list_unidentified_transferencias'
)

registerPythonHandler(
  'python:list_identified_transferencias',
  'list_identified_transferencias'
)

registerPythonHandler(
  'python:list_transfer_address_candidates',
  'list_transfer_address_candidates'
)

registerPythonHandler('python:list_transfer_ventas', 'list_transfer_ventas', {
  validate: payload => {
    if (payload?.codCliente === undefined || payload?.nroLugarEntrega === undefined) {
      return {
        error: 'invalid_params',
        details: 'codCliente and nroLugarEntrega are required'
      }
    }
    return undefined
  },
  mapPayload: payload => [payload.codCliente, payload.nroLugarEntrega, payload.cvuCbu || '']
})

registerPythonHandler('python:check_cobro_comprobante', 'check_cobro_comprobante', {
  validate: payload => {
    if (!payload?.tipoComprobante || payload.prefijo === undefined || payload.numero === undefined) {
      return {
        error: 'invalid_params',
        details: 'tipoComprobante, prefijo and numero are required'
      }
    }
    return undefined
  },
  mapPayload: payload => [payload.tipoComprobante, payload.prefijo, payload.numero]
})

registerPythonHandler('python:apply_transfer_payment', 'apply_transfer_payment', {
  validate: payload => {
    if (!payload?.receiptComprobante || !payload?.receiptClient || payload.transferAmount === undefined || !Array.isArray(payload.selectedVentas)) {
      return {
        error: 'invalid_params',
        details: 'receiptComprobante, receiptClient, transferAmount and selectedVentas are required'
      }
    }
    return undefined
  },
  mapPayload: payload => [
    payload.receiptComprobante,
    payload.receiptClient,
    payload.transferAmount,
    payload.selectedVentas,
    payload.transferId
  ]
})

registerPythonHandler('python:assign_transferencia_account', 'assign_transferencia_account', {
  validate: payload => {
    if (!payload?.cvuCbu || payload.codCliente === undefined || payload.nroLugarEntrega === undefined) {
      return {
        error: 'invalid_params',
        details: 'cvuCbu, codCliente and nroLugarEntrega are required'
      }
    }
    return undefined
  },
  mapPayload: payload => [payload.cvuCbu, payload.codCliente, payload.nroLugarEntrega]
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
