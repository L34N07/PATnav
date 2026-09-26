const { ArcaApiProvider } = require('./arca-api-provider')
const { postFactura, postCreditNote } = require('./arca-api-read-only-client')
const { PendingFiscalPreflight } = require('./pending-fiscal-preflight')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function quoteIdentifier(value) {
  return `[${String(value ?? '').replace(/]/g, ']]')}]`
}

function sqlDate(value, name = 'date') {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${name} must use YYYY-MM-DD format.`)
  }
  return raw
}

function intValue(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer.`)
  }
  return parsed
}

function positiveInt(value, name) {
  const parsed = intValue(value, name)
  if (parsed <= 0) {
    throw new Error(`${name} must be greater than zero.`)
  }
  return parsed
}

function numberValue(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be numeric.`)
  }
  return parsed
}

function money(value, name) {
  return Math.round(numberValue(value, name) * 100) / 100
}

const ALLOWED_MOVIMIENTO_ITEM_IDS = new Set([1, 2, 5, 6])
const ALLOWED_VENTA_ITEM_IDS = new Set([1, 2])

function assertAllowedItem(codItem, name) {
  if (!ALLOWED_MOVIMIENTO_ITEM_IDS.has(Number(codItem))) {
    throw new Error(`${name} must be one of: 1, 2, 5, 6.`)
  }
}

function assertAllowedVentaItem(codItem, name) {
  if (!ALLOWED_VENTA_ITEM_IDS.has(Number(codItem))) {
    throw new Error(`${name} must be content item 1 or 2. Empty containers are movement-only.`)
  }
}

function todayIsoDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

function normalizeTipo(value, allowed, name = 'tipo') {
  const tipo = String(value || '').trim().toUpperCase()
  if (!allowed.includes(tipo)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`)
  }
  return tipo
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function compact(text) {
  return String(text || '').trim().replace(/\s+/g, ' ')
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

function isoToYyyymmdd(value) {
  return sqlDate(value, 'date').replace(/-/g, '')
}

function monthRangeFromDate(value) {
  const iso = sqlDate(String(value || '').slice(0, 10), 'fecha_vencimiento')
  const [year, month] = iso.split('-').map(Number)
  return {
    firstDate: `${year}-${String(month).padStart(2, '0')}-01`,
    lastDate: `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
  }
}

const CREDIT_NOTE_BY_INVOICE_TYPE = {
  FA: { tipoComprobante: 'NA', cbteTipo: 3 },
  FB: { tipoComprobante: 'NB', cbteTipo: 8 }
}

function normalizeVentaItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('At least one item is required.')
  }

  return items
    .map((item, index) => {
      const cantidad = numberValue(item.cantidad, `items[${index}].cantidad`)
      const precio = money(item.precio, `items[${index}].precio`)
      const codItem = positiveInt(item.codItem ?? item.cod_item, `items[${index}].codItem`)
      assertAllowedItem(codItem, `items[${index}].codItem`)
      assertAllowedVentaItem(codItem, `items[${index}].codItem`)
      if (cantidad <= 0) {
        throw new Error(`items[${index}].cantidad must be greater than zero.`)
      }
      if (precio < 0) {
        throw new Error(`items[${index}].precio cannot be negative.`)
      }

      return {
        orden: index + 1,
        cod_item: codItem,
        cantidad,
        precio,
        importe: money(cantidad * precio, `items[${index}].importe`),
        tasa_iva: numberValue(item.tasaIva ?? item.tasa_iva ?? 21, `items[${index}].tasaIva`),
        litros_abonados: numberValue(item.litrosAbonados ?? item.litros_abonados ?? 0, `items[${index}].litrosAbonados`)
      }
    })
    .filter(item => item.cantidad !== 0)
}

function normalizeMovItems(items, { requireAbono }) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('At least one movement item is required.')
  }

  const normalized = items
    .map((item, index) => {
      const codItem = positiveInt(item.codItem ?? item.cod_item, `items[${index}].codItem`)
      assertAllowedItem(codItem, `items[${index}].codItem`)
      const rawCantidad = numberValue(item.cantidad, `items[${index}].cantidad`)
      const isEmptyContainer = Boolean(item.envaseVacio || item.envase_vacio)
      const fechaPeriodo = item.fechaPeriodoAbono || item.fecha_periodo_abono || null
      if (requireAbono && !fechaPeriodo) {
        throw new Error('Movimiento requires fecha_periodo_abono for every item.')
      }
      if (fechaPeriodo) {
        sqlDate(fechaPeriodo, `items[${index}].fechaPeriodoAbono`)
      }

      return {
        nro_orden: index + 1,
        cod_item: codItem,
        cantidad: isEmptyContainer || codItem === 5 || codItem === 6 ? -Math.abs(rawCantidad) : Math.abs(rawCantidad),
        fecha_periodo_abono: fechaPeriodo || null
      }
    })
    .filter(item => item.cantidad !== 0)

  if (!normalized.length) {
    throw new Error('At least one non-zero movement item is required.')
  }
  return normalized.map((item, index) => ({ ...item, nro_orden: index + 1 }))
}

function comprobanteLabel(row) {
  return `${compact(row.tipo_comprobante)}/${Number(row.prefijo)}/${Number(row.numero)}`
}

function receiptLabel(row) {
  return `${compact(row.tipo_comprobante_cobro)}/${Number(row.prefijo_recibo)}/${Number(row.numero_recibo)}`
}

class MovimientosRepository {
  constructor(sql) {
    this.sql = sql
  }

  searchActiveLocations({ query = '', limit = 25 } = {}) {
    const maxRows = Math.min(Math.max(intValue(limit || 25, 'limit'), 1), 100)
    const term = sqlString(String(query || '').trim())

    return this.sql.queryJson(
      forJson(`
DECLARE @query varchar(120) = '${term}';

WITH locations AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    LTRIM(RTRIM(c.razon_social)) AS razon_social,
    CAST(c.estado AS int) AS cliente_estado,
    CAST(c.tipo_cliente AS int) AS tipo_cliente,
    LTRIM(RTRIM(c.cod_categoria)) AS cod_categoria,
    LTRIM(RTRIM(ci.tipofactura)) AS tipofactura,
    LTRIM(RTRIM(ci.categoria)) AS categoria_iva,
    CAST(c.cuit AS varchar(20)) AS cuit,
    CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS fecha_fin_contrato,
    LTRIM(RTRIM(COALESCE(ca.nombre, ''))) AS calle,
    CAST(le.numeropuerta AS int) AS numeropuerta,
    LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))) AS observ_domicilio,
    LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))) AS observ_domicilio_2,
    LTRIM(RTRIM(COALESCE(m.nombre, ''))) AS municipio,
    LTRIM(RTRIM(CONCAT(
      COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
      CASE WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN '' ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta)) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio))) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio]))) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN '' ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre))) END
    ))) AS direccion
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  LEFT JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  LEFT JOIN dbo.Calle AS ca
    ON ca.cod_municipio = le.cod_municipio
   AND ca.cod_calle = le.cod_calle
  LEFT JOIN dbo.Municipio AS m
    ON m.cod_municipio = le.cod_municipio
  WHERE c.estado = 0
    AND le.fecha_fin_contrato IS NULL
)
SELECT TOP (${maxRows})
  *,
  LTRIM(RTRIM(CONCAT(razon_social, ' - ', direccion))) AS label
FROM locations
WHERE @query = ''
   OR LOWER(CONCAT(
      cod_cliente, ' ', nro_lugar_entrega, ' ', razon_social, ' ', direccion, ' ',
      calle, ' ', numeropuerta, ' ', observ_domicilio, ' ', observ_domicilio_2, ' ', municipio
   )) COLLATE Latin1_General_CI_AI LIKE '%' + LOWER(@query) + '%' COLLATE Latin1_General_CI_AI
ORDER BY
  CASE
    WHEN @query NOT LIKE '%[^0-9]%' AND LEN(@query) BETWEEN 1 AND 9 AND CONVERT(int, @query) = cod_cliente THEN 0
    WHEN LOWER(razon_social) COLLATE Latin1_General_CI_AI LIKE LOWER(@query) + '%' COLLATE Latin1_General_CI_AI THEN 1
    WHEN LOWER(direccion) COLLATE Latin1_General_CI_AI LIKE LOWER(@query) + '%' COLLATE Latin1_General_CI_AI THEN 2
    ELSE 3
  END,
  razon_social,
  cod_cliente,
  nro_lugar_entrega
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getActiveLocation({ codCliente, nroLugarEntrega }) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const row = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(c.cod_cliente AS int) AS cod_cliente,
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(c.razon_social)) AS razon_social,
  CAST(c.estado AS int) AS cliente_estado,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  LTRIM(RTRIM(c.cod_categoria)) AS cod_categoria,
  LTRIM(RTRIM(ci.tipofactura)) AS tipofactura,
  LTRIM(RTRIM(ci.categoria)) AS categoria_iva,
  CAST(c.cuit AS varchar(20)) AS cuit,
  CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS fecha_fin_contrato,
  LTRIM(RTRIM(CONCAT(
    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
    CASE WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN '' ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta)) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio))) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio]))) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN '' ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre))) END
  ))) AS direccion
FROM dbo.Cliente AS c
INNER JOIN dbo.LugarEntrega AS le
  ON le.cod_cliente = c.cod_cliente
LEFT JOIN dbo.CategoriaIva AS ci
  ON ci.cod_categoria = c.cod_categoria
LEFT JOIN dbo.Calle AS ca
  ON ca.cod_municipio = le.cod_municipio
 AND ca.cod_calle = le.cod_calle
LEFT JOIN dbo.Municipio AS m
  ON m.cod_municipio = le.cod_municipio
