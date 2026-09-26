function sqlString(value) {
  return String(value ?? '').trim().replace(/'/g, "''")
}

function requiredText(value, label, maxLength) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label} es obligatorio.`)
  if (normalized.length > maxLength) throw new Error(`${label} no puede superar ${maxLength} caracteres.`)
  return normalized
}

function optionalAmount(value, label) {
  let raw = String(value ?? '').trim().replace(/[$\s]/g, '')
  if (!raw) return null
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (raw.includes(',')) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  }
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} debe ser un importe positivo.`)
  return Math.round(amount * 100) / 100
}

function cuitValue(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits || digits.length > 18) throw new Error('CUIT o ID debe contener entre 1 y 18 digitos.')
  return digits
}

function intValue(value, label, allowed) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || (allowed && !allowed.includes(parsed))) {
    throw new Error(`${label} no es valido.`)
  }
  return parsed
}

function nullableSql(value) {
  return value === null ? 'NULL' : String(value)
}

function optionalText(value, label, maxLength) {
  const normalized = String(value ?? '').trim()
  if (normalized.length > maxLength) throw new Error(`${label} no puede superar ${maxLength} caracteres.`)
  return normalized || null
}

function positiveInt(value, label, max = Number.MAX_SAFE_INTEGER, allowZero = false) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > max) {
    throw new Error(`${label} no es valido.`)
  }
  return parsed
}

function isoDate(value, label) {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} debe usar formato YYYY-MM-DD.`)
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} no es una fecha valida.`)
  }
  return raw
}

class ClientOnboardingRepository {
  constructor(sql) {
    this.sql = sql
  }

  getInitialData() {
    // Keep the lookup queries independent: the production database resolves
    // identifiers inside nested FOR JSON statements inconsistently.
    const nextCode = this.sql.queryJson(`
SELECT
  CAST(COALESCE(MAX(CAST(cod_cliente AS int)), 0) AS int) AS ultimo_codigo,
  CAST(COALESCE(MAX(CAST(cod_cliente AS int)), 0) + 1 AS int) AS proximo_codigo
FROM dbo.Cliente
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`) || { proximo_codigo: 1 }
    const categorias = this.sql.queryJson(`
SELECT
  LTRIM(RTRIM(cod_categoria)) AS codigo,
  LTRIM(RTRIM(categoria)) AS descripcion,
  LTRIM(RTRIM(tipofactura)) AS tipo_factura
FROM dbo.CategoriaIva
ORDER BY cod_categoria
FOR JSON PATH;
`) || []
    const listas = this.sql.queryJson(`
SELECT
  CAST(Cod_lista AS int) AS codigo,
  LTRIM(RTRIM(denominacion)) AS descripcion
FROM dbo.ListaPrecio
ORDER BY Cod_lista
FOR JSON PATH;
`) || []
    const municipios = this.sql.queryJson(`
SELECT
  CAST(cod_municipio AS int) AS codigo,
  LTRIM(RTRIM(nombre)) AS nombre,
  LTRIM(RTRIM(sigla)) AS sigla
FROM dbo.Municipio
ORDER BY nombre
FOR JSON PATH;
`) || []
    const ultimoPunto = this.sql.queryJson(`
SELECT TOP (1)
  CAST(cod_cliente AS int) AS cod_cliente,
  CAST(nro_lugar_entrega AS int) AS nro_lugar_entrega,
  CONVERT(varchar(10), fecha_inicio_contrato, 23) AS fecha_inicio_contrato
FROM dbo.LugarEntrega
WHERE fecha_fin_contrato IS NULL
ORDER BY CAST(cod_cliente AS int) DESC, CAST(nro_lugar_entrega AS int) DESC
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`) || null

    return { ...nextCode, categorias, listas, municipios, ultimo_punto: ultimoPunto }
  }

  getDeliveryPointContext({ codCliente } = {}) {
    const cliente = positiveInt(codCliente, 'Codigo de cliente', 9999)
    return this.sql.queryJson(`
SELECT
  CAST(c.cod_cliente AS int) AS cod_cliente,
  LTRIM(RTRIM(c.razon_social)) AS razon_social,
  CAST(COALESCE(MAX(CAST(le.nro_lugar_entrega AS int)), 0) + 1 AS int) AS proximo_lugar
FROM dbo.Cliente AS c
LEFT JOIN dbo.LugarEntrega AS le ON le.cod_cliente = c.cod_cliente
WHERE c.cod_cliente = ${cliente}
GROUP BY c.cod_cliente, c.razon_social
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`) || null
  }

