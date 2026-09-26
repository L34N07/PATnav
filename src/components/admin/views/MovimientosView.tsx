import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  MovimientosAccountState,
  MovimientosApiResult,
  MovimientosItem,
  MovimientosLocation,
  MovimientosPayload
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"
import SpanishDateInput, { formatSpanishDate } from "../../SpanishDateInput"

const MODES = [
  { key: "movimiento", label: "Movimiento" },
  { key: "cobro", label: "Cobro" },
  { key: "venta-ci", label: "Venta CI" },
  { key: "venta-factura", label: "Venta con factura" },
  { key: "eliminar", label: "Eliminar movimiento" },
  { key: "nota-credito", label: "Nota de credito" }
] as const

type Mode = (typeof MODES)[number]["key"]

type Line = {
  codItem: string
  cantidad: string
  precio: string
  tasaIva: string
  fechaPeriodoAbono: string
}

const ERROR_MESSAGE_DURATION_MS = 5000
const SUCCESS_MESSAGE_DURATION_MS = 3000
const LOCAL_LAST_NUMBER_KEY_PREFIX = "patnav.movimientos.lastNumber"
const LEGACY_LOCAL_LAST_CI_KEY = "patnav.movimientos.lastCiUsed"
const DEFAULT_LAST_CI_USED = 465682
const CLIENT_SUGGESTION_LIMIT = 5
const CONTENT_ITEM_IDS = new Set(["1", "2"])
const DEFAULT_CONTENT_ITEM = "1"
const DEFAULT_EMPTY_CONTAINER_ITEM = "5"
const GLOBAL_ABONO_PERIOD_SUGGESTIONS = [
  { period: "2000-01-01", title: "Pinchado" },
  { period: "2001-01-01", title: "Mal Sabor" }
] as const

