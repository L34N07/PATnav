const { MovimientosRepository } = require('./movimientos-repository')

function sqlString(value) {
  return String(value ?? '').replace(/'/g, "''")
}

function positiveInt(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un numero positivo.`)
  }
  return parsed
}

function compact(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function forJson(query) {
  return `
SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
${query}
`
}

function parseUbicacion(value) {
  const location = String(value || '').trim()
  const nativeMonth = location.match(/^(\d{4})-(\d{2})$/)
  if (nativeMonth && Number(nativeMonth[2]) >= 1 && Number(nativeMonth[2]) <= 12) {
    return `${nativeMonth[2]}/${nativeMonth[1].slice(-2)}`
  }
  const match = location.match(/^(\d{2})\/(\d{2})$/)
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) {
    throw new Error('Ubicacion debe tener formato MM/AA.')
  }
  return location
}

function dispenserLabel(row) {
  const serial = compact(row?.nro_serie)
  return serial ? `${row.cod_dispenser} - ${serial}` : String(row?.cod_dispenser || '')
}

class DispensersRepository {
  constructor(sql) {
    this.sql = sql
    this.locations = new MovimientosRepository(sql)
  }

  searchLocations(payload) {
    return this.locations.searchActiveLocations(payload)
  }

  getInitialData() {
    return {
      abonos: this.getAbonoOptions()
    }
  }

  getAbonoOptions() {
    return this.sql.queryJson(
      forJson(`
SELECT TOP (250)
  CAST(i.cod_item AS int) AS cod_item,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS denom_corto,
  NULLIF(LTRIM(RTRIM(i.denominacion)), '') AS denominacion,
  NULLIF(LTRIM(RTRIM(i.tipo_item)), '') AS tipo_item
FROM dbo.Item AS i
WHERE i.cod_item IS NOT NULL
  AND LTRIM(RTRIM(i.tipo_item)) = 'A'
ORDER BY i.cod_item
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
  }

  getClientDispensers({ codCliente, nroLugarEntrega } = {}) {
    const cod = positiveInt(codCliente, 'codCliente')
    const lugar = positiveInt(nroLugarEntrega, 'nroLugarEntrega')
    const cliente = this.locations.getActiveLocation({ codCliente: cod, nroLugarEntrega: lugar })
    const dispensers = this.sql.queryJson(
      forJson(`
SELECT
  CAST(d.cod_dispenser AS int) AS cod_dispenser,
  NULLIF(LTRIM(RTRIM(d.nro_serie)), '') AS nro_serie,
  NULLIF(LTRIM(RTRIM(td.denominacion)), '') AS tipo_dispenser,
  NULLIF(LTRIM(RTRIM(d.marca)), '') AS marca,
  CAST(d.estado AS int) AS estado,
  NULLIF(LTRIM(RTRIM(d.ubicacion)), '') AS ubicacion,
  CAST(d.cod_abono_o_alquiler AS int) AS cod_abono_o_alquiler,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS abono,
  NULLIF(LTRIM(RTRIM(d.MControl2)), '') AS mcontrol2,
  CONVERT(varchar(10), d.fecha_inicio_contrato, 23) AS fecha_inicio_contrato,
  CONVERT(varchar(10), d.fecha_fin_contrato, 23) AS fecha_fin_contrato
FROM dbo.Dispenser AS d
LEFT JOIN dbo.TipoDispenser AS td ON td.cod_tipo = d.cod_tipo
LEFT JOIN dbo.Item AS i ON i.cod_item = d.cod_abono_o_alquiler
WHERE d.cod_cliente = ${cod}
  AND d.nro_lugar_entrega = ${lugar}
ORDER BY d.cod_dispenser
FOR JSON PATH, INCLUDE_NULL_VALUES;
`)
    ) || []
    return { cliente, dispensers }
  }

  getDispenser({ codDispenser } = {}) {
    return this.findDispenser(codDispenser)
  }

  findDispenser(codDispenser) {
    const code = positiveInt(codDispenser, 'codDispenser')
    const result = this.sql.queryJson(
      forJson(`
SELECT TOP (1)
  CAST(d.cod_dispenser AS int) AS cod_dispenser,
  NULLIF(LTRIM(RTRIM(d.nro_serie)), '') AS nro_serie,
  CAST(d.cod_tipo AS int) AS cod_tipo,
  NULLIF(LTRIM(RTRIM(td.denominacion)), '') AS tipo_dispenser,
  NULLIF(LTRIM(RTRIM(d.marca)), '') AS marca,
  CAST(d.estado AS int) AS estado,
  NULLIF(LTRIM(RTRIM(d.observaciones)), '') AS observaciones,
  NULLIF(LTRIM(RTRIM(d.ubicacion)), '') AS ubicacion,
  CAST(d.cod_cliente AS int) AS cod_cliente,
  CAST(d.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  NULLIF(LTRIM(RTRIM(c.razon_social)), '') AS razon_social,
  CAST(d.cod_abono_o_alquiler AS int) AS cod_abono_o_alquiler,
  NULLIF(LTRIM(RTRIM(i.denom_corto)), '') AS abono,
  NULLIF(LTRIM(RTRIM(d.MControl2)), '') AS mcontrol2,
  CONVERT(varchar(10), d.fecha_inicio_contrato, 23) AS fecha_inicio_contrato,
  CONVERT(varchar(10), d.fecha_fin_contrato, 23) AS fecha_fin_contrato
FROM dbo.Dispenser AS d
LEFT JOIN dbo.TipoDispenser AS td ON td.cod_tipo = d.cod_tipo
LEFT JOIN dbo.Item AS i ON i.cod_item = d.cod_abono_o_alquiler
LEFT JOIN dbo.Cliente AS c ON c.cod_cliente = d.cod_cliente
WHERE d.cod_dispenser = ${code}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
    )
    if (!result) {
      throw new Error(`No existe el dispenser ${code}.`)
    }
    return result
  }

  previewOperation(payload = {}) {
    const mode = String(payload.mode || '').trim()
    if (!['instalacion', 'retiro', 'cambio'].includes(mode)) {
      throw new Error('Tipo de movimiento de dispenser invalido.')
    }

    const codCliente = positiveInt(payload.codCliente, 'codCliente')
    const nroLugarEntrega = positiveInt(payload.nroLugarEntrega, 'nroLugarEntrega')
    const cliente = this.locations.getActiveLocation({ codCliente, nroLugarEntrega })
    const deliveredCode = mode === 'retiro' ? null : positiveInt(payload.codDispenserInstalado, 'codDispenserInstalado')
    const removedCode = mode === 'instalacion'
      ? null
      : positiveInt(payload.codDispenserRetirado || payload.codDispenserInstalado, 'codDispenserRetirado')
    const ubicacion = mode === 'retiro' ? null : parseUbicacion(payload.ubicacion)
    const instalado = deliveredCode ? this.findDispenser(deliveredCode) : null
    const retirado = removedCode ? this.findDispenser(removedCode) : null
    const codAbono = mode === 'retiro'
      ? null
      : mode === 'cambio'
        ? positiveInt(retirado?.cod_abono_o_alquiler, 'cod_abono_o_alquiler del dispenser retirado')
        : positiveInt(payload.codAbono, 'codAbono')

    if (instalado && Number(instalado.cod_cliente || 0) !== 0) {
      throw new Error(`${dispenserLabel(instalado)} ya esta asignado; no se puede instalar sobre otro cliente.`)
    }
    if (retirado && (
      Number(retirado.cod_cliente) !== codCliente ||
      Number(retirado.nro_lugar_entrega) !== nroLugarEntrega
    )) {
      throw new Error(`${dispenserLabel(retirado)} no esta asignado al cliente/punto seleccionado.`)
    }
    if (instalado && retirado && Number(instalado.cod_dispenser) === Number(retirado.cod_dispenser)) {
      throw new Error('El dispenser instalado y el retirado deben ser distintos.')
    }

    return {
      mode,
      cliente,
      instalado,
      retirado,
      cambios: {
        codAbono,
        ubicacion,
        activaMControl2: mode !== 'retiro'
      }
    }
  }

  executeOperation(payload = {}) {
    const preview = this.previewOperation(payload)
    const codCliente = Number(preview.cliente.cod_cliente)
    const nroLugarEntrega = Number(preview.cliente.nro_lugar_entrega)
    const installedCode = preview.instalado ? Number(preview.instalado.cod_dispenser) : null
    const removedCode = preview.retirado ? Number(preview.retirado.cod_dispenser) : null
    const codAbono = preview.cambios.codAbono
    const ubicacion = preview.cambios.ubicacion
    const installSql = installedCode
      ? `
UPDATE dbo.Dispenser
SET cod_cliente = ${codCliente},
    nro_lugar_entrega = ${nroLugarEntrega},
    cod_abono_o_alquiler = ${codAbono},
    MControl2 = 'S',
    ubicacion = '${sqlString(ubicacion)}'
WHERE cod_dispenser = ${installedCode}
  AND cod_cliente IS NULL;
SET @instalados = @@ROWCOUNT;
IF @instalados <> 1 THROW 52100, 'El dispenser a instalar cambio de estado antes de guardar.', 1;
`
      : ''
    const removeSql = removedCode
      ? `
UPDATE dbo.Dispenser
SET cod_cliente = NULL,
    nro_lugar_entrega = NULL,
    cod_abono_o_alquiler = NULL,
    MControl2 = NULL
WHERE cod_dispenser = ${removedCode}
  AND cod_cliente = ${codCliente}
  AND nro_lugar_entrega = ${nroLugarEntrega};
SET @retirados = @@ROWCOUNT;
IF @retirados <> 1 THROW 52101, 'El dispenser a retirar cambio de estado antes de guardar.', 1;
`
      : ''

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @instalados int = 0;
DECLARE @retirados int = 0;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.Cliente AS c
  INNER JOIN dbo.LugarEntrega AS le
    ON le.cod_cliente = c.cod_cliente
  WHERE c.cod_cliente = ${codCliente}
    AND le.nro_lugar_entrega = ${nroLugarEntrega}
    AND c.estado = 0
    AND le.fecha_fin_contrato IS NULL
)
  THROW 52102, 'El cliente o punto ya no se encuentra activo.', 1;

${installedCode ? `IF NOT EXISTS (SELECT 1 FROM dbo.Item WHERE cod_item = ${codAbono} AND LTRIM(RTRIM(tipo_item)) = 'A')
  THROW 52103, 'El abono seleccionado no existe o no es de tipo A.', 1;` : ''}

${installSql}
${removeSql}

COMMIT TRANSACTION;

SELECT 'ok' AS status,
  '${sqlString(preview.mode)}' AS mode,
  ${codCliente} AS cod_cliente,
  ${nroLugarEntrega} AS nro_lugar_entrega,
  @instalados AS instalados,
  @retirados AS retirados
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }
}

class DispensersService {
  constructor({ repository } = {}) {
    this.repository = repository
  }

  getInitialData() { return this.repository.getInitialData() }
  searchLocations(payload) { return this.repository.searchLocations(payload) }
  getClientDispensers(payload) { return this.repository.getClientDispensers(payload) }
  getDispenser(payload) { return this.repository.getDispenser(payload) }
  previewOperation(payload) { return this.repository.previewOperation(payload) }
  saveOperation(payload) { return this.repository.executeOperation(payload) }
}

module.exports = { DispensersRepository, DispensersService }
