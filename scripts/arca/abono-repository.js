function sqlString(value) {
  return String(value).replace(/'/g, "''")
}

function assertIsoDate(value, name) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${name} must use YYYY-MM-DD format.`)
  }
  return raw
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value || '1'), 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
    throw new Error('limit must be between 1 and 1000.')
  }
  return parsed
}

const DEFAULT_IGNORED_ABONO_CLIENTS = [1130, 2537]

function getIgnoredAbonoClients() {
  const configured = String(process.env.PATNAV_ABONOS_IGNORED_CLIENTS || '')
    .split(',')
    .map(value => Number.parseInt(value.trim(), 10))
    .filter(value => Number.isFinite(value) && value > 0)

  return Array.from(new Set([...DEFAULT_IGNORED_ABONO_CLIENTS, ...configured])).sort((a, b) => a - b)
}

function ignoredClientPredicate(alias = 'c') {
  const ignored = getIgnoredAbonoClients()
  if (!ignored.length) {
    return '1 = 0'
  }
  return `${alias}.cod_cliente IN (${ignored.join(', ')})`
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function periodFromDate(value) {
  const date = new Date(`${assertIsoDate(value, 'period date')}T00:00:00Z`)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))

  return {
    yyyymm: `${year}${String(month + 1).padStart(2, '0')}`,
    firstDate: first.toISOString().slice(0, 10),
    lastDate: last.toISOString().slice(0, 10)
  }
}

function dateForDayInMonth(monthDate, day) {
  const parsedDay = Number(day)
  if (!Number.isFinite(parsedDay) || parsedDay < 1 || parsedDay > 31) {
    throw new Error(`Invalid dia_facturacion_abono: ${day}`)
  }
  const date = new Date(`${assertIsoDate(monthDate, 'month date')}T00:00:00Z`)
  const candidate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), parsedDay))
  if (candidate.getUTCMonth() !== date.getUTCMonth()) {
    candidate.setUTCMonth(date.getUTCMonth() + 1, 0)
  }
  return candidate.toISOString().slice(0, 10)
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

class AbonoRepository {
  constructor(sql) {
    this.sql = sql
  }

  findCandidates({ desde, hasta, limit = 1 }) {
    const desdeDate = assertIsoDate(desde, 'desde')
    const hastaDate = assertIsoDate(hasta, 'hasta')
    const maxRows = parseLimit(limit)
    const ignoredPredicate = ignoredClientPredicate('c')

    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(desdeDate)}';
DECLARE @hasta date = '${sqlString(hastaDate)}';

WITH candidates AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
    NULLIF(LTRIM(RTRIM(c.dom_fiscal1)), '') AS dom_fiscal1,
    CAST(c.cuit AS varchar(20)) AS cuit,
    CAST(c.estado AS int) AS cliente_estado,
    CAST(c.tipo_cliente AS int) AS tipo_cliente,
    CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
    NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
    NULLIF(LTRIM(RTRIM(ci.categoria)), '') AS categoria_iva,
    NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
    CAST(le.dia_facturacion_abono AS int) AS dia_facturacion_abono,
    CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS lugar_fecha_fin_contrato,
    CONVERT(varchar(10), DATEFROMPARTS(
      YEAR(@desde),
      MONTH(@desde),
      CASE
        WHEN le.dia_facturacion_abono > DAY(EOMONTH(@desde)) THEN DAY(EOMONTH(@desde))
        ELSE le.dia_facturacion_abono
      END
    ), 23) AS fecha_vencimiento,
    COUNT(DISTINCT d.cod_dispenser) AS dispensers_asignados,
    SUM(COALESCE(i.precio, 0)) AS total_bruto
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  INNER JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  INNER JOIN dbo.Dispenser AS d
    ON d.cod_cliente = le.cod_cliente
   AND d.nro_lugar_entrega = le.nro_lugar_entrega
  INNER JOIN dbo.Item AS i
    ON i.cod_item = d.cod_abono_o_alquiler
  WHERE c.tipo_cliente = 1
    AND NOT (${ignoredPredicate})
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
    AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
    AND d.cod_abono_o_alquiler IS NOT NULL
    AND le.dia_facturacion_abono BETWEEN DAY(@desde) AND DAY(@hasta)
    AND @desde <= @hasta
    AND YEAR(@desde) = YEAR(@hasta)
    AND MONTH(@desde) = MONTH(@hasta)
  GROUP BY
    c.cod_cliente,
    le.nro_lugar_entrega,
    c.razon_social,
    c.dom_fiscal1,
    c.cuit,
    c.estado,
    c.tipo_cliente,
    c.tipo_fact_ctacte,
    c.cod_categoria,
    ci.categoria,
    ci.tipofactura,
    le.dia_facturacion_abono,
    le.fecha_fin_contrato
),
existing_abonos AS (
  SELECT
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento) AS fecha_vencimiento,
    COUNT_BIG(DISTINCT CONCAT(v.tipo_comprobante, '|', v.prefijo, '|', v.numero)) AS existing_abono_count
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE CONVERT(date, v.fecha_vencimiento) BETWEEN @desde AND @hasta
    AND vi.litros_abonados > 0
  GROUP BY
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento)
),
ready AS (
  SELECT c.*
  FROM candidates AS c
  LEFT JOIN existing_abonos AS existing
    ON existing.cod_cliente = c.cod_cliente
   AND existing.nro_lugar_entrega = c.nro_lugar_entrega
   AND existing.fecha_vencimiento = CONVERT(date, c.fecha_vencimiento)
  WHERE c.total_bruto > 0
    AND COALESCE(existing.existing_abono_count, 0) = 0
)
SELECT TOP (${maxRows}) *
FROM ready
ORDER BY dia_facturacion_abono, cod_cliente, nro_lugar_entrega
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  findCandidatePool({ desde, hasta, limit = 50 }) {
    return this.findCandidates({ desde, hasta, limit })
  }

  getRangePreview({ desde, hasta, limit = 250, periodoDate }) {
    const desdeDate = assertIsoDate(desde, 'desde')
    const hastaDate = assertIsoDate(hasta, 'hasta')
    const maxRows = parseLimit(limit)
    const period = periodFromDate(periodoDate || desdeDate)
    const ignoredPredicate = ignoredClientPredicate('c')

    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(desdeDate)}';
DECLARE @hasta date = '${sqlString(hastaDate)}';
DECLARE @periodo_desde date = '${sqlString(period.firstDate)}';

WITH candidates AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
    NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
    CONVERT(varchar(10), DATEFROMPARTS(
      YEAR(@periodo_desde),
      MONTH(@periodo_desde),
      CASE
        WHEN le.dia_facturacion_abono > DAY(EOMONTH(@periodo_desde)) THEN DAY(EOMONTH(@periodo_desde))
        ELSE le.dia_facturacion_abono
      END
    ), 23) AS fecha_vencimiento,
    COUNT(DISTINCT d.cod_dispenser) AS dispensers,
    COUNT(DISTINCT i.cod_item) AS items,
    SUM(COALESCE(i.precio, 0)) AS total_bruto,
    CASE WHEN ${ignoredPredicate} THEN 1 ELSE 0 END AS ignorado_manual
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  INNER JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  INNER JOIN dbo.Dispenser AS d
    ON d.cod_cliente = le.cod_cliente
   AND d.nro_lugar_entrega = le.nro_lugar_entrega
  INNER JOIN dbo.Item AS i
    ON i.cod_item = d.cod_abono_o_alquiler
  WHERE c.tipo_cliente = 1
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
    AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
    AND d.cod_abono_o_alquiler IS NOT NULL
    AND le.dia_facturacion_abono BETWEEN DAY(@desde) AND DAY(@hasta)
    AND @desde <= @hasta
    AND YEAR(@desde) = YEAR(@hasta)
    AND MONTH(@desde) = MONTH(@hasta)
  GROUP BY
    c.cod_cliente,
    le.nro_lugar_entrega,
    c.razon_social,
    ci.tipofactura,
    le.dia_facturacion_abono
),
existing_abonos AS (
  SELECT
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento) AS fecha_vencimiento,
    COUNT_BIG(DISTINCT CONCAT(v.tipo_comprobante, '|', v.prefijo, '|', v.numero)) AS existing_abono_count
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE CONVERT(date, v.fecha_vencimiento) BETWEEN @desde AND @hasta
    AND vi.litros_abonados > 0
  GROUP BY
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento)
),
with_duplicates AS (
  SELECT
    c.*,
    COALESCE(existing.existing_abono_count, 0) AS existing_abono_count
  FROM candidates AS c
  LEFT JOIN existing_abonos AS existing
    ON existing.cod_cliente = c.cod_cliente
   AND existing.nro_lugar_entrega = c.nro_lugar_entrega
   AND existing.fecha_vencimiento = CONVERT(date, c.fecha_vencimiento)
)
SELECT
  JSON_QUERY((
    SELECT
      SUM(CASE WHEN ignorado_manual = 0 THEN 1 ELSE 0 END) AS total_candidatos,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'A' THEN 1 ELSE 0 END) AS fa_electronicas,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'A' THEN total_bruto ELSE 0 END) AS total_fa,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'B' THEN 1 ELSE 0 END) AS fb_electronicas,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'B' THEN total_bruto ELSE 0 END) AS total_fb,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'C' THEN 1 ELSE 0 END) AS fc4_internas,
      SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'C' THEN total_bruto ELSE 0 END) AS total_fc4,
      SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count > 0 THEN 1 ELSE 0 END) AS duplicados,
      SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count = 0 AND total_bruto <= 0 THEN 1 ELSE 0 END) AS total_bruto_no_positivo,
      SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count = 0 AND total_bruto > 0 AND tipofactura IN ('A', 'B', 'C') THEN 1 ELSE 0 END) AS listos,
      SUM(CASE WHEN ignorado_manual = 0 AND (tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL) THEN 1 ELSE 0 END) AS tipofactura_desconocida,
      SUM(CASE WHEN ignorado_manual = 1 THEN 1 ELSE 0 END) AS ignorados_manuales
    FROM with_duplicates
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
  )) AS resumen,
  JSON_QUERY((
    SELECT TOP (${maxRows})
      cod_cliente,
      nro_lugar_entrega,
      razon_social,
      CASE
        WHEN tipofactura = 'A' THEN 'FA'
        WHEN tipofactura = 'B' THEN 'FB'
        WHEN tipofactura = 'C' THEN 'FC'
        ELSE COALESCE(tipofactura, 'REVISAR')
      END AS tipo_comprobante,
      CASE WHEN tipofactura IN ('A', 'B') THEN 7 WHEN tipofactura = 'C' THEN 4 ELSE NULL END AS prefijo_destino,
      CASE WHEN tipofactura IN ('A', 'B') THEN 'arca' WHEN tipofactura = 'C' THEN 'interno' ELSE 'revisar' END AS destino_facturacion,
      dispensers,
      items,
      '${period.yyyymm}' AS periodo,
      total_bruto,
      CASE
        WHEN tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL THEN 'descartado'
        WHEN existing_abono_count > 0 THEN 'descartado'
        WHEN total_bruto <= 0 THEN 'descartado'
        ELSE 'listo'
      END AS estado_preview,
      CASE
        WHEN tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL THEN 'categoria IVA desconocida'
        WHEN existing_abono_count > 0 THEN 'duplicidad de abono'
        WHEN total_bruto <= 0 THEN 'total bruto no positivo'
        ELSE NULL
      END AS motivo_preview
    FROM with_duplicates
    WHERE ignorado_manual = 0
    ORDER BY
      CASE WHEN tipofactura = 'A' THEN 0 WHEN tipofactura = 'B' THEN 1 WHEN tipofactura = 'C' THEN 2 ELSE 3 END,
      estado_preview DESC,
      cod_cliente,
      nro_lugar_entrega
    FOR JSON PATH, INCLUDE_NULL_VALUES
  )) AS candidatos
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    ) || { resumen: {}, candidatos: [] }
  }

  findEvaluatedCandidatePool({ desde, hasta, limit = 250, periodoDate }) {
    const desdeDate = assertIsoDate(desde, 'desde')
    const hastaDate = assertIsoDate(hasta, 'hasta')
    const maxRows = parseLimit(limit)
    const period = periodFromDate(periodoDate || desdeDate)
    const ignoredPredicate = ignoredClientPredicate('c')

    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(desdeDate)}';
DECLARE @hasta date = '${sqlString(hastaDate)}';
DECLARE @periodo_desde date = '${sqlString(period.firstDate)}';

WITH candidates AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
    NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
    CONVERT(varchar(10), DATEFROMPARTS(
      YEAR(@periodo_desde),
      MONTH(@periodo_desde),
      CASE
        WHEN le.dia_facturacion_abono > DAY(EOMONTH(@periodo_desde)) THEN DAY(EOMONTH(@periodo_desde))
        ELSE le.dia_facturacion_abono
      END
    ), 23) AS fecha_vencimiento,
    COUNT(DISTINCT d.cod_dispenser) AS dispensers,
    COUNT(DISTINCT i.cod_item) AS items,
    SUM(COALESCE(i.precio, 0)) AS total_bruto
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  INNER JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  INNER JOIN dbo.Dispenser AS d
    ON d.cod_cliente = le.cod_cliente
   AND d.nro_lugar_entrega = le.nro_lugar_entrega
  INNER JOIN dbo.Item AS i
    ON i.cod_item = d.cod_abono_o_alquiler
  WHERE c.tipo_cliente = 1
    AND NOT (${ignoredPredicate})
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
    AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
    AND d.cod_abono_o_alquiler IS NOT NULL
    AND le.dia_facturacion_abono BETWEEN DAY(@desde) AND DAY(@hasta)
    AND @desde <= @hasta
    AND YEAR(@desde) = YEAR(@hasta)
    AND MONTH(@desde) = MONTH(@hasta)
  GROUP BY
    c.cod_cliente,
    le.nro_lugar_entrega,
    c.razon_social,
    ci.tipofactura,
    le.dia_facturacion_abono
),
existing_abonos AS (
  SELECT
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento) AS fecha_vencimiento,
    COUNT_BIG(DISTINCT CONCAT(v.tipo_comprobante, '|', v.prefijo, '|', v.numero)) AS existing_abono_count
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE CONVERT(date, v.fecha_vencimiento) BETWEEN @desde AND @hasta
    AND vi.litros_abonados > 0
  GROUP BY
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento)
),
with_duplicates AS (
  SELECT
    c.*,
    COALESCE(existing.existing_abono_count, 0) AS existing_abono_count
  FROM candidates AS c
  LEFT JOIN existing_abonos AS existing
    ON existing.cod_cliente = c.cod_cliente
   AND existing.nro_lugar_entrega = c.nro_lugar_entrega
   AND existing.fecha_vencimiento = CONVERT(date, c.fecha_vencimiento)
)
SELECT TOP (${maxRows})
  cod_cliente,
  nro_lugar_entrega,
  razon_social,
  CASE
    WHEN tipofactura = 'A' THEN 'FA'
    WHEN tipofactura = 'B' THEN 'FB'
    WHEN tipofactura = 'C' THEN 'FC'
    ELSE COALESCE(tipofactura, 'REVISAR')
  END AS tipo_comprobante,
  CASE WHEN tipofactura IN ('A', 'B') THEN 7 WHEN tipofactura = 'C' THEN 4 ELSE NULL END AS prefijo_destino,
  CASE WHEN tipofactura IN ('A', 'B') THEN 'arca' WHEN tipofactura = 'C' THEN 'interno' ELSE 'revisar' END AS destino_facturacion,
  dispensers,
  items,
  '${period.yyyymm}' AS periodo,
  total_bruto,
  CASE
    WHEN tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL THEN 'descartado'
    WHEN existing_abono_count > 0 THEN 'descartado'
    WHEN total_bruto <= 0 THEN 'descartado'
    ELSE 'listo'
  END AS estado_preview,
  CASE
    WHEN tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL THEN 'categoria IVA desconocida'
    WHEN existing_abono_count > 0 THEN 'duplicidad de abono'
    WHEN total_bruto <= 0 THEN 'total bruto no positivo'
    ELSE NULL
  END AS motivo_preview
FROM with_duplicates
ORDER BY
  CASE WHEN tipofactura = 'A' THEN 0 WHEN tipofactura = 'B' THEN 1 WHEN tipofactura = 'C' THEN 2 ELSE 3 END,
  estado_preview DESC,
  cod_cliente,
  nro_lugar_entrega
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getRangeSummary({ desde, hasta, periodoDate }) {
    const desdeDate = assertIsoDate(desde, 'desde')
    const hastaDate = assertIsoDate(hasta, 'hasta')
    const period = periodFromDate(periodoDate || desdeDate)
    const ignoredPredicate = ignoredClientPredicate('c')

    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(desdeDate)}';
DECLARE @hasta date = '${sqlString(hastaDate)}';
DECLARE @periodo_desde date = '${sqlString(period.firstDate)}';

WITH candidates AS (
  SELECT
    c.cod_cliente,
    le.nro_lugar_entrega,
    NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
    CONVERT(varchar(10), DATEFROMPARTS(
      YEAR(@periodo_desde),
      MONTH(@periodo_desde),
      CASE
        WHEN le.dia_facturacion_abono > DAY(EOMONTH(@periodo_desde)) THEN DAY(EOMONTH(@periodo_desde))
        ELSE le.dia_facturacion_abono
      END
    ), 23) AS fecha_vencimiento,
    COUNT(DISTINCT d.cod_dispenser) AS dispensers,
    SUM(COALESCE(i.precio, 0)) AS total_bruto,
    CASE WHEN ${ignoredPredicate} THEN 1 ELSE 0 END AS ignorado_manual
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  INNER JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  INNER JOIN dbo.Dispenser AS d
    ON d.cod_cliente = le.cod_cliente
   AND d.nro_lugar_entrega = le.nro_lugar_entrega
  INNER JOIN dbo.Item AS i
    ON i.cod_item = d.cod_abono_o_alquiler
  WHERE c.tipo_cliente = 1
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
    AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
    AND d.cod_abono_o_alquiler IS NOT NULL
    AND le.dia_facturacion_abono BETWEEN DAY(@desde) AND DAY(@hasta)
    AND @desde <= @hasta
    AND YEAR(@desde) = YEAR(@hasta)
    AND MONTH(@desde) = MONTH(@hasta)
  GROUP BY
    c.cod_cliente,
    le.nro_lugar_entrega,
    ci.tipofactura,
    le.dia_facturacion_abono
),
existing_abonos AS (
  SELECT
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento) AS fecha_vencimiento,
    COUNT_BIG(DISTINCT CONCAT(v.tipo_comprobante, '|', v.prefijo, '|', v.numero)) AS existing_abono_count
  FROM dbo.Ventas AS v
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE CONVERT(date, v.fecha_vencimiento) BETWEEN @desde AND @hasta
    AND vi.litros_abonados > 0
  GROUP BY
    v.cod_cliente,
    v.nro_lugar_entrega,
    CONVERT(date, v.fecha_vencimiento)
),
with_duplicates AS (
  SELECT
    c.*,
    COALESCE(existing.existing_abono_count, 0) AS existing_abono_count
  FROM candidates AS c
  LEFT JOIN existing_abonos AS existing
    ON existing.cod_cliente = c.cod_cliente
   AND existing.nro_lugar_entrega = c.nro_lugar_entrega
   AND existing.fecha_vencimiento = CONVERT(date, c.fecha_vencimiento)
)
SELECT
  SUM(CASE WHEN ignorado_manual = 0 THEN 1 ELSE 0 END) AS total_candidatos,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'A' THEN 1 ELSE 0 END) AS fa_electronicas,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'A' THEN total_bruto ELSE 0 END) AS total_fa,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'B' THEN 1 ELSE 0 END) AS fb_electronicas,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'B' THEN total_bruto ELSE 0 END) AS total_fb,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'C' THEN 1 ELSE 0 END) AS fc4_internas,
  SUM(CASE WHEN ignorado_manual = 0 AND tipofactura = 'C' THEN total_bruto ELSE 0 END) AS total_fc4,
  SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count > 0 THEN 1 ELSE 0 END) AS duplicados,
  SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count = 0 AND total_bruto <= 0 THEN 1 ELSE 0 END) AS total_bruto_no_positivo,
  SUM(CASE WHEN ignorado_manual = 0 AND existing_abono_count = 0 AND total_bruto > 0 AND tipofactura IN ('A', 'B', 'C') THEN 1 ELSE 0 END) AS listos,
  SUM(CASE WHEN ignorado_manual = 0 AND (tipofactura NOT IN ('A', 'B', 'C') OR tipofactura IS NULL) THEN 1 ELSE 0 END) AS tipofactura_desconocida,
  SUM(CASE WHEN ignorado_manual = 1 THEN 1 ELSE 0 END) AS ignorados_manuales
FROM with_duplicates
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    ) || {
      total_candidatos: 0,
      fa_electronicas: 0,
      total_fa: 0,
      fb_electronicas: 0,
      total_fb: 0,
      fc4_internas: 0,
      total_fc4: 0,
      duplicados: 0,
      total_bruto_no_positivo: 0,
      listos: 0,
      tipofactura_desconocida: 0,
      ignorados_manuales: 0
    }
  }

  getSelectionDiscardAudit({ desde, hasta, periodoDate }) {
    const desdeDate = assertIsoDate(desde, 'desde')
    const hastaDate = assertIsoDate(hasta, 'hasta')
    const period = periodFromDate(periodoDate || desdeDate)
    const ignoredPredicate = ignoredClientPredicate('c')

    return this.sql.queryJson(
      forJson(`
DECLARE @desde date = '${sqlString(desdeDate)}';
DECLARE @hasta date = '${sqlString(hastaDate)}';
DECLARE @periodo_desde date = '${sqlString(period.firstDate)}';

WITH base AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
    CAST(c.estado AS int) AS cliente_estado,
    CAST(c.tipo_cliente AS int) AS tipo_cliente,
    CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS lugar_fecha_fin_contrato,
    CAST(le.dia_facturacion_abono AS int) AS dia_facturacion_abono,
    NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
    NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
    CONVERT(varchar(10), DATEFROMPARTS(
      YEAR(@periodo_desde),
      MONTH(@periodo_desde),
      CASE
        WHEN le.dia_facturacion_abono > DAY(EOMONTH(@periodo_desde)) THEN DAY(EOMONTH(@periodo_desde))
        ELSE le.dia_facturacion_abono
      END
    ), 23) AS fecha_vencimiento,
    COALESCE(valid_dispensers.valid_dispenser_count, 0) AS valid_dispenser_count,
    COALESCE(existing_abonos.existing_abono_count, 0) AS existing_abono_count,
    CASE WHEN ${ignoredPredicate} THEN 1 ELSE 0 END AS ignorado_manual
  FROM dbo.LugarEntrega AS le
  INNER JOIN dbo.Cliente AS c
    ON c.cod_cliente = le.cod_cliente
  LEFT JOIN dbo.CategoriaIva AS ci
    ON ci.cod_categoria = c.cod_categoria
  OUTER APPLY (
    SELECT COUNT_BIG(1) AS valid_dispenser_count
    FROM dbo.Dispenser AS d
    INNER JOIN dbo.Item AS i
      ON i.cod_item = d.cod_abono_o_alquiler
    WHERE d.cod_cliente = le.cod_cliente
      AND d.nro_lugar_entrega = le.nro_lugar_entrega
      AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
      AND d.cod_abono_o_alquiler IS NOT NULL
  ) AS valid_dispensers
  OUTER APPLY (
    SELECT COUNT_BIG(DISTINCT CONCAT(v.tipo_comprobante, '|', v.prefijo, '|', v.numero)) AS existing_abono_count
    FROM dbo.Ventas AS v
    INNER JOIN dbo.VentasItems AS vi
      ON vi.tipo_comprobante = v.tipo_comprobante
     AND vi.prefijo = v.prefijo
     AND vi.numero = v.numero
    WHERE v.cod_cliente = le.cod_cliente
      AND v.nro_lugar_entrega = le.nro_lugar_entrega
      AND CONVERT(date, v.fecha_vencimiento) = DATEFROMPARTS(
        YEAR(@periodo_desde),
        MONTH(@periodo_desde),
        CASE
          WHEN le.dia_facturacion_abono > DAY(EOMONTH(@periodo_desde)) THEN DAY(EOMONTH(@periodo_desde))
          ELSE le.dia_facturacion_abono
        END
      )
      AND vi.litros_abonados > 0
  ) AS existing_abonos
  WHERE le.dia_facturacion_abono BETWEEN DAY(@desde) AND DAY(@hasta)
    AND @desde <= @hasta
    AND YEAR(@desde) = YEAR(@hasta)
    AND MONTH(@desde) = MONTH(@hasta)
)
SELECT TOP (200)
  cod_cliente,
  nro_lugar_entrega,
  razon_social,
  cliente_estado,
  tipo_cliente,
  lugar_fecha_fin_contrato,
  ignorado_manual,
  dia_facturacion_abono,
  cod_categoria,
  tipofactura,
  fecha_vencimiento,
  valid_dispenser_count,
  existing_abono_count
