const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

const mode = process.argv[2]
const CONTAINER_NAME = process.env.PATNAV_SQL_CONTAINER || 'patnav-sql'
const DATABASE_NAME = process.env.PATNAV_DB_DATABASE || 'NAVIERA'
const SA_PASSWORD = process.env.PATNAV_SA_PASSWORD || 'PatnavLocal123!'
const LOCAL_BACKUP_PATH = path.resolve(
  projectRoot,
  process.env.PATNAV_DB_BACKUP_PATH || path.join('nav_data', `${DATABASE_NAME}_manual_backup.bak`)
)
const CONTAINER_BACKUP_DIR = '/var/opt/mssql/backup'
const CONTAINER_BACKUP_PATH = `${CONTAINER_BACKUP_DIR}/${path.basename(LOCAL_BACKUP_PATH)}`

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

const runSql = (query, options = {}) => {
  const command = [
    'if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then SQLCMD=/opt/mssql-tools18/bin/sqlcmd; else SQLCMD=/opt/mssql-tools/bin/sqlcmd; fi',
    `"$SQLCMD" -S localhost -U sa -P ${shQuote(SA_PASSWORD)} -C -b -l 30 -W -Q ${shQuote(query)}`
  ].join('; ')

  return docker(['exec', CONTAINER_NAME, '/bin/bash', '-lc', command], {
    allowFailure: options.allowFailure,
    stdio: options.stdio
  })
}

const ensureDbReady = () => {
  run(process.execPath, [path.join(__dirname, 'start-dev-db.js')], { stdio: 'inherit' })
}

const ensureBackupDir = () => {
  docker(['exec', '-u', '0', CONTAINER_NAME, 'mkdir', '-p', CONTAINER_BACKUP_DIR])
  docker(['exec', '-u', '0', CONTAINER_NAME, 'chown', 'mssql:mssql', CONTAINER_BACKUP_DIR])
}

const formatBytes = bytes => {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const backup = () => {
  ensureDbReady()
  ensureBackupDir()
  fs.mkdirSync(path.dirname(LOCAL_BACKUP_PATH), { recursive: true })

  console.log(`Backing up "${DATABASE_NAME}" to ${LOCAL_BACKUP_PATH}...`)
  runSql(`
    BACKUP DATABASE ${sqlIdentifier(DATABASE_NAME)}
    TO DISK = N'${sqlString(CONTAINER_BACKUP_PATH)}'
    WITH INIT, FORMAT, COMPRESSION, CHECKSUM, STATS = 10;

    RESTORE VERIFYONLY
    FROM DISK = N'${sqlString(CONTAINER_BACKUP_PATH)}'
    WITH CHECKSUM;
  `, { stdio: 'inherit' })

  if (fs.existsSync(LOCAL_BACKUP_PATH)) {
    fs.rmSync(LOCAL_BACKUP_PATH)
  }

  docker(['cp', `${CONTAINER_NAME}:${CONTAINER_BACKUP_PATH}`, LOCAL_BACKUP_PATH])

  const { size } = fs.statSync(LOCAL_BACKUP_PATH)
  console.log(`Backup ready: ${LOCAL_BACKUP_PATH} (${formatBytes(size)})`)
}

const restore = () => {
  if (!fs.existsSync(LOCAL_BACKUP_PATH)) {
    throw new Error(`Backup not found: ${LOCAL_BACKUP_PATH}`)
  }

  ensureDbReady()
  ensureBackupDir()

  console.log(`Copying backup into SQL Server container...`)
  docker(['cp', LOCAL_BACKUP_PATH, `${CONTAINER_NAME}:${CONTAINER_BACKUP_PATH}`])
  docker(['exec', '-u', '0', CONTAINER_NAME, 'chown', 'mssql:mssql', CONTAINER_BACKUP_PATH])

  console.log(`Restoring "${DATABASE_NAME}" from ${LOCAL_BACKUP_PATH}...`)
  runSql(`
    USE [master];

    RESTORE VERIFYONLY
    FROM DISK = N'${sqlString(CONTAINER_BACKUP_PATH)}'
    WITH CHECKSUM;

    BEGIN TRY
      IF DB_ID(N'${sqlString(DATABASE_NAME)}') IS NOT NULL
      BEGIN
        ALTER DATABASE ${sqlIdentifier(DATABASE_NAME)}
        SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      END;

      RESTORE DATABASE ${sqlIdentifier(DATABASE_NAME)}
      FROM DISK = N'${sqlString(CONTAINER_BACKUP_PATH)}'
      WITH REPLACE, RECOVERY, CHECKSUM, STATS = 10;

      ALTER DATABASE ${sqlIdentifier(DATABASE_NAME)} SET MULTI_USER;
    END TRY
    BEGIN CATCH
      IF DB_ID(N'${sqlString(DATABASE_NAME)}') IS NOT NULL
      BEGIN
        ALTER DATABASE ${sqlIdentifier(DATABASE_NAME)} SET MULTI_USER;
      END;

      THROW;
    END CATCH;
  `, { stdio: 'inherit' })

  console.log(`Database restored from: ${LOCAL_BACKUP_PATH}`)
}

try {
  if (mode === 'backup') {
    backup()
  } else if (mode === 'restore') {
    restore()
  } else {
    console.log('Usage:')
    console.log('  npm run db:backup   # replace the saved manual backup')
    console.log('  npm run db:restore  # restore that saved manual backup')
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
