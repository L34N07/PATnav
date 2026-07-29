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

type SelectedReceipt = {
  comprobante: SelectedComprobante
  codCliente: string | number
  nroLugarEntrega: string | number
  sourceVentaKey: string
}

type PendingReceiptReplacement = {
  clientKey: string
  venta: TransferVentaResult
  originalLabel: string
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

const getVentaClientKey = (venta: TransferVentaResult) =>
  getClientKey(venta.cod_cliente, venta.nro_lugar_entrega)

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
  selectedPaymentVentas: TransferVentaResult[]
  selectedReceiptsByClient: Record<string, SelectedReceipt>
  areBillsConfirmed: boolean
  activeReceiptClientKey: string | null
  isCheckingCobro: boolean
  isSavingPayment: boolean
  isLoadingVentas: boolean
  ventasError: string | null
  onCancel: () => void
  onTogglePaymentVenta: (venta: TransferVentaResult) => void
  onConfirmBillSelection: () => void
  onEditBillSelection: () => void
  onSelectReceiptClient: (clientKey: string) => void
  onSelectReceiptVenta: (venta: TransferVentaResult) => void
  onSavePayment: () => void
}

function IdentifiedDetailsModal({
  transfer,
  ventas,
  ventaAddresses,
  selectedPaymentVentas,
  selectedReceiptsByClient,
  areBillsConfirmed,
  activeReceiptClientKey,
  isCheckingCobro,
  isSavingPayment,
  isLoadingVentas,
  ventasError,
  onCancel,
  onTogglePaymentVenta,
  onConfirmBillSelection,
  onEditBillSelection,
  onSelectReceiptClient,
  onSelectReceiptVenta,
  onSavePayment
}: IdentifiedDetailsModalProps) {
  const [hoveredClientKey, setHoveredClientKey] = useState<string | null>(null)
  const transferAmount = Number(transfer.monto)
  const accumulated = selectedPaymentVentas.reduce((total, venta) => total + getVentaDebt(venta), 0)
  const canSelectMore = !Number.isFinite(transferAmount) || accumulated < transferAmount
  const selectedVentaKeys = new Set(selectedPaymentVentas.map(getVentaKey))
  const selectedReceiptClients = useMemo(() => {
    const entries: Array<{
      key: string
      codCliente: string | number
      nroLugarEntrega: string | number
    }> = []
    const seen = new Set<string>()
    selectedPaymentVentas.forEach(venta => {
      const key = getVentaClientKey(venta)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      entries.push({
        key,
        codCliente: venta.cod_cliente,
        nroLugarEntrega: venta.nro_lugar_entrega
      })
    })
    return entries
  }, [selectedPaymentVentas])
  const selectedReceiptClientKeys = new Set(selectedReceiptClients.map(client => client.key))
  const firstMissingReceiptClientKey =
    selectedReceiptClients.find(client => !selectedReceiptsByClient[client.key])?.key ?? null
  const effectiveActiveReceiptClientKey =
    activeReceiptClientKey &&
    selectedReceiptClientKeys.has(activeReceiptClientKey) &&
    (
      Boolean(selectedReceiptsByClient[activeReceiptClientKey]) ||
      activeReceiptClientKey === firstMissingReceiptClientKey ||
      firstMissingReceiptClientKey === null
    )
      ? activeReceiptClientKey
      : firstMissingReceiptClientKey ?? selectedReceiptClients[0]?.key ?? null
  const allReceiptsSelected =
    selectedReceiptClients.length > 0 &&
    selectedReceiptClients.every(client => Boolean(selectedReceiptsByClient[client.key]))
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

    if (!areBillsConfirmed) {
      onTogglePaymentVenta(venta)
      return
    }

    onSelectReceiptVenta(venta)
  }

  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <div className="image-modal__panel transfer-identified-modal">
        <div className="image-modal__header transfer-identified-modal__header">
          <div>
            <h3 className="image-modal__title">Transferencia identificada</h3>
            <p className="transfer-assign-modal__intro">
              {transfer.nombre_asociado || "Sin nombre"} - {formatAmount(transfer.monto)}
            </p>
            <p className="transfer-assign-modal__intro transfer-identified-modal__receipt-date">
              Fecha comprobante: {formatDate(transfer)}
            </p>
          </div>
        </div>

        <div className="transfer-identified-modal__top-row">
          <div
            className={`transfer-identified-modal__summary${
              hoveredAddress ? " transfer-identified-modal__summary--hovered" : ""
            }`}
          >
            <span>{summaryText}</span>
          </div>
          <span className="transfer-identified-modal__top-row-spacer" aria-hidden="true" />
        </div>

        <div
          className={`transfer-identified-modal__body${
            areBillsConfirmed ? " transfer-identified-modal__body--receipt-mode" : ""
          }`}
        >
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
                  const ventaClientKey = getVentaClientKey(venta)
                  const receipt = selectedReceiptsByClient[ventaClientKey] ?? null
                  const receiptSelected = receipt?.sourceVentaKey === key
                  const cannotAdd = !areBillsConfirmed && !selected && !canSelectMore
                  const notASelectedClient =
                    areBillsConfirmed && !selectedReceiptClientKeys.has(ventaClientKey)
                  const inactiveReceiptClient =
                    areBillsConfirmed && ventaClientKey !== effectiveActiveReceiptClientKey
                  const disabled =
                    blocked ||
                    cannotAdd ||
                    notASelectedClient ||
                    inactiveReceiptClient ||
                    isCheckingCobro ||
                    isSavingPayment
                  const totalAmount = formatAmount(venta.monto)
                  const debtAmount = formatAmount(String(getVentaDebt(venta)))

                  return (
                    <button
                      key={key}
                      type="button"
                      className={`transfer-venta-card${areBillsConfirmed ? " receipt-mode" : ""}${blocked ? " transfer-venta-card--blocked" : ""}${selected ? " selected" : ""}${receiptSelected ? " receipt-selected" : ""}`}
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
                        {formatOperationDate(venta.fecha_vencimiento)}
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

          <div
            className={`transfer-identified-modal__check-panel${
              areBillsConfirmed ? " transfer-identified-modal__check-panel--receipts" : ""
            }`}
          >
            <span className="transfer-identified-modal__check-title">Comprobantes</span>
            {areBillsConfirmed && selectedReceiptClients.length > 0 ? (
              <div className="transfer-identified-modal__receipt-boxes">
                {selectedReceiptClients.map(client => {
                  const receipt = selectedReceiptsByClient[client.key] ?? null
                  const isActive = effectiveActiveReceiptClientKey === client.key
                  return (
                    <button
                      key={client.key}
                      type="button"
                      className={`transfer-receipt-box${receipt ? " selected" : ""}${isActive ? " active" : ""}`}
                      onClick={() => onSelectReceiptClient(client.key)}
                      disabled={isCheckingCobro || isSavingPayment}
                      title={receipt ? "Cambiar comprobante" : "Seleccionar comprobante"}
                    >
                      <span className="transfer-receipt-box__client">{client.key}</span>
                      <strong>
                        {receipt
                          ? buildComprobanteLabel(receipt.comprobante)
                          : isCheckingCobro && isActive
                            ? "Verificando..."
                            : "ELEGIR"}
                      </strong>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {areBillsConfirmed ? (
              <button
                type="button"
                className="image-modal__close action-button--neutral"
                onClick={onEditBillSelection}
                disabled={isCheckingCobro || isSavingPayment}
              >
                Editar facturas
              </button>
            ) : (
              <button
                type="button"
                className="fetch-button action-button--confirm"
                onClick={onConfirmBillSelection}
                disabled={
                  selectedPaymentVentas.length === 0 ||
                  isCheckingCobro ||
                  isSavingPayment ||
                  isLoadingVentas
                }
              >
                Confirmar facturas
              </button>
            )}
          </div>
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
              !areBillsConfirmed ||
              !allReceiptsSelected ||
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

type TransferenciasViewProps = {
  isAdmin?: boolean
}

type TransferenciasMode = "unidentified" | "identified"

export default function TransferenciasView({
  isAdmin = false
}: TransferenciasViewProps) {
  const electronAPI = window.electronAPI
  const [activeMode, setActiveMode] = useState<TransferenciasMode>("unidentified")
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
  const [selectedPaymentVentas, setSelectedPaymentVentas] = useState<TransferVentaResult[]>([])
  const [selectedReceiptsByClient, setSelectedReceiptsByClient] =
    useState<Record<string, SelectedReceipt>>({})
  const [areBillsConfirmed, setAreBillsConfirmed] = useState(false)
  const [activeReceiptClientKey, setActiveReceiptClientKey] = useState<string | null>(null)
  const [pendingReplacementReceipt, setPendingReplacementReceipt] =
    useState<PendingReceiptReplacement | null>(null)
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
      setSelectedPaymentVentas([])
      setSelectedReceiptsByClient({})
      setAreBillsConfirmed(false)
      setActiveReceiptClientKey(null)
      setPendingReplacementReceipt(null)
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
    (mode: TransferenciasMode) => {
      setActiveMode(mode)
      setSelectedTransfer(null)
      setSelectedIdentifiedTransfer(null)
      setAssignmentTransfer(null)
      setIdentifiedDetailsTransfer(null)
      setTransferVentas([])
      setTransferVentaAddresses([])
      setSelectedPaymentVentas([])
      setSelectedReceiptsByClient({})
      setAreBillsConfirmed(false)
      setActiveReceiptClientKey(null)
      setPendingReplacementReceipt(null)
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

  const selectedReceiptClients = useMemo(() => {
    const entries: Array<{
      key: string
      codCliente: string | number
      nroLugarEntrega: string | number
    }> = []
    const seen = new Set<string>()
    selectedPaymentVentas.forEach(venta => {
      const key = getVentaClientKey(venta)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      entries.push({
        key,
        codCliente: venta.cod_cliente,
        nroLugarEntrega: venta.nro_lugar_entrega
      })
    })
    return entries
  }, [selectedPaymentVentas])

  const getFirstMissingReceiptClientKey = useCallback(
    (receipts: Record<string, SelectedReceipt> = selectedReceiptsByClient) =>
      selectedReceiptClients.find(client => !receipts[client.key])?.key ?? null,
    [selectedReceiptClients, selectedReceiptsByClient]
  )

  const handleConfirmBillSelection = useCallback(() => {
    if (selectedPaymentVentas.length === 0 || isCheckingCobro || isSavingPayment) {
      return
    }

    const allowedClientKeys = new Set(selectedReceiptClients.map(client => client.key))
    setSelectedReceiptsByClient(prev => {
      const next: Record<string, SelectedReceipt> = {}
      Object.entries(prev).forEach(([key, receipt]) => {
        if (allowedClientKeys.has(key)) {
          next[key] = receipt
        }
      })
      return next
    })
    setActiveReceiptClientKey(selectedReceiptClients[0]?.key ?? null)
    setAreBillsConfirmed(true)
    setPendingReplacementReceipt(null)
    setReplacementError(null)
  }, [isCheckingCobro, isSavingPayment, selectedPaymentVentas.length, selectedReceiptClients])

  const handleEditBillSelection = useCallback(() => {
    if (isCheckingCobro || isSavingPayment) {
      return
    }

    setAreBillsConfirmed(false)
    setSelectedReceiptsByClient({})
    setActiveReceiptClientKey(null)
    setPendingReplacementReceipt(null)
    setReplacementError(null)
  }, [isCheckingCobro, isSavingPayment])

  const handleSelectReceiptClient = useCallback(
    (clientKey: string) => {
      if (isCheckingCobro || isSavingPayment) {
        return
      }
      const firstMissingClientKey = getFirstMissingReceiptClientKey()
      if (!selectedReceiptsByClient[clientKey] && clientKey !== firstMissingClientKey) {
        setActiveReceiptClientKey(firstMissingClientKey)
        return
      }
      setActiveReceiptClientKey(clientKey)
    },
    [getFirstMissingReceiptClientKey, isCheckingCobro, isSavingPayment, selectedReceiptsByClient]
  )

  const storeReceiptForVenta = useCallback(
    (venta: TransferVentaResult, comprobante: SelectedComprobante) => {
      const clientKey = getVentaClientKey(venta)
      const nextReceipts = {
        ...selectedReceiptsByClient,
        [clientKey]: {
          comprobante,
          codCliente: venta.cod_cliente,
          nroLugarEntrega: venta.nro_lugar_entrega,
          sourceVentaKey: getVentaKey(venta)
        }
      }
      setSelectedReceiptsByClient(nextReceipts)

      const currentIndex = selectedReceiptClients.findIndex(client => client.key === clientKey)
      const nextMissingAfterCurrent =
        currentIndex >= 0
          ? selectedReceiptClients
              .slice(currentIndex + 1)
              .find(client => !nextReceipts[client.key])?.key ?? null
          : null
      setActiveReceiptClientKey(
        nextMissingAfterCurrent ?? getFirstMissingReceiptClientKey(nextReceipts) ?? clientKey
      )
    },
    [getFirstMissingReceiptClientKey, selectedReceiptClients, selectedReceiptsByClient]
  )

  const getEffectiveReceiptClientKey = useCallback(() => {
    const firstMissingClientKey = getFirstMissingReceiptClientKey()
    if (
      activeReceiptClientKey &&
      selectedReceiptClients.some(client => client.key === activeReceiptClientKey) &&
      (
        Boolean(selectedReceiptsByClient[activeReceiptClientKey]) ||
        activeReceiptClientKey === firstMissingClientKey ||
        firstMissingClientKey === null
      )
    ) {
      return activeReceiptClientKey
    }
    return firstMissingClientKey ?? selectedReceiptClients[0]?.key ?? null
  }, [
    activeReceiptClientKey,
    getFirstMissingReceiptClientKey,
    selectedReceiptClients,
    selectedReceiptsByClient
  ])

  const handleSelectReceiptVenta = useCallback(
    async (venta: TransferVentaResult) => {
      if (!areBillsConfirmed || isCheckingCobro || isSavingPayment) {
        return
      }

      const clientKey = getVentaClientKey(venta)
      if (clientKey !== getEffectiveReceiptClientKey()) {
        return
      }

      const comprobante = comprobanteFromVenta(venta)
      setActiveReceiptClientKey(clientKey)
      setIsCheckingCobro(true)
      setReplacementError(null)

      try {
        const exists = await checkCobroComprobante(comprobante)
        if (exists) {
          setPendingReplacementReceipt({
            clientKey,
            venta,
            originalLabel: buildComprobanteLabel(comprobante)
          })
          setReplacementError(null)
          return
        }

        storeReceiptForVenta(venta, comprobante)
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
    [
      areBillsConfirmed,
      checkCobroComprobante,
      getEffectiveReceiptClientKey,
      isCheckingCobro,
      isSavingPayment,
      storeReceiptForVenta
    ]
  )

  const handleConfirmReplacementComprobante = useCallback(
    async (comprobante: SelectedComprobante) => {
      if (!pendingReplacementReceipt || isCheckingCobro) {
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

        storeReceiptForVenta(pendingReplacementReceipt.venta, comprobante)
        setPendingReplacementReceipt(null)
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
    [
      checkCobroComprobante,
      isCheckingCobro,
      pendingReplacementReceipt,
      storeReceiptForVenta
    ]
  )

  const handleTogglePaymentVenta = useCallback(
    (venta: TransferVentaResult) => {
      if (isVentaBlocked(venta) || areBillsConfirmed) {
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
    [areBillsConfirmed, identifiedDetailsTransfer]
  )

  const closeIdentifiedDetailsModal = useCallback(() => {
    setIdentifiedDetailsTransfer(null)
    setTransferVentas([])
    setTransferVentaAddresses([])
    setSelectedPaymentVentas([])
    setSelectedReceiptsByClient({})
    setAreBillsConfirmed(false)
    setActiveReceiptClientKey(null)
    setPendingReplacementReceipt(null)
    setReplacementError(null)
    setVentasError(null)
  }, [])

  const handleSavePayment = useCallback(async () => {
    if (
      !electronAPI?.applyTransferPayment ||
      !identifiedDetailsTransfer ||
      !areBillsConfirmed ||
      selectedPaymentVentas.length === 0 ||
      isSavingPayment
    ) {
      return
    }

    const receiptAssignments = selectedReceiptClients.map(client => {
      const receipt = selectedReceiptsByClient[client.key]
      const ventasForClient = selectedPaymentVentas.filter(
        venta => getVentaClientKey(venta) === client.key
      )

      return receipt
        ? {
            receiptComprobante: receipt.comprobante,
            receiptClient: {
              codCliente: receipt.codCliente,
              nroLugarEntrega: receipt.nroLugarEntrega
            },
            selectedVentas: ventasForClient.map(venta => ({
              tipoComprobante: toDisplayValue(venta.tipo_comprobante),
              prefijo: venta.prefijo,
              numero: venta.numero
            }))
          }
        : null
    })

    if (receiptAssignments.some(assignment => assignment === null)) {
      setErrorMessage("Seleccione un comprobante por cada cliente.")
      return
    }

    const completeReceiptAssignments = receiptAssignments.filter(
      (assignment): assignment is NonNullable<typeof assignment> => assignment !== null
    )
    const firstAssignment = completeReceiptAssignments[0]
    if (!firstAssignment) {
      setErrorMessage("Seleccione al menos un comprobante.")
      return
    }

    setIsCheckingCobro(true)
    setReplacementError(null)
    try {
      for (const client of selectedReceiptClients) {
        const receipt = selectedReceiptsByClient[client.key]
        if (!receipt) {
          continue
        }

        const exists = await checkCobroComprobante(receipt.comprobante)
        if (!exists) {
          continue
        }

        const replacementVenta =
          selectedPaymentVentas.find(venta => getVentaKey(venta) === receipt.sourceVentaKey) ??
          selectedPaymentVentas.find(venta => getVentaClientKey(venta) === client.key)
        setActiveReceiptClientKey(client.key)
        if (!replacementVenta) {
          setErrorMessage("No se encontro una factura para reemplazar el comprobante.")
          return
        }

        setPendingReplacementReceipt({
          clientKey: client.key,
          venta: replacementVenta,
          originalLabel: buildComprobanteLabel(receipt.comprobante)
        })
        setReplacementError(null)
        return
      }
    } catch (error) {
      console.error("No se pudo validar el comprobante en Cobros:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al validar comprobantes."
      )
      return
    } finally {
      setIsCheckingCobro(false)
    }

    setIsSavingPayment(true)
    setErrorMessage(null)

    try {
      const result: ApplyTransferPaymentResult = await electronAPI.applyTransferPayment({
        transferId: identifiedDetailsTransfer.id_transferencia,
        receiptComprobante: firstAssignment.receiptComprobante,
        receiptClient: firstAssignment.receiptClient,
        transferAmount: identifiedDetailsTransfer.monto,
        selectedVentas: selectedPaymentVentas.map(venta => ({
          tipoComprobante: toDisplayValue(venta.tipo_comprobante),
          prefijo: venta.prefijo,
          numero: venta.numero
        })),
        receiptAssignments: completeReceiptAssignments
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
    checkCobroComprobante,
    electronAPI,
    identifiedDetailsTransfer,
    isSavingPayment,
    loadIdentifiedTransfers,
    areBillsConfirmed,
    selectedPaymentVentas,
    selectedReceiptClients,
    selectedReceiptsByClient
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
                    <button
                      type="button"
                      className="loan-card-indicator transfer-identification-card__assign"
                      onClick={() => openIdentifiedDetailsModal(transfer)}
                    >
                      Cargar
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
                <small className="transfer-identification-selection__address">
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
          selectedPaymentVentas={selectedPaymentVentas}
          selectedReceiptsByClient={selectedReceiptsByClient}
          areBillsConfirmed={areBillsConfirmed}
          activeReceiptClientKey={activeReceiptClientKey}
          isCheckingCobro={isCheckingCobro}
          isSavingPayment={isSavingPayment}
          isLoadingVentas={isLoadingVentas}
          ventasError={ventasError}
          onCancel={closeIdentifiedDetailsModal}
          onTogglePaymentVenta={handleTogglePaymentVenta}
          onConfirmBillSelection={handleConfirmBillSelection}
          onEditBillSelection={handleEditBillSelection}
          onSelectReceiptClient={handleSelectReceiptClient}
          onSelectReceiptVenta={handleSelectReceiptVenta}
          onSavePayment={handleSavePayment}
        />
      ) : null}

      {pendingReplacementReceipt ? (
        <CobroComprobanteModal
          originalLabel={pendingReplacementReceipt.originalLabel}
          isChecking={isCheckingCobro}
          errorMessage={replacementError}
          onCancel={() => {
            if (!isCheckingCobro) {
              setPendingReplacementReceipt(null)
              setReplacementError(null)
            }
          }}
          onConfirm={handleConfirmReplacementComprobante}
        />
      ) : null}
    </>
  )
}
