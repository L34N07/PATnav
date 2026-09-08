#!/usr/bin/env node

const { PythonOdbcSqlServer } = require('./local-sql-server')
const { ArcaApiProvider, CREDIT_NOTE_BY_INVOICE_TYPE } = require('./arca-api-provider')
const { postCreditNote, getUltimoComprobante } = require('./arca-api-read-only-client')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { assertRuntimeDatabase, getArcaRuntimeConfig } = require('./arca-runtime-config')

const CONFIRMATION = 'CONFIRMAR_NC_PRODUCCION'
const LOCAL_TIME_ZONE = 'America/Argentina/Tucuman'
const NC_TYPE_NAMES = {
  NA: { nombre: 'Nota de Credito A', codAfip: '03' },
  NB: { nombre: 'Nota de Credito B', codAfip: '08' }
}

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function compact(value) {
  return String(value || '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    if (name === 'help') {
      args.help = true
      continue
    }
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${rawName}`)
    }
    if (inlineValue === undefined) {
      index += 1
    }
    args[name] = value
  }
  return args
}

function showHelp() {
  console.log(`Usage:
  node scripts/arca/convert-august-ctacte-to-credit-notes.js --desde 2026-08-01 --hasta 2026-08-31
  node scripts/arca/convert-august-ctacte-to-credit-notes.js --desde 2026-08-01 --hasta 2026-08-31 --confirmar ${CONFIRMATION}

Options:
  --desde YYYY-MM-DD       Inicio del rango de Ventas.fecha_vencimiento
  --hasta YYYY-MM-DD       Fin del rango de Ventas.fecha_vencimiento
  --fecha-emision DATE     Fecha de emision de las NC; default fecha local actual
  --limit N                Maximo a procesar; default 1000
  --confirmar TOKEN        Autoriza NC en ARCA y actualiza NAVIERA`)
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})

  return `${parts.year}-${parts.month}-${parts.day}`
}

function sqlDate(value, name) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${name} must use YYYY-MM-DD format.`)
  }
  return raw
}

function sanitizeLimit(value) {
  const parsed = Number.parseInt(String(value || '1000'), 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5000) {
    throw new Error('--limit must be between 1 and 5000.')
  }
  return parsed
}

function normalizeCaeFchVto(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }
  throw new Error('ARCA caeFchVto must be YYYYMMDD or YYYY-MM-DD.')
}

