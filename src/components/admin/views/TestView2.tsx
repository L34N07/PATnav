import React, { useMemo, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"

const STATUS_MESSAGE_DURATION_MS = 3000

type LoanSummaryRow = {
  CLIENTE: number
  COMPROBANTE: number
  ESTADO: string
  CANTIDAD: number
  FECHA: string
}

export default function TestView2() {
  const electronAPI = window.electronAPI

  const [isResumenRunning, setIsResumenRunning] = useState(false)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [rows, setRows] = useState<LoanSummaryRow[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

      const fetchedRows = (result?.rows ?? []).map(toLoanSummaryRow)
      setRows(fetchedRows)

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

  const cards = useMemo(
    () => rows.map((row, index) => renderLoanCard(row, index)),
    [rows]
  )

  return (
    <div className="content">
      <div className="table-container loan-summary-panel">
        {errorMessage && <div className="table-status error">{errorMessage}</div>}
        {!errorMessage && statusMessage && (
          <div className="table-status info">{statusMessage}</div>
        )}
        <div className="loan-cards">
          {cards.length > 0 ? (
            cards
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

const toLoanSummaryRow = (row: Record<string, unknown>): LoanSummaryRow => ({
  CLIENTE: Number(row.CLIENTE ?? 0),
  COMPROBANTE: Number(row.COMPROBANTE ?? 0),
  ESTADO: String(row.ESTADO ?? ""),
  CANTIDAD: Number(row.CANTIDAD ?? 0),
  FECHA: formatDateValue(row.FECHA)
})

const formatDateValue = (value: unknown) => {
  if (!value) {
    return ""
  }

  const date = new Date(value as string | number)
  // Fallback to raw string if the date is invalid
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleDateString()
}

const renderLoanCard = (row: LoanSummaryRow, index: number) => {
  const summaryLabel = `Cliente ${row.CLIENTE} - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`

  return (
    <details className="loan-card" key={`${row.CLIENTE}-${row.COMPROBANTE}-${index}`}>
      <summary>{summaryLabel}</summary>
      <div className="loan-card-body">
        <span><strong>Cliente:</strong> {row.CLIENTE}</span>
        <span><strong>Comprobante:</strong> {row.COMPROBANTE}</span>
        <span><strong>Estado:</strong> {row.ESTADO}</span>
        <span><strong>Cantidad:</strong> {row.CANTIDAD}</span>
        <span><strong>Fecha:</strong> {row.FECHA}</span>
      </div>
    </details>
  )
}
