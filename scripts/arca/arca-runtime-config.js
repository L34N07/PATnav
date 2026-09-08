const RUNTIME_CONFIGS = {
  homologacion: {
    environment: 'homologacion',
    ptoVtaElectronico: 6,
    sqlMode: 'local-docker',
    sql: {
      container: 'patnav-sql',
      database: 'NAVIERA'
    },
    allowProcessing: true
  },
  produccion: {
    environment: 'produccion',
    ptoVtaElectronico: 7,
    sqlMode: 'python-odbc',
    sql: {
      database: 'NAVIERA'
    },
    allowProcessing: true
  },
  production: {
    environment: 'produccion',
    ptoVtaElectronico: 7,
    sqlMode: 'python-odbc',
    sql: {
      database: 'NAVIERA'
    },
    allowProcessing: true
  }
}

function getArcaRuntimeConfig(environment = 'homologacion') {
  const key = String(environment || 'homologacion').trim().toLowerCase()
  const config = RUNTIME_CONFIGS[key]
  if (!config) {
    throw new Error(`Unknown ARCA environment: ${environment}`)
  }
  return config
}

function assertHomologacionLocal({ environment, sqlSummary }) {
  const config = getArcaRuntimeConfig(environment)
  if (config.environment !== 'homologacion' || !config.allowProcessing) {
    throw new Error('Processing blocked: production is configured but disabled.')
  }
  if (
    sqlSummary.container !== config.sql.container ||
    sqlSummary.database !== config.sql.database
  ) {
    throw new Error('Processing blocked: homologacion only uses local patnav-sql/NAVIERA.')
  }
}

function assertRuntimeDatabase({ runtime, sqlSummary }) {
  if (runtime.environment === 'homologacion') {
    assertHomologacionLocal({ environment: runtime.environment, sqlSummary })
    return
  }
  if (runtime.environment === 'produccion' && sqlSummary.database !== runtime.sql.database) {
    throw new Error('Processing blocked: production must use NAVIERA database.')
  }
}

module.exports = {
  getArcaRuntimeConfig,
  assertHomologacionLocal,
  assertRuntimeDatabase
}
