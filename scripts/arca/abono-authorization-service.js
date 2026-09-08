const { dateForDayInMonth, periodFromDate } = require('./abono-repository')
const { ArcaApiProvider } = require('./arca-api-provider')
const { postFactura } = require('./arca-api-read-only-client')
const { PendingFiscalPreflight } = require('./pending-fiscal-preflight')

const CENT_TOLERANCE = 0.05
const LOCAL_TIME_ZONE = 'America/Argentina/Tucuman'

function round(value, decimals = 6) {
  const factor = 10 ** decimals
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor
}

function yyyymmdd(date) {
  return String(date || '').replace(/-/g, '')
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      acc[part.type] = part.value
      return acc
    }, {})

  return `${parts.year}-${parts.month}-${parts.day}`
}

function normalizeEmissionDate(value) {
  const raw = String(value || todayIsoDate()).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('--fecha-emision must use YYYY-MM-DD format.')
  }
  return raw
}

function classifyTipofactura(tipofactura) {
  const normalized = String(tipofactura || '').trim().toUpperCase()
  if (normalized === 'A') {
    return {
      tipofactura: normalized,
      tipoComprobante: 'FA',
      prefijo: 7,
      destination: 'arca',
      electronic: true
    }
  }
  if (normalized === 'B') {
    return {
      tipofactura: normalized,
      tipoComprobante: 'FB',
      prefijo: 7,
      destination: 'arca',
      electronic: true
    }
  }
  if (normalized === 'C') {
    return {
      tipofactura: normalized,
      tipoComprobante: 'FC',
      prefijo: 4,
      destination: 'interno',
      electronic: false
    }
  }

  return {
    tipofactura: normalized,
    tipoComprobante: null,
    prefijo: null,
    destination: 'desconocido',
    electronic: false
  }
}

function buildIdempotencyKey({ environment, period, codCliente, nroLugarEntrega, tipoComprobante }) {
  const envLabel =
    String(environment || 'homologacion').trim().toLowerCase() === 'produccion'
      ? 'PROD'
      : 'HOMOLOGACION'
  return [
    'ABONO',
    envLabel,
    period.yyyymm,
    Number(codCliente),
    Number(nroLugarEntrega),
    String(tipoComprobante || '').trim().toUpperCase()
  ].join('-')
}

function groupDispenserItems(dispensers) {
  const groups = new Map()

  dispensers.forEach(dispenser => {
    const key = String(dispenser.cod_item)
    const existing = groups.get(key) || {
      codItem: Number(dispenser.cod_item),
      descripcion: String(dispenser.denominacion || dispenser.denom_corto || '').trim(),
      precioBruto: Number(dispenser.precio),
      tasaIva: Number(dispenser.tasa_iva),
      litrosAbonadosPorUnidad: Number(dispenser.litros_abonados || 0),
      cantidad: 0,
      dispensers: []
    }

    existing.cantidad += 1
    existing.dispensers.push({
      cod_dispenser: dispenser.cod_dispenser,
      nro_serie: dispenser.nro_serie,
      marca: dispenser.marca,
      cod_abono_o_alquiler: dispenser.cod_abono_o_alquiler
    })
    groups.set(key, existing)
  })

  return Array.from(groups.values()).map((item, index) => {
    const importeBruto = round(item.cantidad * item.precioBruto, 2)
    const precioUnitarioNeto = round(item.precioBruto / (1 + item.tasaIva / 100), 6)
    const importeNeto = round(item.cantidad * precioUnitarioNeto, 6)
    const iva = round(importeNeto * (item.tasaIva / 100), 6)
    const totalReconstruido = round(importeNeto + iva, 2)

    return {
      orden: index + 1,
      ...item,
      importeBruto,
      precioUnitarioNeto,
      importeNeto,
      iva,
      totalReconstruido,
      totalDelta: round(totalReconstruido - importeBruto, 2),
      litrosAbonados: round(item.cantidad * item.litrosAbonadosPorUnidad, 0)
    }
  })
}

class AbonoAuthorizationService {
  constructor({ repository, provider = new ArcaApiProvider({ concepto: 2 }), arcaPostFactura = postFactura }) {
    this.repository = repository
    this.provider = provider
    this.arcaPostFactura = arcaPostFactura
  }

