function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function compact(value) {
  return String(value || '').trim().toUpperCase()
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function findCobroReceiptConflicts(sql, { tipo, prefijo, numero }) {
  const fiscalType = compact(tipo)
  const pointOfSale = Number(prefijo)
  const fiscalNumber = Number(numero)
  if (!['FA', 'FB'].includes(fiscalType) || !Number.isInteger(pointOfSale) || !Number.isInteger(fiscalNumber)) {
    throw new Error('Invalid fiscal identity for Cobros collision check.')
  }

  return (
    sql.queryJson(
      forJson(`
SELECT
  CAST(c.cod_cliente AS int) AS cod_cliente,
  CAST(c.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  CONVERT(varchar(23), c.fecha_recibo, 121) AS fecha_recibo,
  CAST(COUNT(ca.numero_recibo) AS int) AS aplicaciones,
  CAST(
    CASE
      WHEN COUNT(ca.numero_recibo) = 1
       AND MAX(CASE
          WHEN LTRIM(RTRIM(ca.tipo_comprobante)) = '${sqlString(fiscalType)}'
           AND ca.prefijo = ${pointOfSale}
           AND ca.numero = ${fiscalNumber}
          THEN 1 ELSE 0 END) = 1
       AND MAX(CASE
          WHEN v.numero IS NOT NULL
           AND c.cod_cliente = v.cod_cliente
           AND c.nro_lugar_entrega = v.nro_lugar_entrega
          THEN 1 ELSE 0 END) = 1
      THEN 1 ELSE 0
    END AS bit
  ) AS es_aplicacion_coherente
FROM dbo.Cobros AS c
LEFT JOIN dbo.CobrosAplicados AS ca
  ON ca.tipo_comprobante_cobro = c.tipo_comprobante_cobro
 AND ca.prefijo_recibo = c.prefijo_recibo
 AND ca.numero_recibo = c.numero_recibo
LEFT JOIN dbo.Ventas AS v
  ON LTRIM(RTRIM(v.tipo_comprobante)) = '${sqlString(fiscalType)}'
 AND v.prefijo = ${pointOfSale}
 AND v.numero = ${fiscalNumber}
WHERE LTRIM(RTRIM(c.tipo_comprobante_cobro)) = '${sqlString(fiscalType)}'
  AND c.prefijo_recibo = ${pointOfSale}
  AND c.numero_recibo = ${fiscalNumber}
GROUP BY c.cod_cliente, c.nro_lugar_entrega, c.fecha_recibo
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  )
}

function assertNoCobroReceiptConflict(sql, identity) {
  const conflicts = findCobroReceiptConflicts(sql, identity)
  const malformed = conflicts.filter(conflict => !conflict.es_aplicacion_coherente)
  if (!malformed.length) {
    return []
  }

  const first = malformed[0]
  throw new Error(
    `Bloqueo fiscal: ${compact(identity.tipo)}/${Number(identity.prefijo)}-${Number(identity.numero)} ` +
      `ya esta usado por un Cobro de cliente ${first.cod_cliente}/${first.nro_lugar_entrega} ` +
      `(${first.fecha_recibo}). Normalizar el cobro antes de solicitar CAE.`
  )
}

module.exports = {
  assertNoCobroReceiptConflict,
  findCobroReceiptConflicts
}