WHERE c.cod_cliente = ${cod}
  AND le.nro_lugar_entrega = ${lugar}
  AND c.estado = 0
  AND le.fecha_fin_contrato IS NULL
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
    if (!row) {
      throw new Error('Cliente/punto inactive or not found.')
    }
    return {
      ...row,
      label: compact(`${row.razon_social || ''} - ${row.direccion || ''}`)
    }
  }

  getItems({ query = '', limit = 40 } = {}) {
    const maxRows = Math.min(Math.max(intValue(limit || 40, 'limit'), 1), 100)
    const term = sqlString(String(query || '').trim())
    return this.sql.queryJson(
      forJson(`
DECLARE @query varchar(120) = '${term}';

SELECT TOP (${maxRows})
  CAST(i.cod_item AS int) AS cod_item,
  LTRIM(RTRIM(i.denominacion)) AS denominacion,
  LTRIM(RTRIM(i.denom_corto)) AS denom_corto,
  CAST(i.precio AS decimal(18, 2)) AS precio,
  CAST(i.tasa_iva AS decimal(18, 2)) AS tasa_iva,
  CAST(COALESCE(i.litros_abonados, 0) AS decimal(18, 2)) AS litros_abonados,
  LTRIM(RTRIM(i.tipo_item)) AS tipo_item
FROM dbo.Item AS i
WHERE i.cod_item IN (1, 2, 5, 6)
  AND (
    @query = ''
   OR LOWER(CONCAT(i.cod_item, ' ', i.denominacion, ' ', i.denom_corto)) LIKE '%' + LOWER(@query) + '%'
  )
ORDER BY CASE i.cod_item WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 5 THEN 3 WHEN 6 THEN 4 ELSE 5 END
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getAccountState({ codCliente, nroLugarEntrega, limit = 20 } = {}) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const maxRows = Math.min(Math.max(intValue(limit || 20, 'limit'), 1), 100)

    const result = this.sql.queryJson(
      forJson(`
DECLARE @cod_cliente int = ${cod};
DECLARE @nro_lugar_entrega int = ${lugar};

WITH active_location AS (
  SELECT TOP (1)
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    LTRIM(RTRIM(c.razon_social)) AS razon_social,
    CAST(c.estado AS int) AS cliente_estado,
    CAST(c.tipo_cliente AS int) AS tipo_cliente,
    LTRIM(RTRIM(c.cod_categoria)) AS cod_categoria,
    LTRIM(RTRIM(ci.tipofactura)) AS tipofactura,
    LTRIM(RTRIM(ci.categoria)) AS categoria_iva,
    CAST(c.cuit AS varchar(20)) AS cuit,
    CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS fecha_fin_contrato,
    LTRIM(RTRIM(CONCAT(
      COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
      CASE WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN '' ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta)) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio))) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio]))) END,
      CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN '' ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre))) END
    ))) AS direccion
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  LEFT JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  LEFT JOIN dbo.Calle AS ca
    ON ca.cod_municipio = le.cod_municipio
   AND ca.cod_calle = le.cod_calle
  LEFT JOIN dbo.Municipio AS m
    ON m.cod_municipio = le.cod_municipio
  WHERE c.cod_cliente = @cod_cliente
    AND le.nro_lugar_entrega = @nro_lugar_entrega
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
),
venta_totals AS (
  SELECT
    v.tipo_comprobante,
    v.prefijo,
    v.numero,
    CONVERT(varchar(10), v.fecha_vencimiento, 23) AS fecha,
    SUM(COALESCE(vi.importe, 0)) AS importe,
    COALESCE(aplicado.pagado, 0) AS pagado
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  OUTER APPLY (
    SELECT SUM(COALESCE(ca.importe_aplicado, 0)) AS pagado
    FROM dbo.CobrosAplicados AS ca
    WHERE ca.tipo_comprobante = v.tipo_comprobante
      AND ca.prefijo = v.prefijo
      AND ca.numero = v.numero
  ) AS aplicado
  WHERE v.cod_cliente = @cod_cliente
    AND v.nro_lugar_entrega = @nro_lugar_entrega
  GROUP BY v.tipo_comprobante, v.prefijo, v.numero, v.fecha_vencimiento, aplicado.pagado
)
SELECT
  JSON_QUERY((SELECT * FROM active_location FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)) AS cliente,
  JSON_QUERY((
    SELECT TOP (${maxRows})
      LTRIM(RTRIM(tipo_comprobante)) AS tipo_comprobante,
      CAST(prefijo AS int) AS prefijo,
      CAST(numero AS int) AS numero,
      fecha,
      CAST(importe AS decimal(18, 2)) AS importe,
      CAST(pagado AS decimal(18, 2)) AS pagado,
      CAST(importe - pagado AS decimal(18, 2)) AS saldo,
      CASE
        WHEN ABS(importe - pagado) <= 0.05 THEN 'pagada'
        WHEN pagado > 0 THEN 'parcial'
        ELSE 'impaga'
      END AS estado
    FROM venta_totals
    ORDER BY fecha DESC, numero DESC
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS ventas,
  JSON_QUERY((
    SELECT TOP (${maxRows})
      LTRIM(RTRIM(mf.tipo_comprobante)) AS tipo_comprobante,
      CAST(mf.prefijo_remito AS int) AS prefijo_remito,
      CAST(mf.numero_remito AS int) AS numero_remito,
      CONVERT(varchar(10), mf.fecha_remito, 23) AS fecha,
      CAST(mfi.nro_orden AS int) AS nro_orden,
      CAST(mfi.cod_item AS int) AS cod_item,
      LTRIM(RTRIM(i.denominacion)) AS item,
      CAST(mfi.cantidad AS decimal(18, 2)) AS cantidad,
      CONVERT(varchar(10), mfi.fecha_periodo_abono, 23) AS fecha_periodo_abono
    FROM dbo.MovFisicos AS mf
    INNER JOIN dbo.MovFisicosItems AS mfi
      ON mfi.tipo_comprobante = mf.tipo_comprobante
     AND mfi.prefijo_remito = mf.prefijo_remito
     AND mfi.numero_remito = mf.numero_remito
    LEFT JOIN dbo.Item AS i
      ON i.cod_item = mfi.cod_item
    WHERE mf.cod_cliente = @cod_cliente
      AND mf.nro_lugar_entrega = @nro_lugar_entrega
      AND mfi.cod_item IN (1, 2)
    ORDER BY mf.fecha_remito DESC, mf.numero_remito DESC, mfi.nro_orden
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS movimientos,
  JSON_QUERY((
    SELECT TOP (${maxRows})
      LTRIM(RTRIM(c.tipo_comprobante_cobro)) AS tipo_comprobante_cobro,
      CAST(c.prefijo_recibo AS int) AS prefijo_recibo,
      CAST(c.numero_recibo AS int) AS numero_recibo,
      CONVERT(varchar(10), c.fecha_recibo, 23) AS fecha,
      LTRIM(RTRIM(ca.tipo_comprobante)) AS aplicado_tipo,
      CAST(ca.prefijo AS int) AS aplicado_prefijo,
      CAST(ca.numero AS int) AS aplicado_numero,
      CAST(ca.importe_aplicado AS decimal(18, 2)) AS importe
    FROM dbo.Cobros AS c
    LEFT JOIN dbo.CobrosAplicados AS ca
      ON ca.tipo_comprobante_cobro = c.tipo_comprobante_cobro
     AND ca.prefijo_recibo = c.prefijo_recibo
     AND ca.numero_recibo = c.numero_recibo
    WHERE c.cod_cliente = @cod_cliente
      AND c.nro_lugar_entrega = @nro_lugar_entrega
    ORDER BY c.fecha_recibo DESC, c.numero_recibo DESC
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS cobros
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )

    if (!result || !result.cliente) {
      throw new Error('Cliente/punto inactive or not found.')
    }

    return {
      cliente: result.cliente,
      ventas: (result.ventas || []).map(row => ({ ...row, comprobante: comprobanteLabel(row) })),
      movimientos: (result.movimientos || []).map(row => ({
        ...row,
        comprobante: `${compact(row.tipo_comprobante)}/${Number(row.prefijo_remito)}/${Number(row.numero_remito)}`
      })),
      cobros: (result.cobros || []).map(row => ({
        ...row,
        recibo: receiptLabel(row),
        aplicado_a: row.aplicado_tipo
          ? `${compact(row.aplicado_tipo)}/${Number(row.aplicado_prefijo)}/${Number(row.aplicado_numero)}`
          : null
      }))
    }
  }

  getVentaItems({ tipoComprobante, prefijo, numero } = {}) {
    const tipo = normalizeTipo(tipoComprobante, ['FA', 'FB', 'FC', 'CI', 'NA', 'NB'], 'tipoComprobante')
    const pref = intValue(prefijo, 'prefijo')
    const num = positiveInt(numero, 'numero')

    return this.sql.queryJson(
      forJson(`
SELECT
  CAST(vi.orden AS int) AS orden,
  LTRIM(RTRIM(COALESCE(NULLIF(i.denominacion, ''), NULLIF(i.denom_corto, ''), CONCAT('Item ', vi.cod_item)))) AS denominacion,
  CAST(vi.cantidad AS decimal(18, 2)) AS cantidad,
  CAST(vi.precio AS decimal(18, 2)) AS precio,
  CAST(vi.importe AS decimal(18, 2)) AS importe,
  CAST(vi.tasa_iva AS decimal(18, 2)) AS tasa_iva,
  CAST(COALESCE(vi.litros_abonados, 0) AS decimal(18, 2)) AS litros_abonados
FROM dbo.VentasItems AS vi
LEFT JOIN dbo.Item AS i
  ON i.cod_item = vi.cod_item
WHERE LTRIM(RTRIM(vi.tipo_comprobante)) = '${sqlString(tipo)}'
  AND vi.prefijo = ${pref}
  AND vi.numero = ${num}
ORDER BY vi.orden
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getCreditInvoices({ codCliente, nroLugarEntrega } = {}) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')

    return this.sql.queryJson(
      forJson(`
SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(10), v.fecha_operacion, 23) AS fecha_operacion,
  CAST(SUM(COALESCE(vi.importe, 0)) AS decimal(18, 2)) AS total,
  NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae
FROM dbo.Ventas AS v
LEFT JOIN dbo.VentasItems AS vi
  ON vi.tipo_comprobante = v.tipo_comprobante
 AND vi.prefijo = v.prefijo
 AND vi.numero = v.numero
WHERE v.cod_cliente = ${cod}
  AND v.nro_lugar_entrega = ${lugar}
  AND LTRIM(RTRIM(v.tipo_comprobante)) IN ('FA', 'FB')
  AND v.prefijo IN (7, 8)
  AND NULLIF(LTRIM(RTRIM(COALESCE(v.cae, ''))), '') IS NOT NULL
GROUP BY v.tipo_comprobante, v.prefijo, v.numero, v.fecha_operacion, v.cae
ORDER BY v.fecha_operacion DESC, v.prefijo DESC, v.numero DESC
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getCreditDependencyConstraints() {
    return this.sql.queryJson(
      forJson(`
SELECT DISTINCT
  OBJECT_SCHEMA_NAME(fk.parent_object_id) AS child_schema,
  OBJECT_NAME(fk.parent_object_id) AS child_table,
  fk.name AS constraint_name
FROM sys.foreign_keys AS fk
WHERE OBJECT_SCHEMA_NAME(fk.referenced_object_id) = 'dbo'
  AND OBJECT_NAME(fk.referenced_object_id) IN ('Ventas', 'MovFisicos')
  AND OBJECT_NAME(fk.parent_object_id) IN ('VentasItems', 'CobrosAplicados', 'MovFisicosItems', 'MovFisicosEquipos')
ORDER BY child_table, constraint_name
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  convertAuthorizedInvoiceToCredit({ original, credit, fechaEmision, syncTalonario = true }) {
    const oldTipo = normalizeTipo(original?.tipoComprobante, ['FA', 'FB'], 'original.tipoComprobante')
    const oldPrefijo = intValue(original?.prefijo, 'original.prefijo')
    const oldNumero = positiveInt(original?.numero, 'original.numero')
    const mapping = CREDIT_NOTE_BY_INVOICE_TYPE[oldTipo]
    const newTipo = mapping.tipoComprobante
    const newPrefijo = intValue(credit?.ptoVta, 'credit.ptoVta')
    const newNumero = positiveInt(credit?.cbteNro, 'credit.cbteNro')
    const cae = sqlString(credit?.cae)
    const caeFchVto = sqlString(normalizeCaeFchVto(credit?.caeFchVto))
    const fecha = sqlDate(fechaEmision, 'fechaEmision')
    const constraints = this.getCreditDependencyConstraints()
    const disableConstraintsSql = constraints
      .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} NOCHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
      .join('\n')
    const enableConstraintsSql = constraints
      .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} WITH CHECK CHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
      .join('\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @ventas_items int = 0;
DECLARE @cobros_aplicados int = 0;
DECLARE @movfisicos int = 0;
DECLARE @movfisicos_items int = 0;
DECLARE @movfisicos_equipos int = 0;
DECLARE @movfisicos_ci int = 0;
DECLARE @movfisicos_ci_items int = 0;
DECLARE @movfisicos_ci_equipos int = 0;
DECLARE @ventas int = 0;
DECLARE @numero_ci int = NULL;
DECLARE @cod_cliente int = NULL;
DECLARE @nro_lugar_entrega int = NULL;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
    AND prefijo = ${oldPrefijo}
    AND numero = ${oldNumero}
    AND NULLIF(LTRIM(RTRIM(COALESCE(cae, ''))), '') IS NOT NULL
)
BEGIN
  THROW 52020, 'Factura original no encontrada o sin CAE.', 1;
END;

SELECT
  @numero_ci = CAST(numero_ci AS int),
  @cod_cliente = CAST(cod_cliente AS int),
  @nro_lugar_entrega = CAST(nro_lugar_entrega AS int)
FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};

IF NOT EXISTS (
  SELECT 1 FROM dbo.TipoComprobante WITH (HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
)
BEGIN
  THROW 52021, 'Tipo de comprobante NC no configurado en NAVIERA.', 1;
END;

-- Ventas has a composite FK to Talonario. This row records an ARCA-assigned NC;
-- it is never consulted to choose the fiscal number.
IF NOT EXISTS (
  SELECT 1 FROM dbo.Talonario WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
    AND prefijo = ${newPrefijo}
)
BEGIN
  ${syncTalonario
    ? `INSERT INTO dbo.Talonario (tipo_comprobante, prefijo, ult_numero)
  VALUES ('${sqlString(newTipo)}', ${newPrefijo}, 0);`
    : "THROW 52025, 'No existe el Talonario requerido por la FK de la NC.', 1;"}
END;

IF EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
    AND prefijo = ${newPrefijo}
    AND numero = ${newNumero}
)
BEGIN
  THROW 52022, 'La NC autorizada ya existe en NAVIERA.', 1;
END;

IF @numero_ci IS NOT NULL AND EXISTS (
  SELECT 1
  FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = '${sqlString(newTipo)}'
    AND prefijo_remito = ${newPrefijo}
    AND numero_remito = ${newNumero}
)
BEGIN
  THROW 52024, 'Ya existe un movimiento fisico con la identidad de la NC.', 1;
END;

${disableConstraintsSql}

UPDATE dbo.VentasItems
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo = ${newPrefijo}, numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo = ${oldPrefijo} AND numero = ${oldNumero};
SET @ventas_items = @@ROWCOUNT;

UPDATE dbo.CobrosAplicados
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo = ${newPrefijo}, numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo = ${oldPrefijo} AND numero = ${oldNumero};
SET @cobros_aplicados = @@ROWCOUNT;

UPDATE dbo.MovFisicosEquipos
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo_remito = ${oldPrefijo} AND numero_remito = ${oldNumero};
SET @movfisicos_equipos = @@ROWCOUNT;

UPDATE dbo.MovFisicosItems
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo_remito = ${oldPrefijo} AND numero_remito = ${oldNumero};
SET @movfisicos_items = @@ROWCOUNT;

UPDATE dbo.MovFisicos
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo_remito = ${oldPrefijo} AND numero_remito = ${oldNumero};
SET @movfisicos = @@ROWCOUNT;

-- A fiscal Venta created from a CI owns that CI movement through numero_ci.
-- When it becomes an NC, the original physical movement must follow the NC too.
UPDATE dbo.MovFisicosEquipos
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_ci
  AND EXISTS (
    SELECT 1 FROM dbo.MovFisicos AS mf
    WHERE mf.tipo_comprobante = 'CI'
      AND mf.prefijo_remito = 0
      AND mf.numero_remito = @numero_ci
      AND mf.cod_cliente = @cod_cliente
      AND mf.nro_lugar_entrega = @nro_lugar_entrega
  );
SET @movfisicos_ci_equipos = @@ROWCOUNT;

UPDATE dbo.MovFisicosItems
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_ci
  AND EXISTS (
    SELECT 1 FROM dbo.MovFisicos AS mf
    WHERE mf.tipo_comprobante = 'CI'
      AND mf.prefijo_remito = 0
      AND mf.numero_remito = @numero_ci
      AND mf.cod_cliente = @cod_cliente
      AND mf.nro_lugar_entrega = @nro_lugar_entrega
  );
SET @movfisicos_ci_items = @@ROWCOUNT;

UPDATE dbo.MovFisicos
SET tipo_comprobante = '${sqlString(newTipo)}', prefijo_remito = ${newPrefijo}, numero_remito = ${newNumero}
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_ci
  AND cod_cliente = @cod_cliente
  AND nro_lugar_entrega = @nro_lugar_entrega;
SET @movfisicos_ci = @@ROWCOUNT;

UPDATE dbo.Ventas
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero},
    fecha_operacion = '${sqlString(fecha)}',
    Mcampo_control = 'N',
    cae = '${cae}',
    fecha_vencimiento_cae = '${caeFchVto}',
    numero_ci = NULL
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}' AND prefijo = ${oldPrefijo} AND numero = ${oldNumero};
SET @ventas = @@ROWCOUNT;

IF @ventas <> 1
BEGIN
  THROW 52023, 'La transformacion de la Venta no afecto exactamente una fila.', 1;
END;

${enableConstraintsSql}

${syncTalonario
  ? `UPDATE dbo.Talonario
SET ult_numero = CASE
  WHEN CAST(ult_numero AS int) < ${newNumero} THEN ${newNumero}
  ELSE ult_numero
END
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
  AND prefijo = ${newPrefijo};`
  : '-- La numeracion fiscal la determina ARCA; no sincronizar Talonario.'}

COMMIT TRANSACTION;

SELECT 'ok' AS status,
  '${sqlString(oldTipo)}' AS original_tipo, ${oldPrefijo} AS original_prefijo, ${oldNumero} AS original_numero,
  '${sqlString(newTipo)}' AS nc_tipo, ${newPrefijo} AS nc_prefijo, ${newNumero} AS nc_numero,
  @ventas AS ventas, @ventas_items AS ventas_items, @cobros_aplicados AS cobros_aplicados,
  @movfisicos AS movfisicos, @movfisicos_items AS movfisicos_items, @movfisicos_equipos AS movfisicos_equipos,
  @movfisicos_ci AS movfisicos_ci, @movfisicos_ci_items AS movfisicos_ci_items,
  @movfisicos_ci_equipos AS movfisicos_ci_equipos
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  getPendingVentas({ codCliente, nroLugarEntrega, limit = 50 } = {}) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const maxRows = Math.min(Math.max(intValue(limit || 50, 'limit'), 1), 100)

    const rows = this.sql.queryJson(
      forJson(`
IF NOT EXISTS (
  SELECT 1
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  WHERE c.cod_cliente = ${cod}
    AND le.nro_lugar_entrega = ${lugar}
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
)
  THROW 50000, 'Cliente/punto inactive or not found.', 1;

WITH venta_totals AS (
  SELECT
    v.tipo_comprobante,
    v.prefijo,
    v.numero,
    CONVERT(varchar(10), v.fecha_operacion, 23) AS fecha,
    SUM(COALESCE(vi.importe, 0)) AS importe,
    COALESCE(aplicado.pagado, 0) AS pagado
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  OUTER APPLY (
    SELECT SUM(COALESCE(ca.importe_aplicado, 0)) AS pagado
    FROM dbo.CobrosAplicados AS ca
    WHERE ca.tipo_comprobante = v.tipo_comprobante
      AND ca.prefijo = v.prefijo
      AND ca.numero = v.numero
  ) AS aplicado
  WHERE v.cod_cliente = ${cod}
    AND v.nro_lugar_entrega = ${lugar}
  GROUP BY v.tipo_comprobante, v.prefijo, v.numero, v.fecha_operacion, aplicado.pagado
)
SELECT TOP (${maxRows})
  LTRIM(RTRIM(tipo_comprobante)) AS tipo_comprobante,
  CAST(prefijo AS int) AS prefijo,
  CAST(numero AS int) AS numero,
  fecha,
  CAST(importe AS decimal(18, 2)) AS importe,
  CAST(pagado AS decimal(18, 2)) AS pagado,
  CAST(importe - pagado AS decimal(18, 2)) AS saldo,
  CASE WHEN pagado > 0 THEN 'parcial' ELSE 'impaga' END AS estado
FROM venta_totals
WHERE importe - pagado > 0.05
ORDER BY fecha DESC, numero DESC
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    return rows.map(row => ({ ...row, comprobante: comprobanteLabel(row) }))
  }

  getAvailableAbonos({ codCliente, nroLugarEntrega, fechaReferencia }) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const ref = sqlDate(fechaReferencia || todayIsoDate(), 'fechaReferencia')
    this.getActiveLocation({ codCliente: cod, nroLugarEntrega: lugar })

    return this.sql.queryJson(
      forJson(`
DECLARE @ref date = '${sqlString(ref)}';
DECLARE @desde date = DATEADD(day, -62, @ref);

SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(10), v.fecha_vencimiento, 23) AS fecha_periodo_abono
FROM dbo.Ventas AS v
WHERE v.cod_cliente = ${cod}
  AND v.nro_lugar_entrega = ${lugar}
  -- Keep recent history for safety, but include every newer abono so a future period can be assigned manually.
  AND CONVERT(date, v.fecha_vencimiento) >= @desde
  AND EXISTS (
    SELECT 1
    FROM dbo.VentasItems AS vi
    WHERE vi.tipo_comprobante = v.tipo_comprobante
      AND vi.prefijo = v.prefijo
      AND vi.numero = v.numero
      AND COALESCE(vi.litros_abonados, 0) > 0
  )
ORDER BY v.fecha_vencimiento DESC, v.numero DESC
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getNextTalonarioNumber({ tipoComprobante, prefijo }) {
    const tipo = normalizeTipo(tipoComprobante, ['FA', 'FB', 'FC', 'CI', 'RR'], 'tipoComprobante')
    const p = intValue(prefijo, 'prefijo')
    const row = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(tipo_comprobante)) AS tipo_comprobante,
  CAST(prefijo AS int) AS prefijo,
  CAST(ult_numero AS int) AS ult_numero,
  CAST(ult_numero + 1 AS int) AS proximo
FROM dbo.Talonario
WHERE tipo_comprobante = '${sqlString(tipo)}'
  AND prefijo = ${p}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
    if (!row) {
      throw new Error(`Talonario ${tipo}/${p} not found.`)
    }
    return row
  }

  getSuggestedCiNumber() {
    return this.getSuggestedNumber({ tipoComprobante: 'CI', prefijo: 0 }).proximo
  }

  getSuggestedNumber({ tipoComprobante = 'CI', prefijo = 0 } = {}) {
    const tipo = normalizeTipo(tipoComprobante, ['CI', 'RR'], 'tipoComprobante')
    const pref = tipo === 'CI' ? 0 : intValue(prefijo, 'prefijo')
    const query =
      tipo === 'CI'
        ? `
SELECT CAST(MAX(numero) + 1 AS int) AS proximo
FROM (
  SELECT MAX(CAST(numero AS int)) AS numero FROM dbo.Ventas WHERE tipo_comprobante = 'CI' AND prefijo = 0
  UNION ALL
  SELECT MAX(CAST(numero_remito AS int)) AS numero FROM dbo.MovFisicos WHERE tipo_comprobante = 'CI' AND prefijo_remito = 0
  UNION ALL
  SELECT MAX(CAST(numero_recibo AS int)) AS numero FROM dbo.Cobros WHERE tipo_comprobante_cobro = 'CI' AND prefijo_recibo = 0
) AS numbers
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`
        : `
SELECT CAST(COALESCE(MAX(CAST(numero_remito AS int)), 0) + 1 AS int) AS proximo
FROM dbo.MovFisicos
WHERE tipo_comprobante = 'RR'
  AND prefijo_remito = ${pref}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`
    const row = this.sql.queryJson(forJson(query))

    return {
      tipo_comprobante: tipo,
      prefijo: pref,
      proximo: Number(row && row.proximo) || 1
    }
  }

  getExistingMovement({ tipoComprobante, prefijo, numero }) {
    const tipo = normalizeTipo(tipoComprobante || 'CI', ['CI', 'RR'], 'tipoComprobante')
    const pref = tipo === 'CI' ? 0 : intValue(prefijo, 'prefijo')
    const num = positiveInt(numero, 'numero')

    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(mf.tipo_comprobante)) AS tipo_comprobante,
  CAST(mf.prefijo_remito AS int) AS prefijo_remito,
  CAST(mf.numero_remito AS int) AS numero_remito,
  CONVERT(varchar(10), mf.fecha_remito, 23) AS fecha,
  CAST(mf.cod_cliente AS int) AS cod_cliente,
  CAST(mf.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(c.razon_social)) AS razon_social
FROM dbo.MovFisicos AS mf
LEFT JOIN dbo.Cliente AS c
  ON c.cod_cliente = mf.cod_cliente
WHERE LTRIM(RTRIM(mf.tipo_comprobante)) = '${sqlString(tipo)}'
  AND mf.prefijo_remito = ${pref}
  AND mf.numero_remito = ${num}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getVentaMovementReadiness({ numeroCi, fecha, codCliente, nroLugarEntrega }) {
    const num = positiveInt(numeroCi, 'numeroCi')
    const date = sqlDate(fecha, 'fecha')
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const row = this.sql.queryJson(
      forJson(`
SELECT
  CAST((SELECT COUNT_BIG(1) FROM dbo.Ventas WHERE numero_ci = ${num}) AS int) AS ventas_numero_ci,
  JSON_QUERY((
    SELECT TOP (1)
      CAST(cod_cliente AS int) AS cod_cliente,
      CAST(nro_lugar_entrega AS int) AS nro_lugar_entrega,
      CONVERT(varchar(10), fecha_remito, 23) AS fecha_remito
    FROM dbo.MovFisicos
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = ${num}
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
  )) AS movimiento,
  CAST((
    SELECT COALESCE(MAX(CAST(nro_orden AS int)), 0)
    FROM dbo.MovFisicosItems
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = ${num}
  ) AS int) AS max_orden_movimiento
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    ) || {}

    if (Number(row.ventas_numero_ci || 0) > 0) {
      return {
        status: 'blocked',
        blockReason: `Ya existe una Venta asociada al CI/0-${num}.`
      }
    }

    if (!row.movimiento) {
      return {
        status: 'ok_new_movement',
        movementMode: 'insert',
        nextMovementOrder: 1
      }
    }

    const movement = row.movimiento
    const matches =
      Number(movement.cod_cliente) === cod &&
      Number(movement.nro_lugar_entrega) === lugar &&
      compact(movement.fecha_remito) === date

    if (!matches) {
      return {
        status: 'blocked',
        blockReason: `El CI/0-${num} ya existe pero no coincide cliente/punto/fecha.`,
        existingMovement: movement
      }
    }

    return {
      status: 'ok_append_movement',
      movementMode: 'append',
      existingMovement: movement,
      nextMovementOrder: Number(row.max_orden_movimiento || 0) + 1
    }
  }

  getInvoiceRecordForNewVenta({ tipoComprobante, prefijo, numero, fecha, codCliente, nroLugarEntrega, items }) {
    const location = this.getActiveLocation({ codCliente, nroLugarEntrega })
    return {
      venta: {
        tipo_comprobante: tipoComprobante,
        prefijo,
        numero,
        fecha_operacion: fecha,
        fecha_vencimiento: fecha,
        cod_cliente: codCliente,
        nro_lugar_entrega: nroLugarEntrega,
        tipo_facturacion: 3,
        cod_categoria: location.cod_categoria
      },
      cliente: {
        cod_cliente: location.cod_cliente,
        razon_social: location.razon_social,
        cuit: location.cuit,
        cod_categoria: location.cod_categoria
      },
      categoriaIva: {
        cod_categoria: location.cod_categoria,
        categoria: location.categoria_iva,
        tipofactura: location.tipofactura
      },
      lugarEntrega: location,
      items: items.map(item => ({
        cod_item: item.cod_item,
        denominacion: item.denominacion || `Item ${item.cod_item}`,
        cantidad: item.cantidad,
        precio: item.precio,
        importe: item.importe,
        tasa_iva: item.tasa_iva,
        litros_abonados: item.litros_abonados
      }))
    }
  }

  executeInsertMovement({ tipoComprobante, prefijo, numero, fecha, codCliente, nroLugarEntrega, items }) {
    const itemValues = items
      .map(item => `(
        '${sqlString(tipoComprobante)}', ${prefijo}, ${numero}, ${item.nro_orden},
        ${item.cod_item}, ${item.cantidad}, ${item.fecha_periodo_abono ? `'${sqlString(item.fecha_periodo_abono)}'` : 'NULL'},
        NULL, NULL, NULL, NULL
      )`)
      .join(',\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = '${sqlString(tipoComprobante)}'
    AND prefijo_remito = ${prefijo}
    AND numero_remito = ${numero}
)
BEGIN
  THROW 52000, 'Movimiento already exists.', 1;
END;

INSERT INTO dbo.MovFisicos
(tipo_comprobante, prefijo_remito, numero_remito, fecha_remito, cod_cliente, nro_lugar_entrega, saca_M)
VALUES
('${sqlString(tipoComprobante)}', ${prefijo}, ${numero}, '${sqlString(fecha)}', ${codCliente}, ${nroLugarEntrega}, NULL);

INSERT INTO dbo.MovFisicosItems
(tipo_comprobante, prefijo_remito, numero_remito, nro_orden, cod_item, cantidad, fecha_periodo_abono, saca_mi, INFOEXTRA, STOCK, ultimo_stock)
VALUES
${itemValues};

COMMIT TRANSACTION;

SELECT 'ok' AS status, '${sqlString(tipoComprobante)}' AS tipo_comprobante, ${prefijo} AS prefijo, ${numero} AS numero
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  executeInsertCobro({ numeroRecibo, fecha, codCliente, nroLugarEntrega, venta, importe }) {
    const tipo = normalizeTipo(venta.tipoComprobante || venta.tipo_comprobante, ['FA', 'FB', 'FC', 'CI'], 'venta.tipoComprobante')
    const prefijo = intValue(venta.prefijo, 'venta.prefijo')
    const numero = positiveInt(venta.numero, 'venta.numero')
    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM dbo.Cobros WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante_cobro = 'CI' AND prefijo_recibo = 0 AND numero_recibo = ${numeroRecibo}
)
BEGIN
  THROW 52001, 'Cobro CI already exists.', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.CobrosAplicados WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante_cobro = 'CI' AND prefijo_recibo = 0 AND numero_recibo = ${numeroRecibo}
)
BEGIN
  THROW 52002, 'CobrosAplicados already exists for this CI.', 1;
END;

IF NOT EXISTS (
  SELECT 1 FROM dbo.Ventas WITH (HOLDLOCK)
  WHERE tipo_comprobante = '${sqlString(tipo)}' AND prefijo = ${prefijo} AND numero = ${numero}
    AND cod_cliente = ${codCliente} AND nro_lugar_entrega = ${nroLugarEntrega}
)
BEGIN
  THROW 52003, 'Venta not found for selected client/location.', 1;
END;

INSERT INTO dbo.Cobros
(tipo_comprobante_cobro, prefijo_recibo, numero_recibo, fecha_recibo, cod_cliente, nro_lugar_entrega, saca_c)
VALUES
('CI', 0, ${numeroRecibo}, '${sqlString(fecha)}', ${codCliente}, ${nroLugarEntrega}, NULL);

INSERT INTO dbo.CobrosAplicados
(tipo_comprobante_cobro, prefijo_recibo, numero_recibo, tipo_comprobante, prefijo, numero, importe_aplicado, numero_ci, saca_ca)
VALUES
('CI', 0, ${numeroRecibo}, '${sqlString(tipo)}', ${prefijo}, ${numero}, ${importe}, ${numeroRecibo}, NULL);

COMMIT TRANSACTION;

SELECT 'ok' AS status, 'CI' AS tipo_comprobante, 0 AS prefijo, ${numeroRecibo} AS numero
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  executeInsertVentaCi({ numeroCi, fecha, codCliente, nroLugarEntrega, ventaItems, movItems }) {
    const ventaValues = ventaItems
      .map(item => `(
        'CI', 0, ${numeroCi}, ${item.orden}, ${item.cod_item}, ${item.cantidad}, ${item.precio},
        ${item.importe}, ${item.tasa_iva}, ${item.litros_abonados}
      )`)
      .join(',\n')
    const movValues = movItems
      .map(item => `(
        'CI', 0, ${numeroCi}, @mov_start + ${item.nro_orden}, ${item.cod_item}, ${item.cantidad}, NULL, NULL, NULL, NULL, NULL
      )`)
      .join(',\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @movement_exists bit = 0;
DECLARE @mov_start int = 0;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK) WHERE tipo_comprobante = 'CI' AND prefijo = 0 AND numero = ${numeroCi})
BEGIN
  THROW 52004, 'Venta CI already exists.', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK) WHERE numero_ci = ${numeroCi})
BEGIN
  THROW 52006, 'A Venta already exists for this CI number.', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK) WHERE tipo_comprobante = 'CI' AND prefijo_remito = 0 AND numero_remito = ${numeroCi})
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK)
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = ${numeroCi}
      AND cod_cliente = ${codCliente}
      AND nro_lugar_entrega = ${nroLugarEntrega}
      AND CONVERT(date, fecha_remito) = '${sqlString(fecha)}'
  )
  BEGIN
    THROW 52005, 'Movimiento CI already exists for another client/date.', 1;
  END;

  SET @movement_exists = 1;
  SELECT @mov_start = COALESCE(MAX(CAST(nro_orden AS int)), 0)
  FROM dbo.MovFisicosItems WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = 'CI'
    AND prefijo_remito = 0
    AND numero_remito = ${numeroCi};
END;

INSERT INTO dbo.Ventas
(tipo_comprobante, prefijo, numero, fecha_operacion, cod_cliente, nro_lugar_entrega, fecha_vencimiento, tipo_facturacion, numero_ci)
VALUES
('CI', 0, ${numeroCi}, '${sqlString(fecha)}', ${codCliente}, ${nroLugarEntrega}, '${sqlString(fecha)}', 3, ${numeroCi});

INSERT INTO dbo.VentasItems
(tipo_comprobante, prefijo, numero, orden, cod_item, cantidad, precio, importe, tasa_iva, litros_abonados)
VALUES
${ventaValues};

IF @movement_exists = 0
BEGIN
INSERT INTO dbo.MovFisicos
(tipo_comprobante, prefijo_remito, numero_remito, fecha_remito, cod_cliente, nro_lugar_entrega, saca_M)
VALUES
('CI', 0, ${numeroCi}, '${sqlString(fecha)}', ${codCliente}, ${nroLugarEntrega}, NULL);
END;

INSERT INTO dbo.MovFisicosItems
(tipo_comprobante, prefijo_remito, numero_remito, nro_orden, cod_item, cantidad, fecha_periodo_abono, saca_mi, INFOEXTRA, STOCK, ultimo_stock)
VALUES
${movValues};

COMMIT TRANSACTION;

SELECT 'ok' AS status, 'CI' AS tipo_comprobante, 0 AS prefijo, ${numeroCi} AS numero,
       CASE WHEN @movement_exists = 1 THEN 'append' ELSE 'insert' END AS movement_mode,
       @mov_start AS previous_last_movement_order
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  executeInsertVentaFiscal({ tipoComprobante, prefijo, numero, numeroCi, fecha, fechaMovimiento, codCliente, nroLugarEntrega, ventaItems, movItems, cae, caeFchVto }) {
    const ventaValues = ventaItems
      .map(item => `(
        '${sqlString(tipoComprobante)}', ${prefijo}, ${numero}, ${item.orden}, ${item.cod_item}, ${item.cantidad}, ${item.precio},
        ${item.importe}, ${item.tasa_iva}, ${item.litros_abonados}
      )`)
      .join(',\n')
    const movValues = movItems
      .map(item => `(
        'CI', 0, ${numeroCi}, @mov_start + ${item.nro_orden}, ${item.cod_item}, ${item.cantidad}, NULL, NULL, NULL, NULL, NULL
      )`)
      .join(',\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @movement_exists bit = 0;
DECLARE @mov_start int = 0;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK) WHERE tipo_comprobante = '${sqlString(tipoComprobante)}' AND prefijo = ${prefijo} AND numero = ${numero})
BEGIN
  THROW 52007, 'Venta fiscal already exists.', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.Cobros WITH (UPDLOCK, HOLDLOCK) WHERE tipo_comprobante_cobro = '${sqlString(tipoComprobante)}' AND prefijo_recibo = ${prefijo} AND numero_recibo = ${numero})
BEGIN
  THROW 52010, 'Fiscal number is already used by a legacy Cobro.', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK) WHERE numero_ci = ${numeroCi})
