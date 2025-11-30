import React, { useEffect, useMemo, useRef, useState } from "react"
import { LoanMovementRow, LoanSummaryRow } from "../types"
import LoanMovementCard from "./LoanMovementCard"

const EXCLUDED_ESTADOS = new Set(["VP", "VD", "A", "P", "D"])
const MOVEMENT_NAVIGATION_COOLDOWN_MS = 60

type LoanSummaryModalProps = {
  row: LoanSummaryRow
  isOpen: boolean
  isLoadingMovements: boolean
  movementError: string | null
  movements: LoanMovementRow[] | undefined
  selectedMovementId: string | null
  selectedMovement: LoanMovementRow | null
  statusMessage: string | null
  errorMessage: string | null
  onSelectMovement: (movementId: string) => void
  onUpdateInfoExtra: (value: "A" | "P" | "D") => void
  infoExtraOptions: ReadonlyArray<"A" | "P" | "D">
  isInfoExtraUpdating: boolean
  isInfoExtraDisabled: boolean
  isNuevoStockUpdating: boolean
  onSaveNuevoStock: (value: number) => void
  onClose: () => void
}

const LoanSummaryModal: React.FC<LoanSummaryModalProps> = ({
  row,
  isOpen,
  isLoadingMovements,
  movementError,
  movements,
  selectedMovementId,
  selectedMovement,
  statusMessage,
  errorMessage,
  onSelectMovement,
  onUpdateInfoExtra,
  infoExtraOptions,
  isInfoExtraUpdating,
  isInfoExtraDisabled,
  isNuevoStockUpdating,
  onSaveNuevoStock,
  onClose
}) => {
  const clientIdentifier = row.SUBCODIGO ? `${row.CLIENTE}/${row.SUBCODIGO}` : `${row.CLIENTE}`
  const domicilioDisplay = row.DOMICILIO || "-"
  const summaryLabel = `Cliente ${clientIdentifier} - Domicilio ${
    row.DOMICILIO || "Sin domicilio"
  } - Comprobante ${row.COMPROBANTE} - Estado ${row.ESTADO}`
  const movementButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const autoSelectPendingRef = useRef(false)
  const hasUserInteractedRef = useRef(false)
  const lastNavigationTimeRef = useRef(0)
  const [nuevoStock, setNuevoStock] = useState<number | "">("")

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

    const positiveValues = displayMovements.map(movement => movement.cantidad).filter(value => value > 0)

    if (positiveValues.length === 0) {
      return null
    }

    const average = positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length
    const roundedAverage = Math.round(average)

    return roundedAverage.toLocaleString("es-AR")
  }, [displayMovements])

  useEffect(() => {
    movementButtonRefs.current.length = displayMovements?.length ?? 0
  }, [displayMovements])

  useEffect(() => {
    if (!selectedMovement) {
      setNuevoStock("")
      return
    }
    setNuevoStock(
      selectedMovement.nuevoStock !== undefined && selectedMovement.nuevoStock !== null
        ? selectedMovement.nuevoStock
        : 0
    )
  }, [selectedMovement])

  const handleSave = () => {
    if (nuevoStock === "") {
      onSaveNuevoStock(0)
      return
    }
    onSaveNuevoStock(Number(nuevoStock))
  }

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
      hasUserInteractedRef.current = true
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
    if (!isOpen) {
      autoSelectPendingRef.current = false
      hasUserInteractedRef.current = false
      return
    }

    if (isLoadingMovements || movementError) {
      return
    }

    if (!displayMovements || displayMovements.length === 0) {
      return
    }

    if (!selectedMovementId) {
      if (hasUserInteractedRef.current) {
        return
      }
      autoSelectPendingRef.current = true
      const firstMovement = displayMovements[0]
      onSelectMovement(firstMovement.id)
      requestAnimationFrame(() => {
        movementButtonRefs.current[0]?.focus()
      })
      return
    }

    if (autoSelectPendingRef.current) {
      const selectedIndex = displayMovements.findIndex(movement => movement.id === selectedMovementId)
      if (selectedIndex >= 0) {
        requestAnimationFrame(() => {
          movementButtonRefs.current[selectedIndex]?.focus()
        })
      }
      autoSelectPendingRef.current = false
    }
  }, [
    isOpen,
    isLoadingMovements,
    movementError,
    displayMovements,
    onSelectMovement,
    selectedMovementId
  ])

  return (
    <div
      className="loan-summary-modal"
      role="dialog"
      aria-modal="true"
      aria-label={summaryLabel}
      onClick={onClose}
    >
      <div className="loan-summary-modal__panel" onClick={event => event.stopPropagation()}>
        <div className="loan-summary-modal__header">
          <div className="loan-summary-modal__title-block">
            <span className="loan-summary-modal__eyebrow">Prestamos y devoluciones</span>
            <h3 className="loan-summary-modal__title">Cliente {clientIdentifier}</h3>
            <p className="loan-summary-modal__subtitle">{domicilioDisplay}</p>
          </div>
          <button className="loan-summary-modal__close" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="loan-summary-modal__summary-grid">
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Comprobante</span>
            <span className="loan-summary-modal__pill-value">{row.COMPROBANTE}</span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Estado</span>
            <span className="loan-summary-modal__pill-value">{row.ESTADO || "-"}</span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Cantidad total</span>
            <span className="loan-summary-modal__pill-value">
              {row.CANTIDAD.toLocaleString("es-AR")}
            </span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Fecha</span>
            <span className="loan-summary-modal__pill-value">{row.FECHA}</span>
          </div>
        </div>

        <div className="loan-summary-modal__body">
          {(statusMessage || errorMessage) && (
            <div className="loan-summary-modal__toast-container" aria-live="polite">
              <div
                className={`loan-summary-modal__toast ${errorMessage ? "error" : "success"}`}
                role="status"
              >
                {errorMessage || statusMessage}
              </div>
            </div>
          )}
          <div className="loan-summary-modal__body-header">
            <div className="loan-summary-modal__body-title">Resumen completo</div>
          </div>
          <div className="loan-summary-modal__content">
            <div className="loan-summary-modal__movements">
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
                        <div className="movement-card-nuevo-stock">
                          <span className="movement-card-label">Nuevo Stock</span>
                        </div>
                      </div>
                      {displayMovements.map((movement, index) => {
                        const handleMovementSelect = () => {
                          hasUserInteractedRef.current = true
                          onSelectMovement(movement.id)
                        }

                        return (
                          <LoanMovementCard
                            key={movement.id}
                            movement={movement}
                            isSelected={selectedMovementId === movement.id}
                            onSelect={handleMovementSelect}
                            onKeyDown={event => handleMovementKeyDown(event, index)}
                            ref={element => {
                              movementButtonRefs.current[index] = element
                            }}
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <div className="loan-movements-status">Sin movimientos recientes.</div>
                  )}
                </>
              )}
            </div>
            <aside className="loan-summary-modal__sidebar">
              <span className="loan-summary-modal__sidebar-title">Actualizar</span>
              <div className="loan-summary-modal__sidebar-buttons">
                {infoExtraOptions.map(option => (
                  <button
                    key={option}
                    type="button"
                    className="loan-summary-modal__sidebar-button"
                    onClick={() => onUpdateInfoExtra(option)}
                    disabled={isInfoExtraDisabled}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {isInfoExtraUpdating || isNuevoStockUpdating ? (
                <span className="loan-summary-modal__sidebar-status">Actualizando...</span>
              ) : null}
              <div className="loan-summary-modal__sidebar-divider" aria-hidden="true" />
              <label className="loan-summary-modal__sidebar-field">
                <span className="loan-summary-modal__sidebar-label">Nuevo stock</span>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="loan-summary-modal__sidebar-input"
                  value={nuevoStock}
                  onChange={event => {
                    const value = event.target.value
                    if (value === "") {
                      setNuevoStock("")
                      return
                    }
                    const parsed = Number.parseInt(value, 10)
                    if (!Number.isNaN(parsed)) {
                      setNuevoStock(parsed)
                    }
                  }}
                  aria-label="Nuevo stock"
                />
              </label>
              <button
                type="button"
                className="loan-summary-modal__sidebar-save"
                onClick={handleSave}
                disabled={!selectedMovementId || isNuevoStockUpdating}
              >
                Guardar
              </button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LoanSummaryModal
