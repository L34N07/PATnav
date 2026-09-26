import React, { useCallback, useMemo, useState } from "react"
import type {
  AbonosGenerateResult,
  AbonosPayload,
  AbonosPreviewCandidate,
  AbonosPreviewResult
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"
import SpanishDateInput from "../../SpanishDateInput"
import CuentaCorrienteBillingView from "./CuentaCorrienteBillingView"

const SUCCESS_MESSAGE_DURATION_MS = 2500
const ERROR_MESSAGE_DURATION_MS = 4000
const CONFIRMATION = "CONFIRMAR_ABONOS_PRODUCCION"
const TABLE_FILTERS = [
  { key: "todos", label: "Todos los listos" },
  { key: "fa", label: "FA/7" },
  { key: "fb", label: "FB/7" },
  { key: "fc", label: "FC/4" }
] as const

type TableFilter = (typeof TABLE_FILTERS)[number]["key"]

const formatMoney = (value: unknown) => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return "-"
  }
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number)
}

const todayIsoDate = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const firstDayOfMonth = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}-01`
}

const buildRequest = (desde: string, hasta: string, fechaEmision: string, limit: string): AbonosPayload => ({
  environment: "produccion",
  desde,
  hasta,
  fechaEmision: fechaEmision || undefined,
  representada: "20220334857",
  limit
})

const candidateKey = (candidate: AbonosPreviewCandidate) =>
  `${candidate.cliente}/${candidate.punto}`

const formatCount = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : "-"
}

const formatPeriod = (value: unknown) => {
  const raw = String(value ?? "")
  const match = raw.match(/^(\d{4})(\d{2})$/)
  return match ? `${match[2]}/${match[1]}` : raw || "-"
}

export default function AbonosView() {
  const electronAPI = window.electronAPI
  const [desde, setDesde] = useState(firstDayOfMonth)
  const [hasta, setHasta] = useState(todayIsoDate)
  const [fechaEmision, setFechaEmision] = useState(todayIsoDate)
  const [limit, setLimit] = useState("250")
  const [tableFilter, setTableFilter] = useState<TableFilter>("todos")
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set())
  const [confirmationChecked, setConfirmationChecked] = useState(false)
  const [preview, setPreview] = useState<AbonosPreviewResult | null>(null)
  const [generation, setGeneration] = useState<AbonosGenerateResult | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [section, setSection] = useState<"abonos" | "cc">("abonos")

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
  }, [])

  const request = useMemo(
    () => buildRequest(desde, hasta, fechaEmision, limit),
    [desde, fechaEmision, hasta, limit]
  )

  const summary = preview?.resumen
  const candidates = useMemo(
    () => (preview?.candidatos ?? []).filter(candidate => candidate.estado !== "descartado"),
    [preview]
  )
  const filteredCandidates = useMemo(
    () =>
      candidates.filter(candidate => {
        const type = `${candidate.tipo}/${candidate.prefijo}`.toUpperCase()
        if (tableFilter === "fa") {
          return type === "FA/7"
        }
        if (tableFilter === "fb") {
          return type === "FB/7"
        }
        if (tableFilter === "fc") {
          return type === "FC/4"
        }
        return true
      }),
    [candidates, tableFilter]
  )
  const selectedCount = selectionMode ? selectedCandidateKeys.size : candidates.length
  const discardReasons = summary?.descartados_por_motivo ?? []
  const canGenerate =
    Boolean(preview && !preview.error) &&
    selectedCount > 0 &&
    confirmationChecked &&
    !isGenerating

  const loadPreview = useCallback(async () => {
    clearMessages()
    setGeneration(null)
    setConfirmationChecked(false)
    setSelectionMode(false)
    setSelectedCandidateKeys(new Set())

    if (!electronAPI?.previewAbonos) {
      setErrorMessage("Servicio de abonos no disponible.")
      return
    }

    setIsLoadingPreview(true)
    try {
      const result = await electronAPI.previewAbonos(request)
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      setPreview(result)
      const ready = (result.candidatos ?? []).filter(candidate => candidate.estado !== "descartado").length
      setStatusMessage(ready > 0 ? `${ready} abonos listos para generar.` : "No hay abonos listos.")
    } catch (error) {
      console.error("No se pudo previsualizar abonos:", error)
      setPreview(null)
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al previsualizar.")
    } finally {
      setIsLoadingPreview(false)
    }
  }, [clearMessages, electronAPI, request])

  const generate = useCallback(async () => {
    clearMessages()

    if (!electronAPI?.generateAbonos) {
      setErrorMessage("Servicio de generacion no disponible.")
      return
    }
    if (!canGenerate) {
      setErrorMessage("Revise el preview y escriba la confirmacion exacta.")
      return
    }

    setIsGenerating(true)
    try {
      const result = await electronAPI.generateAbonos({
        ...request,
        confirmation: confirmationChecked ? CONFIRMATION : "",
        selectedCandidates: candidates
          .filter(candidate => !selectionMode || selectedCandidateKeys.has(candidateKey(candidate)))
          .map(candidate => ({ codCliente: candidate.cliente, nroLugarEntrega: candidate.punto }))
      })
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      setGeneration(result)
      setStatusMessage("Generacion finalizada.")
    } catch (error) {
      console.error("No se pudo generar abonos:", error)
      setGeneration(null)
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al generar.")
    } finally {
      setIsGenerating(false)
    }
  }, [canGenerate, candidates, clearMessages, confirmationChecked, electronAPI, request, selectedCandidateKeys, selectionMode])

  const toggleCandidate = (candidate: AbonosPreviewCandidate) => {
    const key = candidateKey(candidate)
    setGeneration(null)
    setConfirmationChecked(false)
    if (!selectionMode) {
      setSelectionMode(true)
      setSelectedCandidateKeys(new Set([key]))
      return
    }
    setSelectedCandidateKeys(current => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const resetSelection = () => {
    setSelectionMode(false)
    setSelectedCandidateKeys(new Set())
    setGeneration(null)
    setConfirmationChecked(false)
  }

  const generationByCandidate = useMemo(() => {
    const entries = (generation?.resultados ?? []).map(result => [
      `${result.cod_cliente}/${result.nro_lugar_entrega}`,
      result
    ])
    return new Map(entries)
  }, [generation])

  if (section === "cc") {
    return <CuentaCorrienteBillingView onShowAbonos={() => setSection("abonos")} />
  }

  return (
    <div className="content abonos-layout">
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />

      <main className="abonos-main">
        <div className="abonos-mode-tabs" role="tablist" aria-label="Tipo de facturacion">
          <button className="abonos-mode-tabs--active" type="button" aria-selected="true">Abonos</button>
          <button type="button" onClick={() => setSection("cc")}>Cuentas corrientes</button>
        </div>
        <div className="abonos-toolbar">
          <label className="abonos-field">
            <span>Desde</span>
            <SpanishDateInput value={desde} onChange={setDesde} ariaLabel="Desde" />
          </label>
          <label className="abonos-field">
            <span>Hasta</span>
            <SpanishDateInput value={hasta} onChange={setHasta} ariaLabel="Hasta" />
          </label>
          <label className="abonos-field">
            <span>Emision</span>
            <SpanishDateInput value={fechaEmision} onChange={setFechaEmision} ariaLabel="Emision" />
          </label>
          <label className="abonos-field abonos-field--small">
            <span>Filas preview</span>
            <input type="number" min="1" max="1000" value={limit} onChange={event => setLimit(event.target.value)} />
          </label>
          <button className="fetch-button abonos-primary-action" type="button" onClick={loadPreview} disabled={isLoadingPreview || isGenerating}>
            {isLoadingPreview ? "Previsualizando..." : "Previsualizar"}
          </button>
        </div>

        <section className="abonos-summary-grid" aria-label="Resumen de abonos">
          <div className="abonos-metric abonos-metric--primary">
            <span>Total evaluado</span>
            <strong>{formatCount(summary?.total_candidatos)}</strong>
            <small>Sin clientes ignorados</small>
          </div>
          <div className="abonos-metric">
            <span>FA/7 a ARCA</span>
            <strong>{formatCount(summary?.FA_electronicas?.count)}</strong>
            <small>{formatMoney(summary?.FA_electronicas?.total)}</small>
          </div>
          <div className="abonos-metric">
            <span>FB/7 a ARCA</span>
            <strong>{formatCount(summary?.FB_electronicas?.count)}</strong>
            <small>{formatMoney(summary?.FB_electronicas?.total)}</small>
          </div>
          <div className="abonos-metric">
            <span>FC/4 interno</span>
            <strong>{formatCount(summary?.FC4_internas?.count)}</strong>
            <small>{formatMoney(summary?.FC4_internas?.total)}</small>
          </div>
          <div className="abonos-metric abonos-metric--ready">
            <span>Listos</span>
            <strong>{formatCount(summary?.listos_para_generar)}</strong>
            <small>Pasaron filtros</small>
          </div>
          <div className="abonos-metric">
            <span>Descartados</span>
            <strong>{formatCount(summary?.descartados)}</strong>
            <small>No pasan control</small>
          </div>
          <div className="abonos-metric">
            <span>Ignorados</span>
            <strong>{formatCount(summary?.ignorados_manuales)}</strong>
            <small>Lista manual</small>
          </div>
        </section>

        <section className="abonos-legend" aria-label="Definiciones">
          <span><strong>FA/7</strong> categoria IVA A, pide CAE.</span>
          <span><strong>FB/7</strong> categoria IVA B, pide CAE.</span>
          <span><strong>FC/4</strong> categoria IVA C, interno sin ARCA.</span>
          <span><strong>Listos</strong> no duplicados, total mayor a cero.</span>
        </section>

        <div className="abonos-table-wrap">
          <div className="abonos-table-filter" role="group" aria-label="Filtro de filas">
            {TABLE_FILTERS.map(filter => (
              <button
                className={`abonos-filter-button${tableFilter === filter.key ? " abonos-filter-button--active" : ""}`}
                type="button"
                key={filter.key}
                onClick={() => setTableFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="abonos-table-caption">
            {selectionMode
              ? `${selectedCount} de ${candidates.length} clientes seleccionados.`
              : `Todos los ${candidates.length} clientes listos estan seleccionados.`}
            {selectionMode ? (
              <button type="button" className="abonos-reset-selection" onClick={resetSelection}>Seleccionar todos</button>
            ) : null}
          </div>
          <table className="abonos-table">
            <thead>
              <tr>
                <th>Seleccion</th>
                <th>Cliente</th>
                <th>Punto</th>
                <th>Razon Social</th>
                <th>Tipo</th>
                <th>Destino</th>
                <th>Disp.</th>
                <th>Items</th>
                <th>Periodo</th>
                <th>Total</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.length ? (
                filteredCandidates.map(candidate => {
                  const key = candidateKey(candidate)
                  const selected = !selectionMode || selectedCandidateKeys.has(key)
                  const result = generationByCandidate.get(key) as Record<string, unknown> | undefined
                  const resultText = result
                    ? result.ok
                      ? result.cae
                        ? `CAE ${result.cae}`
                        : "Generado interno"
                      : String(result.error || "Error al generar")
                    : "Pendiente"
                  return (
                  <tr
                    key={key}
                    className={`${selected ? "abonos-table-row--selected" : ""}${result && !result.ok ? " abonos-table-row--error" : ""}`}
                    onClick={() => toggleCandidate(candidate)}
                  >
                    <td><span className={`abonos-selection-mark${selected ? " abonos-selection-mark--checked" : ""}`}>{selected ? "Si" : "No"}</span></td>
                    <td>{candidate.cliente}</td>
                    <td>{candidate.punto}</td>
                    <td>{candidate.razon_social || "-"}</td>
                    <td>{candidate.tipo}/{candidate.prefijo}</td>
                    <td>{candidate.destino}</td>
                    <td>{candidate.dispensers}</td>
                    <td>{candidate.items}</td>
                    <td>{formatPeriod(candidate.periodo)}</td>
                    <td>{formatMoney(candidate.total)}</td>
                    <td>{resultText}</td>
                  </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={11}>Sin clientes listos para mostrar con este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      <aside className="sidebar loan-actions abonos-actions">
        <div className="abonos-confirm-block">
          <label className="abonos-check">
            <input
              type="checkbox"
              checked={confirmationChecked}
              onChange={event => setConfirmationChecked(event.target.checked)}
            />
            <span>Confirmar generacion de {selectedCount} abonos</span>
          </label>
          <button className="fetch-button fetch-button--success" type="button" onClick={generate} disabled={!canGenerate}>
            {isGenerating ? "Generando..." : "Generar abonos"}
          </button>
        </div>

        <div className="abonos-side-summary">
          <span>Ambiente</span>
          <strong>{preview?.environment || "produccion"}</strong>
          <span>ARCA</span>
          <strong>{preview?.llama_arca ? "si" : "no"}</strong>
          <span>DB</span>
          <strong>{preview?.escribe_db ? "escribe" : "preview"}</strong>
          <span>Clientes ignorados</span>
          <strong>1130</strong>
        </div>

        {discardReasons.length ? (
          <div className="abonos-side-summary">
            <span>Controles aplicados</span>
            {discardReasons.slice(0, 6).map(reason => (
              <div className="abonos-discard-reason" key={reason.motivo}>
                <strong>{reason.cantidad}</strong>
                <span>{reason.motivo}</span>
              </div>
            ))}
          </div>
        ) : null}

      </aside>
    </div>
  )
}