BEGIN
  THROW 52009, 'A Venta already exists for this CI number.', 1;
END;

IF EXISTS (SELECT 1 FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK) WHERE tipo_comprobante = 'CI' AND prefijo_remito = 0 AND numero_remito = ${numeroCi})
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK)
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = ${numeroCi}
      AND cod_cliente = ${codCliente}
      AND nro_lugar_entrega = ${nroLugarEntrega}
      AND CONVERT(date, fecha_remito) = '${sqlString(fechaMovimiento)}'
  )
  BEGIN
    THROW 52008, 'Movimiento CI already exists for another client/date.', 1;
  END;

  SET @movement_exists = 1;
  SELECT @mov_start = COALESCE(MAX(CAST(nro_orden AS int)), 0)
  FROM dbo.MovFisicosItems WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = 'CI'
    AND prefijo_remito = 0
    AND numero_remito = ${numeroCi};
END;

INSERT INTO dbo.Ventas
(tipo_comprobante, prefijo, numero, fecha_operacion, cod_cliente, nro_lugar_entrega, fecha_vencimiento, cae, fecha_vencimiento_cae, tipo_facturacion, numero_ci)
VALUES
('${sqlString(tipoComprobante)}', ${prefijo}, ${numero}, '${sqlString(fecha)}', ${codCliente}, ${nroLugarEntrega},
 '${sqlString(fecha)}', '${sqlString(cae)}', '${sqlString(caeFchVto)}', 3, ${numeroCi});

