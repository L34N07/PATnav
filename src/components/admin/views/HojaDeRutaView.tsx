import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import { usePagination } from "../../../hooks/usePagination"
import StatusToasts from "../../StatusToasts"
import DataTable from "../DataTable"
import { type DataRow, pickRowValue } from "../dataModel"

const MAX_MOTIVO = 15
const MAX_DETALLE = 100
const MAX_RECORRIDO = 4
const HOJA_RUTA_ITEMS_PER_PAGE = 25
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

const HOJA_RUTA_TABLE_COLUMNS = [
  "Motivo",
  "DetallesRecorrido",
  "Recorrido",
  "FechasRecorrido"
] as const

const HOJA_RUTA_TABLE_DEFAULT_WIDTHS = [140, 560, 120, 160] as const

const RECORRIDO_DAY_ORDER: Record<string, number> = {
  L: 0,
  M: 1,
  X: 2,
  J: 3,
  V: 4,
  S: 5
}

const parseRecorrido = (value: string) => {
  const match = /^(\d+)\s*([LMXJVS])$/i.exec(value.trim())
  if (!match) {
    return { numero: Number.POSITIVE_INFINITY, dia: value.trim().toUpperCase() }
  }
  return { numero: Number(match[1]), dia: match[2].toUpperCase() }
}

const compareHojaDeRutaRows = (left: DataRow, right: DataRow) => {
  const aRecorrido = String(left["Recorrido"] ?? "")
  const bRecorrido = String(right["Recorrido"] ?? "")
  const aParsed = parseRecorrido(aRecorrido)
  const bParsed = parseRecorrido(bRecorrido)

  if (aParsed.numero !== bParsed.numero) {
    return aParsed.numero - bParsed.numero
  }

  const dayDiff =
    (RECORRIDO_DAY_ORDER[aParsed.dia] ?? 99) - (RECORRIDO_DAY_ORDER[bParsed.dia] ?? 99)
  if (dayDiff !== 0) {
    return dayDiff
  }

  const aFecha = String(left["FechasRecorrido"] ?? "")
  const bFecha = String(right["FechasRecorrido"] ?? "")
  if (aFecha !== bFecha) {
    return aFecha.localeCompare(bFecha)
  }

  return aRecorrido.localeCompare(bRecorrido)
}

const isEmptyHojaRutaRow = (row: DataRow) =>
  HOJA_RUTA_TABLE_COLUMNS.every(column => String(row[column] ?? "").trim().length === 0)

