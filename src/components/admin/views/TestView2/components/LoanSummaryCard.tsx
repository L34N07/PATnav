import React, { forwardRef, useRef } from "react"
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

const LoanSummaryCard = forwardRef<HTMLDivElement, LoanSummaryCardProps>(
  (
    {
      row,
      isExpanded,
      isLoadingMovements,
      movementError,
      movements,
      selectedMovementId,
      onToggle,
      onSelectMovement
    },
    ref
  ) => {
    const summaryLabel = `Cliente ${row.CLIENTE} - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`
    const movementButtonRefs = useRef<Array<HTMLButtonElement | null>>([])

    const handleMovementKeyDown = (
      event: React.KeyboardEvent<HTMLButtonElement>,
      index: number
    ) => {
      if (!movements || movements.length === 0) {
        return
      }

      let targetIndex: number | null = null
      let handled = false

      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          handled = true
          if (index < movements.length - 1) {
            targetIndex = index + 1
          }
          break
        case "ArrowUp":
        case "ArrowLeft":
          handled = true
          if (index > 0) {
            targetIndex = index - 1
          }
          break
        case "Home":
          handled = true
          targetIndex = 0
          break
        case "End":
          handled = true
          targetIndex = movements.length - 1
          break
        default:
          break
      }

      if (handled) {
        event.preventDefault()
      }

      if (targetIndex !== null && targetIndex !== index) {
        const targetMovement = movements[targetIndex]
        onSelectMovement(targetMovement.id)
        requestAnimationFrame(() => {
          movementButtonRefs.current[targetIndex]?.focus()
        })
      }
    }

    return (
      <div ref={ref} className={`loan-card ${isExpanded ? "expanded" : ""}`}>
        <button
          type="button"
          className="loan-card-header"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={summaryLabel}
        >
          <div className="loan-card-header-info">
            <span className="loan-card-header-item">
              <strong>Cliente:</strong> {row.CLIENTE}
            </span>
            <span className="loan-card-header-item">
              <strong>Comprobante:</strong> {row.COMPROBANTE}
            </span>
            <span className="loan-card-header-item">
              <strong>Estado:</strong> {row.ESTADO}
            </span>
          </div>
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
                      {movements.map((movement, index) => (
                        <LoanMovementCard
                          key={movement.id}
                          movement={movement}
                          isSelected={selectedMovementId === movement.id}
                          onSelect={() => onSelectMovement(movement.id)}
                          onKeyDown={event => handleMovementKeyDown(event, index)}
                          ref={element => {
                            movementButtonRefs.current[index] = element
                          }}
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
)

LoanSummaryCard.displayName = "LoanSummaryCard"

export default LoanSummaryCard
