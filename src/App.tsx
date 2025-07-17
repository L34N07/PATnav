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

  const handleButton1Click = async () => {
    setActiveTable(1)
    try {
      if (window.electronAPI?.runPython) {
        const result = await window.electronAPI.runPython('get_clientes')
        try {
          const data = JSON.parse(result)
          if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
            const columnMap: Record<string, string> = {
              'cod_cliente': 'Codigo',
              'razon_social': 'Razon Social',
              'dom_fiscal1': 'Domicilio',
              'cuit': 'CUIT'
            }
            const selected = Object.keys(columnMap).filter(c => data.columns.includes(c))
            const newColumns = selected.map(c => columnMap[c])
            const newRows = data.rows.map((row: any) => {
              const r: Record<string, any> = {}
              selected.forEach(c => {
                r[columnMap[c]] = row[c]
              })
              return r
            })
            setColumns(newColumns)
            setAllRows(newRows)
            setSearchQuery('')
            setRows(newRows)
            setCurrentPage(0)
            setColumnWidths(newColumns.map(() => 150))
          }
        } catch (e) {
          console.error('Failed to parse python output', e)
        }
      }
    } catch (err) {
      console.error('runPython failed', err)
    }
  }

  const handleButton2Click = async () => {
    setActiveTable(2)
    try {
      if (window.electronAPI?.runPython) {
        await window.electronAPI.runPython('modificar_cobros_impagos')
        const result = await window.electronAPI.runPython('traer_incongruencias')
        try {
          const data = JSON.parse(result)
          if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
            const columnMap: Record<string, string> = {
              tipocomp: 'Comprobante',
              pref: 'Prefijo',
              imptotal: 'Total',
              imptotalapl: 'Total Aplicado',
              num: 'Numero',
              estado: 'Estado',
            }

            const trimmed: Record<string, string> = {}
            data.columns.forEach((c: string) => {
              trimmed[c.trim().toLowerCase()] = c
            })

            const keys = Object.keys(trimmed).filter(k => columnMap[k])
            const estadoIdx = keys.indexOf('estado')
            if (estadoIdx !== -1 && keys.length > 3) {
              keys.splice(estadoIdx, 1)
              keys.splice(3, 0, 'estado')
            }
            const newColumns = keys.map(k => columnMap[k])
            const newRows = data.rows.map((row: any) => {
              const r: Record<string, any> = {}
              keys.forEach(k => {
                const original = trimmed[k]
                r[columnMap[k]] = row[original]
              })
              return r
            })
            setColumns(newColumns)
            setRows(newRows)
            setCurrentPage(0)
            setColumnWidths(newColumns.map(() => 100))
            setSelectedRowIndex(null)
            setSelectedRow(null)
          }
        } catch (e) {
          console.error('Failed to parse python output', e)
        }
      }
    } catch (err) {
      console.error('runPython failed', err)
    }
  }

  const handleButton3Click = async () => {
    try {
      if (window.electronAPI?.runPython) {
        await window.electronAPI.runPython('update_cliente', [
          cod_cliente,
          new_razon_social,
          new_dom_fiscal,
          new_cuit,
        ])
        await handleButton1Click()
      }
    } catch (err) {
      console.error('runPython failed', err)
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
