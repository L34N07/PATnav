const { PythonOdbcSqlServer } = require('./local-sql-server')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

const CLIENT = 247
const POINT = 7
const PERIOD = '2026-08-01'
const FISCAL_DATE = '2026-09-22'
const SOURCE_NOTE = { tipo: 'NA', prefijo: 7, numero: 42 }
const AUGUST_RR = [
  { prefijo: 2, numero: 31233, cantidad: 4 },
  { prefijo: 2, numero: 31360, cantidad: 5 },
  { prefijo: 3, numero: 25956, cantidad: 3 },
  { prefijo: 3, numero: 25999, cantidad: 5 }
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
function readAugustRr(sql) {
  const rows = sql.queryJson(`
SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT CAST(m.prefijo_remito AS int) AS prefijo, CAST(m.numero_remito AS int) AS numero,
       CAST(SUM(CASE WHEN mi.cod_item=1 THEN mi.cantidad ELSE 0 END) AS decimal(18,2)) AS contenidos
FROM dbo.MovFisicos m JOIN dbo.MovFisicosItems mi
  ON mi.tipo_comprobante=m.tipo_comprobante AND mi.prefijo_remito=m.prefijo_remito AND mi.numero_remito=m.numero_remito
WHERE m.cod_cliente=${CLIENT} AND m.nro_lugar_entrega=1 AND m.tipo_comprobante='RR'
  AND m.fecha_remito>='${PERIOD}' AND m.fecha_remito<'2026-09-01'
GROUP BY m.prefijo_remito,m.numero_remito
ORDER BY m.prefijo_remito,m.numero_remito
FOR JSON PATH, INCLUDE_NULL_VALUES;`) || []
  const expected = JSON.stringify(AUGUST_RR)
  const actual = JSON.stringify(rows.map(row => ({ prefijo:Number(row.prefijo), numero:Number(row.numero), cantidad:Number(row.contenidos) })))
  if (actual !== expected) throw new Error(`Los RR de agosto cambiaron. Esperado ${expected}; actual ${actual}.`)
  return rows.reduce((sum,row)=>sum+Number(row.contenidos),0)
}
function buildInvoice(reference, number, quantity) {
  return {
    ...reference,
    venta: {
      ...reference.venta, tipo_comprobante:'FA', prefijo:POINT, numero:number,
      fecha_operacion:FISCAL_DATE, fecha_vencimiento:PERIOD,
      remitos_facturados:'REMITOS: Prefijo: 2 Números: 31233,31360  //  Prefijo: 3 Números: 25956,25999',
      cae:null, fecha_vencimiento_cae:null, mcampo_control:null, tipo_facturacion:2, numero_ci:null
    },
    items:[
      {orden:1,cod_item:8,denominacion:'ALQUILER $10',cantidad:1,precio:100,importe:100,tasa_iva:21,litros_abonados:null},
      {orden:2,cod_item:1,denominacion:'CONTENIDO X 20L',cantidad:quantity,precio:7000,importe:quantity*7000,tasa_iva:21,litros_abonados:null}
    ]
  }
}
function insertInvoice(sql, {number,cae,caeFchVto,invoice}) {
  const quantity=Number(invoice.items[1].cantidad)
  const total=quantity*7000+100
  return sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante='FA' AND prefijo=${POINT} AND numero=${number})
  THROW 54600, 'La FA/7 autorizada ya existe en NAVIERA.', 1;
IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante_cobro='FA' AND prefijo_recibo=${POINT} AND numero_recibo=${number})
  THROW 54601, 'El numero FA/7 autorizado ya esta usado por un Cobro.', 1;
IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE cod_cliente=${CLIENT} AND nro_lugar_entrega=1 AND tipo_comprobante IN ('FA','FB') AND CONVERT(date,fecha_vencimiento)='${PERIOD}')
  THROW 54602, 'Ya existe una factura activa de agosto para cliente 247/1.', 1;
