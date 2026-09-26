const { ArcaApiProvider } = require('./arca-api-provider')
const { getUltimoComprobante, postFactura } = require('./arca-api-read-only-client')
const { assertNoCobroReceiptConflict } = require('./fiscal-cobro-guard')
const { LegacyInvoiceRepository } = require('./legacy-invoice-repository')

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

function compact(value) {
  return String(value || '').trim()
}

function normalizePtoVtas({ ptoVta, ptoVtas }) {
  const values = Array.isArray(ptoVtas) && ptoVtas.length ? ptoVtas : [ptoVta]
  const normalized = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)
  return [...new Set(normalized)]
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

function monthRangeFromDate(value) {
  const date = sqlDate(String(value || '').slice(0, 10), 'fecha_vencimiento')
  const [year, month] = date.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    firstDate: `${year}-${String(month).padStart(2, '0')}-01`,
    lastDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function fiscalTypeToCbteTipo(tipo) {
  if (tipo === 'FA') {
    return 1
  }
  if (tipo === 'FB') {
    return 6
  }
  throw new Error(`Unsupported fiscal type: ${tipo}`)
}

function extractApproval(arcaResponse) {
  const body = arcaResponse.response || {}
  const result = body.resultado || body.result || body.Resultado
  const cbteNro = Number(body.cbteNro ?? body.cbte_nro ?? body.numero)
  const cae = body.cae || body.CAE
  const caeFchVto = body.caeFchVto || body.vencimientoCAE || body.fecha_vencimiento_cae

  return {
    result,
    cbteNro,
    cae,
    caeFchVto,
    observaciones: body.observaciones || body.observacionesArca || body.obs || [],
    errores: body.errores || body.errors || []
  }
}

class PendingFiscalPreflight {
  constructor({
    sql,
    representada,
    ptoVta = 8,
    ptoVtas,
    concepto = 1,
    arcaPostFactura = postFactura,
    arcaGetUltimoComprobante = getUltimoComprobante
  } = {}) {
    this.sql = sql
    this.representada = representada || process.env.ARCA_REPRESENTADA_CUIT || '20220334857'
    this.ptoVta = Number(ptoVta)
    this.ptoVtas = normalizePtoVtas({ ptoVta, ptoVtas })
    this.concepto = Number(concepto)
    this.arcaPostFactura = arcaPostFactura
    this.arcaGetUltimoComprobante = arcaGetUltimoComprobante
    this.legacyRepository = new LegacyInvoiceRepository(sql)
  }

  async assertNextFiscalIdentityIsAvailable({ tipo, prefijo, allowedExistingIdentity } = {}) {
    const fiscalType = compact(tipo)
    const pointOfSale = Number(prefijo)
    const ultimo = await this.arcaGetUltimoComprobante({
      environment: 'produccion',
      representada: this.representada,
      ptoVta: pointOfSale,
      cbteTipo: fiscalTypeToCbteTipo(fiscalType)
    })
    const expectedNumber = Number(ultimo.proximoComprobante)
    if (!ultimo.ok || !Number.isInteger(expectedNumber) || expectedNumber <= 0) {
      throw new Error(
        `No se pudo confirmar el proximo ${fiscalType}/${pointOfSale} en ARCA antes de solicitar CAE.`
      )
    }

    const existingVenta = this.legacyRepository.getVenta({
      tipo: fiscalType,
      prefijo: pointOfSale,
      numero: expectedNumber
    })
    const existingIsAllowed =
      allowedExistingIdentity &&
      compact(allowedExistingIdentity.tipo) === fiscalType &&
      Number(allowedExistingIdentity.prefijo) === pointOfSale &&
      Number(allowedExistingIdentity.numero) === expectedNumber

    if (existingVenta && !existingIsAllowed) {
      const caeStatus = existingVenta.cae ? 'ya tiene CAE' : 'sigue sin CAE'
      throw new Error(
        `Bloqueo fiscal: ARCA espera ${fiscalType}/${pointOfSale}-${expectedNumber}, ` +
          `pero NAVIERA ya tiene esa factura para cliente ${existingVenta.cod_cliente}/${existingVenta.nro_lugar_entrega} ` +
          `(${existingVenta.fecha_operacion}; ${caeStatus}). Regularice la factura existente antes de crear otra.`
      )
    }

    // A legacy cash sale can legitimately use the same key as the pending
    // invoice being regularized. Only another invoice identity is a conflict.
    if (pointOfSale === 8 && !existingIsAllowed) {
      assertNoCobroReceiptConflict(this.sql, {
        tipo: fiscalType,
        prefijo: pointOfSale,
        numero: expectedNumber
      })
    }

    return {
      ultimoComprobante: ultimo.ultimoComprobante,
      proximoComprobante: expectedNumber
    }
  }

  findPendingBefore({ targetDate, tipo } = {}) {
    const date = sqlDate(targetDate, 'targetDate')
    const fiscalTypes = tipo ? [compact(tipo).toUpperCase()] : ['FA', 'FB']
    if (fiscalTypes.some(fiscalType => !['FA', 'FB'].includes(fiscalType))) {
      throw new Error('Preflight fiscal type must be FA or FB.')
    }
    const fiscalTypesSql = fiscalTypes.map(fiscalType => `'${sqlString(fiscalType)}'`).join(', ')
    return this.sql.queryJson(
      forJson(`
DECLARE @target date = '${sqlString(date)}';

SELECT
  LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
  CAST(v.prefijo AS int) AS prefijo,
  CAST(v.numero AS int) AS numero,
  CONVERT(varchar(10), v.fecha_operacion, 23) AS fecha_operacion,
  CAST(v.cod_cliente AS int) AS cod_cliente,
  CAST(v.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  LTRIM(RTRIM(c.razon_social)) AS razon_social,
  CAST(SUM(COALESCE(vi.importe, 0)) AS decimal(18, 2)) AS total,
  COUNT_BIG(vi.orden) AS items
FROM dbo.Ventas AS v
INNER JOIN dbo.VentasItems AS vi
  ON vi.tipo_comprobante = v.tipo_comprobante
 AND vi.prefijo = v.prefijo
 AND vi.numero = v.numero
LEFT JOIN dbo.Cliente AS c
  ON c.cod_cliente = v.cod_cliente
WHERE LTRIM(RTRIM(v.tipo_comprobante)) IN (${fiscalTypesSql})
  AND v.prefijo IN (${this.ptoVtas.join(', ')})
  AND NULLIF(LTRIM(RTRIM(COALESCE(v.cae, ''))), '') IS NULL
  AND CONVERT(date, v.fecha_operacion) >= DATEADD(day, -7, @target)
  AND CONVERT(date, v.fecha_operacion) < @target
GROUP BY
  v.tipo_comprobante,
  v.prefijo,
  v.numero,
  v.fecha_operacion,
  v.cod_cliente,
  v.nro_lugar_entrega,
  c.razon_social
ORDER BY v.fecha_operacion, v.tipo_comprobante, v.numero
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  buildPreview({ targetDate, tipo } = {}) {
    const pending = this.findPendingBefore({ targetDate, tipo })
    const invalid = this.findInvalidPending(pending)
    return {
      targetDate: sqlDate(targetDate, 'targetDate'),
      ptoVta: this.ptoVta,
      ptoVtas: this.ptoVtas,
      concepto: this.concepto,
      tipo: tipo ? compact(tipo).toUpperCase() : null,
      pendingCount: pending.length,
      invalidPendingCount: invalid.length,
      invalidPending: invalid,
      pending
    }
  }

  buildAuthorizationPreview(invoice, { fechaEmision } = {}) {
    const tipo = compact(invoice.venta.tipo_comprobante)
    const ptoVta = Number(invoice.venta.prefijo) || this.ptoVta
    const dateOverride = fechaEmision ? sqlDate(fechaEmision, 'fechaEmision') : undefined
    const provider = new ArcaApiProvider({
      environment: 'produccion',
      representada: this.representada,
      ptoVta,
      concepto: this.concepto,
      fechaHomologacion: dateOverride,
      legacyPriceMode: 'gross'
    })
    const preview = provider.buildAuthorizationPreview(invoice)
    preview.payload.cbteTipo = fiscalTypeToCbteTipo(tipo)
    preview.payload.ptoVta = ptoVta
    preview.payload.concepto = this.concepto
    if (this.concepto === 2) {
      const period = monthRangeFromDate(invoice.venta.fecha_vencimiento)
      preview.payload.fchServDesde = period.firstDate.replace(/-/g, '')
      preview.payload.fchServHasta = period.lastDate.replace(/-/g, '')
      preview.payload.fchVtoPago = preview.payload.cbteFch
    }
    return preview
  }

  findInvalidPending(pending) {
    return pending.filter(row => Number(row.items || 0) <= 0 || Number(row.total || 0) <= 0)
  }

  async processBefore({ targetDate, tipo } = {}) {
    const pending = this.findPendingBefore({ targetDate, tipo })
    const invalid = this.findInvalidPending(pending)
    if (invalid.length > 0) {
      const labels = invalid
        .slice(0, 5)
        .map(row => `${compact(row.tipo_comprobante)}/${row.prefijo}/${row.numero}`)
        .join(', ')
      throw new Error(
        `Preflight fiscal bloqueado: hay ${invalid.length} comprobante(s) sin CAE con total/items invalidos (${labels}). Corregirlos antes de autorizar nuevos comprobantes.`
      )
    }
    const processed = []

    for (const row of pending) {
      const original = {
        tipo: compact(row.tipo_comprobante),
        prefijo: Number(row.prefijo),
        numero: Number(row.numero)
      }
      const invoice = this.legacyRepository.getInvoice(original)
      if (!invoice.venta || !invoice.items.length) {
        throw new Error(`Preflight ${original.tipo}/${original.prefijo}/${original.numero} has no invoice/items.`)
      }

      const authorizationPreview = this.buildAuthorizationPreview(invoice)
      const expectedArca = await this.assertNextFiscalIdentityIsAvailable({
        tipo: original.tipo,
        prefijo: original.prefijo,
        allowedExistingIdentity: original
      })
      const arcaResponse = await this.arcaPostFactura({
        payload: authorizationPreview.payload,
        idempotencyKey: `PROD-PREFLIGHT-${original.tipo}-${original.prefijo}-${original.numero}`
      })
      const approval = extractApproval(arcaResponse)
      if (approval.result !== 'A' || !approval.cbteNro || !approval.cae || !approval.caeFchVto) {
        throw new Error(
          `Preflight ${original.tipo}/${original.prefijo}/${original.numero} rejected by ARCA: ${JSON.stringify(arcaResponse.response)}`
        )
      }

      if (Number(original.prefijo) === 8) {
        assertNoCobroReceiptConflict(this.sql, {
          tipo: original.tipo,
          prefijo: original.prefijo,
          numero: approval.cbteNro
        })
      }

      const saved = this.updateAuthorizedExistingInvoice({
        original,
        authorized: {
          tipo: original.tipo,
          prefijo: original.prefijo,
          numero: approval.cbteNro,
          cae: approval.cae,
          caeFchVto: normalizeCaeFchVto(approval.caeFchVto)
        }
      })

      processed.push({
        original,
        authorized: {
          tipo: original.tipo,
          prefijo: original.prefijo,
          numero: approval.cbteNro
        },
        cae: approval.cae,
        caeFchVto: normalizeCaeFchVto(approval.caeFchVto),
        arcaExpectedNumber: expectedArca.proximoComprobante,
        observaciones: approval.observaciones,
        errores: approval.errores,
        saved
      })
    }

    return {
      targetDate: sqlDate(targetDate, 'targetDate'),
      tipo: tipo ? compact(tipo).toUpperCase() : null,
      processedCount: processed.length,
      processed
    }
  }

  updateAuthorizedExistingInvoice({ original, authorized }) {
    const oldTipo = compact(original.tipo)
    const oldPrefijo = Number(original.prefijo)
    const oldNumero = Number(original.numero)
    const newTipo = compact(authorized.tipo)
    const newPrefijo = Number(authorized.prefijo)
    const newNumero = Number(authorized.numero)
    const fechaOperacion = authorized.fechaOperacion
      ? sqlDate(authorized.fechaOperacion, 'authorized.fechaOperacion')
      : null
    const changesIdentity = oldTipo !== newTipo || oldPrefijo !== newPrefijo || oldNumero !== newNumero
    const dependencyConstraints = changesIdentity ? this.getFiscalDependencyConstraints() : []
    const disableDependencyConstraintsSql = dependencyConstraints
      .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} NOCHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
      .join('\n')
    const enableDependencyConstraintsSql = dependencyConstraints
      .map(row => `ALTER TABLE ${quoteIdentifier(row.child_schema)}.${quoteIdentifier(row.child_table)} WITH CHECK CHECK CONSTRAINT ${quoteIdentifier(row.constraint_name)};`)
      .join('\n')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @ventas_items int = 0;
DECLARE @cobros_aplicados int = 0;
DECLARE @cobros_aplicados_recibo int = 0;
DECLARE @cobros int = 0;
DECLARE @movfisicos_items int = 0;
DECLARE @movfisicos_equipos int = 0;
DECLARE @movfisicos int = 0;
DECLARE @ventas int = 0;
DECLARE @cod_cliente int = NULL;
DECLARE @nro_lugar_entrega int = NULL;
DECLARE @migrar_cobro bit = 0;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
    AND prefijo = ${oldPrefijo}
    AND numero = ${oldNumero}
    AND NULLIF(LTRIM(RTRIM(COALESCE(cae, ''))), '') IS NULL
)
BEGIN
  THROW 53000, 'Original pending fiscal invoice was not found or already has CAE.', 1;
END;

IF (
  '${sqlString(oldTipo)}' <> '${sqlString(newTipo)}'
  OR ${oldPrefijo} <> ${newPrefijo}
  OR ${oldNumero} <> ${newNumero}
)
AND EXISTS (
  SELECT 1
  FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
  WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(newTipo)}'
    AND prefijo = ${newPrefijo}
    AND numero = ${newNumero}
)
BEGIN
  THROW 53001, 'Authorized fiscal number already exists in Ventas.', 1;
END;

SELECT
  @cod_cliente = CAST(cod_cliente AS int),
  @nro_lugar_entrega = CAST(nro_lugar_entrega AS int)
FROM dbo.Ventas WITH (UPDLOCK, HOLDLOCK)
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};

-- A legacy cash sale can use the original FA/FB key as its receipt key.
-- Migrate it only when it is a single, same-client application to this invoice.
IF (
  '${sqlString(oldTipo)}' <> '${sqlString(newTipo)}'
  OR ${oldPrefijo} <> ${newPrefijo}
  OR ${oldNumero} <> ${newNumero}
)
AND NOT EXISTS (
  SELECT 1 FROM dbo.Cobros
  WHERE tipo_comprobante_cobro = '${sqlString(newTipo)}'
    AND prefijo_recibo = ${newPrefijo}
    AND numero_recibo = ${newNumero}
)
AND (SELECT COUNT(*) FROM dbo.Cobros
     WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
       AND prefijo_recibo = ${oldPrefijo}
       AND numero_recibo = ${oldNumero}
       AND cod_cliente = @cod_cliente
       AND nro_lugar_entrega = @nro_lugar_entrega) = 1
AND (SELECT COUNT(*) FROM dbo.CobrosAplicados
     WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
       AND prefijo_recibo = ${oldPrefijo}
       AND numero_recibo = ${oldNumero}) = 1
AND EXISTS (
  SELECT 1 FROM dbo.CobrosAplicados
  WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
    AND prefijo_recibo = ${oldPrefijo}
    AND numero_recibo = ${oldNumero}
    AND tipo_comprobante = '${sqlString(oldTipo)}'
    AND prefijo = ${oldPrefijo}
    AND numero = ${oldNumero}
)
BEGIN
  SET @migrar_cobro = 1;
END;

${disableDependencyConstraintsSql}

IF @migrar_cobro = 1
BEGIN
  UPDATE dbo.CobrosAplicados
  SET tipo_comprobante_cobro = '${sqlString(newTipo)}',
      prefijo_recibo = ${newPrefijo},
      numero_recibo = ${newNumero}
  WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
    AND prefijo_recibo = ${oldPrefijo}
    AND numero_recibo = ${oldNumero};
  SET @cobros_aplicados_recibo = @@ROWCOUNT;

  UPDATE dbo.Cobros
  SET tipo_comprobante_cobro = '${sqlString(newTipo)}',
      prefijo_recibo = ${newPrefijo},
      numero_recibo = ${newNumero}
  WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
    AND prefijo_recibo = ${oldPrefijo}
    AND numero_recibo = ${oldNumero};
  SET @cobros = @@ROWCOUNT;
END;

IF (
  '${sqlString(oldTipo)}' <> '${sqlString(newTipo)}'
  OR ${oldPrefijo} <> ${newPrefijo}
  OR ${oldNumero} <> ${newNumero}
)
AND EXISTS (
  SELECT 1 FROM dbo.Cobros
  WHERE tipo_comprobante_cobro = '${sqlString(oldTipo)}'
    AND prefijo_recibo = ${oldPrefijo}
    AND numero_recibo = ${oldNumero}
)
AND @migrar_cobro = 0
BEGIN
  THROW 53002, 'Cobro asociado no se puede migrar de forma segura; no se actualizo la factura.', 1;
END;

UPDATE dbo.VentasItems
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @ventas_items = @@ROWCOUNT;

UPDATE dbo.CobrosAplicados
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @cobros_aplicados = @@ROWCOUNT;

UPDATE dbo.MovFisicosEquipos
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo_remito = ${newPrefijo},
    numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo_remito = ${oldPrefijo}
  AND numero_remito = ${oldNumero};
SET @movfisicos_equipos = @@ROWCOUNT;

UPDATE dbo.MovFisicosItems
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo_remito = ${newPrefijo},
    numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo_remito = ${oldPrefijo}
  AND numero_remito = ${oldNumero};
SET @movfisicos_items = @@ROWCOUNT;

UPDATE dbo.MovFisicos
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo_remito = ${newPrefijo},
    numero_remito = ${newNumero}
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo_remito = ${oldPrefijo}
  AND numero_remito = ${oldNumero};
SET @movfisicos = @@ROWCOUNT;

UPDATE dbo.Ventas
SET tipo_comprobante = '${sqlString(newTipo)}',
    prefijo = ${newPrefijo},
    numero = ${newNumero},
    fecha_operacion = ${fechaOperacion ? `'${sqlString(fechaOperacion)}'` : 'fecha_operacion'},
    cae = '${sqlString(authorized.cae)}',
    fecha_vencimiento_cae = '${sqlString(authorized.caeFchVto)}'
WHERE LTRIM(RTRIM(tipo_comprobante)) = '${sqlString(oldTipo)}'
  AND prefijo = ${oldPrefijo}
  AND numero = ${oldNumero};
SET @ventas = @@ROWCOUNT;

${enableDependencyConstraintsSql}

COMMIT TRANSACTION;

SELECT
  'ok' AS status,
  '${sqlString(oldTipo)}' AS original_tipo,
  ${oldPrefijo} AS original_prefijo,
  ${oldNumero} AS original_numero,
  '${sqlString(newTipo)}' AS authorized_tipo,
  ${newPrefijo} AS authorized_prefijo,
  ${newNumero} AS authorized_numero,
  @ventas AS ventas,
  @ventas_items AS ventas_items,
  @cobros_aplicados AS cobros_aplicados,
  @cobros_aplicados_recibo AS cobros_aplicados_recibo,
  @cobros AS cobros,
  @movfisicos AS movfisicos,
  @movfisicos_items AS movfisicos_items,
  @movfisicos_equipos AS movfisicos_equipos
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  getFiscalDependencyConstraints() {
    return this.sql.queryJson(
      forJson(`
SELECT DISTINCT
  OBJECT_SCHEMA_NAME(fk.parent_object_id) AS child_schema,
  OBJECT_NAME(fk.parent_object_id) AS child_table,
  fk.name AS constraint_name
FROM sys.foreign_keys AS fk
WHERE OBJECT_SCHEMA_NAME(fk.referenced_object_id) = 'dbo'
  AND OBJECT_NAME(fk.referenced_object_id) IN ('Ventas', 'MovFisicos', 'Cobros')
  AND OBJECT_NAME(fk.parent_object_id) IN ('VentasItems', 'CobrosAplicados', 'MovFisicos', 'MovFisicosItems', 'MovFisicosEquipos')
ORDER BY child_table, constraint_name
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }
}

module.exports = {
  PendingFiscalPreflight
}