  getBillingClientContext({ codCliente } = {}) {
    const cliente = positiveInt(codCliente, 'Codigo de cliente', 9999)
    const header = this.sql.queryJson(`
SELECT
  CAST(c.cod_cliente AS int) AS cod_cliente,
  LTRIM(RTRIM(c.razon_social)) AS razon_social,
  CAST(c.tipo_cliente AS int) AS tipo_cliente,
  CAST(c.estado AS int) AS estado
FROM dbo.Cliente AS c
WHERE c.cod_cliente = ${cliente}
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`) || null

    if (!header) return null

    const puntos = this.sql.queryJson(`
SELECT
  CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
  CONVERT(varchar(10), le.fecha_inicio_contrato, 23) AS fecha_inicio_contrato,
  CAST(le.dia_facturacion_abono AS int) AS dia_facturacion_abono,
  LTRIM(RTRIM(CONCAT(
    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
    CASE WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN '' ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta)) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio))) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN '' ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio]))) END,
    CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN '' ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre))) END
  ))) AS direccion
FROM dbo.LugarEntrega AS le
LEFT JOIN dbo.Calle AS ca ON ca.cod_municipio = le.cod_municipio AND ca.cod_calle = le.cod_calle
LEFT JOIN dbo.Municipio AS m ON m.cod_municipio = le.cod_municipio
WHERE le.cod_cliente = ${cliente}
  AND le.fecha_fin_contrato IS NULL
ORDER BY le.fecha_inicio_contrato DESC, CAST(le.nro_lugar_entrega AS int) DESC
FOR JSON PATH, INCLUDE_NULL_VALUES;
`) || []

    return { ...header, puntos, ultimo_punto: puntos[0] || null }
  }

  searchStreets({ codMunicipio, query = '' } = {}) {
    const municipio = positiveInt(codMunicipio, 'Municipio', 99)
    const term = requiredText(query, 'Busqueda de calle', 35)
    return this.sql.queryJson(`
SELECT TOP (30)
  CAST(cod_calle AS int) AS codigo,
  LTRIM(RTRIM(nombre)) AS nombre
FROM dbo.Calle
WHERE cod_municipio = ${municipio}
  AND LTRIM(RTRIM(nombre)) COLLATE Latin1_General_CI_AI LIKE '%${sqlString(term)}%' COLLATE Latin1_General_CI_AI
ORDER BY nombre
FOR JSON PATH;
`) || []
  }

  searchRouteReferences({ query = '' } = {}) {
    const term = requiredText(query, 'Busqueda de referencia', 80)
    return this.sql.queryJson(`
DECLARE @query varchar(80) = '${sqlString(term)}';
WITH locations AS (
  SELECT
    CAST(c.cod_cliente AS int) AS cod_cliente,
    CAST(le.nro_lugar_entrega AS int) AS nro_lugar_entrega,
    LTRIM(RTRIM(c.razon_social)) AS razon_social,
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
  INNER JOIN dbo.LugarEntrega AS le ON le.cod_cliente = c.cod_cliente
  LEFT JOIN dbo.Calle AS ca ON ca.cod_municipio = le.cod_municipio AND ca.cod_calle = le.cod_calle
  LEFT JOIN dbo.Municipio AS m ON m.cod_municipio = le.cod_municipio
  WHERE c.estado = 0
    AND le.fecha_fin_contrato IS NULL
)
SELECT TOP (25)
  cod_cliente,
  nro_lugar_entrega,
  razon_social,
  direccion
FROM locations
WHERE EXISTS (
    SELECT 1
    FROM dbo.Circuito AS ci
    WHERE ci.cod_cliente = locations.cod_cliente
      AND ci.nro_lugar_entrega = locations.nro_lugar_entrega
  )
  AND LOWER(CONCAT(cod_cliente, ' ', nro_lugar_entrega, ' ', razon_social, ' ', direccion, ' ', calle, ' ', numeropuerta, ' ', observ_domicilio, ' ', observ_domicilio_2, ' ', municipio)) COLLATE Latin1_General_CI_AI
    LIKE '%' + LOWER(@query) + '%' COLLATE Latin1_General_CI_AI
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
`) || []
  }

