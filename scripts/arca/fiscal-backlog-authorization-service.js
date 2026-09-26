const { PendingFiscalPreflight } = require('./pending-fiscal-preflight')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { postFactura } = require('./arca-api-read-only-client')

const SERIES = [
  { tipo: 'FA', prefijo: 7, concepto: 2 },
  { tipo: 'FB', prefijo: 7, concepto: 2 },
  { tipo: 'FA', prefijo: 8, concepto: 1 },
  { tipo: 'FB', prefijo: 8, concepto: 1 }
]

function compact(value) {
  return String(value || '').trim()
}

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Tucuman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {})

  return `${parts.year}-${parts.month}-${parts.day}`
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null
  }
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? raw
    : null
}

function normalizeRange({ desde, hasta } = {}) {
  const from = desde ? isoDate(desde) : null
  const to = hasta ? isoDate(hasta) : null
  if (desde && !from) {
    throw new Error('La fecha desde debe usar YYYY-MM-DD.')
  }
  if (hasta && !to) {
    throw new Error('La fecha hasta debe usar YYYY-MM-DD.')
  }
  if (from && to && from > to) {
    throw new Error('La fecha desde no puede ser posterior a la fecha hasta.')
  }
  return { desde: from, hasta: to }
}

function daysBetween(left, right) {
  const leftTime = Date.parse(`${left}T12:00:00Z`)
  const rightTime = Date.parse(`${right}T12:00:00Z`)
  return Math.round((leftTime - rightTime) / 86400000)
}

function approvalFrom(response) {
  const body = response?.response || {}
  return {
    result: body.resultado || body.result || body.Resultado,
    cbteNro: Number(body.cbteNro ?? body.cbte_nro ?? body.numero),
    cae: body.cae || body.CAE,
    caeFchVto: body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae,
    ptoVta: Number(body.ptoVta ?? body.pto_vta),
    cbteTipo: Number(body.cbteTipo ?? body.cbte_tipo),
    observaciones: body.observaciones || body.observacionesArca || body.obs || [],
    errores: body.errores || body.errors || []
  }
}

function arcaIssueSummary(response) {
  const body = response?.response || {}
  const issues = [...(body.errores || []), ...(body.observaciones || [])]
  const message = issues
    .map(issue => {
      const code = issue?.code ?? issue?.codigo
      const detail = issue?.msg ?? issue?.message ?? issue?.descripcion
      return [code, detail].filter(Boolean).join(': ')
    })
    .filter(Boolean)
    .join(' | ')
  return message || `Respuesta ARCA sin aprobacion (HTTP ${response?.statusCode || 'desconocido'}).`
}

function normalizeCaeDate(value) {
  const raw = String(value || '').trim()
  const compactDate = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  throw new Error('ARCA no devolvio una fecha de vencimiento de CAE valida.')
}

function isDateRangeError(response) {
  const body = response?.response || {}
  const issues = [...(body.observaciones || []), ...(body.errores || [])]
  return issues.some(issue => String(issue?.code ?? issue?.codigo ?? '') === '10016')
}

function latestDateMentionedByArca(response) {
  const body = response?.response || {}
  const messages = [...(body.observaciones || []), ...(body.errores || [])]
    .map(issue => String(issue?.msg ?? issue?.message ?? issue?.descripcion ?? ''))
    .join(' ')
  const dates = [...messages.matchAll(/\b(\d{8})\b/g)]
    .map(match => `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`)
    .filter(isoDate)
  return dates.sort().at(-1) || null
}

function maxDate(...values) {
  return values.filter(Boolean).sort().at(-1) || null
}

function seriesKey({ tipo, prefijo }) {
  return `${tipo}/${prefijo}`
}

class FiscalBacklogAuthorizationService {
  constructor({ sql, representada, arcaPostFactura = postFactura } = {}) {
    this.sql = sql
    this.representada = representada || process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
    this.arcaPostFactura = arcaPostFactura
    this.legacyRepository = new LegacyInvoiceRepository(sql)
  }

