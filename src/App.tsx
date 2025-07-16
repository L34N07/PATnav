import React from 'react'
import './App.css'

export default function App() {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `Cargo ${i + 1}`,
    value: Math.floor(Math.random() * 1000)
  }))

  return (
    <div className="app">
      <div className="top-bar"><img src={new URL('/logopng.png', import.meta.url).href} alt="logo" />La Naviera</div>
      <div className="content">
        <div className="sidebar">
          <button>Opcion 1</button>
          <button>Opcion 2</button>
          <button>Opcion 3</button>
          <button>Opcion 4</button>
        </div>
        <div className="table-container">
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
    </div>
  )
}