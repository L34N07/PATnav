import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { FacultadFactura, FacultadFacturasPayload } from "../../../global"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import StatusToasts from "../../StatusToasts"
import DataTable from "../DataTable"
import type { DataRow } from "../dataModel"

const SUCCESS_MESSAGE_DURATION_MS = 2000
const ERROR_MESSAGE_DURATION_MS = 3200
const SAVE_DIRECTORY_STORAGE_KEY = "patnav.facultad.saveDirectory"

const FACULTAD_TABLE_COLUMNS = [
  "Factura",
  "Fecha",
  "Cliente",
  "Razon Social",
  "CUIT",
  "IVA",
  "Items",
  "Total",
  "CAE"
] as const

const FACULTAD_TABLE_WIDTHS = [120, 110, 100, 260, 150, 140, 90, 120, 170] as const

const toDisplay = (value: unknown) => String(value ?? "").trim()

const getStoredSaveDirectory = () => {
  try {
    return window.localStorage.getItem(SAVE_DIRECTORY_STORAGE_KEY) ?? ""
  } catch (error) {
    console.warn("No se pudo leer la carpeta guardada de Facultad:", error)
    return ""
  }
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatDate = (value: unknown) => {
  const raw = toDisplay(value)
  if (!raw) {
    return "-"
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
  }

  return raw
}

const formatMoney = (value: unknown) => {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return "-"
  }
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number)
}

const formatBill = (invoice: FacultadFactura) => {
  const prefijo = String(Number(invoice.prefijo) || 0).padStart(4, "0")
  const numero = String(Number(invoice.numero) || 0).padStart(8, "0")
  return `${toDisplay(invoice.tipo_comprobante) || "FB"} ${prefijo}-${numero}`
}

const getInvoiceTotal = (invoice: FacultadFactura) =>
  (invoice.items ?? []).reduce((sum, item) => sum + toNumber(item.importe), 0)

const toTableRow = (invoice: FacultadFactura): DataRow => ({
  Factura: formatBill(invoice),
  Fecha: formatDate(invoice.fecha_operacion),
  Cliente: toDisplay(invoice.cod_cliente) || "-",
  "Razon Social": toDisplay(invoice.razon_social) || "-",
  CUIT: toDisplay(invoice.cuit) || "-",
  IVA: toDisplay(invoice.categoria) || "-",
  Items: String(invoice.items?.length ?? 0),
  Total: formatMoney(getInvoiceTotal(invoice)),
  CAE: toDisplay(invoice.cae) || "-"
})

