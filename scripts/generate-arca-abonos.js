#!/usr/bin/env node

const { LocalSqlServer, PythonOdbcSqlServer } = require('./arca/local-sql-server')
const { AbonoRepository } = require('./arca/abono-repository')
const { ArcaApiProvider } = require('./arca/arca-api-provider')
const { AbonoAuthorizationService } = require('./arca/abono-authorization-service')
const { assertRuntimeDatabase, getArcaRuntimeConfig } = require('./arca/arca-runtime-config')

const CONFIRMATION = 'CONFIRMAR_ABONOS_HOMOLOGACION'
const PRODUCTION_CONFIRMATION = 'CONFIRMAR_ABONOS_PRODUCCION'

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

    if (['help'].includes(name)) {
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
  npm run arca:abonos -- --desde 2026-09-01 --hasta 2026-09-07 --limit 10
  npm run arca:abonos -- --desde 2026-09-01 --hasta 2026-09-07 --limit 10 --confirmar ${CONFIRMATION}
  npm run arca:abonos -- --environment produccion --desde 2026-09-01 --hasta 2026-09-07
  npm run arca:abonos -- --environment produccion --desde 2026-09-01 --hasta 2026-09-07 --confirmar ${PRODUCTION_CONFIRMATION}

Options:
  --desde YYYY-MM-DD        Inicio del rango
  --hasta YYYY-MM-DD        Fin del rango
  --limit N                 Maximo de abonos detallados/procesados, default 25
  --environment NAME        homologacion o produccion; default homologacion
  --representada CUIT       CUIT emisor; default ARCA_REPRESENTADA_CUIT
  --fecha-emision DATE      Override operativo opcional; si se omite usa fecha actual local
  --confirmar TOKEN         Procesa solo con el token del ambiente`)
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2))
}

function sanitizeLimit(value) {
  const parsed = Number.parseInt(String(value || '25'), 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('--limit must be between 1 and 1000.')
  }
  return parsed
}

function buildSql(runtime) {
  if (runtime.sqlMode === 'python-odbc') {
    return new PythonOdbcSqlServer({ database: runtime.sql.database })
  }
  return new LocalSqlServer()
}

function confirmationFor(runtime) {
  return runtime.environment === 'produccion' ? PRODUCTION_CONFIRMATION : CONFIRMATION
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

  const runtime = getArcaRuntimeConfig(args.environment || 'homologacion')
  const sql = buildSql(runtime)
  assertRuntimeDatabase({ runtime, sqlSummary: sql.getConnectionSummary() })

  const repository = new AbonoRepository(sql)
  const provider = new ArcaApiProvider({
    environment: runtime.environment,
    representada: args.representada,
    ptoVta: runtime.ptoVtaElectronico,
    concepto: 2,
    fechaHomologacion: args.fechaEmision,
    legacyPriceMode: 'gross'
  })
  const service = new AbonoAuthorizationService({ repository, provider })
  const limit = sanitizeLimit(args.limit)
  const expectedConfirmation = confirmationFor(runtime)

  if (args.confirmar !== expectedConfirmation) {
    const request = {
      desde: args.desde,
      hasta: args.hasta,
      limit,
      fechaHomologacion: args.fechaEmision
    }
    const rangePreview = repository.getRangePreview({
      desde: request.desde,
      hasta: request.hasta,
      limit,
      periodoDate: request.desde
    })
    const evaluatedCandidates = rangePreview.candidatos || []
    const preflight = service.buildPendingFiscalPreflight().buildPreview({
      targetDate: request.fechaHomologacion || request.desde
    })

    printJson({
      modo: 'PREVIEW',
      environment: runtime.environment,
      escribe_db: false,
      llama_arca: false,
      confirmacion_requerida_para_generar: expectedConfirmation,
      db: sql.getConnectionSummary(),
      preflight,
      resumen: service.buildPreviewSummaryFromRange(rangePreview.resumen || {}),
      candidatos: evaluatedCandidates.map(candidate => ({
        cliente: candidate.cod_cliente,
        punto: candidate.nro_lugar_entrega,
        tipo: `${candidate.tipo_comprobante}/${candidate.prefijo_destino}`,
        destino: candidate.destino_facturacion,
        total: candidate.total_bruto,
        estado: candidate.estado_preview,
        motivo: candidate.motivo_preview
      }))
    })
    return
  }

  const result = await service.processBatch({
    desde: args.desde,
    hasta: args.hasta,
    limit,
    fechaHomologacion: args.fechaEmision
  })

  printJson({
    modo: runtime.environment === 'produccion' ? 'CONFIRMADO_PRODUCCION' : 'CONFIRMADO_HOMOLOGACION',
    resumen: result.summary
  })
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
