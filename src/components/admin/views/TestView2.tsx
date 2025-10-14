import React, { useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import LoanSummaryCard from "./TestView2/components/LoanSummaryCard"
import { LoanMovementRow, LoanSummaryRow } from "./TestView2/types"

const STATUS_MESSAGE_DURATION_MS = 3000
const ITEM_LABELS: Record<number, string> = {
  1: "Bidon x20",
  2: "Bidon x10",
  5: "Envase x20",
  6: "Envase x10"
}

type MovementsByClient = Record<number, LoanMovementRow[]>
type MovementErrorsByClient = Record<number, string | null>
type MovementSelectionMap = Record<number, string | null>

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
  const [movementLoadingClient, setMovementLoadingClient] = useState<number | null>(null)
  const [selectedMovementByClient, setSelectedMovementByClient] = useState<MovementSelectionMap>({})

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_MESSAGE_DURATION_MS)

  const isAnyActionRunning = isResumenRunning || isSummaryLoading

  const handleExecuteResumen = async () => {
    if (!electronAPI?.resumen_remitos) {
      setErrorMessage("No se encuentra disponible la accion de resumen de remitos.")
      return
    }

    setIsResumenRunning(true)
    setErrorMessage(null)
    setStatusMessage(null)

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
    setErrorMessage(null)
    setStatusMessage(null)

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

    if (!isSameCard) {
      const targetRow = rows[index]
      if (!targetRow) {
        return
      }

      const clientId = targetRow.CLIENTE
      setSelectedMovementByClient(prev => ({ ...prev, [clientId]: null }))
      if (!movementsByClient[clientId] && movementLoadingClient !== clientId) {
        void loadMovements(clientId)
      }
    }
  }

  const handleSelectMovement = (clientId: number, movementId: string) => {
    setSelectedMovementByClient(prev => ({
      ...prev,
      [clientId]: prev[clientId] === movementId ? null : movementId
    }))
  }

  const loadMovements = async (codCliente: number) => {
    if (!electronAPI?.traer_movimientos_cliente) {
      setMovementErrors(prev => ({
        ...prev,
        [codCliente]: "No se encuentra disponible la accion de movimientos."
      }))
      return
    }

    setMovementLoadingClient(codCliente)
    setMovementErrors(prev => ({ ...prev, [codCliente]: null }))

    try {
      const result = await electronAPI.traer_movimientos_cliente(codCliente)
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedMovements = sortMovements(
        (result?.rows ?? []).map((row, index) =>
          toLoanMovementRow(row as Record<string, unknown>, codCliente, index)
        )
      )

      setMovementsByClient(prev => ({ ...prev, [codCliente]: fetchedMovements }))
    } catch (error) {
      console.error("No se pudieron cargar movimientos del cliente:", error)
      setMovementsByClient(prev => ({ ...prev, [codCliente]: [] }))
      setMovementErrors(prev => ({
        ...prev,
        [codCliente]:
          error instanceof Error
            ? error.message
            : "Error desconocido al cargar los movimientos."
      }))
    } finally {
      setMovementLoadingClient(prev => (prev === codCliente ? null : prev))
    }
  }

  return (
    <div className="content">
      <div className="table-container loan-summary-panel">
        {errorMessage && <div className="table-status error">{errorMessage}</div>}
        {!errorMessage && statusMessage && (
          <div className="table-status info">{statusMessage}</div>
        )}
        <div className="loan-cards">
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <LoanSummaryCard
                key={`${row.CLIENTE}-${row.COMPROBANTE}-${row.fechaSortKey}-${index}`}
                row={row}
                isExpanded={expandedCardIndex === index}
                isLoadingMovements={movementLoadingClient === row.CLIENTE}
                movementError={movementErrors[row.CLIENTE] ?? null}
                movements={movementsByClient[row.CLIENTE]}
                selectedMovementId={selectedMovementByClient[row.CLIENTE] ?? null}
                onToggle={() => handleToggleCard(index)}
                onSelectMovement={movementId => handleSelectMovement(row.CLIENTE, movementId)}
              />
            ))
          ) : (
            <div className="loan-empty-state">
              No hay datos para mostrar. Utilice el panel derecho para cargar el resumen.
            </div>
          )}
        </div>
      </div>
      <div className="sidebar loan-actions">
        <button
          className="fetch-button"
          type="button"
          onClick={handleExecuteResumen}
          disabled={isAnyActionRunning}
        >
          Coprobar Prestamos Y Devoluciones
        </button>
        <button
          className="fetch-button"
          type="button"
          onClick={handleLoadSummary}
          disabled={isAnyActionRunning}
        >
          Cargar Resumen
        </button>
        {isAnyActionRunning && (
          <span className="loan-actions__loading">Procesando...</span>
        )}
      </div>
    </div>
  )
}

const toLoanSummaryRow = (row: Record<string, unknown>): LoanSummaryRow => {
  const { display, sortKey } = parseDateValue(row.FECHA)
  return {
    CLIENTE: Number(row.CLIENTE ?? 0),
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
  const rawItemCode = Number(row.cod_item ?? 0)
  const itemLabel = ITEM_LABELS[rawItemCode] ?? (rawItemCode ? `Item ${rawItemCode}` : "Item sin especificar")
  const cantidad = Number(row.cantidad ?? 0)
  const infoExtra = String(row.INFOEXTRA ?? "").trim()
  const identifier = `${codCliente}-${sortKey}-${numeroRemito || index}`

  return {
    id: identifier,
    fechaRemito: display,
    fechaSortKey: sortKey,
    numeroRemito: numeroRemito || "-",
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

const sortMovements = (rows: LoanMovementRow[]): LoanMovementRow[] =>
  [...rows].sort((a, b) => {
    if (a.fechaSortKey !== b.fechaSortKey) {
      return a.fechaSortKey - b.fechaSortKey
    }
    if (a.numeroRemito !== b.numeroRemito) {
      return a.numeroRemito.localeCompare(b.numeroRemito)
    }
    return a.id.localeCompare(b.id)
  })
