#!/usr/bin/env node

const { LocalSqlServer } = require('./arca/local-sql-server')
const { AbonoRepository } = require('./arca/abono-repository')
const { ArcaApiProvider } = require('./arca/arca-api-provider')
const { AbonoAuthorizationService } = require('./arca/abono-authorization-service')
const { postFactura } = require('./arca/arca-api-read-only-client')

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

    if (['help', 'emitirHomologacion', 'noSchema'].includes(name)) {
      args[name] = true
      continue
    }

    const value = inlineValue !== undefined ? inlineValue : argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for --${rawName}`)
    }
    if (inlineValue === undefined) {
      index += 1
    }
    args[name] = value
  }

  return args
}

function showHelp() {
  console.log(`Usage:
  npm run arca:abono-test -- --desde 2026-09-01 --hasta 2026-09-07 --limit 1 --fecha-homologacion 2026-09-02

Options:
  --desde YYYY-MM-DD          Inicio del rango de dias de facturacion
  --hasta YYYY-MM-DD          Fin del rango de dias de facturacion
  --limit N                   Cantidad maxima de candidatas a buscar, default 1
  --cod-cliente N             Cliente puntual a previsualizar/emitir
  --nro-lugar-entrega N       Punto de entrega puntual a previsualizar/emitir
  --fecha-homologacion DATE   Fecha usada para Ventas.fecha_operacion y ARCA.cbteFch
  --representada CUIT         CUIT emisor; default ARCA_REPRESENTADA_CUIT
  --emitir-homologacion       POST a ARCA homologacion e INSERT local si aprueba

