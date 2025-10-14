import React from "react"

type TestViewActionPanelProps = {
  isLoading: boolean
  onFetchClients: () => void
  onFetchIrregularidades: () => void
}

export default function TestViewActionPanel({
  isLoading,
  onFetchClients,
  onFetchIrregularidades
}: TestViewActionPanelProps) {
  return (
    <aside className="sidebar loan-actions">
      <div className="loan-actions__button-group">
        <span className="loan-actions__section-title">Acciones</span>
        <button
          className="fetch-button"
          type="button"
          onClick={onFetchClients}
          disabled={isLoading}
        >
          Traer Clientes
        </button>
        <button
          className="fetch-button irregularidades-button"
          type="button"
          onClick={onFetchIrregularidades}
          disabled={isLoading}
        >
          Actualizar pagos e Irregularidades
        </button>
        {isLoading ? (
          <span className="loan-actions__loading">Procesando...</span>
        ) : null}
      </div>
    </aside>
  )
}

