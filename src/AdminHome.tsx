import React, { useState, useEffect } from 'react'
import './App.css'
import TopBar from './components/TopBar'
import AdminSidebar from './components/admin/AdminSidebar'
import DataTable from './components/admin/DataTable'
import {
  CLIENT_COLUMNS,
  CLIENT_COLUMN_LABELS,
  CLIENT_DEFAULT_WIDTHS,
  CLIENT_FILTER_MAP,
  ClientFilterField,
  DataRow,
  pickRowValue,
  toDisplayValue
} from './components/admin/dataModel'

type AdminHomeProps = {
  onLogout?: () => void
}

const ITEMS_PER_PAGE = 25
const SUCCESS_MESSAGE_DURATION_MS = 3000

export default function AdminHome({ onLogout }: AdminHomeProps) {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<DataRow[]>([])
  const [allRows, setAllRows] = useState<DataRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterField, setFilterField] = useState<ClientFilterField>('dom_fiscal1')
  const [currentPage, setCurrentPage] = useState(0)
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [selectedRow, setSelectedRow] = useState<DataRow | null>(null)
  const [activeTable, setActiveTable] = useState<number>(0)
  const [editEnabled, setEditEnabled] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!statusMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage(null)
    }, SUCCESS_MESSAGE_DURATION_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [statusMessage])

  const [codCliente, setCodCliente] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [domFiscal, setDomFiscal] = useState('')
  const [cuit, setCuit] = useState('')

  const electronAPI = window.electronAPI

  useEffect(() => {
    if (selectedRow && columns.length >= CLIENT_COLUMNS.length) {
      setCodCliente(toDisplayValue(selectedRow[columns[0]]))
      setRazonSocial(toDisplayValue(selectedRow[columns[1]]))
      setDomFiscal(toDisplayValue(selectedRow[columns[2]]))
      setCuit(toDisplayValue(selectedRow[columns[3]]))
    } else {
      setCodCliente('')
      setRazonSocial('')
      setDomFiscal('')
      setCuit('')
    }
  }, [selectedRow, columns])

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE)
  const displayRows = rows.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  const handleFetchClients = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setActiveTable(1)
    setSelectedRowIndex(null)
    setSelectedRow(null)

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
      setAllRows(fetchedRows)
      setRows(fetchedRows)
      setColumnWidths([...CLIENT_DEFAULT_WIDTHS])
      setSearchQuery('')
      setCurrentPage(0)
      setStatusMessage('Clientes cargados correctamente.')
    } catch (error) {
      console.error('No se pudieron traer los clientes:', error)
      setColumns([])
      setAllRows([])
      setRows([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Error desconocido al traer los clientes.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleFetchIrregularidades = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setActiveTable(2)
    setSelectedRowIndex(null)
    setSelectedRow(null)

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
      setAllRows(dataset)
      setRows(dataset)
      setColumnWidths(new Array(cols.length).fill(150))
      setSearchQuery('')
      setCurrentPage(0)
      setStatusMessage('Irregularidades cargadas correctamente.')
    } catch (error) {
      console.error('No se pudieron traer las irregularidades:', error)
      setColumns([])
      setAllRows([])
      setRows([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Error desconocido al traer irregularidades.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateClient = async () => {
    if (!editEnabled || !selectedRow || columns.length < CLIENT_COLUMNS.length) {
      console.warn('No client selected or editing disabled.')
      return
    }

    if (!codCliente.trim()) {
      setErrorMessage('El codigo de cliente no es valido.')
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
      setRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
      setAllRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
      setStatusMessage('Cliente actualizado correctamente.')
    } catch (error) {
      console.error('No se pudo editar el cliente:', error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Error desconocido al editar el cliente.'
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

  const applyFilter = (query: string, field: ClientFilterField) => {
    if (activeTable !== 1) {
      setRows(allRows)
      setCurrentPage(0)
      return
    }

    const column = CLIENT_FILTER_MAP[field]
    if (!column) {
      setRows(allRows)
      setCurrentPage(0)
      return
    }

    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      setRows(allRows)
      setCurrentPage(0)
      return
    }

    const filtered = allRows.filter(row => {
      const value = toDisplayValue(row[column])
      if (!value) {
        return false
      }
      return value.toLowerCase().includes(normalizedQuery)
    })

    setRows(filtered)
    setCurrentPage(0)
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (activeTable === 1) {
      applyFilter(value, filterField)
    }
  }

  const handleFilterFieldChange = (field: ClientFilterField) => {
    setFilterField(field)
    if (activeTable === 1) {
      applyFilter(searchQuery, field)
    }
  }

  const handleRowSelect = (row: DataRow, index: number) => {
    setSelectedRowIndex(index)
    if (activeTable === 1) {
      setSelectedRow(row)
    }
  }

  const handlePageChange = (page: number) => {
    if (totalPages === 0) {
      setCurrentPage(0)
      return
    }
    const clampedPage = Math.max(0, Math.min(page, totalPages - 1))
    setCurrentPage(clampedPage)
  }

  return (
    <div className="app">
      <TopBar
        rightContent={onLogout ? (
          <button className="logout-button" type="button" onClick={onLogout}>
            Cerrar sesion
          </button>
        ) : null}
      />
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
          rows={displayRows}
          columnWidths={columnWidths}
          onColumnResize={handleColumnResize}
          selectedRowIndex={selectedRowIndex}
          onRowSelect={handleRowSelect}
          isLoading={isLoading}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          currentPage={currentPage}
          totalPages={totalPages}
          rowCount={rows.length}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  )
}