Safety:
  Sin --emitir-homologacion no hace HTTP de emision ni escribe en NAVIERA.
  Con --emitir-homologacion solo permite homologacion, ptoVta 6 y DB local Docker.`)
}

function printSection(title, value) {
  console.log(`\n## ${title}`)
  if (typeof value === 'string') {
    console.log(value)
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

function buildSummary(previews) {
  return previews.map((preview, index) => ({
    n: index + 1,
    cliente: preview.selectedCandidate.cod_cliente,
    punto_entrega: preview.selectedCandidate.nro_lugar_entrega,
    razon_social: preview.selectedCandidate.razon_social,
    activo_cliente: preview.selectedCandidate.cliente_estado === 0,
    activo_punto_entrega: preview.selectedCandidate.lugar_fecha_fin_contrato === null,
    tipo: preview.selectedCandidate.tipo_comprobante,
    destino: preview.selectedCandidate.destino_facturacion,
    dispensers: preview.dispensers.length,
    total: preview.totals.legacyGrossTotal,
    periodo: preview.abono.periodoServicio.yyyymm,
    warnings: preview.authorizationPreview.warnings.join('; ')
  }))
}

function buildDetailedPreview(preview, index) {
  return {
    n: index + 1,
    cliente: {
      cod_cliente: preview.selectedCandidate.cod_cliente,
      nro_lugar_entrega: preview.selectedCandidate.nro_lugar_entrega,
      razon_social: preview.selectedCandidate.razon_social,
      cliente_estado: preview.selectedCandidate.cliente_estado,
      lugar_fecha_fin_contrato: preview.selectedCandidate.lugar_fecha_fin_contrato,
      tipo_cliente: preview.selectedCandidate.tipo_cliente,
      tipo_comprobante: preview.selectedCandidate.tipo_comprobante,
      cuit: preview.header.cuit,
      cod_categoria: preview.selectedCandidate.cod_categoria,
      categoria_iva: preview.selectedCandidate.categoria_iva
    },
    dispensers_considerados: preview.dispensers.map(dispenser => ({
      cod_dispenser: dispenser.cod_dispenser,
      nro_serie: dispenser.nro_serie,
      MControl2: dispenser.mcontrol2,
      cod_abono_o_alquiler: dispenser.cod_abono_o_alquiler,
      cod_item: dispenser.cod_item,
      item: dispenser.denominacion
    })),
    items_agrupados: preview.groupedItems.map(item => ({
      orden: item.orden,
      cod_item: item.codItem,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_bruto: item.precioBruto,
      precio_neto: item.precioUnitarioNeto,
      tasa_iva: item.tasaIva,
      neto_total: item.importeNeto,
      iva: item.iva,
      total: item.importeBruto,
      total_reconstruido: item.totalReconstruido,
      dispensers_agrupados: item.dispensers.length
    })),
    periodo_abono: preview.abono.periodoServicio,
    fecha_emision: preview.abono.fechaEmision,
    fecha_vencimiento_legacy: preview.abono.fechaVencimiento,
    idempotencyKey: preview.abono.idempotencyKey,
    payload_ARCA: preview.authorizationPreview.payload,
    totales: preview.totals,
    warnings: preview.authorizationPreview.warnings,
    bloqueos: preview.blockers
  }
}

function assertLocalHomologacion({ sql, preview }) {
  const summary = sql.getConnectionSummary()
  const payload = preview.authorizationPreview.payload
  if (summary.container !== 'patnav-sql' || summary.database !== 'NAVIERA') {
    throw new Error('Emission blocked: this script only emits against local patnav-sql/NAVIERA.')
  }
  if (!preview.abono.fiscalClassification.electronic || preview.abono.fiscalClassification.destination !== 'arca') {
    throw new Error('Emission blocked: only FA/FB electronicas can be posted to ARCA.')
  }
  if (!payload || payload.environment !== 'homologacion') {
    throw new Error('Emission blocked: environment must be homologacion.')
  }
  if (Number(payload.ptoVta) !== 6) {
    throw new Error('Emission blocked: ptoVta must be 6.')
  }
  if (preview.blocked) {
    throw new Error(`Emission blocked: ${preview.blockers.join(' ')}`)
  }
}

function buildEmissionResultForInsert(response) {
  const body = response && response.response
  if (!body || body.resultado !== 'A') {
    throw new Error(`ARCA did not approve the invoice: ${JSON.stringify(body)}`)
  }
  return {
    cbteNro: body.cbteNro,
    cae: body.cae,
    caeFchVto: body.caeFchVto,
    ptoVta: body.ptoVta,
    cbteTipo: body.cbteTipo,
    observaciones: body.observaciones || [],
    errores: body.errores || []
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    showHelp()
    return
  }

  if (!args.desde || !args.hasta) {
    throw new Error('--desde and --hasta are required.')
  }

  const sql = new LocalSqlServer()
  const repository = new AbonoRepository(sql)
  const provider = new ArcaApiProvider({
    representada: args.representada,
    ptoVta: 6,
    concepto: 2,
    fechaHomologacion: args.fechaHomologacion,
    legacyPriceMode: 'gross'
  })
  const service = new AbonoAuthorizationService({ repository, provider })
  const hasExplicitCandidate = args.codCliente !== undefined || args.nroLugarEntrega !== undefined
  if (hasExplicitCandidate && (args.codCliente === undefined || args.nroLugarEntrega === undefined)) {
    throw new Error('--cod-cliente and --nro-lugar-entrega must be provided together.')
  }

  function buildRequestedPreview() {
    if (hasExplicitCandidate) {
      return service.buildPreviewForCandidate({
        selected: {
          cod_cliente: args.codCliente,
          nro_lugar_entrega: args.nroLugarEntrega
        },
        desde: args.desde,
        fechaHomologacion: args.fechaHomologacion
      })
    }

    return service.buildPreview({
      desde: args.desde,
      hasta: args.hasta,
      limit: args.limit || 1,
      fechaHomologacion: args.fechaHomologacion
    })
  }

  if (!args.emitirHomologacion && !hasExplicitCandidate) {
    const batch = service.buildBatchPreview({
      desde: args.desde,
      hasta: args.hasta,
      limit: args.limit || 1,
      fechaHomologacion: args.fechaHomologacion
    })

    console.log('PATNav ARCA abono batch preview')
    console.log('Preview only. No invoice POST was made. No INSERT/UPDATE/DELETE was executed.')
    printSection('Local DB', sql.getConnectionSummary())
    printSection('Resumen candidatas', buildSummary(batch.previews))
    printSection(
      'Detalles candidatas',
      batch.previews.map((preview, index) => buildDetailedPreview(preview, index))
    )
    printSection('Descartados', batch.discarded)
    printSection('Conteos seleccion', {
      requestedLimit: batch.requestedLimit,
      poolCandidateCount: batch.poolCandidateCount,
      readyCandidateCount: batch.readyCandidateCount,
      selectedPreviewCount: batch.previews.length,
      discardedCount: batch.discarded.length
    })
    return
  }

  if (Number.parseInt(String(args.limit || '1'), 10) !== 1) {
    throw new Error('--emitir-homologacion is intentionally limited to --limit 1.')
  }

  const preview = buildRequestedPreview()

  console.log('PATNav ARCA abono preview')
  console.log(
    args.emitirHomologacion
      ? 'Explicit homologacion emission requested. Will insert locally only after ARCA resultado=A.'
      : 'Preview only. No invoice POST was made. No INSERT/UPDATE/DELETE was executed.'
  )

  printSection('Local DB', sql.getConnectionSummary())
  printSection('Reglas legacy reutilizadas', preview.legacyRules)
  printSection('Cliente y lugar', preview.selectedCandidate)
  printSection('Cabecera calculada', {
    tipo_comprobante: preview.abono.tipoComprobante,
    prefijo_destino_si_aprueba_arca: 6,
    fecha_emision: preview.abono.fechaEmision,
    fecha_vencimiento: preview.abono.fechaVencimiento,
    periodo_servicio: preview.abono.periodoServicio,
    tipo_facturacion: preview.abono.tipoFacturacion,
    idempotencyKey: preview.abono.idempotencyKey
  })
  printSection('Dispensers considerados', preview.dispensers)
  printSection('Items agrupados', preview.groupedItems)
  printSection('Control duplicados', preview.duplicateCheck)
  printSection('Payload ARCA', preview.authorizationPreview.payload)
  printSection('Totales y redondeo', preview.totals)
  printSection('Warnings', preview.authorizationPreview.warnings)
  printSection('Bloqueos', preview.blockers)

  if (!args.emitirHomologacion) {
    return
  }

  assertLocalHomologacion({ sql, preview })
  const arcaResponse = await postFactura({
    payload: preview.authorizationPreview.payload,
    idempotencyKey: preview.abono.idempotencyKey
  })
  const approval = buildEmissionResultForInsert(arcaResponse)
  const insertResult = repository.insertAuthorizedAbono({
    abono: preview.abono,
    arcaResult: approval
  })

  printSection('ARCA aprobado', {
    cbteNro: approval.cbteNro,
    cae: approval.cae,
    caeFchVto: approval.caeFchVto,
    ptoVta: approval.ptoVta,
    cbteTipo: approval.cbteTipo,
    observaciones: approval.observaciones,
    errores: approval.errores
  })
  printSection('Insert NAVIERA local', insertResult)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
