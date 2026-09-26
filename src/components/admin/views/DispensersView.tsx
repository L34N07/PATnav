import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { DispensersPayload, MovimientosApiResult, MovimientosLocation } from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

const MODES = [
  { key: "instalacion", label: "Instalacion" },
  { key: "retiro", label: "Retiro" },
  { key: "cambio", label: "Cambio" }
] as const

type Mode = (typeof MODES)[number]["key"]
type RecordRow = Record<string, unknown>

const CLIENT_SUGGESTION_LIMIT = 5
const SUCCESS_MESSAGE_DURATION_MS = 3000
const ERROR_MESSAGE_DURATION_MS = 5000

const toDisplay = (value: unknown) => String(value ?? "").trim()

const locationTitle = (location: MovimientosLocation) =>
  toDisplay(location.razon_social || location.label)

const locationAddress = (location: MovimientosLocation) => toDisplay(location.direccion)

const locationIdentity = (location: MovimientosLocation) =>
  `Cliente ${location.cod_cliente} / Punto ${location.nro_lugar_entrega}`

const dispenserLabel = (dispenser: RecordRow | null | undefined) => {
  if (!dispenser) return "-"
  const code = toDisplay(dispenser.cod_dispenser)
  const serial = toDisplay(dispenser.nro_serie)
  return serial ? `${code} - ${serial}` : code
}

