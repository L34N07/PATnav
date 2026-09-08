const { spawnSync } = require('child_process')

const SQLCMD_PATHS = [
  '/opt/mssql-tools18/bin/sqlcmd',
  '/opt/mssql-tools/bin/sqlcmd'
]

const DEFAULT_CONTAINER = 'patnav-sql'
const DEFAULT_DATABASE = 'NAVIERA'
const DEFAULT_USER = 'navexe'
const DEFAULT_PASSWORD = 'navexe1433'
const DEFAULT_SERVER = '100.115.224.40,1433'
const DEFAULT_DRIVER = 'ODBC Driver 18 for SQL Server'

const MUTATING_SQL_PATTERN =
  /\b(ALTER|BACKUP|CREATE|DELETE|DENY|DROP|EXEC|EXECUTE|GRANT|INSERT|MERGE|RESTORE|REVOKE|SELECT\s+.+?\s+INTO|TRUNCATE|UPDATE)\b/is

function stripSqlComments(query) {
  return String(query)
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function assertReadOnlySql(query) {
  const cleaned = stripSqlComments(query)
  if (MUTATING_SQL_PATTERN.test(cleaned)) {
    throw new Error('Dry-run SQL blocked: only read-only SELECT queries are allowed.')
  }
}

function extractJson(stdout) {
  const trimmed = String(stdout || '').trim()
  if (!trimmed) {
    return null
  }

  const compact = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('')

  try {
    return JSON.parse(compact)
  } catch (firstError) {
    const firstArray = compact.indexOf('[')
    const firstObject = compact.indexOf('{')
    const starts = [firstArray, firstObject].filter(index => index >= 0)
    const start = starts.length > 0 ? Math.min(...starts) : -1
    const end = Math.max(compact.lastIndexOf(']'), compact.lastIndexOf('}'))

    if (start >= 0 && end >= start) {
      return JSON.parse(compact.slice(start, end + 1))
    }

    throw firstError
  }
}

class LocalSqlServer {
  constructor(options = {}) {
    this.container = options.container || process.env.PATNAV_SQL_CONTAINER || DEFAULT_CONTAINER
    this.database = options.database || process.env.PATNAV_DB_DATABASE || DEFAULT_DATABASE
    this.user = options.user || process.env.PATNAV_DB_USER || DEFAULT_USER
    this.password = options.password || process.env.PATNAV_DB_PASS || DEFAULT_PASSWORD
    this.connectTimeout = String(options.connectTimeout || process.env.PATNAV_DB_CONNECT_TIMEOUT || 5)
  }

  getConnectionSummary() {
    return {
      mode: 'local-docker-sqlcmd',
      container: this.container,
      server: 'localhost inside container',
      database: this.database,
      user: this.user
    }
  }

  queryJson(query) {
    assertReadOnlySql(query)
    const stdout = this.runSql(query)
    return extractJson(stdout)
  }

  executeWriteBatch(query) {
    const stdout = this.runSql(query)
    return extractJson(stdout)
  }

  runSql(query) {
    let lastError = null

    for (const sqlcmdPath of SQLCMD_PATHS) {
      const result = spawnSync(
        'docker',
        [
          'exec',
          this.container,
          sqlcmdPath,
          '-S',
          'localhost',
          '-U',
          this.user,
          '-P',
          this.password,
          '-d',
          this.database,
          '-C',
          '-b',
          '-l',
          this.connectTimeout,
          '-y',
          '0',
          '-Y',
          '0',
          '-w',
          '65535',
          '-Q',
          query
        ],
        {
          encoding: 'utf8',
          maxBuffer: 20 * 1024 * 1024
        }
      )

      if (result.error) {
        lastError = result.error
        continue
      }

      if (result.status === 0) {
        return result.stdout
      }

      lastError = new Error((result.stderr || result.stdout || '').trim())
      const pathMissing = /no such file|not found|stat .* no such/i.test(
        `${result.stderr || ''}\n${result.stdout || ''}`
      )
      if (!pathMissing) {
        break
      }
    }

    throw new Error(
      [
        'Could not query the local PATNav SQL Server container.',
        `Container: ${this.container}`,
        'Run npm run db:start and retry.',
        lastError ? `Details: ${lastError.message}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
}

class PythonOdbcSqlServer {
  constructor(options = {}) {
    this.python = options.python || process.env.PATNAV_PYTHON || '.venv/bin/python'
    this.server = options.server || process.env.PATNAV_DB_SERVER || DEFAULT_SERVER
    this.database = options.database || process.env.PATNAV_DB_DATABASE || DEFAULT_DATABASE
    this.user = options.user || process.env.PATNAV_DB_USER || DEFAULT_USER
    this.password = options.password || process.env.PATNAV_DB_PASS || DEFAULT_PASSWORD
    this.driver = options.driver || process.env.PATNAV_DB_DRIVER || DEFAULT_DRIVER
    this.connectTimeout = String(options.connectTimeout || process.env.PATNAV_DB_CONNECT_TIMEOUT || 5)
  }

  getConnectionSummary() {
    return {
      mode: 'python-odbc',
      server: this.server,
      database: this.database,
      user: this.user
    }
  }

  queryJson(query) {
    assertReadOnlySql(query)
    const stdout = this.runSql(query)
    return extractJson(stdout)
  }

  executeWriteBatch(query) {
    const stdout = this.runSql(query)
    return extractJson(stdout)
  }

  runSql(query) {
    const script = `
import json
import os
import sys
import pyodbc

query = sys.stdin.read()
conn = pyodbc.connect(
    "DRIVER={" + os.environ["PATNAV_ODBC_DRIVER"] + "};"
    "SERVER=" + os.environ["PATNAV_ODBC_SERVER"] + ";"
    "DATABASE=" + os.environ["PATNAV_ODBC_DATABASE"] + ";"
    "Encrypt=yes;"
    "TrustServerCertificate=yes;"
    "UID=" + os.environ["PATNAV_ODBC_USER"] + ";"
    "PWD=" + os.environ["PATNAV_ODBC_PASSWORD"] + ";",
    timeout=int(os.environ.get("PATNAV_ODBC_TIMEOUT", "5")),
    autocommit=True,
)
cur = conn.cursor()
cur.execute(query)
parts = []
while True:
    if cur.description:
        rows = cur.fetchall()
        for row in rows:
            if len(row) > 0 and row[0] is not None:
                parts.append(str(row[0]))
    if not cur.nextset():
        break
sys.stdout.write("".join(parts))
`
    const result = spawnSync(this.python, ['-c', script], {
      input: query,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PATNAV_ODBC_DRIVER: this.driver,
        PATNAV_ODBC_SERVER: this.server,
        PATNAV_ODBC_DATABASE: this.database,
        PATNAV_ODBC_USER: this.user,
        PATNAV_ODBC_PASSWORD: this.password,
        PATNAV_ODBC_TIMEOUT: this.connectTimeout
      }
    })

    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || '').trim())
    }
    return result.stdout
  }
}

module.exports = {
  LocalSqlServer,
  PythonOdbcSqlServer
}
