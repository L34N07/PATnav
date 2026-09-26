const { PythonOdbcSqlServer } = require('./local-sql-server')
const { MovimientosRepository } = require('./movimientos-repository')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura, postCreditNote } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

const ORIGINAL = { tipo: 'FB', prefijo: 8, numero: 4776 }
const CLIENT = 104
const FISCAL_DATE = '2026-09-21'
const EMIT = process.argv.includes('--emitir')

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
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
    ptoVta: Number(body.ptoVta ?? body.pto_vta),
    cbteTipo: Number(body.cbteTipo ?? body.cbte_tipo),
    observaciones: body.observaciones || body.observacionesArca || [],
    errores: body.errores || body.errors || []
  }
}

function buildFb7Invoice(originalInvoice, number) {
  return {
    ...originalInvoice,
    venta: {
      ...originalInvoice.venta,
      tipo_comprobante: 'FB',
      prefijo: 7,
      numero: number,
      fecha_operacion: FISCAL_DATE,
      cae: null,
      fecha_vencimiento_cae: null,
      mcampo_control: null
    }
  }
}

function insertFb7(sql, { number, cae, caeFchVto, invoice }) {
  const items = invoice.items
  const itemValues = items
    .map(item => `(
      'FB', 7, ${number}, ${Number(item.orden)}, ${Number(item.cod_item)},
      ${Number(item.cantidad)}, ${Number(item.precio)}, ${Number(item.importe)},
      ${Number(item.tasa_iva)}, ${Number(item.litros_abonados || 0)}
    )`)
    .join(',\n')

  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante='FB' AND prefijo=7 AND numero=${number}
)
  THROW 54100, 'La FB/7 autorizada ya existe en Ventas.', 1;

IF EXISTS (
  SELECT 1 FROM dbo.Cobros WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante_cobro='FB' AND prefijo_recibo=7 AND numero_recibo=${number}
)
  THROW 54101, 'El numero FB/7 autorizado ya esta usado por un Cobro.', 1;

IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_cliente=${CLIENT}
    AND LTRIM(RTRIM(tipo_comprobante))='FB'
    AND prefijo=7
    AND CONVERT(date, fecha_vencimiento)='${sqlString(String(invoice.venta.fecha_vencimiento).slice(0, 10))}'
)
  THROW 54102, 'Ya existe una FB/7 activa para este periodo del cliente 104.', 1;

INSERT INTO dbo.Ventas
(
  tipo_comprobante, prefijo, numero, fecha_operacion, cod_cliente,
  nro_lugar_entrega, fecha_vencimiento, remitos_facturados, Mcampo_control,
  cae, fecha_vencimiento_cae, tipo_facturacion, numero_ci, saca_v
)
VALUES
(
  'FB', 7, ${number}, '${FISCAL_DATE}', ${CLIENT},
  ${Number(invoice.venta.nro_lugar_entrega)}, '${sqlString(String(invoice.venta.fecha_vencimiento).slice(0, 10))}',
  '${sqlString(invoice.venta.remitos_facturados)}', NULL,
  '${sqlString(cae)}', '${sqlString(caeFchVto)}', ${Number(invoice.venta.tipo_facturacion)}, NULL, NULL
);

INSERT INTO dbo.VentasItems
(tipo_comprobante, prefijo, numero, orden, cod_item, cantidad, precio, importe, tasa_iva, litros_abonados)
VALUES
${itemValues};

COMMIT TRANSACTION;

SELECT 'FB' AS tipo_comprobante, 7 AS prefijo, ${number} AS numero,
       '${sqlString(cae)}' AS cae, '${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,
       (SELECT CAST(SUM(importe) AS decimal(18,2)) FROM dbo.VentasItems WHERE tipo_comprobante='FB' AND prefijo=7 AND numero=${number}) AS total
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
}

