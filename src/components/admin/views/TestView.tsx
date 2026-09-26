import React, { useCallback, useEffect, useState } from "react"
import AdminSidebar from "../AdminSidebar"
import DataTable from "../DataTable"
import {
  CLIENT_COLUMNS,
  CLIENT_COLUMN_LABELS,
  CLIENT_DEFAULT_WIDTHS,
  CLIENT_FILTER_MAP,
  ClientFilterField,
  DataRow,
  pickRowValue,
  toDisplayValue
} from "../dataModel"
import { useAutoDismissMessage } from "../../../hooks/useAutoDismissMessage"
import { usePagination } from "../../../hooks/usePagination"
import StatusToasts from "../../StatusToasts"

const ITEMS_PER_PAGE = 25
const SUCCESS_MESSAGE_DURATION_MS = 2000
const ERROR_MESSAGE_DURATION_MS = 2600

type DatasetKind = "none" | "clients" | "irregularidades"

type FiscalBacklogPreview = {
  range?: { desde?: string | null; hasta?: string | null }
  pendingCount?: number
  bySeries?: Array<{
    tipo: string
    prefijo: number
    pending: number
    firstNumber: number | null
    lastNumber: number | null
  }>
}

const todayIsoDate = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const firstDayOfMonth = () => `${todayIsoDate().slice(0, 8)}01`

