const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

const CONTAINER_NAME = process.env.PATNAV_SQL_CONTAINER || 'patnav-sql'
const IMAGE = process.env.PATNAV_SQL_IMAGE || 'mcr.microsoft.com/mssql/server:2022-latest'
const HOST_PORT = process.env.PATNAV_SQL_PORT || '1433'
const DATABASE_NAME = process.env.PATNAV_DB_DATABASE || 'NAVIERA'
const SA_PASSWORD = process.env.PATNAV_SA_PASSWORD || 'PatnavLocal123!'
const APP_LOGIN = process.env.PATNAV_DB_USER || 'navexe'
const APP_PASSWORD = process.env.PATNAV_DB_PASS || 'navexe1433'
const NAV_DATA_DIR = path.resolve(projectRoot, 'nav_data')
const MDF_PATH = path.resolve(process.env.PATNAV_SQL_MDF || path.join(NAV_DATA_DIR, 'NAVIERAX.mdf'))
const LDF_PATH = path.resolve(process.env.PATNAV_SQL_LDF || path.join(NAV_DATA_DIR, 'NAVIERAX_1.ldf'))
const CONTAINER_DATA_DIR = '/var/opt/mssql/data'

const showHelp = () => {
  console.log(`Usage: npm run db:start

Starts or creates a local SQL Server dev container for PATNAV.

Expected local database files:
  ${MDF_PATH}
  ${LDF_PATH}

Useful environment variables:
  PATNAV_SQL_CONTAINER  Container name, default: ${CONTAINER_NAME}
  PATNAV_SQL_IMAGE      SQL Server image, default: ${IMAGE}
  PATNAV_SQL_PORT       Host port, default: ${HOST_PORT}
  PATNAV_SA_PASSWORD    Container sa password, default: PatnavLocal123!
`)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe'
  })

  if (result.error) {
    throw result.error
  }

  if (options.allowFailure) {
    return result
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    const stdout = (result.stdout || '').trim()
    throw new Error(stderr || stdout || `${command} ${args.join(' ')} failed`)
  }

  return result
}

const docker = (args, options) => run('docker', args, options)

const shQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`
const sqlString = value => String(value).replace(/'/g, "''")
const sqlIdentifier = value => `[${String(value).replace(/]/g, ']]')}]`

const containerExists = () =>
  docker(['inspect', CONTAINER_NAME], { allowFailure: true }).status === 0

const containerRunning = () => {
  const result = docker(
    ['inspect', '-f', '{{.State.Running}}', CONTAINER_NAME],
    { allowFailure: true }
  )
  return result.status === 0 && result.stdout.trim() === 'true'
}

const startOrCreateContainer = () => {
  if (containerExists()) {
    if (containerRunning()) {
      console.log(`SQL Server container "${CONTAINER_NAME}" is already running.`)
      return
    }

    console.log(`Starting SQL Server container "${CONTAINER_NAME}"...`)
    docker(['start', CONTAINER_NAME], { stdio: 'inherit' })
    return
  }

  console.log(`Creating SQL Server container "${CONTAINER_NAME}" from ${IMAGE}...`)
  docker(
    [
      'run',
      '-e',
      'ACCEPT_EULA=Y',
      '-e',
      `MSSQL_SA_PASSWORD=${SA_PASSWORD}`,
      '-e',
      'MSSQL_PID=Developer',
      '-p',
      `${HOST_PORT}:1433`,
      '-v',
      `${CONTAINER_NAME}-data:/var/opt/mssql`,
      '--name',
      CONTAINER_NAME,
      '--hostname',
      CONTAINER_NAME,
      '-d',
      IMAGE
    ],
    { stdio: 'inherit' }
  )
}

const runSql = (query, options = {}) => {
  const user = options.user || 'sa'
  const password = options.password || SA_PASSWORD
  const command = [
    'if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then SQLCMD=/opt/mssql-tools18/bin/sqlcmd; else SQLCMD=/opt/mssql-tools/bin/sqlcmd; fi',
    `"$SQLCMD" -S localhost -U ${shQuote(user)} -P ${shQuote(password)} -C -b -l 5 -W -h -1 -Q ${shQuote(query)}`
  ].join('; ')

  return docker(['exec', CONTAINER_NAME, '/bin/bash', '-lc', command], {
    allowFailure: options.allowFailure
  })
}

const waitForSqlServer = async () => {
  console.log('Waiting for SQL Server to accept connections...')
  const deadline = Date.now() + 120000
  let lastError = ''

  while (Date.now() < deadline) {
    const result = runSql('SET NOCOUNT ON; SELECT 1;', { allowFailure: true })
    if (result.status === 0 && result.stdout.includes('1')) {
      console.log('SQL Server is ready.')
      return
    }

    lastError = (result.stderr || result.stdout || '').trim()
    await sleep(2500)
  }

  throw new Error(`SQL Server did not become ready in time. ${lastError}`)
}

const databaseExists = () => {
  const dbName = sqlString(DATABASE_NAME)
  const result = runSql(
    `SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'${dbName}') IS NULL THEN 0 ELSE 1 END;`,
    { allowFailure: true }
  )
  return result.status === 0 && result.stdout.trim().endsWith('1')
}

const containerFileExists = containerPath =>
  docker(['exec', CONTAINER_NAME, 'test', '-f', containerPath], { allowFailure: true }).status === 0

const copyDbFile = (sourcePath, targetPath) => {
  if (containerFileExists(targetPath)) {
    return
  }

  console.log(`Copying ${path.basename(sourcePath)} into SQL Server data volume...`)
  docker(['cp', sourcePath, `${CONTAINER_NAME}:${targetPath}`], { stdio: 'inherit' })
  docker(['exec', '-u', '0', CONTAINER_NAME, 'chown', 'mssql:mssql', targetPath])
  docker(['exec', '-u', '0', CONTAINER_NAME, 'chmod', '660', targetPath])
}

const attachDatabaseIfNeeded = () => {
  if (databaseExists()) {
    console.log(`Database "${DATABASE_NAME}" already exists.`)
    return
  }

  if (!fs.existsSync(MDF_PATH) || !fs.existsSync(LDF_PATH)) {
    console.warn(`Database "${DATABASE_NAME}" is not attached yet.`)
    console.warn(`Expected files:`)
    console.warn(`  ${MDF_PATH}`)
    console.warn(`  ${LDF_PATH}`)
    console.warn('Place the MDF/LDF files there, then rerun npm run db:start.')
    return
  }

  const containerMdf = `${CONTAINER_DATA_DIR}/${path.basename(MDF_PATH)}`
  const containerLdf = `${CONTAINER_DATA_DIR}/${path.basename(LDF_PATH)}`

  copyDbFile(MDF_PATH, containerMdf)
  copyDbFile(LDF_PATH, containerLdf)

  console.log(`Attaching "${DATABASE_NAME}" from MDF/LDF files...`)
  runSql(`
    CREATE DATABASE ${sqlIdentifier(DATABASE_NAME)}
    ON (FILENAME = N'${sqlString(containerMdf)}'),
       (FILENAME = N'${sqlString(containerLdf)}')
    FOR ATTACH;
  `)
}

const ensureAppLogin = () => {
  const loginName = sqlString(APP_LOGIN)
  const loginIdentifier = sqlIdentifier(APP_LOGIN)
  const password = sqlString(APP_PASSWORD)

  console.log(`Ensuring SQL login "${APP_LOGIN}" exists for PATNAV...`)
  runSql(`
    IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'${loginName}')
    BEGIN
      CREATE LOGIN ${loginIdentifier} WITH PASSWORD = N'${password}', CHECK_POLICY = OFF;
    END;

    IF IS_SRVROLEMEMBER(N'sysadmin', N'${loginName}') = 0
    BEGIN
      ALTER SERVER ROLE [sysadmin] ADD MEMBER ${loginIdentifier};
    END;
  `)
}

const main = async () => {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp()
    return
  }

  try {
    docker(['version'], { allowFailure: false })
    startOrCreateContainer()
    await waitForSqlServer()
    attachDatabaseIfNeeded()
    ensureAppLogin()
    console.log('')
    console.log('Local PATNAV SQL Server is ready.')
    console.log(`Use PATNAV_DB_SERVER=127.0.0.1,${HOST_PORT}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
