require('./dotenv-loader')

const ENDPOINT = 'https://arca.api.com.ar/api/wsfe/facturas'
const CREDIT_NOTE_ENDPOINT = 'https://arca.api.com.ar/api/wsfe/notas-credito'
const ALLOWED_ENVIRONMENTS = new Set(['homologacion', 'produccion'])

const LEGACY_CBTE_TIPO = {
  FA: 1,
  FB: 6,
  NA: 3,
  NB: 8
}

const CREDIT_NOTE_BY_INVOICE_TYPE = {
  FA: { tipoComprobante: 'NA', cbteTipo: 3 },
  FB: { tipoComprobante: 'NB', cbteTipo: 8 }
}

const IVA_RECEPTOR_BY_LEGACY_CATEGORY = {
  R: { id: 1, label: 'IVA Responsable Inscripto' },
  E: { id: 4, label: 'IVA Sujeto Exento' },
  C: { id: 5, label: 'Consumidor Final' },
  J: { id: 5, label: 'Consumidor Final' }
}

const SUPPORTED_ALICUOTAS = new Set([0, 2.5, 5, 10.5, 21, 27])

function normalizeDateOverride(value) {
  if (!value) {
    return null
  }
  const raw = String(value).trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new Error('--fecha-homologacion must use YYYY-MM-DD format.')
  }
  return `${match[1]}${match[2]}${match[3]}`
}

function normalizeEnvironment(value) {
  const raw = String(value || 'homologacion').trim().toLowerCase()
  if (raw === 'production') {
    return 'produccion'
  }
  if (!ALLOWED_ENVIRONMENTS.has(raw)) {
    throw new Error(`Unsupported ARCA environment: ${value}`)
  }
  return raw
}

function parseNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

function toDateYYYYMMDD(value) {
  if (!value) {
    return null
  }
  const raw = String(value)
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) {
    return null
  }
  return `${match[1]}${match[2]}${match[3]}`
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

function isValidCuit(value) {
  const digits = digitsOnly(value)
  return digits.length === 11 && !/^0+$/.test(digits)
}

function expectedLegacyTipoForCategory(tipofactura) {
  const normalized = String(tipofactura || '').trim().toUpperCase()
  return normalized ? `F${normalized}` : null
}

function expectedCreditNoteTipoForCategory(tipofactura) {
  const normalized = String(tipofactura || '').trim().toUpperCase()
  return normalized ? `N${normalized}` : null
}

