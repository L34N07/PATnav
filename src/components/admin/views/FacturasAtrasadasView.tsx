import React, { useCallback, useMemo, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

type FacturaAtrasadaRow = {
  id: string
  tipoComprobante: string
  prefijo: string
  numero: string
  fechaVencimiento: string
  fechaVencimientoSortKey: number
  codCliente: number
  nroLugarEntrega: string
  importeTotal: number
  cobradoTotal: number
  saldo: number
  metodosCobro: string
}

type FacturaSummaryRow = {
  clientKey: string
  codCliente: number
  nroLugarEntrega: string
  totalSaldo: number
  metodosCobro: string
  oldestFactura: FacturaAtrasadaRow
  facturas: FacturaAtrasadaRow[]
}

type MetodoFiltroKey = "all" | "repartidor" | "bancarizado" | "cuenta" | "mano"

const STATUS_MESSAGE_DURATION_MS = 2000
const PASSWORD_FIELD_CANDIDATES = ["password", "pass", "contrasena", "apppassword"]
const TYPE_FIELD_CANDIDATES = ["tipo", "type", "usertype", "tipo_usuario", "perfil", "appusertype"]
const METODO_FILTRO_CODES: Record<MetodoFiltroKey, string[]> = {
  all: [],
  repartidor: ["S"],
  bancarizado: ["B-MP", "BA"],
  cuenta: ["BC", "CC"],
  mano: ["X"]
}
const METODO_FILTRO_OPCIONES: ReadonlyArray<{ key: MetodoFiltroKey; label: string }> = [
  { key: "repartidor", label: "Cobra Repartidor" },
  { key: "bancarizado", label: "Bancarizado" },
  { key: "cuenta", label: "Cuenta Corriente" },
  { key: "mano", label: "Paga en mano" },
  { key: "all", label: "Mostrar Todos" }
]

const buildClientKey = (codCliente: number, nroLugarEntrega: string): string =>
  `${codCliente}::${nroLugarEntrega || ""}`

const formatClientIdentifier = (codCliente: number, nroLugarEntrega: string): string =>
  nroLugarEntrega ? `${codCliente}/${nroLugarEntrega}` : `${codCliente}`

const formatAmount = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-"
  }
  return Math.trunc(value).toLocaleString("es-AR")
}

const formatComprobante = (row: FacturaAtrasadaRow): string => {
  const tipo = row.tipoComprobante || ""
  const numero = [row.prefijo, row.numero].filter(Boolean).join("-")
  if (!tipo && !numero) {
    return "-"
  }
  if (!tipo) {
    return numero
  }
  if (!numero) {
    return tipo
  }
  return `${tipo} ${numero}`
}

const parseMetodoCobroCodes = (value: string): string[] => {
  if (!value) {
    return []
  }
  const matches = value.toUpperCase().match(/[A-Z0-9-]+/g)
  return matches ?? []
}

const hasMetodoCobroCode = (value: string, codeSet: Set<string>): boolean => {
  if (codeSet.size === 0) {
    return true
  }
  const codes = parseMetodoCobroCodes(value)
  return codes.some(code => codeSet.has(code))
}

const normalizeKey = (value: string) => value.trim().toLowerCase()

const buildRowMap = (row: Record<string, unknown>) => {
  const map = new Map<string, unknown>()
  Object.entries(row ?? {}).forEach(([key, value]) => {
    map.set(normalizeKey(key), value)
  })
  return map
}

const pickRowValue = (rowMap: Map<string, unknown>, candidates: string[]) => {
  for (const candidate of candidates) {
    const key = normalizeKey(candidate)
    if (rowMap.has(key)) {
      return rowMap.get(key)
    }
  }
  return undefined
}

const toStringValue = (value: unknown) =>
  value === null || value === undefined ? "" : String(value).trim()

const toNumberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toOptionalNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseDateValue = (
  value: unknown
): { display: string; sortKey: number } => {
  if (!value) {
    return { display: "", sortKey: Number.POSITIVE_INFINITY }
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
    if (match) {
      const [, yearStr, monthStr, dayStr] = match
      const year = Number(yearStr)
      const month = Number(monthStr)
      const day = Number(dayStr)
      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        const sortKey = Date.UTC(year, month - 1, day)
        const display = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
        return { display, sortKey }
      }
    }
  }

  const fallbackDate = new Date(value as string | number)
  if (!Number.isNaN(fallbackDate.getTime())) {
    return {
      display: fallbackDate.toLocaleDateString(),
      sortKey: fallbackDate.getTime()
    }
  }

  return { display: String(value), sortKey: Number.POSITIVE_INFINITY }
}

