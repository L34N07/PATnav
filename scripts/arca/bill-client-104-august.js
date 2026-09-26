const { PythonOdbcSqlServer } = require('./local-sql-server')
const { ArcaApiProvider } = require('./arca-api-provider')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { getUltimoComprobante, postFactura } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

const CLIENT = 104
const INVOICE_POINT = 8
const PERIOD = '2026-08-01'
const FISCAL_DATE = '2026-09-21'
const CONTENT_ITEM = 1
const RENTAL_ITEM = 7
const CONTENT_PRICE = 7000
const RENTAL_COUNT = 12
const PREVIOUS_CREDIT_NOTE = { tipo: 'NB', prefijo: 7, numero: 1 }
const EMIT = process.argv.includes('--emitir')

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

function normalizeCaeDate(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  throw new Error('ARCA no devolvio una fecha de vencimiento de CAE valida.')
}

function approvalFrom(response) {
  const body = response?.response || {}
  return {
    result: body.resultado || body.result || body.Resultado,
    cbteNro: Number(body.cbteNro ?? body.cbte_nro ?? body.numero),
    cae: body.cae || body.CAE,
    caeFchVto: body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae,
    observaciones: body.observaciones || body.observacionesArca || [],
    errores: body.errores || body.errors || []
  }
}