  getReferenceRoutes({ codCliente, nroLugarEntrega } = {}) {
    const cliente = positiveInt(codCliente, 'Cliente de referencia', 9999)
    const punto = positiveInt(nroLugarEntrega, 'Punto de referencia', 99)
    return this.sql.queryJson(`
SELECT
  LTRIM(RTRIM(ci.cod_ruta)) AS cod_ruta,
  LTRIM(RTRIM(COALESCE(r.denominacion, ''))) AS ruta_descripcion,
  CAST(ci.orden_circuito AS int) AS orden_circuito,
  LTRIM(RTRIM(COALESCE(ci.[L-Entrega], ''))) AS l_entrega,
  LTRIM(RTRIM(COALESCE(ci.[L-Cobro], ''))) AS l_cobro
FROM dbo.Circuito AS ci
INNER JOIN dbo.Ruta AS r ON r.cod_ruta = ci.cod_ruta
WHERE ci.cod_cliente = ${cliente}
  AND ci.nro_lugar_entrega = ${punto}
ORDER BY ci.cod_ruta, ci.orden_circuito
FOR JSON PATH, INCLUDE_NULL_VALUES;
`) || []
  }

  previewRouteAssignment(payload = {}) {
    const route = requiredText(payload?.codRuta, 'Ruta', 4)
    const referenciaCliente = positiveInt(payload?.referenciaCliente, 'Cliente de referencia', 9999)
    const referenciaPunto = positiveInt(payload?.referenciaPunto, 'Punto de referencia', 99)
    const referenciaOrden = positiveInt(payload?.referenciaOrden, 'Orden de referencia', 999)
    const cliente = positiveInt(payload?.codCliente, 'Codigo de cliente', 9999)
    const punto = positiveInt(payload?.nroLugarEntrega, 'Punto de entrega', 99)
    return this.sql.queryJson(`
DECLARE @posicion int;
WITH ordenados AS (
  SELECT
    cod_cliente,
    nro_lugar_entrega,
    orden_circuito,
    ROW_NUMBER() OVER (ORDER BY orden_circuito, cod_cliente, nro_lugar_entrega) AS posicion
  FROM dbo.Circuito
  WHERE cod_ruta = '${sqlString(route)}'
)
SELECT @posicion = posicion
FROM ordenados
WHERE cod_cliente = ${referenciaCliente}
  AND nro_lugar_entrega = ${referenciaPunto}
  AND orden_circuito = ${referenciaOrden};

IF @posicion IS NULL
  THROW 56021, 'La referencia ya no pertenece a la ruta seleccionada.', 1;

IF EXISTS (SELECT 1 FROM dbo.Circuito WHERE cod_ruta = '${sqlString(route)}' AND cod_cliente = ${cliente} AND nro_lugar_entrega = ${punto})
  THROW 56022, 'El cliente/punto ya existe en la ruta seleccionada.', 1;

SELECT
  '${sqlString(route)}' AS cod_ruta,
  @posicion AS posicion_referencia,
  @posicion * 5 AS orden_referencia_normalizado,
  @posicion * 5 + 1 AS orden_nuevo,
  (SELECT COUNT(*) FROM dbo.Circuito WHERE cod_ruta = '${sqlString(route)}') AS clientes_a_espaciar
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`)
  }