export default function FacultadView() {
  const electronAPI = window.electronAPI

  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [facturas, setFacturas] = useState<FacultadFactura[]>([])
  const [columnWidths, setColumnWidths] = useState<number[]>([...FACULTAD_TABLE_WIDTHS])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isSavingPdf, setIsSavingPdf] = useState(false)
  const [pdfPreviewBase64, setPdfPreviewBase64] = useState<string | null>(null)
  const [pdfRangeLabel, setPdfRangeLabel] = useState("")
  const [saveDirectory, setSaveDirectory] = useState(getStoredSaveDirectory)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  useEffect(() => {
    try {
      const trimmedDirectory = saveDirectory.trim()
      if (trimmedDirectory) {
        window.localStorage.setItem(SAVE_DIRECTORY_STORAGE_KEY, trimmedDirectory)
      } else {
        window.localStorage.removeItem(SAVE_DIRECTORY_STORAGE_KEY)
      }
    } catch (error) {
      console.warn("No se pudo guardar la carpeta de Facultad:", error)
    }
  }, [saveDirectory])

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
  }, [])

  const payload = useMemo<FacultadFacturasPayload | null>(() => {
    const desdeNumero = Number(desde)
    const hastaNumero = Number(hasta)
    if (
      !Number.isInteger(desdeNumero) ||
      !Number.isInteger(hastaNumero) ||
      desdeNumero <= 0 ||
      hastaNumero <= 0 ||
      desdeNumero > hastaNumero
    ) {
      return null
    }
    return { desde: desdeNumero, hasta: hastaNumero }
  }, [desde, hasta])

  const tableRows = useMemo(() => facturas.map(toTableRow), [facturas])

  const pdfDataUrl = useMemo(
    () => (pdfPreviewBase64 ? `data:application/pdf;base64,${pdfPreviewBase64}` : ""),
    [pdfPreviewBase64]
  )

  const currentRangeLabel = useMemo(() => (payload ? `${payload.desde}-${payload.hasta}` : ""), [payload])

  const chooseSaveDirectory = useCallback(async () => {
    clearMessages()
    if (!electronAPI?.selectDirectory) {
      setErrorMessage("Servicio de seleccion de carpeta no disponible.")
      return
    }

    try {
      const result = await electronAPI.selectDirectory()
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      if (result?.status === "canceled") {
        return
      }
      if (!result?.directoryPath) {
        throw new Error("No se recibio la carpeta seleccionada.")
      }
      setSaveDirectory(result.directoryPath)
      setStatusMessage("Carpeta seleccionada.")
    } catch (error) {
      console.error("No se pudo seleccionar la carpeta:", error)
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al seleccionar carpeta.")
    }
  }, [clearMessages, electronAPI])

  const loadFacturas = useCallback(async () => {
    clearMessages()

    if (!electronAPI?.listFacultadFacturas) {
      setErrorMessage("Servicio de Facultad no disponible.")
      return
    }
    if (!payload) {
      setErrorMessage("Ingrese un rango valido.")
      return
    }

    setIsLoading(true)
    setSelectedRowIndex(null)
    try {
      const result = await electronAPI.listFacultadFacturas(payload)
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      const rows = result.rows ?? []
      setFacturas(rows)
      setStatusMessage(rows.length ? `${rows.length} facturas encontradas.` : "No se encontraron facturas.")
    } catch (error) {
      console.error("No se pudieron cargar las facturas de Facultad:", error)
      setFacturas([])
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al cargar las facturas.")
    } finally {
      setIsLoading(false)
    }
  }, [clearMessages, electronAPI, payload])

  const previewPdf = useCallback(async () => {
    clearMessages()

    if (!electronAPI?.previewFacultadFacturasPdf) {
      setErrorMessage("Servicio de PDF no disponible.")
      return
    }
    if (!payload) {
      setErrorMessage("Ingrese un rango valido.")
      return
    }

    setIsGeneratingPdf(true)
    try {
      const result = await electronAPI.previewFacultadFacturasPdf(payload)
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      if (!result?.base64) {
        throw new Error("No se recibio el PDF.")
      }
      setPdfPreviewBase64(result.base64)
      setPdfRangeLabel(currentRangeLabel)
      setFacturas(result.rows ?? facturas)
    } catch (error) {
      console.error("No se pudo generar el PDF de Facultad:", error)
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al generar el PDF.")
    } finally {
      setIsGeneratingPdf(false)
    }
  }, [clearMessages, currentRangeLabel, electronAPI, facturas, payload])

  const savePdf = useCallback(async () => {
    clearMessages()
    if (!electronAPI?.saveFacultadFacturasPdfs) {
      setErrorMessage("Servicio de guardado no disponible.")
      return
    }
    if (!pdfPreviewBase64) {
      setErrorMessage("Primero genere una previsualizacion.")
      return
    }
    if (facturas.length === 0) {
      setErrorMessage("No hay facturas para guardar.")
      return
    }

    const directoryPath = saveDirectory.trim()
    if (!directoryPath) {
      setErrorMessage("Seleccione una carpeta en Guardar en.")
      return
    }

    setIsSavingPdf(true)
    try {
      const result = await electronAPI.saveFacultadFacturasPdfs({
        invoices: facturas,
        directoryPath
      })
      if (result?.error) {
        throw new Error(result.details || result.error)
      }
      const saved = result.saved ?? result.filePaths?.length ?? facturas.length
      setStatusMessage(saved === 1 ? "PDF guardado correctamente." : `${saved} PDFs guardados correctamente.`)
    } catch (error) {
      console.error("No se pudo guardar el PDF de Facultad:", error)
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido al guardar el PDF.")
    } finally {
      setIsSavingPdf(false)
    }
  }, [
    clearMessages,
    electronAPI,
    facturas,
    pdfPreviewBase64,
    saveDirectory
  ])

  return (
    <>
      <StatusToasts
        statusMessage={statusMessage}
        infoMessage={isLoading || isGeneratingPdf ? "Procesando..." : null}
        errorMessage={errorMessage}
      />
      <div className="content facultad-layout">
        <main className="facultad-main">
          <section className="facultad-panel">
            <header className="facultad-header">
              <h2 className="facultad-title">Facultad</h2>
            </header>

            <form
              className="facultad-form"
              onSubmit={event => {
                event.preventDefault()
                void loadFacturas()
              }}
            >
              <label className="hoja-ruta-field">
                Desde:
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={desde}
                  onChange={event => setDesde(event.target.value)}
                  disabled={isLoading || isGeneratingPdf}
                />
              </label>
              <label className="hoja-ruta-field">
                Hasta:
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={hasta}
                  onChange={event => setHasta(event.target.value)}
                  disabled={isLoading || isGeneratingPdf}
                />
              </label>
              <button className="fetch-button facultad-form__button" type="submit" disabled={!payload || isLoading}>
                {isLoading ? "Buscando..." : "Buscar"}
              </button>
            </form>
          </section>

          <section className="facultad-panel facultad-panel--results">
            <header className="facultad-header">
              <h3 className="facultad-title">Facturas FB 0007</h3>
            </header>
            <DataTable
              columns={[...FACULTAD_TABLE_COLUMNS]}
              rows={tableRows}
              columnWidths={columnWidths}
              onColumnResize={(index, width) => {
                setColumnWidths(prev => {
                  const next = [...prev]
                  next[index] = width
                  return next
                })
              }}
              selectedRowIndex={selectedRowIndex}
              onRowSelect={(_row, index) => setSelectedRowIndex(index)}
              isLoading={isLoading}
              statusMessage={null}
              errorMessage={null}
              emptyMessage="No hay facturas para mostrar."
              fitColumnsToContainer
            />
          </section>
        </main>

        <aside className="sidebar loan-actions facultad-actions">
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">Rango</span>
            <button className="fetch-button" type="button" onClick={previewPdf} disabled={!payload || isGeneratingPdf}>
              {isGeneratingPdf ? "Generando..." : "Previsualizar PDF"}
            </button>
          </div>
          <div className="loan-actions__divider" aria-hidden="true" />
          <div className="loan-actions__button-group">
            <span className="loan-actions__section-title">PDF</span>
            <div className="hoja-ruta-field facultad-save-field">
              <span>Guardar en:</span>
              <button
                className="facultad-save-path"
                type="button"
                onClick={chooseSaveDirectory}
                title={saveDirectory || "Sin carpeta seleccionada"}
              >
                {saveDirectory || "Seleccionar carpeta..."}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {pdfPreviewBase64 && (
        <div className="pdf-preview-modal" role="dialog" aria-modal="true" aria-labelledby="facultad-pdf-title">
          <div className="pdf-preview-modal__panel">
            <header className="pdf-preview-modal__header">
              <div className="pdf-preview-modal__title-block">
                <h3 id="facultad-pdf-title" className="pdf-preview-modal__title">
                  Facultad FB 0007
                </h3>
                <p className="pdf-preview-modal__subtitle">Rango {pdfRangeLabel}</p>
              </div>
              <div className="pdf-preview-modal__actions">
                <button className="pdf-preview-modal__button" type="button" onClick={savePdf} disabled={isSavingPdf}>
                  Guardar PDF
                </button>
                <button className="pdf-preview-modal__button" type="button" onClick={() => setPdfPreviewBase64(null)}>
                  Cerrar
                </button>
              </div>
            </header>
            <div className="pdf-preview-modal__body">
              <iframe className="pdf-preview-modal__frame" title="PDF Facultad" src={pdfDataUrl} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
