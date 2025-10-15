import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoanMovementRow, LoanSummaryRow } from "../types"
import LoanMovementCard from "./LoanMovementCard"

const EXCLUDED_ESTADOS = new Set(["VP", "VD", "A", "P", "D"])
// Throttle arrow-key navigation so holding a key does not skip over items
const MOVEMENT_NAVIGATION_COOLDOWN_MS = 100
const MOVEMENT_VIRTUAL_WINDOW = 250
const MOVEMENT_VIRTUAL_SHIFT = 100

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
    const movementGridRef = useRef<HTMLDivElement | null>(null)
    const [virtualWindowStart, setVirtualWindowStart] = useState(0)
    const [estimatedItemHeight, setEstimatedItemHeight] = useState<number | null>(null)
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

    const totalMovements = displayMovements?.length ?? 0
    const virtualizationEnabled = totalMovements > MOVEMENT_VIRTUAL_WINDOW
    const maxVirtualStart = Math.max(0, totalMovements - MOVEMENT_VIRTUAL_WINDOW)
    const windowStart = virtualizationEnabled
      ? Math.max(0, Math.min(virtualWindowStart, maxVirtualStart))
      : 0
    const windowSize = virtualizationEnabled ? Math.min(MOVEMENT_VIRTUAL_WINDOW, totalMovements) : totalMovements
    const windowEnd = virtualizationEnabled ? Math.min(windowStart + windowSize, totalMovements) : totalMovements
    const visibleMovements = virtualizationEnabled
      ? displayMovements?.slice(windowStart, windowEnd)
      : displayMovements
    const topSpacerHeight =
      virtualizationEnabled && estimatedItemHeight
        ? windowStart * estimatedItemHeight
        : 0
    const bottomSpacerHeight =
      virtualizationEnabled && estimatedItemHeight
        ? (totalMovements - windowEnd) * estimatedItemHeight
        : 0

    const updateVirtualWindowStart = useCallback(
      (nextStart: number | ((current: number) => number)) => {
        setVirtualWindowStart(prev => {
          if (!virtualizationEnabled) {
            return 0
          }
          const resolved = typeof nextStart === "function" ? nextStart(prev) : nextStart
          const clamped = Math.max(0, Math.min(resolved, maxVirtualStart))
          return clamped === prev ? prev : clamped
        })
      },
      [virtualizationEnabled, maxVirtualStart]
    )

    useEffect(() => {
      if (!virtualizationEnabled && estimatedItemHeight !== null) {
        setEstimatedItemHeight(null)
      }
    }, [virtualizationEnabled, estimatedItemHeight])

    useEffect(() => {
      if (!virtualizationEnabled && virtualWindowStart !== 0) {
        setVirtualWindowStart(0)
      } else if (virtualizationEnabled && virtualWindowStart > maxVirtualStart) {
        setVirtualWindowStart(maxVirtualStart)
      }
    }, [virtualizationEnabled, virtualWindowStart, maxVirtualStart])

    useEffect(() => {
      if (!isExpanded) {
        setVirtualWindowStart(0)
      }
    }, [isExpanded])

    useEffect(() => {
      if (!virtualizationEnabled || !visibleMovements || visibleMovements.length === 0) {
        return
      }
      const firstIndex = windowStart
      const firstButton = movementButtonRefs.current[firstIndex]
      const nextButton =
        windowEnd - windowStart > 1 ? movementButtonRefs.current[firstIndex + 1] : null

      let measurement: number | null = null
      if (firstButton && nextButton) {
        const firstRect = firstButton.getBoundingClientRect()
        const nextRect = nextButton.getBoundingClientRect()
        measurement = Math.abs(nextRect.top - firstRect.top)
      } else if (firstButton) {
        const rect = firstButton.getBoundingClientRect()
        measurement = rect.height
      }

      if (
        measurement &&
        measurement > 0 &&
        (estimatedItemHeight === null || Math.abs(estimatedItemHeight - measurement) > 0.5)
      ) {
        setEstimatedItemHeight(measurement)
      }
    }, [virtualizationEnabled, visibleMovements, windowStart, windowEnd, estimatedItemHeight])

    const ensureMovementVisible = useCallback(
      (targetIndex: number) => {
        if (!virtualizationEnabled) {
          return
        }
        const effectiveWindowSize = Math.min(MOVEMENT_VIRTUAL_WINDOW, totalMovements)
        if (effectiveWindowSize <= 0) {
          return
        }
        const windowEndIndex = Math.min(windowStart + effectiveWindowSize, totalMovements)

        if (targetIndex < windowStart) {
          updateVirtualWindowStart(targetIndex)
          return
        }

        if (targetIndex >= windowEndIndex) {
          updateVirtualWindowStart(targetIndex - effectiveWindowSize + 1)
          return
        }

        if (targetIndex <= windowStart + MOVEMENT_VIRTUAL_SHIFT && windowStart > 0) {
          updateVirtualWindowStart(windowStart - MOVEMENT_VIRTUAL_SHIFT)
        } else if (
          targetIndex >= windowEndIndex - MOVEMENT_VIRTUAL_SHIFT &&
          windowEndIndex < totalMovements
        ) {
          updateVirtualWindowStart(windowStart + MOVEMENT_VIRTUAL_SHIFT)
        }
      },
      [virtualizationEnabled, totalMovements, windowStart, updateVirtualWindowStart]
    )

    const syncWindowToViewport = useCallback(() => {
      if (
        typeof window === "undefined" ||
        !virtualizationEnabled ||
        !movementGridRef.current ||
        !estimatedItemHeight ||
        estimatedItemHeight <= 0
      ) {
        return
      }

      const container = movementGridRef.current
      const containerRect = container.getBoundingClientRect()
      const viewportTop =
        window.scrollY ??
        window.pageYOffset ??
        (typeof document !== "undefined" ? document.documentElement?.scrollTop ?? 0 : 0)
      const containerTop = viewportTop + containerRect.top
      const visibleTopWithin = Math.max(0, viewportTop - containerTop)
      const viewportBottom = viewportTop + window.innerHeight
      const visibleBottomWithin = Math.min(
        Math.max(0, viewportBottom - containerTop),
        containerRect.height
      )
      const visibleRange =
        visibleBottomWithin > visibleTopWithin
          ? visibleBottomWithin - visibleTopWithin
          : 0
      const anchorPosition =
        visibleRange > 0 ? visibleTopWithin + visibleRange / 2 : visibleTopWithin
      const targetStart =
        Math.floor(anchorPosition / estimatedItemHeight) - MOVEMENT_VIRTUAL_SHIFT

      updateVirtualWindowStart(targetStart)
    }, [
      virtualizationEnabled,
      movementGridRef,
      estimatedItemHeight,
      updateVirtualWindowStart
    ])

    useEffect(() => {
      if (!virtualizationEnabled || !displayMovements || !selectedMovementId) {
        return
      }
      const selectedIndex = displayMovements.findIndex(
        movement => movement.id === selectedMovementId
      )
      if (selectedIndex >= 0) {
        ensureMovementVisible(selectedIndex)
      }
    }, [virtualizationEnabled, displayMovements, selectedMovementId, ensureMovementVisible])

    useEffect(() => {
      if (
        typeof window === "undefined" ||
        !isExpanded ||
        !virtualizationEnabled ||
        !estimatedItemHeight ||
        estimatedItemHeight <= 0
      ) {
        return
      }

      let rafId: number | null = null
      const handle = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
        rafId = requestAnimationFrame(() => {
          syncWindowToViewport()
        })
      }

      handle()
      window.addEventListener("scroll", handle, { passive: true })
      window.addEventListener("resize", handle)

      return () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
        window.removeEventListener("scroll", handle)
        window.removeEventListener("resize", handle)
      }
    }, [isExpanded, virtualizationEnabled, estimatedItemHeight, syncWindowToViewport])

    useEffect(() => {
      movementButtonRefs.current.length = totalMovements
    }, [totalMovements])

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
        ensureMovementVisible(targetIndex)
        lastNavigationTimeRef.current = now
        const targetMovement = displayMovements[targetIndex]
        onSelectMovement(targetMovement.id)
        requestAnimationFrame(() => {
          const targetButton = movementButtonRefs.current[targetIndex]
          targetButton?.focus()
          targetButton?.scrollIntoView({ block: "nearest" })
        })
      } else if (isDirectionalKey && !event.repeat) {
        ensureMovementVisible(index)
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
        ensureMovementVisible(0)
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
          ensureMovementVisible(selectedIndex)
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
      selectedMovementId,
      ensureMovementVisible
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
                    <div className="movement-card-grid" ref={movementGridRef}>
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
                      {virtualizationEnabled && topSpacerHeight > 0 && (
                        <div
                          className="movement-card-spacer"
                          aria-hidden="true"
                          style={{ height: `${topSpacerHeight}px`, gridColumn: "1 / -1" }}
                        />
                      )}
                      {(visibleMovements ?? []).map((movement, index) => {
                        const globalIndex = windowStart + index
                        return (
                          <LoanMovementCard
                            key={movement.id}
                            movement={movement}
                            isSelected={selectedMovementId === movement.id}
                            onSelect={() => onSelectMovement(movement.id)}
                            onKeyDown={event => handleMovementKeyDown(event, globalIndex)}
                            ref={element => {
                              movementButtonRefs.current[globalIndex] = element
                            }}
                          />
                        )
                      })}
                      {virtualizationEnabled && bottomSpacerHeight > 0 && (
                        <div
                          className="movement-card-spacer"
                          aria-hidden="true"
                          style={{ height: `${bottomSpacerHeight}px`, gridColumn: "1 / -1" }}
                        />
                      )}
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