const toFacturaRow = (row: Record<string, unknown>, index: number): FacturaAtrasadaRow => {
  const rowMap = buildRowMap(row)
  const tipoComprobante = toStringValue(
    pickRowValue(rowMap, ["tipo_comprobante", "tipo comprobante", "tipo"])
  )
  const prefijo = toStringValue(pickRowValue(rowMap, ["prefijo"]))
  const numero = toStringValue(pickRowValue(rowMap, ["numero", "nro"]))
  const fechaRaw = pickRowValue(rowMap, ["fecha_vencimiento", "fecha vencimiento", "vencimiento"])
  const { display, sortKey } = parseDateValue(fechaRaw)
  const codCliente = toNumberValue(
    pickRowValue(rowMap, ["cod_cliente", "codcliente", "cliente"])
  )
  const nroLugarEntrega = toStringValue(
    pickRowValue(rowMap, ["nro_lugar_entrega", "lugar_entrega", "nro_lugar"])
  )
  const importeTotal = toNumberValue(
    pickRowValue(rowMap, ["importe_total", "importe total", "importe"])
  )
  const cobradoTotal = toNumberValue(
    pickRowValue(rowMap, ["cobrado_total", "cobrado total", "cobrado"])
  )
  const saldo = toNumberValue(pickRowValue(rowMap, ["saldo"]))
  const metodosCobro = toStringValue(
    pickRowValue(rowMap, ["metodos_cobro", "metodo_cobro", "metodos cobro"])
  )
  const id = `${codCliente}-${nroLugarEntrega}-${tipoComprobante}-${prefijo}-${numero}-${sortKey}-${index}`

  return {
    id,
    tipoComprobante,
    prefijo,
    numero,
    fechaVencimiento: display,
    fechaVencimientoSortKey: sortKey,
    codCliente,
    nroLugarEntrega,
    importeTotal,
    cobradoTotal,
    saldo,
    metodosCobro
  }
}

const toIgnoredClientId = (row: Record<string, unknown>): number | null => {
  const rowMap = buildRowMap(row)
  const value = pickRowValue(rowMap, ["cod_cliente", "codcliente", "cliente"])
  return toOptionalNumber(value)
}

const collectMetodosCobro = (rows: FacturaAtrasadaRow[]): string => {
  const values = new Map<string, string>()
  rows.forEach(row => {
    const normalized = row.metodosCobro.trim()
    if (!normalized) {
      return
    }
    const key = normalized.toLowerCase()
    if (!values.has(key)) {
      values.set(key, normalized)
    }
  })
  return values.size > 0 ? [...values.values()].join(" / ") : "-"
}

const sortFacturas = (rows: FacturaAtrasadaRow[]): FacturaAtrasadaRow[] =>
  [...rows].sort((a, b) => {
    if (a.fechaVencimientoSortKey !== b.fechaVencimientoSortKey) {
      return a.fechaVencimientoSortKey - b.fechaVencimientoSortKey
    }
    if (a.tipoComprobante !== b.tipoComprobante) {
      return a.tipoComprobante.localeCompare(b.tipoComprobante)
    }
    if (a.prefijo !== b.prefijo) {
      return a.prefijo.localeCompare(b.prefijo)
    }
    return a.numero.localeCompare(b.numero)
  })

const buildSummaryRows = (rows: FacturaAtrasadaRow[]): FacturaSummaryRow[] => {
  const groups = new Map<string, FacturaAtrasadaRow[]>()

  rows.forEach(row => {
    const key = buildClientKey(row.codCliente, row.nroLugarEntrega)
    const existing = groups.get(key)
    if (existing) {
      existing.push(row)
    } else {
      groups.set(key, [row])
    }
  })

  const summaries: FacturaSummaryRow[] = []

  groups.forEach((groupRows, key) => {
    const sortedRows = sortFacturas(groupRows)
    const oldestFactura = sortedRows[0]
    const totalSaldo = groupRows.reduce((sum, row) => sum + row.saldo, 0)
    const metodosCobro = collectMetodosCobro(groupRows)
    summaries.push({
      clientKey: key,
      codCliente: oldestFactura.codCliente,
      nroLugarEntrega: oldestFactura.nroLugarEntrega,
      totalSaldo,
      metodosCobro,
      oldestFactura,
      facturas: sortedRows
    })
  })

  summaries.sort((a, b) => {
    const dateDiff = a.oldestFactura.fechaVencimientoSortKey - b.oldestFactura.fechaVencimientoSortKey
    if (dateDiff !== 0) {
      return dateDiff
    }
    if (a.codCliente !== b.codCliente) {
      return a.codCliente - b.codCliente
    }
    return a.nroLugarEntrega.localeCompare(b.nroLugarEntrega)
  })

  return summaries
}

