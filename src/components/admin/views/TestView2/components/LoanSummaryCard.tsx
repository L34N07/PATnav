import React, { forwardRef, useEffect, useMemo, useRef } from "react"
import { LoanMovementRow, LoanSummaryRow } from "../types"
import LoanMovementCard from "./LoanMovementCard"

const EXCLUDED_ESTADOS = new Set(["VP", "VD", "A", "P", "D"])
// Throttle arrow-key navigation so holding a key does not skip over items
const MOVEMENT_NAVIGATION_COOLDOWN_MS = 60

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
    const clientIdentifier = row.SUBCODIGO
      ? `${row.CLIENTE}/${row.SUBCODIGO}`
      : `${row.CLIENTE}`
    const domicilioDisplay = row.DOMICILIO || "-"
    const summaryLabel = `Cliente ${clientIdentifier} - Domicilio ${
      row.DOMICILIO || "Sin domicilio"
    } - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`
    const movementButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
    const autoSelectPendingRef = useRef(false)
    const lastNavigationTimeRef = useRef(0)
    const displayMovements = useMemo(() => {
      if (!movements) {
        return undefined
      }

      const groups = new Map<string, LoanMovementRow[]>()
      const order: string[] = []

      movements.forEach(movement => {
        const key = `${movement.prefijoRemito}::${movement.numeroRemito}::${movement.tipoComprobante}`
        if (!groups.has(key)) {
          groups.set(key, [])
          order.push(key)
        }
        groups.get(key)!.push(movement)
      })

      const aggregatedMovements: LoanMovementRow[] = []

      order.forEach(key => {
        const group = groups.get(key)
        if (!group || group.length === 0) {
          return
        }

        const totalCantidad = group.reduce((sum, item) => sum + item.cantidad, 0)
        const hasEstadoValue = group.some(item => item.infoExtra.trim() !== "")
        const hasExcludedEstado = group.some(item =>
          EXCLUDED_ESTADOS.has(item.infoExtra.trim().toUpperCase())
        )

        if (hasEstadoValue) {
          if (hasExcludedEstado || totalCantidad !== 0) {
            aggregatedMovements.push(...group)
            return
          }

          const positiveMovement = group.reduce<LoanMovementRow | undefined>((current, item) => {
            if (item.cantidad <= 0) {
              return current
            }
            if (!current || item.cantidad > current.cantidad) {
              return item
            }
            return current
          }, undefined)

          aggregatedMovements.push(positiveMovement ?? group[0])
          return
        }

        if (totalCantidad !== 0) {
          const positiveTotal = group
            .filter(item => item.cantidad > 0)
            .reduce((sum, item) => sum + item.cantidad, 0)

          const negativeTotal = group
            .filter(item => item.cantidad < 0)
            .reduce((sum, item) => sum + item.cantidad, 0)

          const baseMovement = group.find(item => item.cantidad > 0) ?? group[0]
          const hasPositive = positiveTotal > 0
          const hasNegative = negativeTotal < 0
          const cantidadDisplay =
            hasPositive && hasNegative
              ? `${positiveTotal} x ${Math.abs(negativeTotal)} = ${totalCantidad}`
              : undefined

          aggregatedMovements.push({
            ...baseMovement,
            cantidad: totalCantidad,
            ...(cantidadDisplay ? { cantidadDisplay } : {})
          })
          return
        }

        const positiveMovement = group.reduce<LoanMovementRow | undefined>((current, item) => {
          if (item.cantidad <= 0) {
            return current
          }
          if (!current || item.cantidad > current.cantidad) {
            return item
          }
          return current
        }, undefined)

        aggregatedMovements.push(positiveMovement ?? group[0])
      })

      return aggregatedMovements
    }, [movements])

    const positiveAverageDisplay = useMemo(() => {
      if (!displayMovements || displayMovements.length === 0) {
        return null
      }

      const positiveValues = displayMovements
        .map(movement => movement.cantidad)
        .filter(value => value > 0)

      if (positiveValues.length === 0) {
        return null
      }

      const average =
        positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length
      const roundedAverage = Math.round(average)

      return roundedAverage.toLocaleString("es-AR")
    }, [displayMovements])

    useEffect(() => {
      movementButtonRefs.current.length = displayMovements?.length ?? 0
    }, [displayMovements])

    const handleMovementKeyDown = (
      event: React.KeyboardEvent<HTMLButtonElement>,
      index: number
    ) => {
      if (!displayMovements || displayMovements.length === 0) {
        return
      }

      const isDirectionalKey =
        event.key === "ArrowDown" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowLeft"

      const now =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()

      if (isDirectionalKey && event.repeat) {
        if (now - lastNavigationTimeRef.current < MOVEMENT_NAVIGATION_COOLDOWN_MS) {
          event.preventDefault()
          return
        }
      }

      let targetIndex: number | null = null
      let handled = false

      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          handled = true
          if (index < displayMovements.length - 1) {
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
          targetIndex = displayMovements.length - 1
          break
        default:
          break
      }

      if (handled) {
        event.preventDefault()
      }

      if (targetIndex !== null && targetIndex !== index) {
        lastNavigationTimeRef.current = now
        const targetMovement = displayMovements[targetIndex]
        onSelectMovement(targetMovement.id)
        requestAnimationFrame(() => {
          const targetButton = movementButtonRefs.current[targetIndex]
          targetButton?.focus()
          targetButton?.scrollIntoView({ block: "nearest" })
        })
      } else if (isDirectionalKey && !event.repeat) {
        lastNavigationTimeRef.current = now
      }
    }

    useEffect(() => {
      if (!isExpanded) {
        autoSelectPendingRef.current = false
        return
      }

      if (isLoadingMovements || movementError) {
        return
      }

      if (!displayMovements || displayMovements.length === 0) {
        return
      }

      if (!selectedMovementId) {
        autoSelectPendingRef.current = true
        const firstMovement = displayMovements[0]
        onSelectMovement(firstMovement.id)
        requestAnimationFrame(() => {
          movementButtonRefs.current[0]?.focus()
        })
        return
      }

      if (autoSelectPendingRef.current) {
        const selectedIndex = displayMovements.findIndex(
          movement => movement.id === selectedMovementId
        )
        if (selectedIndex >= 0) {
          requestAnimationFrame(() => {
            movementButtonRefs.current[selectedIndex]?.focus()
          })
        }
        autoSelectPendingRef.current = false
      }
    }, [
      isExpanded,
      isLoadingMovements,
      movementError,
      displayMovements,
      onSelectMovement,
      selectedMovementId
    ])

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
            {isExpanded ? "-" : "+"}
          </span>
        </button>
        <div className="loan-card-body" aria-hidden={!isExpanded}>
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
                  {displayMovements && displayMovements.length > 0 ? (
                    <div className="movement-card-grid">
                      <div className="movement-card movement-card--header" aria-hidden="true">
                        <div className="movement-card-content">
                          <div className="movement-card-group">
                            <span className="movement-card-label">Fecha</span>
                          </div>
                          <div className="movement-card-group">
                            <span className="movement-card-label">Remito</span>
                          </div>
                          <div className="movement-card-group">
                            <span className="movement-card-label">Item</span>
                          </div>
                          <div className="movement-card-group">
                            <span className="movement-card-label">
                              Cantidad
                              {positiveAverageDisplay ? ` \u2248 ${positiveAverageDisplay}` : ""}
                            </span>
                          </div>
                        </div>
                        <div className="movement-card-estado">
                          <span className="movement-card-label">Estado</span>
                        </div>
                      </div>
                      {displayMovements.map((movement, index) => (
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