INSERT INTO dbo.Ventas
(tipo_comprobante,prefijo,numero,fecha_operacion,cod_cliente,nro_lugar_entrega,fecha_vencimiento,remitos_facturados,Mcampo_control,cae,fecha_vencimiento_cae,tipo_facturacion,numero_ci,saca_v)
VALUES
('FA',${POINT},${number},'${FISCAL_DATE}',${CLIENT},1,'${PERIOD}','${sqlString(invoice.venta.remitos_facturados)}',NULL,'${sqlString(cae)}','${sqlString(caeFchVto)}',2,NULL,NULL);
INSERT INTO dbo.VentasItems (tipo_comprobante,prefijo,numero,orden,cod_item,cantidad,precio,importe,tasa_iva,litros_abonados)
VALUES ('FA',${POINT},${number},1,8,1,100,100,21,NULL),
       ('FA',${POINT},${number},2,1,${quantity},7000,${quantity*7000},21,NULL);
COMMIT TRANSACTION;
SELECT 'FA' AS tipo_comprobante,${POINT} AS prefijo,${number} AS numero,'${sqlString(cae)}' AS cae,'${sqlString(caeFchVto)}' AS fecha_vencimiento_cae,${total} AS total,2 AS ventas_items
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;`)
}
async function main() {
  const sql=new PythonOdbcSqlServer({database:'NAVIERA'})
  const quantity=readAugustRr(sql)
  if (quantity!==17) throw new Error(`Los RR de agosto suman ${quantity}; se esperaban 17 contenidos.`)
  const legacy=new LegacyInvoiceRepository(sql)
  const source=legacy.getInvoice(SOURCE_NOTE)
  if (!source.venta||!source.cliente||!source.categoriaIva||Number(source.venta.cod_cliente)!==CLIENT) throw new Error('No se pudo validar la NA/7-42 de cliente 247.')
  const representada=process.env.ARCA_REPRESENTADA_CUIT||'20220334857'
  const ultimo=await getUltimoComprobante({environment:'produccion',representada,ptoVta:POINT,cbteTipo:1})
  const expected=Number(ultimo.proximoComprobante)
  if (!ultimo.ok||!Number.isInteger(expected)||expected<=0) throw new Error(`ARCA no informo el proximo FA/7: ${ultimo.proximoComprobante||'-'}.`)
  assertNoCobroReceiptConflict(sql,{tipo:'FA',prefijo:POINT,numero:expected})
  const invoice=buildInvoice(source,expected,quantity)
  const provider=new ArcaApiProvider({environment:'produccion',representada,ptoVta:POINT,concepto:1,fechaHomologacion:FISCAL_DATE,legacyPriceMode:'gross'})
  const preview=provider.buildAuthorizationPreview(invoice)
  if (Math.abs(Number(preview.totals.grossTotalDelta||0))>.05) throw new Error(`El total ARCA no cierra: ${preview.totals.grossTotalDelta}.`)
  if(!EMIT){console.log(JSON.stringify({mode:'preview',expected:`FA/7-${expected}`,contenidos:quantity,alquiler:100,total:quantity*7000+100,fecha_fiscal:FISCAL_DATE,fecha_vencimiento:PERIOD,remitos:invoice.venta.remitos_facturados},null,2));return}
  const response=await postFactura({payload:preview.payload,idempotencyKey:'PROD-CC-247-202608-RR-P7-REISSUE-1'})
  const approval=approvalFrom(response)
  if(approval.result!=='A'||approval.cbteNro!==expected||approval.ptoVta!==POINT||approval.cbteTipo!==1||!approval.cae||!approval.caeFchVto) throw new Error(`ARCA no aprobo FA/7-${expected}: ${JSON.stringify(response.response)}`)
  const saved=insertInvoice(sql,{number:approval.cbteNro,cae:approval.cae,caeFchVto:normalizeCaeDate(approval.caeFchVto),invoice})
  console.log(JSON.stringify({status:'ok',saved,observaciones:approval.observaciones,errores:approval.errores},null,2))
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