  buildPendingFiscalPreflight() {
    const ptoVtas =
      this.provider.environment === 'produccion'
        ? [8, this.provider.ptoVta]
        : [this.provider.ptoVta]
    return new PendingFiscalPreflight({
      sql: this.repository.sql,
      representada: this.provider.representada,
      ptoVta: this.provider.ptoVta,
      ptoVtas,
      concepto: this.provider.concepto,
      arcaPostFactura: this.arcaPostFactura
    })
  }

  buildPreview({ desde, hasta, limit = 1, fechaHomologacion }) {
    const batch = this.buildBatchPreview({ desde, hasta, limit: 1, fechaHomologacion })
    if (!batch.previews.length) {
      throw new Error('No eligible abono candidates were found for the requested range.')
    }

    return batch.previews[0]
  }

  buildBatchPreview({ desde, hasta, limit = 1, fechaHomologacion }) {
    const requestedLimit = Math.min(Math.max(Number.parseInt(String(limit || 1), 10), 1), 1000)
    const poolLimit = requestedLimit
    const candidates = this.repository.findCandidatePool({ desde, hasta, limit: poolLimit })
    const rangeSummary = this.repository.getRangeSummary({
      desde,
      hasta,
      periodoDate: desde
    })

    const ready = []
    const discarded = []

    for (const candidate of candidates) {
      try {
        const preview = this.buildPreviewForCandidate({ selected: candidate, desde, fechaHomologacion })
        if (preview.blocked) {
          discarded.push(this.buildDiscardRecord(preview, preview.blockers))
        } else {
          ready.push(preview)
        }
      } catch (error) {
        discarded.push({
          cod_cliente: candidate.cod_cliente,
          nro_lugar_entrega: candidate.nro_lugar_entrega,
          razon_social: candidate.razon_social,
          reasons: [error instanceof Error ? error.message : String(error)]
        })
      }
    }

    return {
      previews: ready.slice(0, requestedLimit),
      discarded,
      readyCandidateCount: ready.length,
      requestedLimit,
      poolCandidateCount: candidates.length,
      rangeSummary
    }
  }

  buildPreviewSummary(batch) {
    const groups = {
      faElectronicas: this.emptyGroup(),
      fbElectronicas: this.emptyGroup(),
      fc4Internas: this.emptyGroup()
    }

    batch.previews.forEach(preview => {
      const group = this.groupKeyForPreview(preview)
      if (groups[group]) {
        groups[group].count += 1
        groups[group].total += Number(preview.totals.legacyGrossTotal || 0)
      }
    })

    Object.values(groups).forEach(group => {
      group.total = round(group.total, 2)
    })

    const range = batch.rangeSummary || {}
    const rangeDiscardReasons = [
      { motivo: 'duplicidad de abono', cantidad: Number(range.duplicados || 0) },
      { motivo: 'total bruto no positivo', cantidad: Number(range.total_bruto_no_positivo || 0) },
      { motivo: 'categoria IVA desconocida', cantidad: Number(range.tipofactura_desconocida || 0) },
      { motivo: 'cliente ignorado manualmente', cantidad: Number(range.ignorados_manuales || 0) }
    ].filter(reason => reason.cantidad > 0)

    return {
      total_candidatos: Number(range.total_candidatos ?? batch.previews.length),
      FA_electronicas: {
        count: Number(range.fa_electronicas ?? groups.faElectronicas.count),
        total: round(Number(range.total_fa ?? groups.faElectronicas.total), 2)
      },
      FB_electronicas: {
        count: Number(range.fb_electronicas ?? groups.fbElectronicas.count),
        total: round(Number(range.total_fb ?? groups.fbElectronicas.total), 2)
      },
      FC4_internas: {
        count: Number(range.fc4_internas ?? groups.fc4Internas.count),
        total: round(Number(range.total_fc4 ?? groups.fc4Internas.total), 2)
      },
      total_monetario_por_grupo: {
        FA_electronicas: round(Number(range.total_fa ?? groups.faElectronicas.total), 2),
        FB_electronicas: round(Number(range.total_fb ?? groups.fbElectronicas.total), 2),
        FC4_internas: round(Number(range.total_fc4 ?? groups.fc4Internas.total), 2)
      },
      descartados:
        Number(range.duplicados || 0) +
        Number(range.total_bruto_no_positivo || 0) +
        Number(range.tipofactura_desconocida || 0),
      duplicados_en_rango: Number(range.duplicados || 0),
      total_bruto_no_positivo: Number(range.total_bruto_no_positivo || 0),
      listos_para_generar: Number(range.listos ?? batch.previews.length),
      tipofactura_desconocida: Number(range.tipofactura_desconocida || 0),
      ignorados_manuales: Number(range.ignorados_manuales || 0),
      descartados_por_motivo: rangeDiscardReasons
    }
  }

