import React, { useState, useEffect } from 'react'
import './App.css'
import logo from './assets/logopng.png'

type DataRow = Record<string, unknown>

const CLIENT_COLUMNS = [
  { key: 'cod_cliente', label: 'Codigo', width: 140 },
  { key: 'razon_social', label: 'Razon Social', width: 220 },
  { key: 'dom_fiscal1', label: 'Domicilio', width: 260 },
  { key: 'cuit', label: 'CUIT', width: 140 }
] as const

type ClientFilterField = typeof CLIENT_COLUMNS[number]['key']

const CLIENT_COLUMN_LABELS = CLIENT_COLUMNS.map(column => column.label)

const CLIENT_FILTER_MAP: Record<ClientFilterField, string> = CLIENT_COLUMNS.reduce(
  (acc, column) => {
    acc[column.key] = column.label
    return acc
  },
  {} as Record<ClientFilterField, string>
)

const CLIENT_DEFAULT_WIDTHS = CLIENT_COLUMNS.map(column => column.width)

const toDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value : String(value)
}

const pickRowValue = (row: DataRow, key: string): string => {
  const variants = [key, key.toUpperCase(), key.toLowerCase()]
  for (const variant of variants) {
    if (Object.prototype.hasOwnProperty.call(row, variant)) {
      return toDisplayValue(row[variant])
    }
  }
  return ''
}

export default function App() {
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

  const [cod_cliente, setCod_cliente] = useState('')
  const [new_razon_social, setNew_razon_social] = useState('')
  const [new_dom_fiscal, setNew_dom_fiscal] = useState('')
  const [new_cuit, setNew_cuit] = useState('')

  const electronAPI = window.electronAPI

  useEffect(() => {
    if (selectedRow && columns.length >= CLIENT_COLUMNS.length) {
      setCod_cliente(toDisplayValue(selectedRow[columns[0]]))
      setNew_razon_social(toDisplayValue(selectedRow[columns[1]]))
      setNew_dom_fiscal(toDisplayValue(selectedRow[columns[2]]))
      setNew_cuit(toDisplayValue(selectedRow[columns[3]]))
    } else {
      setCod_cliente('')
      setNew_razon_social('')
      setNew_dom_fiscal('')
      setNew_cuit('')
    }
  }, [selectedRow, columns])

  const ITEMS_PER_PAGE = 25

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE)
  const displayRows = rows.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  const handleButton1Click = async () => {
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

  const handleButton2Click = async () => {
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

  const handleButton3Click = async () => {
    if (!editEnabled || !selectedRow || columns.length < CLIENT_COLUMNS.length) {
      console.warn('No client selected or editing disabled.')
      return
    }

    if (!cod_cliente.trim()) {
      setErrorMessage('El código de cliente no es válido.')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const response = await electronAPI.updateCliente({
        codCliente: cod_cliente,
        razonSocial: new_razon_social,
        domFiscal: new_dom_fiscal,
        cuit: new_cuit,
      })

      if (response.error) {
        throw new Error(response.details || response.error)
      }

      const updatedRow: DataRow = {
        ...selectedRow,
        [columns[1]]: new_razon_social,
        [columns[2]]: new_dom_fiscal,
        [columns[3]]: new_cuit,
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
  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    const startX = e.clientX;
    const startWidth = columnWidths[index];
    const onMouseMove = (ev: MouseEvent) => {
      const newWidths = [...columnWidths];
      newWidths[index] = Math.max(50, startWidth + ev.clientX - startX);
      setColumnWidths(newWidths);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

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
      const value = row[column]
      if (value === null || value === undefined) {
        return false
      }
      return value.toString().toLowerCase().includes(normalizedQuery)
    })

    setRows(filtered)
    setCurrentPage(0)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    if (activeTable === 1) {
      applyFilter(query, filterField)
    }
  }

  const handleFilterFieldChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const field = e.target.value as ClientFilterField
    setFilterField(field)
    if (activeTable === 1) {
      applyFilter(searchQuery, field)
    }
  }

  return (
    <div className="app">
      <div className="top-bar"><img src={logo} alt="logo" />La Naviera</div>
      <div className="content">
        <div className="sidebar">
          <input className="search-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Buscar"
          />
          <select
            value={filterField}
            onChange={handleFilterFieldChange}
            className="filter-select"
          >
            <option value="cod_cliente">Codigo</option>
            <option value="razon_social">Razon Social</option>
            <option value="dom_fiscal1">Domicilio</option>
            <option value="cuit">CUIT</option>
          </select>
          <hr className="separator" />
          <button
            className="fetch-button"
            onClick={handleButton1Click}
            disabled={isLoading}
          >
            Traer Clientes
          </button>
          <input className="code-input"
            type="text"
            value={cod_cliente}
            onChange={e => setCod_cliente(e.target.value)}
            placeholder={columns[0] || 'Codigo'}
            readOnly
          />
          <input className="razon-input"
            type="text"
            value={new_razon_social}
            onChange={e => setNew_razon_social(e.target.value)}
            placeholder={columns[1] || 'Razon Social'}
            readOnly={!editEnabled}
          />
          <input className="dom-input"
            type="text"
            value={new_dom_fiscal}
            onChange={e => setNew_dom_fiscal(e.target.value)}
            placeholder={columns[2] || 'Domicilio'}
            readOnly={!editEnabled}
          />
          <input className="cuit-input"
            type="text"
            value={new_cuit}
            onChange={e => setNew_cuit(e.target.value)}
            placeholder={columns[3] || 'CUIT'}
            readOnly={!editEnabled}
          />
          <label className="edit-toggle">
            <input
              type="checkbox"
              checked={editEnabled}
              onChange={e => setEditEnabled(e.target.checked)}
            />
            Habilitar Edicion
          </label>
          <button
            className="edit-button"
            onClick={handleButton3Click}
            disabled={isLoading || !editEnabled || !selectedRow}
          >
            Editar Cliente
          </button>
          <hr className="separator" />
          <button
            className="irregularidades-button"
            onClick={handleButton2Click}
            disabled={isLoading}
          >
            Ver Irregularidades
          </button>
        </div>
        <div className="table-container">
          {errorMessage && (
            <div className="table-status error">{errorMessage}</div>
          )}
          {!errorMessage && statusMessage && !isLoading && (
            <div className="table-status info">{statusMessage}</div>
          )}
          {isLoading && (
            <div className="table-status loading">Procesando...</div>
          )}
          <table>
            <thead>
              <tr>
                {columns.map((col, idx) => (
                  <th key={col} style={{ width: columnWidths[idx] }}>
                    {col}
                    <div className="resizer" onMouseDown={(e) => handleMouseDown(e, idx)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => (
                <tr
                  key={i}
                  className={selectedRowIndex === i ? 'selected' : ''}
                  onClick={() => {
                    setSelectedRowIndex(i)
                    if (activeTable === 1) {
                      setSelectedRow(row)
                    }
                  }}
                >
                  {columns.map((col, idx) => (
                    <td key={col} style={{ width: columnWidths[idx] }}>
                      {row[col]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 0 && (
            <div className="pagination">
              <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>
                ←
              </button>
              <span>{currentPage + 1} / {totalPages || 1}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>
                →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