function normalizeDescription(item) {
  return String(item.denominacion || item.denom_corto || `Item ${item.cod_item || ''}`)
    .trim()
    .replace(/\s+/g, ' ')
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

class ArcaApiProvider {
  constructor(options = {}) {
    this.environment = normalizeEnvironment(options.environment || process.env.PATNAV_ARCA_ENVIRONMENT)
    this.representada =
      options.representada ||
      process.env.ARCA_REPRESENTADA_CUIT ||
      process.env.PATNAV_ARCA_REPRESENTADA_CUIT ||
      ''
    this.ptoVta = parseNumber(options.ptoVta || process.env.PATNAV_ARCA_PTO_VTA || 7)
    this.concepto = parseNumber(options.concepto || process.env.PATNAV_ARCA_CONCEPTO || 1)
    this.moneda = options.moneda || process.env.PATNAV_ARCA_MONEDA || 'PES'
    this.cotizacion = parseNumber(options.cotizacion || process.env.PATNAV_ARCA_COTIZACION || 1)
    this.legacyPriceMode =
      options.legacyPriceMode || process.env.PATNAV_ARCA_LEGACY_PRICE_MODE || 'gross'
    this.includeEmail = Boolean(options.includeEmail)
    this.fechaHomologacion = normalizeDateOverride(options.fechaHomologacion)
  }

  buildAuthorizationPreview(invoiceRecord) {
    const warnings = []
    const unmapped = []
    const venta = invoiceRecord.venta
    const cliente = invoiceRecord.cliente
    const categoriaIva = invoiceRecord.categoriaIva
    const lugarEntrega = invoiceRecord.lugarEntrega
    const items = Array.isArray(invoiceRecord.items) ? invoiceRecord.items : []

    const tipoComprobante = String(venta.tipo_comprobante || '').trim().toUpperCase()
    const cbteTipo = LEGACY_CBTE_TIPO[tipoComprobante] || null
    if (!cbteTipo) {
      warnings.push(`No hay mapeo ARCA cbteTipo para tipo_comprobante=${tipoComprobante}.`)
    }

    if (!this.ptoVta || this.ptoVta <= 0) {
      warnings.push('ptoVta de homologacion invalido; revisar PATNAV_ARCA_HOMOLOGACION_PTO_VTA.')
    }

    if (Number(venta.prefijo) !== Number(this.ptoVta)) {
      warnings.push(
        `Prefijo legacy ${venta.prefijo} no se uso como ptoVta; el dry-run usa ptoVta homologacion ${this.ptoVta}.`
      )
      unmapped.push('Relacion definitiva entre Ventas.prefijo y punto de venta ARCA para produccion.')
    }

    const representedDigits = digitsOnly(this.representada)
    if (!isValidCuit(representedDigits)) {
      warnings.push('Falta CUIT emisor valido en ARCA_REPRESENTADA_CUIT o PATNAV_ARCA_REPRESENTADA_CUIT.')
    }

    const clienteCuit = digitsOnly(cliente && cliente.cuit)
    const hasClientCuit = isValidCuit(clienteCuit)
    const docTipo = hasClientCuit ? 80 : 99
    const docNro = hasClientCuit ? clienteCuit : '0'
    const categoryCode = String((categoriaIva && categoriaIva.cod_categoria) || venta.cod_categoria || '').trim()
    const receptorMapping = IVA_RECEPTOR_BY_LEGACY_CATEGORY[categoryCode] || null
    if (!receptorMapping) {
      warnings.push(`No hay mapeo condicionIvaReceptorId para cod_categoria=${categoryCode || '(vacio)'}.`)
    }
    if (!hasClientCuit && receptorMapping && receptorMapping.id !== 5) {
      warnings.push(
        `Cliente ${venta.cod_cliente} no tiene CUIT valido pero categoria ${categoryCode} no es consumidor final.`
      )
    }
    if (hasClientCuit && receptorMapping && receptorMapping.id === 5) {
      warnings.push(
        `Cliente ${venta.cod_cliente} figura como consumidor final pero tiene CUIT; se usa docTipo=80.`
      )
    }

    if (categoriaIva && categoriaIva.tipofactura) {
      const expectedLegacyTipo = expectedLegacyTipoForCategory(categoriaIva.tipofactura)
      const expectedCreditNoteTipo = expectedCreditNoteTipoForCategory(categoriaIva.tipofactura)
      if (![expectedLegacyTipo, expectedCreditNoteTipo].includes(tipoComprobante)) {
        warnings.push(
          `CategoriaIva.tipofactura=${categoriaIva.tipofactura} no coincide con ${tipoComprobante}.`
        )
      }
    }

    if (venta.cae) {
      warnings.push(`La venta ${tipoComprobante} ${venta.prefijo}-${venta.numero} ya tiene CAE cargado.`)
    }

    if (this.concepto !== 1) {
      unmapped.push('Fechas de servicio para concepto 2/3 todavia no estan mapeadas desde NAVIERA.')
    }

    if (!venta.fecha_operacion) {
      warnings.push('Ventas.fecha_operacion esta vacia; no se puede completar cbteFch.')
    }

    if (!items.length) {
      warnings.push('La factura no tiene renglones en VentasItems.')
    }

    const payloadItems = items.map(item => this.mapItem(item, warnings))
    const originalCbteFch = toDateYYYYMMDD(venta.fecha_operacion)
    const payload = {
      environment: this.environment,
      representada: isValidCuit(representedDigits) ? representedDigits : null,
      cbteTipo,
      ptoVta: this.ptoVta,
      docTipo,
      docNro,
      concepto: this.concepto,
      condicionIvaReceptorId: receptorMapping ? receptorMapping.id : null,
      cbteFch: this.fechaHomologacion || originalCbteFch,
      moneda: this.moneda,
      cotizacion: this.cotizacion,
      items: payloadItems
    }

    if (this.includeEmail && lugarEntrega && lugarEntrega.email) {
      payload.email = lugarEntrega.email
    }

    const legacyGrossTotal = round(sum(items.map(item => parseNumber(item.importe) || 0)), 2)
    const arcaNetTotal = round(
      sum(payloadItems.map(item => (parseNumber(item.cantidad) || 0) * (parseNumber(item.precioUnitario) || 0))),
      6
    )
    const arcaVatTotal = round(
      sum(
        payloadItems.map(item => {
          const itemNet = (parseNumber(item.cantidad) || 0) * (parseNumber(item.precioUnitario) || 0)
          const ivaRate = parseNumber(item.alicuotaIva) || 0
          return itemNet * (ivaRate / 100)
        })
      ),
      6
    )
    const arcaGrossTotal = round(arcaNetTotal + arcaVatTotal, 2)
    const totalDelta = round(arcaGrossTotal - legacyGrossTotal, 2)

    if (Math.abs(totalDelta) > 0.05) {
      warnings.push(
        `El total estimado ARCA (${arcaGrossTotal}) difiere del total legacy (${legacyGrossTotal}) por ${totalDelta}.`
      )
    }

    unmapped.push('Confirmar si VentasItems.precio/importe siempre representan importes brutos con IVA incluido.')
    unmapped.push('Confirmar si tipo_facturacion agrega reglas fiscales ademas de CategoriaIva.tipofactura.')
    unmapped.push('Confirmar si LugarEntrega.email debe enviarse en etapa de emision; el dry-run lo omite por defecto.')

    return {
      provider: 'ArcaApiProvider',
      endpoint: ENDPOINT,
      method: 'POST',
      wouldPost: false,
      headersPreview: {
        Authorization: 'Bearer $ARCA_API_KEY',
        'Content-Type': 'application/json',
        'Idempotency-Key': '<stage-2-stable-invoice-key>'
      },
      payload,
      mappingEvidence: {
        cbteTipo: `legacy ${tipoComprobante} -> ${cbteTipo}`,
        condicionIvaReceptorId: receptorMapping
          ? `CategoriaIva ${categoryCode} (${receptorMapping.label}) -> ${receptorMapping.id}`
          : null,
        docTipo: hasClientCuit ? 'Cliente.cuit valido -> CUIT (80)' : 'sin CUIT valido -> consumidor final (99)',
        priceMode:
          this.legacyPriceMode === 'gross'
            ? 'VentasItems.importe/precio tratados como bruto; precioUnitario ARCA calculado neto.'
            : 'VentasItems.precio tratado como neto ARCA.'
      },
      dates: {
        originalDbDate: venta.fecha_operacion,
        originalCbteFch,
        homologationCbteFch: payload.cbteFch,
        homologationDateWasOverridden: Boolean(this.fechaHomologacion)
      },
      totals: {
        legacyGrossTotal,
        arcaEstimatedNetTotal: arcaNetTotal,
        arcaEstimatedVatTotal: arcaVatTotal,
        arcaEstimatedGrossTotal: arcaGrossTotal,
        grossTotalDelta: totalDelta
      },
      warnings,
      unmapped: [...new Set(unmapped)]
    }
  }

  buildCreditNotePreview(invoiceRecord) {
    const originalVenta = invoiceRecord.venta
    const originalTipo = String(originalVenta.tipo_comprobante || '').trim().toUpperCase()
    const creditNote = CREDIT_NOTE_BY_INVOICE_TYPE[originalTipo]
    if (!creditNote) {
      throw new Error(`No hay mapeo de nota de credito para ${originalTipo}.`)
    }

    const creditInvoiceRecord = {
      ...invoiceRecord,
      venta: {
        ...originalVenta,
        tipo_comprobante: creditNote.tipoComprobante,
        prefijo: this.ptoVta,
        numero: null,
        cae: null
      }
    }
    const preview = this.buildAuthorizationPreview(creditInvoiceRecord)
    const representedDigits = digitsOnly(this.representada)
    preview.endpoint = CREDIT_NOTE_ENDPOINT
    preview.payload.cbteTipo = creditNote.cbteTipo
    preview.payload.ptoVta = this.ptoVta
    preview.payload.comprobantesAsociados = [
      {
        tipo: LEGACY_CBTE_TIPO[originalTipo],
        ptoVta: Number(originalVenta.prefijo),
        nro: Number(originalVenta.numero),
        cuit: representedDigits,
        cbteFch: toDateYYYYMMDD(originalVenta.fecha_operacion)
      }
    ]
    preview.mappingEvidence.cbteTipo = `legacy ${creditNote.tipoComprobante} -> ${creditNote.cbteTipo}`
    preview.mappingEvidence.comprobanteAsociado =
      `${originalTipo} ${originalVenta.prefijo}-${originalVenta.numero}`
    return preview
  }

  mapItem(item, warnings) {
    const cantidad = parseNumber(item.cantidad)
    const precio = parseNumber(item.precio)
    const importe = parseNumber(item.importe)
    const tasaIva = parseNumber(item.tasa_iva ?? item.item_tasa_iva)
    const description = normalizeDescription(item)

    if (!cantidad || cantidad <= 0) {
      warnings.push(`Item orden ${item.orden || '?'} tiene cantidad invalida.`)
    }
    if (!description) {
      warnings.push(`Item orden ${item.orden || '?'} no tiene descripcion.`)
    }
    if (tasaIva === null) {
      warnings.push(`Item orden ${item.orden || '?'} no tiene tasa_iva.`)
    } else if (!SUPPORTED_ALICUOTAS.has(Number(tasaIva))) {
      warnings.push(`Item orden ${item.orden || '?'} tiene tasa_iva ${tasaIva}; validar alicuota ARCA.`)
    }
    if (cantidad && precio !== null && importe !== null) {
      const expectedImporte = round(cantidad * precio, 2)
      const delta = round(expectedImporte - importe, 2)
      if (Math.abs(delta) > 0.05) {
        warnings.push(
          `Item orden ${item.orden || '?'}: cantidad*precio (${expectedImporte}) difiere de importe (${importe}).`
        )
      }
    }

    let precioUnitario = precio
    if (this.legacyPriceMode === 'gross') {
      const unitGross = cantidad && importe !== null ? importe / cantidad : precio
      const divisor = 1 + ((tasaIva || 0) / 100)
      precioUnitario = divisor > 0 ? unitGross / divisor : unitGross
    } else if (this.legacyPriceMode !== 'net') {
      throw new Error('PATNAV_ARCA_LEGACY_PRICE_MODE must be gross or net.')
    }

    return {
      cantidad: cantidad === null ? null : round(cantidad, 4),
      descripcion: description,
      precioUnitario: precioUnitario === null ? null : round(precioUnitario, 6),
      alicuotaIva: tasaIva === null ? null : round(tasaIva, 4)
    }
  }
}

module.exports = {
  ArcaApiProvider,
  CREDIT_NOTE_BY_INVOICE_TYPE
}
