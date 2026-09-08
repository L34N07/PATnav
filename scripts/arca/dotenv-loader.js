const fs = require('fs')
const path = require('path')

function unquote(value) {
  const trimmed = String(value || '').trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env')
  if (!fs.existsSync(envPath)) {
    return
  }

  const content = fs.readFileSync(envPath, 'utf8')
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const separator = normalized.indexOf('=')
    if (separator <= 0) {
      return
    }
    const name = normalized.slice(0, separator).trim()
    const value = unquote(normalized.slice(separator + 1))
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && process.env[name] === undefined) {
      process.env[name] = value
    }
  })
}

loadDotEnv()

module.exports = {
  loadDotEnv
}
