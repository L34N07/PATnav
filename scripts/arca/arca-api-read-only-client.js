const https = require('https')
require('./dotenv-loader')

const BASE_URL = 'https://arca.api.com.ar'

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

function requestJson({ method, path, apiKey, query, body, headers = {} }) {
  const url = new URL(path, BASE_URL)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  const bodyText = body ? JSON.stringify(body) : ''

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...headers,
          ...(bodyText
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyText)
              }
            : {})
        },
        timeout: 15000
      },
      res => {
        let responseText = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          responseText += chunk
        })
        res.on('end', () => {
          let parsed = null
          try {
            parsed = responseText ? JSON.parse(responseText) : null
          } catch (error) {
            parsed = { raw: responseText }
          }

          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            body: parsed
          })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error('Timed out querying arca.api ultimo-comprobante.'))
    })
    req.on('error', reject)

    if (bodyText) {
      req.write(bodyText)
    }
    req.end()
  })
}

async function getUltimoComprobante({
  apiKey = process.env.ARCA_API_KEY,
  environment = 'homologacion',
  representada = process.env.ARCA_REPRESENTADA_CUIT || process.env.PATNAV_ARCA_REPRESENTADA_CUIT,
  ptoVta = 6,
  cbteTipo = 6
} = {}) {
  const resolvedApiKey =
    apiKey ||
    (environment === 'produccion' ? process.env.ARCA_API_KEY_PROD : process.env.ARCA_API_KEY)
  if (!apiKey) {
    apiKey = resolvedApiKey
  }
  if (!apiKey) {
    return {
      ok: false,
      skipped: true,
      reason:
        environment === 'produccion'
          ? 'ARCA_API_KEY_PROD is not set in the environment.'
          : 'ARCA_API_KEY is not set in the environment.'
    }
  }

  const query = {
    environment,
    representada: digitsOnly(representada),
    ptoVta,
    cbteTipo
  }

  let response = await requestJson({
    method: 'GET',
    path: '/api/wsfe/ultimo-comprobante',
    apiKey,
    query
  })

  if (response.statusCode === 404 || response.statusCode === 405) {
    response = await requestJson({
      method: 'POST',
      path: '/api/wsfe/ultimo-comprobante',
      apiKey,
      body: query
    })
  }

  const statusCode = Number(response.statusCode)
  const ok = statusCode >= 200 && statusCode < 300
  const body = response.body || {}
  const ultimo =
    body.cbteNro ??
    body.cbte_nro ??
    body.numero ??
    body.ultimo ??
    body.ultimoComprobante ??
    body.ultimo_comprobante ??
    null
  const ultimoNumber = Number(ultimo)

  return {
    ok,
    statusCode,
    statusMessage: response.statusMessage,
    request: {
      endpoint: `${BASE_URL}/api/wsfe/ultimo-comprobante`,
      environment,
      representada: digitsOnly(representada),
      ptoVta: Number(ptoVta),
      cbteTipo: Number(cbteTipo)
    },
    response: body,
    ultimoComprobante: Number.isFinite(ultimoNumber) ? ultimoNumber : ultimo,
    proximoComprobante: Number.isFinite(ultimoNumber) ? ultimoNumber + 1 : null
  }
}

async function postFactura({
  apiKey,
  payload,
  idempotencyKey
} = {}) {
  const environment = payload && payload.environment
  const resolvedApiKey =
    apiKey ||
    (environment === 'produccion' ? process.env.ARCA_API_KEY_PROD : process.env.ARCA_API_KEY)
  if (!apiKey) {
    apiKey = resolvedApiKey
  }
  if (!apiKey) {
    throw new Error(
      environment === 'produccion'
        ? 'ARCA_API_KEY_PROD is not set in the environment.'
        : 'ARCA_API_KEY is not set in the environment.'
    )
  }
  if (!payload || !['homologacion', 'produccion'].includes(payload.environment)) {
    throw new Error('Invalid ARCA invoice environment.')
  }
  if (!idempotencyKey) {
    throw new Error('An Idempotency-Key is required.')
  }

  const response = await requestJson({
    method: 'POST',
    path: '/api/wsfe/facturas',
    apiKey,
    body: payload,
    headers: {
      'Idempotency-Key': idempotencyKey
    }
  })

  const statusCode = Number(response.statusCode)
  const ok = statusCode >= 200 && statusCode < 300

  return {
    ok,
    statusCode,
    statusMessage: response.statusMessage,
    response: response.body
  }
}

async function postCreditNote({
  apiKey,
  payload,
  idempotencyKey
} = {}) {
  const environment = payload && payload.environment
  const resolvedApiKey =
    apiKey ||
    (environment === 'produccion' ? process.env.ARCA_API_KEY_PROD : process.env.ARCA_API_KEY)
  if (!apiKey) {
    apiKey = resolvedApiKey
  }
  if (!apiKey) {
    throw new Error(
      environment === 'produccion'
        ? 'ARCA_API_KEY_PROD is not set in the environment.'
        : 'ARCA_API_KEY is not set in the environment.'
    )
  }
  if (!payload || !['homologacion', 'produccion'].includes(payload.environment)) {
    throw new Error('Invalid ARCA credit note environment.')
  }
  if (!idempotencyKey) {
    throw new Error('An Idempotency-Key is required.')
  }

  const response = await requestJson({
    method: 'POST',
    path: '/api/wsfe/notas-credito',
    apiKey,
    body: payload,
    headers: {
      'Idempotency-Key': idempotencyKey
    }
  })

  const statusCode = Number(response.statusCode)
  const ok = statusCode >= 200 && statusCode < 300

  return {
    ok,
    statusCode,
    statusMessage: response.statusMessage,
    response: response.body
  }
}

module.exports = {
  getUltimoComprobante,
  postFactura,
  postCreditNote
}
