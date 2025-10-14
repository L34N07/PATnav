import React from "react"
import { LoanMovementRow, LoanSummaryRow } from "../types"
import LoanMovementCard from "./LoanMovementCard"

type LoanSummaryCardProps = {
  row: LoanSummaryRow
  isExpanded: boolean
  isLoadingMovements: boolean
  movementError: string | null
  movements: LoanMovementRow[] | undefined
  selectedMovementId: string | null
  onToggle: () => void
  onSelectMovement: (movementId: string) => void
}

export default function LoanSummaryCard({
  row,
  isExpanded,
  isLoadingMovements,
  movementError,
  movements,
  selectedMovementId,
  onToggle,
  onSelectMovement
}: LoanSummaryCardProps) {
  const summaryLabel = `Cliente ${row.CLIENTE} - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`

  return (
    <div className={`loan-card ${isExpanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="loan-card-header"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span>{summaryLabel}</span>
        <span className="loan-card-indicator" aria-hidden="true">
          {isExpanded ? "-" : "+"}
        </span>
      </button>
      <div className="loan-card-body" aria-hidden={!isExpanded}>
        <div className="loan-card-details">
          <span><strong>Cliente:</strong> {row.CLIENTE}</span>
          <span><strong>Comprobante:</strong> {row.COMPROBANTE}</span>
          <span><strong>Estado:</strong> {row.ESTADO}</span>
          <span><strong>Cantidad:</strong> {row.CANTIDAD}</span>
          <span><strong>Fecha:</strong> {row.FECHA}</span>
        </div>
        {isExpanded && (
          <div className="loan-card-movements">
            {isLoadingMovements && (
              <div className="loan-movements-status">Cargando movimientos...</div>
            )}
            {!isLoadingMovements && movementError && (
              <div className="loan-movements-status error">{movementError}</div>
            )}
            {!isLoadingMovements && !movementError && (
              <>
                {movements && movements.length > 0 ? (
                  <div className="movement-card-grid">
                    {movements.map(movement => (
                      <LoanMovementCard
                        key={movement.id}
                        movement={movement}
                        isSelected={selectedMovementId === movement.id}
                        onSelect={() => onSelectMovement(movement.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="loan-movements-status">Sin movimientos recientes.</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