FROM base
WHERE cliente_estado <> 0
   OR lugar_fecha_fin_contrato IS NOT NULL
   OR tipo_cliente <> 1
   OR ignorado_manual = 1
   OR valid_dispenser_count = 0
   OR existing_abono_count > 0
ORDER BY
  CASE WHEN existing_abono_count > 0 THEN 0 ELSE 1 END,
  dia_facturacion_abono,
  cod_cliente,
  nro_lugar_entrega
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getAbonoCandidate({ codCliente, nroLugarEntrega, periodoDate }) {
    const parsedCodCliente = Number.parseInt(String(codCliente), 10)
    const parsedNroLugar = Number.parseInt(String(nroLugarEntrega), 10)
    if (!Number.isFinite(parsedCodCliente) || !Number.isFinite(parsedNroLugar)) {
      throw new Error('codCliente and nroLugarEntrega must be integers.')
    }
    if (getIgnoredAbonoClients().includes(parsedCodCliente)) {
      throw new Error(`Client ${parsedCodCliente} is manually ignored for abonos.`)
    }
    const period = periodFromDate(periodoDate)

    const header = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(c.cod_cliente AS int) AS cod_cliente,
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal1)), '') AS dom_fiscal1,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal2)), '') AS dom_fiscal2,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal3)), '') AS dom_fiscal3,
  CAST(c.cuit AS varchar(20)) AS cuit,
  CAST(c.estado AS int) AS cliente_estado,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
  NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(ci.categoria)), '') AS categoria_iva,
  NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura,
  CAST(le.dia_facturacion_abono AS int) AS dia_facturacion_abono,
  CONVERT(varchar(10), le.fecha_fin_contrato, 23) AS lugar_fecha_fin_contrato,
  NULLIF(LTRIM(RTRIM(le.email)), '') AS email,
  NULLIF(LTRIM(RTRIM(ca.nombre)), '') AS calle,
  CAST(le.numeropuerta AS int) AS numeropuerta,
  NULLIF(LTRIM(RTRIM(le.observ_domicilio)), '') AS observ_domicilio,
  NULLIF(LTRIM(RTRIM(m.nombre)), '') AS municipio
