const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const migrationPath = path.join(__dirname, 'add-view5-permission.sql')
const container = process.env.PATNAV_SQL_CONTAINER || 'patnav-sql'
const database = process.env.PATNAV_DB_DATABASE || 'NAVIERA'
const user = process.env.PATNAV_DB_USER || 'navexe'
const password = process.env.PATNAV_DB_PASS || 'navexe1433'

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`
const migration = fs.readFileSync(migrationPath, 'utf8')
const command = [
  'if [ -x /opt/mssql-tools18/bin/sqlcmd ]; then SQLCMD=/opt/mssql-tools18/bin/sqlcmd; else SQLCMD=/opt/mssql-tools/bin/sqlcmd; fi',
  `"$SQLCMD" -S localhost -U ${shellQuote(user)} -P ${shellQuote(password)} -C -b -d ${shellQuote(database)}`
].join('; ')

const result = spawnSync(
  'docker',
  ['exec', '-i', container, '/bin/bash', '-lc', command],
  {
    cwd: projectRoot,
    encoding: 'utf8',
    input: migration,
    stdio: ['pipe', 'pipe', 'pipe']
  }
)

if (result.error) {
  throw result.error
}

if (result.stdout) {
  process.stdout.write(result.stdout)
}

if (result.status !== 0) {
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  process.exitCode = result.status || 1
} else {
  console.log('Comprobantes permission is ready.')
}
