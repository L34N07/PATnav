import React, { useState } from 'react'
import './App.css'

export default function App() {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [columnWidths, setColumnWidths] = useState<number[]>([])

  const ITEMS_PER_PAGE = 25

  const totalPages = Math.ceil(rows.length / ITEMS_PER_PAGE)
  const displayRows = rows.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  )

  const handleButton1Click = async () => {
    try {
      if (window.electronAPI?.runPython) {
        const result = await window.electronAPI.runPython()
        try {
          const data = JSON.parse(result)
          if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
            setColumns(data.columns)
            setRows(data.rows)
            setCurrentPage(0)
            const widths = data.columns.map((col: string) => {
              const maxLen = data.rows.reduce((m: number, row: any) => {
                const val = row[col] == null ? '' : String(row[col])
                return Math.max(m, val.length)
              }, 0)
              const ch = maxLen <= 3 ? 2 : 4
              return ch * 2
            })
            setColumnWidths(widths)
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
          <button>Opcion 2</button>
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
              <tr key={i}>
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
