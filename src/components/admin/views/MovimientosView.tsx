import React, { useCallback, useEffect, useMemo, useState } from "react"
import type {
  MovimientosAccountState,
  MovimientosApiResult,
  MovimientosItem,
  MovimientosLocation,
  MovimientosPayload
} from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

const MODES = [
  { key: "movimiento", label: "Movimiento" },
  { key: "cobro", label: "Cobro" },
  { key: "venta-ci", label: "Venta CI" },
  { key: "venta-factura", label: "Venta con factura" },
  { key: "eliminar", label: "Eliminar movimiento" }
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
const LOCAL_LAST_CI_KEY = "patnav.movimientos.lastCiUsed"
const DEFAULT_LAST_CI_USED = 465682
const CLIENT_SUGGESTION_LIMIT = 5
const CONTENT_ITEM_IDS = new Set(["1", "2"])
const DEFAULT_CONTENT_ITEM = "1"
const DEFAULT_EMPTY_CONTAINER_ITEM = "5"

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

const formatComprobante = (row: Record<string, unknown>) =>
  [
    row.comprobante || row.recibo || row.tipo_comprobante,
    row.prefijo,
    row.numero
  ]
    .map(toDisplay)
    .filter(Boolean)
    .join(" ")

const compactResult = (value: Record<string, unknown>) => {
  const venta = (value.venta || value.savedVenta || value.deletedVenta) as Record<string, unknown> | undefined
  const movimiento = (value.movimiento || value.savedMovimiento || value.deletedMovimiento) as Record<string, unknown> | undefined
  const fiscal = value.fiscal as Record<string, unknown> | undefined
  const totals = value.totals as Record<string, unknown> | undefined
  const arca = value.arca as Record<string, unknown> | undefined
  const dependencies = value.dependencies as Record<string, unknown> | undefined
  const deletionPlan = value.deletionPlan as Record<string, unknown> | undefined
  const preflight = value.preflight as Record<string, unknown> | undefined

  return {
    modo: value.mode || value.tipoOperacion || value.status || "-",
    comprobante: venta ? formatComprobante(venta) : movimiento ? formatComprobante(movimiento) : value.comprobante,
    total: totals?.grossTotal ?? value.total ?? value.importe ?? "-",
    cae: arca?.cae ?? value.cae ?? "-",
    preflight: preflight
      ? `${preflight.processedCount ?? preflight.pendingCount ?? 0} FA/FB 8 previas`
      : "-",
    estado: arca?.resultado ?? value.status ?? (value.blocked ? "bloqueado" : "preview"),
    bloqueo: value.blockReason || "-",
    dependencias: dependencies || deletionPlan || "-"
  }
}

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

const readLocalLastCi = () => {
  if (typeof window === "undefined") {
    return DEFAULT_LAST_CI_USED
  }
  const storedValue = window.localStorage.getItem(LOCAL_LAST_CI_KEY)
  const stored = Number(storedValue)
  if (Number.isFinite(stored) && stored > 0) {
    return stored
  }
  window.localStorage.setItem(LOCAL_LAST_CI_KEY, String(DEFAULT_LAST_CI_USED))
  return DEFAULT_LAST_CI_USED
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
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [fecha, setFecha] = useState(todayIsoDate)
  const [fechaReferencia, setFechaReferencia] = useState(todayIsoDate)
  const [tipoMovimiento, setTipoMovimiento] = useState<"CI" | "RR">("CI")
  const [tipoFactura, setTipoFactura] = useState<"FA" | "FB">("FA")
  const [prefijoRr, setPrefijoRr] = useState("")
  const [numero, setNumero] = useState("")
  const [numeroCi, setNumeroCi] = useState("")
  const [importeCobro, setImporteCobro] = useState("")
  const [selectedVentaKey, setSelectedVentaKey] = useState("")
  const [lines, setLines] = useState<Line[]>(defaultMovementLines)
  const [envaseVacioItem, setEnvaseVacioItem] = useState("6")
  const [envaseVacioCantidad, setEnvaseVacioCantidad] = useState("")
  const [suggestedNumber, setSuggestedNumber] = useState<number | null>(null)
  const [confirmFiscalSave, setConfirmFiscalSave] = useState(false)
  const [abonoPairCursor, setAbonoPairCursor] = useState(0)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

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

  const availableItems = useMemo(
    () => itemsCatalog.filter(item => [1, 2, 5, 6].includes(Number(item.cod_item))),
    [itemsCatalog]
  )
  const saleItems = useMemo(
    () => itemsCatalog.filter(item => [1, 2].includes(Number(item.cod_item))),
    [itemsCatalog]
  )

  const numberTarget = useMemo(() => {
    if (mode === "eliminar") {
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

  const requiresClient = mode !== "eliminar"
  const canOperate = !isLoading && (!requiresClient || Boolean(selectedLocation))

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
      return
    }
    const result = await handleResponse(
      electronAPI.movimientosAvailableAbonos({
        environment: "produccion",
        ...selectedIdentity,
        fechaReferencia
      } as MovimientosPayload)
    )
    setAbonos(result as Array<Record<string, unknown>>)
  }, [electronAPI, fechaReferencia, selectedIdentity])

  const refreshAuxiliaryData = useCallback(async () => {
    await Promise.all([refreshAccount(), refreshPendingVentas(), refreshAbonos()])
  }, [refreshAbonos, refreshAccount, refreshPendingVentas])

  useEffect(() => {
    if (!electronAPI?.movimientosInitialData) {
      return
    }
    handleResponse(electronAPI.movimientosInitialData({ environment: "produccion" }))
      .then(result => {
        const data = result as { items?: MovimientosItem[]; suggestedCiNumber?: number }
        setItemsCatalog(data.items ?? [])
        const suggested = String(readLocalLastCi() + 1)
        setNumero(current => current || suggested)
        setNumeroCi(current => current || suggested)
      })
      .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar datos iniciales."))
  }, [electronAPI])

  useEffect(() => {
    if (!numberTarget) {
      setSuggestedNumber(null)
      return
    }
    if (numberTarget.tipoComprobante === "CI") {
      const next = readLocalLastCi() + 1
      setSuggestedNumber(next)
      if (numberTarget.field === "numero") {
        setNumero(current => current || String(next))
      } else {
        setNumeroCi(current => current || String(next))
      }
      return
    }
    if (!electronAPI?.movimientosSuggestedNumber) {
      setSuggestedNumber(null)
      return
    }
    if (numberTarget.tipoComprobante === "RR" && !String(numberTarget.prefijo || "").trim()) {
      setSuggestedNumber(null)
      return
    }

    electronAPI
      .movimientosSuggestedNumber({
        environment: "produccion",
        tipoComprobante: numberTarget.tipoComprobante,
        prefijo: numberTarget.prefijo
      })
      .then(response => {
        if (response.error) {
          throw new Error(response.details || response.error)
        }
        const next = Number(response.result?.proximo)
        setSuggestedNumber(Number.isFinite(next) ? next : null)
        if (Number.isFinite(next)) {
          if (numberTarget.field === "numero") {
            setNumero(current => current || String(next))
          } else {
            setNumeroCi(current => current || String(next))
          }
        }
      })
      .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudo sugerir numero."))
  }, [electronAPI, numberTarget])

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
    Promise.all([refreshAccount(), refreshPendingVentas()]).catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar la cuenta.")
    )
  }, [refreshAccount, refreshPendingVentas])

  useEffect(() => {
    refreshAbonos().catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar abonos.")
    )
  }, [refreshAbonos])

  const buildLines = () =>
    lines.map(line => ({
      codItem: line.codItem,
      cantidad: line.cantidad,
      precio: line.precio || getCatalogItem(line.codItem)?.precio || 0,
      tasaIva: line.tasaIva || getCatalogItem(line.codItem)?.tasa_iva || 21,
      litrosAbonados: getCatalogItem(line.codItem)?.litros_abonados || 0,
      fechaPeriodoAbono: line.fechaPeriodoAbono || undefined
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

  const rememberLocalCi = (value: unknown) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > readLocalLastCi()) {
      window.localStorage.setItem(LOCAL_LAST_CI_KEY, String(parsed))
      setSuggestedNumber(parsed + 1)
    }
  }

  const getCatalogItem = (codItem: string) =>
    itemsCatalog.find(item => String(item.cod_item) === String(codItem))

  const buildPayload = (includeConfirmation = false): MovimientosPayload => {
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

  const runPreview = async () => {
    setErrorMessage(null)
    setStatusMessage(null)
    setLastResult(null)
    setIsLoading(true)
    try {
      if (mode === "eliminar") {
        if (!electronAPI?.movimientosPreviewDelete) {
          throw new Error("Servicio de eliminacion no disponible.")
        }
        const result = await handleResponse(
          electronAPI.movimientosPreviewDelete({
            environment: "produccion",
            tipoComprobante: tipoMovimiento,
            prefijo: tipoMovimiento === "CI" ? 0 : prefijoRr,
            numero
          })
        )
        setPreview(result)
      } else {
        if (!electronAPI?.movimientosPreview) {
          throw new Error("Servicio de preview no disponible.")
        }
        const result = await handleResponse(electronAPI.movimientosPreview(buildPayload(false)))
        setPreview(result)
      }
      setStatusMessage("Preview listo.")
    } catch (error) {
      setPreview(null)
      setErrorMessage(error instanceof Error ? error.message : "No se pudo generar preview.")
    } finally {
      setIsLoading(false)
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
        const result = await handleResponse(
          electronAPI.movimientosDelete({
            environment: "produccion",
            tipoComprobante: tipoMovimiento,
            prefijo: tipoMovimiento === "CI" ? 0 : prefijoRr,
            numero
          })
        )
        setLastResult(result)
      } else {
        if (!electronAPI?.movimientosSave) {
          throw new Error("Servicio de guardado no disponible.")
        }
        const result = await handleResponse(electronAPI.movimientosSave(buildPayload(true)))
        setLastResult(result)
        if (mode === "movimiento" && tipoMovimiento === "CI") {
          rememberLocalCi(numero)
        }
        if (mode === "cobro") {
          rememberLocalCi(numero)
        }
        if (mode === "venta-ci" || mode === "venta-factura") {
          rememberLocalCi(numeroCi)
        }
      }
      setStatusMessage("Operacion finalizada.")
      await refreshAuxiliaryData()
    } catch (error) {
      setLastResult(null)
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

  const showItemLines = mode !== "cobro" && mode !== "eliminar"

  const addLine = () => {
    setLines(current => [...current, lineForPosition(current.length)])
  }

  const applyAbonoPeriod = (period: string) => {
    const cleanPeriod = toDisplay(period)
    if (!cleanPeriod) {
      return
    }

    setLines(current => {
      const working = current.length ? current : defaultMovementLines()
      const pairCount = Math.max(1, Math.ceil(working.length / 2))
      const pairIndex = working.length <= 2 ? 0 : abonoPairCursor % pairCount
      const firstIndex = pairIndex * 2
      return working.map((line, index) =>
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
                setPreview(null)
                setLastResult(null)
                setConfirmFiscalSave(false)
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
                  onChange={event => setQuery(event.target.value)}
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
                    setPreview(null)
                    setLastResult(null)
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
                  <TextField label="Numero" value={numero} onChange={setNumero} />
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
                  <TextField label="Numero CI" value={numero} onChange={setNumero} />
                  <TextField label="Importe" value={importeCobro} onChange={setImporteCobro} />
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
                  <TextField label="Numero CI" value={numeroCi} onChange={setNumeroCi} />
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
                  <DateField label="Fecha" value={fecha} onChange={setFecha} />
                  <SelectField label="Factura" value={tipoFactura} onChange={value => setTipoFactura(value as "FA" | "FB")}>
                    <option value="FA">FA/8</option>
                    <option value="FB">FB/8</option>
                  </SelectField>
                  <TextField label="Numero CI" value={numeroCi} onChange={setNumeroCi} />
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
                  <TextField label="Numero" value={numero} onChange={setNumero} />
                </FormRow>
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
              <button type="button" className="fetch-button" onClick={runPreview} disabled={!canOperate}>
                Preview
              </button>
              <button
                type="button"
                className="fetch-button fetch-button--success"
                onClick={runSave}
                disabled={!canOperate || (mode === "venta-factura" && !confirmFiscalSave)}
              >
                {mode === "venta-factura" ? "Autorizar y guardar" : mode === "eliminar" ? "Eliminar" : "Guardar"}
              </button>
            </div>
          </div>

          <AccountPanel account={account} />
        </section>

        <section className="movimientos-preview-row">
          <ResultPanel title="Preview" value={preview} />
          <ResultPanel title="Resultado" value={lastResult} />
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
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <input type="date" value={value} onChange={event => onChange(event.target.value)} />
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
        <option value="6">6 E10</option>
        <option value="5">5 E20</option>
      </SelectField>
      <TextField label="Cantidad" value={cantidad} onChange={onCantidad} />
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
    <div className="movimientos-abonos">
      {abonos.slice(0, 8).map(abono => (
        <button
          type="button"
          key={`${abono.tipo_comprobante}-${abono.prefijo}-${abono.numero}-${abono.fecha_periodo_abono}`}
          onClick={() => onPick(toDisplay(abono.fecha_periodo_abono))}
        >
          <strong>{toDisplay(abono.fecha_periodo_abono)}</strong>
          <span>{toDisplay(abono.item)} {toDisplay(abono.cantidad)}</span>
        </button>
      ))}
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
        <div className="movimientos-line" key={`${index}-${line.codItem}`}>
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
          <TextField label="Cantidad" value={line.cantidad} onChange={value => onChange(index, "cantidad", value)} />
          {showPrice ? (
            <TextField label="Precio" value={line.precio} onChange={value => onChange(index, "precio", value)} />
          ) : null}
          {showPeriod ? (
            <DateField label="Periodo" value={line.fechaPeriodoAbono} onChange={value => onChange(index, "fechaPeriodoAbono", value)} />
          ) : null}
          <button type="button" className="movimientos-icon-button" onClick={() => onRemove(index)} disabled={lines.length === 1}>
            Quitar
          </button>
        </div>
      ))}
    </div>
  )
}

function AccountPanel({ account }: { account: MovimientosAccountState | null }) {
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

function MiniTable({
  title,
  tone,
  rows,
  columns
}: {
  title: string
  tone: "ventas" | "movimientos" | "cobros"
  rows: Array<Record<string, unknown>>
  columns: Array<[string, string]>
}) {
  const formatCell = (row: Record<string, unknown>, key: string) => {
    if (key === "estado") {
      return String(row.estado || "").toLowerCase() === "pagada" ? "P" : ""
    }
    if (key === "importe" || key === "pagado" || key === "saldo") {
      return formatMoney(row[key])
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
              <tr key={index}>
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

function ResultPanel({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <section className="movimientos-result-panel">
      <h3>{title}</h3>
      {value ? <pre>{JSON.stringify(compactResult(value), null, 2)}</pre> : <span>Sin datos.</span>}
    </section>
  )
}
