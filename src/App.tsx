import React, { useState, useEffect } from 'react'
import './App.css'
import logo from './assets/logopng.png'

export default function App() {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [allRows, setAllRows] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterField, setFilterField] =
    useState<'dom_fiscal1' | 'cod_cliente' | 'cuit' | 'razon_social'>('dom_fiscal1')
  const [currentPage, setCurrentPage] = useState(0)
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [selectedRow, setSelectedRow] = useState<any | null>(null)
  const [activeTable, setActiveTable] = useState<number>(0)
  const [editEnabled, setEditEnabled] = useState(false)

  const [cod_cliente, setCod_cliente] = useState('')
  const [new_razon_social, setNew_razon_social] = useState('')
  const [new_dom_fiscal, setNew_dom_fiscal] = useState('')
  const [new_cuit, setNew_cuit] = useState('')

  useEffect(() => {
    if (selectedRow) {
      setCod_cliente(selectedRow[columns[0]] || '')
      setNew_razon_social(selectedRow[columns[1]] || '')
      setNew_dom_fiscal(selectedRow[columns[2]] || '')
      setNew_cuit(selectedRow[columns[3]] || '')
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

  const handleButton1Click = () => {
    setActiveTable(1)
    setColumns(['Codigo', 'Razon Social', 'Domicilio', 'CUIT'])
    setAllRows([])
    setRows([])
    setSearchQuery('')
    setCurrentPage(0)
    setColumnWidths(new Array(4).fill(150))
    setSelectedRowIndex(null)
    setSelectedRow(null)
    console.warn('Python integration was removed. Populate client data using another data source.')
  }

  const handleButton2Click = () => {
    setActiveTable(2)
    setColumns(['Comprobante', 'Prefijo', 'Total', 'Total Aplicado', 'Numero', 'Estado'])
    setRows([])
    setAllRows([])
    setSearchQuery('')
    setCurrentPage(0)
    setColumnWidths(new Array(6).fill(100))
    setSelectedRowIndex(null)
    setSelectedRow(null)
    console.warn('Python integration was removed. Populate irregularities data using another data source.')
  }

  const handleButton3Click = () => {
    if (!editEnabled || !selectedRow || columns.length < 4) {
      console.warn('No client selected or editing disabled.')
      return
    }

    const updatedRow = {
      ...selectedRow,
      [columns[1]]: new_razon_social,
      [columns[2]]: new_dom_fiscal,
      [columns[3]]: new_cuit,
    }

    setSelectedRow(updatedRow)
    setRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
    setAllRows(prev => prev.map(row => (row === selectedRow ? updatedRow : row)))
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

  const applyFilter = (query: string, field: string) => {
    const columnMap: Record<string, string> = {
      cod_cliente: 'Codigo',
      dom_fiscal1: 'Domicilio',
      cuit: 'CUIT',
      razon_social: 'Razon Social',
    }
    const column = columnMap[field]
    const filtered = allRows.filter(row =>
      row[column]?.toString().toLowerCase().includes(query.toLowerCase())
    )
    setRows(filtered)
    setCurrentPage(0)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)
    applyFilter(query, filterField)
  }

  const handleFilterFieldChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const field = e.target.value as 'dom_fiscal1' | 'cod_cliente' | 'cuit' | 'razon_social'
    setFilterField(field)
    applyFilter(searchQuery, field)
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
          <button className="fetch-button" onClick={handleButton1Click}>Traer Clientes</button>
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
          <button className="edit-button" onClick={handleButton3Click}>Editar Cliente</button>
          <hr className="separator" />
          <button className="irregularidades-button" onClick={handleButton2Click}>Ver Irregularidades</button>
        </div>
        <div className="table-container">
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