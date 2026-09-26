const { PythonOdbcSqlServer } = require('./local-sql-server')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

const CLIENT = 247
const ORIGINAL_NOTE = { tipo: 'NA', prefijo: 7, numero: 12 }
const PERIOD = '2026-08-01'
const FISCAL_DATE = '2026-09-22'
const CONTENT_QUANTITY = 17
const CONTENT_PRICE = 7000
const RENTAL_ITEM = 8
const RENTAL_PRICE = 100
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
    ptoVta: Number(body.ptoVta ?? body.pto_vta),
    cbteTipo: Number(body.cbteTipo ?? body.cbte_tipo),
    observaciones: body.observaciones || [],
    errores: body.errores || []
  }
}

function readAugustRemitos(sql) {
  const rows = sql.queryJson(
    forJson(`
SELECT
  CAST(m.prefijo_remito AS int) AS prefijo,
  CAST(m.numero_remito AS int) AS numero,
  CAST(SUM(CASE WHEN mi.cod_item=1 THEN mi.cantidad ELSE 0 END) AS decimal(18,2)) AS contenidos
FROM dbo.MovFisicos m
JOIN dbo.MovFisicosItems mi ON mi.tipo_comprobante=m.tipo_comprobante AND mi.prefijo_remito=m.prefijo_remito AND mi.numero_remito=m.numero_remito
WHERE m.cod_cliente=${CLIENT} AND m.tipo_comprobante='RR'
  AND m.fecha_remito >= '${PERIOD}' AND m.fecha_remito < '2026-09-01'
GROUP BY m.prefijo_remito,m.numero_remito
ORDER BY m.prefijo_remito,m.numero_remito
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
  ) || []
  const quantity = rows.reduce((total, row) => total + Number(row.contenidos), 0)
  if (rows.length !== 4 || quantity !== CONTENT_QUANTITY) {
    throw new Error(`Los RR de agosto no cierran: ${rows.length} remitos y ${quantity} contenidos.`)
  }
  return {
    quantity,
    remitosFacturados: `REMITOS: ${[...new Map(rows.map(row => [Number(row.prefijo), rows.filter(item => Number(item.prefijo) === Number(row.prefijo)).map(item => Number(item.numero))]))]
      .sort(([left], [right]) => left - right)
      .map(([prefix, numbers]) => `Prefijo: ${prefix} Números: ${numbers.join(',')}`)
      .join('  //  ')}`
  }
}

function buildInvoice(reference, number, remitosFacturados) {
  return {
    ...reference,
    venta: {
      ...reference.venta,
      tipo_comprobante: 'FA',
      prefijo: 7,
      numero: number,
      fecha_operacion: FISCAL_DATE,
      fecha_vencimiento: PERIOD,
      remitos_facturados: remitosFacturados,
      cae: null,
      fecha_vencimiento_cae: null,
      mcampo_control: null,
      tipo_facturacion: 2,
      numero_ci: null
    },
    items: [
      { orden: 1, cod_item: RENTAL_ITEM, denominacion: 'ALQUILER $10', cantidad: 1, precio: RENTAL_PRICE, importe: RENTAL_PRICE, tasa_iva: 21, litros_abonados: null },
      { orden: 2, cod_item: 1, denominacion: 'CONTENIDO X 20L', cantidad: CONTENT_QUANTITY, precio: CONTENT_PRICE, importe: CONTENT_QUANTITY * CONTENT_PRICE, tasa_iva: 21, litros_abonados: null }
    ]
  }
}

function insertAuthorizedInvoice(sql, { number, cae, caeFchVto, invoice }) {
  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante='FA' AND prefijo=7 AND numero=${number})
  THROW 54200, 'La FA/7 autorizada ya existe en Ventas.', 1;
IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante_cobro='FA' AND prefijo_recibo=7 AND numero_recibo=${number})
  THROW 54201, 'El numero FA/7 autorizado ya esta usado por un Cobro.', 1;
IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK)
  WHERE cod_cliente=${CLIENT} AND LTRIM(RTRIM(tipo_comprobante)) IN ('FA','FB')
    AND CONVERT(date,fecha_vencimiento)='${PERIOD}'
)
  THROW 54202, 'Ya existe una factura activa de agosto para el cliente 247.', 1;

UPDATE dbo.Ventas
SET Mcampo_control='N'
WHERE tipo_comprobante='${ORIGINAL_NOTE.tipo}' AND prefijo=${ORIGINAL_NOTE.prefijo} AND numero=${ORIGINAL_NOTE.numero}
  AND cod_cliente=${CLIENT} AND NULLIF(LTRIM(RTRIM(cae)), '') IS NOT NULL;
IF @@ROWCOUNT <> 1
  THROW 54203, 'No se pudo marcar como N la NA previa de agosto.', 1;

INSERT INTO dbo.Ventas
(tipo_comprobante,prefijo,numero,fecha_operacion,cod_cliente,nro_lugar_entrega,fecha_vencimiento,remitos_facturados,Mcampo_control,cae,fecha_vencimiento_cae,tipo_facturacion,numero_ci,saca_v)
VALUES
('FA',7,${number},'${FISCAL_DATE}',${CLIENT},1,'${PERIOD}','${sqlString(invoice.venta.remitos_facturados)}',NULL,'${sqlString(cae)}','${sqlString(caeFchVto)}',2,NULL,NULL);

INSERT INTO dbo.VentasItems
(tipo_comprobante,prefijo,numero,orden,cod_item,cantidad,precio,importe,tasa_iva,litros_abonados)
VALUES
('FA',7,${number},1,${RENTAL_ITEM},1,${RENTAL_PRICE},${RENTAL_PRICE},21,NULL),
('FA',7,${number},2,1,${CONTENT_QUANTITY},${CONTENT_PRICE},${CONTENT_QUANTITY * CONTENT_PRICE},21,NULL);

COMMIT TRANSACTION;

SELECT 'FA' AS tipo_comprobante,7 AS prefijo,${number} AS numero,'${sqlString(cae)}' AS cae,'${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,
       ${CONTENT_QUANTITY * CONTENT_PRICE + RENTAL_PRICE} AS total,2 AS ventas_items,'NA/7-12' AS nota_marcada_n
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
}

async function main() {
  const sql = new PythonOdbcSqlServer({ database: 'NAVIERA' })
  const remitos = readAugustRemitos(sql)
  const legacy = new LegacyInvoiceRepository(sql)
  const reference = legacy.getInvoice(ORIGINAL_NOTE)
  if (!reference.venta || !reference.items.length || Number(reference.venta.cod_cliente) !== CLIENT) {
    throw new Error('No se pudo validar la NA/7-12 del cliente 247.')
  }

  const representada = process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
  const ultimo = await getUltimoComprobante({ environment: 'produccion', representada, ptoVta: 7, cbteTipo: 1 })
  const expected = Number(ultimo.proximoComprobante)
  if (!ultimo.ok || expected !== 40003) {
    throw new Error(`ARCA no confirma FA/7-40003 (proximo informado: ${ultimo.proximoComprobante || '-'}).`)
  }
  assertNoCobroReceiptConflict(sql, { tipo: 'FA', prefijo: 7, numero: expected })
  const invoice = buildInvoice(reference, expected, remitos.remitosFacturados)
  const provider = new ArcaApiProvider({
    environment: 'produccion', representada, ptoVta: 7, concepto: 1,
    fechaHomologacion: FISCAL_DATE, legacyPriceMode: 'gross'
  })
  const preview = provider.buildAuthorizationPreview(invoice)
  if (Math.abs(Number(preview.totals.grossTotalDelta || 0)) > 0.05) {
    throw new Error(`El total ARCA no cierra: diferencia ${preview.totals.grossTotalDelta}.`)
  }

  if (!EMIT) {
    console.log(JSON.stringify({
      mode: 'preview', expected: `FA/7-${expected}`, rr: 4, contenidos: CONTENT_QUANTITY,
      precio_contenido: CONTENT_PRICE, alquiler: RENTAL_PRICE, total: CONTENT_QUANTITY * CONTENT_PRICE + RENTAL_PRICE,
      remitos_facturados: remitos.remitosFacturados, payload: preview.payload
    }, null, 2))
    return
  }

  const response = await postFactura({ payload: preview.payload, idempotencyKey: 'PROD-CC-247-202608-RR-P7' })
  const approval = approvalFrom(response)
  if (approval.result !== 'A' || approval.cbteNro !== expected || approval.ptoVta !== 7 || approval.cbteTipo !== 1 || !approval.cae || !approval.caeFchVto) {
    throw new Error(`ARCA no aprobo la FA/7-${expected}: ${JSON.stringify(response.response)}`)
  }
  const saved = insertAuthorizedInvoice(sql, {
    number: approval.cbteNro, cae: approval.cae, caeFchVto: normalizeCaeDate(approval.caeFchVto), invoice
  })
  console.log(JSON.stringify({ status:'ok', saved, observaciones:approval.observaciones, errores:approval.errores }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode=1
})
