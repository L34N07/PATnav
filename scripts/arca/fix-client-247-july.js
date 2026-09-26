const { PythonOdbcSqlServer } = require('./local-sql-server')
const { MovimientosRepository } = require('./movimientos-repository')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura, postCreditNote } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

const CLIENT = 247
const POINT = 7
const ORIGINAL = { tipo: 'FA', prefijo: 7, numero: 40003 }
const PREVIOUS_JULY_NOTE = { tipo: 'NA', prefijo: 7, numero: 39 }
const PERIOD = '2026-07-01'
const FISCAL_DATE = '2026-09-22'
const JULY_RR = [
  { prefijo: 3, numero: 25869, cantidad: 3 },
  { prefijo: 3, numero: 25889, cantidad: 5 },
  { prefijo: 3, numero: 25910, cantidad: 14 },
  { prefijo: 3, numero: 25931, cantidad: 2 }
]
const EMIT = process.argv.includes('--emitir')

function sqlString(value) { return String(value ?? '').replace(/'/g, "''") }
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
    observaciones: body.observaciones || [], errores: body.errores || []
  }
}
function readJulyRr(sql) {
  const rows = sql.queryJson(`
SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT CAST(m.prefijo_remito AS int) AS prefijo, CAST(m.numero_remito AS int) AS numero,
       CAST(SUM(CASE WHEN mi.cod_item=1 THEN mi.cantidad ELSE 0 END) AS decimal(18,2)) AS contenidos
FROM dbo.MovFisicos m
JOIN dbo.MovFisicosItems mi ON mi.tipo_comprobante=m.tipo_comprobante AND mi.prefijo_remito=m.prefijo_remito AND mi.numero_remito=m.numero_remito
WHERE m.cod_cliente=${CLIENT} AND m.nro_lugar_entrega=1 AND m.tipo_comprobante='RR'
  AND m.fecha_remito>='${PERIOD}' AND m.fecha_remito<'2026-08-01'
GROUP BY m.prefijo_remito,m.numero_remito
ORDER BY m.prefijo_remito,m.numero_remito
FOR JSON PATH, INCLUDE_NULL_VALUES;`) || []
  const expected = JSON.stringify(JULY_RR)
  const actual = JSON.stringify(rows.map(row => ({ prefijo:Number(row.prefijo), numero:Number(row.numero), cantidad:Number(row.contenidos) })))
  if (actual !== expected) throw new Error(`Los RR de julio cambiaron. Esperado ${expected}; actual ${actual}.`)
  return rows.reduce((sum, row) => sum + Number(row.contenidos), 0)
}
function buildJulyInvoice(reference, number, quantity) {
  return {
    ...reference,
    venta: {
      ...reference.venta, tipo_comprobante:'FA', prefijo:POINT, numero:number,
      fecha_operacion:FISCAL_DATE, fecha_vencimiento:PERIOD,
      remitos_facturados:'REMITOS: Prefijo: 3 Números: 25869,25889,25910,25931',
      cae:null, fecha_vencimiento_cae:null, mcampo_control:null, tipo_facturacion:2, numero_ci:null
    },
    items: [
      { orden:1,cod_item:8,denominacion:'ALQUILER $10',cantidad:1,precio:100,importe:100,tasa_iva:21,litros_abonados:null },
      { orden:2,cod_item:1,denominacion:'CONTENIDO X 20L',cantidad:quantity,precio:7000,importe:quantity*7000,tasa_iva:21,litros_abonados:null }
    ]
  }
}
function insertJulyInvoice(sql, { number, cae, caeFchVto, invoice }) {
  const quantity = Number(invoice.items[1].cantidad)
  const total = quantity * 7000 + 100
  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante='FA' AND prefijo=${POINT} AND numero=${number})
  THROW 54500, 'La FA/7 autorizada ya existe en NAVIERA.', 1;
IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante_cobro='FA' AND prefijo_recibo=${POINT} AND numero_recibo=${number})
  THROW 54501, 'El numero FA/7 autorizado ya esta usado por un Cobro.', 1;
IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE cod_cliente=${CLIENT} AND nro_lugar_entrega=1 AND tipo_comprobante IN ('FA','FB') AND CONVERT(date,fecha_vencimiento)='${PERIOD}')
  THROW 54502, 'Ya existe una factura activa de julio para cliente 247/1.', 1;

UPDATE dbo.Ventas SET Mcampo_control='N'
WHERE tipo_comprobante='${PREVIOUS_JULY_NOTE.tipo}' AND prefijo=${PREVIOUS_JULY_NOTE.prefijo} AND numero=${PREVIOUS_JULY_NOTE.numero}
  AND cod_cliente=${CLIENT} AND nro_lugar_entrega=1 AND NULLIF(LTRIM(RTRIM(cae)), '') IS NOT NULL;
IF @@ROWCOUNT <> 1 THROW 54503, 'No se pudo marcar como N la NA/7-39 previa.', 1;

