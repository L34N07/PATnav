import React, { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DataRow, toDisplayValue } from './dataModel'

type DataTableProps = {
  columns: string[]
  rows: DataRow[]
  columnWidths: number[]
  onColumnResize: (index: number, width: number) => void
  onHeaderClick?: (column: string) => void
  sortColumn?: string | null
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
  renderCell?: (params: {
    row: DataRow
    column: string
    value: unknown
    rowIndex: number
    columnIndex: number
  }) => ReactNode | undefined
  emptyMessage?: string
  fitColumnsToContainer?: boolean
}

const MIN_COLUMN_WIDTH = 50

export default function DataTable({
  columns,
  rows,
  columnWidths,
  onColumnResize,
  onHeaderClick,
  sortColumn = null,
  selectedRowIndex,
  onRowSelect,
  isLoading,
  statusMessage,
  errorMessage,
  currentPage,
  totalPages,
  rowCount,
  onPageChange,
  valueFormatter = toDisplayValue,
  renderCell,
  emptyMessage = "No hay resultados para mostrar.",
  fitColumnsToContainer = false
}: DataTableProps) {
  const columnCount = Math.max(columns.length, 1)
  const hasRows = rows.length > 0
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([])
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const updateWidth = () => {
      const computed = window.getComputedStyle(container)
      const paddingLeft = Number.parseFloat(computed.paddingLeft || '0') || 0
      const paddingRight = Number.parseFloat(computed.paddingRight || '0') || 0
      const inner = Math.max(0, container.clientWidth - paddingLeft - paddingRight)
      setAvailableWidth(inner)
    }

    updateWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth())
      observer.observe(container)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const effectiveColumnWidths = useMemo(() => {
    const rawWidths = columns.map((_, index) => columnWidths[index] ?? MIN_COLUMN_WIDTH)

    if (!fitColumnsToContainer || !availableWidth || availableWidth <= 0) {
      return rawWidths
    }

    const available = Math.max(0, Math.floor(availableWidth))
    const minTotal = MIN_COLUMN_WIDTH * rawWidths.length
    if (available <= minTotal) {
      return rawWidths.map(() => MIN_COLUMN_WIDTH)
    }

    const total = rawWidths.reduce((sum, width) => sum + width, 0)
    if (total <= available) {
      return rawWidths
    }

    const ratio = available / total
    const scaled = rawWidths.map(width => Math.max(MIN_COLUMN_WIDTH, Math.floor(width * ratio)))

    let scaledTotal = scaled.reduce((sum, width) => sum + width, 0)
    let overflow = scaledTotal - available
    if (overflow <= 0) {
      return scaled
    }

    const adjustableIndexes = scaled
      .map((width, index) => ({ width, index }))
      .sort((a, b) => b.width - a.width)
      .map(item => item.index)

    for (const index of adjustableIndexes) {
      if (overflow <= 0) {
        break
      }
      const currentWidth = scaled[index]
      const maxReduction = currentWidth - MIN_COLUMN_WIDTH
      if (maxReduction <= 0) {
        continue
      }
      const reduction = Math.min(overflow, maxReduction)
      scaled[index] = currentWidth - reduction
      overflow -= reduction
    }

    return scaled
  }, [columns, columnWidths, availableWidth, fitColumnsToContainer])

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>, index: number) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = effectiveColumnWidths[index] ?? MIN_COLUMN_WIDTH

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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasRows) {
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const lastIndex = rows.length - 1

      let nextIndex: number
      if (event.key === 'ArrowDown') {
        if (selectedRowIndex === null || selectedRowIndex === undefined) {
          nextIndex = 0
        } else {
          nextIndex = Math.min(lastIndex, selectedRowIndex + 1)
        }
      } else {
        if (selectedRowIndex === null || selectedRowIndex === undefined) {
          nextIndex = lastIndex
        } else {
          nextIndex = Math.max(0, selectedRowIndex - 1)
        }
      }

      if (rows[nextIndex] && nextIndex !== selectedRowIndex) {
        onRowSelect(rows[nextIndex], nextIndex)
      }
    }
  }

  useEffect(() => {
    if (!hasRows) {
      return
    }

    if (selectedRowIndex === null || selectedRowIndex === undefined) {
      return
    }

    if (selectedRowIndex < 0 || selectedRowIndex >= rows.length) {
      return
    }

    const rowElement = rowRefs.current[selectedRowIndex]
    if (!rowElement) {
      return
    }

    rowElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth'
    })
  }, [hasRows, rows.length, selectedRowIndex])

  return (
    <div className="table-container client-table-container" tabIndex={0} onKeyDown={handleKeyDown}>
      {errorMessage && (
        <div className="table-status error" role="alert">
          {errorMessage}
        </div>
      )}
      {!errorMessage && statusMessage && !isLoading && (
        <div className="table-status info" role="status">
          {statusMessage}
        </div>
      )}
      <div className="client-table-scroll" ref={scrollContainerRef}>
        <table className="client-table">
          <thead className="client-table__head">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column}
                  className="client-table__header-cell"
                  style={{ width: effectiveColumnWidths[index] ?? MIN_COLUMN_WIDTH }}
                >
                  {onHeaderClick ? (
                    <button
                      type="button"
                      className="client-table__header-button"
                      onClick={() => onHeaderClick(column)}
                      aria-pressed={sortColumn === column}
                    >
                      <span className="client-table__header-text">{column}</span>
                      {sortColumn === column ? (
                        <span className="client-table__sort-indicator" aria-hidden="true">
                          ▲
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <span className="client-table__header-text">{column}</span>
                  )}
                  <div
                    className="resizer client-table__resizer"
                    onMouseDown={event => handleMouseDown(event, index)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="client-table__body">
            {hasRows ? (
              rows.map((row, index) => {
                const isSelected = selectedRowIndex === index
                return (
                  <tr
                    key={`${currentPage}-${index}`}
                    className={`client-table__row${isSelected ? ' client-table__row--selected' : ''}`}
                    onClick={() => onRowSelect(row, index)}
                    ref={element => {
                      rowRefs.current[index] = element
                    }}
                  >
                    {columns.map((column, colIndex) => (
                      <td
                        key={column}
                        className="client-table__cell"
                        style={{ width: effectiveColumnWidths[colIndex] ?? MIN_COLUMN_WIDTH }}
                      >
                        {(() => {
                          const value = row[column]
                          const rendered = renderCell?.({
                            row,
                            column,
                            value,
                            rowIndex: index,
                            columnIndex: colIndex
                          })
                          return rendered !== undefined ? rendered : valueFormatter(value)
                        })()}
                      </td>
                    ))}
                  </tr>
                )
              })
            ) : (
              !isLoading && (
                <tr className="client-table__empty">
                  <td className="client-table__empty-cell" colSpan={columnCount}>
                    {emptyMessage}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      {showPagination && (
        <div className="pagination client-table__pagination">
          <button
            className="pagination__button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={!canGoPrev}
          >
            {'<'}
          </button>
          <span className="pagination__info">
            {currentPage + 1} / {totalPages || 1}
          </span>
          <button
            className="pagination__button"
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