INSERT INTO dbo.VentasItems
(tipo_comprobante, prefijo, numero, orden, cod_item, cantidad, precio, importe, tasa_iva, litros_abonados)
VALUES
${ventaValues};

IF @movement_exists = 0
BEGIN
INSERT INTO dbo.MovFisicos
(tipo_comprobante, prefijo_remito, numero_remito, fecha_remito, cod_cliente, nro_lugar_entrega, saca_M)
VALUES
('CI', 0, ${numeroCi}, '${sqlString(fechaMovimiento)}', ${codCliente}, ${nroLugarEntrega}, NULL);
END;

INSERT INTO dbo.MovFisicosItems
(tipo_comprobante, prefijo_remito, numero_remito, nro_orden, cod_item, cantidad, fecha_periodo_abono, saca_mi, INFOEXTRA, STOCK, ultimo_stock)
VALUES
${movValues};

COMMIT TRANSACTION;

SELECT 'ok' AS status, '${sqlString(tipoComprobante)}' AS tipo_comprobante, ${prefijo} AS prefijo, ${numero} AS numero,
       'CI' AS movimiento_tipo, 0 AS movimiento_prefijo, ${numeroCi} AS movimiento_numero,
       CASE WHEN @movement_exists = 1 THEN 'append' ELSE 'insert' END AS movement_mode,
       @mov_start AS previous_last_movement_order
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  getMovementForDelete({ tipoComprobante, prefijo, numero }) {
    const tipo = normalizeTipo(tipoComprobante, ['CI', 'RR'], 'tipoComprobante')
    const pref = tipo === 'CI' ? 0 : intValue(prefijo, 'prefijo')
    const num = positiveInt(numero, 'numero')

    const movement = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(mf.tipo_comprobante)) AS tipo_comprobante,
  CAST(mf.prefijo_remito AS int) AS prefijo_remito,
  CAST(mf.numero_remito AS int) AS numero_remito,
  CONVERT(varchar(10), mf.fecha_remito, 23) AS fecha,
  CAST(mf.cod_cliente AS int) AS cod_cliente,
  CAST(mf.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(c.razon_social)) AS razon_social
