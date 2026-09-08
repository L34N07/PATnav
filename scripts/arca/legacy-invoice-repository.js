const RELEVANT_TABLES = [
  'Ventas',
  'VentasItems',
  'Cliente',
  'Item',
  'LugarEntrega',
  'CategoriaIva',
  'Talonario'
]

function sqlString(value) {
  return String(value).replace(/'/g, "''")
}

function normalizeTipo(tipo) {
  const normalized = String(tipo || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{1,4}$/.test(normalized)) {
    throw new Error('tipo must contain only letters or digits.')
  }
  return normalized
}

function normalizeNonNegativeInt(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`)
  }
  return parsed
}

function normalizePositiveInt(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function normalizeInvoiceKey(key) {
  return {
    tipo: normalizeTipo(key.tipo),
    prefijo: normalizeNonNegativeInt(key.prefijo, 'prefijo'),
    numero: normalizePositiveInt(key.numero, 'numero')
  }
}

function invoiceWhere(key, alias = 'v') {
  const tableAlias = alias ? `${alias}.` : ''
  return [
    `LTRIM(RTRIM(${tableAlias}tipo_comprobante)) = '${sqlString(key.tipo)}'`,
    `${tableAlias}prefijo = ${key.prefijo}`,
    `${tableAlias}numero = ${key.numero}`
  ].join(' AND ')
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

class LegacyInvoiceRepository {
  constructor(sql) {
    this.sql = sql
  }

  getSchemaSummary() {
    const tableList = RELEVANT_TABLES.map(table => `'${sqlString(table)}'`).join(', ')
    return this.sql.queryJson(
      forJson(`
SELECT
  TABLE_NAME AS tableName,
  ORDINAL_POSITION AS ordinal,
  COLUMN_NAME AS columnName,
  DATA_TYPE AS dataType,
  CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength,
  NUMERIC_PRECISION AS numericPrecision,
  NUMERIC_SCALE AS numericScale,
  IS_NULLABLE AS isNullable
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME IN (${tableList})
ORDER BY TABLE_NAME, ORDINAL_POSITION
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getIndexSummary() {
    const tableList = RELEVANT_TABLES.map(table => `'${sqlString(table)}'`).join(', ')
    return this.sql.queryJson(
      forJson(`
SELECT
  t.name AS tableName,
  i.name AS indexName,
  i.is_primary_key AS isPrimaryKey,
  i.is_unique AS isUnique,
  c.name AS columnName,
  ic.key_ordinal AS keyOrdinal
FROM sys.tables AS t
INNER JOIN sys.indexes AS i
  ON i.object_id = t.object_id
INNER JOIN sys.index_columns AS ic
  ON ic.object_id = i.object_id
 AND ic.index_id = i.index_id
INNER JOIN sys.columns AS c
  ON c.object_id = ic.object_id
 AND c.column_id = ic.column_id
WHERE t.name IN (${tableList})
  AND i.is_hypothetical = 0
  AND i.index_id > 0
ORDER BY t.name, i.is_primary_key DESC, i.is_unique DESC, i.name, ic.key_ordinal
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  findLatestCandidate(preferredTipo = 'FB') {
    const tipo = normalizeTipo(preferredTipo)
    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(19), v.fecha_operacion, 126) AS fecha_operacion,
  CAST(v.cod_cliente AS int) AS cod_cliente,
  CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega
FROM dbo.Ventas AS v
WHERE LTRIM(RTRIM(v.tipo_comprobante)) = '${sqlString(tipo)}'
  AND NULLIF(LTRIM(RTRIM(COALESCE(v.cae, ''))), '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM dbo.VentasItems AS vi
    WHERE vi.tipo_comprobante = v.tipo_comprobante
      AND vi.prefijo = v.prefijo
      AND vi.numero = v.numero
  )
ORDER BY v.fecha_operacion DESC, v.prefijo DESC, v.numero DESC
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getInvoice(inputKey) {
    const key = normalizeInvoiceKey(inputKey)
    const venta = this.getVenta(key)
    if (!venta) {
      return {
        key,
        venta: null,
        items: [],
        cliente: null,
        categoriaIva: null,
        lugarEntrega: null,
        talonario: null
      }
    }

    return {
      key,
      venta,
      items: this.getItems(key),
      cliente: this.getCliente(venta.cod_cliente),
      categoriaIva: this.getCategoriaIva(venta.cod_categoria),
      lugarEntrega: this.getLugarEntrega(venta.cod_cliente, venta.nro_lugar_entrega),
      talonario: this.getTalonario(key)
    }
  }

  getVenta(key) {
    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(19), v.fecha_operacion, 126) AS fecha_operacion,
  CAST(v.cod_cliente AS int) AS cod_cliente,
  CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  CONVERT(varchar(19), v.fecha_vencimiento, 126) AS fecha_vencimiento,
  NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(max), v.remitos_facturados))), '') AS remitos_facturados,
  NULLIF(LTRIM(RTRIM(v.Mcampo_control)), '') AS mcampo_control,
  NULLIF(LTRIM(RTRIM(v.cae)), '') AS cae,
  CONVERT(varchar(19), v.fecha_vencimiento_cae, 126) AS fecha_vencimiento_cae,
  CAST(v.tipo_facturacion AS int) AS tipo_facturacion,
  CAST(v.numero_ci AS bigint) AS numero_ci,
  NULLIF(LTRIM(RTRIM(v.saca_v)), '') AS saca_v,
  CAST(c.cuit AS varchar(20)) AS cuit,
  NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social
FROM dbo.Ventas AS v
LEFT JOIN dbo.Cliente AS c
  ON c.cod_cliente = v.cod_cliente
WHERE ${invoiceWhere(key, 'v')}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getCliente(codCliente) {
    const parsedCodCliente = normalizePositiveInt(codCliente, 'cod_cliente')
    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(c.cod_cliente AS int) AS cod_cliente,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
  CAST(c.estado AS int) AS estado,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal1)), '') AS dom_fiscal1,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal2)), '') AS dom_fiscal2,
  NULLIF(LTRIM(RTRIM(c.dom_fiscal3)), '') AS dom_fiscal3,
  NULLIF(LTRIM(RTRIM(c.cod_postal)), '') AS cod_postal,
  NULLIF(LTRIM(RTRIM(c.telefonos)), '') AS telefonos,
  NULLIF(LTRIM(RTRIM(c.cel_mensajes)), '') AS cel_mensajes,
  NULLIF(LTRIM(RTRIM(c.datoscontacto)), '') AS datoscontacto,
  CAST(c.cuit AS varchar(20)) AS cuit,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  CAST(c.tipo_fact_ctacte AS int) AS tipo_fact_ctacte,
  CAST(c.cod_lista AS int) AS cod_lista,
  CAST(c.limite_credito AS decimal(18, 2)) AS limite_credito,
  NULLIF(LTRIM(RTRIM(c.frecuencia_facturacion)), '') AS frecuencia_facturacion,
  NULLIF(LTRIM(RTRIM(c.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(c.tipo_cobro)), '') AS tipo_cobro,
  CAST(c.limite_facturacion AS decimal(18, 2)) AS limite_facturacion,
  NULLIF(LTRIM(RTRIM(c.PromocionPrecio)), '') AS promocion_precio
FROM dbo.Cliente AS c
WHERE c.cod_cliente = ${parsedCodCliente}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getCategoriaIva(codCategoria) {
    const normalized = String(codCategoria || '').trim()
    if (!normalized) {
      return null
    }

    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  NULLIF(LTRIM(RTRIM(ci.cod_categoria)), '') AS cod_categoria,
  NULLIF(LTRIM(RTRIM(ci.categoria)), '') AS categoria,
  NULLIF(LTRIM(RTRIM(ci.tipofactura)), '') AS tipofactura
FROM dbo.CategoriaIva AS ci
WHERE ci.cod_categoria = '${sqlString(normalized)}'
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getLugarEntrega(codCliente, nroLugarEntrega) {
    const parsedCodCliente = normalizePositiveInt(codCliente, 'cod_cliente')
    const parsedNroLugar = normalizeNonNegativeInt(nroLugarEntrega, 'nro_lugar_entrega')

    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(le.cod_cliente AS int) AS cod_cliente,
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  NULLIF(LTRIM(RTRIM(le.tipo_lugar)), '') AS tipo_lugar,
  CAST(le.cod_municipio AS int) AS cod_municipio,
  CAST(le.cod_calle AS int) AS cod_calle,
  CAST(le.numeropuerta AS int) AS numeropuerta,
  NULLIF(LTRIM(RTRIM(le.observ_domicilio)), '') AS observ_domicilio,
  NULLIF(LTRIM(RTRIM(le.[2observ_domicilio])), '') AS observ_domicilio_2,
  NULLIF(LTRIM(RTRIM(le.cel_mensajes)), '') AS cel_mensajes,
  CONVERT(varchar(19), le.fecha_inicio_contrato, 126) AS fecha_inicio_contrato,
  CONVERT(varchar(19), le.fecha_fin_contrato, 126) AS fecha_fin_contrato,
  CAST(le.cod_lista AS int) AS cod_lista,
  CAST(le.dia_facturacion_abono AS int) AS dia_facturacion_abono,
  CAST(le.cant_opt_envases AS int) AS cant_opt_envases,
  NULLIF(LTRIM(RTRIM(le.es_lugar_cobro)), '') AS es_lugar_cobro,
  NULLIF(LTRIM(RTRIM(le.telefonos)), '') AS telefonos,
  CAST(le.frecuencia_visita AS int) AS frecuencia_visita,
  NULLIF(LTRIM(RTRIM(le.email)), '') AS email,
  NULLIF(LTRIM(RTRIM(le.Minf_extra)), '') AS minf_extra,
  NULLIF(LTRIM(RTRIM(le.ubicacion_geografica)), '') AS ubicacion_geografica,
  NULLIF(LTRIM(RTRIM(le.PromocionPrecio)), '') AS promocion_precio,
  NULLIF(LTRIM(RTRIM(ca.nombre)), '') AS calle,
  NULLIF(LTRIM(RTRIM(m.nombre)), '') AS municipio,
  NULLIF(LTRIM(RTRIM(CONCAT(
    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
    CASE
      WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN ''
      ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta))
    END,
    CASE
      WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN ''
      ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio)))
    END,
    CASE
      WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN ''
      ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio])))
    END,
    CASE
      WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN ''
      ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre)))
    END
  ))), '') AS direccion
FROM dbo.LugarEntrega AS le
LEFT JOIN dbo.Calle AS ca
  ON ca.cod_municipio = le.cod_municipio
 AND ca.cod_calle = le.cod_calle
LEFT JOIN dbo.Municipio AS m
  ON m.cod_municipio = le.cod_municipio
WHERE le.cod_cliente = ${parsedCodCliente}
  AND le.nro_lugar_entrega = ${parsedNroLugar}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getTalonario(key) {
    return this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  LTRIM(RTRIM(t.tipo_comprobante)) AS tipo_comprobante,
  CAST(t.prefijo AS int) AS prefijo,
  CAST(t.ult_numero AS int) AS ult_numero
FROM dbo.Talonario AS t
WHERE LTRIM(RTRIM(t.tipo_comprobante)) = '${sqlString(key.tipo)}'
  AND t.prefijo = ${key.prefijo}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
  }

  getItems(key) {
    return this.sql.queryJson(
      forJson(`
SELECT
  CAST(vi.orden AS int) AS orden,
  CAST(vi.cod_item AS int) AS cod_item,
  CAST(vi.cantidad AS decimal(18, 4)) AS cantidad,
  CAST(vi.precio AS decimal(18, 4)) AS precio,
  CAST(vi.importe AS decimal(18, 4)) AS importe,
  CAST(vi.tasa_iva AS decimal(18, 4)) AS tasa_iva,
  CAST(vi.litros_abonados AS decimal(18, 4)) AS litros_abonados,
  NULLIF(LTRIM(RTRIM(vi.saca_vi)), '') AS saca_vi,
  NULLIF(LTRIM(RTRIM(i.denominacion)), '') AS denominacion,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS denom_corto,
  CAST(i.tasa_iva AS decimal(18, 4)) AS item_tasa_iva,
  NULLIF(LTRIM(RTRIM(i.tipo_item)), '') AS item_tipo_item,
  CAST(i.precio AS decimal(18, 4)) AS item_precio
FROM dbo.VentasItems AS vi
LEFT JOIN dbo.Item AS i
  ON i.cod_item = vi.cod_item
WHERE ${invoiceWhere(key, 'vi')}
ORDER BY vi.orden
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }
}

module.exports = {
  LegacyInvoiceRepository,
  normalizeInvoiceKey
}