export default function TestView() {
  const [columns, setColumns] = useState<string[]>([])
  const [datasetRows, setDatasetRows] = useState<DataRow[]>([])
  const [visibleRows, setVisibleRows] = useState<DataRow[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [filterField, setFilterField] = useState<ClientFilterField>("dom_fiscal1")
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [selectedRow, setSelectedRow] = useState<DataRow | null>(null)
  const [activeDataset, setActiveDataset] = useState<DatasetKind>("none")
  const [editEnabled, setEditEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fiscalDesde, setFiscalDesde] = useState(firstDayOfMonth)
  const [fiscalHasta, setFiscalHasta] = useState(todayIsoDate)
  const [fiscalPreview, setFiscalPreview] = useState<FiscalBacklogPreview | null>(null)
  const [authorizeFiscalPending, setAuthorizeFiscalPending] = useState(false)

  const [codCliente, setCodCliente] = useState("")
  const [razonSocial, setRazonSocial] = useState("")
  const [domFiscal, setDomFiscal] = useState("")
  const [cuit, setCuit] = useState("")

  const electronAPI = window.electronAPI

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)
  useAutoDismissMessage(errorMessage, setErrorMessage, ERROR_MESSAGE_DURATION_MS)

  const clearMessages = useCallback(() => {
    setErrorMessage(null)
    setStatusMessage(null)
  }, [setErrorMessage, setStatusMessage])

  const { currentPage, pageCount, pageItems, goToPage, resetPage, itemCount } = usePagination(
    visibleRows,
    ITEMS_PER_PAGE
  )

  useEffect(() => {
    if (selectedRow && columns.length >= CLIENT_COLUMNS.length) {
      setCodCliente(toDisplayValue(selectedRow[columns[0]]))
      setRazonSocial(toDisplayValue(selectedRow[columns[1]]))
      setDomFiscal(toDisplayValue(selectedRow[columns[2]]))
      setCuit(toDisplayValue(selectedRow[columns[3]]))
    } else {
      setCodCliente("")
      setRazonSocial("")
      setDomFiscal("")
      setCuit("")
    }
  }, [selectedRow, columns])

  const resetSelection = () => {
    setSelectedRowIndex(null)
    setSelectedRow(null)
  }

  const resetDataset = () => {
    setColumns([])
    setDatasetRows([])
    setVisibleRows([])
  }

  const handleFetchClients = async () => {
    setIsLoading(true)
    clearMessages()
    setActiveDataset("clients")
    resetSelection()

    try {
      const result = await electronAPI.getClientes()
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      const fetchedRows = (result.rows ?? []).map(row => {
        const record = row as DataRow
        const mappedRow: DataRow = {}
        CLIENT_COLUMNS.forEach(column => {
          mappedRow[column.label] = pickRowValue(record, column.key)
        })
        return mappedRow
      })

      setColumns(CLIENT_COLUMN_LABELS)
      setDatasetRows(fetchedRows)
      setVisibleRows(fetchedRows)
      setColumnWidths([...CLIENT_DEFAULT_WIDTHS])
      setSearchQuery("")
      resetPage()
      setStatusMessage("Clientes cargados correctamente.")
    } catch (error) {
      console.error("No se pudieron traer los clientes:", error)
      resetDataset()
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al traer los clientes."
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleFetchIrregularidades = async () => {
    setIsLoading(true)
    clearMessages()
    setActiveDataset("irregularidades")
    resetSelection()

    try {
      const updateResult = await electronAPI.modificarCobrosImpagos()
      if (updateResult.error) {
        throw new Error(updateResult.details || updateResult.error)
      }

      const result = await electronAPI.traerIncongruencias()
      if (result.error) {
        throw new Error(result.details || result.error)
      }

      const cols = result.columns ?? []
      const dataset = (result.rows ?? []).map(row => {
        const record = row as DataRow
        const mappedRow: DataRow = {}
        cols.forEach(column => {
          mappedRow[column] = pickRowValue(record, column)
        })
        return mappedRow
      })

      setColumns(cols)
      setDatasetRows(dataset)
      setVisibleRows(dataset)
      setColumnWidths(new Array(cols.length).fill(150))
      setSearchQuery("")
      resetPage()
      setStatusMessage("Cobros impagos actualizados e irregularidades cargadas correctamente.")
    } catch (error) {
      console.error("No se pudieron traer las irregularidades:", error)
      resetDataset()
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al traer irregularidades."
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleAuthorizeFiscalBacklog = async () => {
    if (!authorizeFiscalPending) {
      setErrorMessage("Confirme la autorizacion de facturas pendientes.")
      return
    }
    if (!electronAPI?.authorizeFiscalBacklog) {
      setErrorMessage("La autorizacion fiscal no esta disponible.")
      return
    }
    if (
      fiscalPreview?.range?.desde !== fiscalDesde ||
      fiscalPreview?.range?.hasta !== fiscalHasta
    ) {
      setErrorMessage("Primero previsualice las facturas pendientes para este rango.")
      return
    }

    setIsLoading(true)
    clearMessages()
    try {
      const response = await electronAPI.authorizeFiscalBacklog({
        environment: "produccion",
        confirmation: "AUTORIZAR_PENDIENTES_FISCALES",
        desde: fiscalDesde,
        hasta: fiscalHasta
      })
      if (response.error) {
        throw new Error(response.details || response.error)
      }
      const summary = (response.result as { summary?: Record<string, unknown> } | undefined)?.summary || {}
      const authorized = Number(summary.authorized || 0)
      const failed = Number(summary.failed || 0)
      const skipped = Number(summary.skipped || 0)
      const correctedDates = Number(summary.fechasCorregidas || 0)
      const results = (response.result as { results?: Array<Record<string, unknown>> } | undefined)?.results || []
      const firstFailure = results.find(result => !result.ok && !result.skipped)
      setStatusMessage(
        `${authorized} autorizada${authorized === 1 ? "" : "s"}; ${correctedDates} fecha${correctedDates === 1 ? "" : "s"} corregida${correctedDates === 1 ? "" : "s"}.`
      )
      if (failed || skipped) {
        const original = firstFailure?.original as Record<string, unknown> | undefined
        const label = original
          ? `${String(original.tipo || "")}/${String(original.prefijo || "")}-${String(original.numero || "")}`
          : ""
        const detail = typeof firstFailure?.error === "string" ? firstFailure.error : ""
        setErrorMessage(
          `${failed} serie(s) con error; ${skipped} factura(s) no procesada(s) por su serie.` +
            (label ? ` Primer bloqueo: ${label}.` : "") +
            (detail ? ` ${detail}` : "")
        )
      }
      setAuthorizeFiscalPending(false)
    } catch (error) {
      console.error("No se pudieron autorizar las facturas pendientes:", error)
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron autorizar las facturas pendientes.")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePreviewFiscalBacklog = async () => {
    if (!electronAPI?.previewFiscalBacklog) {
      setErrorMessage("La previsualizacion fiscal no esta disponible.")
      return
    }

    setIsLoading(true)
    clearMessages()
    try {
      const response = await electronAPI.previewFiscalBacklog({
        environment: "produccion",
        desde: fiscalDesde,
        hasta: fiscalHasta
      })
      if (response.error) {
        throw new Error(response.details || response.error)
      }
      const preview = (response.result || null) as FiscalBacklogPreview | null
      setFiscalPreview(preview)
      setAuthorizeFiscalPending(false)
      setStatusMessage(`${Number(preview?.pendingCount || 0)} factura(s) pendiente(s) en el rango.`)
    } catch (error) {
      console.error("No se pudieron previsualizar las facturas pendientes:", error)
      setFiscalPreview(null)
      setErrorMessage(error instanceof Error ? error.message : "No se pudieron previsualizar las facturas pendientes.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleFiscalDesdeChange = (value: string) => {
    setFiscalDesde(value)
    setFiscalPreview(null)
    setAuthorizeFiscalPending(false)
  }

  const handleFiscalHastaChange = (value: string) => {
    setFiscalHasta(value)
    setFiscalPreview(null)
    setAuthorizeFiscalPending(false)
  }

  const handleUpdateClient = async () => {
    if (!editEnabled || !selectedRow || columns.length < CLIENT_COLUMNS.length) {
      console.warn("No client selected or editing disabled.")
      return
    }

    if (!codCliente.trim()) {
      setErrorMessage("El codigo de cliente no es valido.")
      return
    }

    setIsLoading(true)
    clearMessages()

    try {
      const response = await electronAPI.updateCliente({
        codCliente,
        razonSocial,
        domFiscal,
        cuit
      })

      if (response.error) {
        throw new Error(response.details || response.error)
      }

      const updatedRow: DataRow = {
        ...selectedRow,
        [columns[1]]: razonSocial,
        [columns[2]]: domFiscal,
        [columns[3]]: cuit
      }

      setSelectedRow(updatedRow)
      setVisibleRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
      setDatasetRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
      setStatusMessage("Cliente actualizado correctamente.")
    } catch (error) {
      console.error("No se pudo editar el cliente:", error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al editar el cliente."
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleColumnResize = (index: number, width: number) => {
    setColumnWidths(prevWidths => {
      const nextWidths = [...prevWidths]
      nextWidths[index] = width
      return nextWidths
    })
  }

  const applyClientFilter = (query: string, field: ClientFilterField) => {
    if (activeDataset !== "clients") {
      setVisibleRows(datasetRows)
      resetPage()
      return
    }

    const column = CLIENT_FILTER_MAP[field]
    if (!column) {
      setVisibleRows(datasetRows)
      resetPage()
      return
    }

    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      setVisibleRows(datasetRows)
      resetPage()
      return
    }

    const filtered = datasetRows.filter(row => {
      const value = toDisplayValue(row[column])
      if (!value) {
        return false
      }
      return value.toLowerCase().includes(normalizedQuery)
    })

    setVisibleRows(filtered)
    resetPage()
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (activeDataset === "clients") {
      applyClientFilter(value, filterField)
    }
  }

  const handleFilterFieldChange = (field: ClientFilterField) => {
    setFilterField(field)
    if (activeDataset === "clients") {
      applyClientFilter(searchQuery, field)
    }
  }

  const handleRowSelect = (row: DataRow, index: number) => {
    setSelectedRowIndex(index)
    if (activeDataset === "clients") {
      setSelectedRow(row)
    }
  }

  return (
    <>
      <StatusToasts
        statusMessage={statusMessage}
        infoMessage={isLoading ? "Procesando..." : null}
        errorMessage={errorMessage}
      />
      <div className="content test-view-layout">
        <AdminSidebar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          filterField={filterField}
          onFilterFieldChange={handleFilterFieldChange}
          isLoading={isLoading}
          onFetchClients={handleFetchClients}
          onFetchIrregularidades={handleFetchIrregularidades}
          fiscalDesde={fiscalDesde}
          fiscalHasta={fiscalHasta}
          onFiscalDesdeChange={handleFiscalDesdeChange}
          onFiscalHastaChange={handleFiscalHastaChange}
          fiscalPreview={fiscalPreview}
          onPreviewFiscalBacklog={handlePreviewFiscalBacklog}
          authorizeFiscalPending={authorizeFiscalPending}
          onAuthorizeFiscalPendingChange={setAuthorizeFiscalPending}
          onAuthorizeFiscalBacklog={handleAuthorizeFiscalBacklog}
          columns={columns}
          codCliente={codCliente}
          razonSocial={razonSocial}
          onRazonSocialChange={setRazonSocial}
          domFiscal={domFiscal}
          onDomFiscalChange={setDomFiscal}
          cuit={cuit}
          onCuitChange={setCuit}
          editEnabled={editEnabled}
          onToggleEdit={setEditEnabled}
          onEditClient={handleUpdateClient}
          canEditClient={Boolean(selectedRow)}
        />
        <DataTable
          columns={columns}
          rows={pageItems}
          columnWidths={columnWidths}
          onColumnResize={handleColumnResize}
          selectedRowIndex={selectedRowIndex}
          onRowSelect={handleRowSelect}
          isLoading={isLoading}
          statusMessage={null}
          errorMessage={null}
          currentPage={currentPage}
          totalPages={pageCount}
          rowCount={itemCount}
          onPageChange={goToPage}
          emptyMessage={activeDataset === "irregularidades" ? "No hay errores para mostrar" : undefined}
        />
      </div>
    </>
  )
}
