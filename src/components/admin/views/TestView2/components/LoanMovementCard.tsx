import React from "react"
import { LoanMovementRow } from "../types"

type LoanMovementCardProps = {
  movement: LoanMovementRow
  isSelected: boolean
  onSelect: () => void
}

export default function LoanMovementCard({
  movement,
  isSelected,
  onSelect
}: LoanMovementCardProps) {
  return (
    <button
      type="button"
      className={`movement-card ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="movement-card-content">
        <div className="movement-card-group">
          <span className="movement-card-label">Fecha</span>
          <span className="movement-card-value">{movement.fechaRemito}</span>
        </div>
        <div className="movement-card-group">
          <span className="movement-card-label">Remito</span>
          <span className="movement-card-value">{movement.numeroRemito}</span>
        </div>
        <div className="movement-card-group">
          <span className="movement-card-label">Item</span>
          <span className="movement-card-value">{movement.itemLabel}</span>
        </div>
        <div className="movement-card-group">
          <span className="movement-card-label">Cantidad</span>
          <span className="movement-card-value">{movement.cantidad}</span>
        </div>
      </div>
      {movement.infoExtra && (
        <div className="movement-card-extra">
          <span className="movement-card-label">Info Extra</span>
          <span className="movement-card-extra-value">{movement.infoExtra}</span>
        </div>
      )}
    </button>
  )
}
