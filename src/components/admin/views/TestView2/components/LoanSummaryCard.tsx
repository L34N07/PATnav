import React, { forwardRef } from "react"
import { LoanSummaryRow } from "../types"

type LoanSummaryCardProps = {
  row: LoanSummaryRow
  isActive: boolean
  onOpen: () => void
}

const LoanSummaryCard = forwardRef<HTMLDivElement, LoanSummaryCardProps>(
  (
    { row, isActive, onOpen },
    ref
  ) => {
    const clientIdentifier = row.SUBCODIGO
      ? `${row.CLIENTE}/${row.SUBCODIGO}`
      : `${row.CLIENTE}`
    const domicilioDisplay = row.DOMICILIO || "-"
    const summaryLabel = `Cliente ${clientIdentifier} - Domicilio ${
      row.DOMICILIO || "Sin domicilio"
    } - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`

    return (
      <div ref={ref} className={`loan-card ${isActive ? "expanded" : ""}`}>
        <button
          type="button"
          className="loan-card-header"
          onClick={onOpen}
          aria-label={summaryLabel}
        >
          <div className="loan-card-header-info">
            <span className="loan-card-header-item">
              <strong>Cliente:</strong> {clientIdentifier}
            </span>
            <span className="loan-card-header-item loan-card-header-item--domicilio">
              <strong>Domicilio:</strong> {domicilioDisplay}
            </span>
            <span className="loan-card-header-item">
              <strong>Comprobante:</strong> {row.COMPROBANTE}
            </span>
            <span className="loan-card-header-item">
              <strong>Estado:</strong> {row.ESTADO}
            </span>
          </div>
          <span className="loan-card-indicator" aria-hidden="true">
            Ver
          </span>
        </button>
      </div>
    )
  }
)

LoanSummaryCard.displayName = "LoanSummaryCard"

export default LoanSummaryCard