export default function HojaDeRutaView() {
  const electronAPI = window.electronAPI

  const [motivo, setMotivo] = useState("")
  const [detalle, setDetalle] = useState("")
  const [recorridoNumero, setRecorridoNumero] = useState("")
  const [recorridoDia, setRecorridoDia] = useState("")
  const [fechaRecorrido, setFechaRecorrido] = useState("")

  const [isSaving, setIsSaving] = useState(false)
  const [pdfDiaRecorrido, setPdfDiaRecorrido] = useState("")
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isPrintingPdf, setIsPrintingPdf] = useState(false)
  const [isSavingPdf, setIsSavingPdf] = useState(false)
  const [pdfPreviewBase64, setPdfPreviewBase64] = useState<string | null>(null)
  const [pdfPreviewDia, setPdfPreviewDia] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [hojaRutaRows, setHojaRutaRows] = useState<DataRow[]>([])
  const [hojaRutaColumnWidths, setHojaRutaColumnWidths] = useState<number[]>([
    ...HOJA_RUTA_TABLE_DEFAULT_WIDTHS
  ])
  const [selectedHojaRutaRowIndex, setSelectedHojaRutaRowIndex] = useState<number | null>(null)
  const [isLoadingHojaRuta, setIsLoadingHojaRuta] = useState(false)
  const [hojaRutaTableError, setHojaRutaTableError] = useState<string | null>(null)

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

  const pdfDataUrl = useMemo(
    () => (pdfPreviewBase64 ? `data:application/pdf;base64,${pdfPreviewBase64}` : ""),
    [pdfPreviewBase64]
  )

  const closePdfPreview = useCallback(() => {
    setPdfPreviewBase64(null)
    setPdfPreviewDia(null)
  }, [])

  const {
    currentPage: hojaRutaCurrentPage,
    pageCount: hojaRutaPageCount,
    pageItems: hojaRutaPageItems,
    goToPage: goToHojaRutaPage,
    resetPage: resetHojaRutaPage,
    itemCount: hojaRutaRowCount
  } = usePagination(hojaRutaRows, HOJA_RUTA_ITEMS_PER_PAGE)

  const handleHojaRutaColumnResize = useCallback((index: number, width: number) => {
    setHojaRutaColumnWidths(prev => {
      const next = [...prev]
      next[index] = width
      return next
    })
  }, [])

  const handleHojaRutaRowSelect = useCallback((_row: DataRow, index: number) => {
    setSelectedHojaRutaRowIndex(index)
  }, [])

  const reloadHojaRutaTable = useCallback(async () => {
    if (!electronAPI?.traer_hoja_de_ruta) {
      setHojaRutaTableError("Servicio de Hoja de Ruta no disponible.")
      return
    }

    setIsLoadingHojaRuta(true)
    setHojaRutaTableError(null)
    try {
      const result = await electronAPI.traer_hoja_de_ruta()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedRows = (result.rows ?? []).map(row => {
        const record = row as DataRow
        const mapped: DataRow = {}
        HOJA_RUTA_TABLE_COLUMNS.forEach(column => {
          mapped[column] = pickRowValue(record, column)
        })
        return mapped
      }).filter(row => !isEmptyHojaRutaRow(row))

      fetchedRows.sort(compareHojaDeRutaRows)

      setHojaRutaRows(fetchedRows)
      setSelectedHojaRutaRowIndex(null)
      resetHojaRutaPage()
    } catch (error) {
      console.error("No se pudo cargar la Hoja de Ruta:", error)
      setHojaRutaRows([])
      setSelectedHojaRutaRowIndex(null)
      setHojaRutaTableError(
        error instanceof Error ? error.message : "Error desconocido al cargar la Hoja de Ruta."
      )
    } finally {
      setIsLoadingHojaRuta(false)
    }
  }, [electronAPI, resetHojaRutaPage])

  useEffect(() => {
    reloadHojaRutaTable()
  }, [reloadHojaRutaTable])

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
        await reloadHojaRutaTable()
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
      reloadHojaRutaTable,
      trimmedDetalle,
      trimmedMotivo,
      trimmedRecorrido
    ]
  )

  const handlePreviewPdf = useCallback(async () => {
    clearMessages()

    if (!electronAPI?.previewHojaDeRutaPdf) {
      setErrorMessage("Servicio de PDF no disponible.")
      return
    }

    const diaRecorrido = pdfDiaRecorrido.trim()
    if (!diaRecorrido) {
      setErrorMessage("Seleccione un dia de recorrido.")
      return
    }

    setIsGeneratingPdf(true)
    try {
      const result = await electronAPI.previewHojaDeRutaPdf({ diaRecorrido })
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      if (!result?.base64) {
        throw new Error("No se recibio el PDF.")
      }
      setPdfPreviewBase64(result.base64)
      setPdfPreviewDia(diaRecorrido)
    } catch (error) {
      console.error("No se pudo generar el PDF de Hoja de Ruta:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al generar el PDF."
      )
    } finally {
      setIsGeneratingPdf(false)
    }
  }, [clearMessages, electronAPI, pdfDiaRecorrido])

  const handlePrintPdf = useCallback(async () => {
    clearMessages()

    if (!pdfPreviewBase64) {
      setErrorMessage("Primero genere una previsualizacion.")
      return
    }

    setIsPrintingPdf(true)
    try {
      const dia = (pdfPreviewDia ?? pdfDiaRecorrido).trim() || "DIA"
      const dateLabel = new Date().toISOString().slice(0, 10)
      const suggestedFileName = `HojaDeRuta_${dia}_${dateLabel}.pdf`

      if (electronAPI?.openPdf) {
        const result = await electronAPI.openPdf({ base64: pdfPreviewBase64, suggestedFileName })
        if (result?.error) {
          throw new Error(result.details || result.error)
        }
        setStatusMessage("PDF abierto en Windows para imprimir.")
        return
      }

      if (!electronAPI?.printHojaDeRutaPdf) {
        setErrorMessage("Servicio de impresion no disponible.")
        return
      }

      const fallbackResult = await electronAPI.printHojaDeRutaPdf({ diaRecorrido: dia })
      if (fallbackResult?.error) {
        throw new Error(fallbackResult.details || fallbackResult.error)
      }
      setStatusMessage("Impresion iniciada.")
    } catch (error) {
      console.error("No se pudo imprimir el PDF de Hoja de Ruta:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al imprimir el PDF."
      )
    } finally {
      setIsPrintingPdf(false)
    }
  }, [clearMessages, electronAPI, pdfDiaRecorrido, pdfPreviewBase64, pdfPreviewDia])

  const handleSavePdf = useCallback(async () => {
    clearMessages()

    if (!electronAPI?.savePdf) {
      setErrorMessage("Servicio de guardado no disponible.")
      return
    }

    if (!pdfPreviewBase64) {
      setErrorMessage("Primero genere una previsualizacion.")
      return
    }

    const dia = (pdfPreviewDia ?? pdfDiaRecorrido).trim() || "DIA"
    const dateLabel = new Date().toISOString().slice(0, 10)
    const suggestedFileName = `HojaDeRuta_${dia}_${dateLabel}.pdf`

    setIsSavingPdf(true)
    try {
      const result = await electronAPI.savePdf({ base64: pdfPreviewBase64, suggestedFileName })
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      if (result?.status === "canceled") {
        return
      }
      setStatusMessage("PDF guardado correctamente.")
    } catch (error) {
      console.error("No se pudo guardar el PDF de Hoja de Ruta:", error)
      setErrorMessage(
        error instanceof Error ? error.message : "Error desconocido al guardar el PDF."
      )
    } finally {
      setIsSavingPdf(false)
    }
  }, [clearMessages, electronAPI, pdfDiaRecorrido, pdfPreviewBase64, pdfPreviewDia])

  return (
    <>
      <StatusToasts statusMessage={statusMessage} errorMessage={errorMessage} />
      <div className="content hoja-ruta-layout">
        <div className="hoja-ruta-main-column">
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

          <section className="hoja-ruta-history-card">
            <header className="hoja-ruta-header">
              <h3 className="hoja-ruta-title">Registros</h3>
              <p className="hoja-ruta-subtitle">Listado completo de Hoja de Ruta</p>
            </header>
            <DataTable
              columns={[...HOJA_RUTA_TABLE_COLUMNS]}
              rows={hojaRutaPageItems}
              columnWidths={hojaRutaColumnWidths}
              onColumnResize={handleHojaRutaColumnResize}
              selectedRowIndex={selectedHojaRutaRowIndex}
              onRowSelect={handleHojaRutaRowSelect}
              isLoading={isLoadingHojaRuta}
              statusMessage={null}
              errorMessage={hojaRutaTableError}
              currentPage={hojaRutaCurrentPage}
              totalPages={hojaRutaPageCount}
              rowCount={hojaRutaRowCount}
              onPageChange={goToHojaRutaPage}
              emptyMessage="No hay registros de hoja de ruta para mostrar."
            />
          </section>
        </div>

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
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">INFORME</span>
            <label className="hoja-ruta-field hoja-ruta-field--compact">
              Dia de recorrido
              <select
                value={pdfDiaRecorrido}
                onChange={event => setPdfDiaRecorrido(event.target.value)}
                disabled={isGeneratingPdf || isPrintingPdf}
              >
                <option value="" disabled>
                  Seleccionar...
                </option>
                {RECORRIDO_DIA_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="fetch-button"
              type="button"
              onClick={handlePreviewPdf}
              disabled={!pdfDiaRecorrido.trim() || isGeneratingPdf || isPrintingPdf}
            >
              {isGeneratingPdf ? "Generando..." : "Previsualizar PDF"}
            </button>
          </div>
        </aside>
      </div>
      {pdfPreviewBase64 ? (
        <div className="pdf-preview-modal" role="dialog" aria-modal="true" onClick={closePdfPreview}>
          <div className="pdf-preview-modal__panel" onClick={event => event.stopPropagation()}>
            <div className="pdf-preview-modal__header">
              <div className="pdf-preview-modal__title-block">
                <h3 className="pdf-preview-modal__title">
                  Hoja de Ruta {pdfPreviewDia ? `- Dia ${pdfPreviewDia}` : ""}
                </h3>
                <p className="pdf-preview-modal__subtitle">Previsualizacion PDF</p>
              </div>
              <div className="pdf-preview-modal__actions">
                <button
                  className="pdf-preview-modal__button"
                  type="button"
                  onClick={handlePrintPdf}
                  disabled={isPrintingPdf || isGeneratingPdf}
                >
                  {isPrintingPdf ? "Abriendo..." : "Imprimir"}
                </button>
                <button
                  className="pdf-preview-modal__button"
                  type="button"
                  onClick={handleSavePdf}
                  disabled={isSavingPdf}
                >
                  {isSavingPdf ? "Guardando..." : "Guardar PDF"}
                </button>
                <button
                  className="pdf-preview-modal__button"
                  type="button"
                  onClick={closePdfPreview}
                >
                  Cerrar
                </button>
              </div>
            </div>
            <div className="pdf-preview-modal__body">
              <iframe className="pdf-preview-modal__frame" title="PDF Hoja de Ruta" src={pdfDataUrl} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