async function main() {
  const sql = new PythonOdbcSqlServer({ database: 'NAVIERA' })
  const legacy = new LegacyInvoiceRepository(sql)
  const originalInvoice = legacy.getInvoice(ORIGINAL)
  if (!originalInvoice.venta || !originalInvoice.items.length) {
    throw new Error('No existe la FB/8-4776 original o no tiene renglones.')
  }
  if (Number(originalInvoice.venta.cod_cliente) !== CLIENT || !originalInvoice.venta.cae) {
    throw new Error('La FB/8-4776 no coincide con la factura autorizada del cliente 104.')
  }

  const representada = process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
  const [nb8, fb7] = await Promise.all([
    getUltimoComprobante({ environment: 'produccion', representada, ptoVta: 8, cbteTipo: 8 }),
    getUltimoComprobante({ environment: 'produccion', representada, ptoVta: 7, cbteTipo: 6 })
  ])
  const expectedNb8 = Number(nb8.proximoComprobante)
  const expectedFb7 = Number(fb7.proximoComprobante)
  if (!nb8.ok || !fb7.ok || expectedNb8 !== 5 || expectedFb7 !== 49076) {
    throw new Error(`Correlatividad ARCA cambio: NB/8=${nb8.proximoComprobante || '-'}; FB/7=${fb7.proximoComprobante || '-'}.`)
  }
  assertNoCobroReceiptConflict(sql, { tipo: 'FB', prefijo: 7, numero: expectedFb7 })

  const ncProvider = new ArcaApiProvider({
    environment: 'produccion', representada, ptoVta: 8, concepto: 1,
    fechaHomologacion: FISCAL_DATE, legacyPriceMode: 'gross'
  })
  const ncPreview = ncProvider.buildCreditNotePreview(originalInvoice)
  const fb7Invoice = buildFb7Invoice(originalInvoice, expectedFb7)
  const invoiceProvider = new ArcaApiProvider({
    environment: 'produccion', representada, ptoVta: 7, concepto: 1,
    fechaHomologacion: FISCAL_DATE, legacyPriceMode: 'gross'
  })
  const fb7Preview = invoiceProvider.buildAuthorizationPreview(fb7Invoice)
  if (Math.abs(Number(fb7Preview.totals.grossTotalDelta || 0)) > 0.05) {
    throw new Error(`La nueva FB/7 no cierra: diferencia ${fb7Preview.totals.grossTotalDelta}.`)
  }

  if (!EMIT) {
    console.log(JSON.stringify({
      mode: 'preview',
      credit: { original: 'FB/8-4776', expected: `NB/8-${expectedNb8}`, payload: ncPreview.payload },
      replacement: { expected: `FB/7-${expectedFb7}`, total: fb7Preview.totals.legacyGrossTotal, payload: fb7Preview.payload }
    }, null, 2))
    return
  }

  const ncResponse = await postCreditNote({
    payload: ncPreview.payload,
    idempotencyKey: 'PROD-NC-FB-8-4776'
  })
  const nc = approvalFrom(ncResponse)
  if (nc.result !== 'A' || nc.cbteNro !== expectedNb8 || nc.ptoVta !== 8 || nc.cbteTipo !== 8 || !nc.cae || !nc.caeFchVto) {
    throw new Error(`ARCA no aprobo la NB/8-${expectedNb8}: ${JSON.stringify(ncResponse.response)}`)
  }

  const repository = new MovimientosRepository(sql)
  const converted = repository.convertAuthorizedInvoiceToCredit({
    original: { tipoComprobante: 'FB', prefijo: 8, numero: 4776 },
    credit: { ptoVta: 8, cbteNro: nc.cbteNro, cae: nc.cae, caeFchVto: normalizeCaeDate(nc.caeFchVto) },
    fechaEmision: FISCAL_DATE
  })

  const fb7Response = await postFactura({
    payload: fb7Preview.payload,
    idempotencyKey: 'PROD-CC-104-202608-RR-P7'
  })
  const fb7Approval = approvalFrom(fb7Response)
  if (fb7Approval.result !== 'A' || fb7Approval.cbteNro !== expectedFb7 || fb7Approval.ptoVta !== 7 || fb7Approval.cbteTipo !== 6 || !fb7Approval.cae || !fb7Approval.caeFchVto) {
    throw new Error(`ARCA no aprobo la FB/7-${expectedFb7}: ${JSON.stringify(fb7Response.response)}`)
  }

  const inserted = insertFb7(sql, {
    number: fb7Approval.cbteNro,
    cae: fb7Approval.cae,
    caeFchVto: normalizeCaeDate(fb7Approval.caeFchVto),
    invoice: fb7Invoice
  })
  console.log(JSON.stringify({
    status: 'ok',
    credit: { tipo: 'NB', prefijo: 8, numero: nc.cbteNro, cae: nc.cae, converted },
    invoice: inserted,
    observaciones: { nc: nc.observaciones, fb7: fb7Approval.observaciones },
    errores: { nc: nc.errores, fb7: fb7Approval.errores }
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
