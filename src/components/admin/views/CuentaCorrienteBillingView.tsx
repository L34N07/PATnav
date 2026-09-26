import React, { useCallback, useMemo, useState } from "react"
import type {
  CuentaCorrienteGenerateResult,
  CuentaCorrientePreviewCandidate,
  CuentaCorrientePreviewResult
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import SpanishDateInput from "../../SpanishDateInput"
import StatusToasts from "../../StatusToasts"

const CONFIRMATION = "CONFIRMAR_CUENTAS_CORRIENTES_PRODUCCION"
const SUCCESS_MESSAGE_DURATION_MS = 2500
const ERROR_MESSAGE_DURATION_MS = 4500

type Filter = "todos" | "bajo" | "fa" | "fb" | "revisar"

const todayIsoDate = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

const currentMonth = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

const formatMoney = (value: unknown) => new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(value || 0))

const candidateKey = (candidate: CuentaCorrientePreviewCandidate) => `${candidate.cliente}/${candidate.punto}`

type Props = { onShowAbonos: () => void }

export default function CuentaCorrienteBillingView({ onShowAbonos }: Props) {
  const electronAPI = window.electronAPI
  const [periodo, setPeriodo] = useState(currentMonth)
  const [fechaEmision, setFechaEmision] = useState(todayIsoDate)
  const [limit, setLimit] = useState("250")
  const [preview, setPreview] = useState<CuentaCorrientePreviewResult | null>(null)
  const [result, setResult] = useState<CuentaCorrienteGenerateResult | null>(null)
  const [filter, setFilter] = useState<Filter>("todos")
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())
  const [expandedClients, setExpandedClients] = useState<Set<number>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const candidates = preview?.candidatos ?? []
  const ready = useMemo(() => candidates.filter(candidate => candidate.estado === "listo"), [candidates])
  const orderedCandidates = useMemo(
    () => [...candidates].sort((left, right) => Number(right.consumoBajo) - Number(left.consumoBajo) || left.cliente - right.cliente || left.punto - right.punto),
    [candidates]
  )
  const visibleCandidates = useMemo(() => orderedCandidates.filter(candidate => {
    if (filter === "bajo") return candidate.consumoBajo
    if (filter === "fa") return candidate.tipo === "FA"
    if (filter === "fb") return candidate.tipo === "FB"
    if (filter === "revisar") return candidate.estado !== "listo"
    return true
  }), [filter, orderedCandidates])
  const selectedReady = ready.filter(candidate => !excludedKeys.has(candidateKey(candidate)))
  const canGenerate = Boolean(preview && selectedReady.length && confirmed && !generating)
  const resultByKey = useMemo(() => new Map((result?.results ?? []).map(row => [
    `${row.cod_cliente}/${row.nro_lugar_entrega}`, row
  ])), [result])

  const loadPreview = useCallback(async () => {
    if (!electronAPI?.previewCuentaCorriente) return setErrorMessage("Servicio de cuentas corrientes no disponible.")
    setLoading(true)
    setResult(null)
    setConfirmed(false)
    setExcludedKeys(new Set())
    setExpandedClients(new Set())
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await electronAPI.previewCuentaCorriente({ environment: "produccion", periodo, fechaEmision, limit })
      if (response?.error) throw new Error(response.details || response.error)
      setPreview(response)
      setStatusMessage(`${response.resumen?.listos || 0} cuentas listas para facturar.`)
    } catch (error) {
      setPreview(null)
      setErrorMessage(error instanceof Error ? error.message : "No se pudo previsualizar cuentas corrientes.")
    } finally {
      setLoading(false)
    }
  }, [electronAPI, fechaEmision, limit, periodo])

  const toggleCandidate = (candidate: CuentaCorrientePreviewCandidate) => {
    if (candidate.estado !== "listo") return
    setConfirmed(false)
    setResult(null)
    const key = candidateKey(candidate)
    setExcludedKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clientGroups = useMemo(() => {
    const groups = new Map<number, CuentaCorrientePreviewCandidate[]>()
    visibleCandidates.forEach(candidate => {
      const current = groups.get(candidate.cliente) || []
      current.push(candidate)
      groups.set(candidate.cliente, current)
    })
    return [...groups.entries()].map(([client, points]) => ({
      client,
      points,
      razonSocial: points[0]?.razon_social || "-",
      low: points.some(point => point.consumoBajo),
      readyPoints: points.filter(point => point.estado === "listo"),
      total: points.reduce((sum, point) => sum + Number(point.total || 0), 0),
      remitos: points.reduce((sum, point) => sum + Number(point.remitos || 0), 0),
      contenidos20: points.reduce((sum, point) => sum + Number(point.contenidos20 || 0), 0),
      contenidos10: points.reduce((sum, point) => sum + Number(point.contenidos10 || 0), 0),
      alquileres: points.reduce((sum, point) => sum + Number(point.alquileres || 0), 0)
    }))
  }, [visibleCandidates])

  const toggleClient = (points: CuentaCorrientePreviewCandidate[]) => {
    const readyPoints = points.filter(point => point.estado === "listo")
    if (!readyPoints.length) return
    setConfirmed(false)
    setResult(null)
    const allIncluded = readyPoints.every(point => !excludedKeys.has(candidateKey(point)))
    setExcludedKeys(current => {
      const next = new Set(current)
      readyPoints.forEach(point => {
        const key = candidateKey(point)
        if (allIncluded) next.add(key)
        else next.delete(key)
      })
      return next
    })
  }

  const toggleExpanded = (client: number) => {
    setExpandedClients(current => {
      const next = new Set(current)
      if (next.has(client)) next.delete(client)
      else next.add(client)
      return next
    })
  }

  const generate = useCallback(async () => {
    if (!electronAPI?.generateCuentaCorriente) return setErrorMessage("Servicio de cuentas corrientes no disponible.")
    if (!canGenerate) return setErrorMessage("Revise el preview y confirme la facturacion.")
    setGenerating(true)
    setStatusMessage(null)
    setErrorMessage(null)
    try {
      const response = await electronAPI.generateCuentaCorriente({
        environment: "produccion", periodo, fechaEmision, limit,
        confirmation: CONFIRMATION,
        selectedCandidates: selectedReady.map(candidate => ({ codCliente: candidate.cliente, nroLugarEntrega: candidate.punto }))
      })
      if (response?.error) throw new Error(response.details || response.error)
      setResult(response)
      setStatusMessage("Facturacion de cuentas corrientes finalizada.")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo facturar el lote.")
    } finally {
      setGenerating(false)
    }
  }, [canGenerate, electronAPI, fechaEmision, limit, periodo, selectedReady])

  return (
    <div className="content abonos-layout">
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <main className="abonos-main">
        <div className="abonos-mode-tabs" role="tablist" aria-label="Tipo de facturacion">
          <button type="button" onClick={onShowAbonos}>Abonos</button>
          <button className="abonos-mode-tabs--active" type="button" aria-selected="true">Cuentas corrientes</button>
        </div>
        <div className="abonos-toolbar cc-toolbar">
          <label className="abonos-field"><span>Periodo</span><input type="month" value={periodo} onChange={event => setPeriodo(event.target.value)} aria-label="Periodo cuenta corriente" /></label>
          <label className="abonos-field"><span>Emision</span><SpanishDateInput value={fechaEmision} onChange={setFechaEmision} ariaLabel="Emision cuenta corriente" /></label>
          <label className="abonos-field abonos-field--small"><span>Filas preview</span><input type="number" min="1" max="1000" value={limit} onChange={event => setLimit(event.target.value)} /></label>
          <button className="fetch-button abonos-primary-action" type="button" onClick={loadPreview} disabled={loading || generating}>{loading ? "Previsualizando..." : "Previsualizar"}</button>
        </div>
        <section className="abonos-summary-grid" aria-label="Resumen de cuentas corrientes">
          <div className="abonos-metric abonos-metric--primary"><span>Con RR</span><strong>{preview?.resumen?.total || 0}</strong><small>Clientes/puntos del mes</small></div>
          <div className="abonos-metric abonos-metric--ready"><span>Listos</span><strong>{preview?.resumen?.listos || 0}</strong><small>Con precio y sin duplicado</small></div>
          <div className="abonos-metric cc-metric--warning"><span>Consumo bajo</span><strong>{preview?.resumen?.consumo_bajo || 0}</strong><small>Menos de {preview?.minimoConsumo || 5} contenidos</small></div>
          <div className="abonos-metric"><span>FA/7</span><strong>{preview?.resumen?.FA.count || 0}</strong><small>{formatMoney(preview?.resumen?.FA.total)}</small></div>
          <div className="abonos-metric"><span>FB/7</span><strong>{preview?.resumen?.FB.count || 0}</strong><small>{formatMoney(preview?.resumen?.FB.total)}</small></div>
          <div className="abonos-metric"><span>Revisar</span><strong>{preview?.resumen?.revisar || 0}</strong><small>No se autorizaran</small></div>
        </section>
        <div className="abonos-table-wrap">
          <div className="abonos-table-filter" role="group" aria-label="Filtro de cuentas corrientes">
            {([['todos', 'Todos'], ['bajo', 'Consumo bajo'], ['fa', 'FA/7'], ['fb', 'FB/7'], ['revisar', 'Revisar']] as Array<[Filter, string]>).map(([key, label]) => <button key={key} type="button" className={`abonos-filter-button${filter === key ? " abonos-filter-button--active" : ""}`} onClick={() => setFilter(key)}>{label}</button>)}
          </div>
          <div className="abonos-table-caption">
            {selectedReady.length} de {ready.length} facturas facturables incluidas.
            {excludedKeys.size ? <button type="button" className="abonos-reset-selection" onClick={() => { setExcludedKeys(new Set()); setConfirmed(false); setResult(null) }}>Incluir todos</button> : null}
          </div>
          <table className="abonos-table cc-table">
            <thead><tr><th>Seleccion</th><th>Alerta</th><th>Cliente</th><th>Facturacion</th><th>Razon social</th><th>Tipo</th><th>RR</th><th>x20</th><th>x10</th><th>Alq.</th><th>Total</th><th>Resultado</th></tr></thead>
            <tbody>{clientGroups.length ? clientGroups.flatMap(group => {
              const allIncluded = group.readyPoints.length > 0 && group.readyPoints.every(point => !excludedKeys.has(candidateKey(point)))
              const someIncluded = group.readyPoints.some(point => !excludedKeys.has(candidateKey(point)))
              const isExpanded = expandedClients.has(group.client)
              const clientTypes = [...new Set(group.points.map(point => point.tipo + (point.prefijo ? `/${point.prefijo}` : "")))].join(", ")
              const shared = group.points.length === 1 && group.points[0].facturacionCompartida
              const scope = shared ? `Compartida · ${group.points[0].puntosOrigen || 1} punto(s)` : `${group.points.length} punto(s)`
              const clientRow = <tr key={`client-${group.client}`} className={`cc-client-row${group.low ? " cc-row--low" : ""}`} onClick={() => toggleExpanded(group.client)}>
                <td>{group.readyPoints.length ? <input className="cc-select-input" type="checkbox" checked={allIncluded} ref={element => { if (element) element.indeterminate = someIncluded && !allIncluded }} onClick={event => event.stopPropagation()} onChange={() => toggleClient(group.points)} aria-label={`Incluir cliente ${group.client}`} /> : "-"}</td>
                <td>{group.low ? <span className="cc-low-tag">Bajo</span> : "-"}</td><td>{group.client}</td><td>{scope}</td><td>{group.razonSocial}</td><td>{clientTypes}</td><td>{group.remitos}</td><td>{group.contenidos20}</td><td>{group.contenidos10}</td><td>{group.alquileres}</td><td>{formatMoney(group.total)}</td><td><button type="button" className="cc-expand-button" onClick={event => { event.stopPropagation(); toggleExpanded(group.client) }}>{isExpanded ? "Ocultar" : "Ver detalle"}</button></td>
              </tr>
              const pointRows = !isExpanded ? [] : group.points.map(candidate => {
                const key = candidateKey(candidate)
                const selected = candidate.estado === "listo" && !excludedKeys.has(key)
                const rowResult = resultByKey.get(key)
                const resultText = rowResult ? rowResult.ok ? `${rowResult.tipo}/${rowResult.prefijo}-${rowResult.numero} · CAE ${rowResult.cae}` : String(rowResult.error || "Fallida") : candidate.estado === "listo" ? "Pendiente" : candidate.warnings.join(" ")
                return <tr key={key} className={`cc-point-row${selected ? " abonos-table-row--selected" : ""}${candidate.consumoBajo ? " cc-row--low" : ""}${candidate.estado !== "listo" || (rowResult && !rowResult.ok) ? " abonos-table-row--error" : ""}`}>
                  <td>{candidate.estado === "listo" ? <input className="cc-select-input" type="checkbox" checked={selected} onChange={() => toggleCandidate(candidate)} aria-label={`Incluir cliente ${candidate.cliente}, punto ${candidate.punto}`} /> : "-"}</td>
                  <td>{candidate.consumoBajo ? <span className="cc-low-tag">Bajo</span> : "-"}</td><td>{candidate.cliente}</td><td>{candidate.facturacionCompartida ? `Compartida · cabecera ${candidate.punto}` : `Punto ${candidate.punto}`}</td><td>{candidate.razon_social || "-"}</td><td>{candidate.tipo}{candidate.prefijo ? `/${candidate.prefijo}` : ""}</td><td>{candidate.remitos}</td><td>{candidate.contenidos20}</td><td>{candidate.contenidos10}</td><td>{candidate.alquileres}</td><td>{formatMoney(candidate.total)}</td><td>{resultText}</td>
                </tr>
              })
              return [clientRow, ...pointRows]
            }) : <tr><td colSpan={12}>Sin cuentas corrientes para mostrar.</td></tr>}</tbody>
          </table>
        </div>
      </main>
      <aside className="sidebar loan-actions abonos-actions">
        <div className="abonos-confirm-block">
          <label className="abonos-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmar autorizacion de {selectedReady.length} facturas</span></label>
          <button className="fetch-button fetch-button--success" type="button" onClick={generate} disabled={!canGenerate}>{generating ? "Autorizando..." : "Autorizar y guardar"}</button>
        </div>
        <div className="abonos-side-summary"><span>Ambiente</span><strong>produccion</strong><span>ARCA</span><strong>{preview ? "pendiente" : "no consultado"}</strong><span>Concepto</span><strong>1 · Productos</strong><span>Consumo bajo</span><strong>Se muestra primero, no agrega diferencial</strong></div>
      </aside>
    </div>
  )
}
