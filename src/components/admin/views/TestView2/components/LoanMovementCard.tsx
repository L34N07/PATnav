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

  return (
    <button
      type="button"
      className={cardClassName}
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
      <div className="movement-card-estado">
        <span className="movement-card-label">Estado</span>
        <span className="movement-card-estado-value">{estadoValue}</span>
      </div>
    </button>
  )
}