FROM dbo.Cliente AS c
INNER JOIN dbo.LugarEntrega AS le
  ON le.cod_cliente = c.cod_cliente
INNER JOIN dbo.CategoriaIva AS ci
  ON ci.cod_categoria = c.cod_categoria
LEFT JOIN dbo.Calle AS ca
  ON ca.cod_municipio = le.cod_municipio
 AND ca.cod_calle = le.cod_calle
LEFT JOIN dbo.Municipio AS m
  ON m.cod_municipio = le.cod_municipio
WHERE c.cod_cliente = ${parsedCodCliente}
  AND le.nro_lugar_entrega = ${parsedNroLugar}
  AND c.tipo_cliente = 1
  AND c.estado = 0
  AND le.fecha_fin_contrato IS NULL
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )

    if (!header) {
      throw new Error('No eligible abono client/location was found.')
    }

    const dispensers = this.sql.queryJson(
      forJson(`
SELECT
  CAST(d.cod_dispenser AS int) AS cod_dispenser,
  NULLIF(LTRIM(RTRIM(d.nro_serie)), '') AS nro_serie,
  CAST(d.cod_tipo AS int) AS cod_tipo,
  NULLIF(LTRIM(RTRIM(td.denominacion)), '') AS tipo_dispenser,
  NULLIF(LTRIM(RTRIM(d.marca)), '') AS marca,
  CAST(d.estado AS int) AS estado,
  CAST(d.cod_abono_o_alquiler AS int) AS cod_abono_o_alquiler,
  NULLIF(LTRIM(RTRIM(d.MControl2)), '') AS mcontrol2,
  CONVERT(varchar(10), d.fecha_inicio_contrato, 23) AS fecha_inicio_contrato,
  CONVERT(varchar(10), d.fecha_fin_contrato, 23) AS fecha_fin_contrato,
  CAST(i.cod_item AS int) AS cod_item,
  NULLIF(LTRIM(RTRIM(i.denominacion)), '') AS denominacion,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS denom_corto,
  CAST(i.precio AS decimal(18, 6)) AS precio,
  CAST(i.tasa_iva AS decimal(18, 6)) AS tasa_iva,
  CAST(i.litros_abonados AS decimal(18, 6)) AS litros_abonados,
  NULLIF(LTRIM(RTRIM(i.tipo_item)), '') AS tipo_item
FROM dbo.Dispenser AS d
INNER JOIN dbo.Item AS i
  ON i.cod_item = d.cod_abono_o_alquiler
LEFT JOIN dbo.TipoDispenser AS td
  ON td.cod_tipo = d.cod_tipo
WHERE d.cod_cliente = ${parsedCodCliente}
  AND d.nro_lugar_entrega = ${parsedNroLugar}
  AND LTRIM(RTRIM(COALESCE(d.MControl2, ''))) = 'S'
  AND d.cod_abono_o_alquiler IS NOT NULL
ORDER BY d.cod_abono_o_alquiler, d.cod_dispenser
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []

    const existing = this.findExistingAbonos({
      codCliente: parsedCodCliente,
      nroLugarEntrega: parsedNroLugar,
      fechaVencimiento: dateForDayInMonth(period.firstDate, header.dia_facturacion_abono)
    })

    return {
      period,
      header: {
        ...header,
        tipo_comprobante:
          header.tipofactura === 'A' ? 'FA' : header.tipofactura === 'C' ? 'FC' : 'FB',
        prefijo_destino:
          header.tipofactura === 'A' || header.tipofactura === 'B'
            ? 7
            : header.tipofactura === 'C'
              ? 4
              : null,
        fecha_vencimiento: dateForDayInMonth(period.firstDate, header.dia_facturacion_abono)
      },
      dispensers,
      existingAbonos: existing
    }
  }

  findExistingAbonos({ codCliente, nroLugarEntrega, fechaVencimiento }) {
    const parsedCodCliente = Number.parseInt(String(codCliente), 10)
    const parsedNroLugar = Number.parseInt(String(nroLugarEntrega), 10)
    const date = assertIsoDate(fechaVencimiento, 'fechaVencimiento')

    return this.sql.queryJson(
      forJson(`
SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(10), v.fecha_operacion, 23) AS fecha_operacion,
  CONVERT(varchar(10), v.fecha_vencimiento, 23) AS fecha_vencimiento,
  NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae,
  SUM(COALESCE(vi.importe, 0)) AS total
FROM dbo.Ventas AS v
INNER JOIN dbo.VentasItems AS vi
  ON vi.tipo_comprobante = v.tipo_comprobante
 AND vi.prefijo = v.prefijo
 AND vi.numero = v.numero
WHERE v.cod_cliente = ${parsedCodCliente}
  AND v.nro_lugar_entrega = ${parsedNroLugar}
  AND CONVERT(date, v.fecha_vencimiento) = '${sqlString(date)}'
  AND vi.litros_abonados > 0
GROUP BY
  v.tipo_comprobante,
  v.prefijo,
  v.numero,
  v.fecha_operacion,
  v.fecha_vencimiento,
  v.cae
ORDER BY v.tipo_comprobante, v.prefijo, v.numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  insertAuthorizedAbono({ abono, arcaResult }) {
    const ptoVta = Number(arcaResult.ptoVta)
    const cbteNro = Number(arcaResult.cbteNro)
    const cae = String(arcaResult.cae || '').trim()
    const caeFchVto = normalizeCaeFchVto(arcaResult.caeFchVto)
    const fechaOperacion = assertIsoDate(abono.fechaEmision, 'fechaEmision')
    const fechaVencimiento = assertIsoDate(abono.fechaVencimiento, 'fechaVencimiento')
    const tipoComprobante = String(abono.tipoComprobante || '').trim().toUpperCase()

    if (!['FA', 'FB'].includes(tipoComprobante)) {
      throw new Error('Only FA/FB abonos can be inserted by this flow.')
    }
    const expectedPtoVta = Number(abono.fiscalClassification && abono.fiscalClassification.prefijo)
    if (ptoVta !== expectedPtoVta) {
      throw new Error(`ARCA ptoVta ${ptoVta} does not match expected prefijo ${expectedPtoVta}.`)
    }
    if (!Number.isFinite(cbteNro) || cbteNro <= 0 || !cae) {
      throw new Error('ARCA approval is missing cbteNro or cae.')
    }
    if (this.findExistingAbonos({
      codCliente: abono.codCliente,
      nroLugarEntrega: abono.nroLugarEntrega,
      fechaVencimiento
    }).length > 0) {
      throw new Error('An abono already exists for this client/location/period.')
    }

    const itemValues = abono.items
      .map(item => `(
        '${sqlString(tipoComprobante)}',
        ${ptoVta},
        ${cbteNro},
        ${Number(item.orden)},
        ${Number(item.codItem)},
        ${Number(item.cantidad)},
        ${Number(item.precioBruto)},
        ${Number(item.importeBruto)},
        ${Number(item.tasaIva)},
        ${Number(item.litrosAbonados)}
      )`)
      .join(',\n')

    const batch = `
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = '${sqlString(tipoComprobante)}'
    AND prefijo = ${ptoVta}
    AND numero = ${cbteNro}
)
BEGIN
  THROW 51000, 'Authorized abono invoice already exists in Ventas.', 1;
END;

INSERT INTO dbo.Ventas
(
  tipo_comprobante,
  prefijo,
  numero,
  fecha_operacion,
  cod_cliente,
  nro_lugar_entrega,
  fecha_vencimiento,
  cae,
  fecha_vencimiento_cae,
  tipo_facturacion,
  numero_ci
)
VALUES
(
  '${sqlString(tipoComprobante)}',
  ${ptoVta},
  ${cbteNro},
  '${sqlString(fechaOperacion)}',
  ${Number(abono.codCliente)},
  ${Number(abono.nroLugarEntrega)},
  '${sqlString(fechaVencimiento)}',
  '${sqlString(cae)}',
  '${sqlString(caeFchVto)}',
  ${Number(abono.tipoFacturacion)},
  NULL
);

INSERT INTO dbo.VentasItems
(
  tipo_comprobante,
  prefijo,
  numero,
  orden,
  cod_item,
  cantidad,
  precio,
  importe,
  tasa_iva,
  litros_abonados
)
VALUES
${itemValues};

COMMIT TRANSACTION;

SELECT
  '${sqlString(tipoComprobante)}' AS tipo_comprobante,
  ${ptoVta} AS prefijo,
  ${cbteNro} AS numero
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`

    return this.sql.executeWriteBatch(batch)
  }

  insertInternalAbono({ abono }) {
    const tipoComprobante = String(abono.tipoComprobante || '').trim().toUpperCase()
    const prefijo = Number(abono.fiscalClassification && abono.fiscalClassification.prefijo)
    const fechaOperacion = assertIsoDate(abono.fechaEmision, 'fechaEmision')
    const fechaVencimiento = assertIsoDate(abono.fechaVencimiento, 'fechaVencimiento')

    if (tipoComprobante !== 'FC' || prefijo !== 4) {
      throw new Error('Only internal FC/4 abonos can be inserted by this flow.')
    }
    if (this.findExistingAbonos({
      codCliente: abono.codCliente,
      nroLugarEntrega: abono.nroLugarEntrega,
      fechaVencimiento
    }).length > 0) {
      throw new Error('An abono already exists for this client/location/period.')
    }

    const itemValues = abono.items
      .map(item => `(
        '${sqlString(tipoComprobante)}',
        ${prefijo},
        @numero,
        ${Number(item.orden)},
        ${Number(item.codItem)},
        ${Number(item.cantidad)},
        ${Number(item.precioBruto)},
        ${Number(item.importeBruto)},
        ${Number(item.tasaIva)},
        ${Number(item.litrosAbonados)}
      )`)
      .join(',\n')

    const batch = `
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @numero int;

SELECT @numero = COALESCE(CAST(ult_numero AS int), 0) + 1
FROM dbo.Talonario WITH (UPDLOCK, HOLDLOCK)
WHERE tipo_comprobante = '${sqlString(tipoComprobante)}'
  AND prefijo = ${prefijo};

IF @numero IS NULL
BEGIN
  THROW 51002, 'Missing Talonario row for internal FC/4 abono.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE tipo_comprobante = '${sqlString(tipoComprobante)}'
    AND prefijo = ${prefijo}
    AND numero = @numero
)
BEGIN
  THROW 51003, 'Next internal FC/4 number already exists in Ventas.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM dbo.Ventas AS v WITH (UPDLOCK, HOLDLOCK)
  INNER JOIN dbo.VentasItems AS vi
    ON vi.tipo_comprobante = v.tipo_comprobante
   AND vi.prefijo = v.prefijo
   AND vi.numero = v.numero
  WHERE v.cod_cliente = ${Number(abono.codCliente)}
    AND v.nro_lugar_entrega = ${Number(abono.nroLugarEntrega)}
    AND CONVERT(date, v.fecha_vencimiento) = '${sqlString(fechaVencimiento)}'
    AND vi.litros_abonados > 0
)
BEGIN
  THROW 51001, 'An abono already exists for this client/location/period.', 1;
END;

INSERT INTO dbo.Ventas
(
  tipo_comprobante,
  prefijo,
  numero,
  fecha_operacion,
  cod_cliente,
  nro_lugar_entrega,
  fecha_vencimiento,
  cae,
  fecha_vencimiento_cae,
  tipo_facturacion,
  numero_ci
)
VALUES
(
  '${sqlString(tipoComprobante)}',
  ${prefijo},
  @numero,
  '${sqlString(fechaOperacion)}',
  ${Number(abono.codCliente)},
  ${Number(abono.nroLugarEntrega)},
  '${sqlString(fechaVencimiento)}',
  NULL,
  NULL,
  ${Number(abono.tipoFacturacion)},
  NULL
);

INSERT INTO dbo.VentasItems
(
  tipo_comprobante,
  prefijo,
  numero,
  orden,
  cod_item,
  cantidad,
  precio,
  importe,
  tasa_iva,
  litros_abonados
)
VALUES
${itemValues};

UPDATE dbo.Talonario
SET ult_numero = @numero
WHERE tipo_comprobante = '${sqlString(tipoComprobante)}'
  AND prefijo = ${prefijo};

COMMIT TRANSACTION;

SELECT
  '${sqlString(tipoComprobante)}' AS tipo_comprobante,
  ${prefijo} AS prefijo,
  @numero AS numero
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`

    return this.sql.executeWriteBatch(batch)
  }
}

module.exports = {
  AbonoRepository,
  assertIsoDate,
  periodFromDate,
  dateForDayInMonth
}
