import React, {useState} from 'react'
import './App.css'

export default function App() {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<any[]>([])

  const handleButton1Click = async () => {
    try {
      if (window.electronAPI?.runPython) {
        const result = await window.electronAPI.runPython()
        try {
          const data = JSON.parse(result)
          if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
            setColumns(data.columns)
            setRows(data.rows)
          }
        } catch (e) {
          console.error('Failed to parse python output', e)
        }
      }
    } catch (err) {
      console.error('runPython failed', err)
    }
  }


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
              {columns.map(col => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col}>{row[col]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
