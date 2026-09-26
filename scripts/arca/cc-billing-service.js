const { ArcaApiProvider } = require('./arca-api-provider')
const { postFactura } = require('./arca-api-read-only-client')
const { PendingFiscalPreflight } = require('./pending-fiscal-preflight')

const CENT_TOLERANCE = 0.05
const LOW_CONSUMPTION_MINIMUM = 5
// These accounts use special billing rules and must never be calculated from RR totals.
const EXCLUDED_CC_CUSTOMERS = [104, 1130]

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function assertIsoDate(value, name) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${name} debe usar formato YYYY-MM-DD.`)
  }
  return raw
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || 250), 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('El limite debe estar entre 1 y 1000.')
  }
  return parsed
}

function periodFromDate(value) {
  const raw = String(value || '').trim()
  const normalized = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : assertIsoDate(raw, 'Periodo')
  const date = new Date(`${normalized}T00:00:00Z`)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const first = new Date(Date.UTC(year, month, 1))
  const next = new Date(Date.UTC(year, month + 1, 1))
  return {
    yyyymm: `${year}${String(month + 1).padStart(2, '0')}`,
    firstDate: first.toISOString().slice(0, 10),
    nextDate: next.toISOString().slice(0, 10)
  }
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor
}

function classify(tipofactura) {
  const normalized = String(tipofactura || '').trim().toUpperCase()
  if (normalized === 'A') return { tipo: 'FA', cbteTipo: 1 }
  if (normalized === 'B') return { tipo: 'FB', cbteTipo: 6 }
  return { tipo: null, cbteTipo: null }
}

function buildIdempotencyKey({ period, codCliente, nroLugarEntrega, tipo }) {
  return ['PROD', 'CC', period.yyyymm, Number(codCliente), Number(nroLugarEntrega), tipo].join('-')
}

function excludedCustomersSql() {
  return EXCLUDED_CC_CUSTOMERS.map(Number).join(', ')
}

class CuentaCorrienteRepository {
  constructor(sql) {
    this.sql = sql
  }

  getPreviewCandidates({ periodo, limit = 250 }) {
    const range = periodFromDate(periodo)
    const maxRows = parseLimit(limit)
    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(range.firstDate)}';
DECLARE @hasta date = '${sqlString(range.nextDate)}';

WITH puntos_elegibles AS (
  SELECT
    c.cod_cliente,
    le.nro_lugar_entrega,
    CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
    CASE WHEN CAST(c.tipo_fact_ctacte AS int) = 1
      THEN MIN(le.nro_lugar_entrega) OVER (PARTITION BY c.cod_cliente)
      ELSE le.nro_lugar_entrega END AS punto_facturacion
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = c.cod_cliente
  WHERE c.tipo_cliente = 2
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
    AND c.cod_cliente NOT IN (${excludedCustomersSql()})
), rr AS (
  SELECT
    m.cod_cliente,
    pe.punto_facturacion AS nro_lugar_entrega,
    COUNT(DISTINCT m.nro_lugar_entrega) AS puntos_origen,
    COUNT(DISTINCT CONCAT(m.prefijo_remito, '|', m.numero_remito)) AS remitos,
    SUM(CASE WHEN mi.cod_item = 1 THEN COALESCE(mi.cantidad, 0) ELSE 0 END) AS contenidos_20,
    SUM(CASE WHEN mi.cod_item = 2 THEN COALESCE(mi.cantidad, 0) ELSE 0 END) AS contenidos_10
  FROM dbo.MovFisicos AS m
  INNER JOIN dbo.MovFisicosItems AS mi
    ON mi.tipo_comprobante = m.tipo_comprobante
   AND mi.prefijo_remito = m.prefijo_remito
   AND mi.numero_remito = m.numero_remito
  INNER JOIN puntos_elegibles AS pe
    ON pe.cod_cliente = m.cod_cliente
   AND pe.nro_lugar_entrega = m.nro_lugar_entrega
  WHERE LTRIM(RTRIM(m.tipo_comprobante)) = 'RR'
    AND CONVERT(date, m.fecha_remito) >= @desde
    AND CONVERT(date, m.fecha_remito) < @hasta
  GROUP BY m.cod_cliente, pe.punto_facturacion
),
latest_content AS (
  SELECT
    v.cod_cliente,
    pe.punto_facturacion AS nro_lugar_entrega,
    vi.cod_item,
    CAST(vi.precio AS decimal(18, 2)) AS precio,
    CAST(vi.tasa_iva AS decimal(18, 2)) AS tasa_iva,
    ROW_NUMBER() OVER (
      PARTITION BY v.cod_cliente, pe.punto_facturacion, vi.cod_item
      ORDER BY v.fecha_vencimiento DESC, v.fecha_operacion DESC, v.numero DESC
    ) AS orden
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  INNER JOIN puntos_elegibles AS pe
    ON pe.cod_cliente = v.cod_cliente
   AND pe.nro_lugar_entrega = v.nro_lugar_entrega
  WHERE LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
    AND vi.cod_item IN (1, 2)
    AND COALESCE(vi.precio, 0) > 0
    AND COALESCE(v.Mcampo_control, '') <> 'N'
),
existing AS (
  SELECT v.cod_cliente, pe.punto_facturacion AS nro_lugar_entrega, COUNT_BIG(*) AS facturas
  FROM dbo.Ventas AS v
  INNER JOIN puntos_elegibles AS pe
    ON pe.cod_cliente = v.cod_cliente
   AND pe.nro_lugar_entrega = v.nro_lugar_entrega
  WHERE LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
    AND CONVERT(date, v.fecha_vencimiento) = @desde
    AND COALESCE(v.Mcampo_control, '') <> 'N'
  GROUP BY v.cod_cliente, pe.punto_facturacion
)
SELECT TOP (${maxRows})
  CAST(c.cod_cliente AS int) AS cod_cliente,
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
  CAST(c.estado AS int) AS cliente_estado,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
  NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
  CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS lugar_fecha_fin_contrato,
  CAST(rr.remitos AS int) AS remitos,
  CAST(rr.puntos_origen AS int) AS puntos_origen,
  CAST(rr.contenidos_20 AS decimal(18, 2)) AS contenidos_20,
  CAST(rr.contenidos_10 AS decimal(18, 2)) AS contenidos_10,
  COALESCE(p20.precio, 0) AS precio_20,
  COALESCE(p10.precio, 0) AS precio_10,
  COALESCE(rental.alquileres, 0) AS alquileres,
  COALESCE(rental.total_alquileres, 0) AS total_alquileres,
  COALESCE(existing.facturas, 0) AS facturas_existentes
FROM rr
INNER JOIN dbo.Cliente AS c ON c.cod_cliente = rr.cod_cliente
INNER JOIN puntos_elegibles AS pe
  ON pe.cod_cliente = rr.cod_cliente
 AND pe.nro_lugar_entrega = rr.nro_lugar_entrega
INNER JOIN dbo.LugarEntrega AS le
  ON le.cod_cliente = pe.cod_cliente
 AND le.nro_lugar_entrega = pe.nro_lugar_entrega
LEFT JOIN dbo.CategoriaIva AS ci ON ci.cod_categoria = c.cod_categoria
LEFT JOIN latest_content AS p20
  ON p20.cod_cliente = c.cod_cliente AND p20.nro_lugar_entrega = le.nro_lugar_entrega AND p20.cod_item = 1 AND p20.orden = 1
LEFT JOIN latest_content AS p10
  ON p10.cod_cliente = c.cod_cliente AND p10.nro_lugar_entrega = le.nro_lugar_entrega AND p10.cod_item = 2 AND p10.orden = 1
OUTER APPLY (
  SELECT
    COUNT_BIG(*) AS alquileres,
    SUM(COALESCE(i.precio, 0)) AS total_alquileres
  FROM dbo.Dispenser AS d
  INNER JOIN puntos_elegibles AS alquiler_punto
    ON alquiler_punto.cod_cliente = d.cod_cliente
   AND alquiler_punto.nro_lugar_entrega = d.nro_lugar_entrega
  INNER JOIN dbo.Item AS i ON i.cod_item = d.cod_abono_o_alquiler
  WHERE alquiler_punto.cod_cliente = rr.cod_cliente
    AND alquiler_punto.punto_facturacion = rr.nro_lugar_entrega
    AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
    AND d.cod_abono_o_alquiler IS NOT NULL
) AS rental
LEFT JOIN existing
  ON existing.cod_cliente = c.cod_cliente
 AND existing.nro_lugar_entrega = le.nro_lugar_entrega
WHERE COALESCE(rr.contenidos_20, 0) > 0 OR COALESCE(rr.contenidos_10, 0) > 0
ORDER BY
  CASE WHEN COALESCE(rr.contenidos_20, 0) + COALESCE(rr.contenidos_10, 0) < ${LOW_CONSUMPTION_MINIMUM} THEN 0 ELSE 1 END,
  c.cod_cliente,
  le.nro_lugar_entrega
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getCandidate({ codCliente, nroLugarEntrega, periodo }) {
    const client = Number(codCliente)
    const point = Number(nroLugarEntrega)
    const range = periodFromDate(periodo)
    if (!Number.isInteger(client) || !Number.isInteger(point)) {
      throw new Error('Cliente/punto invalido para cuenta corriente.')
    }
    if (EXCLUDED_CC_CUSTOMERS.includes(client)) {
      throw new Error(`El cliente ${client} esta excluido temporalmente de la facturacion automatica de cuenta corriente.`)
    }

    const header = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(c.cod_cliente AS int) AS cod_cliente,
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
  CAST(c.cuit AS varchar(20)) AS cuit,
  CAST(c.estado AS int) AS cliente_estado,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
  CASE WHEN CAST(c.tipo_fact_ctacte AS int) = 1 THEN (
    SELECT MIN(le2.nro_lugar_entrega)
    FROM dbo.LugarEntrega AS le2
    WHERE le2.cod_cliente = c.cod_cliente AND le2.fecha_fin_contrato IS NULL
  ) ELSE le.nro_lugar_entrega END AS punto_facturacion,
  NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(ci.categoria)), '') AS categoria_iva,
  NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
  CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS lugar_fecha_fin_contrato,
  NULLIF(LTRIM(RTRIM(le.email)), '') AS email
FROM dbo.Cliente AS c
INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = c.cod_cliente
LEFT JOIN dbo.CategoriaIva AS ci ON ci.cod_categoria = c.cod_categoria
WHERE c.cod_cliente = ${client} AND le.nro_lugar_entrega = ${point}
  AND c.tipo_cliente = 2 AND c.estado = 0 AND le.fecha_fin_contrato IS NULL
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
    if (!header) throw new Error('Cliente/punto no encontrado.')
    if (Number(header.punto_facturacion) !== point) {
      throw new Error('El punto no es la cabecera fiscal de esta cuenta corriente.')
    }
    const sharedBilling = Number(header.tipo_fact_ctacte) === 1
    const sourceCondition = sharedBilling
      ? `m.cod_cliente = ${client}`
      : `m.cod_cliente = ${client} AND m.nro_lugar_entrega = ${point}`
    const dispenserCondition = sharedBilling
      ? `d.cod_cliente = ${client}`
      : `d.cod_cliente = ${client} AND d.nro_lugar_entrega = ${point}`
    const invoiceCondition = sharedBilling
      ? `v.cod_cliente = ${client}`
      : `v.cod_cliente = ${client} AND v.nro_lugar_entrega = ${point}`

    const remitos = this.sql.queryJson(
      forJson(`
