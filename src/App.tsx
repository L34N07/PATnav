import React from 'react'
import './App.css'

export default function App() {
  const rows = [
    { id: 1, name: 'Cargo 1', value: 100 },
    { id: 2, name: 'Cargo 2', value: 200 },
    { id: 3, name: 'Cargo 3', value: 300 },
  ]

  return (
    <div className="app">
      <div className="top-bar">La Naviera</div>
      <div className="content">
        <div className="sidebar">
          <button>Opcion 1</button>
          <button>Opcion 2</button>
          <button>Opcion 3</button>
          <button>Opcion 4</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.name}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
