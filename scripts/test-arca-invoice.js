#!/usr/bin/env node

const { LocalSqlServer } = require('./arca/local-sql-server')
const {
  LegacyInvoiceRepository,
  normalizeInvoiceKey
} = require('./arca/legacy-invoice-repository')
const { ArcaApiProvider } = require('./arca/arca-api-provider')
const {
  InvoiceAuthorizationService
} = require('./arca/invoice-authorization-service')
const { getUltimoComprobante } = require('./arca/arca-api-read-only-client')

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    const name = rawName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

    if (name === 'help') {
      args.help = true
      continue
    }
    if (name === 'includeEmail') {
      args.includeEmail = true
      continue
    }
    if (name === 'noSchema') {
      args.noSchema = true
      continue
    }
    if (name === 'consultarUltimoArca') {
      args.consultarUltimoArca = true
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
  node scripts/test-arca-invoice.js --tipo FB --prefijo 7 --numero 48954
  npm run arca:dry-run -- --tipo FB --prefijo 7 --numero 48954

Environment:
  ARCA_REPRESENTADA_CUIT                 CUIT emisor para el payload
  PATNAV_ARCA_HOMOLOGACION_PTO_VTA       Punto de venta homologacion, default 6
  PATNAV_ARCA_LEGACY_PRICE_MODE          gross | net, default gross

Options:
  --representada <cuit>      Override del CUIT emisor
  --pto-vta <numero>         Override de punto de venta homologacion
  --concepto <1|2|3>         Concepto ARCA, default 1
  --fecha-homologacion <yyyy-mm-dd>
                              Reemplaza solo cbteFch en el payload
  --price-mode <gross|net>   Interpretacion de VentasItems.precio
  --include-email            Incluye LugarEntrega.email en el payload
  --no-schema                Omite metadata de columnas/indices en pantalla
  --consultar-ultimo-arca    Consulta /api/wsfe/ultimo-comprobante con ARCA_API_KEY

Safety:
  El dry-run no escribe en NAVIERA ni emite facturas.
  ARCA_API_KEY solo se lee si se usa --consultar-ultimo-arca.`)
}

function printSection(title, value) {
  console.log(`\n## ${title}`)
  if (typeof value === 'string') {
    console.log(value)
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

function maybeBuildInvoiceKey(args, repository) {
  const hasAnyKeyPart = ['tipo', 'prefijo', 'numero'].some(name => args[name] !== undefined)
  const hasAllKeyParts = ['tipo', 'prefijo', 'numero'].every(name => args[name] !== undefined)

  if (hasAllKeyParts) {
    return normalizeInvoiceKey(args)
  }

  if (hasAnyKeyPart) {
    throw new Error('--tipo, --prefijo and --numero must be provided together.')
  }

  const latest = repository.findLatestCandidate('FB')
  if (!latest) {
    throw new Error('No FB invoice without CAE was found in the local NAVIERA database.')
  }

  return normalizeInvoiceKey(latest)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    showHelp()
    return
  }

  const sql = new LocalSqlServer()
  const repository = new LegacyInvoiceRepository(sql)
  const invoiceKey = maybeBuildInvoiceKey(args, repository)
  const provider = new ArcaApiProvider({
    representada: args.representada,
    ptoVta: args.ptoVta,
    concepto: args.concepto,
    fechaHomologacion: args.fechaHomologacion,
    legacyPriceMode: args.priceMode,
    includeEmail: args.includeEmail
  })
  const service = new InvoiceAuthorizationService({ repository, provider })
  const dryRun = service.buildDryRun(invoiceKey)

  console.log('PATNav ARCA invoice dry-run')
  console.log(
    args.consultarUltimoArca
      ? 'Only the read-only ARCA ultimo-comprobante endpoint may be queried. No invoice POST was made.'
      : 'No HTTP request was made. No INSERT/UPDATE/DELETE was executed.'
  )
  if (args.consultarUltimoArca) {
    console.log('No INSERT/UPDATE/DELETE was executed.')
  }
  console.log(
    args.consultarUltimoArca
      ? 'ARCA_API_KEY is used only for the read-only ultimo-comprobante query.'
      : 'ARCA_API_KEY is intentionally not read by this script.'
  )

  printSection('Local DB', sql.getConnectionSummary())
  printSection('Factura elegida', dryRun.selectedInvoice)

  if (!args.noSchema) {
    printSection('Estructura relevante', dryRun.schema)
  }

  printSection('Datos obtenidos por tabla', dryRun.sourceRecords)
  printSection(
    'Fechas',
    `FECHA ORIGINAL DB: ${dryRun.authorizationPreview.dates.originalDbDate}\nFECHA USADA PARA HOMOLOGACION: ${dryRun.authorizationPreview.dates.homologationCbteFch}`
  )
  printSection('Preview de request ARCA', {
    provider: dryRun.authorizationPreview.provider,
    method: dryRun.authorizationPreview.method,
    endpoint: dryRun.authorizationPreview.endpoint,
    wouldPost: dryRun.authorizationPreview.wouldPost,
    headersPreview: dryRun.authorizationPreview.headersPreview
  })
  printSection('JSON final para arca.api', dryRun.authorizationPreview.payload)
  printSection('Evidencia de mapeo', dryRun.authorizationPreview.mappingEvidence)
  printSection('Totales calculados', dryRun.authorizationPreview.totals)
  printSection('Warnings', dryRun.authorizationPreview.warnings)
  printSection('Datos no mapeados con certeza', dryRun.authorizationPreview.unmapped)

  if (args.consultarUltimoArca) {
    const ultimoComprobante = await getUltimoComprobante({
      environment: dryRun.authorizationPreview.payload.environment,
      representada: dryRun.authorizationPreview.payload.representada,
      ptoVta: dryRun.authorizationPreview.payload.ptoVta,
      cbteTipo: dryRun.authorizationPreview.payload.cbteTipo
    })
    printSection('Ultimo comprobante ARCA', ultimoComprobante)
  }
}

try {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
