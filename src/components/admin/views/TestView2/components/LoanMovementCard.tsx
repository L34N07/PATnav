import React, { forwardRef } from "react"
import { LoanMovementRow } from "../types"

type LoanMovementCardProps = {
  movement: LoanMovementRow
  isSelected: boolean
  onSelect: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
}

const LoanMovementCard = forwardRef<HTMLButtonElement, LoanMovementCardProps>(
  ({ movement, isSelected, onSelect, onKeyDown }, ref) => {
    const estadoRaw = movement.infoExtra
    const estadoCode = estadoRaw.trim().toUpperCase()
    const estadoValue = estadoRaw || "\u00A0"
    const estadoToneClass =
      estadoCode === "VD" ? "tone-vd" : estadoCode === "VP" ? "tone-vp" : ""
    const cardClassName = [
      "movement-card",
      estadoToneClass,
      isSelected ? "selected" : ""
    ]
      .filter(Boolean)
      .join(" ")
    const cantidadValue = movement.cantidadDisplay ?? movement.cantidad

    return (
      <button
        type="button"
        ref={ref}
        className={cardClassName}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <div className="movement-card-content">
          <div className="movement-card-group">
            <span className="movement-card-value">{movement.fechaRemito}</span>
          </div>
          <div className="movement-card-group">
            <span className="movement-card-value">{movement.numeroRemito}</span>
          </div>
          <div className="movement-card-group">
            <span className="movement-card-value">{movement.itemLabel}</span>
          </div>
          <div className="movement-card-group">
            <span className="movement-card-value">{cantidadValue}</span>
          </div>
        </div>
        <div className="movement-card-estado">
          <span className="movement-card-estado-value">{estadoValue}</span>
        </div>
      </button>
    )
  }
)

LoanMovementCard.displayName = "LoanMovementCard"

export default LoanMovementCard
