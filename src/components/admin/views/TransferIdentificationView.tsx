import React, { useCallback, useEffect, useMemo, useState } from "react"
import type {
  AssignTransferenciaAccountResult,
  TransferAddressCandidate,
  TransferAddressCandidatesResult,
  UnidentifiedTransferenciaResult,
  UnidentifiedTransferenciasResult
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

const STATUS_DURATION_MS = 4000
const MAX_SUGGESTIONS = 12

const normalizeSearchText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")

const toDisplayValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return ""
  }
  return String(value).trim()
}

const formatAmount = (value: string) => {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)
    : value
}

const formatDate = (transfer: UnidentifiedTransferenciaResult) =>
  transfer.fecha_display || toDisplayValue(transfer.fecha).replace("T", " ")

const buildAddressLabel = (candidate: TransferAddressCandidate) => {
  const address = toDisplayValue(candidate.direccion)
  if (address) {
    return address
  }

  return [
    candidate.calle,
    candidate.numeropuerta,
    candidate.observ_domicilio,
    candidate.observ_domicilio_2,
    candidate.municipio
  ]
    .map(toDisplayValue)
    .filter(Boolean)
    .join(" ")
}

const buildCandidateSearchText = (candidate: TransferAddressCandidate) =>
  [
    candidate.direccion,
    candidate.calle,
    candidate.numeropuerta,
    candidate.observ_domicilio,
    candidate.observ_domicilio_2,
    candidate.municipio,
    candidate.razon_social,
    candidate.domicilio_fiscal
  ]
    .map(toDisplayValue)
    .filter(Boolean)
    .join(" ")

type AssignmentModalProps = {
  transfer: UnidentifiedTransferenciaResult
  addresses: TransferAddressCandidate[]
  isAssigning: boolean
  onCancel: () => void
  onAssign: (candidate: TransferAddressCandidate) => void
}

