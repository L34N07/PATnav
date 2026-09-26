const { PythonOdbcSqlServer } = require('./local-sql-server')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

// Facturacion puntual de agosto para QUINTAL SA. No crea ni altera remitos.
const CLIENT = 464
const POINT = 7
const PERIOD = '2026-08-01'
const FISCAL_DATE = '2026-09-22'
const PREVIOUS_NOTE = { tipo: 'NA', prefijo: 7, numero: 14 }
const REMITO = { prefijo: 1, numero: 32179 }
const EMIT = process.argv.includes('--emitir')

const ITEMS = [
  { orden: 1, cod_item: 8, denominacion: 'ALQUILER $10', cantidad: 1, precio: 100, importe: 100, tasa_iva: 21 },
  { orden: 2, cod_item: 1, denominacion: 'CONTENIDO X 20L', cantidad: 3, precio: 9000, importe: 27000, tasa_iva: 21 },
  { orden: 3, cod_item: 31, denominacion: 'DIF.CONSUMO', cantidad: 1, precio: 9000, importe: 9000, tasa_iva: 21 }
]

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function jsonQuery(query) {
  return `SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ${query}`
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

function assertAugustSource(sql) {
  const rows = sql.queryJson(jsonQuery(`
SELECT
  CAST(SUM(CASE WHEN mi.cod_item=1 THEN mi.cantidad ELSE 0 END) AS decimal(18,2)) AS contenidos,
  CAST(SUM(CASE WHEN mi.cod_item=5 THEN mi.cantidad ELSE 0 END) AS decimal(18,2)) AS envases
FROM dbo.MovFisicos m
JOIN dbo.MovFisicosItems mi
  ON mi.tipo_comprobante=m.tipo_comprobante
 AND mi.prefijo_remito=m.prefijo_remito
 AND mi.numero_remito=m.numero_remito
WHERE m.cod_cliente=${CLIENT} AND m.nro_lugar_entrega=1
  AND m.tipo_comprobante='RR' AND m.prefijo_remito=${REMITO.prefijo} AND m.numero_remito=${REMITO.numero}
  AND m.fecha_remito >= '${PERIOD}' AND m.fecha_remito < '2026-09-01'
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)) || {}
  if (Number(rows.contenidos) !== 3 || Number(rows.envases) !== -3) {
    throw new Error(`El RR/${REMITO.prefijo}-${REMITO.numero} no tiene 3 contenidos y -3 envases.`)
  }
}

function buildInvoice(reference, number) {
  return {
    ...reference,
    venta: {
      ...reference.venta,
      tipo_comprobante: 'FA',
      prefijo: POINT,
      numero: number,
      fecha_operacion: FISCAL_DATE,
      fecha_vencimiento: PERIOD,
      remitos_facturados: `REMITOS: Prefijo: ${REMITO.prefijo} Números: ${REMITO.numero}`,
      cae: null,
      fecha_vencimiento_cae: null,
      mcampo_control: null,
      tipo_facturacion: 2,
      numero_ci: null
    },
    items: ITEMS.map(item => ({ ...item, litros_abonados: null }))
  }
}

function saveAuthorizedInvoice(sql, { number, cae, caeFchVto, invoice }) {
  const total = ITEMS.reduce((sum, item) => sum + item.importe, 0)
  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante='FA' AND prefijo=${POINT} AND numero=${number})
  THROW 54400, 'La FA/7 autorizada ya existe en Ventas.', 1;
IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante_cobro='FA' AND prefijo_recibo=${POINT} AND numero_recibo=${number})
  THROW 54401, 'El numero fiscal autorizado ya esta usado por un Cobro.', 1;
IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK)
  WHERE cod_cliente=${CLIENT} AND nro_lugar_entrega=1
    AND LTRIM(RTRIM(tipo_comprobante)) IN ('FA','FB')
    AND CONVERT(date,fecha_vencimiento)='${PERIOD}'
)
  THROW 54402, 'Ya existe una factura activa de agosto para cliente 464/1.', 1;

UPDATE dbo.Ventas
SET Mcampo_control='N'
WHERE tipo_comprobante='${PREVIOUS_NOTE.tipo}' AND prefijo=${PREVIOUS_NOTE.prefijo} AND numero=${PREVIOUS_NOTE.numero}
  AND cod_cliente=${CLIENT} AND nro_lugar_entrega=1
  AND NULLIF(LTRIM(RTRIM(cae)), '') IS NOT NULL;
IF @@ROWCOUNT <> 1
  THROW 54403, 'No se pudo marcar como N la NA/7-14 previa.', 1;

INSERT INTO dbo.Ventas
(tipo_comprobante,prefijo,numero,fecha_operacion,cod_cliente,nro_lugar_entrega,fecha_vencimiento,remitos_facturados,Mcampo_control,cae,fecha_vencimiento_cae,tipo_facturacion,numero_ci,saca_v)
VALUES
('FA',${POINT},${number},'${FISCAL_DATE}',${CLIENT},1,'${PERIOD}','${sqlString(invoice.venta.remitos_facturados)}',NULL,'${sqlString(cae)}','${sqlString(caeFchVto)}',2,NULL,NULL);

INSERT INTO dbo.VentasItems
(tipo_comprobante,prefijo,numero,orden,cod_item,cantidad,precio,importe,tasa_iva,litros_abonados)
VALUES
${ITEMS.map(item => `('FA',${POINT},${number},${item.orden},${item.cod_item},${item.cantidad},${item.precio},${item.importe},${item.tasa_iva},NULL)`).join(',\n')};

COMMIT TRANSACTION;

SELECT 'FA' AS tipo_comprobante,${POINT} AS prefijo,${number} AS numero,
       '${sqlString(cae)}' AS cae,'${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,
       ${total} AS total,3 AS ventas_items,'NA/7-14' AS nota_marcada_n
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
}

async function main() {
  const sql = new PythonOdbcSqlServer({ database: 'NAVIERA' })
  assertAugustSource(sql)
  const legacy = new LegacyInvoiceRepository(sql)
  const reference = legacy.getInvoice(PREVIOUS_NOTE)
  if (!reference.venta || !reference.cliente || !reference.categoriaIva || Number(reference.venta.cod_cliente) !== CLIENT) {
    throw new Error('No se pudo validar la NA/7-14 de cliente 464.')
  }

  const representada = process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
  const ultimo = await getUltimoComprobante({ environment: 'produccion', representada, ptoVta: POINT, cbteTipo: 1 })
  const expected = Number(ultimo.proximoComprobante)
  if (!ultimo.ok || !Number.isInteger(expected) || expected <= 0) {
    throw new Error(`ARCA no informo el proximo FA/7: ${ultimo.proximoComprobante || '-'}.`)
  }
  assertNoCobroReceiptConflict(sql, { tipo: 'FA', prefijo: POINT, numero: expected })

  const invoice = buildInvoice(reference, expected)
  const provider = new ArcaApiProvider({
    environment: 'produccion', representada, ptoVta: POINT, concepto: 1,
    fechaHomologacion: FISCAL_DATE, legacyPriceMode: 'gross'
  })
  const preview = provider.buildAuthorizationPreview(invoice)
  if (Math.abs(Number(preview.totals.grossTotalDelta || 0)) > 0.05) {
    throw new Error(`El total ARCA no cierra: diferencia ${preview.totals.grossTotalDelta}.`)
  }

  const total = ITEMS.reduce((sum, item) => sum + item.importe, 0)
  if (!EMIT) {
    console.log(JSON.stringify({
      mode: 'preview', expected: `FA/7-${expected}`, cliente: '464/1',
      remito: `RR/${REMITO.prefijo}-${REMITO.numero}`, items: ITEMS, total,
      fecha_fiscal: FISCAL_DATE, fecha_vencimiento_legacy: PERIOD
    }, null, 2))
    return
  }

  const response = await postFactura({
    payload: preview.payload,
    idempotencyKey: 'PROD-CC-464-202608-RR32179-P7'
  })
  const approval = approvalFrom(response)
  if (approval.result !== 'A' || approval.cbteNro !== expected || approval.ptoVta !== POINT || approval.cbteTipo !== 1 || !approval.cae || !approval.caeFchVto) {
    throw new Error(`ARCA no aprobo la FA/7-${expected}: ${JSON.stringify(response.response)}`)
  }
  const saved = saveAuthorizedInvoice(sql, {
    number: approval.cbteNro,
    cae: approval.cae,
    caeFchVto: normalizeCaeDate(approval.caeFchVto),
    invoice
  })
  console.log(JSON.stringify({ status: 'ok', saved, observaciones: approval.observaciones, errores: approval.errores }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
