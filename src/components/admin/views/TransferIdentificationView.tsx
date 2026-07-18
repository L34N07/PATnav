import React, { useCallback, useEffect, useMemo, useState } from "react"
import type {
  ApplyTransferPaymentResult,
  AssignTransferenciaAccountResult,
  CobroComprobanteCheckResult,
  TransferAddressCandidate,
  TransferAddressCandidatesResult,
  TransferVentaAddressResult,
  TransferVentaResult,
  TransferVentasResult,
  UnidentifiedTransferenciaResult,
  UnidentifiedTransferenciasResult
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

const STATUS_DURATION_MS = 4000
const MAX_SUGGESTIONS = 12
const COMPROBANTE_TYPES = ["FA", "FB", "RR", "CI"] as const

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

const formatOperationDate = (value: unknown) => {
  const text = toDisplayValue(value)
  if (!text) {
    return "-"
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return text.replace("T", " ")
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date)
}

const buildVentaLabel = (venta: TransferVentaResult) =>
  [
    toDisplayValue(venta.tipo_comprobante),
    toDisplayValue(venta.prefijo),
    toDisplayValue(venta.numero)
  ]
    .filter(Boolean)
    .join(" ")

type SelectedComprobante = {
  tipoComprobante: string
  prefijo: string
  numero: string
}

const buildComprobanteLabel = (comprobante: SelectedComprobante | null) =>
  comprobante
    ? [comprobante.tipoComprobante, comprobante.prefijo, comprobante.numero]
        .map(toDisplayValue)
        .filter(Boolean)
        .join(" ")
    : ""

const comprobanteFromVenta = (venta: TransferVentaResult): SelectedComprobante => ({
  tipoComprobante: toDisplayValue(venta.tipo_comprobante).toUpperCase(),
  prefijo: toDisplayValue(venta.prefijo),
  numero: toDisplayValue(venta.numero)
})

const isVentaBlocked = (venta: TransferVentaResult) =>
  toDisplayValue(venta.mcampo_control).toUpperCase() === "P"

const getVentaKey = (venta: TransferVentaResult) =>
  `${toDisplayValue(venta.tipo_comprobante)}-${toDisplayValue(venta.prefijo)}-${toDisplayValue(venta.numero)}`

const getClientKey = (codCliente: unknown, nroLugarEntrega: unknown) =>
  `${toDisplayValue(codCliente)}-${toDisplayValue(nroLugarEntrega)}`

const getVentaDebt = (venta: TransferVentaResult) => {
  const debt = Number(venta.deuda ?? venta.monto)
  return Number.isFinite(debt) ? debt : 0
}

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

type CobroComprobanteModalProps = {
  originalLabel: string
  isChecking: boolean
  errorMessage: string | null
  onCancel: () => void
  onConfirm: (comprobante: SelectedComprobante) => void
}

function CobroComprobanteModal({
  originalLabel,
  isChecking,
  errorMessage,
  onCancel,
  onConfirm
}: CobroComprobanteModalProps) {
  const [tipoComprobante, setTipoComprobante] =
    useState<(typeof COMPROBANTE_TYPES)[number]>("FA")
  const [prefijo, setPrefijo] = useState("")
  const [numero, setNumero] = useState("")

  const handleIntegerChange = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setter(value.replace(/\D/g, ""))
  }

  const canConfirm = prefijo.length > 0 && numero.length > 0 && !isChecking

  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <div className="image-modal__panel transfer-comprobante-modal">
        <div className="image-modal__header">
          <div>
            <h3 className="image-modal__title">Comprobante ya utilizado</h3>
            <p className="transfer-assign-modal__intro">
              {originalLabel} ya existe en Cobros. Ingrese el nuevo comprobante.
            </p>
          </div>
        </div>

        <div className="transfer-comprobante-modal__fields">
          <label className="transfer-comprobante-modal__field">
            <span>Tipo</span>
            <select
              value={tipoComprobante}
              onChange={event =>
                setTipoComprobante(event.target.value as (typeof COMPROBANTE_TYPES)[number])
              }
              disabled={isChecking}
            >
              {COMPROBANTE_TYPES.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="transfer-comprobante-modal__field">
            <span>Prefijo</span>
            <input
              value={prefijo}
              onChange={event => handleIntegerChange(event.target.value, setPrefijo)}
              inputMode="numeric"
              placeholder="0"
              disabled={isChecking}
            />
          </label>

          <label className="transfer-comprobante-modal__field">
            <span>Numero</span>
            <input
              value={numero}
              onChange={event => handleIntegerChange(event.target.value, setNumero)}
              inputMode="numeric"
              placeholder="1234"
              disabled={isChecking}
            />
          </label>
        </div>

        {errorMessage ? (
          <div className="transfer-comprobante-modal__error">{errorMessage}</div>
        ) : null}

        <div className="duplicate-transfer-modal__actions">
          <button
            className="image-modal__close action-button--neutral"
            type="button"
            onClick={onCancel}
            disabled={isChecking}
          >
            Cancelar
          </button>
          <button
            className="fetch-button action-button--confirm"
            type="button"
            onClick={() =>
              onConfirm({
                tipoComprobante,
                prefijo,
                numero
              })
            }
            disabled={!canConfirm}
          >
            {isChecking ? "Verificando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  )
}

type IdentifiedDetailsModalProps = {
  transfer: UnidentifiedTransferenciaResult
  ventas: TransferVentaResult[]
  ventaAddresses: TransferVentaAddressResult[]
  selectedBill: TransferVentaResult | null
  selectedComprobante: SelectedComprobante | null
  selectedPaymentVentas: TransferVentaResult[]
  isCheckingCobro: boolean
  isSavingPayment: boolean
  isLoadingVentas: boolean
  ventasError: string | null
  onCancel: () => void
  onSelectBill: (venta: TransferVentaResult) => void
  onTogglePaymentVenta: (venta: TransferVentaResult) => void
  onSavePayment: () => void
}

function IdentifiedDetailsModal({
  transfer,
  ventas,
  ventaAddresses,
  selectedBill,
  selectedComprobante,
  selectedPaymentVentas,
  isCheckingCobro,
  isSavingPayment,
  isLoadingVentas,
  ventasError,
  onCancel,
  onSelectBill,
  onTogglePaymentVenta,
  onSavePayment
}: IdentifiedDetailsModalProps) {
  const [hoveredClientKey, setHoveredClientKey] = useState<string | null>(null)
  const transferAmount = Number(transfer.monto)
  const accumulated = selectedPaymentVentas.reduce((total, venta) => total + getVentaDebt(venta), 0)
  const canSelectMore = !Number.isFinite(transferAmount) || accumulated < transferAmount
  const selectedVentaKeys = new Set(selectedPaymentVentas.map(getVentaKey))
  const addressByClient = useMemo(() => {
    const entries = new Map<string, TransferVentaAddressResult>()
    ventaAddresses.forEach(address => {
      entries.set(getClientKey(address.cod_cliente, address.nro_lugar_entrega), address)
    })
    return entries
  }, [ventaAddresses])
  const hoveredAddress = hoveredClientKey ? addressByClient.get(hoveredClientKey) ?? null : null
	  const summaryText = hoveredAddress
	    ? `${toDisplayValue(hoveredAddress.cliente) || hoveredClientKey} - ${
	        toDisplayValue(hoveredAddress.direccion) || "Sin domicilio cargado"
	      }`
	    : ""

  const handleVentaClick = (venta: TransferVentaResult) => {
    if (isVentaBlocked(venta)) {
      return
    }

    if (!selectedComprobante) {
      onSelectBill(venta)
      return
    }

    onTogglePaymentVenta(venta)
  }

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

        <div
          key={hoveredClientKey || "default-address-summary"}
          className={`transfer-identified-modal__summary${
            hoveredAddress ? " transfer-identified-modal__summary--hovered" : ""
          }`}
        >
          <span>{summaryText}</span>
        </div>

        <div className="transfer-identified-modal__body">
          <div className="transfer-identified-modal__main">
            <div className="transfer-ventas-list">
              {isLoadingVentas ? (
                <div className="transfer-identified-modal__blank">Cargando ventas...</div>
              ) : ventasError ? (
                <div className="transfer-identified-modal__blank transfer-identified-modal__blank--error">
                  {ventasError}
                </div>
              ) : ventas.length > 0 ? (
                ventas.map(venta => {
                  const key = getVentaKey(venta)
                  const blocked = isVentaBlocked(venta)
                  const selected = selectedVentaKeys.has(key)
                  const cannotAdd = Boolean(selectedComprobante) && !selected && !canSelectMore
                  const disabled = blocked || cannotAdd || isCheckingCobro || isSavingPayment
                  const totalAmount = formatAmount(venta.monto)
                  const debtAmount = formatAmount(String(getVentaDebt(venta)))
                  const ventaClientKey = getClientKey(venta.cod_cliente, venta.nro_lugar_entrega)

                  return (
                    <button
                      key={key}
                      type="button"
                      className={`transfer-venta-card${blocked ? " transfer-venta-card--blocked" : ""}${selected ? " selected" : ""}`}
                      onClick={() => {
                        if (!disabled) {
                          handleVentaClick(venta)
                        }
                      }}
                      onMouseEnter={() => setHoveredClientKey(ventaClientKey)}
                      onFocus={() => setHoveredClientKey(ventaClientKey)}
                      onMouseLeave={() => setHoveredClientKey(null)}
                      onBlur={() => setHoveredClientKey(null)}
                      aria-disabled={disabled}
                    >
                      <span className="transfer-venta-card__bill">
                        {buildVentaLabel(venta) || "Comprobante sin numero"}
                      </span>
                      <span className="transfer-venta-card__client">
                        {toDisplayValue(venta.cliente) ||
                          `${toDisplayValue(venta.cod_cliente)}-${toDisplayValue(venta.nro_lugar_entrega)}`}
                      </span>
                      <span className="transfer-venta-card__date">
                        {formatOperationDate(venta.fecha_operacion)}
                      </span>
                      <span className="transfer-venta-card__amount">
                        {totalAmount}
                      </span>
                      <span className="transfer-venta-card__debt">
                        {!blocked ? debtAmount : "-"}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="transfer-identified-modal__blank">
                  No hay ventas en los ultimos 12 meses.
                </div>
              )}
            </div>

            <div className="transfer-identified-modal__accumulated">
              <span>Transferencia: {formatAmount(transfer.monto)}</span>
              <strong>ACUMULADO: {formatAmount(String(accumulated))}</strong>
            </div>
          </div>

          <aside className="transfer-identified-modal__side">
            <span className="transfer-identified-modal__side-title">Seleccion</span>
            <div className="transfer-identified-modal__selected-bill">
              {selectedComprobante
                ? buildComprobanteLabel(selectedComprobante)
                : isCheckingCobro
                  ? "Verificando..."
                  : "Seleccione una factura"}
            </div>
          </aside>
        </div>

        <div className="duplicate-transfer-modal__actions">
          <button
            className="image-modal__close action-button--neutral"
            type="button"
            onClick={onCancel}
            disabled={isSavingPayment}
          >
            Cancelar
          </button>
          <button
            className="fetch-button action-button--confirm"
            type="button"
            onClick={onSavePayment}
            disabled={
              !selectedComprobante ||
              selectedPaymentVentas.length === 0 ||
              isCheckingCobro ||
              isSavingPayment
            }
          >
            {isSavingPayment ? "Guardando..." : "Guardar"}
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
  const [transferVentas, setTransferVentas] = useState<TransferVentaResult[]>([])
  const [transferVentaAddresses, setTransferVentaAddresses] = useState<TransferVentaAddressResult[]>([])
  const [selectedBill, setSelectedBill] = useState<TransferVentaResult | null>(null)
  const [selectedComprobante, setSelectedComprobante] = useState<SelectedComprobante | null>(null)
  const [selectedPaymentVentas, setSelectedPaymentVentas] = useState<TransferVentaResult[]>([])
  const [pendingReplacementVenta, setPendingReplacementVenta] = useState<TransferVentaResult | null>(null)
  const [isLoadingTransfers, setIsLoadingTransfers] = useState(false)
  const [isLoadingIdentifiedTransfers, setIsLoadingIdentifiedTransfers] = useState(false)
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false)
  const [isLoadingVentas, setIsLoadingVentas] = useState(false)
  const [isCheckingCobro, setIsCheckingCobro] = useState(false)
  const [isSavingPayment, setIsSavingPayment] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [ventasError, setVentasError] = useState<string | null>(null)
  const [replacementError, setReplacementError] = useState<string | null>(null)
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

  const loadTransferVentas = useCallback(
    async (transfer: UnidentifiedTransferenciaResult) => {
      if (!electronAPI?.listTransferVentas) {
        setVentasError("No se encuentra disponible la lista de ventas.")
        return
      }

      if (transfer.cod_cliente === null || transfer.cod_cliente === undefined ||
          transfer.nro_lugar_entrega === null || transfer.nro_lugar_entrega === undefined) {
        setVentasError("La transferencia no tiene cliente/lugar asociado.")
        return
      }

      setIsLoadingVentas(true)
      setVentasError(null)
      setTransferVentas([])
      setTransferVentaAddresses([])
      setSelectedBill(null)
      setSelectedComprobante(null)
      setSelectedPaymentVentas([])
      setPendingReplacementVenta(null)
      setReplacementError(null)

      try {
        const result: TransferVentasResult = await electronAPI.listTransferVentas({
          codCliente: transfer.cod_cliente,
          nroLugarEntrega: transfer.nro_lugar_entrega,
          cvuCbu: transfer.cvu_cbu
        })
        if (result.error) {
          throw new Error(result.details || result.error)
        }
        setTransferVentas(result.rows ?? [])
        setTransferVentaAddresses(result.addresses ?? [])
      } catch (error) {
        console.error("No se pudieron cargar las ventas de la transferencia:", error)
        setTransferVentas([])
        setTransferVentaAddresses([])
        setVentasError(
          error instanceof Error ? error.message : "Error desconocido al cargar ventas."
        )
      } finally {
        setIsLoadingVentas(false)
      }
    },
    [electronAPI]
  )

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
      setTransferVentas([])
      setTransferVentaAddresses([])
      setSelectedBill(null)
      setSelectedComprobante(null)
      setSelectedPaymentVentas([])
      setPendingReplacementVenta(null)
      setReplacementError(null)
      setVentasError(null)

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

  const openIdentifiedDetailsModal = useCallback(
    (transfer: UnidentifiedTransferenciaResult) => {
      setSelectedIdentifiedTransfer(transfer)
      setIdentifiedDetailsTransfer(transfer)
      void loadTransferVentas(transfer)
    },
    [loadTransferVentas]
  )

  const checkCobroComprobante = useCallback(
    async (comprobante: SelectedComprobante) => {
      if (!electronAPI?.checkCobroComprobante) {
        throw new Error("No se encuentra disponible la validacion de comprobantes.")
      }

      const result: CobroComprobanteCheckResult = await electronAPI.checkCobroComprobante({
        tipoComprobante: comprobante.tipoComprobante,
        prefijo: comprobante.prefijo,
        numero: comprobante.numero
      })
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      return result.exists === true
    },
    [electronAPI]
  )

  const handleSelectBill = useCallback(
    async (venta: TransferVentaResult) => {
      if (isCheckingCobro) {
        return
      }

      const comprobante = comprobanteFromVenta(venta)
      setIsCheckingCobro(true)
      setReplacementError(null)

      try {
        const exists = await checkCobroComprobante(comprobante)
        if (exists) {
          setPendingReplacementVenta(venta)
          setReplacementError(null)
          return
        }

        setSelectedBill(venta)
        setSelectedComprobante(comprobante)
      } catch (error) {
        console.error("No se pudo validar el comprobante en Cobros:", error)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Error desconocido al validar comprobante."
        )
      } finally {
        setIsCheckingCobro(false)
      }
    },
    [checkCobroComprobante, isCheckingCobro]
  )

  const handleConfirmReplacementComprobante = useCallback(
    async (comprobante: SelectedComprobante) => {
      if (!pendingReplacementVenta || isCheckingCobro) {
        return
      }

      setIsCheckingCobro(true)
      setReplacementError(null)

      try {
        const exists = await checkCobroComprobante(comprobante)
        if (exists) {
          setReplacementError(
            `${buildComprobanteLabel(comprobante)} ya existe en Cobros. Ingrese otro comprobante.`
          )
          return
        }

        setSelectedBill(pendingReplacementVenta)
        setSelectedComprobante(comprobante)
        setPendingReplacementVenta(null)
        setReplacementError(null)
      } catch (error) {
        console.error("No se pudo validar el nuevo comprobante en Cobros:", error)
        setReplacementError(
          error instanceof Error
            ? error.message
            : "Error desconocido al validar comprobante."
        )
      } finally {
        setIsCheckingCobro(false)
      }
    },
    [checkCobroComprobante, isCheckingCobro, pendingReplacementVenta]
  )

  const handleTogglePaymentVenta = useCallback(
    (venta: TransferVentaResult) => {
      if (isVentaBlocked(venta)) {
        return
      }

      setSelectedPaymentVentas(prev => {
        const key = getVentaKey(venta)
        const alreadySelected = prev.some(selected => getVentaKey(selected) === key)
        if (alreadySelected) {
          return prev.filter(selected => getVentaKey(selected) !== key)
        }

        const transferAmount = Number(identifiedDetailsTransfer?.monto)
        const accumulated = prev.reduce((total, selected) => total + getVentaDebt(selected), 0)
        if (Number.isFinite(transferAmount) && accumulated >= transferAmount) {
          return prev
        }

        return [...prev, venta]
      })
    },
    [identifiedDetailsTransfer]
  )

  const closeIdentifiedDetailsModal = useCallback(() => {
    setIdentifiedDetailsTransfer(null)
    setTransferVentas([])
    setTransferVentaAddresses([])
    setSelectedBill(null)
    setSelectedComprobante(null)
    setSelectedPaymentVentas([])
    setPendingReplacementVenta(null)
    setReplacementError(null)
    setVentasError(null)
  }, [])

  const handleSavePayment = useCallback(async () => {
    if (
      !electronAPI?.applyTransferPayment ||
      !identifiedDetailsTransfer ||
      !selectedBill ||
      !selectedComprobante ||
      selectedPaymentVentas.length === 0 ||
      isSavingPayment
    ) {
      return
    }

    setIsSavingPayment(true)
    setErrorMessage(null)

    try {
      const result: ApplyTransferPaymentResult = await electronAPI.applyTransferPayment({
        receiptComprobante: selectedComprobante,
        receiptClient: {
          codCliente: selectedBill.cod_cliente,
          nroLugarEntrega: selectedBill.nro_lugar_entrega
        },
        transferAmount: identifiedDetailsTransfer.monto,
        selectedVentas: selectedPaymentVentas.map(venta => ({
          tipoComprobante: toDisplayValue(venta.tipo_comprobante),
          prefijo: venta.prefijo,
          numero: venta.numero
        }))
      })

      if (result.error) {
        throw new Error(result.details || result.error)
      }

      const appliedCount = result.inserted_cobros_aplicados ?? 0
      setStatusMessage(
        `Cobro guardado. ${appliedCount} aplicacion${appliedCount === 1 ? "" : "es"} registrada${appliedCount === 1 ? "" : "s"}.`
      )
      closeIdentifiedDetailsModal()
      void loadIdentifiedTransfers()
    } catch (error) {
      console.error("No se pudo guardar el cobro por transferencia:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al guardar cobro."
      )
    } finally {
      setIsSavingPayment(false)
    }
  }, [
    closeIdentifiedDetailsModal,
    electronAPI,
    identifiedDetailsTransfer,
    isSavingPayment,
    loadIdentifiedTransfers,
    selectedBill,
    selectedComprobante,
    selectedPaymentVentas
  ])

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
                    className={`loan-card transfer-identification-card${isSelected ? " expanded" : ""}`}
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
                    className={`loan-card transfer-identification-card transfer-identification-card--identified${isSelected ? " expanded" : ""}`}
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
	                <small>
	                  Domicilio: {toDisplayValue(selectedIdentifiedTransfer.direccion) ||
	                    "Sin domicilio cargado"}
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
          ventas={transferVentas}
          ventaAddresses={transferVentaAddresses}
          selectedBill={selectedBill}
          selectedComprobante={selectedComprobante}
          selectedPaymentVentas={selectedPaymentVentas}
          isCheckingCobro={isCheckingCobro}
          isSavingPayment={isSavingPayment}
          isLoadingVentas={isLoadingVentas}
          ventasError={ventasError}
          onCancel={closeIdentifiedDetailsModal}
          onSelectBill={handleSelectBill}
          onTogglePaymentVenta={handleTogglePaymentVenta}
          onSavePayment={handleSavePayment}
        />
      ) : null}

      {pendingReplacementVenta ? (
        <CobroComprobanteModal
          originalLabel={buildVentaLabel(pendingReplacementVenta)}
          isChecking={isCheckingCobro}
          errorMessage={replacementError}
          onCancel={() => {
            if (!isCheckingCobro) {
              setPendingReplacementVenta(null)
              setReplacementError(null)
            }
          }}
          onConfirm={handleConfirmReplacementComprobante}
        />
      ) : null}
    </>
  )
}