  findPending({ desde, hasta } = {}) {
    const range = normalizeRange({ desde, hasta })
    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = ${range.desde ? `'${sqlString(range.desde)}'` : 'NULL'};
DECLARE @hasta date = ${range.hasta ? `'${sqlString(range.hasta)}'` : 'NULL'};

SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(19), v.fecha_operacion, 126) AS fecha_operacion,
  CONVERT(varchar(10), v.fecha_vencimiento, 23) AS fecha_vencimiento,
  CAST(v.cod_cliente AS int) AS cod_cliente,
  CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(COALESCE(c.razon_social, ''))) AS razon_social,
  CAST(SUM(COALESCE(vi.importe, 0)) AS decimal(18, 2)) AS total,
  CAST(COUNT(vi.orden) AS int) AS items
FROM dbo.Ventas AS v
LEFT JOIN dbo.VentasItems AS vi
  ON vi.tipo_comprobante = v.tipo_comprobante
 AND vi.prefijo = v.prefijo
 AND vi.numero = v.numero
LEFT JOIN dbo.Cliente AS c
  ON c.cod_cliente = v.cod_cliente
WHERE LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
  AND v.prefijo IN (7, 8)
  AND NULLIF(LTRIM(RTRIM(COALESCE(v.cae, ''))), '') IS NULL
  AND (@desde IS NULL OR CONVERT(date, v.fecha_operacion) >= @desde)
  AND (@hasta IS NULL OR CONVERT(date, v.fecha_operacion) <= @hasta)
GROUP BY
  v.tipo_comprobante, v.prefijo, v.numero, v.fecha_operacion, v.fecha_vencimiento,
  v.cod_cliente, v.nro_lugar_entrega, c.razon_social
