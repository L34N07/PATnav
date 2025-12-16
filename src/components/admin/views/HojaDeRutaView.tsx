import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import { usePagination } from "../../../hooks/usePagination"
import StatusToasts from "../../StatusToasts"
import DataTable from "../DataTable"
import { type DataRow, pickRowValue, toDisplayValue } from "../dataModel"

const MAX_MOTIVO = 15
const MAX_DETALLE = 100
const MAX_RECORRIDO = 4
const HOJA_RUTA_ITEMS_PER_PAGE = 25
const SUCCESS_MESSAGE_DURATION_MS = 2000
const ERROR_MESSAGE_DURATION_MS = 2600

const toTrimmed = (value: string) => value.trim()
const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

const MONTH_ABBREVIATIONS_ES: Record<number, string> = {
  1: "ENE",
  2: "FEB",
  3: "MAR",
  4: "ABR",
  5: "MAY",
  6: "JUN",
  7: "JUL",
  8: "AGO",
  9: "SEP",
  10: "OCT",
  11: "NOV",
  12: "DIC"
}

const formatFechaForTable = (value: string) => {
  const raw = value.trim()
  if (!raw) {
    return ""
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (isoMatch) {
    const year = isoMatch[1]
    const monthNumber = Number(isoMatch[2])
    const day = isoMatch[3]
    const monthLabel = MONTH_ABBREVIATIONS_ES[monthNumber] ?? isoMatch[2]
    return `${day}/${monthLabel}/${year}`
  }

  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw)
  if (slashMatch) {
    const part1 = Number(slashMatch[1])
    const part2 = Number(slashMatch[2])
    const year = slashMatch[3]

    const treatAsMonthFirst = part1 <= 12 && part2 > 12
    const dayNumber = treatAsMonthFirst ? part2 : part1
    const monthNumber = treatAsMonthFirst ? part1 : part2

    const day = String(dayNumber).padStart(2, "0")
    const monthLabel = MONTH_ABBREVIATIONS_ES[monthNumber] ?? String(monthNumber).padStart(2, "0")
    return `${day}/${monthLabel}/${year}`
  }

  return raw
}

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
  "Detalles",
  "Recorrido",
  "Fecha"
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

  const aFecha = String(left["Fecha"] ?? left["FechasRecorrido"] ?? "")
  const bFecha = String(right["Fecha"] ?? right["FechasRecorrido"] ?? "")
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
  const [hojaRutaSearch, setHojaRutaSearch] = useState("")
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

  const filteredHojaRutaRows = useMemo(() => {
    const query = normalizeText(hojaRutaSearch.trim())
    if (!query) {
      return hojaRutaRows
    }

    return hojaRutaRows.filter(row =>
      HOJA_RUTA_TABLE_COLUMNS.some(column =>
        normalizeText(toDisplayValue(row[column])).includes(query)
      )
    )
  }, [hojaRutaRows, hojaRutaSearch])

  const {
    currentPage: hojaRutaCurrentPage,
    pageCount: hojaRutaPageCount,
    pageItems: hojaRutaPageItems,
    goToPage: goToHojaRutaPage,
    resetPage: resetHojaRutaPage,
    itemCount: hojaRutaRowCount
  } = usePagination(filteredHojaRutaRows, HOJA_RUTA_ITEMS_PER_PAGE)

  useEffect(() => {
    resetHojaRutaPage()
    setSelectedHojaRutaRowIndex(null)
  }, [hojaRutaSearch, resetHojaRutaPage])

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

  const reloadHojaRutaTable = useCallback(async (options?: { showConfirmation?: boolean; ensureEnvases?: boolean }) => {
    if (!electronAPI?.traer_hoja_de_ruta) {
      setHojaRutaTableError("Servicio de Hoja de Ruta no disponible.")
      return
    }

    setIsLoadingHojaRuta(true)
    setHojaRutaTableError(null)
    try {
      if (options?.ensureEnvases !== false) {
        if (!electronAPI?.insertarEnvasesEnHojaDeRuta) {
          throw new Error("Servicio de envases no disponible.")
        }
        const insertResult = await electronAPI.insertarEnvasesEnHojaDeRuta()
        if (insertResult?.error) {
          throw new Error(insertResult.details || insertResult.error)
        }
      }

      const result = await electronAPI.traer_hoja_de_ruta()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedRows = (result.rows ?? []).map(row => {
        const record = row as DataRow
        const mapped: DataRow = {}
        HOJA_RUTA_TABLE_COLUMNS.forEach(column => {
          if (column === "Detalles") {
            const rawDetalles =
              pickRowValue(record, column) || pickRowValue(record, "DetallesRecorrido")
            mapped[column] = rawDetalles
            return
          }
          if (column === "Fecha") {
            const rawFecha = pickRowValue(record, column) || pickRowValue(record, "FechasRecorrido")
            mapped[column] = formatFechaForTable(rawFecha)
            return
          }
          mapped[column] = pickRowValue(record, column)
        })
        return mapped
      }).filter(row => !isEmptyHojaRutaRow(row))

      fetchedRows.sort(compareHojaDeRutaRows)

      setHojaRutaRows(fetchedRows)
      setSelectedHojaRutaRowIndex(null)
      resetHojaRutaPage()
      if (options?.showConfirmation) {
        setStatusMessage("Registros actualizados.")
      }
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

  useEffect(() => {
    const handleActivePageChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ pageId: unknown }>
      if (customEvent.detail?.pageId === "hojaRuta") {
        reloadHojaRutaTable({ showConfirmation: true })
      }
    }

    window.addEventListener("app:active-page-change", handleActivePageChange)
    return () => {
      window.removeEventListener("app:active-page-change", handleActivePageChange)
    }
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
      <StatusToasts
        statusMessage={statusMessage}
        infoMessage={isLoadingHojaRuta ? "Procesando..." : null}
        errorMessage={errorMessage}
      />
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

              <div className="hoja-ruta-field-group">
                <label className="hoja-ruta-field hoja-ruta-field--compact">
                  Zona
                  <select
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
                </label>
                <label className="hoja-ruta-field hoja-ruta-field--compact">
                  Recorrido
                  <select
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
                </label>
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
              <div className="hoja-ruta-search" role="search">
                <input
                  className="hoja-ruta-search__input"
                  type="search"
                  value={hojaRutaSearch}
                  onChange={event => setHojaRutaSearch(event.target.value)}
                  placeholder="Buscar por motivo, detalle, recorrido o fecha..."
                  aria-label="Buscar registros de hoja de ruta"
                />
                <svg
                  className="hoja-ruta-search__icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M10.5 18.5C14.9183 18.5 18.5 14.9183 18.5 10.5C18.5 6.08172 14.9183 2.5 10.5 2.5C6.08172 2.5 2.5 6.08172 2.5 10.5C2.5 14.9183 6.08172 18.5 10.5 18.5Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M21.5 21.5L16.85 16.85"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
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
              emptyMessage={
                hojaRutaSearch.trim().length > 0
                  ? "No hay registros que coincidan con la busqueda."
                  : "No hay registros de hoja de ruta para mostrar."
              }
              fitColumnsToContainer
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
              {isSaving ? "Agregando..." : "Agregar"}
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