  createClient(payload) {
    const razonSocial = requiredText(payload?.razonSocial, 'Razon social', 60)
    const domicilio = requiredText(payload?.domFiscal1, 'Domicilio fiscal', 30)
    const cuit = cuitValue(payload?.cuit)
    const tipoCliente = intValue(payload?.tipoCliente, 'Tipo de cliente', [1, 2, 3])
    const categoria = requiredText(payload?.codCategoria, 'Categoria IVA', 1).toUpperCase()
    const tipoCobroRaw = String(payload?.tipoCobro ?? 'N').trim().toUpperCase()
    const tipoCobro = tipoCobroRaw === 'N' || !tipoCobroRaw ? null : tipoCobroRaw
    if (tipoCobro !== null && !['L', 'U'].includes(tipoCobro)) throw new Error('Tipo de cobro no es valido.')

    const tipoFacturacion = tipoCliente === 1 ? 2 : tipoCliente === 3 ? null : intValue(payload?.tipoFactCtaCte, 'Tipo de facturacion de cuenta corriente', [1, 2])
    const codLista = tipoCliente === 2 ? intValue(payload?.codLista, 'Lista de precios') : null
    const limiteCredito = optionalAmount(payload?.limiteCredito, 'Limite de credito')
    const limiteFacturacion = optionalAmount(payload?.limiteFacturacion, 'Limite de facturacion')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @cod_cliente int;
SELECT @cod_cliente = COALESCE(MAX(CAST(cod_cliente AS int)), 0) + 1
FROM dbo.Cliente WITH (UPDLOCK, HOLDLOCK);

IF NOT EXISTS (SELECT 1 FROM dbo.CategoriaIva WITH (HOLDLOCK) WHERE LTRIM(RTRIM(cod_categoria)) = '${sqlString(categoria)}')
  THROW 56001, 'La categoria IVA seleccionada no existe.', 1;

${codLista === null ? '' : `IF NOT EXISTS (SELECT 1 FROM dbo.ListaPrecio WITH (HOLDLOCK) WHERE Cod_lista = ${codLista})
  THROW 56002, 'La lista de precios seleccionada no existe.', 1;`}

IF EXISTS (SELECT 1 FROM dbo.Cliente WITH (UPDLOCK, HOLDLOCK) WHERE cuit = ${cuit} AND LTRIM(RTRIM(razon_social)) = '${sqlString(razonSocial)}')
  THROW 56003, 'Ya existe un cliente con la misma razon social y CUIT.', 1;

INSERT INTO dbo.Cliente
(cod_cliente, razon_social, estado, dom_fiscal1, cuit, tipo_cliente, tipo_fact_ctacte, cons_minimo_ctacte, Cod_lista, limite_credito, frecuencia_facturacion, cod_categoria, tipo_cobro, limite_facturacion)
VALUES
(@cod_cliente, '${sqlString(razonSocial)}', 0, '${sqlString(domicilio)}', ${cuit}, ${tipoCliente}, ${nullableSql(tipoFacturacion)}, 0, ${nullableSql(codLista)}, ${nullableSql(limiteCredito)}, 'M', '${sqlString(categoria)}', ${tipoCobro === null ? 'NULL' : `'${sqlString(tipoCobro)}'`}, ${nullableSql(limiteFacturacion)});

COMMIT TRANSACTION;

SELECT
  @cod_cliente AS cod_cliente,
  '${sqlString(razonSocial)}' AS razon_social,
  ${tipoCliente} AS tipo_cliente,
  ${nullableSql(tipoFacturacion)} AS tipo_fact_ctacte,
  ${nullableSql(codLista)} AS cod_lista,
  '${sqlString(categoria)}' AS cod_categoria
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES;
`)
  }

  createDeliveryPoint(payload) {
    const codCliente = positiveInt(payload?.codCliente, 'Codigo de cliente', 9999)
    const municipio = positiveInt(payload?.codMunicipio, 'Municipio', 99)
    const calle = positiveInt(payload?.codCalle, 'Calle', 9999)
    const numeroPuerta = positiveInt(payload?.numeroPuerta, 'Numero de puerta', 9999, true)
    const fechaInicio = isoDate(payload?.fechaInicioContrato, 'Fecha de inicio de contrato')
    const codLista = positiveInt(payload?.codLista ?? 1, 'Lista de precios', 99)
    const cantEnvases = positiveInt(payload?.cantOptEnvases ?? 4, 'Cantidad optima de envases', 99, true)
    const esLugarCobro = String(payload?.esLugarCobro ?? 'S').trim().toUpperCase()
    const frecuenciaVisita = positiveInt(payload?.frecuenciaVisita ?? 1, 'Frecuencia de visita', 9, true)
    const minfExtra = String(payload?.minfExtra ?? 'D').trim().toUpperCase()
    const observDomicilio = optionalText(payload?.observDomicilio, 'Observacion de domicilio', 40)
    const telefonos = optionalText(payload?.telefonos, 'Telefonos', 50)
    const email = optionalText(payload?.email, 'Email', 60)
    if (!['S', 'N'].includes(esLugarCobro)) throw new Error('Lugar de cobro no es valido.')
    if (!['D', 'B'].includes(minfExtra)) throw new Error('Minf extra no es valido.')

    const diaFacturacion = Math.min(Number(fechaInicio.slice(8, 10)), 28)
    const fechaInicioSql = fechaInicio.replace(/-/g, '')
    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.Cliente WITH (HOLDLOCK) WHERE cod_cliente = ${codCliente})
  THROW 56011, 'El cliente seleccionado no existe.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.Municipio WITH (HOLDLOCK) WHERE cod_municipio = ${municipio})
  THROW 56012, 'El municipio seleccionado no existe.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.Calle WITH (HOLDLOCK) WHERE cod_municipio = ${municipio} AND cod_calle = ${calle})
  THROW 56013, 'La calle no corresponde al municipio seleccionado.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.ListaPrecio WITH (HOLDLOCK) WHERE Cod_lista = ${codLista})
  THROW 56014, 'La lista de precios seleccionada no existe.', 1;

DECLARE @nro_lugar_entrega int;
SELECT @nro_lugar_entrega = COALESCE(MAX(CAST(nro_lugar_entrega AS int)), 0) + 1
FROM dbo.LugarEntrega WITH (UPDLOCK, HOLDLOCK)
WHERE cod_cliente = ${codCliente};

IF @nro_lugar_entrega > 99
  THROW 56015, 'El cliente ya alcanzo el maximo de puntos de entrega.', 1;

IF EXISTS (
  SELECT 1
  FROM dbo.LugarEntrega WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_cliente = ${codCliente}
    AND cod_municipio = ${municipio}
    AND cod_calle = ${calle}
    AND numeropuerta = ${numeroPuerta}
    AND fecha_fin_contrato IS NULL
)
  THROW 56016, 'Ya existe un punto de entrega activo con esa direccion.', 1;

INSERT INTO dbo.LugarEntrega
(cod_cliente, nro_lugar_entrega, tipo_lugar, cod_municipio, cod_calle, numeropuerta, observ_domicilio, fecha_inicio_contrato, fecha_fin_contrato, Cod_lista, dia_facturacion_abono, cant_opt_envases, es_lugar_cobro, telefonos, frecuencia_visita, email, Minf_extra)
VALUES
(${codCliente}, @nro_lugar_entrega, 'E', ${municipio}, ${calle}, ${numeroPuerta}, ${observDomicilio === null ? 'NULL' : `'${sqlString(observDomicilio)}'`}, CONVERT(datetime, '${fechaInicioSql}', 112), NULL, ${codLista}, ${diaFacturacion}, ${cantEnvases}, '${esLugarCobro}', ${telefonos === null ? 'NULL' : `'${sqlString(telefonos)}'`}, ${frecuenciaVisita}, ${email === null ? 'NULL' : `'${sqlString(email)}'`}, '${minfExtra}');

COMMIT TRANSACTION;

SELECT
  ${codCliente} AS cod_cliente,
  @nro_lugar_entrega AS nro_lugar_entrega,
  ${diaFacturacion} AS dia_facturacion_abono,
  '${fechaInicio}' AS fecha_inicio_contrato
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`)
  }

  createRouteAssignment(payload) {
    const route = requiredText(payload?.codRuta, 'Ruta', 4)
    const referenciaCliente = positiveInt(payload?.referenciaCliente, 'Cliente de referencia', 9999)
    const referenciaPunto = positiveInt(payload?.referenciaPunto, 'Punto de referencia', 99)
    const referenciaOrden = positiveInt(payload?.referenciaOrden, 'Orden de referencia', 999)
    const cliente = positiveInt(payload?.codCliente, 'Codigo de cliente', 9999)
    const punto = positiveInt(payload?.nroLugarEntrega, 'Punto de entrega', 99)
    const lEntrega = String(payload?.lEntrega ?? 'S').trim().toUpperCase()
    const lCobro = String(payload?.lCobro ?? 'S').trim().toUpperCase()
    if (!['S', 'N'].includes(lEntrega)) throw new Error('L-Entrega no es valido.')
    if (!['S', 'N', 'B-MP', 'BA', 'BC'].includes(lCobro)) throw new Error('L-Cobro no es valido.')

    return this.sql.executeWriteBatch(`
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.LugarEntrega WITH (HOLDLOCK) WHERE cod_cliente = ${cliente} AND nro_lugar_entrega = ${punto})
  THROW 56031, 'El cliente/punto nuevo no existe.', 1;

IF EXISTS (SELECT 1 FROM dbo.Circuito WITH (UPDLOCK, HOLDLOCK) WHERE cod_ruta = '${sqlString(route)}' AND cod_cliente = ${cliente} AND nro_lugar_entrega = ${punto})
  THROW 56032, 'El cliente/punto ya existe en esta ruta.', 1;

DECLARE @posicion_referencia int;
DECLARE @cantidad int;
WITH ordenados AS (
  SELECT
    cod_cliente,
    nro_lugar_entrega,
    orden_circuito,
    ROW_NUMBER() OVER (ORDER BY orden_circuito, cod_cliente, nro_lugar_entrega) AS posicion
  FROM dbo.Circuito WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_ruta = '${sqlString(route)}'
)
SELECT @posicion_referencia = posicion
FROM ordenados
WHERE cod_cliente = ${referenciaCliente}
  AND nro_lugar_entrega = ${referenciaPunto}
  AND orden_circuito = ${referenciaOrden};

SELECT @cantidad = COUNT(*) FROM dbo.Circuito WITH (UPDLOCK, HOLDLOCK) WHERE cod_ruta = '${sqlString(route)}';

IF @posicion_referencia IS NULL
  THROW 56033, 'La referencia ya no pertenece a la ruta seleccionada.', 1;

IF @cantidad * 5 > 999
  THROW 56034, 'La ruta supera el maximo de ordenes que permite Circuito.', 1;

IF EXISTS (SELECT 1 FROM dbo.Circuito WITH (HOLDLOCK) WHERE cod_ruta = '${sqlString(route)}' AND orden_circuito <= 0)
  THROW 56035, 'La ruta tiene ordenes no positivas y requiere revision manual.', 1;

;WITH ordenados AS (
  SELECT
    cod_ruta,
    orden_circuito,
    ROW_NUMBER() OVER (ORDER BY orden_circuito, cod_cliente, nro_lugar_entrega) AS posicion
  FROM dbo.Circuito WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_ruta = '${sqlString(route)}'
)
UPDATE ci
SET orden_circuito = -o.posicion
FROM dbo.Circuito AS ci
INNER JOIN ordenados AS o
  ON o.cod_ruta = ci.cod_ruta
 AND o.orden_circuito = ci.orden_circuito;

;WITH ordenados AS (
  SELECT
    cod_ruta,
    orden_circuito,
    ROW_NUMBER() OVER (ORDER BY orden_circuito DESC) AS posicion
  FROM dbo.Circuito WITH (UPDLOCK, HOLDLOCK)
  WHERE cod_ruta = '${sqlString(route)}'
)
UPDATE ci
SET orden_circuito = o.posicion * 5
FROM dbo.Circuito AS ci
INNER JOIN ordenados AS o
  ON o.cod_ruta = ci.cod_ruta
 AND o.orden_circuito = ci.orden_circuito;

DECLARE @orden_nuevo int = @posicion_referencia * 5 + 1;
INSERT INTO dbo.Circuito (cod_ruta, orden_circuito, cod_cliente, nro_lugar_entrega, [L-Entrega], [L-Cobro])
VALUES ('${sqlString(route)}', @orden_nuevo, ${cliente}, ${punto}, '${lEntrega}', '${lCobro}');

COMMIT TRANSACTION;

SELECT
  '${sqlString(route)}' AS cod_ruta,
  @orden_nuevo AS orden_circuito,
  ${cliente} AS cod_cliente,
  ${punto} AS nro_lugar_entrega,
  '${lEntrega}' AS l_entrega,
  '${lCobro}' AS l_cobro,
  @cantidad AS clientes_espaciados
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
`)
  }
}

module.exports = { ClientOnboardingRepository }