function yyyymmddToIso(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!match) {
    return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

function isoToYyyymmdd(value) {
  return sqlDate(value, 'date').replace(/-/g, '')
}

function monthRangeFromDate(value) {
  const date = sqlDate(value, 'fecha_vencimiento')
  const [year, month] = date.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthText = String(month).padStart(2, '0')
  return {
    firstDate: `${year}-${monthText}-01`,
    lastDate: `${year}-${monthText}-${String(lastDay).padStart(2, '0')}`
  }
}

function applyServiceDates(preview, target, fechaEmision) {
  const servicePeriod = monthRangeFromDate(target.fecha_vencimiento)
  preview.payload.concepto = 2
  preview.payload.cbteFch = isoToYyyymmdd(fechaEmision)
  preview.payload.fchServDesde = isoToYyyymmdd(servicePeriod.firstDate)
  preview.payload.fchServHasta = isoToYyyymmdd(servicePeriod.lastDate)
  preview.payload.fchVtoPago = isoToYyyymmdd(fechaEmision)
  preview.unmapped = preview.unmapped.filter(item => !item.includes('Fechas de servicio'))
  preview.dates.homologationCbteFch = preview.payload.cbteFch
  return preview
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function buildSql() {
  const runtime = getArcaRuntimeConfig('produccion')
  const sql = new PythonOdbcSqlServer({ database: runtime.sql.database })
  assertRuntimeDatabase({ runtime, sqlSummary: sql.getConnectionSummary() })
  return { runtime, sql }
}

function findTargets(sql, { desde, hasta, limit }) {
  return sql.queryJson(
    forJson(`
DECLARE @desde date = '${sqlString(desde)}';
DECLARE @hasta date = '${sqlString(hasta)}';

WITH target AS (
  SELECT TOP (${Number(limit)})
    LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
    CAST(v.prefijo AS int) AS prefijo,
    CAST(v.numero AS int) AS numero,
    CAST(v.cod_cliente AS int) AS cod_cliente,
    CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    LTRIM(RTRIM(c.razon_social)) AS razon_social,
    CONVERT(varchar(10), v.fecha_operacion, 23) AS fecha_operacion,
    CONVERT(varchar(10), v.fecha_vencimiento, 23) AS fecha_vencimiento,
    NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae,
    CAST(SUM(COALESCE(vi.importe, 0)) AS decimal(18, 2)) AS total,
    COUNT_BIG(vi.orden) AS items
  FROM dbo.Ventas AS v
  INNER JOIN dbo.Cliente AS c
    ON c.cod_cliente = v.cod_cliente
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE c.tipo_cliente = 2
    AND LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
    AND v.prefijo IN (7, 8)
    AND CONVERT(date, v.fecha_vencimiento) >= @desde
    AND CONVERT(date, v.fecha_vencimiento) <= @hasta
  GROUP BY
    v.tipo_comprobante,
    v.prefijo,
    v.numero,
    v.cod_cliente,
    v.nro_lugar_entrega,
    c.razon_social,
    v.fecha_operacion,
    v.fecha_vencimiento,
    v.cae
)
SELECT *
FROM target
WHERE cae IS NOT NULL
  AND total > 0
ORDER BY tipo_comprobante, prefijo, numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
  ) || []
}

function findExcluded(sql, { desde, hasta }) {
  return sql.queryJson(
    forJson(`
DECLARE @desde date = '${sqlString(desde)}';
DECLARE @hasta date = '${sqlString(hasta)}';

SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CAST(v.cod_cliente AS int) AS cod_cliente,
  CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(c.razon_social)) AS razon_social,
  NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae,
  CAST(SUM(COALESCE(vi.importe, 0)) AS decimal(18, 2)) AS total,
  COUNT_BIG(vi.orden) AS items,
  CASE
    WHEN NULLIF(LTRIM(RTRIM(v.cae)), '') IS NULL THEN 'sin CAE'
    WHEN SUM(COALESCE(vi.importe, 0)) <= 0 THEN 'total no positivo'
    ELSE 'no procesable'
  END AS motivo
FROM dbo.Ventas AS v
INNER JOIN dbo.Cliente AS c
  ON c.cod_cliente = v.cod_cliente
INNER JOIN dbo.VentasItems AS vi
  ON vi.tipo_comprobante = v.tipo_comprobante
 AND vi.prefijo = v.prefijo
 AND vi.numero = v.numero
WHERE c.tipo_cliente = 2
  AND LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
  AND v.prefijo IN (7, 8)
  AND CONVERT(date, v.fecha_vencimiento) >= @desde
  AND CONVERT(date, v.fecha_vencimiento) <= @hasta
GROUP BY
  v.tipo_comprobante,
  v.prefijo,
  v.numero,
  v.cod_cliente,
  v.nro_lugar_entrega,
  c.razon_social,
  v.cae
HAVING NULLIF(LTRIM(RTRIM(v.cae)), '') IS NULL
    OR SUM(COALESCE(vi.importe, 0)) <= 0
ORDER BY tipo_comprobante, prefijo, numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
  ) || []
}

function getDependencyConstraints(sql) {
  return sql.queryJson(
    forJson(`
SELECT DISTINCT
  OBJECT_SCHEMA_NAME(fk.parent_object_id) AS child_schema,
  OBJECT_NAME(fk.parent_object_id) AS child_table,
  fk.name AS constraint_name
FROM sys.foreign_keys AS fk
WHERE OBJECT_SCHEMA_NAME(fk.referenced_object_id) = 'dbo'
  AND OBJECT_NAME(fk.referenced_object_id) IN ('Ventas', 'MovFisicos')
  AND OBJECT_NAME(fk.parent_object_id) IN ('VentasItems', 'CobrosAplicados', 'MovFisicos', 'MovFisicosItems')
ORDER BY child_table, constraint_name
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
  ) || []
}

function quoteIdentifier(value) {
  return `[${String(value ?? '').replace(/]/g, ']]')}]`
}

function buildApprovedResult(response) {
  const body = response && response.response
  if (!body || body.resultado !== 'A') {
    throw new Error(`ARCA rechazo/no aprobo NC: ${JSON.stringify(body)}`)
  }
  if (!body.cbteNro || !body.cae || !body.caeFchVto || !body.ptoVta || !body.cbteTipo) {
    throw new Error(`ARCA NC incompleta: ${JSON.stringify(body)}`)
  }
  return {
    cbteNro: Number(body.cbteNro),
    cae: String(body.cae),
    caeFchVto: body.caeFchVto,
    ptoVta: Number(body.ptoVta),
    cbteTipo: Number(body.cbteTipo),
    observaciones: body.observaciones || [],
    errores: body.errores || []
  }
}

function convertLocalInvoice(sql, constraints, { original, credit, fechaEmision }) {
  const oldTipo = compact(original.tipo_comprobante)
  const oldPrefijo = Number(original.prefijo)
  const oldNumero = Number(original.numero)
  const creditMapping = CREDIT_NOTE_BY_INVOICE_TYPE[oldTipo]
  if (!creditMapping) {
    throw new Error(`No hay tipo de NC para ${oldTipo}.`)
  }
  const newTipo = creditMapping.tipoComprobante
  const newPrefijo = Number(credit.ptoVta)
  const newNumero = Number(credit.cbteNro)
  const meta = NC_TYPE_NAMES[newTipo]
  const caeFchVto = normalizeCaeFchVto(credit.caeFchVto)

  const disableConstraintsSql = constraints
    .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} NOCHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
    .join('\n')
  const enableConstraintsSql = constraints
    .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} WITH CHECK CHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
    .join('\n')

  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @ventas_items int = 0;
DECLARE @cobros_aplicados int = 0;
DECLARE @movfisicos_items int = 0;
DECLARE @movfisicos int = 0;
DECLARE @ventas int = 0;

IF NOT EXISTS (
  SELECT 1 FROM dbo.TipoComprobante WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
)
BEGIN
  INSERT INTO dbo.TipoComprobante (tipo_comprobante, nombre, cod_afip)
  VALUES ('${sqlString(newTipo)}', '${sqlString(meta.nombre)}', '${sqlString(meta.codAfip)}');
END;

UPDATE dbo.TipoComprobante
SET cod_afip = COALESCE(NULLIF(LTRIM(RTRIM(cod_afip)), ''), '${sqlString(meta.codAfip)}')
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}';

IF NOT EXISTS (
  SELECT 1 FROM dbo.Talonario WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
    AND prefijo = ${newPrefijo}
)
BEGIN
  INSERT INTO dbo.Talonario (tipo_comprobante, prefijo, ult_numero)
  VALUES ('${sqlString(newTipo)}', ${newPrefijo}, 0);
END;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
    AND prefijo = ${oldPrefijo}
    AND numero = ${oldNumero}
    AND NULLIF(LTRIM(RTRIM(COALESCE(cae, ''))), '') IS NOT NULL
)
BEGIN
  THROW 54000, 'Original invoice was not found or does not have CAE.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
    AND prefijo = ${newPrefijo}
    AND numero = ${newNumero}
)
BEGIN
  THROW 54001, 'Credit note already exists in Ventas.', 1;
END;

${disableConstraintsSql}

UPDATE dbo.VentasItems
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @ventas_items = @@ROWCOUNT;

UPDATE dbo.CobrosAplicados
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @cobros_aplicados = @@ROWCOUNT;

UPDATE dbo.MovFisicosItems
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo_remito = ${newPrefijo},
    numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo_remito = ${oldPrefijo}
  AND numero_remito = ${oldNumero};
SET @movfisicos_items = @@ROWCOUNT;

UPDATE dbo.MovFisicos
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo_remito = ${newPrefijo},
    numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo_remito = ${oldPrefijo}
  AND numero_remito = ${oldNumero};
SET @movfisicos = @@ROWCOUNT;

UPDATE dbo.Ventas
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero},
    fecha_operacion = '${sqlString(fechaEmision)}',
    cae = '${sqlString(credit.cae)}',
    fecha_vencimiento_cae = '${sqlString(caeFchVto)}'
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @ventas = @@ROWCOUNT;

${enableConstraintsSql}

UPDATE dbo.Talonario
SET ult_numero = CASE WHEN CAST(ult_numero AS int) < ${newNumero} THEN ${newNumero} ELSE ult_numero END
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
  AND prefijo = ${newPrefijo};

COMMIT TRANSACTION;

SELECT
  'ok' AS status,
  '${sqlString(oldTipo)}' AS original_tipo,
  ${oldPrefijo} AS original_prefijo,
  ${oldNumero} AS original_numero,
  '${sqlString(newTipo)}' AS nc_tipo,
  ${newPrefijo} AS nc_prefijo,
  ${newNumero} AS nc_numero,
  @ventas AS ventas,
  @ventas_items AS ventas_items,
  @cobros_aplicados AS cobros_aplicados,
  @movfisicos AS movfisicos,
  @movfisicos_items AS movfisicos_items
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
}

async function buildPreview({ sql, repository, targets, fechaEmision }) {
  const providerByPrefijo = new Map()
  const details = targets.map(target => {
    if (!providerByPrefijo.has(target.prefijo)) {
      providerByPrefijo.set(
        target.prefijo,
        new ArcaApiProvider({
          environment: 'produccion',
          ptoVta: Number(target.prefijo),
          concepto: 2,
          fechaHomologacion: fechaEmision,
          legacyPriceMode: 'gross'
        })
      )
    }
    const invoice = repository.getInvoice({
      tipo: target.tipo_comprobante,
      prefijo: target.prefijo,
      numero: target.numero
    })
    const creditPreview = applyServiceDates(
      providerByPrefijo.get(target.prefijo).buildCreditNotePreview(invoice),
      target,
      fechaEmision
    )
    const creditMapping = CREDIT_NOTE_BY_INVOICE_TYPE[target.tipo_comprobante]
    return {
      original: target,
      nc_tipo: creditMapping.tipoComprobante,
      nc_cbte_tipo: creditMapping.cbteTipo,
      payload_total: creditPreview.totals.arcaEstimatedGrossTotal,
      warnings: creditPreview.warnings,
      associated: creditPreview.payload.comprobantesAsociados[0]
    }
  })

  const arcaUltimos = []
  for (const [tipo, cbteTipo] of [['NA', 3], ['NB', 8]]) {
    const prefijos = [...new Set(targets.map(target => Number(target.prefijo)))]
    for (const prefijo of prefijos) {
      const ultimo = await getUltimoComprobante({
        environment: 'produccion',
        cbteTipo,
        ptoVta: prefijo
      })
      arcaUltimos.push({
        tipo,
        prefijo,
        ok: ultimo.ok,
        ultimoComprobante: ultimo.ultimoComprobante,
        proximoComprobante: ultimo.proximoComprobante
      })
    }
  }

  return {
    fechaEmision,
    count: details.length,
    total: details.reduce((sum, item) => sum + Number(item.original.total || 0), 0),
    arcaUltimos,
    details
  }
}

async function processTargets({ sql, repository, targets, fechaEmision }) {
  const constraints = getDependencyConstraints(sql)
  const results = []
  const stoppedSeries = new Set()

  for (const target of targets) {
    const originalLabel = `${target.tipo_comprobante}/${target.prefijo}/${target.numero}`
    const creditMapping = CREDIT_NOTE_BY_INVOICE_TYPE[target.tipo_comprobante]
    const seriesKey = `${creditMapping.tipoComprobante}/${target.prefijo}`
    if (stoppedSeries.has(seriesKey)) {
      results.push({
        ok: false,
        skipped: true,
        original: originalLabel,
        error: `Serie ${seriesKey} detenida por fallo previo.`
      })
      continue
    }

    let approval = null
    try {
      const invoice = repository.getInvoice({
        tipo: target.tipo_comprobante,
        prefijo: target.prefijo,
        numero: target.numero
      })
      const provider = new ArcaApiProvider({
        environment: 'produccion',
        ptoVta: Number(target.prefijo),
        concepto: 2,
        fechaHomologacion: fechaEmision,
        legacyPriceMode: 'gross'
      })
      const creditPreview = applyServiceDates(
        provider.buildCreditNotePreview(invoice),
        target,
        fechaEmision
      )
      const response = await postCreditNote({
        payload: creditPreview.payload,
        idempotencyKey:
          `PROD-NC-TC2-${target.tipo_comprobante}-${target.prefijo}-${target.numero}`
      })
      approval = buildApprovedResult(response)
      const saved = convertLocalInvoice(sql, constraints, {
        original: target,
        credit: approval,
        fechaEmision: yyyymmddToIso(creditPreview.payload.cbteFch) || fechaEmision
      })
      results.push({
        ok: true,
        original: originalLabel,
        nc: `${creditMapping.tipoComprobante}/${approval.ptoVta}/${approval.cbteNro}`,
        cae: approval.cae,
        caeFchVto: normalizeCaeFchVto(approval.caeFchVto),
        saved,
        observaciones: approval.observaciones,
        errores: approval.errores
      })
    } catch (error) {
      stoppedSeries.add(seriesKey)
      results.push({
        ok: false,
        original: originalLabel,
        nc_authorized: approval
          ? {
              tipo: creditMapping.tipoComprobante,
              prefijo: approval.ptoVta,
              numero: approval.cbteNro,
              cae: approval.cae,
              caeFchVto: approval.caeFchVto
            }
          : null,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    OK: results.filter(result => result.ok).length,
    fallidas: results.filter(result => !result.ok).length,
    results
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    showHelp()
    return
  }

  const desde = sqlDate(args.desde || '2026-08-01', 'desde')
  const hasta = sqlDate(args.hasta || '2026-08-31', 'hasta')
  const fechaEmision = sqlDate(args.fechaEmision || todayIsoDate(), 'fecha-emision')
  const limit = sanitizeLimit(args.limit)
  const { runtime, sql } = buildSql()
  const repository = new LegacyInvoiceRepository(sql)
  const targets = findTargets(sql, { desde, hasta, limit })
  const excluded = findExcluded(sql, { desde, hasta })
  const preview = await buildPreview({ sql, repository, targets, fechaEmision })

  if (args.confirmar !== CONFIRMATION) {
    console.log(
      JSON.stringify(
        {
          modo: 'PREVIEW',
          escribe_db: false,
          llama_arca: false,
          confirmacion_requerida_para_generar: CONFIRMATION,
          db: sql.getConnectionSummary(),
          environment: runtime.environment,
          rango: { desde, hasta },
          excluded,
          preview
        },
        null,
        2
      )
    )
    return
  }

  const result = await processTargets({ sql, repository, targets, fechaEmision })
  console.log(
    JSON.stringify(
      {
        modo: 'CONFIRMADO_PRODUCCION',
        db: sql.getConnectionSummary(),
        environment: runtime.environment,
        rango: { desde, hasta },
        fechaEmision,
        excluded,
        resumen: {
          OK: result.OK,
          fallidas: result.fallidas
        },
        results: result.results
      },
      null,
      2
    )
  )
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
