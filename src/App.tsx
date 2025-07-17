import React, { useState } from 'react'
import './App.css'

export default function App() {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [selectedRow, setSelectedRow] = useState<any | null>(null)
  const [activeTable, setActiveTable] = useState<number>(0)

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



  return (
    <div className="app">
      <div className="top-bar"><img src="./assets/logopng.png" alt="logo" />La Naviera</div>
      <div className="content">
        <div className="sidebar">
          <button onClick={handleButton1Click}>Traer Clientes</button>
          <input
            type="text"
            value={selectedRow ? selectedRow[columns[0]] || '' : ''}
            placeholder={columns[0] || 'Codigo'}
            readOnly
          />
          <input
            type="text"
            value={selectedRow ? selectedRow[columns[1]] || '' : ''}
            placeholder={columns[1] || 'Razon Social'}
            readOnly
          />
          <input
            type="text"
            value={selectedRow ? selectedRow[columns[2]] || '' : ''}
            placeholder={columns[2] || 'Domicilio'}
            readOnly
          />
          <input
            type="text"
            value={selectedRow ? selectedRow[columns[3]] || '' : ''}
            placeholder={columns[3] || 'CUIT'}
            readOnly
          />
          <button onClick={handleButton2Click}>Ver Irregularidades</button>
          <button>Opcion 3</button>
          <button>Opcion 4</button>
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
        <div className="pagination">
          <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>
            ←
          </button>
          <span>{currentPage + 1} / {totalPages || 1}</span>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>
            →
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