type FacturaSummaryCardProps = {
  summary: FacturaSummaryRow
  isActive: boolean
  onOpen: () => void
}

const FacturaSummaryCard: React.FC<FacturaSummaryCardProps> = ({
  summary,
  isActive,
  onOpen
}) => {
  const clientLabel = formatClientIdentifier(summary.codCliente, summary.nroLugarEntrega)
  const oldestFacturaLabel = formatComprobante(summary.oldestFactura)
  const vencimientoLabel = summary.oldestFactura.fechaVencimiento
  const saldoTotalLabel = formatAmount(summary.totalSaldo)
  const summaryLabel = `Cliente ${clientLabel} - Vencimiento ${oldestFacturaLabel} - Saldo total ${saldoTotalLabel}`

  return (
    <div className={`loan-card ${isActive ? "expanded" : ""}`}>
      <button
        type="button"
        className="loan-card-header"
        onClick={onOpen}
        aria-label={summaryLabel}
      >
        <div className="loan-card-header-info">
          <span className="loan-card-header-item">
            <strong>Cliente:</strong> {clientLabel}
          </span>
          <span className="loan-card-header-item loan-card-header-item--domicilio">
            <strong>Vencimiento:</strong>{" "}
            {vencimientoLabel ? `${vencimientoLabel}` : ""}
          </span>
          <span className="loan-card-header-item">
            <strong>Saldo total:</strong> {saldoTotalLabel}
          </span>
          <span className="loan-card-header-item">
            <strong>Metodos:</strong> {summary.metodosCobro || "-"}
          </span>
        </div>
        <span className="loan-card-indicator" aria-hidden="true">
          Ver
        </span>
      </button>
    </div>
  )
}

type FacturaSummaryModalProps = {
  summary: FacturaSummaryRow
  facturas: FacturaAtrasadaRow[]
  onClose: () => void
}