FROM dbo.MovFisicos AS mf
LEFT JOIN dbo.Cliente AS c
  ON c.cod_cliente = mf.cod_cliente
WHERE mf.tipo_comprobante = '${sqlString(tipo)}'
  AND mf.prefijo_remito = ${pref}
  AND mf.numero_remito = ${num}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
    if (!movement) {
      throw new Error('Movimiento not found.')
    }

    const linkedVentas = this.sql.queryJson(
      forJson(`
SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae,
  CASE
    WHEN v.tipo_comprobante = '${sqlString(tipo)}' AND v.prefijo = ${pref} AND v.numero = ${num}
      THEN 'misma_triple'
    ELSE 'numero_ci'
  END AS relacion
FROM dbo.Ventas AS v
WHERE (
    v.tipo_comprobante = '${sqlString(tipo)}'
    AND v.prefijo = ${pref}
    AND v.numero = ${num}
  )
  OR (
    '${sqlString(tipo)}' = 'CI'
    AND ${pref} = 0
    AND
    v.numero_ci = ${num}
    AND v.cod_cliente = ${Number(movement.cod_cliente)}
    AND v.nro_lugar_entrega = ${Number(movement.nro_lugar_entrega)}
  )
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const dependencies = this.sql.queryJson(
      forJson(`
WITH linked_ventas AS (
  SELECT v.tipo_comprobante, v.prefijo, v.numero
  FROM dbo.Ventas AS v
  WHERE (
      v.tipo_comprobante = '${sqlString(tipo)}'
      AND v.prefijo = ${pref}
      AND v.numero = ${num}
    )
    OR (
      '${sqlString(tipo)}' = 'CI'
      AND ${pref} = 0
      AND
      v.numero_ci = ${num}
      AND v.cod_cliente = ${Number(movement.cod_cliente)}
      AND v.nro_lugar_entrega = ${Number(movement.nro_lugar_entrega)}
    )
)
SELECT
  (SELECT COUNT_BIG(1) FROM dbo.MovFisicosItems WHERE tipo_comprobante = '${sqlString(tipo)}' AND prefijo_remito = ${pref} AND numero_remito = ${num}) AS movfisicos_items,
  (SELECT COUNT_BIG(1) FROM linked_ventas) AS ventas,
  (SELECT COUNT_BIG(1) FROM dbo.VentasItems AS vi INNER JOIN linked_ventas AS lv ON lv.tipo_comprobante = vi.tipo_comprobante AND lv.prefijo = vi.prefijo AND lv.numero = vi.numero) AS ventas_items,
  (SELECT COUNT_BIG(1) FROM dbo.CobrosAplicados AS ca INNER JOIN linked_ventas AS lv ON lv.tipo_comprobante = ca.tipo_comprobante AND lv.prefijo = ca.prefijo AND lv.numero = ca.numero) AS cobros_aplicados
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    ) || {}

    const items = this.sql.queryJson(
      forJson(`
SELECT
  CAST(mfi.nro_orden AS int) AS nro_orden,
  CAST(mfi.cod_item AS int) AS cod_item,
  LTRIM(RTRIM(i.denominacion)) AS item,
  CAST(mfi.cantidad AS decimal(18, 2)) AS cantidad,
  CONVERT(varchar(10), mfi.fecha_periodo_abono, 23) AS fecha_periodo_abono
FROM dbo.MovFisicosItems AS mfi
LEFT JOIN dbo.Item AS i
  ON i.cod_item = mfi.cod_item
WHERE mfi.tipo_comprobante = '${sqlString(tipo)}'
  AND mfi.prefijo_remito = ${pref}
  AND mfi.numero_remito = ${num}
ORDER BY mfi.nro_orden
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const fiscalLinkedVentas = linkedVentas.filter(row =>
      ['FA', 'FB', 'NA', 'NB'].includes(compact(row.tipo_comprobante))
    )

    return {
      movement,
      items,
      linkedVentas,
      linkedVenta: linkedVentas[0] || null,
      fiscalLinkedVentas,
      dependencies
    }
  }

  executeDeleteMovement({ tipoComprobante, prefijo, numero }) {
    const tipo = normalizeTipo(tipoComprobante, ['CI', 'RR'], 'tipoComprobante')
    const pref = tipo === 'CI' ? 0 : intValue(prefijo, 'prefijo')
    const num = positiveInt(numero, 'numero')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @cod_cliente int;
DECLARE @nro_lugar_entrega int;
DECLARE @deleted_cobros_aplicados int = 0;
DECLARE @deleted_cobros int = 0;
DECLARE @deleted_ventas_items int = 0;
DECLARE @deleted_ventas int = 0;
DECLARE @deleted_movfisicos_items int = 0;
DECLARE @deleted_movfisicos int = 0;

SELECT
  @cod_cliente = CAST(cod_cliente AS int),
  @nro_lugar_entrega = CAST(nro_lugar_entrega AS int)
FROM dbo.MovFisicos WITH (UPDLOCK, HOLDLOCK)
WHERE tipo_comprobante = '${sqlString(tipo)}'
  AND prefijo_remito = ${pref}
  AND numero_remito = ${num};

IF @cod_cliente IS NULL
BEGIN
  THROW 52009, 'Movimiento not found.', 1;
END;

IF EXISTS (
  SELECT 1 FROM dbo.Ventas
  WHERE tipo_comprobante IN ('FA', 'FB', 'NA', 'NB')
    AND (
      (
        tipo_comprobante = '${sqlString(tipo)}' AND prefijo = ${pref} AND numero = ${num}
      )
      OR (
        '${sqlString(tipo)}' = 'CI'
        AND ${pref} = 0
        AND numero_ci = ${num}
        AND cod_cliente = @cod_cliente
        AND nro_lugar_entrega = @nro_lugar_entrega
      )
    )
)
BEGIN
  THROW 52010, 'Movimiento is linked to a fiscal FA/FB/NA/NB venta and cannot be deleted here.', 1;
END;

DECLARE @affected_receipts TABLE (
  tipo_comprobante_cobro char(2) NOT NULL,
  prefijo_recibo numeric(4, 0) NOT NULL,
  numero_recibo numeric(8, 0) NOT NULL
);

INSERT INTO @affected_receipts (tipo_comprobante_cobro, prefijo_recibo, numero_recibo)
SELECT DISTINCT
  ca.tipo_comprobante_cobro,
  ca.prefijo_recibo,
  ca.numero_recibo
FROM dbo.CobrosAplicados AS ca
WHERE ca.tipo_comprobante = 'CI'
  AND ca.prefijo = 0
  AND '${sqlString(tipo)}' = 'CI'
  AND ca.numero = ${num}
  AND ${pref} = 0;

DELETE FROM dbo.CobrosAplicados
WHERE tipo_comprobante = 'CI'
  AND prefijo = 0
  AND '${sqlString(tipo)}' = 'CI'
  AND numero = ${num}
  AND ${pref} = 0;
SET @deleted_cobros_aplicados = @@ROWCOUNT;

DELETE c
FROM dbo.Cobros AS c
INNER JOIN @affected_receipts AS r
  ON r.tipo_comprobante_cobro = c.tipo_comprobante_cobro
 AND r.prefijo_recibo = c.prefijo_recibo
 AND r.numero_recibo = c.numero_recibo
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.CobrosAplicados AS ca
  WHERE ca.tipo_comprobante_cobro = c.tipo_comprobante_cobro
    AND ca.prefijo_recibo = c.prefijo_recibo
    AND ca.numero_recibo = c.numero_recibo
);
SET @deleted_cobros = @@ROWCOUNT;

DELETE FROM dbo.VentasItems
WHERE tipo_comprobante = 'CI'
  AND prefijo = 0
  AND '${sqlString(tipo)}' = 'CI'
  AND numero = ${num}
  AND ${pref} = 0;
SET @deleted_ventas_items = @@ROWCOUNT;

DELETE FROM dbo.Ventas
WHERE tipo_comprobante = 'CI'
  AND prefijo = 0
  AND '${sqlString(tipo)}' = 'CI'
  AND numero = ${num}
  AND ${pref} = 0;
SET @deleted_ventas = @@ROWCOUNT;

DELETE FROM dbo.MovFisicosItems
WHERE tipo_comprobante = '${sqlString(tipo)}'
  AND prefijo_remito = ${pref}
  AND numero_remito = ${num};
SET @deleted_movfisicos_items = @@ROWCOUNT;

DELETE FROM dbo.MovFisicos
WHERE tipo_comprobante = '${sqlString(tipo)}'
  AND prefijo_remito = ${pref}
  AND numero_remito = ${num};
SET @deleted_movfisicos = @@ROWCOUNT;

COMMIT TRANSACTION;

SELECT 'ok' AS status, '${sqlString(tipo)}' AS tipo_comprobante, ${pref} AS prefijo, ${num} AS numero,
       @deleted_movfisicos AS movfisicos_eliminados,
       @deleted_movfisicos_items AS movfisicos_items_eliminados,
       @deleted_ventas AS ventas_eliminadas,
       @deleted_ventas_items AS ventas_items_eliminados,
       @deleted_cobros_aplicados AS cobros_aplicados_eliminados,
       @deleted_cobros AS cobros_eliminados
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }
}

class MovimientosService {
  constructor({ repository, arcaPostFactura = postFactura, arcaPostCreditNote = postCreditNote } = {}) {
    this.repository = repository
    this.arcaPostFactura = arcaPostFactura
    this.arcaPostCreditNote = arcaPostCreditNote
  }

  buildPendingFiscalPreflight(payload = {}) {
    return new PendingFiscalPreflight({
      sql: this.repository.sql,
      representada: payload.representada,
      ptoVta: 8,
      concepto: 1,
      arcaPostFactura: this.arcaPostFactura
    })
  }

  searchLocations(payload) {
    return this.repository.searchActiveLocations(payload)
  }

  getInitialData() {
    return {
      items: this.repository.getItems({ limit: 4 })
    }
  }

  getSuggestedNumber(payload) {
    return this.repository.getSuggestedNumber(payload || {})
  }

  getAccountState(payload) {
    return this.repository.getAccountState(payload)
  }

  getVentaItems(payload) {
    return this.repository.getVentaItems(payload)
  }

  getCreditInvoices(payload) {
    return this.repository.getCreditInvoices(payload)
  }

  getAvailableAbonos(payload) {
    return this.repository.getAvailableAbonos(payload)
  }

  getPendingVentas(payload) {
    return this.repository.getPendingVentas(payload)
  }

  previewDeleteMovement(payload) {
    const data = this.repository.getMovementForDelete(payload)
    const fiscalLinkedVenta = data.fiscalLinkedVentas[0] || null
    return {
      ...data,
      blocked: Boolean(fiscalLinkedVenta),
      blockReason: fiscalLinkedVenta
        ? `${data.movement.tipo_comprobante}/${data.movement.prefijo_remito}/${data.movement.numero_remito} esta asociado a ${fiscalLinkedVenta.tipo_comprobante}/${fiscalLinkedVenta.prefijo}/${fiscalLinkedVenta.numero}.`
        : null
    }
  }

  deleteMovement(payload) {
    const preview = this.previewDeleteMovement(payload)
    if (preview.blocked) {
      throw new Error(preview.blockReason)
    }
    return this.repository.executeDeleteMovement(payload)
  }

  previewOperation(payload) {
    const mode = String(payload?.mode || '').trim()
    if (mode === 'movimiento') {
      return this.previewMovimiento(payload)
    }
    if (mode === 'cobro') {
      return this.previewCobro(payload)
    }
    if (mode === 'venta-ci') {
      return this.previewVentaCi(payload)
    }
    if (mode === 'venta-factura') {
      return this.previewVentaFactura(payload)
    }
    if (mode === 'nota-credito') {
      return this.previewNotaCredito(payload)
    }
    throw new Error('Unsupported movimientos mode.')
  }

  saveOperation(payload) {
    const mode = String(payload?.mode || '').trim()
    if (mode === 'movimiento') {
      return this.saveMovimiento(payload)
    }
    if (mode === 'cobro') {
      return this.saveCobro(payload)
    }
    if (mode === 'venta-ci') {
      return this.saveVentaCi(payload)
    }
    if (mode === 'venta-factura') {
      return this.saveVentaFactura(payload)
    }
    if (mode === 'nota-credito') {
      return this.saveNotaCredito(payload)
    }
    throw new Error('Unsupported movimientos mode.')
  }

  basePayload(payload) {
    const codCliente = positiveInt(payload.codCliente, 'codCliente')
    const nroLugarEntrega = positiveInt(payload.nroLugarEntrega, 'nroLugarEntrega')
    const fecha = sqlDate(payload.fecha || todayIsoDate(), 'fecha')
    const cliente = this.repository.getActiveLocation({ codCliente, nroLugarEntrega })
    return { codCliente, nroLugarEntrega, fecha, cliente }
  }

  previewMovimiento(payload) {
    const base = this.basePayload(payload)
    const tipoComprobante = normalizeTipo(payload.tipoComprobante || 'CI', ['CI', 'RR'], 'tipoComprobante')
    const prefijo = tipoComprobante === 'CI' ? 0 : intValue(payload.prefijo, 'prefijo')
    const numero = positiveInt(payload.numero, 'numero')
    const fechaReferencia = sqlDate(payload.fechaReferencia || payload.fecha || todayIsoDate(), 'fechaReferencia')
    const items = normalizeMovItems(payload.items, { requireAbono: false })
    const existingMovement = this.repository.getExistingMovement({ tipoComprobante, prefijo, numero })
    const blocked = Boolean(existingMovement)
    return {
      mode: 'movimiento',
      cliente: base.cliente,
      comprobante: { tipoComprobante, prefijo, numero },
      fecha: base.fecha,
      fechaReferencia,
      items,
      totals: { lineas: items.length },
      blocked,
      blockReason: blocked
        ? `El movimiento ${tipoComprobante}/${prefijo}-${numero} ya existe.`
        : null,
      existingMovement: existingMovement || null
    }
  }

  saveMovimiento(payload) {
    const preview = this.previewMovimiento(payload)
    if (preview.blocked) {
      throw new Error(preview.blockReason)
    }
    return this.repository.executeInsertMovement({
      tipoComprobante: preview.comprobante.tipoComprobante,
      prefijo: preview.comprobante.prefijo,
      numero: preview.comprobante.numero,
      fecha: preview.fecha,
      codCliente: preview.cliente.cod_cliente,
      nroLugarEntrega: preview.cliente.nro_lugar_entrega,
      items: preview.items
    })
  }

  previewCobro(payload) {
    const base = this.basePayload(payload)
    const numeroRecibo = positiveInt(payload.numeroRecibo || payload.numero, 'numeroRecibo')
    const importe = money(payload.importe, 'importe')
    if (importe <= 0) {
      throw new Error('importe must be greater than zero.')
    }
    const pending = this.repository.getPendingVentas({
      codCliente: base.codCliente,
      nroLugarEntrega: base.nroLugarEntrega,
      limit: 100
    })
    const venta = payload.venta || {}
    const target = pending.find(row =>
      compact(row.tipo_comprobante) === normalizeTipo(venta.tipoComprobante || venta.tipo_comprobante, ['FA', 'FB', 'FC', 'CI'], 'venta.tipoComprobante') &&
      Number(row.prefijo) === intValue(venta.prefijo, 'venta.prefijo') &&
      Number(row.numero) === positiveInt(venta.numero, 'venta.numero')
    )
    if (!target) {
      throw new Error('Selected venta is not pending for this client/location.')
    }
    if (importe - Number(target.saldo) > 0.05) {
      throw new Error('importe exceeds selected venta saldo.')
    }
    return {
      mode: 'cobro',
      cliente: base.cliente,
      recibo: { tipoComprobante: 'CI', prefijo: 0, numero: numeroRecibo },
      fecha: base.fecha,
      venta: target,
      importe
    }
  }

  saveCobro(payload) {
    const preview = this.previewCobro(payload)
    return this.repository.executeInsertCobro({
      numeroRecibo: preview.recibo.numero,
      fecha: preview.fecha,
      codCliente: preview.cliente.cod_cliente,
      nroLugarEntrega: preview.cliente.nro_lugar_entrega,
      venta: preview.venta,
      importe: preview.importe
    })
  }

  previewVentaCi(payload) {
    const base = this.basePayload(payload)
    const numeroCi = positiveInt(payload.numeroCi || payload.numero, 'numeroCi')
    const ventaItems = normalizeVentaItems(payload.items)
    const movItems = normalizeMovItems(payload.movItems || payload.items, { requireAbono: false })
    const dbReady = this.repository.getVentaMovementReadiness({
      numeroCi,
      fecha: base.fecha,
      codCliente: base.codCliente,
      nroLugarEntrega: base.nroLugarEntrega
    })
    if (dbReady.status === 'blocked') {
      throw new Error(dbReady.blockReason)
    }
    return {
      mode: 'venta-ci',
      cliente: base.cliente,
      venta: { tipoComprobante: 'CI', prefijo: 0, numero: numeroCi },
      movimiento: { tipoComprobante: 'CI', prefijo: 0, numero: numeroCi },
      fecha: base.fecha,
      ventaItems,
      movItems,
      dbReady,
      totals: this.calculateTotals(ventaItems)
    }
  }

  saveVentaCi(payload) {
    const preview = this.previewVentaCi(payload)
    return this.repository.executeInsertVentaCi({
      numeroCi: preview.venta.numero,
      fecha: preview.fecha,
      codCliente: preview.cliente.cod_cliente,
      nroLugarEntrega: preview.cliente.nro_lugar_entrega,
      ventaItems: preview.ventaItems,
      movItems: preview.movItems
    })
  }

  previewVentaFactura(payload) {
    const base = this.basePayload(payload)
    const fechaMovimiento = sqlDate(payload.fechaMovimiento || base.fecha, 'fechaMovimiento')
    const tipoComprobante = normalizeTipo(payload.tipoComprobante, ['FA', 'FB'], 'tipoComprobante')
    const tipofactura = compact(base.cliente.tipofactura).toUpperCase()
    const tipoFiscalEsperado = tipofactura === 'A' ? 'FA' : tipofactura === 'B' ? 'FB' : null
    if (!tipoFiscalEsperado) {
      throw new Error(`Cliente sin tipo fiscal electronico habilitado (CategoriaIva.tipofactura=${tipofactura || '-'}).`)
    }
    if (tipoComprobante !== tipoFiscalEsperado) {
      throw new Error(`El cliente corresponde a ${tipoFiscalEsperado}; no se puede autorizar como ${tipoComprobante}.`)
    }
    const numeroCi = positiveInt(payload.numeroCi, 'numeroCi')
    const ventaItems = normalizeVentaItems(payload.items)
    const movItems = normalizeMovItems(payload.movItems || payload.items, { requireAbono: false })
    const dbReady = this.repository.getVentaMovementReadiness({
      numeroCi,
      fecha: fechaMovimiento,
      codCliente: base.codCliente,
      nroLugarEntrega: base.nroLugarEntrega
    })
    if (dbReady.status === 'blocked') {
      throw new Error(dbReady.blockReason)
    }
    const numero = null
    const invoiceRecord = this.repository.getInvoiceRecordForNewVenta({
      tipoComprobante,
      prefijo: 8,
      numero,
      fecha: base.fecha,
      codCliente: base.codCliente,
      nroLugarEntrega: base.nroLugarEntrega,
      items: ventaItems
    })
    const provider = new ArcaApiProvider({
      environment: 'produccion',
      representada: payload.representada,
      ptoVta: 8,
      concepto: 1,
      fechaHomologacion: base.fecha,
      legacyPriceMode: 'gross'
    })
    return {
      mode: 'venta-factura',
      cliente: base.cliente,
      venta: { tipoComprobante, prefijo: 8, numero },
      movimiento: { tipoComprobante: 'CI', prefijo: 0, numero: numeroCi },
      fecha: base.fecha,
      fechaMovimiento,
      preflight: this.buildPendingFiscalPreflight(payload).buildPreview({
        targetDate: base.fecha,
        tipo: tipoComprobante
      }),
      ventaItems,
      movItems,
      dbReady,
      totals: this.calculateTotals(ventaItems),
      arca: provider.buildAuthorizationPreview(invoiceRecord)
    }
  }

  async saveVentaFactura(payload) {
    const preview = this.previewVentaFactura(payload)
    if (payload.confirmation !== 'AUTORIZAR_Y_GUARDAR') {
      throw new Error('Explicit fiscal confirmation is required.')
    }
    const fiscalPreflight = this.buildPendingFiscalPreflight(payload)
    const preflight = await fiscalPreflight.processBefore({
      targetDate: preview.fecha,
      tipo: preview.venta.tipoComprobante
    })
    const expectedArca = await fiscalPreflight.assertNextFiscalIdentityIsAvailable({
      tipo: preview.venta.tipoComprobante,
      prefijo: 8
    })
    const response = await this.arcaPostFactura({
      payload: preview.arca.payload,
      idempotencyKey: `PROD-VENTA-${preview.venta.tipoComprobante}-8-CI-${preview.movimiento.numero}`
    })
    const body = response.response || {}
    const result = body.resultado || body.result || body.Resultado
    const cbteNro = Number(body.cbteNro ?? body.cbte_nro ?? body.numero)
    const cae = body.cae || body.CAE
    const caeFchVto = body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae
    if (result !== 'A' || !cbteNro || !cae || !caeFchVto) {
      return {
        status: 'arca_rejected',
        arca: response,
        preflight,
        expected: preview.venta
      }
    }

    try {
      assertNoCobroReceiptConflict(this.repository.sql, {
        tipo: preview.venta.tipoComprobante,
        prefijo: 8,
        numero: cbteNro
      })
    } catch (error) {
      return {
        status: 'arca_authorized_db_failed',
        preflight,
        arca: response,
        cae,
        caeFchVto,
        arcaExpectedNumber: expectedArca.proximoComprobante,
        localError: error instanceof Error ? error.message : String(error)
      }
    }

    try {
      const saved = this.repository.executeInsertVentaFiscal({
        tipoComprobante: preview.venta.tipoComprobante,
        prefijo: 8,
        numero: cbteNro,
        numeroCi: preview.movimiento.numero,
        fecha: preview.fecha,
        fechaMovimiento: preview.fechaMovimiento,
        codCliente: preview.cliente.cod_cliente,
        nroLugarEntrega: preview.cliente.nro_lugar_entrega,
        ventaItems: preview.ventaItems,
        movItems: preview.movItems,
        cae,
        caeFchVto: normalizeCaeFchVto(caeFchVto)
      })
      return { status: 'ok', preflight, arca: response, saved, arcaExpectedNumber: expectedArca.proximoComprobante }
    } catch (error) {
      return {
        status: 'arca_authorized_db_failed',
        preflight,
        arca: response,
        cae,
        caeFchVto,
        localError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  previewNotaCredito(payload) {
    const tipoComprobante = normalizeTipo(payload.tipoComprobante, ['FA', 'FB'], 'tipoComprobante')
    const prefijo = intValue(payload.prefijo, 'prefijo')
    const numero = positiveInt(payload.numero, 'numero')
    const fecha = sqlDate(payload.fecha || todayIsoDate(), 'fecha')
    if (![7, 8].includes(prefijo)) {
      throw new Error('La NC solo esta habilitada para comprobantes FA/FB de punto 7 u 8.')
    }

    const legacyRepository = new LegacyInvoiceRepository(this.repository.sql)
    const invoice = legacyRepository.getInvoice({ tipo: tipoComprobante, prefijo, numero })
    if (!invoice.venta || !invoice.items.length) {
      throw new Error('Factura original no encontrada o sin VentasItems.')
    }
    if (!invoice.venta.cae) {
      throw new Error('La factura original no tiene CAE; no se puede solicitar una NC.')
    }

    const mapping = CREDIT_NOTE_BY_INVOICE_TYPE[tipoComprobante]
    const concept = prefijo === 7 ? 2 : 1
    const provider = new ArcaApiProvider({
      environment: 'produccion',
      representada: payload.representada,
      ptoVta: prefijo,
      concepto: concept,
      fechaHomologacion: fecha,
      legacyPriceMode: 'gross'
    })
    const arca = provider.buildCreditNotePreview(invoice)
    arca.payload.cbteFch = isoToYyyymmdd(fecha)

    if (concept === 2) {
      const period = monthRangeFromDate(invoice.venta.fecha_vencimiento)
      arca.payload.concepto = 2
      arca.payload.fchServDesde = isoToYyyymmdd(period.firstDate)
      arca.payload.fchServHasta = isoToYyyymmdd(period.lastDate)
      arca.payload.fchVtoPago = isoToYyyymmdd(fecha)
    }

    return {
      mode: 'nota-credito',
      original: { tipoComprobante, prefijo, numero },
      credit: { tipoComprobante: mapping.tipoComprobante, cbteTipo: mapping.cbteTipo, prefijo },
      fecha,
      total: arca.totals.legacyGrossTotal,
      arca
    }
  }

  async saveNotaCredito(payload) {
    const preview = this.previewNotaCredito(payload)
    if (payload.confirmation !== 'AUTORIZAR_NC_Y_GUARDAR') {
      throw new Error('Confirmacion explicita requerida para solicitar la NC.')
    }

    const response = await this.arcaPostCreditNote({
      payload: preview.arca.payload,
      idempotencyKey: `PROD-NC-${preview.original.tipoComprobante}-${preview.original.prefijo}-${preview.original.numero}`
    })
    const body = response.response || {}
    const result = body.resultado || body.result || body.Resultado
    const cbteNro = Number(body.cbteNro ?? body.cbte_nro ?? body.numero)
    const cae = body.cae || body.CAE
    const caeFchVto = body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae
    const ptoVta = Number(body.ptoVta ?? body.pto_vta)
    const responseCbteTipo = Number(body.cbteTipo ?? body.cbte_tipo)

    if (result !== 'A' || !cbteNro || !cae || !caeFchVto) {
      return { status: 'arca_rejected', original: preview.original, arca: response }
    }
    if (ptoVta !== preview.original.prefijo) {
      throw new Error(`ARCA devolvio punto de venta ${ptoVta}; se esperaba ${preview.original.prefijo}. No se modifico NAVIERA.`)
    }
    if (Number.isFinite(responseCbteTipo) && responseCbteTipo !== preview.credit.cbteTipo) {
      throw new Error(`ARCA devolvio tipo ${responseCbteTipo}; se esperaba NC tipo ${preview.credit.cbteTipo}. No se modifico NAVIERA.`)
    }

    try {
      const saved = this.repository.convertAuthorizedInvoiceToCredit({
        original: preview.original,
        credit: { ptoVta, cbteNro, cae, caeFchVto },
        fechaEmision: preview.fecha
      })
      return { status: 'ok', original: preview.original, credit: { ...preview.credit, numero: cbteNro, cae, caeFchVto }, arca: response, saved }
    } catch (error) {
      return {
        status: 'arca_authorized_db_failed',
        original: preview.original,
        credit: { ...preview.credit, numero: cbteNro, cae, caeFchVto },
        arca: response,
        localError: error instanceof Error ? error.message : String(error)
      }
    }
  }

  calculateTotals(items) {
    const total = money(items.reduce((sum, item) => sum + Number(item.importe || 0), 0), 'total')
    const neto = money(
      items.reduce((sum, item) => sum + Number(item.importe || 0) / (1 + Number(item.tasa_iva || 0) / 100), 0),
      'neto'
    )
    return {
      subtotal: neto,
      iva: money(total - neto, 'iva'),
      total
    }
  }
}

module.exports = {
  MovimientosRepository,
  MovimientosService
}