function readAugustRemitos(sql) {
  const rows = sql.queryJson(
    forJson(`
SELECT
  CAST(m.prefijo_remito AS int) AS prefijo,
  CAST(m.numero_remito AS int) AS numero,
  CAST(SUM(CASE WHEN mi.cod_item = ${CONTENT_ITEM} THEN mi.cantidad ELSE 0 END) AS decimal(18, 2)) AS contenidos,
  CAST(SUM(CASE WHEN mi.cod_item = 5 THEN mi.cantidad ELSE 0 END) AS decimal(18, 2)) AS envases
FROM dbo.MovFisicos AS m
INNER JOIN dbo.MovFisicosItems AS mi
  ON mi.tipo_comprobante = m.tipo_comprobante
 AND mi.prefijo_remito = m.prefijo_remito
 AND mi.numero_remito = m.numero_remito
WHERE m.cod_cliente = ${CLIENT}
  AND LTRIM(RTRIM(m.tipo_comprobante)) = 'RR'
  AND m.fecha_remito >= '${PERIOD}'
  AND m.fecha_remito < '2026-09-01'
GROUP BY m.prefijo_remito, m.numero_remito
ORDER BY m.prefijo_remito, m.numero_remito
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
  ) || []

  if (rows.length !== 24) {
    throw new Error(`Se esperaban 24 RR de agosto para cliente ${CLIENT}; se encontraron ${rows.length}.`)
  }
  rows.forEach(row => {
    if (Number(row.contenidos) <= 0 || Number(row.envases) !== -Number(row.contenidos)) {
      throw new Error(`RR/${row.prefijo}-${row.numero} no tiene el par contenido/envase esperado.`)
    }
  })
  const quantity = rows.reduce((total, row) => total + Number(row.contenidos), 0)
  if (quantity !== 110) {
    throw new Error(`Los RR de agosto suman ${quantity} contenidos; se esperaban 110.`)
  }
  return { rows, quantity }
}

function remitosText(rows) {
  const byPrefix = new Map()
  rows.forEach(row => {
    const prefix = Number(row.prefijo)
    const numbers = byPrefix.get(prefix) || []
    numbers.push(Number(row.numero))
    byPrefix.set(prefix, numbers)
  })
  return `REMITOS: ${[...byPrefix.entries()]
    .sort(([left], [right]) => left - right)
    .map(([prefix, numbers]) => `Prefijo: ${prefix} Números: ${numbers.join(',')}`)
    .join('  //  ')}`
}

function buildInvoice(referenceInvoice, { expectedNumber, quantity }) {
  return {
    ...referenceInvoice,
    venta: {
      ...referenceInvoice.venta,
      tipo_comprobante: 'FB',
      prefijo: INVOICE_POINT,
      numero: expectedNumber,
      fecha_operacion: FISCAL_DATE,
      fecha_vencimiento: PERIOD,
      cae: null,
      fecha_vencimiento_cae: null,
      tipo_facturacion: 2,
      numero_ci: null
    },
    items: [
      {
        orden: 1,
        cod_item: RENTAL_ITEM,
        denominacion: 'ALQUILER $0',
        cantidad: RENTAL_COUNT,
        precio: 0,
        importe: 0,
        tasa_iva: 21,
        litros_abonados: null
      },
      {
        orden: 2,
        cod_item: CONTENT_ITEM,
        denominacion: 'CONTENIDO X 20L',
        cantidad: quantity,
        precio: CONTENT_PRICE,
        importe: quantity * CONTENT_PRICE,
        tasa_iva: 21,
        litros_abonados: null
      }
    ]
  }
}

function insertAuthorizedInvoice(sql, { number, cae, caeFchVto, remitos, quantity }) {
  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = 'FB' AND prefijo = ${INVOICE_POINT} AND numero = ${number}
)
  THROW 54000, 'La FB/8 autorizada ya existe en Ventas.', 1;

IF EXISTS (
  SELECT 1 FROM dbo.Cobros WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante_cobro = 'FB' AND prefijo_recibo = ${INVOICE_POINT} AND numero_recibo = ${number}
)
  THROW 54001, 'El numero fiscal autorizado ya esta usado por un Cobro.', 1;

IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_cliente = ${CLIENT}
    AND LTRIM(RTRIM(tipo_comprobante)) IN ('FA', 'FB')
    AND CONVERT(date, fecha_vencimiento) = '${PERIOD}'
)
  THROW 54002, 'Ya existe una factura activa para el periodo de agosto del cliente 104.', 1;

UPDATE dbo.Ventas
SET Mcampo_control = 'N'
WHERE tipo_comprobante = '${PREVIOUS_CREDIT_NOTE.tipo}'
  AND prefijo = ${PREVIOUS_CREDIT_NOTE.prefijo}
  AND numero = ${PREVIOUS_CREDIT_NOTE.numero}
  AND cod_cliente = ${CLIENT}
  AND NULLIF(LTRIM(RTRIM(cae)), '') IS NOT NULL;

IF @@ROWCOUNT <> 1
  THROW 54003, 'No se pudo marcar como N la NB previa de agosto.', 1;

INSERT INTO dbo.Ventas
(
  tipo_comprobante, prefijo, numero, fecha_operacion, cod_cliente,
  nro_lugar_entrega, fecha_vencimiento, remitos_facturados, Mcampo_control,
  cae, fecha_vencimiento_cae, tipo_facturacion, numero_ci, saca_v
)
VALUES
(
  'FB', ${INVOICE_POINT}, ${number}, '${FISCAL_DATE}', ${CLIENT},
  1, '${PERIOD}', '${sqlString(remitos)}', NULL,
  '${sqlString(cae)}', '${sqlString(caeFchVto)}', 2, NULL, NULL
);

INSERT INTO dbo.VentasItems
(tipo_comprobante, prefijo, numero, orden, cod_item, cantidad, precio, importe, tasa_iva, litros_abonados)
VALUES
  ('FB', ${INVOICE_POINT}, ${number}, 1, ${RENTAL_ITEM}, ${RENTAL_COUNT}, 0, 0, 21, NULL),
  ('FB', ${INVOICE_POINT}, ${number}, 2, ${CONTENT_ITEM}, ${quantity}, ${CONTENT_PRICE}, ${quantity * CONTENT_PRICE}, 21, NULL);

COMMIT TRANSACTION;

SELECT
  'FB' AS tipo_comprobante,
  ${INVOICE_POINT} AS prefijo,
  ${number} AS numero,
  '${sqlString(cae)}' AS cae,
  '${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,
  ${quantity * CONTENT_PRICE} AS total,
  2 AS ventas_items,
  '${PREVIOUS_CREDIT_NOTE.tipo}/${PREVIOUS_CREDIT_NOTE.prefijo}-${PREVIOUS_CREDIT_NOTE.numero}' AS nota_marcada_n
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
}

async function main() {
  const sql = new PythonOdbcSqlServer({ database: 'NAVIERA' })
  const remitos = readAugustRemitos(sql)
  const remitosFacturados = remitosText(remitos.rows)
  const repository = new LegacyInvoiceRepository(sql)
  const referenceInvoice = repository.getInvoice(PREVIOUS_CREDIT_NOTE)
  if (!referenceInvoice.venta || !referenceInvoice.cliente || !referenceInvoice.categoriaIva) {
    throw new Error('No se pudo leer el cliente/categoria desde la NB de agosto.')
  }

  const ultimo = await getUltimoComprobante({
    environment: 'produccion',
    representada: process.env.ARCA_REPRESENTADA_CUIT || '20220334857',
    ptoVta: INVOICE_POINT,
    cbteTipo: 6
  })
  const expectedNumber = Number(ultimo.proximoComprobante)
  if (!ultimo.ok || expectedNumber !== 4776) {
    throw new Error(`ARCA no confirma FB/8-4776 (proximo informado: ${ultimo.proximoComprobante || '-'}).`)
  }

  assertNoCobroReceiptConflict(sql, { tipo: 'FB', prefijo: INVOICE_POINT, numero: expectedNumber })
  const invoice = buildInvoice(referenceInvoice, { expectedNumber, quantity: remitos.quantity })
  const provider = new ArcaApiProvider({
    environment: 'produccion',
    representada: process.env.ARCA_REPRESENTADA_CUIT || '20220334857',
    ptoVta: INVOICE_POINT,
    concepto: 1,
    fechaHomologacion: FISCAL_DATE,
    legacyPriceMode: 'gross'
  })
  const preview = provider.buildAuthorizationPreview(invoice)
  if (Math.abs(Number(preview.totals.grossTotalDelta || 0)) > 0.05) {
    throw new Error(`El total ARCA no cierra: diferencia ${preview.totals.grossTotalDelta}.`)
  }

  if (!EMIT) {
    console.log(JSON.stringify({
      mode: 'preview',
      expected: `FB/${INVOICE_POINT}-${expectedNumber}`,
      rr: remitos.rows.length,
      contenidos: remitos.quantity,
      alquileres: RENTAL_COUNT,
      total: remitos.quantity * CONTENT_PRICE,
      remitos_facturados: remitosFacturados,
      payload: preview.payload
    }, null, 2))
    return
  }

  const response = await postFactura({
    payload: preview.payload,
    idempotencyKey: 'PROD-CC-104-202608-RR-CONSOLIDADA'
  })
  const approval = approvalFrom(response)
  if (approval.result !== 'A' || approval.cbteNro !== expectedNumber || !approval.cae || !approval.caeFchVto) {
    throw new Error(`ARCA no aprobo FB/8-${expectedNumber}: ${JSON.stringify(response.response)}`)
  }

  const saved = insertAuthorizedInvoice(sql, {
    number: approval.cbteNro,
    cae: approval.cae,
    caeFchVto: normalizeCaeDate(approval.caeFchVto),
    remitos: remitosFacturados,
    quantity: remitos.quantity
  })
  console.log(JSON.stringify({ status: 'ok', saved, observaciones: approval.observaciones, errores: approval.errores }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