export default function DispensersView() {
  const electronAPI = window.electronAPI
  const [mode, setMode] = useState<Mode>("cambio")
  const [query, setQuery] = useState("")
  const [locations, setLocations] = useState<MovimientosLocation[]>([])
  const [selectedLocation, setSelectedLocation] = useState<MovimientosLocation | null>(null)
  const [clientDispensers, setClientDispensers] = useState<RecordRow[]>([])
  const [abonoOptions, setAbonoOptions] = useState<RecordRow[]>([])
  const [codInstalado, setCodInstalado] = useState("")
  const [codRetirado, setCodRetirado] = useState("")
  const [codAbono, setCodAbono] = useState("")
  const [ubicacion, setUbicacion] = useState("")
  const [instaladoInfo, setInstaladoInfo] = useState<RecordRow | null>(null)
  const [retiradoInfo, setRetiradoInfo] = useState<RecordRow | null>(null)
  const [preview, setPreview] = useState<RecordRow | null>(null)
  const [previewKey, setPreviewKey] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const selectedIdentity = useMemo(
    () => selectedLocation
      ? { codCliente: selectedLocation.cod_cliente, nroLugarEntrega: selectedLocation.nro_lugar_entrega }
      : null,
    [selectedLocation]
  )

  const operationKey = useMemo(
    () => [mode, selectedIdentity?.codCliente || "", selectedIdentity?.nroLugarEntrega || "", codInstalado, codRetirado, codAbono, ubicacion].join("|"),
    [codAbono, codInstalado, codRetirado, mode, selectedIdentity, ubicacion]
  )
  const previewIsCurrent = Boolean(preview && previewKey === operationKey)

  const handleResponse = async <T,>(promise: Promise<MovimientosApiResult<T>>) => {
    const response = await promise
    if (response.error) {
      throw new Error(response.details || response.error)
    }
    return response.result as T
  }

  const refreshClientDispensers = useCallback(async () => {
    if (!selectedIdentity || !electronAPI?.dispensersClientDispensers) {
      setClientDispensers([])
      return
    }
    const result = await handleResponse(
      electronAPI.dispensersClientDispensers({ environment: "produccion", ...selectedIdentity })
    )
    setClientDispensers((result.dispensers as RecordRow[]) || [])
  }, [electronAPI, selectedIdentity])

  useEffect(() => {
    if (!electronAPI?.dispensersInitialData) return
    handleResponse(electronAPI.dispensersInitialData({ environment: "produccion" }))
      .then(result => setAbonoOptions((result.abonos as RecordRow[]) || []))
      .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar los abonos."))
  }, [electronAPI])

  useEffect(() => {
    if (!electronAPI?.dispensersSearchLocations) return
    const term = query.trim()
    if (selectedLocation && term === locationTitle(selectedLocation)) {
      setLocations([])
      return
    }
    if (term.length < 2) {
      setLocations([])
      return
    }
    const timeout = window.setTimeout(() => {
      electronAPI.dispensersSearchLocations({ environment: "produccion", query: term, limit: CLIENT_SUGGESTION_LIMIT })
        .then(response => {
          if (response.error) throw new Error(response.details || response.error)
          setLocations(response.result || [])
        })
        .catch(error => setErrorMessage(error instanceof Error ? error.message : "No se pudo buscar clientes."))
    }, 220)
    return () => window.clearTimeout(timeout)
  }, [electronAPI, query, selectedLocation])

  useEffect(() => {
    refreshClientDispensers().catch(error =>
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron cargar los dispensers del cliente.")
    )
  }, [refreshClientDispensers])

  useEffect(() => {
    setPreview(null)
    setPreviewKey("")
    setConfirmed(false)
  }, [operationKey])

  const buildPayload = (): DispensersPayload => {
    if (!selectedIdentity) throw new Error("Seleccione cliente y punto.")
    return {
      environment: "produccion",
      mode,
      ...selectedIdentity,
      codDispenserInstalado: codInstalado,
      codDispenserRetirado: mode === "retiro" ? codInstalado : codRetirado,
      codAbono,
      ubicacion
    }
  }

  const loadDispenser = async (code: string, target: "instalado" | "retirado") => {
    const cleanCode = code.trim()
    const setInfo = target === "instalado" ? setInstaladoInfo : setRetiradoInfo
    if (!cleanCode) {
      setInfo(null)
      return
    }
    if (!electronAPI?.dispensersDispenser) {
      setErrorMessage("Consulta de dispensers no disponible.")
      return
    }
    try {
      const result = await handleResponse(
        electronAPI.dispensersDispenser({ environment: "produccion", codDispenser: cleanCode })
      )
      setInfo(result)
    } catch (error) {
      setInfo(null)
      setErrorMessage(error instanceof Error ? error.message : "No se pudo consultar el dispenser.")
    }
  }

  const updateInstalado = (value: string) => {
    setCodInstalado(value)
    setInstaladoInfo(null)
  }

  const updateRetirado = (value: string) => {
    setCodRetirado(value)
    setRetiradoInfo(null)
  }

  const verify = async () => {
    if (!electronAPI?.dispensersPreview) {
      setErrorMessage("Servicio de dispensers no disponible.")
      return
    }
    setErrorMessage(null)
    setStatusMessage(null)
    setIsLoading(true)
    try {
      const result = await handleResponse(electronAPI.dispensersPreview(buildPayload()))
      setPreview(result)
      setPreviewKey(operationKey)
      setStatusMessage("Datos verificados. Revise antes de guardar.")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron verificar los dispensers.")
    } finally {
      setIsLoading(false)
    }
  }

  const save = async () => {
    if (!electronAPI?.dispensersSave) {
      setErrorMessage("Servicio de dispensers no disponible.")
      return
    }
    if (!previewIsCurrent || !confirmed) {
      setErrorMessage("Verifique los datos y confirme el cambio antes de guardar.")
      return
    }
    setErrorMessage(null)
    setStatusMessage(null)
    setIsLoading(true)
    try {
      const result = await handleResponse(electronAPI.dispensersSave(buildPayload()))
      setStatusMessage(
        mode === "cambio"
          ? `Cambio guardado: ${result.instalados || 0} instalado y ${result.retirados || 0} retirado.`
          : mode === "instalacion"
            ? "Instalacion guardada."
            : "Retiro guardado."
      )
      setPreview(null)
      setPreviewKey("")
      setConfirmed(false)
      await refreshClientDispensers()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar el movimiento.")
    } finally {
      setIsLoading(false)
    }
  }

  const resetMode = (nextMode: Mode) => {
    setMode(nextMode)
    setCodInstalado("")
    setCodRetirado("")
    setCodAbono("")
    setUbicacion("")
    setInstaladoInfo(null)
    setRetiradoInfo(null)
  }

  const requiresAbono = mode === "instalacion"
  const requiresInstalado = mode !== "retiro"
  const requiresRetirado = mode !== "instalacion"
  const requiresUbicacion = mode !== "retiro"
  const canVerify = Boolean(
    selectedIdentity &&
    (!requiresInstalado || codInstalado.trim()) &&
    (!requiresRetirado || (mode === "retiro" ? codInstalado.trim() : codRetirado.trim())) &&
    (!requiresAbono || codAbono) &&
    (!requiresUbicacion || ubicacion.trim())
  ) && !isLoading

  return (
    <div className="content dispensers-layout">
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <main className="dispensers-main">
        <section className="movimientos-modebar" aria-label="Tipo de movimiento de dispenser">
          {MODES.map(option => (
            <button
              key={option.key}
              type="button"
              className={`movimientos-mode-button${mode === option.key ? " movimientos-mode-button--active" : ""}`}
              onClick={() => resetMode(option.key)}
            >
              {option.label}
            </button>
          ))}
        </section>

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
            <div className={`movimientos-selected-client${selectedLocation ? "" : " movimientos-selected-client--empty"}`}>
              {selectedLocation ? (
                <>
                  <strong>{locationTitle(selectedLocation)}</strong>
                  <span>{locationAddress(selectedLocation) || "-"}</span>
                  <small>{locationIdentity(selectedLocation)}</small>
                </>
              ) : <span>Sin cliente seleccionado.</span>}
            </div>
          </div>
          <div className="movimientos-results">
            {locations.map(location => (
              <button
                type="button"
                key={`${location.cod_cliente}-${location.nro_lugar_entrega}`}
                className="movimientos-result"
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
            {query.trim().length >= 2 && !locations.length && !selectedLocation ? (
              <span className="movimientos-empty-suggestions">Sin coincidencias.</span>
            ) : null}
          </div>
        </section>

        <section className="dispensers-workspace">
          <div className="dispensers-form">
            <div className="dispensers-form-row">
              {requiresInstalado ? (
                <DispenserCodeField
                  label={mode === "cambio" ? "Dispenser instalado" : "Cod. dispenser"}
                  value={codInstalado}
                  onChange={updateInstalado}
                  onCommit={() => loadDispenser(codInstalado, "instalado")}
                />
              ) : null}
              {requiresRetirado ? (
                <DispenserCodeField
                  label={mode === "cambio" ? "Dispenser retirado" : "Cod. dispenser"}
                  value={mode === "retiro" ? codInstalado : codRetirado}
                  onChange={mode === "retiro" ? updateInstalado : updateRetirado}
                  onCommit={() => loadDispenser(mode === "retiro" ? codInstalado : codRetirado, mode === "retiro" ? "instalado" : "retirado")}
                />
              ) : null}
              {requiresAbono ? (
                <label className="movimientos-field">
                  <span>Abono / alquiler</span>
                  <select value={codAbono} onChange={event => setCodAbono(event.target.value)}>
                    <option value="">Seleccionar</option>
                    {abonoOptions.map(option => (
                      <option key={toDisplay(option.cod_item)} value={toDisplay(option.cod_item)}>
                        {toDisplay(option.cod_item)} {toDisplay(option.denom_corto || option.denominacion)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {mode !== "retiro" ? <MonthField value={ubicacion} onChange={setUbicacion} /> : null}
            </div>

            <div className="dispensers-actions">
              <button type="button" className="fetch-button" onClick={verify} disabled={!canVerify}>
                Verificar datos
              </button>
              <label className="movimientos-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!previewIsCurrent || isLoading}
                  onChange={event => setConfirmed(event.target.checked)}
                />
                <span>Confirmar cambio</span>
              </label>
              <button
                type="button"
                className="fetch-button fetch-button--success"
                onClick={save}
                disabled={!previewIsCurrent || !confirmed || isLoading}
              >
                Guardar {mode}
              </button>
            </div>

            {previewIsCurrent ? <div className="dispensers-verified">Datos verificados para este cambio.</div> : null}
          </div>

          <ClientDispensersTable
            rows={clientDispensers}
            previews={
              <div className={`dispensers-input-preview${mode === "cambio" ? " dispensers-input-preview--double" : ""}`}>
                {requiresInstalado ? <DispenserPreviewTable title="Dispenser instalado" value={instaladoInfo} /> : null}
                {requiresRetirado ? (
                  <DispenserPreviewTable
                    title="Dispenser retirado"
                    value={mode === "retiro" ? instaladoInfo : retiradoInfo}
                  />
                ) : null}
              </div>
            }
          />
        </section>
      </main>
    </div>
  )
}

function DispenserCodeField({
  label,
  value,
  onChange,
  onCommit
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onCommit: () => void
}) {
  return (
    <label className="movimientos-field">
      <span>{label}</span>
      <input
        value={value}
        inputMode="numeric"
        onChange={event => onChange(event.target.value.replace(/\D/g, ""))}
        onBlur={onCommit}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault()
            onCommit()
          }
        }}
      />
    </label>
  )
}

function MonthField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="movimientos-field">
      <span>Ubicacion</span>
      <input type="month" value={value} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function DispenserPreviewTable({ title, value }: { title: string; value: RecordRow | null }) {
  const values: Array<[string, unknown]> = [
    ["Codigo", value?.cod_dispenser],
    ["Serie", value?.nro_serie],
    ["Tipo", value?.tipo_dispenser],
    ["Marca", value?.marca],
    ["Cliente / punto", value?.cod_cliente ? `${toDisplay(value.cod_cliente)} / ${toDisplay(value.nro_lugar_entrega) || "-"}` : "Sin asignar"],
    ["Abono", value?.cod_abono_o_alquiler ? `${toDisplay(value.cod_abono_o_alquiler)} ${toDisplay(value.abono)}` : "-"],
    ["MControl2", value?.mcontrol2],
    ["Ubicacion", value?.ubicacion],
    ["Observaciones", value?.observaciones]
  ]
  return (
    <section className="dispensers-input-table">
      <h3>{title}</h3>
      {value ? (
        <table>
          <tbody>
            {values.map(([label, current]) => (
              <tr key={label}><th>{label}</th><td>{toDisplay(current) || "-"}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <span>Ingrese el codigo y confirme con Enter o fuera del campo.</span>}
    </section>
  )
}

function ClientDispensersTable({ rows, previews }: { rows: RecordRow[]; previews: React.ReactNode }) {
  return (
    <section className="dispensers-client-table">
      <div className="dispensers-table-heading">
        <h3>Dispensers del cliente</h3>
        <span>{rows.length}</span>
      </div>
      <div className="dispensers-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Serie</th>
              <th>Tipo</th>
              <th>Abono</th>
              <th>MControl2</th>
              <th>Ubicacion</th>
              <th>Inicio</th>
              <th>Fin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(row => (
              <tr key={toDisplay(row.cod_dispenser)}>
                <td>{toDisplay(row.cod_dispenser)}</td>
                <td>{toDisplay(row.nro_serie) || "-"}</td>
                <td>{toDisplay(row.tipo_dispenser) || "-"}</td>
                <td>{toDisplay(row.cod_abono_o_alquiler) || "-"} {toDisplay(row.abono)}</td>
                <td>{toDisplay(row.mcontrol2) || "-"}</td>
                <td>{toDisplay(row.ubicacion) || "-"}</td>
                <td>{toDisplay(row.fecha_inicio_contrato) || "-"}</td>
                <td>{toDisplay(row.fecha_fin_contrato) || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={8}>Seleccione un cliente para ver sus dispensers.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {previews}
    </section>
  )
}
