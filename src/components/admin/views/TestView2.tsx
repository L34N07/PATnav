import React, { useCallback, useMemo, useRef, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"
import LoanSummaryCard from "./TestView2/components/LoanSummaryCard"
import { LoanMovementRow, LoanSummaryRow } from "./TestView2/types"

const STATUS_MESSAGE_DURATION_MS = 2000
const ITEM_LABELS: Record<number, string> = {
  1: "Bidon x20",
  2: "Bidon x10",
  5: "Envase x20",
  6: "Envase x10"
}

const INFO_EXTRA_OPTIONS: ReadonlyArray<"A" | "P" | "D"> = ["A", "P", "D"]
const INFO_EXTRA_ALLOWED_ESTADOS: ReadonlySet<string> = new Set(["VD", "VP", "A", "P", "D"])

type MovementsByClient = Record<string, LoanMovementRow[]>
type MovementErrorsByClient = Record<string, string | null>
type MovementSelectionMap = Record<string, string | null>

const buildClientKey = (codCliente: number, subcodigo: string): string =>
  `${codCliente}::${subcodigo || ""}`

export default function TestView2() {
  const electronAPI = window.electronAPI

  const [isResumenRunning, setIsResumenRunning] = useState(false)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [rows, setRows] = useState<LoanSummaryRow[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(null)
  const [movementsByClient, setMovementsByClient] = useState<MovementsByClient>({})
  const [movementErrors, setMovementErrors] = useState<MovementErrorsByClient>({})
  const [movementLoadingClient, setMovementLoadingClient] = useState<string | null>(null)
  const [selectedMovementByClient, setSelectedMovementByClient] = useState<MovementSelectionMap>({})
  const [isInfoExtraUpdating, setIsInfoExtraUpdating] = useState(false)
  const summaryCardRefs = useRef<Array<HTMLDivElement | null>>([])

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setErrorMessage(null)
    setStatusMessage(null)
  }, [setErrorMessage, setStatusMessage])

  const expandedRow =
    expandedCardIndex !== null && rows[expandedCardIndex] ? rows[expandedCardIndex] : null
  const expandedClientKey = expandedRow
    ? buildClientKey(expandedRow.CLIENTE, expandedRow.SUBCODIGO)
    : null
  const expandedClientId = expandedRow ? expandedRow.CLIENTE : null
  const selectedMovementId =
    expandedClientKey !== null
      ? selectedMovementByClient[expandedClientKey] ?? null
      : null
  const selectedMovement = useMemo(() => {
    if (!expandedClientKey || !selectedMovementId) {
      return null
    }
    const clientMovements = movementsByClient[expandedClientKey] ?? []
    return clientMovements.find(movement => movement.id === selectedMovementId) ?? null
  }, [expandedClientKey, selectedMovementId, movementsByClient])

  const isAnyActionRunning = isResumenRunning || isSummaryLoading || isInfoExtraUpdating
  const selectedMovementEstado = selectedMovement
    ? selectedMovement.infoExtra.trim().toUpperCase()
    : ""
  const isInfoExtraActionDisabled =
    isAnyActionRunning ||
    !selectedMovement ||
    !INFO_EXTRA_ALLOWED_ESTADOS.has(selectedMovementEstado)

  const handleExecuteResumen = async () => {
    if (!electronAPI?.resumen_remitos) {
      setErrorMessage("No se encuentra disponible la accion de resumen de remitos.")
      return
    }

    setIsResumenRunning(true)
    clearMessages()

    try {
      const result = await electronAPI.resumen_remitos()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      setStatusMessage("Resumen de remitos ejecutado correctamente.")
    } catch (error) {
      console.error("No se pudo ejecutar resumen_remitos:", error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al ejecutar resumen_remitos."
      )
    } finally {
      setIsResumenRunning(false)
    }
  }

  const handleLoadSummary = async () => {
    if (!electronAPI?.traer_resumen_prestamos) {
      setErrorMessage("No se encuentra disponible la accion de cargar resumen.")
      return
    }

    setIsSummaryLoading(true)
    clearMessages()

    try {
      const result = await electronAPI.traer_resumen_prestamos()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedRows = (result?.rows ?? [])
        .map(toLoanSummaryRow)
        .sort((a, b) => a.fechaSortKey - b.fechaSortKey)
      setRows(fetchedRows)
      setExpandedCardIndex(null)
      setMovementsByClient({})
      setMovementErrors({})
      setSelectedMovementByClient({})
      setMovementLoadingClient(null)

      if (fetchedRows.length > 0) {
        setStatusMessage("Resumen de prestamos cargado correctamente.")
      } else {
        setStatusMessage("No hay registros de prestamos y devoluciones.")
      }
    } catch (error) {
      console.error("No se pudo cargar traer_resumen_prestamos:", error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al cargar el resumen de prestamos."
      )
    } finally {
      setIsSummaryLoading(false)
    }
  }

  const handleToggleCard = (index: number) => {
    const isSameCard = expandedCardIndex === index
    const nextIndex = isSameCard ? null : index
    setExpandedCardIndex(nextIndex)

    if (!isSameCard && nextIndex !== null) {
      requestAnimationFrame(() => {
        const targetCard = summaryCardRefs.current[nextIndex]
        targetCard?.scrollIntoView({
          behavior: "smooth",
          block: "start",
          inline: "nearest"
        })
      })
    }

    if (!isSameCard) {
      const targetRow = rows[index]
      if (!targetRow) {
        return
      }

      const clientId = targetRow.CLIENTE
      const subcodigo = targetRow.SUBCODIGO
      const clientKey = buildClientKey(clientId, subcodigo)
      setSelectedMovementByClient(prev => ({ ...prev, [clientKey]: null }))
      if (!movementsByClient[clientKey] && movementLoadingClient !== clientKey) {
        void loadMovements(clientKey, clientId, subcodigo)
      }
    }
  }

  const handleSelectMovement = (clientKey: string, movementId: string) => {
    setSelectedMovementByClient(prev => ({
      ...prev,
      [clientKey]: prev[clientKey] === movementId ? null : movementId
    }))
  }

  const loadMovements = async (clientKey: string, codCliente: number, subcodigo: string) => {
    if (!electronAPI?.traer_movimientos_cliente) {
      setMovementErrors(prev => ({
        ...prev,
        [clientKey]: "No se encuentra disponible la accion de movimientos."
      }))
      return
    }

    setMovementLoadingClient(clientKey)
    setMovementErrors(prev => ({ ...prev, [clientKey]: null }))

    try {
      const sanitizedSubcodigo = subcodigo ?? ""
      const result = await electronAPI.traer_movimientos_cliente(codCliente, sanitizedSubcodigo)
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedMovements = sortMovements(
        (result?.rows ?? []).map((row, index) =>
          toLoanMovementRow(row as Record<string, unknown>, codCliente, index)
        )
      )

      setMovementsByClient(prev => ({ ...prev, [clientKey]: fetchedMovements }))
    } catch (error) {
      console.error("No se pudieron cargar movimientos del cliente:", error)
      setMovementsByClient(prev => ({ ...prev, [clientKey]: [] }))
      setMovementErrors(prev => ({
        ...prev,
        [clientKey]:
          error instanceof Error
            ? error.message
            : "Error desconocido al cargar los movimientos."
      }))
    } finally {
      setMovementLoadingClient(prev => (prev === clientKey ? null : prev))
    }
  }

  const handleUpdateInfoExtra = async (infoExtraValue: "A" | "P" | "D") => {
    if (!electronAPI?.actualizar_infoextra_por_registro) {
      setErrorMessage("No se encuentra disponible la accion de actualizar INFOEXTRA.")
      return
    }

    if (!selectedMovement || !expandedClientKey || expandedClientId === null) {
      setErrorMessage("Seleccione un movimiento para actualizar.")
      return
    }

    setIsInfoExtraUpdating(true)
    clearMessages()

    try {
      const numeroRemitoParam =
        selectedMovement.numeroRemito === "-" ? "" : selectedMovement.numeroRemito
      const result = await electronAPI.actualizar_infoextra_por_registro({
        numeroRemito: numeroRemitoParam,
        prefijoRemito: selectedMovement.prefijoRemito,
        tipoComprobante: selectedMovement.tipoComprobante,
        nroOrden: selectedMovement.nroOrden,
        infoExtra: infoExtraValue
      })

      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      setMovementsByClient(prev => {
        const existing = prev[expandedClientKey]
        if (!existing) {
          return prev
        }

        return {
          ...prev,
          [expandedClientKey]: existing.map(movement =>
            movement.id === selectedMovement.id
              ? { ...movement, infoExtra: infoExtraValue }
              : movement
          )
        }
      })

      setStatusMessage("Información extra actualizada correctamente.")
    } catch (error) {
      console.error("No se pudo actualizar INFOEXTRA:", error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al actualizar la información extra."
      )
    } finally {
      setIsInfoExtraUpdating(false)
    }
  }

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content">
        <div className="table-container loan-summary-panel">
          <div className="loan-cards">
            {rows.length > 0 ? (
              rows.map((row, index) => {
                const clientKey = buildClientKey(row.CLIENTE, row.SUBCODIGO)
                return (
                  <LoanSummaryCard
                    key={`${row.CLIENTE}-${row.SUBCODIGO}-${row.COMPROBANTE}-${row.fechaSortKey}-${index}`}
                    row={row}
                    isExpanded={expandedCardIndex === index}
                    isLoadingMovements={movementLoadingClient === clientKey}
                    movementError={movementErrors[clientKey] ?? null}
                    movements={movementsByClient[clientKey]}
                    selectedMovementId={selectedMovementByClient[clientKey] ?? null}
                    onToggle={() => handleToggleCard(index)}
                    onSelectMovement={movementId => handleSelectMovement(clientKey, movementId)}
                    ref={element => {
                      summaryCardRefs.current[index] = element
                    }}
                  />
                )
              })
            ) : (
              <div className="loan-empty-state">
                No hay datos para mostrar. Utilice el panel derecho para cargar el resumen.
              </div>
            )}
          </div>
        </div>
        <div className="sidebar loan-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            <button
              className="fetch-button"
              type="button"
              onClick={handleExecuteResumen}
              disabled={isAnyActionRunning}
            >
              Comprobar VP y VD
            </button>
            <button
              className="fetch-button"
              type="button"
              onClick={handleLoadSummary}
              disabled={isAnyActionRunning}
            >
              Mostrar Resumen
            </button>
            {isAnyActionRunning && (
              <span className="loan-actions__loading">Procesando...</span>
            )}
          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__infoextra">
            <span className="loan-actions__section-title">Actualizar</span>
            <div className="loan-actions__infoextra-buttons">
              {INFO_EXTRA_OPTIONS.map(option => (
                <button
                  key={option}
                  className="fetch-button infoextra-button"
                  type="button"
                  onClick={() => handleUpdateInfoExtra(option)}
                  disabled={isInfoExtraActionDisabled}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

const toLoanSummaryRow = (row: Record<string, unknown>): LoanSummaryRow => {
  const { display, sortKey } = parseDateValue(row.FECHA)
  const rawSubcodigo = row.SUBCODIGO
  const subcodigo =
    rawSubcodigo === null || rawSubcodigo === undefined
      ? ""
      : String(rawSubcodigo).trim()
  const rawDomicilio = row.DOMICILIO
  const domicilio =
    rawDomicilio === null || rawDomicilio === undefined
      ? ""
      : normalizeWhitespace(String(rawDomicilio))
  return {
    CLIENTE: Number(row.CLIENTE ?? 0),
    SUBCODIGO: subcodigo,
    DOMICILIO: domicilio,
    COMPROBANTE: Number(row.COMPROBANTE ?? 0),
    ESTADO: String(row.ESTADO ?? ""),
    CANTIDAD: Number(row.CANTIDAD ?? 0),
    FECHA: display,
    fechaSortKey: sortKey
  }
}

const toLoanMovementRow = (
  row: Record<string, unknown>,
  codCliente: number,
  index: number
): LoanMovementRow => {
  const { display, sortKey } = parseDateValue(row.fecha_remito)
  const numeroRemito = String(row.numero_remito ?? "").trim()
  const prefijoRemito = String(row.prefijo_remito ?? "").trim()
  const tipoComprobante = String(row.tipo_comprobante ?? "").trim()
  const nroOrden = String(row.nro_orden ?? "").trim()
  const rawItemCode = Number(row.cod_item ?? 0)
  const itemLabel = ITEM_LABELS[rawItemCode] ?? (rawItemCode ? `Item ${rawItemCode}` : "Item sin especificar")
  const cantidad = Number(row.cantidad ?? 0)
  const infoExtra =
    row.INFOEXTRA !== null && row.INFOEXTRA !== undefined
      ? String(row.INFOEXTRA)
      : ""
  const identifier = `${codCliente}-${sortKey}-${numeroRemito || "remito"}-${index}`

  return {
    id: identifier,
    fechaRemito: display,
    fechaSortKey: sortKey,
    numeroRemito: numeroRemito || "-",
    prefijoRemito,
    tipoComprobante,
    nroOrden,
    itemCode: rawItemCode,
    itemLabel,
    cantidad,
    infoExtra
  }
}

const parseDateValue = (
  value: unknown
): { display: string; sortKey: number } => {
  if (!value) {
    return { display: "", sortKey: Number.POSITIVE_INFINITY }
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
    if (match) {
      const [, yearStr, monthStr, dayStr] = match
      const year = Number(yearStr)
      const month = Number(monthStr)
      const day = Number(dayStr)
      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        const sortKey = Date.UTC(year, month - 1, day)
        const display = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
        return { display, sortKey }
      }
    }
  }

  const fallbackDate = new Date(value as string | number)
  if (!Number.isNaN(fallbackDate.getTime())) {
    return {
      display: fallbackDate.toLocaleDateString(),
      sortKey: fallbackDate.getTime()
    }
  }

  return { display: String(value), sortKey: Number.POSITIVE_INFINITY }
}

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim()

const sortMovements = (rows: LoanMovementRow[]): LoanMovementRow[] =>
  [...rows].sort((a, b) => {
    if (a.fechaSortKey !== b.fechaSortKey) {
      return b.fechaSortKey - a.fechaSortKey
    }
    if (a.numeroRemito !== b.numeroRemito) {
      return a.numeroRemito.localeCompare(b.numeroRemito)
    }
    return a.id.localeCompare(b.id)
  })
