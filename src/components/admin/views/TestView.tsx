import React, { useEffect, useState } from "react"
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

const ITEMS_PER_PAGE = 25
const SUCCESS_MESSAGE_DURATION_MS = 3000

type DatasetKind = "none" | "clients" | "irregularidades"

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

  const [codCliente, setCodCliente] = useState("")
  const [razonSocial, setRazonSocial] = useState("")
  const [domFiscal, setDomFiscal] = useState("")
  const [cuit, setCuit] = useState("")

  const electronAPI = window.electronAPI

  useAutoDismissMessage(statusMessage, setStatusMessage, SUCCESS_MESSAGE_DURATION_MS)

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

  const handleFetchClients = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    setStatusMessage(null)
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
      setColumns([])
      setDatasetRows([])
      setVisibleRows([])
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
    setErrorMessage(null)
    setStatusMessage(null)
    setActiveDataset("irregularidades")
    resetSelection()

    try {
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
      setStatusMessage("Irregularidades cargadas correctamente.")
    } catch (error) {
      console.error("No se pudieron traer las irregularidades:", error)
      setColumns([])
      setDatasetRows([])
      setVisibleRows([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al traer irregularidades."
      )
    } finally {
      setIsLoading(false)
    }
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
    setErrorMessage(null)
    setStatusMessage(null)

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
    <div className="content">
      <AdminSidebar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        filterField={filterField}
        onFilterFieldChange={handleFilterFieldChange}
        isLoading={isLoading}
        onFetchClients={handleFetchClients}
        onFetchIrregularidades={handleFetchIrregularidades}
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
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        currentPage={currentPage}
        totalPages={pageCount}
        rowCount={itemCount}
        onPageChange={goToPage}
      />
    </div>
  )
}