function AssignmentModal({
  transfer,
  addresses,
  isAssigning,
  onCancel,
  onAssign
}: AssignmentModalProps) {
  const [query, setQuery] = useState("")
  const [selectedCandidate, setSelectedCandidate] = useState<TransferAddressCandidate | null>(null)

  const suggestions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) {
      return []
    }

    return addresses
      .map(candidate => {
        const searchText = normalizeSearchText(buildCandidateSearchText(candidate))
        const index = searchText.indexOf(normalizedQuery)
        return { candidate, index }
      })
      .filter(match => match.index >= 0)
      .sort((left, right) => left.index - right.index)
      .slice(0, MAX_SUGGESTIONS)
      .map(match => match.candidate)
  }, [addresses, query])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setSelectedCandidate(null)
  }

  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <div className="image-modal__panel transfer-assign-modal">
        <div className="image-modal__header">
          <div>
            <h3 className="image-modal__title">Identificar transferencia</h3>
            <p className="transfer-assign-modal__intro">
              {transfer.nombre_asociado || "Sin nombre"} - {formatAmount(transfer.monto)}
            </p>
          </div>
          <button
            className="image-modal__close action-button--neutral"
            type="button"
            onClick={onCancel}
            disabled={isAssigning}
          >
            Cerrar
          </button>
        </div>

        <div className="transfer-assign-modal__summary">
          <span>{transfer.cvu_cbu}</span>
          <span>{formatDate(transfer)}</span>
          {Number(transfer.transferencias_mismo_cvu ?? 0) > 1 ? (
            <span>{transfer.transferencias_mismo_cvu} transferencias con este CBU/CVU</span>
          ) : null}
        </div>

        <label className="transfer-assign-modal__search">
          <span>Buscar domicilio</span>
          <input
            value={query}
            onChange={event => handleQueryChange(event.target.value)}
            placeholder="Escriba calle, numero, barrio, observacion..."
            autoFocus
            disabled={isAssigning}
          />
        </label>

        <div className="transfer-assign-modal__suggestions">
          {suggestions.length > 0 ? (
            suggestions.map(candidate => {
              const isSelected =
                selectedCandidate?.cod_cliente === candidate.cod_cliente &&
                selectedCandidate?.nro_lugar_entrega === candidate.nro_lugar_entrega
              return (
                <button
                  key={`${candidate.cod_cliente}-${candidate.nro_lugar_entrega}`}
                  className={`transfer-address-suggestion${isSelected ? " selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedCandidate(candidate)}
                  disabled={isAssigning}
                >
                  <span className="transfer-address-suggestion__address">
                    {buildAddressLabel(candidate) || "Sin domicilio"}
                  </span>
                  <span className="transfer-address-suggestion__meta">
                    {toDisplayValue(candidate.razon_social) || "Sin razon social"}
                  </span>
                </button>
              )
            })
          ) : (
            <div className="transfer-assign-modal__empty">
              {query.trim()
                ? "No se encontraron domicilios con esa busqueda."
                : "Escriba para buscar domicilios."}
            </div>
          )}
        </div>

        <div className="duplicate-transfer-modal__actions">
          <button
            className="image-modal__close"
            type="button"
            onClick={onCancel}
            disabled={isAssigning}
          >
            Cancelar
          </button>
          <button
            className="fetch-button action-button--confirm"
            type="button"
            onClick={() => selectedCandidate && onAssign(selectedCandidate)}
            disabled={!selectedCandidate || isAssigning}
          >
            {isAssigning ? "Asignando..." : "Asignar"}
          </button>
        </div>
      </div>
    </div>
  )
}

type IdentifiedDetailsModalProps = {
  transfer: UnidentifiedTransferenciaResult
  onCancel: () => void
}

function IdentifiedDetailsModal({ transfer, onCancel }: IdentifiedDetailsModalProps) {
  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <div className="image-modal__panel transfer-identified-modal">
        <div className="image-modal__header">
          <div>
            <h3 className="image-modal__title">Transferencia identificada</h3>
            <p className="transfer-assign-modal__intro">
              {transfer.nombre_asociado || "Sin nombre"} - {formatAmount(transfer.monto)}
            </p>
          </div>
        </div>

        <div className="transfer-identified-modal__blank">
          La informacion del usuario se agregara aca mas adelante.
        </div>

        <div className="duplicate-transfer-modal__actions">
          <button
            className="image-modal__close action-button--neutral"
            type="button"
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

type TransferIdentificationViewProps = {
  isAdmin?: boolean
}

type TransferIdentificationMode = "unidentified" | "identified"

export default function TransferIdentificationView({
  isAdmin = false
}: TransferIdentificationViewProps) {
  const electronAPI = window.electronAPI
  const [activeMode, setActiveMode] = useState<TransferIdentificationMode>("unidentified")
  const [transfers, setTransfers] = useState<UnidentifiedTransferenciaResult[]>([])
  const [identifiedTransfers, setIdentifiedTransfers] = useState<UnidentifiedTransferenciaResult[]>([])
  const [addresses, setAddresses] = useState<TransferAddressCandidate[]>([])
  const [selectedTransfer, setSelectedTransfer] = useState<UnidentifiedTransferenciaResult | null>(null)
  const [selectedIdentifiedTransfer, setSelectedIdentifiedTransfer] =
    useState<UnidentifiedTransferenciaResult | null>(null)
  const [assignmentTransfer, setAssignmentTransfer] = useState<UnidentifiedTransferenciaResult | null>(null)
  const [identifiedDetailsTransfer, setIdentifiedDetailsTransfer] =
    useState<UnidentifiedTransferenciaResult | null>(null)
  const [isLoadingTransfers, setIsLoadingTransfers] = useState(false)
  const [isLoadingIdentifiedTransfers, setIsLoadingIdentifiedTransfers] = useState(false)
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_DURATION_MS)

  const loadTransfers = useCallback(async () => {
    if (!electronAPI?.listUnidentifiedTransferencias) {
      setErrorMessage("No se encuentra disponible la lista de transferencias.")
      return
    }

    setIsLoadingTransfers(true)
    try {
      const result: UnidentifiedTransferenciasResult =
        await electronAPI.listUnidentifiedTransferencias()
      if (result.error) {
        throw new Error(result.details || result.error)
      }
      setTransfers(result.rows ?? [])
    } catch (error) {
      console.error("No se pudieron cargar las transferencias sin identificar:", error)
      setTransfers([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al cargar transferencias."
      )
    } finally {
      setIsLoadingTransfers(false)
    }
  }, [electronAPI])

  const loadIdentifiedTransfers = useCallback(async () => {
    if (!electronAPI?.listIdentifiedTransferencias) {
      setErrorMessage("No se encuentra disponible la lista de transferencias identificadas.")
      return
    }

    setIsLoadingIdentifiedTransfers(true)
    try {
      const result: UnidentifiedTransferenciasResult =
        await electronAPI.listIdentifiedTransferencias()
      if (result.error) {
        throw new Error(result.details || result.error)
      }
      setIdentifiedTransfers(result.rows ?? [])
    } catch (error) {
      console.error("No se pudieron cargar las transferencias identificadas:", error)
      setIdentifiedTransfers([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al cargar transferencias identificadas."
      )
    } finally {
      setIsLoadingIdentifiedTransfers(false)
    }
  }, [electronAPI])

  const loadAddresses = useCallback(async () => {
    if (!electronAPI?.listTransferAddressCandidates) {
      setErrorMessage("No se encuentra disponible la lista de domicilios.")
      return
    }

    setIsLoadingAddresses(true)
    try {
      const result: TransferAddressCandidatesResult =
        await electronAPI.listTransferAddressCandidates()
      if (result.error) {
        throw new Error(result.details || result.error)
      }
      setAddresses(result.rows ?? [])
    } catch (error) {
      console.error("No se pudieron cargar los domicilios:", error)
      setAddresses([])
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al cargar domicilios."
      )
    } finally {
      setIsLoadingAddresses(false)
    }
  }, [electronAPI])

  useEffect(() => {
    void loadTransfers()
    void loadAddresses()
  }, [loadAddresses, loadTransfers])

  useEffect(() => {
    if (!isAdmin && activeMode !== "unidentified") {
      setActiveMode("unidentified")
    }
  }, [activeMode, isAdmin])

  const handleAssign = useCallback(
    async (candidate: TransferAddressCandidate) => {
      if (!assignmentTransfer || !electronAPI?.assignTransferenciaAccount) {
        return
      }

      setIsAssigning(true)
      setErrorMessage(null)

      try {
        const result: AssignTransferenciaAccountResult =
          await electronAPI.assignTransferenciaAccount({
            cvuCbu: assignmentTransfer.cvu_cbu,
            codCliente: candidate.cod_cliente,
            nroLugarEntrega: candidate.nro_lugar_entrega
          })
        if (result.error) {
          throw new Error(result.details || result.error)
        }

        const updatedCount = result.updated_transferencias ?? 0
        setTransfers(prev =>
          prev.filter(transfer => transfer.cvu_cbu !== assignmentTransfer.cvu_cbu)
        )
        setIdentifiedTransfers([])
        setSelectedTransfer(null)
        setAssignmentTransfer(null)
        setStatusMessage(
          `${updatedCount} transferencia${updatedCount === 1 ? "" : "s"} asignada${updatedCount === 1 ? "" : "s"}.`
        )
        void loadTransfers()
      } catch (error) {
        console.error("No se pudo asignar la transferencia:", error)
        setErrorMessage(
          error instanceof Error ? error.message : "Error desconocido al asignar transferencia."
        )
      } finally {
        setIsAssigning(false)
      }
    },
    [assignmentTransfer, electronAPI, loadTransfers]
  )

  const openAssignmentModal = useCallback((transfer: UnidentifiedTransferenciaResult | null) => {
    if (!transfer) {
      setErrorMessage("Seleccione una transferencia.")
      return
    }
    setSelectedTransfer(transfer)
    setAssignmentTransfer(transfer)
  }, [])

  const handleModeChange = useCallback(
    (mode: TransferIdentificationMode) => {
      setActiveMode(mode)
      setSelectedTransfer(null)
      setSelectedIdentifiedTransfer(null)
      setAssignmentTransfer(null)
      setIdentifiedDetailsTransfer(null)

      if (mode === "unidentified") {
        void loadTransfers()
      } else {
        void loadIdentifiedTransfers()
      }
    },
    [loadIdentifiedTransfers, loadTransfers]
  )

  const handleRefresh = useCallback(() => {
    if (activeMode === "identified") {
      void loadIdentifiedTransfers()
      return
    }
    void loadTransfers()
  }, [activeMode, loadIdentifiedTransfers, loadTransfers])

  const openIdentifiedDetailsModal = useCallback((transfer: UnidentifiedTransferenciaResult) => {
    setSelectedIdentifiedTransfer(transfer)
    setIdentifiedDetailsTransfer(transfer)
  }, [])

  const isLoadingActiveTransfers =
    activeMode === "identified" ? isLoadingIdentifiedTransfers : isLoadingTransfers

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content test-view2-layout transfer-identification-layout">
        <div className="table-container loan-summary-panel">
          {isLoadingAddresses ? (
            <div className="table-status info">Cargando domicilios en segundo plano...</div>
          ) : null}
          {isLoadingActiveTransfers ? (
            <div className="table-status loading">Cargando transferencias...</div>
          ) : null}

          <div className="loan-cards">
            {activeMode === "unidentified" && transfers.length > 0 ? (
              transfers.map(transfer => {
                const isSelected = selectedTransfer?.id_transferencia === transfer.id_transferencia
                return (
                  <div
                    key={transfer.id_transferencia}
                    className={`loan-card transfer-identification-card transfer-identification-card--identified${isSelected ? " expanded" : ""}`}
                  >
                    <button
                      type="button"
                      className="loan-card-header"
                      onClick={() => setSelectedTransfer(transfer)}
                      onDoubleClick={() => openAssignmentModal(transfer)}
                    >
                      <div className="loan-card-header-info">
                        <span className="loan-card-header-item">
                          <strong>Titular:</strong> {transfer.nombre_asociado || "Sin nombre"}
                        </span>
                        <span className="loan-card-header-item loan-card-header-item--numeric">
                          <strong>Monto:</strong> {formatAmount(transfer.monto)}
                        </span>
                        <span className="loan-card-header-item">
                          <strong>Fecha:</strong> {formatDate(transfer)}
                        </span>
                        <span className="loan-card-header-item transfer-identification-card__account">
                          <strong>CBU/CVU:</strong> {transfer.cvu_cbu}
                        </span>
                        {Number(transfer.transferencias_mismo_cvu ?? 0) > 1 ? (
                          <span className="loan-card-header-item">
                            <strong>Mismo CBU/CVU:</strong> {transfer.transferencias_mismo_cvu}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="loan-card-indicator transfer-identification-card__assign"
                      onClick={() => openAssignmentModal(transfer)}
                    >
                      Asignar
                    </button>
                  </div>
                )
              })
            ) : activeMode === "identified" && identifiedTransfers.length > 0 ? (
              identifiedTransfers.map(transfer => {
                const isSelected =
                  selectedIdentifiedTransfer?.id_transferencia === transfer.id_transferencia
                return (
                  <div
                    key={transfer.id_transferencia}
                    className={`loan-card transfer-identification-card${isSelected ? " expanded" : ""}`}
                  >
                    <button
                      type="button"
                      className="loan-card-header"
                      onClick={() => openIdentifiedDetailsModal(transfer)}
                    >
                      <div className="loan-card-header-info">
                        <span className="loan-card-header-item">
                          <strong>Titular:</strong> {transfer.nombre_asociado || "Sin nombre"}
                        </span>
                        <span className="loan-card-header-item loan-card-header-item--numeric">
                          <strong>Monto:</strong> {formatAmount(transfer.monto)}
                        </span>
                        <span className="loan-card-header-item">
                          <strong>Fecha:</strong> {formatDate(transfer)}
                        </span>
                        <span className="loan-card-header-item">
                          <strong>Asignada a:</strong>{" "}
                          {toDisplayValue(transfer.razon_social) ||
                            "Cliente identificado"}
                        </span>
                        <span className="loan-card-header-item transfer-identification-card__address">
                          <strong>Domicilio:</strong>{" "}
                          {toDisplayValue(transfer.direccion) || "Sin domicilio cargado"}
                        </span>
                      </div>
                    </button>
                  </div>
                )
              })
            ) : (
              <div className="loan-empty-state">
                {isLoadingActiveTransfers
                  ? "Cargando transferencias..."
                  : activeMode === "identified"
                    ? "No hay transferencias identificadas."
                    : "No hay transferencias sin identificar."}
              </div>
            )}
          </div>
        </div>

        <aside className="sidebar loan-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            {isAdmin ? (
              <div className="transfer-identification-mode-toggle">
                <button
                  type="button"
                  className={`fetch-button${activeMode === "unidentified" ? " fetch-button--active" : ""}`}
                  onClick={() => handleModeChange("unidentified")}
                  disabled={isAssigning}
                >
                  SIN IDENTIFICAR
                </button>
                <button
                  type="button"
                  className={`fetch-button${activeMode === "identified" ? " fetch-button--active" : ""}`}
                  onClick={() => handleModeChange("identified")}
                  disabled={isAssigning}
                >
                  IDENTIFICADAS
                </button>
              </div>
            ) : null}
            {isAdmin ? <div className="transfer-identification-actions-divider" aria-hidden="true" /> : null}
            <button
              className="fetch-button"
              type="button"
              onClick={handleRefresh}
              disabled={isLoadingActiveTransfers || isAssigning}
            >
              {isLoadingActiveTransfers ? "Cargando..." : "Actualizar"}
            </button>
            {activeMode === "unidentified" ? (
              <button
                className="fetch-button fetch-button--success"
                type="button"
                onClick={() => openAssignmentModal(selectedTransfer)}
                disabled={!selectedTransfer || isAssigning || addresses.length === 0}
              >
                Asignar domicilio
              </button>
            ) : null}
            {(isLoadingTransfers || isLoadingIdentifiedTransfers || isLoadingAddresses || isAssigning) ? (
              <span className="loan-actions__loading">
                {isAssigning ? "Asignando..." : "Procesando..."}
              </span>
            ) : null}
          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Seleccion</span>
            {activeMode === "identified" && selectedIdentifiedTransfer ? (
              <div className="transfer-identification-selection">
                <span>{selectedIdentifiedTransfer.nombre_asociado || "Sin nombre"}</span>
                <strong>{formatAmount(selectedIdentifiedTransfer.monto)}</strong>
                <small>{formatDate(selectedIdentifiedTransfer)}</small>
                <small>{selectedIdentifiedTransfer.cvu_cbu}</small>
                <small>
                  {toDisplayValue(selectedIdentifiedTransfer.razon_social) ||
                    toDisplayValue(selectedIdentifiedTransfer.direccion) ||
                    "Cliente identificado"}
                </small>
              </div>
            ) : activeMode === "unidentified" && selectedTransfer ? (
              <div className="transfer-identification-selection">
                <span>{selectedTransfer.nombre_asociado || "Sin nombre"}</span>
                <strong>{formatAmount(selectedTransfer.monto)}</strong>
                <small>{formatDate(selectedTransfer)}</small>
                <small>{selectedTransfer.cvu_cbu}</small>
              </div>
            ) : (
              <div className="transfer-identification-selection">
                <small>Seleccione una transferencia.</small>
              </div>
            )}
          </div>
        </aside>
      </div>

      {assignmentTransfer ? (
        <AssignmentModal
          transfer={assignmentTransfer}
          addresses={addresses}
          isAssigning={isAssigning}
          onCancel={() => {
            if (!isAssigning) {
              setAssignmentTransfer(null)
            }
          }}
          onAssign={handleAssign}
        />
      ) : null}

      {identifiedDetailsTransfer ? (
        <IdentifiedDetailsModal
          transfer={identifiedDetailsTransfer}
          onCancel={() => setIdentifiedDetailsTransfer(null)}
        />
      ) : null}
    </>
  )
}