  buildPreviewSummaryFromRange(range = {}) {
    const rangeDiscardReasons = [
      { motivo: 'duplicidad de abono', cantidad: Number(range.duplicados || 0) },
      { motivo: 'total bruto no positivo', cantidad: Number(range.total_bruto_no_positivo || 0) },
      { motivo: 'categoria IVA desconocida', cantidad: Number(range.tipofactura_desconocida || 0) },
      { motivo: 'cliente ignorado manualmente', cantidad: Number(range.ignorados_manuales || 0) }
    ].filter(reason => reason.cantidad > 0)

    return {
      total_candidatos: Number(range.total_candidatos || 0),
      FA_electronicas: {
        count: Number(range.fa_electronicas || 0),
        total: round(Number(range.total_fa || 0), 2)
      },
      FB_electronicas: {
        count: Number(range.fb_electronicas || 0),
        total: round(Number(range.total_fb || 0), 2)
      },
      FC4_internas: {
        count: Number(range.fc4_internas || 0),
        total: round(Number(range.total_fc4 || 0), 2)
      },
      total_monetario_por_grupo: {
        FA_electronicas: round(Number(range.total_fa || 0), 2),
        FB_electronicas: round(Number(range.total_fb || 0), 2),
        FC4_internas: round(Number(range.total_fc4 || 0), 2)
      },
      descartados:
        Number(range.duplicados || 0) +
        Number(range.total_bruto_no_positivo || 0) +
        Number(range.tipofactura_desconocida || 0),
      duplicados_en_rango: Number(range.duplicados || 0),
      total_bruto_no_positivo: Number(range.total_bruto_no_positivo || 0),
      listos_para_generar: Number(range.listos || 0),
      tipofactura_desconocida: Number(range.tipofactura_desconocida || 0),
      ignorados_manuales: Number(range.ignorados_manuales || 0),
      descartados_por_motivo: rangeDiscardReasons
    }
  }

  emptyGroup() {
    return {
      count: 0,
      total: 0
    }
  }

  groupKeyForPreview(preview) {
    const classification = preview.abono.fiscalClassification
    if (preview.abono.tipoComprobante === 'FA' && classification.destination === 'arca') {
      return 'faElectronicas'
    }
    if (preview.abono.tipoComprobante === 'FB' && classification.destination === 'arca') {
      return 'fbElectronicas'
    }
    if (preview.abono.tipoComprobante === 'FC' && classification.destination === 'interno') {
      return 'fc4Internas'
    }
    return null
  }

