import React, { useEffect, useState } from "react"
import DataTable from "../DataTable"
import {
  CLIENT_COLUMNS,
  CLIENT_COLUMN_LABELS,
  CLIENT_DEFAULT_WIDTHS,
  DataRow,
  pickRowValue
} from "../dataModel"

const ITEMS_PER_PAGE = 25
const SUCCESS_MESSAGE_DURATION_MS = 3000

export default function TestView2() {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<DataRow[]>([])
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const electronAPI = window.electronAPI

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

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE)
  const displayRows = rows.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  const handleFetchClients = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    setStatusMessage(null)
    setSelectedRowIndex(null)

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
      setRows(fetchedRows)
      setColumnWidths([...CLIENT_DEFAULT_WIDTHS])
      setCurrentPage(0)
      setStatusMessage("Clientes cargados correctamente.")
    } catch (error) {
      console.error("No se pudieron traer los clientes:", error)
      setColumns([])
      setRows([])
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Error desconocido al traer los clientes."
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

  const handleRowSelect = (_row: DataRow, index: number) => {
    setSelectedRowIndex(index)
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
    <div className="content">
      <div className="test-view2">
        <div className="test-view2-actions">
          <button
            className="fetch-button"
            type="button"
            onClick={handleFetchClients}
            disabled={isLoading}
          >
            Traer Clientes
          </button>
        </div>
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