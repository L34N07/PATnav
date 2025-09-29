import React from 'react'
import { DataRow, toDisplayValue } from './dataModel'

type DataTableProps = {
  columns: string[]
  rows: DataRow[]
  columnWidths: number[]
  onColumnResize: (index: number, width: number) => void
  selectedRowIndex: number | null
  onRowSelect: (row: DataRow, index: number) => void
  isLoading: boolean
  statusMessage: string | null
  errorMessage: string | null
  currentPage: number
  totalPages: number
  rowCount: number
  onPageChange: (page: number) => void
  valueFormatter?: (value: unknown) => string
}

const MIN_COLUMN_WIDTH = 50

export default function DataTable({
  columns,
  rows,
  columnWidths,
  onColumnResize,
  selectedRowIndex,
  onRowSelect,
  isLoading,
  statusMessage,
  errorMessage,
  currentPage,
  totalPages,
  rowCount,
  onPageChange,
  valueFormatter = toDisplayValue
}: DataTableProps) {
  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>, index: number) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[index] ?? MIN_COLUMN_WIDTH

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta)
      onColumnResize(index, newWidth)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const canGoPrev = currentPage > 0
  const canGoNext = totalPages > 0 && currentPage < totalPages - 1
  const showPagination = rowCount > 0

  return (
    <div className="table-container">
      {errorMessage && <div className="table-status error">{errorMessage}</div>}
      {!errorMessage && statusMessage && !isLoading && (
        <div className="table-status info">{statusMessage}</div>
      )}
      {isLoading && <div className="table-status loading">Procesando...</div>}
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={column} style={{ width: columnWidths[index] }}>
                {column}
                <div className="resizer" onMouseDown={event => handleMouseDown(event, index)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${currentPage}-${index}`}
              className={selectedRowIndex === index ? 'selected' : ''}
              onClick={() => onRowSelect(row, index)}
            >
              {columns.map((column, colIndex) => (
                <td key={column} style={{ width: columnWidths[colIndex] }}>
                  {valueFormatter(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {showPagination && (
        <div className="pagination">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!canGoPrev}
          >
            {'<'}
          </button>
          <span>{currentPage + 1} / {totalPages || 1}</span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={!canGoNext}
          >
            {'>'}
          </button>
        </div>
      )}
    </div>
  )
}