  async processBatch({ desde, hasta, limit = 1, fechaHomologacion }) {
    const batch = this.buildBatchPreview({ desde, hasta, limit, fechaHomologacion })
    const results = []
    const stoppedArcaSeries = new Set()
    const firstArcaPreview = batch.previews.find(
      preview => preview.abono.fiscalClassification.destination === 'arca'
    )
    const preflight = firstArcaPreview
      ? await this.buildPendingFiscalPreflight().processBefore({
          targetDate: firstArcaPreview.abono.fechaEmision
        })
      : { processedCount: 0, processed: [] }

    for (const preview of batch.previews) {
      const seriesKey = `${preview.abono.tipoComprobante}/${preview.abono.fiscalClassification.prefijo}`
      const base = {
        cod_cliente: preview.selectedCandidate.cod_cliente,
        nro_lugar_entrega: preview.selectedCandidate.nro_lugar_entrega,
        razon_social: preview.selectedCandidate.razon_social,
        tipo_comprobante: preview.abono.tipoComprobante,
        prefijo_destino: preview.abono.fiscalClassification.prefijo,
        destino: preview.abono.fiscalClassification.destination,
        total: preview.totals.legacyGrossTotal
      }

      if (
        preview.abono.fiscalClassification.destination === 'arca' &&
        stoppedArcaSeries.has(seriesKey)
      ) {
        results.push({
          ...base,
          ok: false,
          skipped: true,
          error: `Serie ${seriesKey} detenida por fallo previo.`
        })
        continue
      }

      let arcaApproval = null
      try {
        this.assertProcessablePreview(preview)

        if (preview.abono.fiscalClassification.destination === 'arca') {
          const arcaResponse = await this.arcaPostFactura({
            payload: preview.authorizationPreview.payload,
            idempotencyKey: preview.abono.idempotencyKey
          })
          const approval = this.buildApprovedArcaResult(arcaResponse)
          arcaApproval = approval
          const insert = this.repository.insertAuthorizedAbono({
            abono: preview.abono,
            arcaResult: approval
          })
          results.push({
            ...base,
            ok: true,
            numero: approval.cbteNro,
            cae: approval.cae,
            caeFchVto: approval.caeFchVto,
            observaciones: approval.observaciones,
            errores: approval.errores,
            preflight,
            insert
          })
        } else if (preview.abono.fiscalClassification.destination === 'interno') {
          const insert = this.repository.insertInternalAbono({ abono: preview.abono })
          results.push({
            ...base,
            ok: true,
            numero: insert.numero,
            cae: null,
            caeFchVto: null,
            observaciones: [],
            errores: [],
            insert
          })
        }
      } catch (error) {
        if (preview.abono.fiscalClassification.destination === 'arca') {
          stoppedArcaSeries.add(seriesKey)
        }
        results.push({
          ...base,
          ok: false,
          arca_authorized: arcaApproval
            ? {
                numero: arcaApproval.cbteNro,
                cae: arcaApproval.cae,
                caeFchVto: arcaApproval.caeFchVto
              }
            : null,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      preview: batch,
      results,
      summary: this.buildProcessSummary(results)
    }
  }

  assertProcessablePreview(preview) {
    if (preview.selectedCandidate.cliente_estado !== 0) {
      throw new Error('Cliente.estado != 0')
    }
    if (preview.selectedCandidate.lugar_fecha_fin_contrato !== null) {
      throw new Error('LugarEntrega.fecha_fin_contrato IS NOT NULL')
    }
    if (preview.selectedCandidate.tipo_cliente !== 1) {
      throw new Error('Cliente.tipo_cliente != 1')
    }
    if (!preview.dispensers.length) {
      throw new Error('ausencia de dispensers validos')
    }
    if (!preview.dispensers.every(dispenser => dispenser.mcontrol2 === 'S')) {
      throw new Error('Dispenser.MControl2 != S')
    }
    if (preview.blocked) {
      throw new Error(preview.blockers.join('; '))
    }
    if (Math.abs(Number(preview.totals.totalDelta || 0)) > CENT_TOLERANCE) {
      throw new Error(`diferencia de totales mayor a ${CENT_TOLERANCE}`)
    }
    if (preview.abono.fiscalClassification.destination === 'arca') {
      const payload = preview.authorizationPreview.payload
      if (!payload || !['homologacion', 'produccion'].includes(payload.environment)) {
        throw new Error('ARCA electronica bloqueada: environment invalido')
      }
      if (Number(payload.ptoVta) !== Number(preview.abono.fiscalClassification.prefijo)) {
        throw new Error('ARCA electronica bloqueada: ptoVta no coincide con clasificacion fiscal')
      }
    }
  }

  buildApprovedArcaResult(response) {
    const body = response && response.response
    if (!body || body.resultado !== 'A') {
      throw new Error(`ARCA rechazo/no aprobo: ${JSON.stringify(body)}`)
    }

    return {
      cbteNro: body.cbteNro,
      cae: body.cae,
      caeFchVto: body.caeFchVto,
      ptoVta: body.ptoVta,
      cbteTipo: body.cbteTipo,
      observaciones: body.observaciones || [],
      errores: body.errores || []
    }
  }

  buildProcessSummary(results) {
    const ok = results.filter(result => result.ok)
    const failed = results.filter(result => !result.ok)

    return {
      OK: ok.length,
      fallidas: failed.length,
      FA_electronicas_OK: ok.filter(
        result => result.tipo_comprobante === 'FA' && result.destino === 'arca'
      ).length,
      FB_electronicas_OK: ok.filter(
        result => result.tipo_comprobante === 'FB' && result.destino === 'arca'
      ).length,
      FC4_internas_OK: ok.filter(
        result => result.tipo_comprobante === 'FC' && result.destino === 'interno'
      ).length,
      numeros_CAE_generados: ok.map(result => ({
        comprobante: `${result.tipo_comprobante} ${result.prefijo_destino}-${result.numero}`,
        cae: result.cae || null,
        caeFchVto: result.caeFchVto || null
      })),
      fallas: failed.map(result => ({
        cod_cliente: result.cod_cliente,
        nro_lugar_entrega: result.nro_lugar_entrega,
        arca_authorized: result.arca_authorized || null,
        error: result.error
      })),
      observaciones_y_errores: ok
        .filter(
          result =>
            (Array.isArray(result.observaciones) && result.observaciones.length) ||
            (Array.isArray(result.errores) && result.errores.length)
        )
        .map(result => ({
          comprobante: `${result.tipo_comprobante} ${result.prefijo_destino}-${result.numero}`,
          observaciones: result.observaciones,
          errores: result.errores
        }))
    }
  }

  buildAuditReasons(row) {
    return [
      Number(row.cliente_estado) !== 0 ? 'Cliente.estado != 0' : null,
      row.lugar_fecha_fin_contrato !== null ? 'LugarEntrega.fecha_fin_contrato IS NOT NULL' : null,
      Number(row.tipo_cliente) !== 1 ? 'Cliente.tipo_cliente != 1' : null,
      Number(row.ignorado_manual) === 1 ? 'cliente ignorado manualmente' : null,
      Number(row.valid_dispenser_count) === 0 ? 'ausencia de dispensers validos' : null,
      Number(row.existing_abono_count) > 0 ? 'duplicidad de abono' : null
    ].filter(Boolean)
  }

  pickDiversePreviews(previews, limit) {
    const selected = []
    const remaining = [...previews]
    const seenTypes = new Set()
    const seenItems = new Set()
    let hasGrouped = false

    while (remaining.length > 0 && selected.length < limit) {
      let bestIndex = 0
      let bestScore = -1

      remaining.forEach((preview, index) => {
        const itemKeys = preview.groupedItems.map(item => String(item.codItem))
        const candidateHasGrouped = preview.groupedItems.some(item => item.cantidad > 1)
        let score = 0
        if (!seenTypes.has(preview.abono.tipoComprobante)) score += 6
        if (itemKeys.some(key => !seenItems.has(key))) score += 4
        if (candidateHasGrouped && !hasGrouped) score += 5
        score += Math.min(preview.dispensers.length, 3)
        if (score > bestScore) {
          bestScore = score
          bestIndex = index
        }
      })

      const [picked] = remaining.splice(bestIndex, 1)
      selected.push(picked)
      seenTypes.add(picked.abono.tipoComprobante)
      picked.groupedItems.forEach(item => seenItems.add(String(item.codItem)))
      hasGrouped = hasGrouped || picked.groupedItems.some(item => item.cantidad > 1)
    }

    return selected
  }

  buildDiscardRecord(preview, reasons) {
    return {
      cod_cliente: preview.header.cod_cliente,
      nro_lugar_entrega: preview.header.nro_lugar_entrega,
      razon_social: preview.header.razon_social,
      cliente_estado: preview.header.cliente_estado,
      tipo_cliente: preview.header.tipo_cliente,
      lugar_fecha_fin_contrato: preview.header.lugar_fecha_fin_contrato,
      valid_dispenser_count: preview.dispensers.length,
      existing_abono_count: preview.duplicateCheck.existingAbonos.length,
      reasons
    }
  }

  buildPreviewForCandidate({ selected, desde, fechaHomologacion }) {
    const emissionDate = normalizeEmissionDate(fechaHomologacion)
    const period = periodFromDate(desde)
    const candidateRecord = this.repository.getAbonoCandidate({
      codCliente: selected.cod_cliente,
      nroLugarEntrega: selected.nro_lugar_entrega,
      periodoDate: desde
    })

    const header = candidateRecord.header
    const fiscalClassification = classifyTipofactura(header.tipofactura)
    const tipoComprobante = fiscalClassification.tipoComprobante
    const fechaVencimiento = dateForDayInMonth(period.firstDate, header.dia_facturacion_abono)
    const items = groupDispenserItems(candidateRecord.dispensers)
    if (!tipoComprobante) {
      throw new Error(`CategoriaIva.tipofactura=${header.tipofactura || '(vacio)'} no tiene clasificacion definida.`)
    }
    const invoiceRecord = {
      venta: {
        tipo_comprobante: tipoComprobante,
        prefijo: fiscalClassification.prefijo,
        numero: null,
        fecha_operacion: `${emissionDate}T00:00:00`,
        fecha_vencimiento: `${fechaVencimiento}T00:00:00`,
        cod_cliente: header.cod_cliente,
        nro_lugar_entrega: header.nro_lugar_entrega,
        tipo_facturacion: header.tipo_fact_ctacte,
        cae: null,
        cod_categoria: header.cod_categoria
      },
      cliente: {
        cod_cliente: header.cod_cliente,
        razon_social: header.razon_social,
        cuit: header.cuit,
        cod_categoria: header.cod_categoria
      },
      categoriaIva: {
        cod_categoria: header.cod_categoria,
        categoria: header.categoria_iva,
        tipofactura: header.tipofactura
      },
      lugarEntrega: {
        email: header.email
      },
      items: items.map(item => ({
        orden: item.orden,
        cod_item: item.codItem,
        cantidad: item.cantidad,
        precio: item.precioBruto,
        importe: item.importeBruto,
        tasa_iva: item.tasaIva,
        litros_abonados: item.litrosAbonados,
        denominacion: item.descripcion
      }))
    }

    let authorizationPreview = {
      provider: null,
      endpoint: null,
      method: null,
      wouldPost: false,
      headersPreview: null,
      payload: null,
      mappingEvidence: {
        classification:
          fiscalClassification.destination === 'interno'
            ? 'CategoriaIva.tipofactura=C -> FC interna prefijo 4, sin ARCA/CAE.'
            : `CategoriaIva.tipofactura=${fiscalClassification.tipofactura} -> ${tipoComprobante} electronica ptoVta 7.`
      },
      dates: {
        originalDbDate: null,
        originalCbteFch: null,
        homologationCbteFch: yyyymmdd(emissionDate),
        homologationDateWasOverridden: Boolean(fechaHomologacion)
      },
      totals: {},
      warnings: [],
      unmapped: []
    }

    if (fiscalClassification.destination === 'arca') {
      authorizationPreview = this.provider.buildAuthorizationPreview(invoiceRecord)
      authorizationPreview.payload.concepto = 2
      authorizationPreview.payload.fchServDesde = yyyymmdd(period.firstDate)
      authorizationPreview.payload.fchServHasta = yyyymmdd(period.lastDate)
      authorizationPreview.payload.fchVtoPago = yyyymmdd(emissionDate)
      authorizationPreview.payload.cbteFch = yyyymmdd(emissionDate)
      authorizationPreview.dates.originalDbDate = null
      authorizationPreview.dates.originalCbteFch = null
      authorizationPreview.dates.homologationCbteFch = yyyymmdd(emissionDate)
      authorizationPreview.unmapped = authorizationPreview.unmapped.filter(
        item => !item.includes('Fechas de servicio')
      )
    }

    const legacyGrossTotal = round(items.reduce((total, item) => total + item.importeBruto, 0), 2)
    const reconstructedGrossTotal = round(items.reduce((total, item) => total + item.totalReconstruido, 0), 2)
    const totalDelta = round(reconstructedGrossTotal - legacyGrossTotal, 2)
    const blocked =
      candidateRecord.existingAbonos.length > 0 ||
      legacyGrossTotal <= 0 ||
      Math.abs(totalDelta) > CENT_TOLERANCE
    const blockers = []

    if (candidateRecord.existingAbonos.length > 0) {
      blockers.push('Ya existe un abono para el mismo cliente/lugar/periodo.')
    }
    if (legacyGrossTotal <= 0) {
      blockers.push('Total bruto <= 0.')
    }
    if (Math.abs(totalDelta) > CENT_TOLERANCE) {
      blockers.push(`La reconstruccion ARCA difiere del total legacy por ${totalDelta}.`)
    }

    const abono = {
      tipoComprobante,
      codCliente: header.cod_cliente,
      nroLugarEntrega: header.nro_lugar_entrega,
      tipoFacturacion: header.tipo_fact_ctacte,
      fechaEmision: emissionDate,
      fechaVencimiento,
      fiscalClassification,
      periodoServicio: period,
      idempotencyKey: buildIdempotencyKey({
        environment: this.provider.environment,
        period,
        codCliente: header.cod_cliente,
        nroLugarEntrega: header.nro_lugar_entrega,
        tipoComprobante
      }),
      items
    }

    return {
      selectedCandidate: {
        cod_cliente: header.cod_cliente,
        nro_lugar_entrega: header.nro_lugar_entrega,
        razon_social: header.razon_social,
        cliente_estado: header.cliente_estado,
        punto_entrega_activo: header.lugar_fecha_fin_contrato === null,
        lugar_fecha_fin_contrato: header.lugar_fecha_fin_contrato,
        tipo_cliente: header.tipo_cliente,
        tipo_comprobante: tipoComprobante,
        prefijo_destino: fiscalClassification.prefijo,
        destino_facturacion: fiscalClassification.destination,
        factura_electronica: fiscalClassification.electronic,
        cod_categoria: header.cod_categoria,
        categoria_iva: header.categoria_iva,
        tipofactura: header.tipofactura,
        tipo_fact_ctacte: header.tipo_fact_ctacte
      },
      legacyRules: {
        source: 'Stored procedures in local NAVIERA',
        candidateRule:
          'sp_traer_lugares_entrega_abono adaptado por regla nueva: Cliente.tipo_cliente=1, Cliente.estado=0, LugarEntrega.fecha_fin_contrato IS NULL.',
        itemRule:
          'sp_traer_dispensers_por_cod_cliente_lugar_entrega plus Dispenser.MControl2=S: Dispenser.cod_abono_o_alquiler -> Item.cod_item.',
        groupingRule: 'Agrupar dispensers por cod_abono_o_alquiler/cod_item.',
        quantityRule: 'cantidad = cantidad de dispensers agrupados.',
        amountRule: 'importe = cantidad * Item.precio; Item.precio es bruto con IVA incluido.',
        litrosRule: 'litros_abonados = cantidad * Item.litros_abonados.',
        periodRule:
          'El mes sale del rango --desde/--hasta; la fecha unica legacy del abono es Ventas.fecha_vencimiento = YYYY-MM-dia_facturacion_abono.',
        emissionDateRule:
          'Ventas.fecha_operacion y ARCA.cbteFch usan fecha actual local o --fecha-emision.',
        fchVtoPagoRule:
          'ARCA.fchVtoPago nunca se envia anterior a ARCA.cbteFch; no se toma ciegamente de Ventas.fecha_vencimiento.'
      },
      header,
      dispensers: candidateRecord.dispensers,
      groupedItems: items,
      duplicateCheck: {
        checkedBy: 'cod_cliente + nro_lugar_entrega + Ventas.fecha_vencimiento + VentasItems.litros_abonados > 0',
        existingAbonos: candidateRecord.existingAbonos
      },
      totals: {
        legacyGrossTotal,
        reconstructedGrossTotal,
        totalDelta,
        tolerance: CENT_TOLERANCE
      },
      blocked,
      blockers,
      abono,
      authorizationPreview
    }
  }
}

module.exports = {
  AbonoAuthorizationService
}