const FacturaSummaryModal: React.FC<FacturaSummaryModalProps> = ({
  summary,
  facturas,
  onClose
}) => {
  const clientLabel = formatClientIdentifier(summary.codCliente, summary.nroLugarEntrega)
  const oldestFacturaLabel = formatComprobante(summary.oldestFactura)
  const vencimientoLabel = summary.oldestFactura.fechaVencimiento
  const saldoTotalLabel = formatAmount(summary.totalSaldo)
  const summaryLabel = `Cliente ${clientLabel} - Facturas atrasadas`

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
            <span className="loan-summary-modal__eyebrow">Facturas atrasadas</span>
            <h3 className="loan-summary-modal__title">Cliente {clientLabel}</h3>
            <p className="loan-summary-modal__subtitle">
              Lugar de entrega {summary.nroLugarEntrega || "-"}
            </p>
          </div>
          <button className="loan-summary-modal__close" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="loan-summary-modal__summary-grid">
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Factura</span>
            <span className="loan-summary-modal__pill-value">{oldestFacturaLabel}</span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Vencimiento</span>
            <span className="loan-summary-modal__pill-value">{vencimientoLabel || "-"}</span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Saldo total</span>
            <span className="loan-summary-modal__pill-value loan-summary-modal__pill-value--numeric">
              {saldoTotalLabel}
            </span>
          </div>
          <div className="loan-summary-modal__pill">
            <span className="loan-summary-modal__pill-label">Metodos de cobro</span>
            <span className="loan-summary-modal__pill-value">{summary.metodosCobro || "-"}</span>
          </div>
        </div>

        <div className="loan-summary-modal__body">
          <div className="loan-summary-modal__body-header">
            <div className="loan-summary-modal__body-title">Historial completo</div>
            <div className="loan-summary-modal__hint">
              {facturas.length} comprobantes pendientes
            </div>
          </div>
          <div className="loan-summary-modal__content loan-summary-modal__content--single">
            <div className="loan-summary-modal__movements">
              {facturas.length > 0 ? (
                <div className="movement-card-grid">
                  <div className="movement-card movement-card--header movement-card--static" aria-hidden="true">
                    <div className="movement-card-content">
                      <div className="movement-card-group">
                        <span className="movement-card-label">Tipo</span>
                      </div>
                      <div className="movement-card-group">
                        <span className="movement-card-label">Prefijo</span>
                      </div>
                      <div className="movement-card-group">
                        <span className="movement-card-label">Numero</span>
                      </div>
                      <div className="movement-card-group">
                        <span className="movement-card-label">Vence</span>
                      </div>
                      <div className="movement-card-group movement-card-group--numeric">
                        <span className="movement-card-label">Importe</span>
                      </div>
                      <div className="movement-card-group movement-card-group--numeric">
                        <span className="movement-card-label">Cobrado</span>
                      </div>
                      <div className="movement-card-group movement-card-group--numeric">
                        <span className="movement-card-label">Saldo</span>
                      </div>
                    </div>
                  </div>
                  {facturas.map(factura => (
                    <div key={factura.id} className="movement-card movement-card--static">
                      <div className="movement-card-content">
                        <div className="movement-card-group">
                          <span className="movement-card-value">
                            {factura.tipoComprobante || "-"}
                          </span>
                        </div>
                        <div className="movement-card-group">
                          <span className="movement-card-value">{factura.prefijo || "-"}</span>
                        </div>
                        <div className="movement-card-group">
                          <span className="movement-card-value">{factura.numero || "-"}</span>
                        </div>
                        <div className="movement-card-group">
                          <span className="movement-card-value">
                            {factura.fechaVencimiento || "-"}
                          </span>
                        </div>
                        <div className="movement-card-group movement-card-group--numeric">
                          <span className="movement-card-value">
                            {formatAmount(factura.importeTotal)}
                          </span>
                        </div>
                        <div className="movement-card-group movement-card-group--numeric">
                          <span className="movement-card-value">
                            {formatAmount(factura.cobradoTotal)}
                          </span>
                        </div>
                        <div className="movement-card-group movement-card-group--numeric">
                          <span className="movement-card-value">
                            {formatAmount(factura.saldo)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="loan-movements-status">Sin facturas atrasadas.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FacturasAtrasadasView() {
  const electronAPI = window.electronAPI

  const [isLoading, setIsLoading] = useState(false)
  const [summaryRows, setSummaryRows] = useState<FacturaSummaryRow[]>([])
  const [ignoredSummaryRows, setIgnoredSummaryRows] = useState<FacturaSummaryRow[]>([])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [expandedClientKey, setExpandedClientKey] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<MetodoFiltroKey>("all")
  const [isIgnoreLoginOpen, setIsIgnoreLoginOpen] = useState(false)
  const [ignoreUsername, setIgnoreUsername] = useState("")
  const [ignorePassword, setIgnorePassword] = useState("")
  const [ignoreError, setIgnoreError] = useState<string | null>(null)
  const [isIgnoreSubmitting, setIsIgnoreSubmitting] = useState(false)
  const [isIgnoreModalOpen, setIsIgnoreModalOpen] = useState(false)
  const [isIgnoreLoading, setIsIgnoreLoading] = useState(false)
  const [ignoreLoadError, setIgnoreLoadError] = useState<string | null>(null)
  const [ignoreExpandedClientKey, setIgnoreExpandedClientKey] = useState<string | null>(null)
  const [ignoreFilter, setIgnoreFilter] = useState<MetodoFiltroKey>("all")

  useAutoDismissMessage(statusMessage, setStatusMessage, STATUS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, STATUS_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setErrorMessage(null)
    setStatusMessage(null)
  }, [setErrorMessage, setStatusMessage])

  const fetchFacturasData = useCallback(async () => {
    if (!electronAPI?.traer_facturas_atrasadas) {
      throw new Error("No se encuentra disponible la accion de traer facturas atrasadas.")
    }
    if (!electronAPI?.traer_ignorar) {
      throw new Error("No se encuentra disponible la accion de traer ignorar.")
    }

    const [facturasResult, ignorarResult] = await Promise.all([
      electronAPI.traer_facturas_atrasadas(),
      electronAPI.traer_ignorar()
    ])
    if (facturasResult?.error) {
      throw new Error(facturasResult.details || facturasResult.error)
    }
    if (ignorarResult?.error) {
      throw new Error(ignorarResult.details || ignorarResult.error)
    }

    const ignoredIds = new Set<number>()
    ;(ignorarResult?.rows ?? []).forEach(row => {
      const ignoredId = toIgnoredClientId(row as Record<string, unknown>)
      if (ignoredId !== null) {
        ignoredIds.add(ignoredId)
      }
    })

    const mappedRows = (facturasResult?.rows ?? []).map((row, index) =>
      toFacturaRow(row as Record<string, unknown>, index)
    )
    const summaries = buildSummaryRows(mappedRows)

    return { summaries, ignoredIds }
  }, [electronAPI])

  const handleLoadFacturas = async () => {
    setIsLoading(true)
    clearMessages()

    try {
      const { summaries, ignoredIds } = await fetchFacturasData()
      const ignoredSummaries =
        ignoredIds.size > 0
          ? summaries.filter(summary => ignoredIds.has(summary.codCliente))
          : []
      const visibleSummaries =
        ignoredIds.size > 0
          ? summaries.filter(summary => !ignoredIds.has(summary.codCliente))
          : summaries

      setSummaryRows(visibleSummaries)
      setIgnoredSummaryRows(ignoredSummaries)
      setExpandedClientKey(null)

      if (visibleSummaries.length > 0) {
        setStatusMessage("Facturas atrasadas cargadas correctamente.")
      } else {
        setStatusMessage("No hay facturas atrasadas para mostrar.")
      }
    } catch (error) {
      console.error("No se pudieron cargar las facturas atrasadas:", error)
      setSummaryRows([])
      setIgnoredSummaryRows([])
      setExpandedClientKey(null)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al cargar las facturas atrasadas."
      )
    } finally {
      setIsLoading(false)
    }
  }

  const loadIgnoredSummaries = async () => {
    setIsIgnoreLoading(true)
    setIgnoreLoadError(null)
    try {
      const { summaries, ignoredIds } = await fetchFacturasData()
      const ignoredSummaries =
        ignoredIds.size > 0
          ? summaries.filter(summary => ignoredIds.has(summary.codCliente))
          : []
      setIgnoredSummaryRows(ignoredSummaries)
      setIgnoreExpandedClientKey(null)
    } catch (error) {
      console.error("No se pudieron cargar los clientes ignorados:", error)
      setIgnoredSummaryRows([])
      setIgnoreExpandedClientKey(null)
      setIgnoreLoadError(
        error instanceof Error ? error.message : "Error desconocido al cargar los ignorados."
      )
    } finally {
      setIsIgnoreLoading(false)
    }
  }

  const handleOpenCard = (clientKey: string) => {
    setExpandedClientKey(clientKey)
  }

  const handleCloseModal = () => {
    setExpandedClientKey(null)
  }

  const handleOpenIgnoreLogin = () => {
    setIsIgnoreLoginOpen(true)
    setIgnoreUsername("")
    setIgnorePassword("")
    setIgnoreError(null)
  }

  const handleCloseIgnoreLogin = () => {
    if (isIgnoreSubmitting) {
      return
    }
    setIsIgnoreLoginOpen(false)
    setIgnoreError(null)
  }

  const handleIgnoreLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedUser = ignoreUsername.trim()
    if (!trimmedUser || ignorePassword.length === 0) {
      setIgnoreError("Ingrese usuario y contrasena")
      return
    }

    if (!electronAPI?.getAppUser) {
      setIgnoreError("Servicio de autenticacion no disponible")
      return
    }

    setIsIgnoreSubmitting(true)
    setIgnoreError(null)

    try {
      const result = await electronAPI.getAppUser(trimmedUser)
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      const rows = result.rows ?? []
      if (rows.length === 0) {
        setIgnoreError("Credenciales invalidas")
        return
      }

      const row = (rows[0] ?? {}) as Record<string, unknown>
      const rowMap = buildRowMap(row)
      const passwordValue = pickRowValue(rowMap, PASSWORD_FIELD_CANDIDATES)
      if (passwordValue === undefined || passwordValue === null) {
        setIgnoreError("El usuario no tiene contrasena configurada")
        return
      }
      const storedPassword = String(passwordValue).trim()
      if (storedPassword !== ignorePassword) {
        setIgnoreError("Credenciales invalidas")
        return
      }

      const typeValue = pickRowValue(rowMap, TYPE_FIELD_CANDIDATES)
      const userTypeRaw = String(typeValue ?? "").trim().toLowerCase()
      if (userTypeRaw !== "admin") {
        setIgnoreError("Solo administradores pueden acceder a esta vista.")
        return
      }

      setIsIgnoreLoginOpen(false)
      setIsIgnoreModalOpen(true)
      setIgnorePassword("")
      setIgnoreUsername("")
      setIgnoreError(null)
      void loadIgnoredSummaries()
    } catch (error) {
      console.error("No se pudo validar el usuario admin:", error)
      setIgnoreError(
        error instanceof Error ? error.message : "No se pudo validar las credenciales."
      )
    } finally {
      setIsIgnoreSubmitting(false)
    }
  }

  const handleCloseIgnoreModal = () => {
    setIsIgnoreModalOpen(false)
    setIgnoreExpandedClientKey(null)
  }

  const filteredSummaries = useMemo(() => {
    const codes = METODO_FILTRO_CODES[activeFilter]
    if (codes.length === 0) {
      return summaryRows
    }
    const codeSet = new Set(codes.map(code => code.toUpperCase()))
    return summaryRows.filter(summary =>
      summary.facturas.some(factura => hasMetodoCobroCode(factura.metodosCobro, codeSet))
    )
  }, [activeFilter, summaryRows])

  const expandedSummary = useMemo(() => {
    if (!expandedClientKey) {
      return null
    }
    return summaryRows.find(summary => summary.clientKey === expandedClientKey) ?? null
  }, [expandedClientKey, summaryRows])

  const expandedFacturas = useMemo(
    () => (expandedSummary ? expandedSummary.facturas : []),
    [expandedSummary]
  )

  const ignoreFilteredSummaries = useMemo(() => {
    const codes = METODO_FILTRO_CODES[ignoreFilter]
    if (codes.length === 0) {
      return ignoredSummaryRows
    }
    const codeSet = new Set(codes.map(code => code.toUpperCase()))
    return ignoredSummaryRows.filter(summary =>
      summary.facturas.some(factura => hasMetodoCobroCode(factura.metodosCobro, codeSet))
    )
  }, [ignoreFilter, ignoredSummaryRows])

  const ignoreExpandedSummary = useMemo(() => {
    if (!ignoreExpandedClientKey) {
      return null
    }
    return (
      ignoredSummaryRows.find(summary => summary.clientKey === ignoreExpandedClientKey) ?? null
    )
  }, [ignoreExpandedClientKey, ignoredSummaryRows])

  const ignoreExpandedFacturas = useMemo(
    () => (ignoreExpandedSummary ? ignoreExpandedSummary.facturas : []),
    [ignoreExpandedSummary]
  )

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content test-view2-layout facturas-atrasadas-layout">
        <div className="table-container loan-summary-panel">
          <div className="loan-cards">
            {summaryRows.length > 0 ? (
              filteredSummaries.length > 0 ? (
                filteredSummaries.map(summary => (
                  <FacturaSummaryCard
                    key={summary.clientKey}
                    summary={summary}
                    isActive={expandedClientKey === summary.clientKey}
                    onOpen={() => handleOpenCard(summary.clientKey)}
                  />
                ))
              ) : (
                <div className="loan-empty-state">
                  No hay facturas para el filtro seleccionado.
                </div>
              )
            ) : (
              <div className="loan-empty-state">
                No hay datos para mostrar. Utilice el panel derecho para cargar las facturas.
              </div>
            )}
          </div>
        </div>
        <aside className="sidebar loan-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            <button
              className="fetch-button"
              type="button"
              onClick={handleLoadFacturas}
              disabled={isLoading}
            >
              Motrar Facturas
            </button>
            <button
              className="fetch-button"
              type="button"
              onClick={handleOpenIgnoreLogin}
              disabled={isLoading || isIgnoreSubmitting}
            >
              Ignorar
            </button>
            {isLoading && <span className="loan-actions__loading">Cargando...</span>}
          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Filtros</span>
            {METODO_FILTRO_OPCIONES.map(option => (
              <button
                key={option.key}
                className={`fetch-button${activeFilter === option.key ? " fetch-button--active" : ""}`}
                type="button"
                onClick={() => setActiveFilter(option.key)}
                disabled={summaryRows.length === 0}
              >
                {option.label}
              </button>
            ))}
          </div>
        </aside>
      </div>
      {expandedSummary ? (
        <FacturaSummaryModal
          summary={expandedSummary}
          facturas={expandedFacturas}
          onClose={handleCloseModal}
        />
      ) : null}
      {isIgnoreLoginOpen ? (
        <div
          className="admin-login-modal"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseIgnoreLogin}
        >
          <form
            className="login-card admin-login-modal__card"
            onClick={event => event.stopPropagation()}
            onSubmit={handleIgnoreLogin}
          >
            <h2 className="login-title">Acceso Admin</h2>
            <label className="login-field">
              Usuario
              <input
                type="text"
                value={ignoreUsername}
                onChange={event => setIgnoreUsername(event.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>
            <label className="login-field">
              Contrasena
              <input
                type="password"
                value={ignorePassword}
                onChange={event => setIgnorePassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            {ignoreError ? <div className="login-error">{ignoreError}</div> : null}
            <div className="admin-login-modal__actions">
              <button
                className="admin-login-modal__cancel"
                type="button"
                onClick={handleCloseIgnoreLogin}
                disabled={isIgnoreSubmitting}
              >
                Cancelar
              </button>
              <button className="login-button" type="submit" disabled={isIgnoreSubmitting}>
                {isIgnoreSubmitting ? "Ingresando..." : "Ingresar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {isIgnoreModalOpen ? (
        <div
          className="loan-summary-modal"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseIgnoreModal}
        >
          <div
            className="loan-summary-modal__panel facturas-ignoradas-modal__panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="loan-summary-modal__header">
              <div className="loan-summary-modal__title-block">
                <span className="loan-summary-modal__eyebrow">Facturas atrasadas</span>
                <h3 className="loan-summary-modal__title">Clientes ignorados</h3>
                <p className="loan-summary-modal__subtitle">
                  Vista exclusiva para administradores
                </p>
              </div>
              <button
                className="loan-summary-modal__close"
                type="button"
                onClick={handleCloseIgnoreModal}
              >
                Cerrar
              </button>
            </div>
            <div className="facturas-ignoradas-modal__content">
              <div className="content test-view2-layout facturas-atrasadas-layout">
                <div className="table-container loan-summary-panel">
                  <div className="loan-cards">
                    {isIgnoreLoading ? (
                      <div className="loan-empty-state">Cargando clientes ignorados...</div>
                    ) : ignoreLoadError ? (
                      <div className="loan-empty-state">{ignoreLoadError}</div>
                    ) : ignoredSummaryRows.length > 0 ? (
                      ignoreFilteredSummaries.length > 0 ? (
                        ignoreFilteredSummaries.map(summary => (
                          <FacturaSummaryCard
                            key={summary.clientKey}
                            summary={summary}
                            isActive={ignoreExpandedClientKey === summary.clientKey}
                            onOpen={() => setIgnoreExpandedClientKey(summary.clientKey)}
                          />
                        ))
                      ) : (
                        <div className="loan-empty-state">
                          No hay facturas para el filtro seleccionado.
                        </div>
                      )
                    ) : (
                      <div className="loan-empty-state">No hay clientes ignorados.</div>
                    )}
                  </div>
                </div>
                <aside className="sidebar loan-actions">
                  <div className="loan-actions__button-group">
                    <span className="loan-actions__section-title">Acciones</span>
                    <button
                      className="fetch-button"
                      type="button"
                      onClick={loadIgnoredSummaries}
                      disabled={isIgnoreLoading}
                    >
                      Motrar Facturas
                    </button>
                    {isIgnoreLoading && <span className="loan-actions__loading">Cargando...</span>}
                  </div>
                  <div className="loan-actions__divider" aria-hidden="true" />
                  <div className="loan-actions__button-group">
                    <span className="loan-actions__section-title">Filtros</span>
                    {METODO_FILTRO_OPCIONES.map(option => (
                      <button
                        key={option.key}
                        className={`fetch-button${ignoreFilter === option.key ? " fetch-button--active" : ""}`}
                        type="button"
                        onClick={() => setIgnoreFilter(option.key)}
                        disabled={ignoredSummaryRows.length === 0 || isIgnoreLoading}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {ignoreExpandedSummary ? (
        <FacturaSummaryModal
          summary={ignoreExpandedSummary}
          facturas={ignoreExpandedFacturas}
          onClose={() => setIgnoreExpandedClientKey(null)}
        />
      ) : null}
    </>
  )
}