ORDER BY v.tipo_comprobante, v.prefijo, v.fecha_operacion, v.numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  preview({ desde, hasta } = {}) {
    const range = normalizeRange({ desde, hasta })
    const pending = this.findPending(range)
    return {
      range,
      pendingCount: pending.length,
      bySeries: SERIES.map(series => {
        const rows = pending
          .filter(row => compact(row.tipo_comprobante) === series.tipo && Number(row.prefijo) === series.prefijo)
          .sort((left, right) => Number(left.numero) - Number(right.numero))
        return {
          ...series,
          pending: rows.length,
          firstNumber: rows.length ? Number(rows[0].numero) : null,
          lastNumber: rows.length ? Number(rows[rows.length - 1].numero) : null
        }
      })
    }
  }

  createPreflight(series) {
    return new PendingFiscalPreflight({
      sql: this.sql,
      representada: this.representada,
      ptoVta: series.prefijo,
      ptoVtas: [series.prefijo],
      concepto: series.concepto,
      arcaPostFactura: this.arcaPostFactura
    })
  }

  chooseDate(invoice, { fiscalFloor }) {
    const original = isoDate(invoice.venta?.fecha_operacion)
    if (!original) {
      return { original, used: fiscalFloor, corrected: true, reason: 'sin_fecha' }
    }
    if (original < fiscalFloor) {
      return { original, used: fiscalFloor, corrected: true, reason: 'fecha_anterior' }
    }
    return { original, used: original, corrected: false, reason: null }
  }

  async authorizeOne(row, series, { fiscalFloor }) {
    const original = {
      tipo: compact(row.tipo_comprobante),
      prefijo: Number(row.prefijo),
      numero: Number(row.numero)
    }
    const invoice = this.legacyRepository.getInvoice(original)
    if (!invoice.venta || !invoice.items.length) {
      throw new Error(`${seriesKey(original)}-${original.numero} no tiene Ventas/VentasItems completos.`)
    }
    if (invoice.venta.cae) {
      throw new Error(`${seriesKey(original)}-${original.numero} ya tiene CAE.`)
    }

    const preflight = this.createPreflight(series)
    let date = this.chooseDate(invoice, { fiscalFloor })
    let authorizationPreview = preflight.buildAuthorizationPreview(invoice, { fechaEmision: date.used })
    const expected = await preflight.assertNextFiscalIdentityIsAvailable({
      tipo: original.tipo,
      prefijo: original.prefijo,
      allowedExistingIdentity: original
    })

    const idempotencyKey = fiscalDate =>
      `PROD-BACKLOG-${original.tipo}-${original.prefijo}-${original.numero}-F${fiscalDate.replace(/-/g, '')}`
    let response = await this.arcaPostFactura({
      payload: authorizationPreview.payload,
      idempotencyKey: idempotencyKey(date.used)
    })

    if (approvalFrom(response).result !== 'A' && isDateRangeError(response)) {
      const retryDate = maxDate(fiscalFloor, latestDateMentionedByArca(response))
      date = { ...date, used: retryDate, corrected: true, reason: 'arca_10016' }
      authorizationPreview = preflight.buildAuthorizationPreview(invoice, { fechaEmision: date.used })
      response = await this.arcaPostFactura({
        payload: authorizationPreview.payload,
        idempotencyKey: idempotencyKey(date.used)
      })
    }

    const approval = approvalFrom(response)
    if (approval.result !== 'A' || !approval.cbteNro || !approval.cae || !approval.caeFchVto) {
      throw new Error(`ARCA rechazo ${seriesKey(original)}-${original.numero}: ${arcaIssueSummary(response)}`)
    }
    if (approval.cbteNro !== expected.proximoComprobante) {
      throw new Error(
        `ARCA devolvio ${seriesKey(original)}-${approval.cbteNro}; se esperaba ${expected.proximoComprobante}. NAVIERA no se modifico.`
      )
    }

    const saved = preflight.updateAuthorizedExistingInvoice({
      original,
      authorized: {
        tipo: original.tipo,
        prefijo: original.prefijo,
        numero: approval.cbteNro,
        cae: approval.cae,
        caeFchVto: normalizeCaeDate(approval.caeFchVto),
        fechaOperacion: date.corrected ? date.used : undefined
      }
    })

    return {
      ok: true,
      original,
      authorized: { tipo: original.tipo, prefijo: original.prefijo, numero: approval.cbteNro },
      cae: approval.cae,
      caeFchVto: normalizeCaeDate(approval.caeFchVto),
      fechaOriginal: date.original,
      fechaUsada: date.used,
      fechaCorregida: date.corrected,
      motivoCorreccionFecha: date.reason,
      observaciones: approval.observaciones,
      errores: approval.errores,
      saved
    }
  }

  async processAll({ confirmation, desde, hasta } = {}) {
    if (confirmation !== 'AUTORIZAR_PENDIENTES_FISCALES') {
      throw new Error('Confirmacion explicita requerida para autorizar facturas pendientes.')
    }

    const today = todayIsoDate()
    const range = normalizeRange({ desde, hasta })
    const pending = this.findPending(range)
    const results = []

    for (const series of SERIES) {
      const rows = pending
        .filter(row => compact(row.tipo_comprobante) === series.tipo && Number(row.prefijo) === series.prefijo)
        .sort((left, right) => Number(left.numero) - Number(right.numero))
      let stopped = false
      let fiscalFloor = today

      for (const row of rows) {
        const original = { tipo: series.tipo, prefijo: series.prefijo, numero: Number(row.numero) }
        if (stopped) {
          results.push({ ok: false, skipped: true, original, error: `Serie ${seriesKey(series)} detenida por un fallo previo.` })
          continue
        }
        try {
          const result = await this.authorizeOne(row, series, { fiscalFloor })
          results.push(result)
          fiscalFloor = maxDate(fiscalFloor, result.fechaUsada) || fiscalFloor
        } catch (error) {
          stopped = true
          results.push({ ok: false, original, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    const authorized = results.filter(result => result.ok)
    const failed = results.filter(result => !result.ok && !result.skipped)
    const skipped = results.filter(result => result.skipped)
    return {
      date: today,
      range,
      results,
      summary: {
        pending: pending.length,
        authorized: authorized.length,
        failed: failed.length,
        skipped: skipped.length,
        fechasCorregidas: authorized.filter(result => result.fechaCorregida).length,
        renumeradas: authorized.filter(result => result.original.numero !== result.authorized.numero).length,
        bySeries: SERIES.map(series => {
          const key = seriesKey(series)
          const seriesResults = results.filter(result => seriesKey(result.original) === key)
          return {
            ...series,
            authorized: seriesResults.filter(result => result.ok).length,
            failed: seriesResults.filter(result => !result.ok && !result.skipped).length,
            skipped: seriesResults.filter(result => result.skipped).length
          }
        })
      }
    }
  }
}

module.exports = { FiscalBacklogAuthorizationService }
