import React, {useState} from 'react'
import './App.css'

export default function App() {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    name: `Cargo ${i + 1}`,
    value: Math.floor(Math.random() * 1000)
  }))

  const [button2Text, setButton2Text] = useState('Opcion 2')

  const handleButton1Click = async () => {
    try {
      if (window.electronAPI?.runPython) {
        await window.electronAPI.runPython()
      }
    } finally {
      setButton2Text('hello')
    }
  }


  return (
    <div className="app">
      <div className="top-bar"><img src="./assets/logopng.png" alt="logo" />La Naviera</div>
      <div className="content">
        <div className="sidebar">
          <button onClick={handleButton1Click}>Opcion 1</button>
          <button>{button2Text}</button>
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