const todayIsoDate = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`
}

const toDisplay = (value: unknown) => String(value ?? "").trim()

const formatMoney = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(number)
    : "-"
}

const formatPrice = (value: string) => {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(amount)
    : ""
}

const normalizePrice = (value: string) => {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "")
  return normalized === "" || normalized === "." || normalized === "-" ? "" : normalized
}

const savedRowKey = (result: Record<string, unknown>, mode: Mode) => {
  const tipo = toDisplay(result.tipo_comprobante)
  const prefijo = toDisplay(result.prefijo)
  const numero = toDisplay(result.numero)
  if (!tipo || !numero) {
    return null
  }
  if (mode === "cobro") {
    return `cobros:${tipo}/${prefijo}/${numero}`
  }
  if (mode === "movimiento") {
    return `movimientos:${tipo}/${prefijo}/${numero}`
  }
  return `ventas:${tipo}/${prefijo}/${numero}`
}

const movementLabel = (tipo: unknown, prefijo: unknown, numero: unknown) =>
  `${toDisplay(tipo)}/${toDisplay(prefijo)}-${toDisplay(numero)}`

const emptyLine = (codItem = DEFAULT_CONTENT_ITEM): Line => ({
  codItem,
  cantidad: "1",
  precio: "",
  tasaIva: "21",
  fechaPeriodoAbono: ""
})

const defaultMovementLines = () => [
  emptyLine(DEFAULT_CONTENT_ITEM),
  emptyLine(DEFAULT_EMPTY_CONTAINER_ITEM)
]

const lineForPosition = (index: number) =>
  emptyLine(index % 2 === 0 ? DEFAULT_CONTENT_ITEM : DEFAULT_EMPTY_CONTAINER_ITEM)

const parsePositiveQuantity = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const lastNumberStorageKey = (tipoComprobante: "CI" | "RR") =>
  `${LOCAL_LAST_NUMBER_KEY_PREFIX}.${tipoComprobante}`

const readLocalLastNumber = (tipoComprobante: "CI" | "RR") => {
  if (typeof window === "undefined") {
    return tipoComprobante === "CI" ? DEFAULT_LAST_CI_USED : null
  }
  const storageKey = lastNumberStorageKey(tipoComprobante)
  const storedValue = window.localStorage.getItem(storageKey)
  const stored = Number(storedValue)
  if (Number.isFinite(stored) && stored > 0) {
    return stored
  }
  if (tipoComprobante === "CI") {
    const legacy = Number(window.localStorage.getItem(LEGACY_LOCAL_LAST_CI_KEY))
    const initial = Number.isFinite(legacy) && legacy > 0 ? legacy : DEFAULT_LAST_CI_USED
    window.localStorage.setItem(storageKey, String(initial))
    return initial
  }
  return null
}

const itemLabel = (item: MovimientosItem) =>
  `${item.cod_item} ${toDisplay(item.denom_corto || item.denominacion)}`.trim()

const locationTitle = (location: MovimientosLocation) =>
  toDisplay(location.razon_social || location.label)

const locationAddress = (location: MovimientosLocation) =>
  toDisplay(location.direccion)

const locationIdentity = (location: MovimientosLocation) =>
  `Cliente ${location.cod_cliente} / Punto ${location.nro_lugar_entrega}`

export default function MovimientosView() {
  const electronAPI = window.electronAPI
  const [mode, setMode] = useState<Mode>("movimiento")
  const [query, setQuery] = useState("")
  const [locations, setLocations] = useState<MovimientosLocation[]>([])
  const [selectedLocation, setSelectedLocation] = useState<MovimientosLocation | null>(null)
  const [itemsCatalog, setItemsCatalog] = useState<MovimientosItem[]>([])
  const [account, setAccount] = useState<MovimientosAccountState | null>(null)
  const [abonos, setAbonos] = useState<Array<Record<string, unknown>>>([])
  const [pendingVentas, setPendingVentas] = useState<Array<Record<string, unknown>>>([])
  const [creditInvoices, setCreditInvoices] = useState<Array<Record<string, unknown>>>([])
  const [selectedCreditInvoiceKey, setSelectedCreditInvoiceKey] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [fecha, setFecha] = useState(todayIsoDate)
  const [fechaMovimiento, setFechaMovimiento] = useState(todayIsoDate)
  const [fechaReferencia, setFechaReferencia] = useState(todayIsoDate)
  const [tipoMovimiento, setTipoMovimiento] = useState<"CI" | "RR">("CI")
  const [tipoFactura, setTipoFactura] = useState<"FA" | "FB">("FA")
  const [tipoNotaCredito, setTipoNotaCredito] = useState<"FA" | "FB">("FA")
  const [prefijoNotaCredito, setPrefijoNotaCredito] = useState("7")
  const [numeroNotaCredito, setNumeroNotaCredito] = useState("")
  const [prefijoRr, setPrefijoRr] = useState("")
  const [numero, setNumero] = useState("")
  const [numeroCi, setNumeroCi] = useState("")
  const [importeCobro, setImporteCobro] = useState("")
  const [selectedVentaKey, setSelectedVentaKey] = useState("")
  const [lines, setLines] = useState<Line[]>(defaultMovementLines)
  const [envaseVacioItem, setEnvaseVacioItem] = useState("5")
  const [envaseVacioCantidad, setEnvaseVacioCantidad] = useState("")
  const [suggestedNumber, setSuggestedNumber] = useState<number | null>(null)
  const [confirmFiscalSave, setConfirmFiscalSave] = useState(false)
  const [confirmCreditNote, setConfirmCreditNote] = useState(false)
  const [abonoPairCursor, setAbonoPairCursor] = useState(0)
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null)
  const [deletePreview, setDeletePreview] = useState<Record<string, unknown> | null>(null)
  const [deletePreviewTarget, setDeletePreviewTarget] = useState<string | null>(null)
  const [ventaDetail, setVentaDetail] = useState<{
    venta: Record<string, unknown>
    items: Array<Record<string, unknown>>
  } | null>(null)
  const lastNumberTarget = useRef<string | null>(null)
  const abonoRequestId = useRef(0)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  useEffect(() => {
    if (!highlightedRow) {
      return
    }
    const timeout = window.setTimeout(() => setHighlightedRow(null), 1650)
    return () => window.clearTimeout(timeout)
  }, [highlightedRow])

  const selectedIdentity = useMemo(
    () =>
      selectedLocation
        ? {
            codCliente: selectedLocation.cod_cliente,
            nroLugarEntrega: selectedLocation.nro_lugar_entrega
          }
        : null,
    [selectedLocation]
  )

  const selectedVenta = useMemo(
    () =>
      pendingVentas.find(
        venta =>
          `${venta.tipo_comprobante}/${venta.prefijo}/${venta.numero}` === selectedVentaKey
      ) || null,
    [pendingVentas, selectedVentaKey]
  )

  const selectedCreditInvoice = useMemo(
    () => creditInvoices.find(invoice =>
      `${invoice.tipo_comprobante}/${invoice.prefijo}/${invoice.numero}` === selectedCreditInvoiceKey
    ) || null,
    [creditInvoices, selectedCreditInvoiceKey]
  )

  const availableItems = useMemo(
    () => itemsCatalog.filter(item => [1, 2, 5, 6].includes(Number(item.cod_item))),
    [itemsCatalog]
  )
  const saleItems = useMemo(
    () => itemsCatalog.filter(item => [1, 2].includes(Number(item.cod_item))),
    [itemsCatalog]
  )

  const numberTarget = useMemo(() => {
    if (mode === "eliminar" || mode === "nota-credito") {
      return null
    }
    if (mode === "movimiento") {
      return {
        tipoComprobante: tipoMovimiento,
        prefijo: tipoMovimiento === "CI" ? 0 : prefijoRr,
        field: "numero" as const
      }
    }
    if (mode === "cobro") {
      return { tipoComprobante: "CI", prefijo: 0, field: "numero" as const }
    }
    if (mode === "venta-ci" || mode === "venta-factura") {
      return { tipoComprobante: "CI", prefijo: 0, field: "numeroCi" as const }
    }
    return null
  }, [mode, prefijoRr, tipoMovimiento])
  const numberTargetKey = numberTarget
    ? `${numberTarget.tipoComprobante}/${numberTarget.prefijo}`
    : null

  const requiresClient = mode !== "eliminar"
  const canOperate = !isLoading && (!requiresClient || Boolean(selectedLocation))
  const deleteTarget = useMemo(() => {
    if (mode !== "eliminar") {
      return null
    }
    const cleanNumber = String(numero || "").replace(/\D/g, "")
    const cleanPrefix = tipoMovimiento === "CI" ? "0" : String(prefijoRr || "").trim()
    return cleanNumber && cleanPrefix ? `${tipoMovimiento}/${cleanPrefix}/${cleanNumber}` : null
  }, [mode, numero, prefijoRr, tipoMovimiento])
  const deletePreviewReady = Boolean(
    deletePreview &&
      deletePreviewTarget === deleteTarget &&
      !deletePreview.error &&
      !deletePreview.blocked
  )

  const payloadBase = useCallback((): MovimientosPayload => {
    if (!selectedIdentity) {
      throw new Error("Seleccione cliente y punto.")
    }
    return {
      environment: "produccion",
      codCliente: selectedIdentity.codCliente,
      nroLugarEntrega: selectedIdentity.nroLugarEntrega,
      fecha
    }
  }, [fecha, selectedIdentity])

  const handleResponse = async <T,>(promise: Promise<MovimientosApiResult<T>>) => {
    const response = await promise
    if (response.error) {
      throw new Error(response.details || response.error)
    }
    return response.result as T
  }

  const refreshAccount = useCallback(async () => {
    if (!selectedIdentity || !electronAPI?.movimientosAccountState) {
      return
    }
    const result = await handleResponse(
      electronAPI.movimientosAccountState({
        environment: "produccion",
        ...selectedIdentity,
        limit: 30
      } as MovimientosPayload)
    )
    setAccount(result)
  }, [electronAPI, selectedIdentity])

  const refreshPendingVentas = useCallback(async () => {
    if (!selectedIdentity) {
      return
    }
    const base = { environment: "produccion", ...selectedIdentity, limit: 25 }
    if (electronAPI?.movimientosPendingVentas) {
      const result = await handleResponse(electronAPI.movimientosPendingVentas(base as MovimientosPayload))
      setPendingVentas(result as Array<Record<string, unknown>>)
    }
  }, [electronAPI, selectedIdentity])

  const refreshAbonos = useCallback(async () => {
    if (!selectedIdentity || !electronAPI?.movimientosAvailableAbonos) {
      setAbonos([])
      return
    }
    const requestId = ++abonoRequestId.current
    const result = await handleResponse(
      electronAPI.movimientosAvailableAbonos({
        environment: "produccion",
        ...selectedIdentity,
        fechaReferencia
      } as MovimientosPayload)
    )
    if (requestId === abonoRequestId.current) {
      setAbonos(result as Array<Record<string, unknown>>)
    }
  }, [electronAPI, fechaReferencia, selectedIdentity])

  const refreshCreditInvoices = useCallback(async () => {
    if (!selectedIdentity || !electronAPI?.movimientosCreditInvoices) {
      setCreditInvoices([])
      return
    }
    const result = await handleResponse(
      electronAPI.movimientosCreditInvoices({
        environment: "produccion",
        ...selectedIdentity
      } as MovimientosPayload)
    )
    setCreditInvoices(result as Array<Record<string, unknown>>)
  }, [electronAPI, selectedIdentity])

  const refreshAuxiliaryData = useCallback(async () => {
    await Promise.all([refreshAccount(), refreshPendingVentas(), refreshAbonos(), refreshCreditInvoices()])
  }, [refreshAbonos, refreshAccount, refreshCreditInvoices, refreshPendingVentas])

  const openVentaDetail = useCallback(async (venta: Record<string, unknown>) => {
    if (!electronAPI?.movimientosVentaItems) {
      setErrorMessage("Detalle de ventas no disponible.")
      return
    }
    setErrorMessage(null)
    try {
      const items = await handleResponse<Array<Record<string, unknown>>>(
        electronAPI.movimientosVentaItems({
          environment: "produccion",
          tipoComprobante: toDisplay(venta.tipo_comprobante),
          prefijo: toDisplay(venta.prefijo),
          numero: toDisplay(venta.numero)
        })
      )
      setVentaDetail({ venta, items })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar el detalle de la venta.")
    }
  }, [electronAPI])

  useEffect(() => {
    if (!electronAPI?.movimientosInitialData) {
      return
    }
    handleResponse(electronAPI.movimientosInitialData({ environment: "produccion" }))
      .then(result => {
        const data = result as { items?: MovimientosItem[] }
        setItemsCatalog(data.items ?? [])
        const suggested = String((readLocalLastNumber("CI") || DEFAULT_LAST_CI_USED) + 1)
        setNumero(current => current || suggested)
        setNumeroCi(current => current || suggested)
      })
      .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar datos iniciales."))
  }, [electronAPI])

  useEffect(() => {
    if (!numberTarget || !numberTargetKey) {
      setSuggestedNumber(null)
      return
    }
    const previous = readLocalLastNumber(numberTarget.tipoComprobante)
    const next = previous ? previous + 1 : null
    setSuggestedNumber(next)

    if (lastNumberTarget.current !== numberTargetKey) {
      lastNumberTarget.current = numberTargetKey
      if (numberTarget.field === "numero") {
        setNumero(next ? String(next) : "")
      } else {
        setNumeroCi(next ? String(next) : "")
      }
    }
  }, [numberTarget, numberTargetKey])

  useEffect(() => {
    if (!electronAPI?.movimientosSearchLocations) {
      return
    }
    const trimmedQuery = query.trim()
    if (selectedLocation && trimmedQuery === locationTitle(selectedLocation)) {
      setLocations([])
      return
    }
    if (trimmedQuery.length < 2) {
      setLocations([])
      return
    }

    const timeout = window.setTimeout(() => {
      electronAPI
        .movimientosSearchLocations({ environment: "produccion", query: trimmedQuery, limit: CLIENT_SUGGESTION_LIMIT })
        .then(response => {
          if (response.error) {
            throw new Error(response.details || response.error)
          }
          if (selectedLocation && trimmedQuery === locationTitle(selectedLocation)) {
            setLocations([])
            return
          }
          setLocations(response.result ?? [])
        })
        .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudo buscar clientes."))
    }, 220)
    return () => window.clearTimeout(timeout)
  }, [electronAPI, query, selectedLocation])

  useEffect(() => {
    setDeletePreview(null)
    setDeletePreviewTarget(null)
    if (!deleteTarget || !electronAPI?.movimientosPreviewDelete) {
      return
    }

    const cleanNumber = String(numero || "").replace(/\D/g, "")
    const cleanPrefix = tipoMovimiento === "CI" ? "0" : String(prefijoRr || "").trim()

    let cancelled = false
    const timeout = window.setTimeout(() => {
      electronAPI
        .movimientosPreviewDelete({
          environment: "produccion",
          tipoComprobante: tipoMovimiento,
          prefijo: cleanPrefix,
          numero: cleanNumber
        })
        .then(response => {
          if (cancelled) return
          if (response.error) {
            setDeletePreview({ error: response.details || response.error })
            setDeletePreviewTarget(deleteTarget)
            return
          }
          setDeletePreview((response.result as Record<string, unknown>) || null)
          setDeletePreviewTarget(deleteTarget)
        })
        .catch(error => {
          if (!cancelled) {
            setDeletePreview({ error: error instanceof Error ? error.message : "No se pudo buscar el movimiento." })
            setDeletePreviewTarget(deleteTarget)
          }
        })
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [deleteTarget, electronAPI, numero, prefijoRr, tipoMovimiento])

  useEffect(() => {
    Promise.all([refreshAccount(), refreshPendingVentas()]).catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar la cuenta.")
    )
  }, [refreshAccount, refreshPendingVentas])

  useEffect(() => {
    const fiscalType = toDisplay(selectedLocation?.tipofactura).toUpperCase()
    if (fiscalType === "A") {
      setTipoFactura("FA")
    }
    if (fiscalType === "B") {
      setTipoFactura("FB")
    }
  }, [selectedLocation])

  useEffect(() => {
    abonoRequestId.current += 1
    setAbonoPairCursor(0)
    setAbonos([])
  }, [selectedLocation?.cod_cliente, selectedLocation?.nro_lugar_entrega])

  useEffect(() => {
    refreshAbonos().catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar abonos.")
    )
  }, [refreshAbonos])

  useEffect(() => {
    setSelectedCreditInvoiceKey("")
    setNumeroNotaCredito("")
    refreshCreditInvoices().catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar las facturas del cliente.")
    )
  }, [refreshCreditInvoices])

  const buildLines = () =>
    lines.map(line => ({
      codItem: line.codItem,
      cantidad: line.cantidad,
      precio: line.precio || getCatalogItem(line.codItem)?.precio || 0,
      tasaIva: line.tasaIva || getCatalogItem(line.codItem)?.tasa_iva || 21,
      litrosAbonados: getCatalogItem(line.codItem)?.litros_abonados || 0,
      fechaPeriodoAbono: mode === "movimiento" ? line.fechaPeriodoAbono || undefined : undefined
    }))

  const buildSaleMovementLines = () => {
    const movementLines = [...buildLines()]
    const envases = parsePositiveQuantity(envaseVacioCantidad)
    if (envases > 0) {
      movementLines.push({
        codItem: envaseVacioItem,
        cantidad: String(envases),
        precio: 0,
        tasaIva: getCatalogItem(envaseVacioItem)?.tasa_iva || 21,
        litrosAbonados: 0,
        envaseVacio: true
      })
    }
    return movementLines
  }

  const rememberLocalNumber = (tipoComprobante: "CI" | "RR", value: unknown) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      window.localStorage.setItem(lastNumberStorageKey(tipoComprobante), String(parsed))
      if (numberTarget?.tipoComprobante === tipoComprobante) {
        setSuggestedNumber(parsed + 1)
      }
    }
  }

  const getCatalogItem = (codItem: string) =>
    itemsCatalog.find(item => String(item.cod_item) === String(codItem))

  const buildPayload = (includeConfirmation = false): MovimientosPayload => {
    if (mode === "nota-credito") {
      return {
        environment: "produccion",
        mode,
        tipoComprobante: tipoNotaCredito,
        prefijo: prefijoNotaCredito,
        numero: numeroNotaCredito,
        fecha,
        representada: "20220334857",
        confirmation:
          includeConfirmation && confirmCreditNote ? "AUTORIZAR_NC_Y_GUARDAR" : undefined
      }
    }

    const base = payloadBase()

    if (mode === "movimiento") {
      return {
        ...base,
        mode,
        tipoComprobante: tipoMovimiento,
        prefijo: tipoMovimiento === "CI" ? 0 : prefijoRr,
        numero,
        fechaReferencia,
        items: buildLines()
      }
    }

    if (mode === "cobro") {
      if (!selectedVenta) {
        throw new Error("Seleccione una venta pendiente.")
      }
      return {
        ...base,
        mode,
        numeroRecibo: numero,
        importe: importeCobro,
        venta: {
          tipoComprobante: selectedVenta.tipo_comprobante,
          prefijo: selectedVenta.prefijo,
          numero: selectedVenta.numero
        }
      }
    }

    if (mode === "venta-ci") {
      return {
        ...base,
        mode,
        numeroCi,
        items: buildLines(),
        movItems: buildSaleMovementLines()
      }
    }

    if (mode === "venta-factura") {
      return {
        ...base,
        mode,
        tipoComprobante: tipoFactura,
        numeroCi,
        fechaMovimiento,
        representada: "20220334857",
        items: buildLines(),
        movItems: buildSaleMovementLines(),
        confirmation: includeConfirmation && confirmFiscalSave ? "AUTORIZAR_Y_GUARDAR" : undefined
      }
    }

    return {
      ...base,
      mode: "movimiento"
    }
  }

  const runSave = async () => {
    setErrorMessage(null)
    setStatusMessage(null)
    setIsLoading(true)
    try {
      if (mode === "eliminar") {
        if (!electronAPI?.movimientosDelete) {
          throw new Error("Servicio de eliminacion no disponible.")
        }
        if (!deletePreviewReady || !deletePreview) {
          throw new Error("Espere la verificacion del movimiento a eliminar.")
        }
        if (deletePreview.error) {
          throw new Error(toDisplay(deletePreview.error))
        }
        if (deletePreview.blocked) {
          throw new Error(toDisplay(deletePreview.blockReason) || "Este movimiento no se puede eliminar.")
        }
        const result = await handleResponse(
          electronAPI.movimientosDelete({
            environment: "produccion",
            tipoComprobante: tipoMovimiento,
            prefijo: tipoMovimiento === "CI" ? 0 : prefijoRr,
            numero
          })
        )
        setHighlightedRow(savedRowKey(result, mode))
        setDeletePreview(null)
        setDeletePreviewTarget(null)
      } else {
        if (!electronAPI?.movimientosSave) {
          throw new Error("Servicio de guardado no disponible.")
        }
        const result = await handleResponse(electronAPI.movimientosSave(buildPayload(true)))
        if (mode === "venta-factura" && result.status !== "ok") {
          if (result.status === "arca_authorized_db_failed") {
            const arca = (result.arca as { response?: { cbteNro?: number | string; cbteTipo?: number | string } } | undefined)?.response
            const label = arca?.cbteNro ? ` (${tipoFactura}/8-${arca.cbteNro})` : ""
            throw new Error(`ARCA autorizo la factura${label}, pero NAVIERA no pudo guardarla. No se emitira otra automaticamente.`)
          }
          const arca = (result.arca as { response?: { observaciones?: Array<{ msg?: string }>; errores?: Array<{ msg?: string }> } } | undefined)?.response
          const details = [...(arca?.observaciones || []), ...(arca?.errores || [])]
            .map(issue => issue.msg)
            .filter(Boolean)
            .join(" ")
          throw new Error(details || "ARCA no autorizo la factura; no se guardo nada en NAVIERA.")
        }
        if (mode === "nota-credito" && result.status !== "ok") {
          if (result.status === "arca_authorized_db_failed") {
            const credit = result.credit as { tipoComprobante?: string; prefijo?: number | string; numero?: number | string } | undefined
            const creditLabel = credit?.tipoComprobante && credit?.numero
              ? ` ${credit.tipoComprobante}/${credit.prefijo}-${credit.numero}`
              : ""
            throw new Error(`ARCA autorizo la NC${creditLabel}, pero NAVIERA no pudo registrarla. No se emitira otra automaticamente.`)
          }
          const arca = (result.arca as { response?: { observaciones?: Array<{ msg?: string }>; errores?: Array<{ msg?: string }> } } | undefined)?.response
          const details = [...(arca?.observaciones || []), ...(arca?.errores || [])]
            .map(issue => issue.msg)
            .filter(Boolean)
            .join(" ")
          throw new Error(result.localError || details || "ARCA no autorizo la nota de credito.")
        }
        setHighlightedRow(savedRowKey(result, mode))
        if (mode === "movimiento" && tipoMovimiento === "CI") {
          rememberLocalNumber("CI", numero)
        }
        if (mode === "movimiento" && tipoMovimiento === "RR") {
          rememberLocalNumber("RR", numero)
        }
        if (mode === "cobro") {
          rememberLocalNumber("CI", numero)
        }
        if (mode === "venta-ci" || mode === "venta-factura") {
          rememberLocalNumber("CI", numeroCi)
        }
      }
      setStatusMessage(
        mode === "nota-credito"
          ? "Nota de credito autorizada y factura transformada."
          : mode === "eliminar"
            ? "Movimiento eliminado."
            : "Operacion guardada."
      )
      await refreshAuxiliaryData()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar.")
    } finally {
      setIsLoading(false)
    }
  }

  const updateLine = (index: number, field: keyof Line, value: string) => {
    setLines(current =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line
        }
        const next = { ...line, [field]: value }
        if (field === "codItem") {
          const catalogItem = getCatalogItem(value)
          next.precio = catalogItem?.precio ? String(catalogItem.precio) : next.precio
          next.tasaIva = catalogItem?.tasa_iva ? String(catalogItem.tasa_iva) : next.tasaIva
        }
        return next
      })
    )
  }

  const showItemLines = mode !== "cobro" && mode !== "eliminar" && mode !== "nota-credito"

  const addLine = () => {
    setLines(current => [...current, lineForPosition(current.length)])
  }

  const applyAbonoPeriod = (period: string) => {
    const cleanPeriod = toDisplay(period)
    if (!cleanPeriod) {
      return
    }
    setLines(current => {
      const workingLines = current.length ? current : defaultMovementLines()
      const pairCount = Math.max(1, Math.ceil(workingLines.length / 2))
      const pairIndex = workingLines.length <= 2 ? 0 : abonoPairCursor % pairCount
      const firstIndex = pairIndex * 2

      return workingLines.map((line, index) =>
        index === firstIndex || index === firstIndex + 1
          ? { ...line, fechaPeriodoAbono: cleanPeriod }
          : line
      )
    })
    setAbonoPairCursor(current => {
      const pairCount = Math.max(1, Math.ceil(lines.length / 2))
      return lines.length <= 2 ? 0 : (current + 1) % pairCount
    })
  }

  useEffect(() => {
    setAbonoPairCursor(0)
    if (mode === "movimiento") {
      setLines(current => {
        if (current.length > 1) {
          return current
        }
        return defaultMovementLines()
      })
      return
    }
    if (mode === "venta-ci" || mode === "venta-factura") {
      setLines(current => {
        const contentLines = current.filter(line => CONTENT_ITEM_IDS.has(String(line.codItem)))
        return contentLines.length ? contentLines : [emptyLine(DEFAULT_CONTENT_ITEM)]
      })
    }
  }, [mode])

  return (
    <div className="content movimientos-layout">
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />

      <main className="movimientos-main">
        <section className="movimientos-modebar">
          {MODES.map(option => (
            <button
              type="button"
              key={option.key}
              className={`movimientos-mode-button${mode === option.key ? " movimientos-mode-button--active" : ""}`}
              onClick={() => {
                setMode(option.key)
                setConfirmFiscalSave(false)
                setConfirmCreditNote(false)
                setLines(option.key === "movimiento" ? defaultMovementLines() : [emptyLine()])
                setEnvaseVacioCantidad("")
              }}
            >
              {option.label}
            </button>
          ))}
        </section>

        {mode !== "eliminar" ? (
          <section className="movimientos-selector">
            <div className="movimientos-search-panel">
              <label className="movimientos-field movimientos-field--wide">
                <span>Cliente / punto</span>
                <input
                  value={query}
                  onChange={event => {
                    const nextQuery = event.target.value
                    setQuery(nextQuery)
                    if (selectedLocation && nextQuery !== locationTitle(selectedLocation)) {
                      setSelectedLocation(null)
                    }
                  }}
                  onFocus={event => event.currentTarget.select()}
                  placeholder="Nombre, codigo o direccion"
                />
              </label>
              {selectedLocation ? (
                <div className="movimientos-selected-client">
                  <strong>{locationTitle(selectedLocation)}</strong>
                  <span>{locationAddress(selectedLocation) || "-"}</span>
                  <small>{locationIdentity(selectedLocation)}</small>
                </div>
              ) : (
                <div className="movimientos-selected-client movimientos-selected-client--empty">
                  <span>Sin cliente seleccionado.</span>
                </div>
              )}
            </div>
            <div className="movimientos-results">
              {locations.slice(0, CLIENT_SUGGESTION_LIMIT).map(location => (
                <button
                  type="button"
                  key={`${location.cod_cliente}-${location.nro_lugar_entrega}`}
                  className={`movimientos-result${
                    selectedLocation?.cod_cliente === location.cod_cliente &&
                    selectedLocation?.nro_lugar_entrega === location.nro_lugar_entrega
                      ? " movimientos-result--active"
                      : ""
                  }`}
                  onClick={() => {
                    setSelectedLocation(location)
                    setQuery(locationTitle(location))
                    setLocations([])
                  }}
                >
                  <strong>{locationTitle(location)}</strong>
                  <span>{locationAddress(location) || "-"}</span>
                  <small>{locationIdentity(location)}</small>
                </button>
              ))}
              {query.trim().length >= 2 && !locations.length ? (
                <span className="movimientos-empty-suggestions">Sin coincidencias.</span>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="movimientos-workspace">
          <div className="movimientos-form">
            {mode === "movimiento" ? (
              <>
                <FormRow>
                  <DateField label="Fecha remito" value={fecha} onChange={setFecha} />
                  <DateField label="Fecha referencia" value={fechaReferencia} onChange={setFechaReferencia} />
                  <SelectField label="Tipo" value={tipoMovimiento} onChange={value => setTipoMovimiento(value as "CI" | "RR")}>
                    <option value="CI">CI</option>
                    <option value="RR">RR</option>
                  </SelectField>
                  {tipoMovimiento === "RR" ? (
                    <TextField label="Prefijo RR" value={prefijoRr} onChange={setPrefijoRr} />
                  ) : null}
                  <NumberPartsField label="Numero" value={numero} onChange={setNumero} />
                </FormRow>
                <NumberSuggestion
                  value={suggestedNumber}
                  onPick={() => {
                    if (suggestedNumber) {
                      setNumero(String(suggestedNumber))
                    }
                  }}
                />
                <AbonosSelector abonos={abonos} onPick={applyAbonoPeriod} />
              </>
            ) : null}

            {mode === "cobro" ? (
              <>
                <FormRow>
                  <DateField label="Fecha recibo" value={fecha} onChange={setFecha} />
                  <NumberPartsField label="Numero CI" value={numero} onChange={setNumero} />
                  <MoneyField label="Importe" value={importeCobro} onChange={setImporteCobro} />
                </FormRow>
                <NumberSuggestion
                  value={suggestedNumber}
                  onPick={() => {
                    if (suggestedNumber) {
                      setNumero(String(suggestedNumber))
                    }
                  }}
                />
                <label className="movimientos-field movimientos-field--wide">
                  <span>Venta pendiente</span>
                  <select value={selectedVentaKey} onChange={event => setSelectedVentaKey(event.target.value)}>
                    <option value="">Seleccionar</option>
                    {pendingVentas.map(venta => (
                      <option
                        key={`${venta.tipo_comprobante}/${venta.prefijo}/${venta.numero}`}
                        value={`${venta.tipo_comprobante}/${venta.prefijo}/${venta.numero}`}
                      >
                        {venta.comprobante} - Saldo {formatMoney(venta.saldo)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            {mode === "venta-ci" ? (
              <>
                <FormRow>
                  <DateField label="Fecha" value={fecha} onChange={setFecha} />
                  <NumberPartsField label="Numero CI" value={numeroCi} onChange={setNumeroCi} />
                </FormRow>
                <NumberSuggestion
                  value={suggestedNumber}
                  onPick={() => {
                    if (suggestedNumber) {
                      setNumeroCi(String(suggestedNumber))
                    }
                  }}
                />
                <EnvasesVaciosFields
                  item={envaseVacioItem}
                  cantidad={envaseVacioCantidad}
                  onItem={setEnvaseVacioItem}
                  onCantidad={setEnvaseVacioCantidad}
                />
              </>
            ) : null}

            {mode === "venta-factura" ? (
              <>
                <FormRow>
                  <DateField label="Fecha factura" value={fecha} onChange={setFecha} />
                  <DateField label="Fecha movimiento" value={fechaMovimiento} onChange={setFechaMovimiento} />
                  <SelectField label="Factura" value={tipoFactura} onChange={value => setTipoFactura(value as "FA" | "FB")}>
                    <option value="FA">FA/8</option>
                    <option value="FB">FB/8</option>
                  </SelectField>
                  <NumberPartsField label="Numero CI" value={numeroCi} onChange={setNumeroCi} />
                </FormRow>
                <NumberSuggestion
                  value={suggestedNumber}
                  onPick={() => {
                    if (suggestedNumber) {
                      setNumeroCi(String(suggestedNumber))
                    }
                  }}
                />
                <EnvasesVaciosFields
                  item={envaseVacioItem}
                  cantidad={envaseVacioCantidad}
                  onItem={setEnvaseVacioItem}
                  onCantidad={setEnvaseVacioCantidad}
                />
              </>
            ) : null}

            {mode === "eliminar" ? (
              <>
                <FormRow>
                  <SelectField label="Tipo" value={tipoMovimiento} onChange={value => setTipoMovimiento(value as "CI" | "RR")}>
                    <option value="CI">CI</option>
                    <option value="RR">RR</option>
                  </SelectField>
                  {tipoMovimiento === "RR" ? (
                    <TextField label="Prefijo RR" value={prefijoRr} onChange={setPrefijoRr} />
                  ) : null}
                  <NumberPartsField label="Numero" value={numero} onChange={setNumero} />
                </FormRow>
                <DeleteMovementPreview value={deletePreview} />
              </>
            ) : null}

            {mode === "nota-credito" ? (
              <>
                <FormRow>
                  <DateField label="Fecha NC" value={fecha} onChange={setFecha} />
                  <label className="movimientos-field movimientos-field--wide">
                    <span>Factura original</span>
                    <select
                      value={selectedCreditInvoiceKey}
                      disabled={!selectedLocation}
                      onChange={event => {
                        const key = event.target.value
                        setSelectedCreditInvoiceKey(key)
                        const invoice = creditInvoices.find(item =>
                          `${item.tipo_comprobante}/${item.prefijo}/${item.numero}` === key
                        )
                        if (!invoice) {
                          setNumeroNotaCredito("")
                          return
                        }
                        setTipoNotaCredito(toDisplay(invoice.tipo_comprobante) as "FA" | "FB")
                        setPrefijoNotaCredito(toDisplay(invoice.prefijo))
                        setNumeroNotaCredito(toDisplay(invoice.numero))
                      }}
                    >
                      <option value="">
                        {selectedLocation ? "Seleccionar factura autorizada" : "Seleccione primero cliente y punto"}
                      </option>
                      {creditInvoices.map(invoice => (
                        <option
                          key={`${invoice.tipo_comprobante}/${invoice.prefijo}/${invoice.numero}`}
                          value={`${invoice.tipo_comprobante}/${invoice.prefijo}/${invoice.numero}`}
                        >
                          {toDisplay(invoice.tipo_comprobante)}/{toDisplay(invoice.prefijo)}-{toDisplay(invoice.numero)} | {formatSpanishDate(toDisplay(invoice.fecha_operacion))} | {formatMoney(invoice.total)}
                        </option>
                      ))}
                    </select>
                  </label>
                </FormRow>
                <label className="movimientos-check">
                  <input
                    type="checkbox"
                    checked={confirmCreditNote}
                    onChange={event => setConfirmCreditNote(event.target.checked)}
                  />
                  <span>Autorizar NC y transformar factura</span>
                </label>
              </>
            ) : null}

            {showItemLines ? (
              <LineEditor
                lines={lines}
                itemsCatalog={mode === "venta-ci" || mode === "venta-factura" ? saleItems : availableItems}
                showPrice={mode !== "movimiento"}
                showPeriod={mode === "movimiento"}
                onChange={updateLine}
                onAdd={addLine}
                onRemove={index => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))}
              />
            ) : null}

            {mode === "venta-factura" ? (
              <label className="movimientos-check">
                <input
                  type="checkbox"
                  checked={confirmFiscalSave}
                  onChange={event => setConfirmFiscalSave(event.target.checked)}
                />
                <span>Autorizar con CAE y guardar</span>
              </label>
            ) : null}

            <div className="movimientos-actions">
              <button
                type="button"
                className="fetch-button fetch-button--success"
                onClick={runSave}
                disabled={
                  !canOperate ||
                  (mode === "eliminar" && !deletePreviewReady) ||
                  (mode === "venta-factura" && !confirmFiscalSave) ||
                  (mode === "nota-credito" && (!confirmCreditNote || !selectedCreditInvoice))
                }
              >
                {mode === "venta-factura"
                  ? "Autorizar y guardar"
                  : mode === "nota-credito"
                    ? "Autorizar NC"
                    : mode === "eliminar"
                      ? "Eliminar"
                      : "Guardar"}
              </button>
            </div>
            <VentaDetail value={ventaDetail} onClose={() => setVentaDetail(null)} />
          </div>

          <AccountPanel
            account={account}
            highlightedRow={highlightedRow}
            onSelectVenta={openVentaDetail}
          />
        </section>
      </main>
    </div>
  )
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="movimientos-form-row">{children}</div>
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  selectOnFocus = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  selectOnFocus?: boolean
}) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        onFocus={event => {
          if (selectOnFocus) {
            event.currentTarget.select()
          }
        }}
        placeholder={placeholder}
      />
    </label>
  )
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <input
        className="movimientos-money-input"
        inputMode="decimal"
        value={formatPrice(value)}
        onChange={event => onChange(normalizePrice(event.target.value))}
      />
    </label>
  )
}

function NumberPartsField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const splitNumber = (numberValue: string) => {
    const digits = String(numberValue || "").replace(/\D/g, "")
    if (!digits) {
      return { first: "", second: "" }
    }
    if (digits.length <= 3) {
      return { first: digits, second: "" }
    }
    return { first: digits.slice(0, -3), second: digits.slice(-3) }
  }
  const [parts, setParts] = useState(() => splitNumber(value))
  const lastEmittedValue = useRef<string | null>(null)

  useEffect(() => {
    const normalized = String(value || "").replace(/\D/g, "")
    const numericValue = normalized ? String(Number(normalized)) : ""
    if (lastEmittedValue.current !== numericValue) {
      setParts(splitNumber(value))
      lastEmittedValue.current = numericValue
    }
  }, [value])

  const setPart = (part: "first" | "second", next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, 3)
    const updated = { ...parts, [part]: clean }
    const joined = `${updated.first}${updated.second}`
    const numericValue = joined ? String(Number(joined)) : ""
    lastEmittedValue.current = numericValue
    onChange(numericValue)
    setParts(updated)
  }

  return (
    <label className="movimientos-field movimientos-number-field">
      <span>{label}</span>
      <div className="movimientos-number-parts">
        <input
          aria-label={`${label} primera parte`}
          inputMode="numeric"
          maxLength={3}
          value={parts.first}
          onChange={event => setPart("first", event.target.value)}
          onFocus={event => event.currentTarget.select()}
        />
        <span aria-hidden="true"> </span>
        <input
          aria-label={`${label} segunda parte`}
          inputMode="numeric"
          maxLength={3}
          value={parts.second}
          onChange={event => setPart("second", event.target.value)}
          onFocus={event => event.currentTarget.select()}
        />
      </div>
    </label>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <SpanishDateInput value={value} onChange={onChange} ariaLabel={label} />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  children
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function NumberSuggestion({ value, onPick }: { value: number | null; onPick: () => void }) {
  if (!value) {
    return null
  }
  return (
    <button type="button" className="movimientos-suggestion-button" onClick={onPick}>
      Sugerido: {value}
    </button>
  )
}

function EnvasesVaciosFields({
  item,
  cantidad,
  onItem,
  onCantidad
}: {
  item: string
  cantidad: string
  onItem: (value: string) => void
  onCantidad: (value: string) => void
}) {
  return (
    <div className="movimientos-envases">
      <SelectField label="Envase vacio" value={item} onChange={onItem}>
        <option value="5">5 E20</option>
        <option value="6">6 E10</option>
      </SelectField>
      <TextField label="Cantidad" value={cantidad} onChange={onCantidad} selectOnFocus />
    </div>
  )
}

function AbonosSelector({
  abonos,
  onPick
}: {
  abonos: Array<Record<string, unknown>>
  onPick: (period: string) => void
}) {
  return (
    <div className="movimientos-abonos" aria-label="Sugerencias de periodo de abono">
      {GLOBAL_ABONO_PERIOD_SUGGESTIONS.map(suggestion => (
        <button key={suggestion.period} type="button" onClick={() => onPick(suggestion.period)}>
          <strong>{formatSpanishDate(suggestion.period)}</strong>
          <span>{suggestion.title}</span>
        </button>
      ))}
      {abonos.map(abono => {
        const period = toDisplay(abono.fecha_periodo_abono)
        const key = `${toDisplay(abono.tipo_comprobante)}/${toDisplay(abono.prefijo)}-${toDisplay(abono.numero)}`
        if (!period) {
          return null
        }
        return (
          <button key={key} type="button" onClick={() => onPick(period)}>
            <strong>{formatSpanishDate(period)}</strong>
          </button>
        )
      })}
    </div>
  )
}

function LineEditor({
  lines,
  itemsCatalog,
  showPrice,
  showPeriod,
  onChange,
  onAdd,
  onRemove
}: {
  lines: Line[]
  itemsCatalog: MovimientosItem[]
  showPrice: boolean
  showPeriod: boolean
  onChange: (index: number, field: keyof Line, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="movimientos-lines">
      <div className="movimientos-lines-header">
        <strong>Items</strong>
        <button type="button" onClick={onAdd}>Agregar</button>
      </div>
      {lines.map((line, index) => (
        <div className={`movimientos-line${showPrice || showPeriod ? "" : " movimientos-line--compact"}`} key={`${index}-${line.codItem}`}>
          <label className="movimientos-field">
            <span>Item</span>
            <select value={line.codItem} onChange={event => onChange(index, "codItem", event.target.value)}>
              {itemsCatalog.map(item => (
                <option key={item.cod_item} value={item.cod_item}>
                  {itemLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Cantidad" value={line.cantidad} onChange={value => onChange(index, "cantidad", value)} selectOnFocus />
          {showPrice ? (
            <MoneyField label="Precio" value={line.precio} onChange={value => onChange(index, "precio", value)} />
          ) : null}
          {showPeriod ? (
            <DateField
              label="Periodo"
              value={line.fechaPeriodoAbono}
              onChange={value => onChange(index, "fechaPeriodoAbono", value)}
            />
          ) : null}
          <button
            type="button"
            className="movimientos-icon-button"
            aria-label="Quitar item"
            title="Quitar item"
            onClick={() => onRemove(index)}
            disabled={lines.length === 1}
          >
            x
          </button>
        </div>
      ))}
    </div>
  )
}

function DeleteMovementPreview({ value }: { value: Record<string, unknown> | null }) {
  if (!value) {
    return (
      <section className="movimientos-delete-preview movimientos-delete-preview--empty">
        Ingrese el comprobante para verificar qué se eliminará.
      </section>
    )
  }

  const error = toDisplay(value.error)
  if (error) {
    return <section className="movimientos-delete-preview movimientos-delete-preview--error">{error}</section>
  }

  const movement = (value.movement as Record<string, unknown> | undefined) || {}
  const items = Array.isArray(value.items) ? value.items as Array<Record<string, unknown>> : []
  const blocked = Boolean(value.blocked)
  const blockReason = toDisplay(value.blockReason)

  return (
    <section className={`movimientos-delete-preview${blocked ? " movimientos-delete-preview--blocked" : ""}`}>
      <div className="movimientos-delete-preview-header">
        <div>
          <strong>{blocked ? "Movimiento bloqueado" : "Movimiento a eliminar"}</strong>
          <span>{movementLabel(movement.tipo_comprobante, movement.prefijo_remito, movement.numero_remito)}</span>
        </div>
        <small>{formatSpanishDate(toDisplay(movement.fecha))}</small>
      </div>
      <span className="movimientos-delete-preview-client">
        {toDisplay(movement.razon_social) || "Cliente sin razon social"} · Cliente {toDisplay(movement.cod_cliente)} / Punto {toDisplay(movement.nro_lugar_entrega)}
      </span>
      {blockReason ? <p>{blockReason}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Cant.</th>
            <th>Periodo</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={toDisplay(item.nro_orden)}>
              <td>{toDisplay(item.item) || toDisplay(item.cod_item)}</td>
              <td>{toDisplay(item.cantidad)}</td>
              <td>{formatSpanishDate(toDisplay(item.fecha_periodo_abono)) || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function AccountPanel({
  account,
  highlightedRow,
  onSelectVenta
}: {
  account: MovimientosAccountState | null
  highlightedRow: string | null
  onSelectVenta: (venta: Record<string, unknown>) => void
}) {
  const movimientosContenido = (account?.movimientos ?? []).filter(row =>
    CONTENT_ITEM_IDS.has(String(row.cod_item))
  )

  return (
    <section className="movimientos-account">
      <h3>Estado de cuenta</h3>
      <div className="movimientos-history-grid">
        <MiniTable
          title="Ventas"
          tone="ventas"
          rows={account?.ventas ?? []}
          highlightedRow={highlightedRow}
          onRowClick={onSelectVenta}
          columns={[
            ["fecha", "Vto."],
            ["comprobante", "Comp."],
            ["importe", "Importe"],
            ["pagado", "Pagado"],
            ["saldo", "Saldo"],
            ["estado", "E"]
          ]}
        />
        <MiniTable
          title="Movimientos fisicos"
          tone="movimientos"
          rows={movimientosContenido}
          highlightedRow={highlightedRow}
          columns={[
            ["fecha", "Fecha"],
            ["comprobante", "Comp."],
            ["item", "Item"],
            ["cantidad", "Cant."],
            ["fecha_periodo_abono", "Periodo"]
          ]}
        />
        <MiniTable
          title="Cobros"
          tone="cobros"
          rows={account?.cobros ?? []}
          highlightedRow={highlightedRow}
          columns={[
            ["fecha", "Fecha"],
            ["recibo", "Recibo"],
            ["aplicado_a", "Aplicado"],
            ["importe", "Importe"]
          ]}
        />
      </div>
    </section>
  )
}

function VentaDetail({
  value,
  onClose
}: {
  value: { venta: Record<string, unknown>; items: Array<Record<string, unknown>> } | null
  onClose: () => void
}) {
  if (!value) {
    return null
  }

  return (
    <section className="movimientos-venta-detail" aria-label="Detalle de venta">
      <div className="movimientos-venta-detail-header">
        <div>
          <h4>Detalle {toDisplay(value.venta.comprobante)}</h4>
          <span>{formatSpanishDate(toDisplay(value.venta.fecha))}</span>
        </div>
        <button type="button" aria-label="Cerrar detalle" title="Cerrar detalle" onClick={onClose}>x</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cant.</th>
            <th>Precio</th>
          </tr>
        </thead>
        <tbody>
          {value.items.map(item => (
            <tr key={toDisplay(item.orden)}>
              <td>{toDisplay(item.denominacion) || "-"}</td>
              <td>{toDisplay(item.cantidad) || "-"}</td>
              <td>{formatMoney(item.precio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function MiniTable({
  title,
  tone,
  rows,
  columns,
  highlightedRow,
  onRowClick
}: {
  title: string
  tone: "ventas" | "movimientos" | "cobros"
  rows: Array<Record<string, unknown>>
  columns: Array<[string, string]>
  highlightedRow: string | null
  onRowClick?: (row: Record<string, unknown>) => void
}) {
  const rowKey = (row: Record<string, unknown>) => {
    if (tone === "cobros") {
      return `cobros:${toDisplay(row.tipo_comprobante_cobro)}/${toDisplay(row.prefijo_recibo)}/${toDisplay(row.numero_recibo)}`
    }
    if (tone === "movimientos") {
      return `movimientos:${toDisplay(row.tipo_comprobante)}/${toDisplay(row.prefijo_remito)}/${toDisplay(row.numero_remito)}`
    }
    return `ventas:${toDisplay(row.tipo_comprobante)}/${toDisplay(row.prefijo)}/${toDisplay(row.numero)}`
  }
  const formatCell = (row: Record<string, unknown>, key: string) => {
    if (key === "estado") {
      return String(row.estado || "").toLowerCase() === "pagada" ? "P" : ""
    }
    if (key === "importe" || key === "pagado" || key === "saldo") {
      return formatMoney(row[key])
    }
    if (key === "fecha" || key === "fecha_periodo_abono") {
      return formatSpanishDate(toDisplay(row[key])) || "-"
    }
    return toDisplay(row[key]) || "-"
  }

  return (
    <div className={`movimientos-mini-table movimientos-mini-table--${tone}`}>
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.slice(0, 30).map((row, index) => (
              <tr
                key={`${rowKey(row)}-${index}`}
                className={`${rowKey(row) === highlightedRow ? "movimientos-row--saved" : ""}${onRowClick ? " movimientos-row--clickable" : ""}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map(([key]) => (
                  <td key={key}>{formatCell(row, key)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>Sin datos recientes.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
