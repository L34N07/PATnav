import React, { useCallback, useMemo, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"

const MAX_MOTIVO = 15
const MAX_DETALLE = 100
const MAX_RECORRIDO = 4
const SUCCESS_MESSAGE_DURATION_MS = 2000
const ERROR_MESSAGE_DURATION_MS = 2600

const toTrimmed = (value: string) => value.trim()

const MOTIVO_OPTIONS = [
  "Agua",
  "LLEVAR DISP",
  "CAMBIO DISP",
  "REVISAR DISP",
  "INSTALAR DISP",
  "RETIRAR DISP",
  "PERDIDA AGUA",
  "CANILLA",
  "COBRAR"
] as const

const RECORRIDO_NUM_OPTIONS = ["1", "2", "3"] as const
const RECORRIDO_DIA_OPTIONS = ["L", "M", "X", "J", "V", "S"] as const

export default function HojaDeRutaView() {
  const electronAPI = window.electronAPI

  const [motivo, setMotivo] = useState("")
  const [detalle, setDetalle] = useState("")
  const [recorridoNumero, setRecorridoNumero] = useState("")
  const [recorridoDia, setRecorridoDia] = useState("")
  const [fechaRecorrido, setFechaRecorrido] = useState("")

  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
  }, [])

  const trimmedMotivo = useMemo(() => toTrimmed(motivo), [motivo])
  const trimmedDetalle = useMemo(() => toTrimmed(detalle), [detalle])
  const trimmedRecorrido = useMemo(
    () => toTrimmed(`${recorridoNumero}${recorridoDia}`),
    [recorridoNumero, recorridoDia]
  )

  const isFormValid =
    trimmedMotivo.length > 0 &&
    trimmedMotivo.length <= MAX_MOTIVO &&
    trimmedDetalle.length > 0 &&
    trimmedDetalle.length <= MAX_DETALLE &&
    trimmedRecorrido.length > 0 &&
    trimmedRecorrido.length <= MAX_RECORRIDO &&
    fechaRecorrido.trim().length > 0

  const resetForm = useCallback(() => {
    setMotivo("")
    setDetalle("")
    setRecorridoNumero("")
    setRecorridoDia("")
    setFechaRecorrido("")
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      clearMessages()

      if (!electronAPI?.ingresarRegistroHojaDeRuta) {
        setErrorMessage("Servicio de Hoja de Ruta no disponible.")
        return
      }

      if (!isFormValid) {
        setErrorMessage("Complete todos los campos obligatorios.")
        return
      }

      setIsSaving(true)
      try {
        const result = await electronAPI.ingresarRegistroHojaDeRuta({
          motivo: trimmedMotivo,
          detalle: trimmedDetalle,
          recorrido: trimmedRecorrido,
          fechaRecorrido
        })

        if (result?.error) {
          throw new Error(result.details || result.error)
        }

        setStatusMessage("Registro guardado correctamente.")
        resetForm()
      } catch (error) {
        console.error("No se pudo guardar el registro de Hoja de Ruta:", error)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Error desconocido al guardar el registro."
        )
      } finally {
        setIsSaving(false)
      }
    },
    [
      clearMessages,
      electronAPI,
      fechaRecorrido,
      isFormValid,
      resetForm,
      trimmedDetalle,
      trimmedMotivo,
      trimmedRecorrido
    ]
  )

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content hoja-ruta-layout">
        <section className="hoja-ruta-card">
          <header className="hoja-ruta-header">
            <h2 className="hoja-ruta-title">Hoja de Ruta</h2>
          </header>

          <form id="hoja-ruta-form" className="hoja-ruta-form" onSubmit={handleSubmit}>
            <label className="hoja-ruta-field hoja-ruta-field--compact">
              Motivo
              <select
                value={motivo}
                onChange={event => setMotivo(event.target.value)}
                required
                disabled={isSaving}
              >
                <option value="" disabled>
                  Seleccionar...
                </option>
                {MOTIVO_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="hoja-ruta-field hoja-ruta-field--compact">
              Recorrido
              <div className="hoja-ruta-recorrido">
                <select
                  aria-label="Recorrido numero"
                  value={recorridoNumero}
                  onChange={event => setRecorridoNumero(event.target.value)}
                  required
                  disabled={isSaving}
                >
                  <option value="" disabled>
                    Nro
                  </option>
                  {RECORRIDO_NUM_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Recorrido dia"
                  value={recorridoDia}
                  onChange={event => setRecorridoDia(event.target.value)}
                  required
                  disabled={isSaving}
                >
                  <option value="" disabled>
                    Dia
                  </option>
                  {RECORRIDO_DIA_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="hoja-ruta-field hoja-ruta-field--compact hoja-ruta-field--date">
              Fecha de recorrido
              <input
                type="date"
                value={fechaRecorrido}
                onChange={event => setFechaRecorrido(event.target.value)}
                required
                disabled={isSaving}
              />
            </label>

            <label className="hoja-ruta-field hoja-ruta-field--full">
              Detalles del recorrido
              <textarea
                value={detalle}
                onChange={event => setDetalle(event.target.value)}
                maxLength={MAX_DETALLE}
                required
                disabled={isSaving}
              />
            </label>
          </form>
        </section>

        <aside className="sidebar loan-actions hoja-ruta-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Acciones</span>
            <button
              className="fetch-button"
              type="submit"
              form="hoja-ruta-form"
              disabled={!isFormValid || isSaving}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </button>
            <button
              className="fetch-button"
              type="button"
              onClick={() => {
                clearMessages()
                resetForm()
              }}
              disabled={isSaving}
            >
              Limpiar
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}