INSERT INTO dbo.Ventas
(tipo_comprobante,prefijo,numero,fecha_operacion,cod_cliente,nro_lugar_entrega,fecha_vencimiento,remitos_facturados,Mcampo_control,cae,fecha_vencimiento_cae,tipo_facturacion,numero_ci,saca_v)
VALUES
('FA',${POINT},${number},'${FISCAL_DATE}',${CLIENT},1,'${PERIOD}','${sqlString(invoice.venta.remitos_facturados)}',NULL,'${sqlString(cae)}','${sqlString(caeFchVto)}',2,NULL,NULL);
INSERT INTO dbo.VentasItems (tipo_comprobante,prefijo,numero,orden,cod_item,cantidad,precio,importe,tasa_iva,litros_abonados)
VALUES ('FA',${POINT},${number},1,8,1,100,100,21,NULL),
       ('FA',${POINT},${number},2,1,${quantity},7000,${quantity * 7000},21,NULL);
COMMIT TRANSACTION;
SELECT 'FA' AS tipo_comprobante,${POINT} AS prefijo,${number} AS numero,'${sqlString(cae)}' AS cae,'${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,${total} AS total,2 AS ventas_items,'NA/7-39' AS nota_marcada_n
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;`)
}
async function main() {
  const sql = new PythonOdbcSqlServer({ database:'NAVIERA' })
  const legacy = new LegacyInvoiceRepository(sql)
  const original = legacy.getInvoice(ORIGINAL)
  if (!original.venta || !original.items.length || Number(original.venta.cod_cliente)!==CLIENT || !original.venta.cae) throw new Error('FA/7-40003 no esta disponible para anular.')
  const quantity = readJulyRr(sql)
  if (quantity !== 24) throw new Error(`Los RR de julio suman ${quantity}; se esperaban 24 contenidos.`)
  const representada = process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
  const [nextNc,nextFa] = await Promise.all([
    getUltimoComprobante({environment:'produccion',representada,ptoVta:POINT,cbteTipo:3}),
    getUltimoComprobante({environment:'produccion',representada,ptoVta:POINT,cbteTipo:1})
  ])
  const ncNumber=Number(nextNc.proximoComprobante), faNumber=Number(nextFa.proximoComprobante)
  if (!nextNc.ok || !nextFa.ok || !Number.isInteger(ncNumber) || !Number.isInteger(faNumber)) throw new Error('ARCA no informo correlatividad valida para NA/7 y FA/7.')
  assertNoCobroReceiptConflict(sql,{tipo:'FA',prefijo:POINT,numero:faNumber})
  const provider = new ArcaApiProvider({environment:'produccion',representada,ptoVta:POINT,concepto:1,fechaHomologacion:FISCAL_DATE,legacyPriceMode:'gross'})
  const creditPreview=provider.buildCreditNotePreview(original)
  const julyInvoice=buildJulyInvoice(original,faNumber,quantity)
  const invoicePreview=provider.buildAuthorizationPreview(julyInvoice)
  if (Math.abs(Number(invoicePreview.totals.grossTotalDelta||0))>.05) throw new Error(`La FA de julio no cierra: ${invoicePreview.totals.grossTotalDelta}.`)
  if (!EMIT) {
    console.log(JSON.stringify({mode:'preview',credit:{original:'FA/7-40003',expected:`NA/7-${ncNumber}`},july:{expected:`FA/7-${faNumber}`,rr:JULY_RR,contenidos:quantity,total:quantity*7000+100,fecha_fiscal:FISCAL_DATE,fecha_vencimiento:PERIOD}},null,2)); return
  }
  const ncResponse=await postCreditNote({payload:creditPreview.payload,idempotencyKey:'PROD-NC-FA-7-40003'})
  const nc=approvalFrom(ncResponse)
  if (nc.result!=='A'||nc.cbteNro!==ncNumber||nc.ptoVta!==POINT||nc.cbteTipo!==3||!nc.cae||!nc.caeFchVto) throw new Error(`ARCA no aprobo NA/7-${ncNumber}: ${JSON.stringify(ncResponse.response)}`)
  const repository=new MovimientosRepository(sql)
  const converted=repository.convertAuthorizedInvoiceToCredit({original:{tipoComprobante:'FA',prefijo:POINT,numero:40003},credit:{ptoVta:POINT,cbteNro:nc.cbteNro,cae:nc.cae,caeFchVto:normalizeCaeDate(nc.caeFchVto)},fechaEmision:FISCAL_DATE,syncTalonario:false})
  const faResponse=await postFactura({payload:invoicePreview.payload,idempotencyKey:'PROD-CC-247-202607-RR-P7'})
  const fa=approvalFrom(faResponse)
  if (fa.result!=='A'||fa.cbteNro!==faNumber||fa.ptoVta!==POINT||fa.cbteTipo!==1||!fa.cae||!fa.caeFchVto) throw new Error(`ARCA no aprobo FA/7-${faNumber}: ${JSON.stringify(faResponse.response)}`)
  const inserted=insertJulyInvoice(sql,{number:fa.cbteNro,cae:fa.cae,caeFchVto:normalizeCaeDate(fa.caeFchVto),invoice:julyInvoice})
  console.log(JSON.stringify({status:'ok',credit:{tipo:'NA',prefijo:POINT,numero:nc.cbteNro,cae:nc.cae,conversion:converted},july:inserted,observaciones:{nc:nc.observaciones,fa:fa.observaciones},errores:{nc:nc.errores,fa:fa.errores}},null,2))
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