SELECT
  CAST(m.prefijo_remito AS int) AS prefijo,
  CAST(m.numero_remito AS int) AS numero,
  CAST(SUM(CASE WHEN mi.cod_item = 1 THEN COALESCE(mi.cantidad, 0) ELSE 0 END) AS decimal(18, 2)) AS contenidos_20,
  CAST(SUM(CASE WHEN mi.cod_item = 2 THEN COALESCE(mi.cantidad, 0) ELSE 0 END) AS decimal(18, 2)) AS contenidos_10
FROM dbo.MovFisicos AS m
INNER JOIN dbo.MovFisicosItems AS mi
  ON mi.tipo_comprobante = m.tipo_comprobante
 AND mi.prefijo_remito = m.prefijo_remito
 AND mi.numero_remito = m.numero_remito
INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = m.cod_cliente AND le.nro_lugar_entrega = m.nro_lugar_entrega
WHERE ${sourceCondition}
  AND le.fecha_fin_contrato IS NULL
  AND LTRIM(RTRIM(m.tipo_comprobante)) = 'RR'
  AND CONVERT(date, m.fecha_remito) >= '${range.firstDate}'
  AND CONVERT(date, m.fecha_remito) < '${range.nextDate}'
GROUP BY m.prefijo_remito, m.numero_remito
HAVING SUM(CASE WHEN mi.cod_item IN (1, 2) THEN COALESCE(mi.cantidad, 0) ELSE 0 END) > 0
ORDER BY m.prefijo_remito, m.numero_remito
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const rentalItems = this.sql.queryJson(
      forJson(`
SELECT
  CAST(d.cod_abono_o_alquiler AS int) AS cod_item,
  NULLIF(LTRIM(RTRIM(i.denominacion)), '') AS denominacion,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS denom_corto,
  CAST(COUNT_BIG(*) AS int) AS cantidad,
  CAST(i.precio AS decimal(18, 2)) AS precio,
  CAST(i.tasa_iva AS decimal(18, 2)) AS tasa_iva
FROM dbo.Dispenser AS d
INNER JOIN dbo.Item AS i ON i.cod_item = d.cod_abono_o_alquiler
INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = d.cod_cliente AND le.nro_lugar_entrega = d.nro_lugar_entrega
WHERE ${dispenserCondition} AND le.fecha_fin_contrato IS NULL
  AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
  AND d.cod_abono_o_alquiler IS NOT NULL
GROUP BY d.cod_abono_o_alquiler, i.denominacion, i.denom_corto, i.precio, i.tasa_iva
ORDER BY d.cod_abono_o_alquiler
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const lastContentPrices = this.sql.queryJson(
      forJson(`
WITH prices AS (
  SELECT
    CAST(vi.cod_item AS int) AS cod_item,
    CAST(vi.precio AS decimal(18, 2)) AS precio,
    CAST(vi.tasa_iva AS decimal(18, 2)) AS tasa_iva,
    ROW_NUMBER() OVER (PARTITION BY vi.cod_item ORDER BY v.fecha_vencimiento DESC, v.fecha_operacion DESC, v.numero DESC) AS orden
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante AND vi.prefijo = v.prefijo AND vi.numero = v.numero
  INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = v.cod_cliente AND le.nro_lugar_entrega = v.nro_lugar_entrega
  WHERE ${invoiceCondition} AND le.fecha_fin_contrato IS NULL
    AND LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA','FB')
    AND vi.cod_item IN (1,2) AND COALESCE(vi.precio, 0) > 0
    AND COALESCE(v.Mcampo_control, '') <> 'N'
)
SELECT cod_item, precio, tasa_iva FROM prices WHERE orden = 1
ORDER BY cod_item
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const existing = this.sql.queryJson(
      forJson(`
SELECT LTRIM(RTRIM(tipo_comprobante)) AS tipo_comprobante, CAST(prefijo AS int) AS prefijo, CAST(numero AS int) AS numero,
       NULLIF(LTRIM(RTRIM(cae)), '') AS cae
FROM dbo.Ventas AS v
WHERE ${invoiceCondition}
  AND LTRIM(RTRIM(tipo_comprobante)) IN ('FA','FB')
  AND CONVERT(date, fecha_vencimiento) = '${range.firstDate}'
  AND COALESCE(Mcampo_control, '') <> 'N'
ORDER BY tipo_comprobante, prefijo, numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    return { period: range, header, remitos, rentalItems, lastContentPrices, existing }
  }

  insertAuthorizedInvoice({ bill, approval }) {
    const tipo = String(bill.tipoComprobante || '').trim().toUpperCase()
    const prefijo = Number(approval.ptoVta)
    const numero = Number(approval.cbteNro)
    const cae = String(approval.cae || '').trim()
    const caeFchVto = String(approval.caeFchVto || '').trim()
    if (!['FA', 'FB'].includes(tipo) || prefijo !== 7 || !Number.isInteger(numero) || !cae || !caeFchVto) {
      throw new Error('Aprobacion ARCA invalida para cuenta corriente.')
    }
    const itemValues = bill.items.map(item => `(
      '${tipo}', ${prefijo}, ${numero}, ${Number(item.orden)}, ${Number(item.codItem)},
      ${Number(item.cantidad)}, ${Number(item.precioBruto)}, ${Number(item.importeBruto)},
      ${Number(item.tasaIva)}, NULL
    )`).join(',\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante='${tipo}' AND prefijo=${prefijo} AND numero=${numero})
  THROW 54800, 'La factura autorizada ya existe en NAVIERA.', 1;
IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK,HOLDLOCK) WHERE tipo_comprobante_cobro='${tipo}' AND prefijo_recibo=${prefijo} AND numero_recibo=${numero})
  THROW 54801, 'El numero fiscal autorizado ya esta usado por un Cobro.', 1;
IF EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (UPDLOCK,HOLDLOCK)
  WHERE cod_cliente=${Number(bill.codCliente)}
    AND (${bill.facturacionCompartida ? '1=1' : `nro_lugar_entrega=${Number(bill.nroLugarEntrega)}`})
    AND LTRIM(RTRIM(tipo_comprobante)) IN ('FA','FB')
    AND CONVERT(date,fecha_vencimiento)='${sqlString(bill.fechaVencimiento)}'
    AND COALESCE(Mcampo_control,'') <> 'N'
)
  THROW 54802, 'Ya existe una factura activa para el periodo.', 1;

INSERT INTO dbo.Ventas
(tipo_comprobante,prefijo,numero,fecha_operacion,cod_cliente,nro_lugar_entrega,fecha_vencimiento,remitos_facturados,Mcampo_control,cae,fecha_vencimiento_cae,tipo_facturacion,numero_ci,saca_v)
VALUES
('${tipo}',${prefijo},${numero},'${sqlString(bill.fechaEmision)}',${Number(bill.codCliente)},${Number(bill.nroLugarEntrega)},'${sqlString(bill.fechaVencimiento)}','${sqlString(bill.remitosFacturados)}',NULL,'${sqlString(cae)}','${sqlString(caeFchVto)}',${Number(bill.tipoFacturacion)},NULL,NULL);

INSERT INTO dbo.VentasItems
(tipo_comprobante,prefijo,numero,orden,cod_item,cantidad,precio,importe,tasa_iva,litros_abonados)
VALUES ${itemValues};
COMMIT TRANSACTION;
SELECT '${tipo}' AS tipo_comprobante,${prefijo} AS prefijo,${numero} AS numero,'${sqlString(cae)}' AS cae,'${sqlString(caeFchVto)}' AS fecha_vencimiento_cae
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }
}

class CuentaCorrienteAuthorizationService {
  constructor({ repository, provider, arcaPostFactura = postFactura }) {
    this.repository = repository
    this.provider = provider
    this.arcaPostFactura = arcaPostFactura
  }

  buildPreflight() {
    return new PendingFiscalPreflight({
      sql: this.repository.sql,
      representada: this.provider.representada,
      ptoVta: 7,
      ptoVtas: [7],
      concepto: 1,
      arcaPostFactura: this.arcaPostFactura
    })
  }

  buildPreview({ periodo, fechaEmision, limit = 250 }) {
    const range = periodFromDate(periodo)
    const emissionDate = assertIsoDate(fechaEmision, 'Fecha de emision')
    const rows = this.repository.getPreviewCandidates({ periodo: range.firstDate, limit })
    const candidates = rows.map(row => this.toPreviewCandidate(row, range))
    const ready = candidates.filter(candidate => candidate.estado === 'listo')
    const lowConsumption = candidates.filter(candidate => candidate.consumoBajo)
    const totals = ready.reduce((acc, candidate) => {
      if (candidate.tipo === 'FA') acc.fa += candidate.total
      if (candidate.tipo === 'FB') acc.fb += candidate.total
      return acc
    }, { fa: 0, fb: 0 })
    return {
      modo: 'PREVIEW',
      period: range.firstDate,
      fechaEmision: emissionDate,
      minimoConsumo: LOW_CONSUMPTION_MINIMUM,
      resumen: {
        total: candidates.length,
        listos: ready.length,
        consumo_bajo: lowConsumption.length,
        revisar: candidates.length - ready.length,
        FA: { count: ready.filter(candidate => candidate.tipo === 'FA').length, total: round(totals.fa) },
        FB: { count: ready.filter(candidate => candidate.tipo === 'FB').length, total: round(totals.fb) }
      },
      candidatos: candidates
    }
  }

  toPreviewCandidate(row, period) {
    const consumption20 = Number(row.contenidos_20 || 0)
    const consumption10 = Number(row.contenidos_10 || 0)
    const totalConsumption = consumption20 + consumption10
    const fiscal = classify(row.tipofactura)
    const warnings = []
    if (totalConsumption < LOW_CONSUMPTION_MINIMUM) warnings.push(`Consumo bajo: ${totalConsumption} contenido(s); minimo ${LOW_CONSUMPTION_MINIMUM}.`)
    if (consumption20 > 0 && Number(row.precio_20 || 0) <= 0) warnings.push('Sin precio historico para contenido x20.')
    if (consumption10 > 0 && Number(row.precio_10 || 0) <= 0) warnings.push('Sin precio historico para contenido x10.')
    if (!fiscal.tipo) warnings.push('Categoria IVA sin factura electronica A/B.')
    if (Number(row.facturas_existentes || 0) > 0) warnings.push('Ya existe una factura activa para el periodo.')
    const total = round(
      consumption20 * Number(row.precio_20 || 0) +
      consumption10 * Number(row.precio_10 || 0) +
      Number(row.total_alquileres || 0)
    )
    if (total <= 0) warnings.push('Total a facturar no positivo.')
    const estado = warnings.some(warning => !warning.startsWith('Consumo bajo:')) ? 'revisar' : 'listo'
    return {
      cliente: Number(row.cod_cliente), punto: Number(row.nro_lugar_entrega), razon_social: row.razon_social,
      facturacionCompartida: Number(row.tipo_fact_ctacte) === 1,
      puntosOrigen: Number(row.puntos_origen || 1),
      tipo: fiscal.tipo || 'REVISAR', prefijo: fiscal.tipo ? 7 : null, periodo: period.yyyymm,
      remitos: Number(row.remitos || 0), contenidos20: consumption20, contenidos10: consumption10,
      consumoTotal: totalConsumption, consumoBajo: totalConsumption < LOW_CONSUMPTION_MINIMUM,
      alquileres: Number(row.alquileres || 0), total, estado, warnings,
      idempotencyKey: fiscal.tipo ? buildIdempotencyKey({ period, codCliente: row.cod_cliente, nroLugarEntrega: row.nro_lugar_entrega, tipo: fiscal.tipo }) : null
    }
  }

  buildBill({ codCliente, nroLugarEntrega, periodo, fechaEmision }) {
    const emissionDate = assertIsoDate(fechaEmision, 'Fecha de emision')
    const record = this.repository.getCandidate({ codCliente, nroLugarEntrega, periodo })
    const { header, remitos, rentalItems, lastContentPrices, existing } = record
    const fiscal = classify(header.tipofactura)
    if (Number(header.cliente_estado) !== 0 || header.lugar_fecha_fin_contrato !== null || Number(header.tipo_cliente) !== 2) {
      throw new Error('El cliente/punto ya no es una cuenta corriente activa.')
    }
    if (!fiscal.tipo) throw new Error('Categoria IVA sin clasificacion electronica A/B.')
    if (existing.length) throw new Error(`Ya existe una factura activa para ${Number(header.tipo_fact_ctacte) === 1 ? 'cliente/periodo' : 'cliente/punto/periodo'}.`)
    const priceByItem = new Map(lastContentPrices.map(row => [Number(row.cod_item), row]))
    const contents20 = round(remitos.reduce((sum, row) => sum + Number(row.contenidos_20 || 0), 0))
    const contents10 = round(remitos.reduce((sum, row) => sum + Number(row.contenidos_10 || 0), 0))
    const contentItems = []
    if (contents20 > 0) contentItems.push({ codItem: 1, cantidad: contents20, price: priceByItem.get(1) })
    if (contents10 > 0) contentItems.push({ codItem: 2, cantidad: contents10, price: priceByItem.get(2) })
    if (contentItems.some(item => !item.price || Number(item.price.precio) <= 0)) {
      throw new Error('Falta precio historico de contenido; revisar manualmente antes de facturar.')
    }
    const items = [
      ...rentalItems.map(item => ({
        codItem: Number(item.cod_item), cantidad: Number(item.cantidad), precioBruto: Number(item.precio),
        tasaIva: Number(item.tasa_iva), descripcion: item.denominacion || item.denom_corto || `Alquiler ${item.cod_item}`
      })),
      ...contentItems.map(item => ({
        codItem: item.codItem, cantidad: item.cantidad, precioBruto: Number(item.price.precio),
        tasaIva: Number(item.price.tasa_iva), descripcion: item.codItem === 1 ? 'CONTENIDO X 20L' : 'CONTENIDO X 10L'
      }))
    ].filter(item => item.cantidad > 0).map((item, index) => ({
      ...item, orden: index + 1, importeBruto: round(item.cantidad * item.precioBruto)
    }))
    const total = round(items.reduce((sum, item) => sum + item.importeBruto, 0))
    if (total <= 0) throw new Error('Total a facturar no positivo.')
    const remitosByPrefix = new Map()
    remitos.forEach(row => {
      const prefix = Number(row.prefijo)
      const numbers = remitosByPrefix.get(prefix) || []
      numbers.push(Number(row.numero))
      remitosByPrefix.set(prefix, numbers)
    })
    const remitosFacturados = `REMITOS: ${[...remitosByPrefix.entries()]
      .sort(([a], [b]) => a - b)
      .map(([prefix, numbers]) => `Prefijo: ${prefix} Números: ${numbers.join(',')}`).join('  //  ')}`
    const invoiceRecord = {
      venta: {
        tipo_comprobante: fiscal.tipo, prefijo: 7, numero: null,
        fecha_operacion: `${emissionDate}T00:00:00`, fecha_vencimiento: `${record.period.firstDate}T00:00:00`,
        cod_cliente: header.cod_cliente, nro_lugar_entrega: header.nro_lugar_entrega,
        tipo_facturacion: header.tipo_fact_ctacte, cae: null, cod_categoria: header.cod_categoria
      },
      cliente: { cod_cliente: header.cod_cliente, razon_social: header.razon_social, cuit: header.cuit, cod_categoria: header.cod_categoria },
      categoriaIva: { cod_categoria: header.cod_categoria, categoria: header.categoria_iva, tipofactura: header.tipofactura },
      lugarEntrega: { email: header.email },
      items: items.map(item => ({ orden:item.orden,cod_item:item.codItem,cantidad:item.cantidad,precio:item.precioBruto,importe:item.importeBruto,tasa_iva:item.tasaIva,denominacion:item.descripcion }))
    }
    const authorizationPreview = this.provider.buildAuthorizationPreview(invoiceRecord)
    authorizationPreview.payload.concepto = 1
    authorizationPreview.payload.cbteFch = emissionDate.replace(/-/g, '')
    if (Math.abs(Number(authorizationPreview.totals.grossTotalDelta || 0)) > CENT_TOLERANCE) {
      throw new Error(`El total ARCA no cierra: ${authorizationPreview.totals.grossTotalDelta}.`)
    }
    return {
      header, record, total, invoiceRecord, authorizationPreview,
      bill: {
        tipoComprobante:fiscal.tipo, codCliente:Number(header.cod_cliente), nroLugarEntrega:Number(header.nro_lugar_entrega),
        tipoFacturacion:Number(header.tipo_fact_ctacte), fechaEmision:emissionDate, fechaVencimiento:record.period.firstDate,
        facturacionCompartida:Number(header.tipo_fact_ctacte) === 1,
        remitosFacturados, items,
        idempotencyKey:buildIdempotencyKey({period:record.period,codCliente:header.cod_cliente,nroLugarEntrega:header.nro_lugar_entrega,tipo:fiscal.tipo})
      }
    }
  }

  async processBatch({ periodo, fechaEmision, selectedCandidates }) {
    const selection = Array.isArray(selectedCandidates) ? selectedCandidates : []
    if (!selection.length) throw new Error('Seleccione al menos una cuenta corriente.')
    const preflight = await this.buildPreflight().processBefore({ targetDate: fechaEmision })
    const results = []
    const stopped = new Set()
    for (const selected of selection) {
      let billPreview = null
      try {
        billPreview = this.buildBill({ ...selected, periodo, fechaEmision })
        const series = `${billPreview.bill.tipoComprobante}/7`
        if (stopped.has(series)) throw new Error(`Serie ${series} detenida por un fallo previo.`)
        const expected = await this.buildPreflight().assertNextFiscalIdentityIsAvailable({ tipo:billPreview.bill.tipoComprobante, prefijo:7 })
        const response = await this.arcaPostFactura({ payload:billPreview.authorizationPreview.payload, idempotencyKey:billPreview.bill.idempotencyKey })
        const body = response?.response || {}
        const approval = {
          resultado:body.resultado || body.result,
          cbteNro:Number(body.cbteNro ?? body.cbte_nro ?? body.numero), cae:body.cae || body.CAE,
          caeFchVto:body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae,
          ptoVta:Number(body.ptoVta ?? body.pto_vta), cbteTipo:Number(body.cbteTipo ?? body.cbte_tipo),
          observaciones:body.observaciones || [], errores:body.errores || []
        }
        const expectedCbteTipo = billPreview.bill.tipoComprobante === 'FA' ? 1 : 6
        if (approval.resultado !== 'A' || approval.cbteNro !== expected.proximoComprobante || approval.ptoVta !== 7 || approval.cbteTipo !== expectedCbteTipo || !approval.cae || !approval.caeFchVto) {
          throw new Error(`ARCA no aprobo ${series}-${expected.proximoComprobante}: ${JSON.stringify(body)}`)
        }
        const insert = this.repository.insertAuthorizedInvoice({ bill:billPreview.bill, approval })
        results.push({ ok:true,cod_cliente:billPreview.bill.codCliente,nro_lugar_entrega:billPreview.bill.nroLugarEntrega,tipo:billPreview.bill.tipoComprobante,prefijo:7,numero:approval.cbteNro,cae:approval.cae,caeFchVto:approval.caeFchVto,total:billPreview.total,observaciones:approval.observaciones,errores:approval.errores,insert })
      } catch (error) {
        const tipo = billPreview?.bill?.tipoComprobante || null
        if (tipo) stopped.add(`${tipo}/7`)
        results.push({ ok:false,cod_cliente:Number(selected.codCliente),nro_lugar_entrega:Number(selected.nroLugarEntrega),tipo,error:error instanceof Error ? error.message : String(error) })
      }
    }
    return {
      results,
      summary:{
        OK:results.filter(row=>row.ok).length,
        fallidas:results.filter(row=>!row.ok).length,
        FA_OK:results.filter(row=>row.ok&&row.tipo==='FA').length,
        FB_OK:results.filter(row=>row.ok&&row.tipo==='FB').length,
        total:round(results.filter(row=>row.ok).reduce((sum,row)=>sum+Number(row.total||0),0)),
        preflight
      }
    }
  }
}

module.exports = { CuentaCorrienteRepository, CuentaCorrienteAuthorizationService, LOW_CONSUMPTION_MINIMUM, EXCLUDED_CC_CUSTOMERS, periodFromDate }
